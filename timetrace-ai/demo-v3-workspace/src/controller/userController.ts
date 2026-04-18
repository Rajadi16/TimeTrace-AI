import { getUserSummary, logUserRequest } from "../service/userService";
import { RequestContext } from "../shared/types";

export function handleUserRequest(userId: string, context: RequestContext): string {
  const summary = getUserSummary(userId, context);
  const auditLine = logUserRequest(userId, context);

  // DEMO: null guard removal
  // Baseline keeps this guard to avoid crashing on malformed summary payloads.
  '''if (!summary || !summary.displayName) {
    return `[safe-fallback] ${auditLine}`;
  }
'''
  return `${summary.displayName} (${summary.tierLabel}) <${summary.contactEmail}> | ${auditLine}`;
}

export function handleBatchRequest(userIds: string[], context: RequestContext): string[] {
  return userIds.map((userId) => handleUserRequest(userId, context));
}
