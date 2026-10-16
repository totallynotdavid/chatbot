/**
 * `/health` is what a container healthcheck and a deploy gate read. It answers
 * 503 when the database does not answer, and 200 otherwise.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markBlocked, markHealthy } from "../src/adapters/providers/health.ts";
import { healthRoute } from "../src/routes/health.ts";
import { createTestDatabase } from "./helpers/database.ts";

const dirs: string[] = [];

function openDatabase(): Database {
  const dir = mkdtempSync(join(tmpdir(), "vendeya-health-"));
  dirs.push(dir);
  return createTestDatabase(join(dir, "health.sqlite"));
}

afterEach(() => {
  markHealthy("gaso");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("/health", () => {
  it("answers 200 and healthy while the database answers", async () => {
    const response = await healthRoute(openDatabase()).request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "healthy",
      database: { status: "healthy" },
    });
  });

  it("answers 503 once the database is gone", async () => {
    const db = openDatabase();
    const route = healthRoute(db);
    db.close();

    const response = await route.request("/");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unavailable",
      database: { status: "unavailable" },
    });
  });

  it("stays 200 and reports degraded while a provider is blocked", async () => {
    markBlocked("gaso", "upstream timeout");

    const response = await healthRoute(openDatabase()).request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "degraded" });
  });
});
