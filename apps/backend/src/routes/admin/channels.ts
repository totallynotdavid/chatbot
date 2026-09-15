import { Hono } from "hono";
import { pathParam } from "../../lib/http.ts";
import { ChannelAccountService } from "../../domains/channels/accounts.ts";
import { isEncryptionAvailable } from "../../platform/crypto/secrets.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { activeTenantId, requireActiveTenant } from "../../middleware/auth.ts";
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

channels.get("/", (c) => {
  const tenantId = activeTenantId(c);
  return c.json({
    accounts: ChannelAccountService.listForTenant(tenantId).map(present),
  });
});

channels.post("/", async (c) => {
  const user = c.get("user");
  const tenantId = activeTenantId(c);
  const body = await c.req.json();

  const { phoneNumberId, wabaId, displayPhoneNumber, label } = body;
  const accessToken: string | undefined = body.accessToken;
  const verifyToken: string | undefined = body.verifyToken;

  if (!phoneNumberId) {
    return c.json({ error: "phoneNumberId is required" }, 400);
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

  const account = ChannelAccountService.create({
    tenantId,
    phoneNumberId,
    wabaId: wabaId ?? null,
    displayPhoneNumber: displayPhoneNumber ?? null,
    label: label ?? null,
    accessToken: accessToken ?? null,
    verifyToken: verifyToken ?? null,
  });

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

  // Everything the request could be refused for is checked before anything is
  // written, so a rejected PATCH leaves the account exactly as it was. Stored
  // the verify token and then refused the status, and the caller got a 400 for
  // a request that had already half happened.
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

  // 'active' is a claim the account has to be able to make good on, in both
  // directions. Webhook intake accepts inbound messages for any active account
  // (routes/webhook.ts), while the outbound adapter refuses to send without
  // credentials (adapters/whatsapp/cloud-api.ts) - so a number activated with
  // no access token swallows customer messages it can never answer, quietly,
  // for as long as it takes somebody to notice. 'pending' is the state that
  // means exactly this, and it is the one such an account belongs in.
  //
  // The token may already be stored or arrive in this same request; either
  // settles it, and the second case is the ordinary "here are the credentials,
  // turn it on" call.
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
