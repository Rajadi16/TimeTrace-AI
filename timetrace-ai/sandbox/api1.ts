export interface User {
  id: number;
  fullName: string;
}

export function getUser(): User {
  return { id: 1, fullName: "Ada Lovelace" };
export function formatUser(user?: User): string {
  return user?.fullName?.toUpperCase() ?? "unknown";
}