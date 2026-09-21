/// <reference types="bun" />

import { describe, it, expect } from "bun:test";
import { fileURLToPath } from "node:url";

/**
 * `{@html ...}` puts a string into the page as markup. Every value that string
 * carries has to be escaped by hand, and the dashboard shows names that other
 * people type (bundles, products, audit metadata). Render markup with a
 * snippet or an element instead: Svelte escapes every interpolation.
 *
 * A file listed here may keep a `{@html`. Give the file's path under `src` and
 * one line on why the string it renders never holds a stored value.
 */
const allowed: Record<string, string> = {};

const srcDir = fileURLToPath(new URL("..", import.meta.url));

describe("the frontend source", () => {
  it("renders no `{@html` outside the files listed above", async () => {
    const offenders: string[] = [];
    for await (const file of new Bun.Glob("**/*.svelte").scan(srcDir)) {
      const source = await Bun.file(`${srcDir}${file}`).text();
      if (/\{@html\b/.test(source) && !(file in allowed)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lists only files that still use `{@html`", async () => {
    for (const file of Object.keys(allowed)) {
      const source = await Bun.file(`${srcDir}${file}`).text();
      expect(source).toMatch(/\{@html\b/);
    }
  });
});
