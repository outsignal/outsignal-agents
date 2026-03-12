import { defineConfig } from "@trigger.dev/sdk";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./trigger"],
  build: {
    extensions: [
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema.prisma",
        // NOTE: migrate omitted — project uses prisma db push, not migrations (Phase 35-01 decision)
        // NOTE: syncVercelEnvVars omitted — using Vercel dashboard integration instead (v6.0 locked decision)
      }),
    ],
  },
});
