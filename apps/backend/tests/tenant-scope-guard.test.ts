/**
 * A guard against the mistake this branch keeps making.
 *
 * "Suspension closes a business to everyone, platform operators included" is an
 * invariant that lives in `db/query.ts` as `tenantPredicate` /
 * `tenantOrPlatformPredicate` / `openTenantsOnly`. Three review rounds in a row
 * found code that had reached past those helpers for the obvious idiom instead
 * - `tenantId ? "AND tenant_id = ?" : ""`, or an `if (tenantId)` that pushes
 * the predicate by hand - and each round the instances were found by reading
 * the diff. That does not scale, and it has already missed instances twice.
 *
 * So the invariant is checked mechanically here, over the backend source, as
 * part of `bun test`. Two rules:
 *
 *   1. Nobody builds a conditional tenant filter by hand. The idiom itself is
 *      the bug: written that way, the null branch means "every tenant" instead
 *      of "every tenant still open".
 *   2. Every read of a tenant-owned table names a tenant predicate somewhere in
 *      the function that issues it. This is the other half - the omission
 *      rather than the wrong idiom, which is what the background sweeps
 *      (the aggregator queue, the reassignment cron) got wrong.
 *
 * Rule 2 has exemptions; they are listed below with reasons, in one place, so
 * that adding one is a visible change to this file rather than a quiet comment
 * in a source file. Rule 1 has none.
 *
 * The last test in this file checks the checkers: a grep-based guard whose
 * patterns quietly stop matching passes forever while protecting nothing, so
 * the detectors are run against the shapes they are meant to catch.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const SCHEMA = join(SRC, "db", "schema.sql");

/** The module the helpers live in, which necessarily writes the predicate out. */
const HELPER_MODULE = join("db", "query.ts");

/**
 * Reads that are cross-tenant on purpose, each keyed by something globally
 * unique rather than by a tenant. A suspended tenant's rows are reachable
 * through these, and that is correct - none of them serves a tenant's data to
 * a caller acting across tenants.
 *
 * An exemption names the *query*, not the file. Exempting a whole file would
 * blind the rule to every other query in it, which is how the first draft of
 * this guard managed to miss the aggregator's dequeue sitting eight lines
 * below an exempt dedup lookup.
 */
const RULE_2_EXEMPT: Array<{ file: string; sql: string; reason: string }> = [
  {
    file: join("conversation", "held-messages.ts"),
    sql: "FROM held_messages WHERE message_id = ?",
    reason:
      "isHeld() dedupes by WhatsApp message id, before any tenant is resolved",
  },
  {
    file: join("conversation", "message-inbox.ts"),
    sql: "FROM message_inbox WHERE message_id = ?",
    reason:
      "isQueued() dedupes by WhatsApp message id, before any tenant is resolved",
  },
  {
    file: join("domains", "channels", "accounts.ts"),
    sql: "WHERE verify_token_secret_id IS NOT NULL",
    reason:
      "listWithVerifyToken() answers Meta's webhook handshake, which carries " +
      "no tenant - the token is the only discriminator",
  },
  {
    file: join("domains", "tenants", "index.ts"),
    sql: "FROM tenant_memberships m",
    reason:
      "listForUser() is the tenant switcher, keyed by user id, and filters " +
      "on t.status itself",
  },
  {
    file: join("db", "migrations.ts"),
    sql: "FROM tenant_memberships m",
    reason:
      "backfillSessionTenants() reads memberships by user id to give a " +
      "pre-tenancy session the tenant login would have given it; it runs " +
      "inside the migration, before there is a caller to scope to",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });
}

/** Path as it reads in a failure message, relative to `src`. */
function relative(file: string): string {
  return file.slice(SRC.length + 1);
}

// ---------------------------------------------------------------------------
// Rule 1: no hand-built conditional tenant filter.
// ---------------------------------------------------------------------------

/**
 * `<something>tenantId ? <string mentioning tenant_id> : ...` and its mirror,
 * where the SQL sits in the false branch. The discriminator is
 * `tenant_id` (the column) against `tenantId` (the variable): the parameter
 * lists these queries legitimately build - `tenantId ? [id, tenantId] : [id]` -
 * only ever name the variable.
 */
