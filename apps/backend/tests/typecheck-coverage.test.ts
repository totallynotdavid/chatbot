/**
 * Every workspace with TypeScript has a tsconfig.json, and every tsconfig.json
 * has an entry in the `typecheck` matrix of .github/workflows/ci.yml.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "ci.yml");

const NOT_SOURCE = new Set(["node_modules", "dist", "build", ".svelte-kit"]);

/** A workspace listed here needs no tsconfig.json and no matrix entry, and must have no TypeScript sources. */
const EXEMPT: Record<string, string> = {
  "packages/tsconfig":
    "holds the shared tsconfig JSON files that the other workspaces extend, and no TypeScript",
};

interface Workspace {
  dir: string;
  hasTypeScript: boolean;
  hasTsconfig: boolean;
}

/** Expands the `<dir>/*` patterns in the root package.json, the only form it uses. */
function workspaceDirs(root: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dirs: string[] = [];
  for (const pattern of manifest.workspaces as string[]) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspaces pattern "${pattern}"`);
    }
    const parent = pattern.slice(0, -2);
    for (const entry of readdirSync(join(root, parent), {
      withFileTypes: true,
    })) {
      const dir = `${parent}/${entry.name}`;
      if (entry.isDirectory() && existsSync(join(root, dir, "package.json"))) {
        dirs.push(dir);
      }
    }
  }
  return dirs.sort();
}

function hasTypeScript(directory: string): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (NOT_SOURCE.has(entry.name)) continue;
      if (hasTypeScript(join(directory, entry.name))) return true;
    } else if (/\.tsx?$/.test(entry.name)) {
      return true;
    }
  }
  return false;
}

function describeWorkspace(root: string, dir: string): Workspace {
  return {
    dir,
    hasTypeScript: hasTypeScript(join(root, dir)),
    hasTsconfig: existsSync(join(root, dir, "tsconfig.json")),
  };
}

/** The `directory:` values inside the `typecheck` job of a workflow file. */
function matrixDirectories(workflow: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.indexOf("  typecheck:");
  if (start === -1) throw new Error("The workflow has no typecheck job");

  const dirs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The next job or top-level key ends the typecheck job.
    if (/^ {0,2}\S/.test(line)) break;
    const match = line.match(/^\s+(?:-\s+)?directory:\s*["']?([^"'\s#]+)/);
    if (match?.[1]) dirs.push(match[1]);
  }
  return dirs;
}

function typecheckGaps(
  workspaces: Workspace[],
  matrixDirs: string[],
  exempt: Record<string, string>,
): string[] {
  const gaps: string[] = [];
  for (const workspace of workspaces) {
    if (Object.hasOwn(exempt, workspace.dir)) continue;
    if (workspace.hasTypeScript && !workspace.hasTsconfig) {
      gaps.push(`${workspace.dir} has TypeScript sources but no tsconfig.json`);
    }
    if (workspace.hasTsconfig && !matrixDirs.includes(workspace.dir)) {
      gaps.push(
        `${workspace.dir} has a tsconfig.json but no "directory: ${workspace.dir}" entry in the typecheck matrix of .github/workflows/ci.yml`,
      );
    }
  }
  return gaps;
}

describe("typecheck coverage", () => {
  const workspaces = workspaceDirs(ROOT).map((dir) =>
    describeWorkspace(ROOT, dir),
  );
  const matrixDirs = matrixDirectories(readFileSync(WORKFLOW, "utf8"));

  it("typechecks every workspace that has TypeScript in CI", () => {
    expect(typecheckGaps(workspaces, matrixDirs, EXEMPT).join("\n")).toBe("");
  });

  it("finds the workspaces and the matrix it checks", () => {
    expect(workspaces.length).toBeGreaterThan(0);
    expect(matrixDirs.length).toBeGreaterThan(0);
  });

  it("keeps every exemption honest", () => {
    for (const dir of Object.keys(EXEMPT)) {
      const workspace = workspaces.find((candidate) => candidate.dir === dir);
      expect(
        workspace,
        `${dir} is exempt but is not a workspace`,
      ).toBeDefined();
      expect(
        workspace?.hasTypeScript,
        `${dir} is exempt but has TypeScript sources`,
      ).toBe(false);
    }
  });

  describe("the check itself", () => {
    const covered: Workspace = {
      dir: "packages/covered",
      hasTypeScript: true,
      hasTsconfig: true,
    };

    it("passes a workspace with a tsconfig.json and a matrix entry", () => {
      expect(typecheckGaps([covered], [covered.dir], {})).toEqual([]);
    });

    it("names a workspace with TypeScript and no tsconfig.json", () => {
      const gaps = typecheckGaps(
        [{ ...covered, dir: "apps/bare", hasTsconfig: false }],
        [],
        {},
      );
      expect(gaps).toEqual([
        "apps/bare has TypeScript sources but no tsconfig.json",
      ]);
    });

    it("names a workspace with a tsconfig.json and no matrix entry", () => {
      const gaps = typecheckGaps([covered], ["packages/other"], {});
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toContain("packages/covered");
      expect(gaps[0]).toContain("typecheck matrix");
    });

    it("skips an exempt workspace", () => {
      const bare = { ...covered, hasTsconfig: false };
      expect(typecheckGaps([bare], [], { [bare.dir]: "reason" })).toEqual([]);
    });

    it("reads only the typecheck job's matrix directories", () => {
      const workflow = [
        "jobs:",
        "  typecheck:",
        "    strategy:",
        "      matrix:",
        "        include:",
        "          - name: one",
        "            directory: apps/one",
        "          - directory: 'packages/two'",
        "    steps:",
        "      - run: bunx tsc --noEmit",
        "        working-directory: ${{ matrix.directory }}",
        "",
        "  test:",
        "    steps:",
        "      - run: bun test",
        "        directory: apps/not-a-matrix-entry",
      ].join("\n");
      expect(matrixDirectories(workflow)).toEqual(["apps/one", "packages/two"]);
    });
  });
});
