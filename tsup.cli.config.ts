/**
 * tsup.cli.config.ts
 *
 * tsup bundler configuration for CLI wrapper scripts.
 * Compiles all scripts/cli/*.ts (excluding _*.ts helpers) to dist/cli/*.js.
 *
 * Key decisions:
 * - CJS format: scripts run with `node dist/cli/<name>.js`, not ESM import
 * - bundle: true + splitting: false: each script is self-contained, no shared chunks
 * - external: ["@prisma/client"]: Prisma native query engine must stay in node_modules
 * - esbuildOptions.alias: resolves @/ path aliases at bundle time (tsup doesn't read tsconfig paths)
 */

import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["scripts/cli/*.ts", "!scripts/cli/_*.ts"],
  outDir: "dist/cli",
  format: ["cjs"],
  bundle: true,
  splitting: false,
  clean: true,
  external: ["@prisma/client"],
  esbuildOptions(options) {
    options.alias = {
      "@": path.resolve(__dirname, "src"),
    };
  },
});
