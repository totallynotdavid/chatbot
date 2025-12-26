const PRESETS = {
  webhook: 32,      // WHATSAPP_WEBHOOK_VERIFY_TOKEN
  session: 32,      // SESSION_SECRET
  api: 64,          // API keys
  jwt: 32,          // JWT secrets
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
  let label = "Generated token";

  if (!arg) {
    // Default: webhook verify token
    length = PRESETS.webhook;
    label = "WHATSAPP_WEBHOOK_VERIFY_TOKEN";
  } else if (arg in PRESETS) {
    // Preset name
    const preset = arg as PresetName;
    length = PRESETS[preset];
    label = `${preset.toUpperCase()} token`;
  } else {
    // Custom length
    length = parseInt(arg, 10);
    if (isNaN(length) || length < 16) {
      console.error("Error: Length must be a number >= 16");
      console.log("\nUsage:");
      console.log("  bun run scripts/generate-token.ts           # Generate webhook token (default)");
      console.log("  bun run scripts/generate-token.ts <length>  # Custom length (min 16)");
      console.log("  bun run scripts/generate-token.ts webhook   # Webhook verify token (32 bytes)");
      console.log("  bun run scripts/generate-token.ts session   # Session secret (32 bytes)");
      console.log("  bun run scripts/generate-token.ts api       # API key (64 bytes)");
      console.log("  bun run scripts/generate-token.ts jwt       # JWT secret (32 bytes)");
      process.exit(1);
    }
  }

  const token = generateToken(length);

  console.log(`\n${label}:\n`);
  console.log(`  ${token}`);
  console.log(`\nAdd to your .env file:`);
  console.log(`  WHATSAPP_WEBHOOK_VERIFY_TOKEN="${token}"`);
  console.log(`\nKeep this secret! Don't commit to git.\n`);
}

main();
