/**
 * Suspension closes a business to platform operators too. The helpers in
 * `db/query.ts` hold that rule, and this file checks the backend source for
 * queries that bypass them.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stringLiterals, stripComments } from "./helpers/source-text.ts";

const SRC = join(import.meta.dir, "..", "src");
const SCHEMA = join(SRC, "db", "schema.sql");

/** The module the helpers live in, which necessarily writes the predicate out. */
const HELPER_MODULE = join("db", "query.ts");

/**
 * Reads that are cross-tenant on purpose, each keyed by something globally
 * unique. None serves a tenant's data to a caller acting across tenants.
 * An exemption names the query, not the file. A whole-file exemption would
 * hide every other query in that file from rule 2.
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

// Both rules read the source with its comments blanked out, so prose and
// commented-out code neither hide a query nor stand in for a predicate.

// Rule 1: nobody builds a conditional tenant filter by hand. Written that way,
// the null branch means every tenant instead of every open tenant.

/**
 * A `tenantId ? "...tenant_id..." : ...` ternary and its mirror, with the SQL in
 * the false branch. The patterns key on the column `tenant_id`, not the variable
 * `tenantId`, because legitimate parameter lists such as
 * `tenantId ? [id, tenantId] : [id]` only ever name the variable.
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

function handBuiltFilters(source: string, file: string): Finding[] {
  const text = stripComments(source);
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

// Rule 2: every read of a tenant-owned table names a tenant predicate in the
// function that issues it. This catches the omission that rule 1 cannot see.

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

/**
 * The spellings of a tenant predicate that the backend uses: written out,
 * interpolated from a helper, or assembled into a `conditions` array above the
 * SQL. `IDENTITY_WHERE` is the conversations predicate over (tenant, account,
 * phone).
 */
const NAMES_A_PREDICATE =
  /\btenant_id\s*(?:=|IN|IS)|tenantPredicate|openTenantsOnly|tenantOrPlatformPredicate|IDENTITY_WHERE/;

/**
 * Where the function issuing this query starts. The match is deliberately crude
 * (a top-level function, an object method or an assigned arrow). Overshooting
 * backwards only makes rule 2 more forgiving.
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
  source: string,
  file: string,
  owned: Set<string>,
): Finding[] {
  const text = stripComments(source);
  const found: Finding[] = [];

  for (const literal of stringLiterals(text)) {
    const sql = literal.content;
    if (!/\bSELECT\b/i.test(sql)) continue;

    const named = [...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map(
      (m) => m[1]!,
    );
    const tables = named.filter((table) => owned.has(table));
    if (tables.length === 0) continue;

    // The scan runs from the function's start to 400 characters past the query,
    // so a predicate built into a `conditions` array or a `${scope}` fragment
    // counts as much as an inline one.
    const body = text.slice(
      functionStart(text, literal.index),
      literal.index + sql.length + 400,
    );
    if (NAMES_A_PREDICATE.test(body)) continue;

    found.push({
      file,
      line: text.slice(0, literal.index).split("\n").length,
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

    // A stale exemption covers nothing but reads like a considered decision, so
    // an unused one fails the test.
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
   * Runs the detectors against the shapes they must catch. A regex that quietly
   * stops matching would turn this file into a no-op that still reads as coverage.
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

    // An unscoped read, filler, and a scoped read further down. The filler puts
    // the scoped read's predicate outside the unscoped read's window.
    const filler = "  // filler\n".repeat(60);
    const unscopedRead = `
        function listAll() {
          return getAll("SELECT * FROM conversations");
        }
${filler}`;
    const scopedRead = `
        function listOwn(tenantId) {
          return getAll("SELECT * FROM conversations WHERE tenant_id = ?", [tenantId]);
        }`;

    it("is not hidden by an apostrophe in the comments around a read", () => {
      const sample =
        "// the worker's pass\n" +
        unscopedRead +
        scopedRead +
        "\n// the caller's job";

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("flags the same code when the comments have no apostrophe", () => {
      const sample =
        "// the pass of the worker\n" +
        unscopedRead +
        scopedRead +
        "\n// the job of the caller";

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("finds no read in a comment", () => {
      const sample = `
        // SELECT * FROM conversations
        /* SELECT * FROM conversations WHERE phone_number = ? */
        /**
         * getAll("SELECT * FROM conversations")
         */
        export function nothing() {}`;

      expect(unscopedReads(sample, "sample.ts", owned)).toEqual([]);
    });

    it("does not count a predicate written in a comment", () => {
      const sample = `
        export function listAll() {
          // tenant_id = ?
          /* WHERE tenant_id = ? */
          return getAll("SELECT * FROM conversations");
        }`;

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("keeps the line of a read below a multi-line comment", () => {
      const sample = `/**
 * one
 * two
 */
