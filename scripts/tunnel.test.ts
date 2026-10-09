import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_PRINTED = "https://fake-tunnel-example.trycloudflare.com";

// This fake prints the quick-tunnel banner and runs until the test creates the
// stop file.
const FAKE_CLOUDFLARED = `#!/bin/bash
if [ "$1" = "--version" ]; then echo "cloudflared fake"; exit 0; fi
echo "INF |  ${URL_PRINTED}  |" >&2
while [ ! -e "$FAKE_STOP_FILE" ]; do sleep 0.05; done
exit 0
`;

const cloudflaredRunning =
  Bun.spawnSync(["pgrep", "cloudflared"]).exitCode === 0;

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

// Run a copy under a temporary root because the script resolves
// `.cloudflare-url` relative to its own location.
describe.skipIf(cloudflaredRunning)("scripts/tunnel.ts start", () => {
  let root: string;
  let tunnelFile: string;
  let stopFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tunnel-test-"));
    tunnelFile = join(root, ".cloudflare-url");
    stopFile = join(root, "stop");

    mkdirSync(join(root, "scripts"));
    copyFileSync(
      join(import.meta.dir, "tunnel.ts"),
      join(root, "scripts", "tunnel.ts"),
    );

    mkdirSync(join(root, "bin"));
    const fake = join(root, "bin", "cloudflared");
    writeFileSync(fake, FAKE_CLOUDFLARED);
    chmodSync(fake, 0o755);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function startTunnel() {
    return Bun.spawn(["bun", join(root, "scripts", "tunnel.ts"), "start"], {
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        FAKE_STOP_FILE: stopFile,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  async function startUntilUrlSaved() {
    const proc = startTunnel();
    await until(() => existsSync(tunnelFile), ".cloudflare-url to be written");
    expect(readFileSync(tunnelFile, "utf-8")).toBe(URL_PRINTED);
    return proc;
  }

  test("removes .cloudflare-url when the tunnel exits on its own", async () => {
    const proc = await startUntilUrlSaved();

    writeFileSync(stopFile, "");
    await proc.exited;

    expect(existsSync(tunnelFile)).toBe(false);
  });

  test.each(["SIGINT", "SIGTERM"] as const)(
    "removes .cloudflare-url on %s",
    async (signal) => {
      const proc = await startUntilUrlSaved();

      proc.kill(signal);
      await proc.exited;

      expect(existsSync(tunnelFile)).toBe(false);
    },
  );

  test("removes a .cloudflare-url left by an earlier crash once a new tunnel exits", async () => {
    writeFileSync(tunnelFile, "https://stale.trycloudflare.com");
    const proc = startTunnel();
    await until(
      () => readFileSync(tunnelFile, "utf-8") === URL_PRINTED,
      "the new URL to replace the stale one",
    );

    writeFileSync(stopFile, "");
    await proc.exited;

    expect(existsSync(tunnelFile)).toBe(false);
  });
});
