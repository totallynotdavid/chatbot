/** Each preset is the byte length to generate and the variable it is for. */
const PRESETS = {
  webhook: { bytes: 32, variable: "WHATSAPP_WEBHOOK_VERIFY_TOKEN" },
  secrets: { bytes: 32, variable: "SECRETS_KEY" },
  session: { bytes: 32, variable: "SESSION_SECRET" },
  api: { bytes: 64, variable: "API_KEY" },
  jwt: { bytes: 32, variable: "JWT_SECRET" },
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
  // The variable the token is printed as. Getting this wrong is not cosmetic:
  // the .env examples tell operators to run a preset and paste the output, so a
  // label that always said WHATSAPP_WEBHOOK_VERIFY_TOKEN left SECRETS_KEY unset
  // for anyone who followed them.
  let variable = "GENERATED_TOKEN";

  if (!arg) {
    // Default: webhook verify token
    length = PRESETS.webhook.bytes;
    variable = PRESETS.webhook.variable;
  } else if (arg in PRESETS) {
    // Preset name
    const preset = arg as PresetName;
    length = PRESETS[preset].bytes;
    variable = PRESETS[preset].variable;
  } else {
    // Custom length
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
      console.log(
        "  bun run scripts/generate-token.ts session   # Session secret (32 bytes)",
      );
      console.log(
        "  bun run scripts/generate-token.ts api       # API key (64 bytes)",
      );
      console.log(
        "  bun run scripts/generate-token.ts jwt       # JWT secret (32 bytes)",
      );
      process.exit(1);
    }
  }

  const token = generateToken(length);

  console.log(`Add to your .env file:`);
  console.log(`${variable}="${token}"`);
}

main();
