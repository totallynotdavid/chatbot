/**
 * A `*_at` field in packages/types is `number` over an INTEGER column and
 * `string` over a TEXT column, with `| null` allowed either way. No `*_at`
 * property in apps/frontend/src is declared `string`, since the API sends numbers.
 */

import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import ts from "typescript";

const TYPES_SRC = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "types",
  "src",
);
const SCHEMA = join(import.meta.dir, "..", "src", "db", "schema.sql");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const FRONTEND_SRC = join(REPO_ROOT, "apps", "frontend", "src");

/** A property listed here may be declared `string`. Name its file, its field and the reason. */
const FRONTEND_EXEMPT: Array<{ file: string; field: string; reason: string }> =
  [];

/** Each type that declares a `*_at` field, paired with its table. A type missing here fails. */
const TYPE_TABLES: Array<{ type: string; table: string }> = [
  { type: "Tenant", table: "tenants" },
  { type: "TenantMembership", table: "tenant_memberships" },
  { type: "ChannelAccount", table: "channel_accounts" },
  { type: "Asset", table: "assets" },
  { type: "Conversation", table: "conversations" },
  { type: "CatalogPeriod", table: "catalog_periods" },
  { type: "ConversationMessage", table: "messages" },
  { type: "User", table: "users" },
  { type: "AnalyticsEvent", table: "analytics_events" },
  { type: "AuditLog", table: "audit_log" },
  { type: "Order", table: "orders" },
  { type: "Product", table: "products" },
  { type: "Bundle", table: "catalog_bundles" },
];

const EXPECTED_TYPE: Record<string, string> = {
  INTEGER: "number",
  TEXT: "string",
};

type DeclaredField = { name: string; base: string; nullable: boolean };

/** Top-level type name to every `*_at` field found anywhere inside its declaration. */
type DeclaredFields = Map<string, DeclaredField[]>;

/** Table name to column name to SQL column type. */
type Columns = Map<string, Map<string, string>>;

function declaredField(
  name: string,
  node: ts.TypeNode,
  file: ts.SourceFile,
): DeclaredField {
  const parts = ts.isUnionTypeNode(node) ? node.types : [node];
  const isNull = (part: ts.TypeNode) =>
    ts.isLiteralTypeNode(part) &&
    part.literal.kind === ts.SyntaxKind.NullKeyword;
  return {
    name,
    base: parts
      .filter((part) => !isNull(part))
      .map((part) => part.getText(file))
      .join(" | "),
    nullable: parts.some(isNull),
  };
}

function declaredTimestampFields(
  source: string,
  fileName: string,
  declared: DeclaredFields = new Map(),
): DeclaredFields {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  for (const statement of file.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.isInterfaceDeclaration(statement)
    ) {
      continue;
    }
    const typeName = statement.name.text;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertySignature(node) &&
        node.type &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text.endsWith("_at")
      ) {
        const fields = declared.get(typeName) ?? [];
        fields.push(declaredField(node.name.text, node.type, file));
        declared.set(typeName, fields);
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
  return declared;
}

function readDeclaredFields(
  directory: string,
  declared: DeclaredFields = new Map(),
): DeclaredFields {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      readDeclaredFields(path, declared);
    } else if (/\.tsx?$/.test(entry.name)) {
      declaredTimestampFields(readFileSync(path, "utf8"), path, declared);
    }
  }
  return declared;
}

/** Reads the first line of each column definition in the `CREATE TABLE` blocks. */
function schemaColumns(schema: string): Columns {
  const columns: Columns = new Map();
  const tables = schema.matchAll(
    /^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(\n([\s\S]*?)\n\);/gm,
  );
  for (const [, table, body] of tables) {
    const tableColumns = new Map<string, string>();
    for (const [, column, sqlType] of body!.matchAll(
      /^\s+(\w+)\s+(INTEGER|TEXT|REAL|BLOB|NUMERIC)\b/gm,
    )) {
      tableColumns.set(column!, sqlType!);
    }
    columns.set(table!, tableColumns);
  }
  return columns;
}

