/**
 * deploy-status.ts
 *
 * Vercel deployment status.
 * Usage: deploy-status
 * Output: deployment info or { available: false, message }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

// Load env files for Vercel token
dotenv.config({ path: path.resolve(cwd, ".env") });
dotenv.config({ path: path.resolve(cwd, ".env.local"), override: true });

runWithHarness("deploy-status", async () => {
  try {
    const raw = execSync("vercel ls --json 2>/dev/null", {
      cwd,
      maxBuffer,
      encoding: "utf-8",
    });

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      const recent = parsed.slice(0, 5).map(
        (d: Record<string, unknown>) => ({
          url: d.url,
          state: d.state,
          created: d.created
            ? new Date(d.created as number).toISOString()
            : null,
          target: d.target,
        })
      );
      return { available: true, deployments: recent };
    }

    return { available: true, raw: parsed };
  } catch {
    // vercel CLI not available or not authenticated
    try {
      const version = execSync("vercel --version 2>/dev/null", {
        cwd,
        maxBuffer,
        encoding: "utf-8",
      }).trim();
      return {
        available: false,
        message: `Vercel CLI installed (${version}) but listing failed. Check authentication.`,
      };
    } catch {
      return {
        available: false,
        message:
          "Vercel CLI not installed or not in PATH. Install with: npm i -g vercel",
      };
    }
  }
});
