/**
 * A guard against the other mistake this branch keeps making.
 *
 * "Uploaded bytes go where lib/storage-paths.ts says they go" is the invariant.
 * In production UPLOAD_DIR is a persistent volume and the working directory is
 * replaced on every restart or redeploy, so a path built from `process.cwd()`
 * or written out as a literal under `data/uploads` puts files where they cannot
 * survive one - while the `assets` rows naming them do survive, leaving the
 * database pointing at bytes that are gone.
 *
 * Round 12 found it in `adapters/storage/private-files.ts` and centralised the
 * roots. Round 13 found the identical bug still sitting in two sibling files
 * the first sweep had read past: `adapters/storage/images.ts` and the static
 * mount in `index.ts`. Three files, two rounds, one shape - and both rounds
 * found it by reading the diff, which is exactly the method that missed it the
 * first time.
 *
 * So it is checked mechanically here, as part of `bun test`. Three rules:
 *
 *   1. Nobody joins a storage path onto `process.cwd()`.
 *   2. Nobody writes an uploads or private directory out as a string literal.
 *   3. Nobody reads UPLOAD_DIR or PRIVATE_DIR from the environment except the
 *      module whose job is to resolve them - the fastest way back to two
 *      diverging roots is two files deriving them independently.
 *
 * Round 14 then found a fourth and fifth instance in `tests/` - cleanup in
 * `private-assets.test.ts` and `uploads.test.ts` deleting
 * `<cwd>/data/private/<tenant>`, and `migration.test.ts` reading migrated bytes
 * back from the same place - none of which this guard could see, because its
 * first version walked `src` and nothing else. The blind spot was the guard's
 * own scope: written to stop the next instance being found by hand, it excluded
 * the tree the next instance was in.
 *
 * A test is not exempt from the invariant, it is where the invariant is most
 * easily broken unnoticed: those three lines were correct only while
 * PRIVATE_DIR happened to be unset, and setting it - the override this branch
 * documents and supports - turned them into a cleanup that deletes the wrong
 * directory and assertions that read an empty one. So both trees are scanned.
 *
 * The last test in this file checks the checkers. A grep-based guard whose
 * patterns quietly stop matching passes forever while protecting nothing, so
 * the detectors are run against the shapes actually found, in the form they
 * were found in.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const BACKEND = join(import.meta.dir, "..");

/** Both trees. A test breaks this invariant as easily as a source file does. */
const SCANNED = [join(BACKEND, "src"), join(BACKEND, "tests")];

/**
 * The three files that write the roots out by their very purpose, excluded
 * wholesale rather than line by line. The count is checked below, so renaming
 * one fails loudly instead of quietly turning this into an exclusion of
 * nothing.
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
 * Paths built from the working directory on purpose. An exemption names the
 * *expression*, not the file, so exempting one line leaves every other line in
 * that file checked - reading past the rest of an already-open file is how the
 * first sweep missed two instances, and scoping past a whole tree is how the
 * guard itself missed three more.
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

/**
 * The file with its comments blanked out.
 *
 * This codebase explains itself at length, and several of those explanations
 * are about this very bug - `index.ts` names the literal it no longer uses, and
 * migrations.ts describes the `data/contracts/<phone>/` layout it migrates
 * away from. Matching prose would make the guard fire on the comment that
 * documents the fix, and the obvious way to quiet it is to delete the comment.
 *
 * String literals are matched *before* comment openers, so a `//` inside a
 * string is consumed as part of that string rather than read as the start of a
 * comment. Newlines inside a stripped comment are kept, so reported line
 * numbers still point at the real line.
 */
function codeOnly(text: string): string {
  const TOKENS =
    /("(?:[^"\\\n]|\\.)*")|('(?:[^'\\\n]|\\.)*')|(`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g;

  return text.replace(TOKENS, (_match, dq, sq, tpl, comment) => {
    if (comment !== undefined) return comment.replace(/[^\n]/g, " ");
    return dq ?? sq ?? tpl;
  });
}