function timestampMismatches(
  pairs: Array<{ type: string; table: string }>,
  declared: DeclaredFields,
  columns: Columns,
): string[] {
  const problems: string[] = [];
  const listed = new Set(pairs.map((pair) => pair.type));

  for (const [type, fields] of declared) {
    if (listed.has(type)) continue;
    for (const { name: field } of fields) {
      problems.push(
        `${type}.${field} is declared in packages/types, but ${type} is not in the list that pairs each type with its table`,
      );
    }
  }

  for (const { type, table } of pairs) {
    const fields = declared.get(type);
    if (!fields) {
      problems.push(
        `The list pairs ${type} with ${table}, but ${type} declares no *_at field in packages/types`,
      );
      continue;
    }
    const tableColumns = columns.get(table);
    if (!tableColumns) {
      problems.push(
        `The list pairs ${type} with ${table}, which schema.sql does not create`,
      );
      continue;
    }
    for (const { name: field, ...fieldType } of fields) {
      const sqlType = tableColumns.get(field);
      const declaredAs = fieldType.nullable
        ? `${fieldType.base} | null`
        : fieldType.base;
      if (!sqlType) {
        problems.push(
          `${type}.${field} has no column ${table}.${field} in schema.sql`,
        );
      } else if (!(sqlType in EXPECTED_TYPE)) {
        problems.push(
          `${type}.${field} is declared ${declaredAs}, but ${table}.${field} is ${sqlType}, which this check does not map`,
        );
      } else if (fieldType.base !== EXPECTED_TYPE[sqlType]) {
        problems.push(
          `${type}.${field} is declared ${declaredAs}, but ${table}.${field} is ${sqlType}, so it should be ${EXPECTED_TYPE[sqlType]}`,
        );
      }
    }
  }
  return problems;
}

type FrontendProperty = DeclaredField & { line: number };

/** Every `*_at` property with a type annotation, in a .ts file or in the `<script>` blocks of a .svelte file. */
function timestampProperties(
  source: string,
  fileName: string,
): FrontendProperty[] {
  const scripts = fileName.endsWith(".svelte")
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
        (match) => ({
          code: match[1]!,
          firstLine:
            source.slice(0, match.index + match[0].indexOf(">") + 1).split("\n")
              .length - 1,
        }),
      )
    : [{ code: source, firstLine: 0 }];

  const found: FrontendProperty[] = [];
  for (const { code, firstLine } of scripts) {
    const file = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
        node.type &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text.endsWith("_at")
      ) {
        found.push({
          ...declaredField(node.name.text, node.type, file),
          line:
            firstLine +
            file.getLineAndCharacterOfPosition(node.name.getStart()).line +
            1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

function frontendSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return frontendSourceFiles(path);
    return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
  });
}

/** Paths in messages and in `exempt` are relative to `base`. */
function frontendTimestampProblems(
  directory: string,
  base: string,
  exempt: typeof FRONTEND_EXEMPT,
): string[] {
  const problems: string[] = [];
  const used = new Set<(typeof FRONTEND_EXEMPT)[number]>();

  for (const path of frontendSourceFiles(directory)) {
    const file = relative(base, path);
    for (const property of timestampProperties(
      readFileSync(path, "utf8"),
      path,
    )) {
      if (!property.base.split(" | ").includes("string")) continue;
      const entry = exempt.find(
        (candidate) =>
          candidate.file === file && candidate.field === property.name,
      );
      if (entry) {
        used.add(entry);
        continue;
      }
      const declaredAs = property.nullable
        ? `${property.base} | null`
        : property.base;
      problems.push(
        `${file}:${property.line} declares ${property.name} as ${declaredAs}, but the API sends every timestamp as a number of milliseconds`,
      );
    }
  }

  for (const entry of exempt) {
    if (!used.has(entry)) {
      problems.push(
        `The exemption for ${entry.file} ${entry.field} matches no string declaration`,
      );
    }
  }
  return problems;
}