const TERNARY_PATTERNS = [
  /[\w.]*[tT]enant[Ii]d\s*\?\s*(["'`])(?:(?!\1)[\s\S])*\btenant_id\b(?:(?!\1)[\s\S])*\1/,
  /[\w.]*[tT]enant[Ii]d\s*\?\s*(["'`])(?:(?!\1)[\s\S])*\1\s*:\s*(["'`])(?:(?!\2)[\s\S])*\btenant_id\b/,
];

/** `if (tenantId) {` / `if (scope.tenantId) {`, opening a block. */
const TENANT_IF = /^\s*(?:\}\s*else\s+)?if\s*\(\s*!?[\w.]*[tT]enant[Ii]d\b/;

/** A string literal naming the column. */
const TENANT_COLUMN_STRING =
  /(["'`])(?:(?!\1)[\s\S])*\btenant_id\b(?:(?!\1)[\s\S])*\1/;

type Finding = { file: string; line: number; detail: string; sql?: string };

function handBuiltFilters(text: string, file: string): Finding[] {
  const found: Finding[] = [];

  for (const pattern of TERNARY_PATTERNS) {
    const global = new RegExp(pattern.source, "g");
    for (const match of text.matchAll(global)) {
      found.push({
        file,
        line: text.slice(0, match.index).split("\n").length,
        detail: match[0].replace(/\s+/g, " ").slice(0, 90),
      });
    }
  }

  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (!TENANT_IF.test(line)) return;

    // The block the `if` opens, up to its closing brace or six lines.
    for (let i = index + 1; i < Math.min(index + 7, lines.length); i++) {
      if (lines[i]!.trim() === "}") break;
      if (TENANT_COLUMN_STRING.test(lines[i]!)) {
        found.push({
          file,
          line: i + 1,
          detail: lines[i]!.trim().slice(0, 90),
        });
        break;
      }
    }
  });

  return found;
}

// ---------------------------------------------------------------------------
// Rule 2: every read of a tenant-owned table names a predicate.
// ---------------------------------------------------------------------------

/** Tables carrying a `tenant_id`, read from the schema rather than listed here. */
function tenantOwnedTables(): Set<string> {
  const schema = readFileSync(SCHEMA, "utf-8");
  const tables = new Set<string>();

  for (const match of schema.matchAll(
    /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g,
  )) {
    if (/^\s*tenant_id TEXT/m.test(match[2]!)) tables.add(match[1]!);
  }

  return tables;
}

/** Any string literal, of any of the three kinds. */
const STRING_LITERAL = /`([^`]*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;

/**
 * A tenant predicate, however it is spelled - written out, interpolated from a
 * helper, or assembled into a `conditions` array a few lines above the SQL.
 * `IDENTITY_WHERE` is the conversations one, which is (tenant, account, phone).
 */
const NAMES_A_PREDICATE =
  /\btenant_id\s*(?:=|IN|IS)|tenantPredicate|openTenantsOnly|tenantOrPlatformPredicate|IDENTITY_WHERE/;

/**
 * Where the function issuing this query starts. Crude on purpose: a top-level
 * `function`, an object method, or an assigned arrow. Overshooting backwards
 * only makes the rule more forgiving, never less correct.
 */
function functionStart(text: string, position: number): number {
  const before = text.slice(0, position).split("\n");

  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i]!;
    if (
      /^(export )?(async )?function /.test(line) ||
      /^\s{0,4}\w[\w<>, ]*[:(].*=>/.test(line) ||
      /^\s{0,4}(async )?\w+\(/.test(line)
    ) {
      return before.slice(0, i).join("\n").length;
    }
  }

  return 0;
}

function unscopedReads(
  text: string,
  file: string,
  owned: Set<string>,
): Finding[] {
  const found: Finding[] = [];

  for (const match of text.matchAll(STRING_LITERAL)) {
    const sql = match[1] ?? match[2] ?? match[3] ?? "";
    if (!/\bSELECT\b/i.test(sql)) continue;

    const named = [...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map(
      (m) => m[1]!,
    );
    const tables = named.filter((table) => owned.has(table));
    if (tables.length === 0) continue;

    // The whole function, so a predicate built into a `conditions` array or a
    // `${scope}` fragment counts as much as one written inline.
    const body = text.slice(
      functionStart(text, match.index),
      match.index + sql.length + 400,
    );
    if (NAMES_A_PREDICATE.test(body)) continue;

    found.push({
      file,
      line: text.slice(0, match.index).split("\n").length,
      detail: `${[...new Set(tables)].join(", ")}: ${sql.replace(/\s+/g, " ").slice(0, 80)}`,
      sql: sql.replace(/\s+/g, " "),
    });
  }

  return found;
}

function report(findings: Finding[]): string {
  return findings
    .map((f) => `  ${relative(f.file)}:${f.line}\n      ${f.detail}`)
    .join("\n");
}

describe("tenant scope guard", () => {
  const files = sourceFiles(SRC);

  it("finds backend sources to check", () => {
    // If the walk breaks, both rules below pass over nothing at all.
    expect(files.length).toBeGreaterThan(50);
  });

  it("builds no conditional tenant filter by hand", () => {
    const findings = files
      .filter((file) => !file.endsWith(HELPER_MODULE))
      .flatMap((file) => handBuiltFilters(readFileSync(file, "utf-8"), file));

    expect(
      findings.length === 0
        ? ""
        : "A tenant filter is being built by hand instead of with " +
            "tenantPredicate()/tenantOrPlatformPredicate() from db/query.ts.\n" +
            "Written this way, the no-tenant branch means every tenant, " +
            "including suspended ones:\n" +
            report(findings),
    ).toBe("");
  });

  it("names a tenant predicate in every read of a tenant-owned table", () => {
    const owned = tenantOwnedTables();

    const findings = files.flatMap((file) =>
      unscopedReads(readFileSync(file, "utf-8"), file, owned),
    );

    const matches = (exempt: (typeof RULE_2_EXEMPT)[number], f: Finding) =>
      f.file.endsWith(exempt.file) &&
      (f.sql ?? "").includes(exempt.sql.replace(/\s+/g, " "));

    // A stale exemption is as bad as a missing one: it reads like a considered
    // decision while covering nothing, and the next one gets added beside it.
    const unused = RULE_2_EXEMPT.filter(
      (exempt) => !findings.some((f) => matches(exempt, f)),
    );
    expect(
      unused.length === 0
        ? ""
        : "RULE_2_EXEMPT names queries that no longer exist. Delete them:\n" +
            unused.map((e) => `  ${e.file}: ${e.sql}`).join("\n"),
    ).toBe("");

    const remaining = findings.filter(
      (f) => !RULE_2_EXEMPT.some((exempt) => matches(exempt, f)),
    );

    expect(
      remaining.length === 0
        ? ""
        : "A tenant-owned table is read with no tenant predicate anywhere in " +
            "the function. Cross-tenant reads take openTenantsOnly() so a " +
            "suspended business is excluded; if the query is keyed by " +
            "something globally unique instead, add it to RULE_2_EXEMPT with " +
            "a reason:\n" +
            report(remaining),
    ).toBe("");
  });

  it("still recognises the schema's tenant-owned tables", () => {
    // Rule 2 is vacuous if this set comes back empty or tiny.
    const owned = tenantOwnedTables();

    expect(owned.size).toBeGreaterThan(10);
    expect(owned).toContain("conversations");
    expect(owned).toContain("message_inbox");
  });

  /**
   * The guard guards itself. A regex that quietly stops matching - a rename, a
   * reformat, a stray escape - turns this whole file into a no-op that passes
   * forever, which is a worse position than having no guard at all, because it
   * reads like coverage. These are the shapes the last three review rounds
   * actually found, in the form they were found in.
   */
  describe("catches the shapes it is meant to catch", () => {
    const owned = new Set(["conversations", "message_inbox", "llm_calls"]);

    it("catches the ternary idiom", () => {
      const sample = `
        const rows = getAll(
          \`SELECT * FROM products \${tenantId ? "WHERE tenant_id = ?" : ""}\`,
          tenantId ? [tenantId] : [],
        );`;

      expect(handBuiltFilters(sample, "sample.ts")).toHaveLength(1);
    });

    it("catches the conditional-push idiom", () => {
      const sample = `
        function getFunnelStats(tenantId) {
          if (tenantId) {
            conditions.push("tenant_id = ?");
            params.push(tenantId);
          }
        }`;

      expect(handBuiltFilters(sample, "sample.ts")).toHaveLength(1);
    });

    it("catches it through a scope object too", () => {
      const sample = `
        const scope = c.get("scope");
        if (scope.tenantId) {
          conditions.push("tenant_id = ?");
          params.push(scope.tenantId);
        }`;

      expect(handBuiltFilters(sample, "sample.ts")).toHaveLength(1);
    });

    it("catches a cross-tenant sweep with no predicate at all", () => {
      const sample = `
        export function checkAndReassignTimeouts() {
          const timedOut = getAll(
            \`SELECT tenant_id, phone_number FROM conversations
              WHERE assignment_notified_at < ?\`,
            [cutoff],
          );
        }`;

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("passes the same query once it takes the helper", () => {
      const sample = `
        export function checkAndReassignTimeouts() {
          const timedOut = getAll(
            \`SELECT tenant_id, phone_number FROM conversations
              WHERE assignment_notified_at < ?
                AND \${openTenantsOnly()}\`,
            [cutoff],
          );
        }`;

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(0);
    });

    it("does not flag the parameter list beside a correct query", () => {
      const sample = `
        getAll(
          \`SELECT * FROM products WHERE \${tenantPredicate(tenantId)}\`,
          tenantId ? [tenantId] : [],
        );`;

      expect(handBuiltFilters(sample, "sample.ts")).toEqual([]);
    });
  });
});
