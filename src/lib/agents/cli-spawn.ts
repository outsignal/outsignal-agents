/**
 * Subprocess spawn utility for CLI agent delegation.
 *
 * Runs a compiled dist/cli/*.js script as a Node.js subprocess,
 * buffers stdout, enforces a 300s timeout, and parses the JSON
 * envelope produced by _cli-harness.ts.
 *
 * Usage:
 *   const data = await cliSpawn<WorkspaceData>("workspace-get.js", ["--slug", slug]);
 */

import { spawn } from "child_process";
import { join } from "path";

/** 300 seconds — matches the chat API route maxDuration */
export const CLI_TIMEOUT_MS = 300_000;

/**
 * Type alias for the resolved data from a CLI script envelope.
 * Generic T narrows the return type at call sites.
 */
export type CliResult<T> = T;

/**
 * Run a compiled dist/cli script as a subprocess and return its parsed data.
 *
 * @param scriptName - Filename under dist/cli/ (e.g. "workspace-get.js")
 * @param args       - CLI arguments to pass to the script
 * @returns Resolves with envelope.data when the script exits 0 with ok:true
 * @throws  Error with parsed envelope.error on non-zero exit or ok:false
 * @throws  Error with stderr excerpt when stdout is not valid JSON
 * @throws  Error with timeout message when script exceeds 300s
 */
export async function cliSpawn<T = unknown>(
  scriptName: string,
  args: string[] = []
): Promise<CliResult<T>> {
  const scriptPath = join(
    process.env.PROJECT_ROOT ?? process.cwd(),
    "dist",
    "cli",
    scriptName
  );

  return new Promise<CliResult<T>>((resolve, reject) => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, CLI_TIMEOUT_MS);

    const child = spawn("node", [scriptPath, ...args], {
      signal: controller.signal,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString("utf-8").trim();

      try {
        const envelope = JSON.parse(stdout) as {
          ok: boolean;
          data?: T;
          error?: string;
          usage?: string;
        };

        if (envelope.ok) {
          resolve(envelope.data as T);
        } else {
          reject(
            new Error(
              envelope.error ?? `CLI script exited with code ${code}: ${scriptName}`
            )
          );
        }
      } catch {
        const stderr = Buffer.concat(errChunks).toString("utf-8").slice(0, 500);
        reject(
          new Error(
            `CLI script produced invalid JSON. Exit code: ${code}. Stderr: ${stderr}`
          )
        );
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        reject(new Error(`CLI script timed out after 300s: ${scriptName}`));
      } else {
        reject(err);
      }
    });
  });
}
