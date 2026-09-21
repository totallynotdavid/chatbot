/**
 * Uploaded bytes go where lib/storage-paths.ts says they go.
 *
 * In production UPLOAD_DIR is a persistent volume, and the working directory is
 * replaced on every redeploy. A path built from `process.cwd()`, or
 * written out as a literal under `data/uploads`, puts files where they cannot
 * survive. The `assets` rows naming them do survive, so the database would
 * point at bytes that are gone.
 *
 * Three rules, checked over both `src` and `tests`:
 *
 *   1. Nobody joins a storage path onto `process.cwd()`.
 *   2. Nobody writes an uploads or private directory out as a string literal.
 *   3. Nobody reads UPLOAD_DIR or PRIVATE_DIR from the environment except the
 *      module that resolves them. Two files deriving the roots independently
 *      lets the two roots diverge.
 *
 * Tests are scanned because a test that builds a path from `process.cwd()` is
 * correct only while PRIVATE_DIR is unset. Once PRIVATE_DIR is set, its cleanup
 * deletes the wrong directory and its assertions read an empty one.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { stripComments } from "./helpers/source-text.ts";

const BACKEND = join(import.meta.dir, "..");

/** Both trees. A test breaks this invariant as easily as a source file does. */
const SCANNED = [join(BACKEND, "src"), join(BACKEND, "tests")];

/**
 * These files write the roots out by design, so they are excluded whole rather
 * than line by line. Renaming one fails the "still finds the files it exempts
 * wholesale" test.
 */
const EXCLUDED: Array<{ file: string; reason: string }> = [
  {
    file: join("src", "lib", "storage-paths.ts"),
    reason: "defines the roots; it cannot import the constants it declares",
  },
  {
    file: join("tests", "storage-paths.test.ts"),
    reason:
      "pins the derivation down, which means naming what each root resolves " +
      "to - including the development default under the working directory",
  },
  {
    file: join("tests", "storage-path-guard.test.ts"),
    reason:
      "this file. Its patterns, its exemption snippets and its self-check " +
      "samples are all written-out instances of the anti-pattern, by " +
      "construction - matching them says nothing about the codebase",
  },
];

/**
 * Findings that are deliberate. An exemption names a file and an expression on
 * one of its lines, so every other line in that file is still checked.
 */
const EXEMPT: Array<{ file: string; snippet: string; reason: string }> = [
  {
    file: join("src", "db", "migrations.ts"),
    snippet: 'path.join(process.cwd(), "data")',
    reason:
      "legacyRoot in migrateRecordings() reads files the pre-tenancy app " +
      "wrote, and that app hardcoded resolve(process.cwd(), 'data', " +
      "'contracts', ...) - see the uploadContract it replaced. The source of " +
      "a one-time migration is wherever the old code actually put it; " +
      "UPLOAD_DIR would look in a directory those files were never in",
  },
  {
    file: join("tests", "migration.test.ts"),
    snippet: 'join(process.cwd(), "data")',
    reason:
      "legacyRoot, the same root migrations.ts reads and for the same reason: " +
      "this test writes the legacy files where the old application put them. " +
      "Its destination side is PRIVATE_DIR, which is the half that was wrong",
  },
  {
    file: join("tests", "test-database.test.ts"),
    snippet: 'path.resolve(process.cwd(), "data", "database.sqlite")',
    reason:
      "the default DB_PATH, named so the suite can assert it is NOT the " +
      "database being used. A different subsystem (db/connection.ts owns it) " +
      "and the point of the line is to name the real one and stay off it",
  },
  {
    file: join("tests", "setup.ts"),
    snippet: "process.env.UPLOAD_DIR",
    reason:
      "the test bootstrap points UPLOAD_DIR and PRIVATE_DIR at a temp " +
      "directory before anything reads them, exactly as it already does for " +
      "DB_PATH. Writing them here is what stops a crashed run touching the " +
      "tracked uploads directory",
  },
  {
    file: join("tests", "setup.ts"),
    snippet: "process.env.PRIVATE_DIR",
    reason: "the same bootstrap, for the private root",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });
}

/** Path as it reads in a failure message, relative to the backend root. */
function relative(file: string): string {
  return file.slice(BACKEND.length + 1);
}

type Finding = { file: string; line: number; detail: string };

/**
 * Every match of `pattern` in the file's code, reported as the source line it
 * sits on. An exemption matches against that line, because the pattern itself
 * can stop at the first string argument.
 */
function scan(text: string, file: string, pattern: RegExp): Finding[] {
  const code = stripComments(text);
  const lines = text.split("\n");
  const global = new RegExp(pattern.source, "g");

  return [...code.matchAll(global)].map((match) => {
    const line = code.slice(0, match.index).split("\n").length;
    return { file, line, detail: (lines[line - 1] ?? "").trim().slice(0, 100) };
  });
}

// Rule 1: no storage path joined onto the working directory.

