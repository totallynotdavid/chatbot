/**
 * A backend process that dies mid-turn. It runs the real aggregator worker on
 * the database named by DB_PATH, with a reply step that never finishes, and
 * prints `mid-turn` once a turn is inside it. The test kills it from outside.
 */

import process from "node:process";
import { startAggregatorWorker } from "../../src/conversation/aggregator-worker.ts";
import { enrichmentRegistry } from "../../src/conversation/enrichment/registry.ts";

enrichmentRegistry.clear();
enrichmentRegistry.register({
  type: "detect_question",
  execute: () => {
    process.stdout.write("mid-turn\n");
    return new Promise(() => {});
  },
});

startAggregatorWorker();
