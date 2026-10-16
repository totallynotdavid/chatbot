import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import type { ChannelAccount } from "@vendeya/types";

import { CloudApiAdapter } from "../src/adapters/whatsapp/cloud-api.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { DEFAULT_GRAPH_VERSION, graphConfig } from "../src/config/graph.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900333444";
const TOKEN = "EAAG-graph-version-token";
const ENTRYPOINT = join(import.meta.dir, "..", "src", "index.ts");

type Seen = {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
};

describe("the Graph version of a send", () => {
  let tenant: TenantFixture;
  let account: ChannelAccount;
  let server: ReturnType<typeof Bun.serve>;
  let seen: Seen[];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of [
      "SECRETS_KEY",
      "GRAPH_API_VERSION",
      "GRAPH_API_BASE_URL",
    ]) {
      saved[name] = process.env[name];
    }
    process.env.SECRETS_KEY = "e5".repeat(32);
    delete process.env.GRAPH_API_VERSION;

    seen = [];
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        seen.push({
          method: request.method,
          path: new URL(request.url).pathname,
          auth: request.headers.get("authorization"),
          body: await request.json(),
        });
        return Response.json({ messages: [{ id: "wamid.FAKE" }] });
      },
    });
    process.env.GRAPH_API_BASE_URL = `http://localhost:${server.port}`;

    applySchema();
    tenant = createTenantFixture("graph-version");
    account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: "pnid-graph",
      accessToken: TOKEN,
    });
  });

  afterEach(() => {
    server.stop(true);
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    dropTenantFixture(tenant);
  });

  it("sends a text to the default version", async () => {
    const outcome = await CloudApiAdapter.sendMessage(
      account,
      CUSTOMER,
      "hola",
    );

    expect(outcome).toEqual({ ok: true, messageId: "wamid.FAKE" });
    expect(DEFAULT_GRAPH_VERSION).toBe("v26.0");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: "/v26.0/pnid-graph/messages",
      auth: `Bearer ${TOKEN}`,
      body: { messaging_product: "whatsapp", to: CUSTOMER, type: "text" },
    });
  });

  it("sends an image and a read receipt to the configured version", async () => {
    process.env.GRAPH_API_VERSION = "v25.0";

    await CloudApiAdapter.sendImage(account, CUSTOMER, "images/a.jpg");
    await CloudApiAdapter.markAsRead(account, "wamid.IN", { typing: true });

    expect(seen.map((s) => s.path)).toEqual([
      "/v25.0/pnid-graph/messages",
      "/v25.0/pnid-graph/messages",
    ]);
    expect(seen[1]!.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN",
      typing_indicator: { type: "text" },
    });
  });

  it("reads the version at each send", async () => {
    await CloudApiAdapter.sendMessage(account, CUSTOMER, "uno");
    process.env.GRAPH_API_VERSION = "v24.0";
    await CloudApiAdapter.sendMessage(account, CUSTOMER, "dos");

    expect(seen.map((s) => s.path.split("/")[1])).toEqual(["v26.0", "v24.0"]);
  });
});

describe("the Graph settings", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ["GRAPH_API_VERSION", "GRAPH_API_BASE_URL"]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("default to Meta's host and the latest version", () => {
    expect(graphConfig()).toEqual({
      baseUrl: "https://graph.facebook.com",
      version: "v26.0",
    });
  });

  it("treat an empty variable as unset", () => {
    process.env.GRAPH_API_VERSION = " ";
    expect(graphConfig().version).toBe("v26.0");
  });

  for (const version of ["26.0", "v26", "latest", "v26.0/../x", "V26.0"]) {
    it(`reject the version "${version}"`, () => {
      process.env.GRAPH_API_VERSION = version;
      expect(() => graphConfig()).toThrow("GRAPH_API_VERSION");
    });
  }

  for (const url of ["graph.facebook.com", "ftp://graph.facebook.com"]) {
    it(`reject the base URL "${url}"`, () => {
      process.env.GRAPH_API_BASE_URL = url;
      expect(() => graphConfig()).toThrow("GRAPH_API_BASE_URL");
    });
  }
});

describe("boot", () => {
  it("refuses an invalid Graph version before it binds a port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vendeya-graph-boot-"));
    try {
      const child = Bun.spawn(["bun", "run", ENTRYPOINT], {
        cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_ENV: "development",
          PORT: "0",
          DB_PATH: join(dir, "boot.sqlite"),
          UPLOAD_DIR: join(dir, "uploads"),
          PRIVATE_DIR: join(dir, "private"),
          LOG_DIR: join(dir, "logs"),
          GRAPH_API_VERSION: "17",
        },
      });

      const exitCode = await child.exited;
      const stderr = await new Response(child.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("GRAPH_API_VERSION");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
