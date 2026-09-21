import { Hono } from "hono";
import { pathParam } from "../../lib/http.ts";
import { ChannelAccountService } from "../../domains/channels/accounts.ts";
import { isEncryptionAvailable } from "../../platform/crypto/secrets.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { db } from "../../db/index.ts";
import {
  activeTenantId,
  requireActiveTenant,
  requirePlatformOperator,
} from "../../middleware/auth.ts";
import type { ChannelAccount } from "@totem/types";

const channels = new Hono();

channels.use("/*", requireActiveTenant);

/**
 * Credentials never leave the server. The API reports whether a token is set,
 * not what it is.
 */
function present(account: ChannelAccount) {
  return {
    id: account.id,
    tenant_id: account.tenant_id,
    channel_type: account.channel_type,
    waba_id: account.waba_id,
    phone_number_id: account.phone_number_id,
    display_phone_number: account.display_phone_number,
    label: account.label,
    status: account.status,
    has_access_token: account.access_token_secret_id !== null,
    has_verify_token: account.verify_token_secret_id !== null,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

/**
 * The first of `fields` that `body` carries as something other than a string,
 * or null. Absent (undefined or null) is fine, and so is an empty string, which
 * the handlers treat as absent.
 */
function malformedField(
  body: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return field;
  }
  return null;
}

channels.get("/", (c) => {
  const tenantId = activeTenantId(c);
  return c.json({
    accounts: ChannelAccountService.listForTenant(tenantId).map(present),
  });
});

/**
 * Claiming a number routes its inbound traffic to the acting tenant, and this
 * application cannot check who owns it on Meta's side. VendeYa onboards numbers
 * as a managed service, so only a platform operator creates one. A tenant admin
 * keeps the list and the PATCH, which reach only the tenant's own numbers.
 */
channels.post("/", requirePlatformOperator, async (c) => {
  const user = c.get("user");
  const tenantId = activeTenantId(c);
  const body = await c.req.json();

  const { phoneNumberId, wabaId, displayPhoneNumber, label } = body;
  const accessToken: string | undefined = body.accessToken;
  const verifyToken: string | undefined = body.verifyToken;

  if (!phoneNumberId) {
    return c.json({ error: "phoneNumberId is required" }, 400);
  }

  const malformed = malformedField(body, ["accessToken", "verifyToken"]);
  if (malformed) {
    return c.json({ error: `${malformed} must be a string` }, 400);
  }

  if ((accessToken || verifyToken) && !isEncryptionAvailable()) {
    return c.json(
      {
        error:
          "SECRETS_KEY is not configured; credentials cannot be stored encrypted",
      },
      503,
    );
  }

  const existing = ChannelAccountService.getByPhoneNumberId(phoneNumberId);
  if (existing) {
    return c.json({ error: "That phone number id is already registered" }, 409);
  }

  // The secrets and the account row are written together or not at all.
  const account = db.transaction(() =>
    ChannelAccountService.create({
      tenantId,
      phoneNumberId,
      wabaId: wabaId ?? null,
      displayPhoneNumber: displayPhoneNumber ?? null,
      label: label ?? null,
      accessToken: accessToken ?? null,
      verifyToken: verifyToken ?? null,
    }),
  )();

  logAction(
    { userId: user.id, tenantId },
    "create_channel_account",
    "channel_account",
    account.id,
    { phoneNumberId, wabaId: wabaId ?? null },
  );

  return c.json(present(account), 201);
});

channels.patch("/:id", async (c) => {
  const user = c.get("user");
  const tenantId = activeTenantId(c);
  const id = pathParam(c, "id");

  const account = ChannelAccountService.getById(id);
  if (!account || account.tenant_id !== tenantId) {
    return c.json({ error: "Channel account not found" }, 404);
  }

  const body = await c.req.json();
  const changed: string[] = [];

  // Every field is validated before the first write, so a refused PATCH leaves
  // the account unchanged. The writes then run in one transaction, so a write
  // that fails part way does not leave half of them behind either.
  const malformed = malformedField(body, [
    "accessToken",
    "verifyToken",
    "status",
  ]);
  if (malformed) {
    return c.json({ error: `${malformed} must be a string` }, 400);
  }

  if (body.accessToken || body.verifyToken) {
    if (!isEncryptionAvailable()) {
      return c.json(
        {
          error:
            "SECRETS_KEY is not configured; credentials cannot be stored encrypted",
        },
        503,
      );
    }
  }

  if (body.status && !["active", "pending", "disabled"].includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  // The webhook accepts inbound messages for any active account, and the
  // outbound adapter refuses to send without credentials. An account activated
  // with no access token would receive messages it can never answer. Such an
  // account belongs in 'pending'.
  //
  // The token counts when it is already stored or arrives in this same request.
  if (
    body.status === "active" &&
    !account.access_token_secret_id &&
    !body.accessToken
  ) {
    return c.json(
      {
        error:
          "Cannot activate a channel account with no access token: it would " +
          "receive messages it cannot reply to. Send accessToken with this " +
          "request, or store one first.",
      },
      400,
    );
  }

  db.transaction(() => {
    if (body.accessToken) {
      ChannelAccountService.setAccessToken(id, body.accessToken);
      changed.push("access_token");
    }

    if (body.verifyToken) {
      ChannelAccountService.setVerifyToken(id, body.verifyToken);
      changed.push("verify_token");
    }

    if (body.status) {
      ChannelAccountService.updateStatus(id, body.status);
      changed.push("status");
    }
  })();

  // Handing a pending account its first token activates it, so the status can
  // move without the request naming one. The audit entry records what the
  // account ended up as, not what was asked for.
  const updated = ChannelAccountService.getById(id)!;
  if (updated.status !== account.status && !changed.includes("status")) {
    changed.push("status");
  }

  logAction(
    { userId: user.id, tenantId },
    "update_channel_account",
    "channel_account",
    id,
    { changed, status: updated.status },
  );

  return c.json(present(updated));
});

export default channels;
