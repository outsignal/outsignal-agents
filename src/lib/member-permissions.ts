/**
 * Role-based permission checks for workspace members.
 *
 * Roles: "owner" | "admin" | "viewer"
 */

export function canManageCampaigns(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function canManageSenders(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function canManageMembers(role: string): boolean {
  return role === "owner";
}

export function canViewReports(role: string): boolean {
  return true;
}
