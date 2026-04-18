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

  // DEMO D toggle (diagnostic runtime signal):
  // Uncomment this line and save to create a TypeScript diagnostic.
  // const debugMode = missingConfigFlag;

  return {
    id: user.id,
    displayName: user.name,
    // DEMO B toggle (optional chaining/fallback removal):
    // Baseline:
    contactEmail: user.email?.toLowerCase() ?? "missing-email@demo.dev",
    // Demo variant (uncomment this line + comment baseline line):
    // contactEmail: user.email.toLowerCase(),
    tierLabel: user.tier === "pro" ? "Pro Plan" : "Free Plan"
  };
}

export function logUserRequest(userId: string, context: RequestContext): string {
  // DEMO B toggle (hygiene signal):
  // Baseline comment above keeps code clean.
  // Demo variant:
  // TODO: quick demo hack; should be replaced with structured logger
  // HACK: keep request labels short to reduce payload size for now
  const requestLabel = context.requestId || "unknown-request";
  return `request=${requestLabel} user=${userId}`;
}
