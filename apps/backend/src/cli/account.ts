import process from "node:process";
import { parseArgs } from "node:util";
import { db } from "../db/connection.ts";
import { initializeDatabase } from "../db/init.ts";
import { accountsOn, type AccountError } from "../domains/accounts/index.ts";
import { currentOperator } from "./os-user.ts";
import { readPassword } from "./read-password.ts";

const USAGE = `Usage:
  bun run account create <username> [--platform-operator | --tenant <tenantId>] [--name <display name>]
  bun run account promote <username>

The password is read from a hidden prompt, or from stdin when stdin is not a
terminal. It is never taken from arguments or the environment.`;

function usage(problem?: string): number {
  console.error(problem ? `${problem}\n\n${USAGE}` : USAGE);
  return 2;
}

function refuse(error: AccountError): number {
  console.error(`error: ${error.message}`);
  return 1;
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "platform-operator": { type: "boolean" },
        tenant: { type: "string" },
        name: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch {
    // The parser's message can quote the offending argument, which may be a password.
    return null;
  }
}

async function run(argv: string[]): Promise<number> {
  const args = parse(argv);
  if (!args) return usage("Unrecognised or incomplete option.");

  const { help, ...options } = args.values;
  if (help) {
    console.log(USAGE);
    return 0;
  }

  const [command, username, ...extra] = args.positionals;

  if (command !== "create" && command !== "promote") {
    return usage(command ? "Unknown command." : undefined);
  }
  if (!username || extra.length > 0) return usage("Expected one username.");

  initializeDatabase(db);
  const accounts = accountsOn(db);
  const operator = currentOperator();

  if (command === "promote") {
    if (Object.keys(options).length > 0) {
      return usage("promote takes a username and nothing else.");
    }

    const promoted = accounts.promote(username, operator);
    if (!promoted.ok) return refuse(promoted.error);

    console.log(
      promoted.value.changed
        ? `Promoted ${promoted.value.username} to platform operator.`
        : `${promoted.value.username} is already a platform operator; nothing changed.`,
    );
    return 0;
  }

  const request = {
    username,
    name: options.name,
    platformOperator: options["platform-operator"],
    tenantId: options.tenant,
  };

  // Refused before the prompt, so nobody types a password twice for nothing.
  const checked = accounts.checkNew(request);
  if (!checked.ok) return refuse(checked.error);

  const created = accounts.create(
    { ...request, password: await readPassword() },
    operator,
  );
  if (!created.ok) return refuse(created.error);

  const { value } = created;
  console.log(
    value.tenant
      ? `Created ${value.username} as admin of tenant ${value.tenant.slug} (${value.tenant.id}).`
      : `Created platform operator ${value.username}.`,
  );
  return 0;
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  db.close();
}
