import { describe, expect, it } from "vitest";

import {
  writerCreativeIdeaDraftSchema,
  writerEmailStepSchema,
  writerLinkedInStepSchema,
  writerStepPositionSchema,
  writerValidationStepSchema,
} from "@/lib/agents/types";

describe("writer step schemas", () => {
  it("rejects invalid step positions before persistence", () => {
    expect(writerStepPositionSchema.safeParse(0).success).toBe(false);
    expect(writerStepPositionSchema.safeParse(-1).success).toBe(false);
    expect(writerStepPositionSchema.safeParse(1.5).success).toBe(false);
    expect(writerStepPositionSchema.safeParse(null).success).toBe(false);
    expect(writerStepPositionSchema.safeParse(undefined).success).toBe(false);

    expect(
      writerEmailStepSchema.safeParse({
        position: 0,
        subjectLine: "Subject",
        body: "Body",
        delayDays: 0,
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(false);
    expect(
      writerEmailStepSchema.safeParse({
        position: -1,
        subjectLine: "Subject",
        body: "Body",
        delayDays: 0,
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(false);
    expect(
      writerEmailStepSchema.safeParse({
        position: 1.5,
        subjectLine: "Subject",
        body: "Body",
        delayDays: 0,
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(false);

    expect(
      writerLinkedInStepSchema.safeParse({
        position: 0,
        type: "message",
        body: "Hello there",
        delayDays: 0,
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(false);

    expect(
      writerValidationStepSchema.safeParse({
        position: 0,
        channel: "email",
        body: "Hello there",
      }).success,
    ).toBe(false);
    expect(
      writerCreativeIdeaDraftSchema.safeParse({
        position: 0,
        title: "Idea",
        groundedIn: "Case study",
        subjectLine: "Subject",
        body: "Body",
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(false);
    expect(
      writerValidationStepSchema.safeParse({
        position: null,
        channel: "email",
        body: "Hello there",
      }).success,
    ).toBe(false);
    expect(
      writerValidationStepSchema.safeParse({
        channel: "email",
        body: "Hello there",
      }).success,
    ).toBe(false);
  });

  it("accepts canonical one-based positions", () => {
    expect(writerStepPositionSchema.safeParse(1).success).toBe(true);
    expect(writerStepPositionSchema.safeParse(2).success).toBe(true);
    expect(writerStepPositionSchema.safeParse(3).success).toBe(true);
    expect(
      writerEmailStepSchema.safeParse({
        position: 1,
        subjectLine: "Subject",
        body: "Body",
        delayDays: 0,
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(true);
    expect(
      writerCreativeIdeaDraftSchema.safeParse({
        position: 2,
        title: "Idea",
        groundedIn: "Case study",
        subjectLine: "Subject",
        body: "Body",
        notes: "Applied: principle from KB",
      }).success,
    ).toBe(true);
    expect(
      writerValidationStepSchema.safeParse({
        position: 3,
        channel: "email",
        body: "Hello there",
      }).success,
    ).toBe(true);
  });
});
