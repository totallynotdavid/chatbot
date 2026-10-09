import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "generate-token.ts");

function run(...args: string[]) {
  const proc = Bun.spawnSync(["bun", SCRIPT, ...args]);
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
}

describe("scripts/generate-token.ts", () => {
  test.each([
    ["webhook", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", 32],
    ["secrets", "SECRETS_KEY", 32],
  ])("%s prints %s with %d random bytes", (preset, variable, bytes) => {
    const { code, out } = run(preset);

    expect(code).toBe(0);
    const line = out.split("\n").find((l) => l.startsWith(`${variable}=`));
    const token = line?.match(/^[A-Z_]+="(.+)"$/)?.[1];
    expect(Buffer.from(token ?? "", "base64url")).toHaveLength(bytes);
  });

  test("no argument prints the webhook verify token", () => {
    expect(run().out).toContain('WHATSAPP_WEBHOOK_VERIFY_TOKEN="');
  });

  test.each(["session", "api", "jwt"])(
    "%s is no longer a preset: the usage message is printed",
    (name) => {
      const { code, out, err } = run(name);

      expect(code).toBe(1);
      expect(err).toContain("Length must be a number");
      expect(out).not.toMatch(/SESSION_SECRET|API_KEY|JWT_SECRET/);
      expect(out).not.toContain(`generate-token.ts ${name} `);
    },
  );
});
