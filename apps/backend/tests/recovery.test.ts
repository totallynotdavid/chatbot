import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { CheckEligibilityHandler } from "../src/domains/eligibility/handlers/check-eligibility-handler.ts";
import { RetryEligibilityHandler } from "../src/domains/recovery/handlers/retry-eligibility-handler.ts";
import { FNBProvider } from "../src/domains/eligibility/providers/fnb-provider.ts";
import { PowerBIProvider } from "../src/domains/eligibility/providers/powerbi-provider.ts";
import { initializeEnrichmentRegistry } from "../src/conversation/enrichment/index.ts";
import { enrichmentRegistry } from "../src/conversation/enrichment/registry.ts";
import { db } from "../src/db/index.ts";
import jwt from "jsonwebtoken";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const FAKE_TOKEN = jwt.sign({ commercialAllyId: "123" }, "secret");

describe("Provider outage recovery", () => {
  const testPhone = "51999999999";
  const testDNI = "12345678";
  const originalFetch = globalThis.fetch;

  let tenant: TenantFixture;

  beforeEach(() => {
    process.env.CALIDDA_BASE_URL = "https://test.calidda.com";
    process.env.CALIDDA_USERNAME = "testuser";
    process.env.CALIDDA_PASSWORD = "testpass";

    applySchema();

    tenant = createTenantFixture("recovery");

    // Initialize enrichment registry
    const fnbProvider = new FNBProvider();
    const powerbiProvider = new PowerBIProvider();
    const eligibilityHandler = new CheckEligibilityHandler(
      fnbProvider,
      powerbiProvider,
    );
    enrichmentRegistry.clear();
    initializeEnrichmentRegistry(eligibilityHandler);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    dropTenantFixture(tenant);
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

    const fnbProvider = new FNBProvider();
    const powerbiProvider = new PowerBIProvider();
    const eligibilityHandler = new CheckEligibilityHandler(
      fnbProvider,
      powerbiProvider,
    );
    const result = await eligibilityHandler.execute(
      testDNI,
      tenant.ref(testPhone),
    );

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
      `INSERT INTO conversations (tenant_id, channel_account_id, phone_number, context_data, status)
        VALUES (?, ?, ?, ?, 'active')`,
    ).run(
      tenant.tenantId,
      tenant.channelAccountId,
      testPhone,
      JSON.stringify({ phase, metadata }),
    );

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

    const fnbProvider = new FNBProvider();
    const powerbiProvider = new PowerBIProvider();
    const eligibilityHandler = new CheckEligibilityHandler(
      fnbProvider,
      powerbiProvider,
    );
    const handler = new RetryEligibilityHandler(eligibilityHandler);
    const result = await handler.execute(tenant.tenantId);

    if (result.ok) {
      expect(result.value.recoveredCount).toBe(1);
    } else {
      throw new Error("Expected success result");
    }
  });
});
