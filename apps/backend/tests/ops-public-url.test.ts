/**
 * Alert links and the CORS origin name the deployment's public address. They
 * read `PUBLIC_URL`, and a tunnel file left behind by `dev:tunnel` decides
 * nothing in production.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import * as utils from "@vendeya/utils";
import { templates } from "../src/domains/notifications/templates.ts";

const TUNNEL = "https://quick-abc.trycloudflare.com";
const PRODUCTION_URL = "https://ventas.example.com";

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_URL: process.env.PUBLIC_URL,
};
const dirs: string[] = [];

function setEnv(nodeEnv: string, publicUrl: string | undefined) {
  process.env.NODE_ENV = nodeEnv;
  if (publicUrl === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = publicUrl;
}

function tunnelFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vendeya-tunnel-"));
  dirs.push(dir);
  const file = join(dir, ".cloudflare-url");
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("the public origin", () => {
  it("is PUBLIC_URL in production, whatever the tunnel file holds", () => {
    setEnv("production", PRODUCTION_URL);

    // A tunnel file outlives the tunnel, so a stale one must not win.
    expect(utils.publicOrigin(tunnelFile(TUNNEL))).toBe(PRODUCTION_URL);
  });

  it("is the tunnel in development, ahead of PUBLIC_URL", () => {
    // .env.example sets PUBLIC_URL=http://localhost:5173, which would otherwise
    // hide the tunnel Meta needs to reach.
    setEnv("development", "http://localhost:5173");

    expect(utils.publicOrigin(tunnelFile(`${TUNNEL}\n`))).toBe(TUNNEL);
  });

  it("is PUBLIC_URL in development when no tunnel is up", () => {
    setEnv("development", "http://192.168.1.20:5173");

    expect(utils.publicOrigin(tunnelFile(""))).toBe("http://192.168.1.20:5173");
  });

  it("falls back to localhost when PUBLIC_URL is unset or empty", () => {
    setEnv("production", undefined);
    expect(utils.publicOrigin(tunnelFile(""))).toBe("http://localhost:5173");

    setEnv("production", "  ");
    expect(utils.publicOrigin(tunnelFile(""))).toBe("http://localhost:5173");
  });

  it("drops trailing slashes, which CORS never matches and links double", () => {
    setEnv("production", `${PRODUCTION_URL}//`);

    expect(utils.publicOrigin(tunnelFile(""))).toBe(PRODUCTION_URL);
  });
});

describe("in production", () => {
  it("names PUBLIC_URL in the frontend and media URLs", () => {
    setEnv("production", PRODUCTION_URL);

    expect(utils.getFrontendUrl()).toBe(PRODUCTION_URL);
    expect(utils.getPublicUrl()).toBe(PRODUCTION_URL);
  });

  it("links alerts to PUBLIC_URL, not localhost", () => {
    setEnv("production", PRODUCTION_URL);

    const message = templates.escalation(
      { phoneNumber: "51999999999", channelAccountId: "ch-1" },
      "el cliente pidió un asesor",
    );

    expect(message).toContain(
      `${PRODUCTION_URL}/dashboard/conversations/51999999999?channel=ch-1`,
    );
    expect(message).not.toContain("localhost");
  });
});
