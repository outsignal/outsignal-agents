import { describe, expect, it } from "vitest";

import {
  createSenderSchema,
  updateSenderSchema,
} from "@/lib/validations/senders";

describe("sender validation schemas", () => {
  it("createSenderSchema trims leading and trailing whitespace from name", () => {
    const parsed = createSenderSchema.parse({
      workspaceSlug: "rise",
      name: "  Charlie Phillips  ",
    });

    expect(parsed.name).toBe("Charlie Phillips");
  });

  it("createSenderSchema rejects empty strings after trim", () => {
    const result = createSenderSchema.safeParse({
      workspaceSlug: "rise",
      name: "   ",
    });

    expect(result.success).toBe(false);
  });

  it("updateSenderSchema trims name when provided", () => {
    const parsed = updateSenderSchema.parse({
      name: "  Lucy Marshall  ",
    });

    expect(parsed.name).toBe("Lucy Marshall");
  });

  it("updateSenderSchema accepts undefined name", () => {
    const parsed = updateSenderSchema.parse({});

    expect(parsed.name).toBeUndefined();
  });
});

