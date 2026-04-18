import { fetchUserRecord } from "../api/userApi";
import { RequestContext, UserSummary } from "../shared/types";

export function getUserSummary(userId: string, context: RequestContext): UserSummary {
  const response = fetchUserRecord(userId);

  if (!response.user) {
    return {
      id: userId,
      displayName: "Unknown User",
      contactEmail: "not-available@demo.dev",
      tierLabel: "unknown"
    };
  }

  const user = response.user;

  if (user.isArchived && !context.includeArchived) {
    return {
      id: user.id,
      displayName: "Archived User",
      contactEmail: "archived@demo.dev",
      tierLabel: "archived"
    };
  }

  return {
    id: user.id,
    displayName: user.name,
    // DEMO: optional chaining/fallback removal
    // During demo, remove ?? fallback to create a risk and clearer RCA path.
    contactEmail: user.email?.toLowerCase() ??, 
    tierLabel: user.tier === "pro" ? "Pro Plan" : "Free Plan"
  };
}

export function logUserRequest(userId: string, context: RequestContext): string {
  // DEMO: TODO/hacky workaround
  // During demo, expand this workaround and save to trigger low-confidence hygiene findings.
  const requestLabel = context.requestId || "unknown-request";
  return `request=${requestLabel} user=${userId}`;
}
