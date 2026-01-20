import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { CheckEligibilityHandler } from "../src/domains/eligibility/handlers/check-eligibility-handler.ts";
import { RetryEligibilityHandler } from "../src/domains/recovery/handlers/retry-eligibility-handler.ts";
import { db } from "../src/db/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jwt from "jsonwebtoken";

mock.module("../src/config.ts", () => ({
  config: {
    calidda: {
      baseUrl: "http://fnb.fake",
      credentials: { username: "test", password: "test" },
    },
    powerbi: {
      datasetId: "fake-ds",
      reportId: "fake-rep",
      modelId: "0",
      resourceKey: "fake-key",
    },
  },
}));

const FAKE_TOKEN = jwt.sign({ commercialAllyId: "123" }, "secret");

mock.module("../src/adapters/providers/health.ts", () => ({
  isAvailable: () => true,
  markBlocked: () => {},
}));
mock.module("../src/domains/settings/system.ts", () => ({
  isProviderForcedDown: () => false,
}));
mock.module("../src/domains/eligibility/shared.ts", () => ({
  getSimulationPersona: () => null,
}));

describe("Provider Outage Recovery (Full Integration)", () => {
  const testPhone = "51999999999";
  const testDNI = "12345678";
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const schemaPath = join(import.meta.dir, "../src/db/schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");

    const statements = schema
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      db.run(statement);
    }

    db.prepare("DELETE FROM conversations WHERE phone_number = ?").run(
      testPhone,
    );
    db.prepare("DELETE FROM users WHERE id = 'test-agent'").run();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should detect system_outage when APIs return 5xx errors", async () => {
    globalThis.fetch = mock(async (input: any) => {
      const url = input.toString();

      if (url.includes("autenticar")) {
        return new Response(
          JSON.stringify({
            valid: true,
            data: { authToken: FAKE_TOKEN },
          }),
        );
      }
      if (url.includes("lineaCredito"))
        return new Response("Service Unavailable", { status: 503 });
      if (url.includes("querydata"))
        return new Response("Internal Error", { status: 500 });

      return new Response("Not Found", { status: 404 });
    }) as any;

    const handler = new CheckEligibilityHandler();
    const result = await handler.execute(testDNI, testPhone);

    if (result.ok && result.value.type === "eligibility_result") {
      expect(result.value.status).toBe("system_outage");
      expect(result.value.handoffReason).toBe("both_providers_down");
    } else {
      throw new Error("Expected eligibility_result in response");
    }
  });

  it("should recovery stuck conversations when APIs recover", async () => {
    const phase = {
      phase: "waiting_for_recovery",
      dni: testDNI,
      timestamp: Date.now(),
    };
    const metadata = { createdAt: Date.now(), lastActivityAt: Date.now() };
    db.prepare(
      `INSERT INTO conversations (phone_number, context_data, status) 
        VALUES (?, ?, 'active')`,
    ).run(testPhone, JSON.stringify({ phase, metadata }));

    globalThis.fetch = mock(async (input: any) => {
      const url = input.toString();

      if (url.includes("autenticar")) {
        return new Response(
          JSON.stringify({
            valid: true,
            data: { authToken: FAKE_TOKEN },
          }),
        );
      }
      if (url.includes("lineaCredito")) {
        return new Response(
          JSON.stringify({
            valid: true,
            data: { lineaCredito: "1500.00", nombre: "Juana Test" },
          }),
        );
      }
      if (url.includes("querydata"))
        return new Response("Error", { status: 500 });

      return new Response("Not Found", { status: 404 });
    }) as any;

    const handler = new RetryEligibilityHandler();
    const result = await handler.execute();

    if (result.ok) {
      expect(result.value.recoveredCount).toBe(1);
    } else {
      throw new Error("Expected success result");
    }
  });
});
