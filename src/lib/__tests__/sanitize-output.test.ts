import { describe, it, expect } from "vitest";
import { sanitizeOutput } from "../sanitize-output";

describe("sanitizeOutput", () => {
  // --- Redaction cases ---

  it("redacts DATABASE_URL assignment", () => {
    const input =
      "DATABASE_URL=postgresql://user:super_secret@neon.tech/db connected";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:DATABASE_URL]");
    expect(result).not.toContain("super_secret");
    expect(result).toContain("connected");
  });

  it("redacts postgresql:// URL without assignment prefix", () => {
    const input = "connecting to postgresql://user:pass@host/db now";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:DATABASE_URL]");
    expect(result).not.toContain("user:pass");
  });

  it("redacts Anthropic API key", () => {
    const input =
      "using key sk-ant-api03-abc123def456ghi789 to call claude";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:ANTHROPIC_KEY]");
    expect(result).not.toContain("sk-ant-api03-abc123def456ghi789");
  });

  it("redacts OpenAI API key", () => {
    const input = "openai key is sk-proj-abc123def456ghi789jkl012 configured";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:OPENAI_KEY]");
    expect(result).not.toContain("sk-proj-abc123def456ghi789jkl012");
  });

  it("redacts Trigger.dev key", () => {
    const input = "trigger key tr_dev_abc123def456ghi789jkl present";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:TRIGGER_KEY]");
    expect(result).not.toContain("tr_dev_abc123def456ghi789jkl");
  });

  it("redacts Resend API key", () => {
    const input = "resend key re_abc123def456ghi789jkl012 active";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:RESEND_KEY]");
    expect(result).not.toContain("re_abc123def456ghi789jkl012");
  });

  it("redacts Slack bot token", () => {
    const input = "slack token xoxb-123456-789012-abcdefgh configured";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:SLACK_TOKEN]");
    expect(result).not.toContain("xoxb-123456-789012-abcdefgh");
  });

  it("redacts Vercel Blob token", () => {
    const input = "blob token vercelblob_rw_abc123def456 ready";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:BLOB_TOKEN]");
    expect(result).not.toContain("vercelblob_rw_abc123def456");
  });

  it("redacts named env var assignments", () => {
    const input = "EMAILBISON_API_KEY=abc123secret configured";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:EMAILBISON_API_KEY]");
    expect(result).not.toContain("abc123secret");
  });

  it("redacts Authorization Bearer token", () => {
    const input =
      "sending Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 request";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:BEARER_TOKEN]");
    expect(result).not.toContain(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    );
  });

  // --- Preservation cases ---

  it("preserves workspace names", () => {
    const input = "Workspace: rise — processing";
    const result = sanitizeOutput(input);
    expect(result).toContain("Workspace: rise");
  });

  it("preserves email addresses", () => {
    const input = "reply from april@rise.co received";
    const result = sanitizeOutput(input);
    expect(result).toContain("april@rise.co");
  });

  it("preserves campaign names", () => {
    const input = "campaign Rise Q2 Email launched";
    const result = sanitizeOutput(input);
    expect(result).toContain("Rise Q2 Email");
  });

  it("preserves person names and template variables", () => {
    const input = "personalisation: FIRSTNAME=April, LASTNAME=Chen";
    const result = sanitizeOutput(input);
    expect(result).toContain("FIRSTNAME=April");
    expect(result).toContain("LASTNAME=Chen");
  });

  // --- Edge cases ---

  it("handles multiple secrets in one string", () => {
    const input =
      "DATABASE_URL=postgresql://u:p@host/db key sk-ant-api03-mykey123abc and xoxb-111-222-333token";
    const result = sanitizeOutput(input);
    expect(result).toContain("[REDACTED:DATABASE_URL]");
    expect(result).toContain("[REDACTED:ANTHROPIC_KEY]");
    expect(result).toContain("[REDACTED:SLACK_TOKEN]");
    expect(result).not.toContain("postgresql://");
    expect(result).not.toContain("sk-ant-api03-mykey123abc");
    expect(result).not.toContain("xoxb-111-222-333token");
  });

  it("returns unchanged string when no secrets present", () => {
    const input = "Synced 42 leads for workspace rise in 1.2s";
    const result = sanitizeOutput(input);
    expect(result).toBe(input);
  });
});