type Finding = { file: string; line: number; detail: string };

/**
 * Every match of `pattern` in the file's code, reported as the source line it
 * sits on. The line rather than the match itself: it is what a reader has to
 * look at anyway, and it is stable under a pattern that stops at the first
 * string argument, which an exemption has to be matched against.
 */
function scan(text: string, file: string, pattern: RegExp): Finding[] {
  const code = codeOnly(text);
  const lines = text.split("\n");
  const global = new RegExp(pattern.source, "g");

  return [...code.matchAll(global)].map((match) => {
    const line = code.slice(0, match.index).split("\n").length;
    return { file, line, detail: (lines[line - 1] ?? "").trim().slice(0, 100) };
  });
}

// ---------------------------------------------------------------------------
// Rule 1: no storage path joined onto the working directory.
// ---------------------------------------------------------------------------

/**
 * `path.join(process.cwd(), "data", ...)` and every spelling of it - bare
 * `join`/`resolve` off a named import, or qualified through any import name.
 * The discriminator is a `process.cwd()` first argument followed by a string
 * literal: that is a path being built out of the one directory that does not
 * survive a redeploy. `path.join(process.cwd(), someVariable)` is left alone.
 */
const CWD_JOIN =
  /(?:\w+\.)?(?:join|resolve)\(\s*process\.cwd\(\)\s*,\s*(["'`])[^"'`]+\1/;

// ---------------------------------------------------------------------------
// Rule 2: no uploads or private directory written out as a literal.
// ---------------------------------------------------------------------------

/**
 * A string literal naming one of the storage directories directly -
 * `"./data/uploads/images"`, `'data/private'`, `` `data/contracts/${x}` ``.
 * Anchored on the `data/` segment because that is what makes it a root rather
 * than a key: `"images/abc.jpg"` is a storage key and belongs in the source,
 * `"data/uploads/images"` is a root and belongs in storage-paths.ts.
 */
const LITERAL_ROOT =
  /(["'`])(?:\.{0,2}\/)?data\/(?:uploads|private|contracts)[^"'`]*\1/;

// ---------------------------------------------------------------------------
// Rule 3: the roots are read from the environment in exactly one place.
// ---------------------------------------------------------------------------

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

  /** An exemption covers a finding when it names that file and that line. */
  const covers = (exempt: (typeof EXEMPT)[number], f: Finding) =>
    f.file.endsWith(exempt.file) && f.detail.includes(exempt.snippet);

  /**
   * Every finding for one rule, split into the exemptions that no longer match
   * anything and the findings no exemption covers.
   *
   * A stale exemption is as bad as a missing one: it reads like a considered
   * decision while covering nothing, and the next one gets added beside it.
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
    // Both trees, which is the scope bug this guard had of its own: it walked
    // src and missed three instances sitting in tests.
    expect(files.some((f) => f.includes(`${sep}src${sep}`))).toBe(true);
    expect(files.some((f) => f.includes(`${sep}tests${sep}`))).toBe(true);
  });

  it("still finds the files it exempts wholesale", () => {
    // If either is renamed, the rules fail on it rather than passing because
    // the filter silently stopped excluding anything.
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
   * The guard guards itself. A regex that quietly stops matching - a rename, a
   * reformat, a stray escape - turns this whole file into a no-op that passes
   * forever, which is worse than having no guard at all, because it reads like
   * coverage. These are the three instances the last two review rounds actually
   * found, in the form they were found in.
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
      // The line, not the match, and the right one of six.
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
      // `assets` row; they are resolved against a root and must stay.
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
        // The stripper matches strings first, so the `//` here stays inside the
        // string it belongs to and the assignment after it is still read.
        const sample =
          "const docs = 'https://example.test/x'; const root = './data/private';";

        expect(scan(sample, "sample.ts", LITERAL_ROOT)).toHaveLength(1);
      });
    });
  });
});
