import { formatUser, getUser } from "./api1";

export function showProfile(): string {
  const user = getUser();
  return formatUser(user);
}
