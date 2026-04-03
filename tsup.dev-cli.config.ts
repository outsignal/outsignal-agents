/**
 * tsup.dev-cli.config.ts
 *
 * tsup bundler configuration for Monty dev-cli wrapper scripts.
 * Compiles all scripts/dev-cli/*.ts (excluding _*.ts helpers) to dist/dev-cli/*.js.
 *
 * Mirrors tsup.cli.config.ts (Nova's CLI build) with identical settings.
 * Separate config maintains dev-cli/ vs cli/ namespace separation.
 */

import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["scripts/dev-cli/*.ts", "!scripts/dev-cli/_*.ts"],
  outDir: "dist/dev-cli",
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
