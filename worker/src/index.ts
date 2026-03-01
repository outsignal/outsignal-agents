/**
 * Entry point for the LinkedIn worker.
 *
 * Runs two services concurrently:
 * 1. Worker poll loop — fetches actions from the queue and executes them
 * 2. Session server — HTTP server for headless login via agent-browser
 *
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

import { Worker } from "./worker.js";
import { SessionServer } from "./session-server.js";
import { ApiClient } from "./api-client.js";

// Required env vars
const API_URL = process.env.API_URL;
const API_SECRET = process.env.API_SECRET;
const WORKSPACE_SLUGS = process.env.WORKSPACE_SLUGS; // comma-separated
const PORT = parseInt(process.env.PORT ?? "8080", 10);

if (!API_URL) {
  console.error("Missing API_URL environment variable");
  process.exit(1);
}
if (!API_SECRET) {
  console.error("Missing API_SECRET environment variable");
  process.exit(1);
}
if (!WORKSPACE_SLUGS) {
  console.error("Missing WORKSPACE_SLUGS environment variable");
  process.exit(1);
}

const slugs = WORKSPACE_SLUGS.split(",").map((s) => s.trim()).filter(Boolean);

console.log(`[Main] Starting LinkedIn worker`);
console.log(`[Main] API: ${API_URL}`);
console.log(`[Main] Workspaces: ${slugs.join(", ")}`);
console.log(`[Main] Session server port: ${PORT}`);

// Initialize shared API client
const api = new ApiClient(API_URL, API_SECRET);

// Start worker poll loop
const worker = new Worker({
  apiUrl: API_URL,
  apiSecret: API_SECRET,
  workspaceSlugs: slugs,
});

// Start session server (HTTP for headless login via agent-browser)
const sessionServer = new SessionServer(api, API_SECRET);
sessionServer.start(PORT);

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Main] Received ${signal}, shutting down gracefully...`);
  await Promise.all([
    worker.stop(),
    sessionServer.stop(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start worker
worker.start().catch((error) => {
  console.error("[Main] Fatal error:", error);
  process.exit(1);
});
