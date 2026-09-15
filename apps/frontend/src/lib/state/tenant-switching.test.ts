// The one file here that `bun test` runs, and svelte-check reads it too - the
// frontend's tsconfig has no `types: ["bun"]` (the backend's does), so `bun:test`
// is declared for this file rather than for the whole app.
/// <reference types="bun" />

/**
 * Who gets the tenant selector.
 *
 * The predicate lives apart from `auth.svelte.ts` because that module is a
 * rune-backed store the test runner cannot evaluate; this is the whole of the
 * decision it makes, so it is the whole of what there is to test.
 */

import { describe, it, expect } from "bun:test";
import { showTenantSelector } from "./tenant-switching.ts";

describe("the tenant selector", () => {
  /**
   * Regression: the test was "more than one tenant to choose between", so a
   * member with a single membership never saw the selector - including in the
   * one state where they have to use it.
   *
   * Round 7 closed the migration path into that state. This is the other way
   * in, and it needs no migration: remove a member from the tenant they are
   * working in, and the next request finds no membership for the pinned tenant
   * and drops the pin (platform/auth/session.ts, which is right to). If one
   * other membership is left they are now unpinned with exactly one tenant, and
   * every tenant-scoped page answers 403 until the pin comes back. Without the
   * selector the only way to get it back was to log out and in again, where
   * `defaultTenantForUser` pins the single membership.
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
   * lockout, and it is itself an option in the selector, so they always have
   * one - even before the tenant list has loaded.
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
