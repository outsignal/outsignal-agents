import { queue } from "@trigger.dev/sdk";

// Pre-declared queues are required in Trigger.dev v4 — inline concurrency limits are silently ignored.
// All AI tasks must use anthropicQueue; all EmailBison tasks must use emailBisonQueue.

export const anthropicQueue = queue({
  name: "anthropic-queue",
  concurrencyLimit: 3,
});

export const emailBisonQueue = queue({
  name: "emailbison-queue",
  concurrencyLimit: 3,
});
