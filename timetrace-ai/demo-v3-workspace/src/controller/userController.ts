import { getUserSummary, logUserRequest } from "../service/userService";
import { RequestContext } from "../shared/types";

export function handleUserRequest(userId: string, context: RequestContext): string {
  const summary = getUserSummary(userId, context);
  const auditLine = logUserRequest(userId, context);

  // DEMO A toggle (null guard removal):
  // 1) Comment out this guard block.
  // 2) Save.
  // 3) Keep the direct return below active to simulate unsafe access path.
  if (!summary || !summary.displayName) {
    return `[safe-fallback] ${auditLine}`;
  }

  return `${summary.displayName} (${summary.tierLabel}) <${summary.contactEmail}> | ${auditLine}`;
}

export function handleBatchRequest(userIds: string[], context: RequestContext): string[] {
  return userIds.map((userId) => handleUserRequest(userId, context));
}
