/**
 * Generic Apify client wrapper.
 *
 * Thin layer over the `apify-client` npm package that handles auth,
 * runs an actor, waits for completion, and returns the dataset items.
 *
 * Usage:
 *   const items = await runApifyActor<MyType>('author/actor-name', { url: '...' });
 */
import { ApifyClient } from "apify-client";

/** Lazily-initialized singleton client. */
function getClient(): ApifyClient {
  const token = process.env.APIFY_API_TOKEN;
  if (!token)
    throw new Error("APIFY_API_TOKEN environment variable is not set");
  return new ApifyClient({ token });
}

/**
 * Run an Apify actor and return its default dataset items.
 *
 * @param actorId - Full actor identifier, e.g. "author/actor-name"
 * @param input - Actor input object (passed as-is)
 * @param options - Optional timeout and memory overrides
 * @returns Array of dataset items typed as T
 */
export async function runApifyActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  options?: { timeoutSecs?: number; memoryMbytes?: number }
): Promise<T[]> {
  const client = getClient();

  const run = await client.actor(actorId).call(input, {
    timeout: options?.timeoutSecs ?? 300,
    memory: options?.memoryMbytes,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as T[];
}
