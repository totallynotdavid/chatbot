// Drives the running stack the way its callers do. Runs inside the compose
// network, so `web` is reachable by name:
//   bun probe.ts webhook
//   bun probe.ts origin
//   bun probe.ts login <username> <password>
import { createHmac, randomUUID } from "node:crypto";
import process from "node:process";

const WEB = "http://web:3000";
const FAKE = "http://127.0.0.1:8080";

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function env(name: string): string {
  return process.env[name] ?? fail(`${name} is not set`);
}

type Sent = { path: string; body: { to?: string; type?: string } };

async function received(): Promise<Sent[]> {
  return (await fetch(`${FAKE}/received`)).json() as Promise<Sent[]>;
}

async function webhook(): Promise<void> {
  const customer = `519${Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0")}`;
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "drill-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: env("WHATSAPP_PHONE_ID") },
              messages: [
                {
                  from: customer,
                  id: `wamid.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "hola" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const post = (signature: string) =>
    fetch(`${WEB}/api/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body,
    });

  const forged = await post("sha256=" + "0".repeat(64));
  if (forged.status < 400 || forged.status >= 500) {
    fail(`a forged signature got ${forged.status}, expected a 4xx`);
  }

  const signature =
    "sha256=" +
    createHmac("sha256", env("WHATSAPP_APP_SECRET")).update(body).digest("hex");
  const signed = await post(signature);
  if (signed.status !== 200) fail(`the signed webhook got ${signed.status}`);

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const reply = (await received()).find(
      (sent) => sent.body.to === customer && sent.body.type === "text",
    );
    if (reply) {
      console.log(`PASS: reply to ${customer} on ${reply.path}`);
      console.log(JSON.stringify(reply.body));
      return;
    }
    await Bun.sleep(500);
  }
  fail(`no reply to ${customer} reached the Graph fake`);
}

async function login(username: string, password: string): Promise<void> {
  const response = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    fail(`login of ${username} answered ${response.status}`);
  }
  const { user } = (await response.json()) as { user: { username: string } };
  console.log(`PASS: ${user.username} logged in`);
}

// SvelteKit refuses a multipart POST whose Origin differs from the origin it
// computes from the request. The Worker sends the public host and scheme in
// x-forwarded-host and x-forwarded-proto, and `web` is set to read them.
async function origin(): Promise<void> {
  const publicUrl = new URL(env("PUBLIC_URL"));
  const post = (from: string, forwarded: boolean) =>
    fetch(`${WEB}/api/auth/login`, {
      method: "POST",
      headers: {
        origin: from,
        ...(forwarded && {
          "x-forwarded-host": publicUrl.host,
          "x-forwarded-proto": publicUrl.protocol.slice(0, -1),
        }),
      },
      body: new FormData(),
    });

  const own = await post(publicUrl.origin, true);
  if (own.status === 403) fail("a POST from the public origin got 403");
  const foreign = await post("https://evil.example", true);
  if (foreign.status !== 403) {
    fail(`a POST from another origin got ${foreign.status}, expected 403`);
  }
  const bare = await post(publicUrl.origin, false);
  if (bare.status !== 403) {
    fail(
      `a POST without the forwarded headers got ${bare.status}, expected 403`,
    );
  }
  console.log(
    `PASS: the public origin got ${own.status}; another origin, and no forwarded headers, got 403`,
  );
}

const [command, ...args] = process.argv.slice(2);
if (command === "webhook") await webhook();
else if (command === "origin") await origin();
else if (command === "login" && args[0] && args[1])
  await login(args[0], args[1]);
else fail("usage: probe.ts webhook | origin | login <username> <password>");
