/**
 * The retry budget of a queued reply, as one table. `stepOutbox` is the only
 * place the delays, the attempt limit and the age limit are applied, so the
 * inline send and the worker cannot disagree about when a reply is given up on.
 */

import { describe, expect, it } from "bun:test";

import type { SendOutcome } from "../src/adapters/whatsapp/types.ts";
import {
  AMBIGUOUS_RETRY_DELAY_MS,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  TRANSIENT_RETRY_DELAYS_MS,
  type OutboxCounters,
  type OutboxStep,
  stepOutbox,
} from "../src/conversation/outbox.ts";

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const accepted: SendOutcome = { ok: true, messageId: "wamid.OK" };
const permanent: SendOutcome = {
  ok: false,
  kind: "permanent",
  reason: "http_400:131047",
};
const transient: SendOutcome = {
  ok: false,
  kind: "transient",
  reason: "http_502",
};
const ambiguous: SendOutcome = {
  ok: false,
  kind: "ambiguous",
  reason: "network:ECONNRESET",
};
const interrupted: SendOutcome = {
  ok: false,
  kind: "ambiguous",
  reason: "interrupted",
};

function counters(over: Partial<OutboxCounters> = {}): OutboxCounters {
  return { attempts: 0, ambiguousAttempts: 0, createdAt: NOW, ...over };
}

type Case = {
  name: string;
  counters: OutboxCounters;
  outcome: SendOutcome;
  expected: Partial<OutboxStep>;
};

const CASES: Case[] = [
  {
    name: "an accepted send is sent, and counts the attempt",
    counters: counters(),
    outcome: accepted,
    expected: {
      status: "sent",
      attempts: 1,
      lastKind: "accepted",
      lastReason: null,
    },
  },
  {
    name: "an accepted send on a retried row is sent",
    counters: counters({ attempts: 3, ambiguousAttempts: 1 }),
    outcome: accepted,
    expected: { status: "sent", attempts: 4, ambiguousAttempts: 1 },
  },
  {
    name: "a permanent failure fails at once",
    counters: counters(),
    outcome: permanent,
    expected: {
      status: "failed",
      attempts: 1,
      lastKind: "permanent",
      lastReason: "http_400:131047",
    },
  },
  ...TRANSIENT_RETRY_DELAYS_MS.map((delay, index) => ({
    name: `a transient failure of attempt ${index + 1} retries after ${delay} ms`,
    counters: counters({ attempts: index }),
    outcome: transient,
    expected: {
      status: "pending" as const,
      attempts: index + 1,
      ambiguousAttempts: 0,
      nextAttemptAt: NOW + delay,
      lastKind: "transient",
      lastReason: "http_502",
    },
  })),
  {
    name: "a transient failure of attempt 5 is exhausted",
    counters: counters({ attempts: MAX_ATTEMPTS - 1 }),
    outcome: transient,
    expected: {
      status: "failed",
      attempts: MAX_ATTEMPTS,
      lastKind: "transient",
      lastReason: "exhausted",
    },
  },
  {
    name: "a first ambiguous failure retries once, after the shortest delay",
    counters: counters(),
    outcome: ambiguous,
    expected: {
      status: "pending",
      attempts: 1,
      ambiguousAttempts: 1,
      nextAttemptAt: NOW + AMBIGUOUS_RETRY_DELAY_MS,
      lastKind: "ambiguous",
      lastReason: "network:ECONNRESET",
    },
  },
  {
    name: "a first ambiguous failure on a later attempt still waits 5 s, not that attempt's delay",
    counters: counters({ attempts: 2 }),
    outcome: ambiguous,
    expected: {
      status: "pending",
      attempts: 3,
      ambiguousAttempts: 1,
      nextAttemptAt: NOW + 5 * SECOND,
    },
  },
  {
    name: "a second ambiguous failure fails, because a third delivery is not risked",
    counters: counters({ attempts: 1, ambiguousAttempts: 1 }),
    outcome: ambiguous,
    expected: {
      status: "failed",
      attempts: 2,
      ambiguousAttempts: 2,
      lastKind: "ambiguous",
      lastReason: "network:ECONNRESET",
    },
  },
  {
    name: "a first ambiguous failure at attempt 5 is exhausted",
    counters: counters({ attempts: MAX_ATTEMPTS - 1 }),
    outcome: ambiguous,
    expected: {
      status: "failed",
      attempts: MAX_ATTEMPTS,
      ambiguousAttempts: 1,
      lastReason: "exhausted",
    },
  },
  {
    name: "an interrupted attempt counts as one ambiguous attempt and retries",
    counters: counters(),
    outcome: interrupted,
    expected: {
      status: "pending",
      attempts: 1,
      ambiguousAttempts: 1,
      nextAttemptAt: NOW + AMBIGUOUS_RETRY_DELAY_MS,
      lastKind: "ambiguous",
      lastReason: "interrupted",
    },
  },
  {
    name: "a second interrupted attempt of the same row fails",
    counters: counters({ attempts: 1, ambiguousAttempts: 1 }),
    outcome: interrupted,
    expected: { status: "failed", attempts: 2, lastReason: "interrupted" },
  },
  {
    name: "a row an hour old is expired instead of retried",
    counters: counters({ createdAt: NOW - MAX_AGE_MS }),
    outcome: transient,
    expected: { status: "failed", attempts: 1, lastReason: "expired" },
  },
  {
    name: "a row just under an hour old is still retried",
    counters: counters({ createdAt: NOW - MAX_AGE_MS + SECOND }),
    outcome: transient,
    expected: { status: "pending", nextAttemptAt: NOW + 5 * SECOND },
  },
  {
    name: "an accepted send of a row past the age limit is still sent",
    counters: counters({ createdAt: NOW - 2 * MAX_AGE_MS }),
    outcome: accepted,
    expected: { status: "sent" },
  },
];

describe("the outbox retry budget", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const step = stepOutbox(testCase.counters, testCase.outcome, NOW);

      expect(step).toMatchObject(testCase.expected);
    });
  }

  it("schedules the four transient retries at 5 s, 30 s, 2 min and 10 min", () => {
    expect([...TRANSIENT_RETRY_DELAYS_MS]).toEqual([
      5 * SECOND,
      30 * SECOND,
      2 * MINUTE,
      10 * MINUTE,
    ]);
    expect(TRANSIENT_RETRY_DELAYS_MS).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it("gives up an hour after the row was created", () => {
    expect(MAX_AGE_MS).toBe(60 * MINUTE);
  });
});
