export type AccountErrorReason =
  | "invalid_username"
  | "password_too_short"
  | "username_taken"
  | "conflicting_scope"
  | "no_tenant"
  | "tenant_required"
  | "unknown_tenant"
  | "not_found"
  | "inactive";

export class AccountError extends Error {
  constructor(
    public readonly reason: AccountErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export type NewAccount = {
  username: string;
  name?: string;
  platformOperator?: boolean;
  tenantId?: string;
};

export type CreatedAccount = {
  id: string;
  username: string;
  name: string;
  isPlatformOperator: boolean;
  tenant: { id: string; slug: string } | null;
};

export type PromotedAccount = {
  id: string;
  username: string;
  changed: boolean;
};
