#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TUNNEL_FILE = resolve(import.meta.dir, "../.cloudflare-url");
const TARGET_URL = "http://localhost:5173";

console.log("Starting cloudflared tunnel...");

const tunnel = spawn("cloudflared", ["tunnel", "--url", TARGET_URL], {
  stdio: ["ignore", "pipe", "pipe"],
});

let urlCaptured = false;

const handleOutput = (data: Buffer) => {
  const output = data.toString();

  if (!urlCaptured) {
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      const url = match[0];
      writeFileSync(TUNNEL_FILE, url, "utf-8");
      console.log(`\nURL captured: ${url}\nSaved to .cloudflare-url\n`);
      urlCaptured = true;
    }
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

tunnel.on("close", (code) => {
  console.log(`Process exited with code ${code}`);
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  tunnel.kill();
});

process.on("SIGTERM", () => {
  tunnel.kill();
});
