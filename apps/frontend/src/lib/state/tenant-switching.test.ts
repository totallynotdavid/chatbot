// This is the one frontend file `bun test` runs, and svelte-check reads it too.
// The frontend's tsconfig has no `types: ["bun"]`, unlike the backend's, so
// `bun:test` is declared for this file rather than for the whole app.
/// <reference types="bun" />

import { describe, it, expect } from "bun:test";
// The predicate lives apart from `auth.svelte.ts` because that module is a
// rune-backed store the test runner cannot evaluate.
import { showTenantSelector } from "./tenant-switching.ts";

describe("the tenant selector", () => {
  /**
   * A member removed from their pinned tenant is left unpinned with one other
   * membership, because the backend drops the pin (platform/auth/session.ts).
   * Every tenant-scoped page answers 403 until they pin again, so the selector
   * must be shown.
   */
  it("is shown to a member left with nothing pinned and one membership", () => {
    expect(
      showTenantSelector({
        tenantCount: 1,
        activeTenantId: null,
        isPlatformOperator: false,
      }),
    ).toBe(true);
  });

  it("is shown to a member with several memberships and nothing pinned", () => {
    expect(
      showTenantSelector({
        tenantCount: 3,
        activeTenantId: null,
        isPlatformOperator: false,
      }),
    ).toBe(true);
  });

  it("is shown to a member who has somewhere else to go", () => {
    expect(
      showTenantSelector({
        tenantCount: 2,
        activeTenantId: "tn-alpha",
        isPlatformOperator: false,
      }),
    ).toBe(true);
  });

  /** Nothing to choose: their one tenant is already the one they are in. */
  it("is hidden from a member settled in their only tenant", () => {
    expect(
      showTenantSelector({
        tenantCount: 1,
        activeTenantId: "tn-alpha",
        isPlatformOperator: false,
      }),
    ).toBe(false);
  });

  /**
   * A user whose last membership was revoked has nothing to select, so a
   * selector would be an empty box rather than a way out. Logging out is.
   */
  it("is hidden from a member with no memberships at all", () => {
    expect(
      showTenantSelector({
        tenantCount: 0,
        activeTenantId: null,
        isPlatformOperator: false,
      }),
    ).toBe(false);
  });

  /**
   * The operator's unpinned state is the cross-tenant view rather than a
   * lockout, and it is itself an option in the selector. The selector is
   * therefore shown even before the tenant list has loaded.
   */
  it("is always shown to a platform operator", () => {
    for (const tenantCount of [0, 1, 5]) {
      for (const activeTenantId of [null, "tn-alpha"]) {
        expect(
          showTenantSelector({
            tenantCount,
            activeTenantId,
            isPlatformOperator: true,
          }),
        ).toBe(true);
      }
    }
  });
});
