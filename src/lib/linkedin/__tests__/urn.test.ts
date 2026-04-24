import { describe, expect, it } from "vitest";

import {
  extractLinkedInMessageId,
  extractLinkedInProfileId,
} from "@/lib/linkedin/urn";

describe("LinkedIn URN helpers", () => {
  describe("extractLinkedInProfileId", () => {
    it("extracts the profile id from newer messaging participant URNs", () => {
      expect(
        extractLinkedInProfileId(
          "urn:li:msg_messagingParticipant:ACoAAExampleProfile123",
        ),
      ).toBe("ACoAAExampleProfile123");
    });

    it("extracts the profile id from legacy messaging member URNs", () => {
      expect(
        extractLinkedInProfileId(
          "urn:li:fs_messagingMember:(urn:li:messagingThread:2-abc,ACoAAExampleProfile123)",
        ),
      ).toBe("ACoAAExampleProfile123");
    });

    it("returns null for empty or malformed URNs", () => {
      expect(extractLinkedInProfileId("")).toBeNull();
      expect(extractLinkedInProfileId("not-a-urn")).toBeNull();
      expect(extractLinkedInProfileId(null)).toBeNull();
    });
  });

  describe("extractLinkedInMessageId", () => {
    it("extracts a canonical message id from msg_message URNs", () => {
      expect(
        extractLinkedInMessageId(
          "urn:li:msg_message:(urn:li:fsd_profile:ACoAAExampleProfile123,2-message-abc)",
        ),
      ).toBe("2-message-abc");
    });

    it("extracts the shared message id from fs_event URNs", () => {
      expect(
        extractLinkedInMessageId(
          "urn:li:fs_event:(urn:li:messagingThread:2-conversation,2-message-abc)",
        ),
      ).toBe("2-message-abc");
    });

    it("falls back to the final segment for synthetic URNs", () => {
      expect(
        extractLinkedInMessageId("urn:outsignal:outbound:action-123"),
      ).toBe("action-123");
    });

    it("returns null for empty or malformed URNs", () => {
      expect(extractLinkedInMessageId("")).toBeNull();
      expect(extractLinkedInMessageId("not-a-urn")).toBeNull();
      expect(extractLinkedInMessageId(undefined)).toBeNull();
    });
  });
});
