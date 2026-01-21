import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TUNNEL_FILE = resolve(import.meta.dir, "../.cloudflare-url");
const TARGET_URL = process.env.TUNNEL_TARGET_URL || "http://localhost:5173";
const URL_CAPTURE_TIMEOUT = 30000;

const isWindows = process.platform === "win32";
const CLOUDFLARED = isWindows ? "cloudflared.exe" : "cloudflared";

function isCloudflaredRunning(): boolean {
  if (isWindows) {
    const result = spawnSync(
      "tasklist",
      ["/FI", `IMAGENAME eq ${CLOUDFLARED}`, "/NH"],
      {
        encoding: "utf8",
      },
    );
    return result.status === 0 && result.stdout.includes(CLOUDFLARED);
  }

  const result = spawnSync("pgrep", ["cloudflared"]);
  return result.status === 0;
}

function validateCloudflared(): void {
  const result = spawnSync(CLOUDFLARED, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "cloudflared not found in PATH. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/",
    );
  }
}

function extractTunnelUrl(output: string): string | null {
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0] : null;
}

function startTunnel(): void {
  console.log("Starting cloudflared tunnel...");

  if (isCloudflaredRunning()) {
    console.log("Tunnel already running");
    process.exit(0);
  }

  validateCloudflared();

  const tunnel = spawn(CLOUDFLARED, ["tunnel", "--url", TARGET_URL], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let urlCaptured = false;

  const timeout = setTimeout(() => {
    if (!urlCaptured) {
      console.error(
        `Failed to capture tunnel URL within ${URL_CAPTURE_TIMEOUT}ms`,
      );
      tunnel.kill();
      process.exit(1);
    }
  }, URL_CAPTURE_TIMEOUT);

  const handleOutput = (data: Buffer) => {
    if (urlCaptured) return;

    const url = extractTunnelUrl(data.toString());
    if (url) {
      urlCaptured = true;
      clearTimeout(timeout);
      writeFileSync(TUNNEL_FILE, url, "utf-8");
      console.log(`\nTunnel URL: ${url}\nSaved to ${TUNNEL_FILE}\n`);
    }
  };

  tunnel.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(data);
    handleOutput(data);
  });

  tunnel.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(data);
    handleOutput(data);
  });

  tunnel.on("error", (err) => {
    clearTimeout(timeout);
    console.error("Failed to start tunnel:", err.message);
    process.exit(1);
  });

  tunnel.on("close", (code) => {
    clearTimeout(timeout);
    console.log(`Tunnel exited with code ${code ?? 0}`);
    process.exit(code ?? 0);
  });

  const cleanup = () => {
    clearTimeout(timeout);
    tunnel.kill();
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function stopTunnel(): void {
  console.log("Stopping cloudflared tunnel...");

  const killProcess = isWindows
    ? spawn("taskkill", ["/IM", CLOUDFLARED, "/F"], { stdio: "inherit" })
    : spawn("pkill", ["cloudflared"], { stdio: "inherit" });

  killProcess.on("error", (err) => {
    console.error("Failed to stop tunnel:", err.message);
    process.exit(1);
  });

  killProcess.on("close", (code) => {
    if (code === 0) console.log("Tunnel stopped");

    if (existsSync(TUNNEL_FILE)) {
      try {
        unlinkSync(TUNNEL_FILE);
        console.log("Cleaned up tunnel file");
      } catch (err) {
        console.warn("Could not remove tunnel file:", (err as Error).message);
      }
    }
  });
}

function showHelp(): void {
  console.log("Usage: bun run scripts/tunnel.ts <command>");
  console.log("");
  console.log("Commands:");
  console.log("  start    Start the cloudflared tunnel");
  console.log("  stop     Stop the cloudflared tunnel");
  console.log("");
  console.log("Environment:");
  console.log(
    "  TUNNEL_TARGET_URL    Target URL (default: http://localhost:5173)",
  );
}

function main(): void {
  const command = process.argv[2];

  try {
    if (command === "start") {
      startTunnel();
    } else if (command === "stop") {
      stopTunnel();
    } else {
      showHelp();
      process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(1);
  }
}

main();