/**
 * Matches `path.join(process.cwd(), "data", ...)`. It covers bare `join` and
 * `resolve`, and either one qualified by an identifier such as `path`. Only a
 * string literal after `process.cwd()` matches, because that builds a path out
 * of a directory that does not survive a redeploy.
 */
const CWD_JOIN =
  /(?:\w+\.)?(?:join|resolve)\(\s*process\.cwd\(\)\s*,\s*(["'`])[^"'`]+\1/;

// Rule 2: no uploads or private directory written out as a literal.

/**
 * Matches a string literal that names a storage directory, such as
 * `"./data/uploads/images"`, `'data/private'` or `` `data/contracts/${x}` ``.
 * The `data/` segment separates a root from a key: `"images/abc.jpg"` is a
 * storage key, and a root belongs in storage-paths.ts.
 */
const LITERAL_ROOT =
  /(["'`])(?:\.{0,2}\/)?data\/(?:uploads|private|contracts)[^"'`]*\1/;

// Rule 3: the roots are read from the environment in exactly one place.

const ENV_ROOT = /process\.env\.(?:UPLOAD_DIR|PRIVATE_DIR)\b/;

function report(findings: Finding[]): string {
  return findings
    .map((f) => `  ${relative(f.file)}:${f.line}\n      ${f.detail}`)
    .join("\n");
}

const ADVICE =
  "Import UPLOAD_DIR / IMAGES_DIR / PRIVATE_DIR from lib/storage-paths.ts " +
  "instead. A path built here is relative to the working directory, which in " +
  "production is ephemeral and is not the volume the files live on - the " +
  "bytes are lost on the next redeploy while the rows naming them survive.";

describe("storage path guard", () => {
  const files = SCANNED.flatMap(sourceFiles);
  const checked = files.filter(
    (file) => !EXCLUDED.some((excluded) => file.endsWith(excluded.file)),
  );

  /**
   * An exemption covers a finding when the finding's file ends with the
   * exemption's file and the finding's source line contains its snippet.
   */
  const covers = (exempt: (typeof EXEMPT)[number], f: Finding) =>
    f.file.endsWith(exempt.file) && f.detail.includes(exempt.snippet);

  /**
   * Every finding for one rule, the findings no exemption covers, and the
   * exemptions that cover at least one finding. An exemption missing from the
   * last list is stale, and reads like a considered decision while covering
   * nothing.
   */
  function check(pattern: RegExp) {
    const findings = checked.flatMap((file) =>
      scan(readFileSync(file, "utf-8"), file, pattern),
    );

    return {
      findings,
      remaining: findings.filter((f) => !EXEMPT.some((e) => covers(e, f))),
      covered: EXEMPT.filter((e) => findings.some((f) => covers(e, f))),
    };
  }

  it("finds backend sources and tests to check", () => {
    // If the walk breaks, all three rules below pass over nothing at all.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.includes(`${sep}src${sep}`))).toBe(true);
    expect(files.some((f) => f.includes(`${sep}tests${sep}`))).toBe(true);
  });

  it("still finds the files it exempts wholesale", () => {
    // A renamed exclusion fails here instead of leaving the filter excluding
    // nothing.
    expect(files.length - checked.length).toBe(EXCLUDED.length);
  });

  it("names no exemption that has stopped matching anything", () => {
    const seen = new Set(
      [CWD_JOIN, LITERAL_ROOT, ENV_ROOT].flatMap((pattern) =>
        check(pattern).covered.map((e) => `${e.file}::${e.snippet}`),
      ),
    );

    const unused = EXEMPT.filter(
      (e) => !seen.has(`${e.file}::${e.snippet}`),
    ).map((e) => `  ${e.file}: ${e.snippet}`);

    expect(
      unused.length === 0
        ? ""
        : "EXEMPT names expressions that no longer exist. Delete them:\n" +
            unused.join("\n"),
    ).toBe("");
  });

  it("joins no storage path onto the working directory", () => {
    const { remaining } = check(CWD_JOIN);

    expect(
      remaining.length === 0
        ? ""
        : `A storage path is built from process.cwd(). ${ADVICE}\n` +
            "If it is deliberately cwd-relative (reading what an older " +
            "version of this application wrote, or naming a real path in " +
            "order to stay off it), add it to EXEMPT with a reason:\n" +
            report(remaining),
    ).toBe("");
  });

  it("writes no uploads or private directory out as a literal", () => {
    const { remaining } = check(LITERAL_ROOT);

    expect(
      remaining.length === 0
        ? ""
        : `A storage root is written out as a string literal. ${ADVICE}\n` +
            report(remaining),
    ).toBe("");
  });

  it("reads UPLOAD_DIR and PRIVATE_DIR in one place only", () => {
    const { remaining } = check(ENV_ROOT);

    expect(
      remaining.length === 0
        ? ""
        : "UPLOAD_DIR / PRIVATE_DIR are read outside lib/storage-paths.ts. " +
            "Two modules deriving a root from the environment independently " +
            "is how they drift apart; import the resolved constant:\n" +
            report(remaining),
    ).toBe("");
  });

  /**
   * Runs each detector against sample code. A regex that quietly stops matching
   * after a rename, a reformat or a stray escape would let this file pass while
   * protecting nothing.
   */
  describe("catches the shapes it is meant to catch", () => {
    it("catches the private store's root (round 12)", () => {
      const sample = [
        "const PRIVATE_ROOT = path.join(process.cwd(), 'data', 'private');",
      ].join("\n");

      expect(scan(sample, "sample.ts", CWD_JOIN)).toHaveLength(1);
    });

    it("catches the image store's root (round 13)", () => {
      const sample =
        "const IMAGES_DIR = path.join(process.cwd(), 'data', 'uploads', 'images');";

      expect(scan(sample, "sample.ts", CWD_JOIN)).toHaveLength(1);
      // Rule 1 is the only one that can catch this one: the segments are
      // separate arguments, so there is no `data/uploads` literal to find.
      expect(scan(sample, "sample.ts", LITERAL_ROOT)).toHaveLength(0);
    });

    it("catches the static mount's root (round 13)", () => {
      const sample = [
        "app.use(",
        "  '/media/images/*',",
        "  serveStatic({",
        "    root: './data/uploads/images',",
        "  }),",
        ");",
      ].join("\n");

      const found = scan(sample, "sample.ts", LITERAL_ROOT);

      expect(found).toHaveLength(1);
      // The finding carries the line of the literal, not the `app.use(` line.
      expect(found[0]!.line).toBe(4);
    });

    it("catches a bare join and a resolve too", () => {
      expect(
        scan("mkdir(join(process.cwd(), 'data'))", "sample.ts", CWD_JOIN),
      ).toHaveLength(1);
      expect(
        scan(
          "resolve(process.cwd(), 'data', 'contracts', phoneNumber)",
          "sample.ts",
          CWD_JOIN,
        ),
      ).toHaveLength(1);
    });

    it("catches a second module deriving the root itself", () => {
      const sample = "const root = process.env.UPLOAD_DIR || './data/uploads';";

      expect(scan(sample, "sample.ts", ENV_ROOT)).toHaveLength(1);
    });

    it("passes the same code once it takes the constant", () => {
      const sample = [
        "import { IMAGES_DIR } from '../../lib/storage-paths.ts';",
        "const filePath = path.join(IMAGES_DIR, id + '.jpg');",
        "app.use('/media/images/*', serveStatic({ root: IMAGES_DIR }));",
      ].join("\n");

      for (const pattern of [CWD_JOIN, LITERAL_ROOT, ENV_ROOT]) {
        expect(scan(sample, "sample.ts", pattern)).toEqual([]);
      }
    });

    it("does not flag a storage key, which is not a root", () => {
      // `images/<id>.jpg` and the private prefix are keys recorded on the
      // `assets` row. They are resolved against a root, so they must not be
      // flagged.
      const sample = [
        "storageKey: 'images/abc123def4567890.jpg',",
        "const key = privateStorageKey(tenantId, 'contracts', name);",
      ].join("\n");

      expect(scan(sample, "sample.ts", LITERAL_ROOT)).toEqual([]);
    });

    it("does not flag an unrelated use of the working directory", () => {
      expect(
        scan("const config = path.join(process.cwd(), arg);", "s.ts", CWD_JOIN),
      ).toEqual([]);
    });

    describe("reading code and not prose", () => {
      it("ignores the shape when it appears in a comment", () => {
        const sample = [
          "// Was path.join(process.cwd(), 'data', 'uploads', 'images').",
          "/** Files used to live under `data/uploads/images`. */",
          "const IMAGES_DIR = resolved;",
        ].join("\n");

        expect(scan(sample, "sample.ts", CWD_JOIN)).toEqual([]);
        expect(scan(sample, "sample.ts", LITERAL_ROOT)).toEqual([]);
      });

      it("still reports the right line after a block comment", () => {
        const sample = [
          "/**",
          " * Two lines of prose about data/uploads.",
          " */",
          "const root = './data/uploads/images';",
        ].join("\n");

        const found = scan(sample, "sample.ts", LITERAL_ROOT);

        expect(found).toHaveLength(1);
        expect(found[0]!.line).toBe(4);
      });

      it("does not let a comment marker inside a string hide the code", () => {
        // The `//` here is inside a string, not a comment, so the assignment
        // after it is still read.
        const sample =
          "const docs = 'https://example.test/x'; const root = './data/private';";

        expect(scan(sample, "sample.ts", LITERAL_ROOT)).toHaveLength(1);
      });

      it("does not let a slash pair inside a regex hide the code", () => {
        // The `//` in `\\//` is an escaped slash and the slash that ends the
        // regex, not a comment.
        const sample =
          "const re = /^images\\//; const root = './data/private';";

        expect(scan(sample, "sample.ts", LITERAL_ROOT)).toHaveLength(1);
      });
    });
  });
});
