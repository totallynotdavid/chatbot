const PRESETS = {
  webhook: { bytes: 32, variable: "WHATSAPP_WEBHOOK_VERIFY_TOKEN" },
  secrets: { bytes: 32, variable: "SECRETS_KEY" },
} as const;

type PresetName = keyof typeof PRESETS;

function generateToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  return Buffer.from(bytes).toString("base64url");
}

function main() {
  const arg = process.argv[2];

  let length: number;
  let variable = "GENERATED_TOKEN";

  if (!arg) {
    length = PRESETS.webhook.bytes;
    variable = PRESETS.webhook.variable;
  } else if (arg in PRESETS) {
    const preset = arg as PresetName;
    length = PRESETS[preset].bytes;
    variable = PRESETS[preset].variable;
  } else {
    length = parseInt(arg, 10);
    if (Number.isNaN(length) || length < 16) {
      console.error("Error: Length must be a number >= 16");
      console.log("\nUsage:");
      console.log(
        "  bun run scripts/generate-token.ts           # Generate webhook token (default)",
      );
      console.log(
        "  bun run scripts/generate-token.ts <length>  # Custom length (min 16)",
      );
      console.log(
        "  bun run scripts/generate-token.ts webhook   # Webhook verify token (32 bytes)",
      );
      console.log(
        "  bun run scripts/generate-token.ts secrets   # SECRETS_KEY (32 bytes)",
      );
      process.exit(1);
    }
  }

  const token = generateToken(length);

  console.log(`Add to your .env file:`);
  console.log(`${variable}="${token}"`);
}

main();
