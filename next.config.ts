import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/agent-runs", destination: "/settings?tab=operations", permanent: true },
      { source: "/background-tasks", destination: "/settings?tab=operations", permanent: true },
      { source: "/enrichment-costs", destination: "/settings?tab=costs", permanent: true },
      { source: "/integrations", destination: "/settings?tab=integrations", permanent: true },
      { source: "/notification-health", destination: "/settings?tab=notifications", permanent: true },
      { source: "/notifications", destination: "/settings?tab=notifications", permanent: true },
      { source: "/ooo-queue", destination: "/settings?tab=operations", permanent: true },
      { source: "/signals", destination: "/settings?tab=operations", permanent: true },
      { source: "/webhook-log", destination: "/settings?tab=operations", permanent: true },
      { source: "/packages", destination: "/settings?tab=packages", permanent: true },
      { source: "/agent-guide", destination: "/settings?tab=guide", permanent: true },
      { source: "/linkedin-queue", destination: "/settings?tab=operations", permanent: true },
      { source: "/pages", destination: "/settings?tab=content", permanent: true },
      { source: "/revenue", destination: "/financials?tab=revenue", permanent: true },
      { source: "/platform-costs", destination: "/financials?tab=costs", permanent: true },
      { source: "/cashflow", destination: "/financials?tab=cashflow", permanent: true },
      { source: "/email", destination: "/deliverability?tab=email-health", permanent: true },
      { source: "/senders/old", destination: "/deliverability?tab=senders", permanent: true },
      { source: "/intelligence", destination: "/analytics?view=intelligence", permanent: true },
      { source: "/replies", destination: "/inbox?view=classifications", permanent: true },
      { source: "/onboard", destination: "/clients?tab=onboard", permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        // portal.outsignal.ai/ → /portal (proxy.ts handles auth redirect)
        {
          source: "/",
          has: [{ type: "host", value: "portal.outsignal.ai" }],
          destination: "/portal",
        },
        // portal.outsignal.ai/* → /portal/*
        // Excludes _next, api, and static files
        {
          source: "/:path((?!_next|api|portal|[^/]+\\.(?:ico|png|svg|json|xml|txt|webmanifest)).*)",
          has: [{ type: "host", value: "portal.outsignal.ai" }],
          destination: "/portal/:path",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self' blob:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
