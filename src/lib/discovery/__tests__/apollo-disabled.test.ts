import { describe, expect, it } from "vitest";

import { APOLLO_DISABLED_MESSAGE } from "@/lib/discovery/apollo-disabled";
import { apolloAdapter } from "@/lib/discovery/adapters/apollo";

describe("ApolloAdapter disable guard", () => {
  it("fails closed before any API call", async () => {
    await expect(
      apolloAdapter.search({}, 25),
    ).rejects.toThrow(APOLLO_DISABLED_MESSAGE);
  });
});
