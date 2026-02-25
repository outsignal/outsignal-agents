import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";

export async function GET() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = "C0AGG4TKYAK"; // #client-rise

  const result: Record<string, unknown> = {
    tokenSet: !!token,
    tokenPrefix: token?.slice(0, 15),
    channelId,
  };

  if (!token) {
    return NextResponse.json({ ...result, error: "SLACK_BOT_TOKEN not set" });
  }

  try {
    const slack = new WebClient(token);
    const res = await slack.chat.postMessage({
      channel: channelId,
      text: "Debug test from Vercel",
    });
    result.success = true;
    result.ts = res.ts;
  } catch (err: unknown) {
    const slackErr = err as { data?: Record<string, unknown>; message?: string };
    result.success = false;
    result.error = slackErr.data?.error ?? slackErr.message ?? String(err);
    result.errorData = slackErr.data;
  }

  return NextResponse.json(result);
}
