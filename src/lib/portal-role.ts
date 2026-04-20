export type PortalRole = "owner" | "admin" | "viewer";

export function isPortalRole(value: unknown): value is PortalRole {
  return value === "owner" || value === "admin" || value === "viewer";
}