getAll("SELECT * FROM conversations");`;

      expect(unscopedReads(sample, "sample.ts", owned)[0]?.line).toBe(5);
    });

    it("stays in sync after a string, a template and a regex literal", () => {
      // A scoped read follows the read under test. If the scan slips out of
      // step, a stray quote swallows the unscoped read and this predicate covers it.
      const scopedTail = `\n${filler}getAll('SELECT * FROM conversations WHERE tenant_id = ?');`;
      const leads = {
        "a string with an apostrophe": `const note = "don't";`,
        "a string with an escaped quote": `const note = 'it\\'s';`,
        "a string holding a comment opener": `const glob = "src/**/*.ts";`,
        "a template with a URL": `const url = \`https://example.com/\${id}\`;`,
        "a regex with a quote": `const quoted = /'/.test(text);`,
        "a regex ending in two slashes": `const slashes = /^\\/\\//.test(text);`,
      };

      for (const [name, lead] of Object.entries(leads)) {
        const sample = `${lead} getAll("SELECT * FROM conversations");${scopedTail}`;

        expect({
          name,
          found: unscopedReads(sample, "sample.ts", owned).length,
        }).toEqual({ name, found: 1 });
      }
    });

    it("reads a query held in a template nested in a substitution", () => {
      const sample = `const q = \`\${rows.map((row) => \`SELECT * FROM conversations WHERE id = \${row}\`).join(" UNION ")}\`;`;

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("judges a query nested in a substitution on its own", () => {
      // The scoped arm sits more than 400 characters past the nested query, so
      // the nested query is flagged only if it owns its window.
      const sample = `
        function listAll(rows) {
          const query = \`\${rows.map((row) => \`SELECT * FROM conversations WHERE id = \${row}\`).join(" UNION ")}${filler} UNION SELECT * FROM conversations WHERE tenant_id = ?\`;
          return getAll(query);
        }`;

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("blanks each substitution in its template and lists a literal inside one on its own", () => {
      const sample = "const a = `x${`y`}z${w}`;";

      expect(stringLiterals(sample)).toEqual([
        { index: sample.indexOf("`"), content: "x${   }z${ }" },
        { index: sample.indexOf("`y"), content: "y" },
      ]);
    });

    it("reads no query in code inside a substitution", () => {
      const sample =
        "const page = `p ${/SELECT * FROM conversations/.test(text)}`;";

      expect(unscopedReads(sample, "sample.ts", owned)).toEqual([]);
    });

    it("stays in sync after a template nested in a substitution", () => {
      const sample = `const label = \`a \${rows.map((row) => \`b \${row} // c\`).join(", ")} // d\`; getAll("SELECT * FROM conversations");`;

      expect(unscopedReads(sample, "sample.ts", owned)).toHaveLength(1);
    });

    it("reports the line of the literal, not of the token before it", () => {
      const sample = `getAll(
  "SELECT * FROM conversations",
);`;

      expect(unscopedReads(sample, "sample.ts", owned)[0]?.line).toBe(2);
    });

    it("finds no read in a comment inside a template substitution", () => {
      const sample = "const q = `${/* SELECT * FROM conversations */ 1}`;";

      expect(unscopedReads(sample, "sample.ts", owned)).toEqual([]);
    });

    it("lists each literal's text between its quotes and the offset of its opening quote", () => {
      const sample = 'const a = "x\'y"; const b = `p${q}r`;';

      expect(stringLiterals(sample)).toEqual([
        { index: sample.indexOf('"'), content: "x'y" },
        { index: sample.indexOf("`"), content: "p${ }r" },
      ]);
    });

    it("blanks comments and nothing else", () => {
      const comments = [
        "// one",
        "/* two */",
        "/* three */",
        "/* four\n   five */",
      ];
      const source =
        'const a = "// not a comment"; // one\n' +
        'const b = /* two */ `//${"x" /* three */}`;\n' +
        "/* four\n   five */ const c = /'/;\n";

      let expected = source;
      for (const comment of comments) {
        expected = expected.replace(comment, comment.replace(/[^\n]/g, " "));
      }

      expect(stripComments(source)).toBe(expected);
    });

    it("counts a commented-out hand-built filter neither for nor against a file", () => {
      const commented = `
        // const rows = tenantId ? "WHERE tenant_id = ?" : "";
        // if (tenantId) {
        //   conditions.push("tenant_id = ?");
        // }
        const rows = getAll("SELECT * FROM products");`;
      const live = `
        // the caller's filter
        if (tenantId) {
          conditions.push("tenant_id = ?");
        }`;

      expect(handBuiltFilters(commented, "sample.ts")).toEqual([]);
      expect(handBuiltFilters(live, "sample.ts")).toHaveLength(1);
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
