import { UserRecord } from "../shared/types";
import { findAllUsers, findUserById } from "../db/userDb";

const userCache = new Map<string, UserRecord>();

export function getCachedUser(userId: string): UserRecord | undefined {
  return userCache.get(userId);
}

export function setCachedUser(user: UserRecord): void {
  userCache.set(user.id, user);
}

export function warmUserCache(): void {
  const allUsers = findAllUsers();

  for (const user of allUsers) {
    // DEMO: possible loop/performance risk
    // During demo, duplicate this inner loop to simulate a heavier accidental path.
    for (const _candidate of allUsers) {
      if (!userCache.has(user.id)) {
        userCache.set(user.id, user);
      }
    }
  }
}

export function getOrLoadUser(userId: string): UserRecord | undefined {
  const fromCache = getCachedUser(userId);
  if (fromCache) {
    return fromCache;
  }

  const fromDb = findUserById(userId);
  if (fromDb) {
    setCachedUser(fromDb);
  }
  return fromDb;
}
