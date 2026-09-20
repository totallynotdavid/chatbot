/**
 * Creates one new database file per round the way every entry point does, by
 * evaluating `connection.ts` and running `initializeDatabase`. Round `n` uses
 * `<dir of DB_PATH>/n/db.sqlite`. Copies of this script share a schedule that
 * starts when the barrier file appears, so they open each file together.
 * Arguments: rounds, milliseconds per round, barrier file.
 */

import fs from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const [rounds, stepMs, barrier] = process.argv.slice(2);
const root = dirname(process.env.DB_PATH!);

// `connection.ts` opens DB_PATH when it is first evaluated, and `init.ts`
// reaches it through its imports. This process warms both up on a file of its
// own, so each round pays only for evaluating the connection again.
process.env.DB_PATH = join(root, `warmup-${process.pid}`, "db.sqlite");
await import("../../src/db/connection.ts");
const { initializeDatabase } = await import("../../src/db/init.ts");

process.stdout.write("ready\n");
while (!fs.existsSync(barrier!)) {
  // Spin: a sleep would let the processes drift apart.
}
const start = performance.now();

const failures: string[] = [];
for (let round = 0; round < Number(rounds); round++) {
  while (performance.now() < start + round * Number(stepMs)) {
    // Spin until this round's slot.
  }
  process.env.DB_PATH = join(root, String(round), "db.sqlite");
  try {
    // A query string makes the runtime evaluate the module again, which opens
    // this round's file.
    const { db } = await import(`../../src/db/connection.ts?round=${round}`);
    initializeDatabase(db);
    db.close();
  } catch (error) {
    failures.push(
      `round ${round}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
