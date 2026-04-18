export interface UserRecord {
  id: string;
  name: string;
  email?: string;
  tier: "free" | "pro";
  isArchived?: boolean;
}

export interface UserSummary {
  id: string;
  displayName: string;
  contactEmail: string;
  tierLabel: string;
}

export interface RequestContext {
  requestId: string;
  includeArchived?: boolean;
}
