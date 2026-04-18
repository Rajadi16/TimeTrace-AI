import { getOrLoadUser } from "../cache/userCache";
import { UserRecord } from "../shared/types";

export interface UserApiResponse {
  user?: UserRecord;
  source: "cache" | "db";
}

export function fetchUserRecord(userId: string): UserApiResponse {
  const user = getOrLoadUser(userId);
  if (!user) {
    return { source: "db" };
  }

  return { user, source: "cache" };
}