describe("timestamp types match their columns", () => {
  const declared = readDeclaredFields(TYPES_SRC);
  const columns = schemaColumns(readFileSync(SCHEMA, "utf8"));

  it("declares every *_at field the way its column is stored", () => {
    expect(timestampMismatches(TYPE_TABLES, declared, columns).join("\n")).toBe(
      "",
    );
  });

  it("finds the types and the tables it checks", () => {
    expect(declared.size).toBeGreaterThan(0);
    expect(columns.size).toBeGreaterThan(0);
  });

  describe("the check itself", () => {
    const columnsOf = (sql: string) => schemaColumns(sql);
    const schema = [
      "CREATE TABLE IF NOT EXISTS events (",
      "    id TEXT PRIMARY KEY,",
      "    seen_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),",
      "    sent_at INTEGER,",
      "    logged_at TEXT NOT NULL DEFAULT (datetime('now')),",
      "    -- checked_at INTEGER is a comment",
      "    PRIMARY KEY (id)",
      ");",
    ].join("\n");
    const pairs = [{ type: "Event", table: "events" }];

    function check(source: string, list = pairs): string[] {
      return timestampMismatches(
        list,
        declaredTimestampFields(source, "x.ts"),
        columnsOf(schema),
      );
    }

    it("reads the columns of a table and skips comments", () => {
      const eventColumns = columnsOf(schema).get("events");
      expect(eventColumns?.get("seen_at")).toBe("INTEGER");
      expect(eventColumns?.get("logged_at")).toBe("TEXT");
      expect(eventColumns?.has("checked_at")).toBe(false);
    });

    it("accepts number for INTEGER and string for TEXT, nullable or not", () => {
      expect(
        check(
          "type Event = { seen_at: number; sent_at: number | null; logged_at: string };",
        ),
      ).toEqual([]);
      expect(
        check(
          "type Event = { seen_at: number | null; logged_at: string | null };",
        ),
      ).toEqual([]);
    });

    it("names the type and field declared string over an INTEGER column", () => {
      expect(check("type Event = { seen_at: string };")).toEqual([
        "Event.seen_at is declared string, but events.seen_at is INTEGER, so it should be number",
      ]);
    });

    it("names the type and field declared number over a TEXT column", () => {
      expect(check("type Event = { logged_at: number | null };")).toEqual([
        "Event.logged_at is declared number | null, but events.logged_at is TEXT, so it should be string",
      ]);
    });

    it("names a type with a *_at field that is missing from the list", () => {
      expect(
        check(
          "type Event = { seen_at: number }; type Extra = { born_at: number };",
        ),
      ).toEqual([
        "Extra.born_at is declared in packages/types, but Extra is not in the list that pairs each type with its table",
      ]);
    });

    it("reads an interface and a string-literal property name", () => {
      expect(
        check('interface Event { "seen_at": string; sent_at: string }'),
      ).toEqual([
        "Event.seen_at is declared string, but events.seen_at is INTEGER, so it should be number",
        "Event.sent_at is declared string, but events.sent_at is INTEGER, so it should be number",
      ]);
    });

    it("reads a field that comes in through an intersection member", () => {
      expect(
        check(
          "type Event = Base & { seen_at: string }; type Extra = Base & { born_at: number };",
        ),
      ).toEqual([
        "Extra.born_at is declared in packages/types, but Extra is not in the list that pairs each type with its table",
        "Event.seen_at is declared string, but events.seen_at is INTEGER, so it should be number",
      ]);
    });

    it("reads a field that comes in through a union member", () => {
      expect(
        check("type Event = { id: string } | { sent_at: string };"),
      ).toEqual([
        "Event.sent_at is declared string, but events.sent_at is INTEGER, so it should be number",
      ]);
    });

    it("reads a field inside a nested object type", () => {
      expect(
        check("type Event = { seen_at: number; meta: { logged_at: number } };"),
      ).toEqual([
        "Event.logged_at is declared number, but events.logged_at is TEXT, so it should be string",
      ]);
    });

    it("keeps two declarations of the same field apart", () => {
      expect(
        check("type Event = { seen_at: number } & { seen_at: string };"),
      ).toEqual([
        "Event.seen_at is declared string, but events.seen_at is INTEGER, so it should be number",
      ]);
    });

    it("reads files in nested directories", () => {
      const root = mkdtempSync(join(tmpdir(), "timestamp-guard-"));
      try {
        mkdirSync(join(root, "nested", "deeper"), { recursive: true });
        writeFileSync(
          join(root, "event.ts"),
          "export type Event = { seen_at: number };",
        );
        writeFileSync(
          join(root, "nested", "deeper", "extra.ts"),
          "export type Extra = { born_at: number };",
        );

        expect(
          timestampMismatches(
            pairs,
            readDeclaredFields(root),
            columnsOf(schema),
          ),
        ).toEqual([
          "Extra.born_at is declared in packages/types, but Extra is not in the list that pairs each type with its table",
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("names a field with no column", () => {
      expect(check("type Event = { missing_at: number };")).toEqual([
        "Event.missing_at has no column events.missing_at in schema.sql",
      ]);
    });

    it("names a listed type that declares no *_at field, and a table that does not exist", () => {
      expect(check("type Event = { id: string };")).toEqual([
        "The list pairs Event with events, but Event declares no *_at field in packages/types",
      ]);
      expect(
        check("type Event = { seen_at: number };", [
          { type: "Event", table: "gone" },
        ]),
      ).toEqual([
        "The list pairs Event with gone, which schema.sql does not create",
      ]);
    });
  });
});

describe("frontend timestamp declarations", () => {
  it("declares no *_at property as a string", () => {
    expect(
      frontendTimestampProblems(FRONTEND_SRC, REPO_ROOT, FRONTEND_EXEMPT).join(
        "\n",
      ),
    ).toBe("");
  });

  it("finds the frontend files it checks", () => {
    expect(frontendSourceFiles(FRONTEND_SRC).length).toBeGreaterThan(0);
  });

  describe("the check itself", () => {
    function check(
      files: Record<string, string>,
      exempt: typeof FRONTEND_EXEMPT = [],
    ) {
      const root = mkdtempSync(join(tmpdir(), "frontend-timestamps-"));
      try {
        for (const [name, source] of Object.entries(files)) {
          mkdirSync(join(root, name, ".."), { recursive: true });
          writeFileSync(join(root, name), source);
        }
        return frontendTimestampProblems(root, root, exempt);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    const message = (
      file: string,
      line: number,
      field: string,
      declaredAs: string,
    ) =>
      `${file}:${line} declares ${field} as ${declaredAs}, but the API sends every timestamp as a number of milliseconds`;

    it("names the file, line and field of a string in a .ts file", () => {
      expect(
        check({
          "lib/api.ts":
            "export type Row = {\n  id: string;\n  created_at: string;\n};",
        }),
      ).toEqual([message("lib/api.ts", 3, "created_at", "string")]);
    });

    it("reads the script blocks of a .svelte file and counts lines from the top of the file", () => {
      const source = [
        "<div>",
        "  hello",
        "</div>",
        '<script lang="ts">',
        "  type Row = { id: string;",
        "    updated_at: string | null };",
        "</script>",
      ].join("\n");
      expect(check({ "routes/page.svelte": source })).toEqual([
        message("routes/page.svelte", 6, "updated_at", "string | null"),
      ]);
    });

    it("reads a property in an inline type and a class", () => {
      expect(
        check({
          "a.ts": "const rows = await get<{ rows: { seen_at: string }[] }>();",
          "b.ts": "class Row { sent_at: string = ''; }",
        }).sort(),
      ).toEqual([
        message("a.ts", 1, "seen_at", "string"),
        message("b.ts", 1, "sent_at", "string"),
      ]);
    });

    it("accepts number, number | null, and properties that are not timestamps", () => {
      expect(
        check({
          "a.ts":
            "type Row = { created_at: number; published_at: number | null; name: string; format: string };",
          "b.svelte": "<script>let x = 1;</script><p>created_at: string</p>",
        }),
      ).toEqual([]);
    });

    it("skips an exempt property and fails an exemption that matches nothing", () => {
      const files = { "a.ts": "type Row = { legacy_at: string };" };
      const exempt = [{ file: "a.ts", field: "legacy_at", reason: "test" }];
      expect(check(files, exempt)).toEqual([]);
      expect(
        check({ "a.ts": "type Row = { legacy_at: number };" }, exempt),
      ).toEqual([
        "The exemption for a.ts legacy_at matches no string declaration",
      ]);
    });
  });
});
