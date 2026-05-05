import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(
  process.cwd(),
  "scripts/preflight/check-deploy-auth.sh",
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeExecutable(dir: string, name: string, body: string) {
  const path = join(dir, name);
  writeFileSync(path, body);
  await chmod(path, 0o755);
}

async function createMockBin(options?: { railwayFails?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-auth-preflight-"));
  tempDirs.push(dir);

  await writeExecutable(
    dir,
    "node",
    `#!/usr/bin/env bash
if [ "$1" = "-p" ]; then
  echo "4.4.3"
  exit 0
fi
exec /usr/bin/env node "$@"
`,
  );

  await writeExecutable(
    dir,
    "railway",
    `#!/usr/bin/env bash
if [ "$1" = "whoami" ]; then
  ${options?.railwayFails ? 'echo "Not logged in" >&2\n  exit 1' : 'echo "jonathan@outsignal.ai"\n  exit 0'}
fi
echo "unexpected railway args: $*" >&2
exit 2
`,
  );

  await writeExecutable(
    dir,
    "npx",
    `#!/usr/bin/env bash
case "$*" in
  "trigger.dev@4.4.3 whoami")
    echo "jonathan@outsignal.ai"
    exit 0
    ;;
  "vercel whoami")
    echo "jonathan@outsignal.ai"
    exit 0
    ;;
esac
echo "unexpected npx args: $*" >&2
exit 2
`,
  );

  return dir;
}

describe("deploy auth preflight", () => {
  it("prints a table and exits 0 when all deploy CLIs are authenticated", async () => {
    const mockBin = await createMockBin();
    const output = execFileSync(scriptPath, {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${mockBin}:${process.env.PATH}` },
      encoding: "utf8",
    });

    expect(output).toContain("target");
    expect(output).toContain("railway     | yes");
    expect(output).toContain("trigger.dev | yes");
    expect(output).toContain("vercel      | yes");
    expect(output).toContain("jonathan@outsignal.ai");
    expect(output).toContain("All deploy CLIs are authenticated.");
  });

  it("exits 1 and prints refresh commands when a deploy CLI is unauthenticated", async () => {
    const mockBin = await createMockBin({ railwayFails: true });

    let thrown: unknown;
    let stdout = "";
    try {
      execFileSync(scriptPath, {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${mockBin}:${process.env.PATH}` },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      thrown = error;
      stdout = String((error as { stdout?: unknown }).stdout ?? "");
    }

    expect(thrown).toBeTruthy();
    expect(stdout).toContain("railway     | no");
    expect(stdout).toContain("trigger.dev | yes");
    expect(stdout).toContain("vercel      | yes");
    expect(stdout).toContain("Railway: railway login --browserless");
  });
});
