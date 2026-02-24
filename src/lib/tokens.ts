import { randomBytes } from "crypto";

export function generateProposalToken(): string {
  return randomBytes(24).toString("base64url");
}
