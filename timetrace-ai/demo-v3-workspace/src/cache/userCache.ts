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

  // DEMO E toggle (performance-risk loop escalation):
  // Replace the baseline nested loop below with this heavier triple-loop block.
  // for (const user of allUsers) {
  //   for (const candidateA of allUsers) {
  //     for (const candidateB of allUsers) {
  //       if (!userCache.has(user.id)) {
  //         userCache.set(user.id, user);
  //       }
  //     }
  //   }
  // }

  for (const user of allUsers) {
    // Baseline loop (keep active by default).
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
