import { UserRecord } from "../shared/types";

const USERS: UserRecord[] = [
  { id: "u-100", name: "Ava Thompson", email: "ava@demo.dev", tier: "pro" },
  { id: "u-101", name: "Noah Singh", email: "noah@demo.dev", tier: "free" },
  { id: "u-102", name: "Mia Chen", tier: "free", isArchived: true }
];

export function findUserById(userId: string): UserRecord | undefined {
  return USERS.find((user) => user.id === userId);
}

export function findAllUsers(): UserRecord[] {
  return [...USERS];
}
