/**
 * The bun that CI installs from mise.toml has the same major and minor version
 * as the `@types/bun` range in the root package.json that types the code.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

/** The major and minor version at the start of a pin or a range, or null when it has none. */
function majorMinor(spec: string): string | null {
  const match = spec.trim().match(/^[\^~=v]*(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

/** The `bun` entry of the `[tools]` table, which is a version string or a table with a `version`. */
function miseBunPin(miseToml: string): string {
  const tools = (
    Bun.TOML.parse(miseToml) as { tools?: Record<string, unknown> }
  ).tools;
  const pin = tools?.bun;
  const version =
    typeof pin === "object" && pin !== null
      ? (pin as { version?: unknown }).version
      : pin;
  if (typeof version !== "string") {
    throw new Error("mise.toml has no version string for bun under [tools]");
  }
  return version;
}

function typesBunRange(manifest: string): string {
  const range = JSON.parse(manifest).devDependencies?.["@types/bun"];
  if (typeof range !== "string") {
    throw new Error("package.json has no @types/bun in devDependencies");
  }
  return range;
}

/** The mismatch between a mise bun pin and an @types/bun range, or null when they agree. */
function bunPinDrift(pin: string, range: string): string | null {
  const pinned = majorMinor(pin);
  const typed = majorMinor(range);
  if (pinned === null) {
    throw new Error(`The bun pin "${pin}" in mise.toml has no major.minor`);
  }
  if (typed === null) {
    throw new Error(`The @types/bun range "${range}" has no major.minor`);
  }
  if (pinned === typed) return null;
  return `mise.toml pins bun ${pin} (${pinned}) but package.json asks for @types/bun ${range} (${typed}). Move them to the same major.minor.`;
}

describe("toolchain pins", () => {
  const pin = miseBunPin(readFileSync(join(ROOT, "mise.toml"), "utf8"));
  const range = typesBunRange(readFileSync(join(ROOT, "package.json"), "utf8"));

  it("keeps the mise bun pin on the major.minor of @types/bun", () => {
    expect(bunPinDrift(pin, range) ?? "").toBe("");
  });

  describe("the check itself", () => {
    it("passes when the pin sits inside the range's major.minor", () => {
      expect(bunPinDrift("1.4.2", "^1.4.1")).toBeNull();
      expect(bunPinDrift("1.4.0", "~1.4")).toBeNull();
    });

    it("names both values when the minor differs", () => {
      const drift = bunPinDrift("1.3.14", "^1.4.1");
      expect(drift).toContain("1.3.14");
      expect(drift).toContain("^1.4.1");
    });

    it("names both values when the major differs", () => {
      const drift = bunPinDrift("2.0.0", "^1.4.1");
      expect(drift).toContain("2.0.0");
      expect(drift).toContain("^1.4.1");
    });

    it("rejects a pin or a range it cannot read", () => {
      expect(() => bunPinDrift("latest", "^1.4.1")).toThrow('"latest"');
      expect(() => bunPinDrift("1.4.2", "*")).toThrow('"*"');
    });

    it("reads a bun pin written as a table", () => {
      expect(miseBunPin('[tools]\nbun = { version = "1.4.2" }\n')).toBe(
        "1.4.2",
      );
    });

    it("rejects a mise.toml without a bun pin", () => {
      expect(() => miseBunPin('[tools]\nbiome = "2.5.14"\n')).toThrow("bun");
    });
  });
});
