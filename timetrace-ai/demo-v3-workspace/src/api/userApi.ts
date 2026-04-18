import { getOrLoadUser } from "../cache/userCache";
import { UserRecord } from "../shared/types";

export interface UserApiResponse {
  user?: UserRecord;
  source: "cache" | "db";
}

export function fetchUserRecord(userId: string): UserApiResponse {
  // DEMO C toggle (export signature break):
  // Change signature to: fetchUserRecord(userId: string, includeArchived: boolean)
  // Keep service call sites unchanged for one save to surface cross-file contract break.
  // Optional inside-function variant:
  // if (!includeArchived && user?.isArchived) {
  //   return { source: "cache" };
  // }

  const user = getOrLoadUser(userId);
  if (!user) {
    return { source: "db" };
  }

  return { user, source: "cache" };
}
