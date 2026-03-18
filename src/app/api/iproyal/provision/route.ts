import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseJsonBody } from "@/lib/parse-json";
import { iproyal, parseProxyCredentials, IPRoyalApiError } from "@/lib/iproyal/client";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const provisionSchema = z.object({
  senderId: z.string().min(1, "senderId is required"),
  country: z.string().optional().default("United Kingdom"),
});

// ---------------------------------------------------------------------------
// Auth helper — validates x-api-key against API_SECRET (timing-safe)
// ---------------------------------------------------------------------------

function authenticateRequest(
  request: NextRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.API_SECRET;
  if (!secret) {
    console.warn(
      "[iproyal/provision] API_SECRET not configured — rejecting all requests",
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "API authentication not configured" },
        { status: 401 },
      ),
    };
  }

  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      ),
    };
  }

  const apiKeyBuf = Buffer.from(apiKey);
  const secretBuf = Buffer.from(secret);
  if (
    apiKeyBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(apiKeyBuf, secretBuf)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// POST /api/iproyal/provision
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth
  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    // Parse & validate body
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;

    const parsed = provisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { senderId, country } = parsed.data;

    // Look up sender
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
      select: {
        id: true,
        emailAddress: true,
        name: true,
        loginMethod: true,
        iproyalOrderId: true,
        proxyUrl: true,
        workspaceSlug: true,
      },
    });

    if (!sender) {
      return NextResponse.json(
        { error: "Sender not found" },
        { status: 404 },
      );
    }

    if (sender.loginMethod === "none") {
      return NextResponse.json(
        { error: "Sender has loginMethod 'none' — proxy not applicable" },
        { status: 400 },
      );
    }

    if (sender.iproyalOrderId) {
      return NextResponse.json(
        { error: "Sender already has a proxy assigned" },
        { status: 409 },
      );
    }

    // Fetch products and find ISP / Static Residential product
    const products = await iproyal.getProducts();
    const product = products.find(
      (p) =>
        p.name.toLowerCase().includes("static residential") ||
        p.name.toLowerCase().includes("isp"),
    );

    if (!product) {
      return NextResponse.json(
        {
          error: "Could not find Static Residential / ISP product",
          details: products.map((p) => p.name),
        },
        { status: 500 },
      );
    }

    // Find matching location
    const location = product.locations.find(
      (l) => l.name.toLowerCase() === country.toLowerCase(),
    );

    if (!location) {
      return NextResponse.json(
        {
          error: `Location "${country}" not found`,
          details: product.locations.map((l) => l.name),
        },
        { status: 400 },
      );
    }

    if (location.out_of_stock) {
      return NextResponse.json(
        { error: `Location "${country}" is out of stock` },
        { status: 400 },
      );
    }

    // Find 30-day plan
    const plan = product.plans.find(
      (p) => p.name.toLowerCase().includes("30") || p.name.toLowerCase().includes("month"),
    );

    if (!plan) {
      return NextResponse.json(
        {
          error: "Could not find 30-day plan",
          details: product.plans.map((p) => p.name),
        },
        { status: 500 },
      );
    }

    // Calculate pricing
    const pricing = await iproyal.calculatePricing({
      product_id: product.id,
      product_plan_id: plan.id,
      product_location_id: location.id,
      quantity: 1,
    });

    // Create order
    const order = await iproyal.createOrder({
      product_id: product.id,
      product_plan_id: plan.id,
      product_location_id: location.id,
      quantity: 1,
      auto_extend: true,
    });

    // Parse proxy credentials
    const credentials = parseProxyCredentials(order);

    if (!credentials) {
      // Order created but no proxy data yet — store order ID anyway
      await prisma.sender.update({
        where: { id: senderId },
        data: { iproyalOrderId: String(order.id) },
      });

      return NextResponse.json({
        success: true,
        order: {
          id: order.id,
          status: order.status,
          expire_date: order.expire_date,
          location: order.location,
          price: pricing.price,
        },
        proxy: null,
        sender: { id: sender.id, emailAddress: sender.emailAddress, proxyUrl: null },
        note: "Order created but proxy credentials not yet available — check order status later",
      });
    }

    // Update sender with proxy URL and order ID
    const updatedSender = await prisma.sender.update({
      where: { id: senderId },
      data: {
        proxyUrl: credentials.url,
        iproyalOrderId: String(order.id),
      },
      select: {
        id: true,
        emailAddress: true,
        proxyUrl: true,
      },
    });

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        expire_date: order.expire_date,
        location: order.location,
        price: pricing.price,
      },
      proxy: {
        host: credentials.host,
        port: credentials.port,
        url: credentials.url,
      },
      sender: {
        id: updatedSender.id,
        emailAddress: updatedSender.emailAddress,
        proxyUrl: updatedSender.proxyUrl,
      },
    });
  } catch (error) {
    if (error instanceof IPRoyalApiError) {
      console.error("[iproyal/provision] IPRoyal API error:", error.message);
      return NextResponse.json(
        { error: "IPRoyal API error", details: error.message },
        { status: 500 },
      );
    }

    console.error("[iproyal/provision] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to provision proxy" },
      { status: 500 },
    );
  }
}
