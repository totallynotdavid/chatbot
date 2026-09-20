/**
 * Messages of one conversation run sequentially. Different conversations run
 * in parallel.
 *
 * An acquisition moves only from waiting to holding to released. It holds once
 * every earlier acquisition on its key is released. It is released only through
 * the function it was handed.
 */

import { createLogger } from "../lib/logger.ts";
import { TIMEOUTS } from "../config/timeouts.ts";
import type { ConversationRef } from "@totem/types";

const logger = createLogger("locks");

export type ReleaseLock = () => void;

/** For each key, a promise that settles once its last queued acquisition is released. */
const queueTails = new Map<string, Promise<void>>();

const EXPIRED = Symbol("expired");

type Deadline = {
  key: string;
  timeoutMs: number;
  expired: Promise<typeof EXPIRED>;
};

export function lockKey(ref: ConversationRef): string {
  // The key is the whole conversation identity. The same contact writing to two
  // businesses must not queue behind itself.
  return `${ref.tenantId}:${ref.channelAccountId}:${ref.phoneNumber}`;
}

/**
 * The time ran out while `fn` was running. `fn` still runs and still holds the
 * lock. A caller that records the outcome of its work awaits `operation`, which
 * settles with `fn`'s result or error.
 */
export class LockTimeoutError extends Error {
  readonly operation: Promise<unknown>;

  constructor(key: string, timeoutMs: number, operation: Promise<unknown>) {
    super(`Lock timeout for ${key} after ${timeoutMs}ms`);
    this.name = "LockTimeoutError";
    this.operation = operation;
  }
}

/** The time ran out before the lock came free. `fn` never ran, so nothing was done. */
export class ConversationBusyError extends Error {
  constructor(key: string, timeoutMs: number) {
    super(`Conversation ${key} was still locked after ${timeoutMs}ms`);
    this.name = "ConversationBusyError";
  }
}

/**
 * Waits for this conversation's turn and resolves with the function that ends
 * it. Calling that function more than once is harmless.
 */
export function acquireLock(ref: ConversationRef): Promise<ReleaseLock> {
  const key = lockKey(ref);
  // Reading the tail and replacing it happen in one synchronous step, so two
  // callers can never both be next.
  const previous = queueTails.get(key) ?? Promise.resolve();

  let release!: ReleaseLock;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  const tail = previous.then(() => released);
  queueTails.set(key, tail);

  released.then(() => {
    if (queueTails.get(key) === tail) queueTails.delete(key);
  });

  return previous.then(() => release);
}

/**
 * Runs `fn` with the conversation lock held. `timeoutMs` includes queue time.
 *
 * @throws ConversationBusyError if `timeoutMs` passes before the lock is free
 * @throws LockTimeoutError if `timeoutMs` passes while `fn` is running
 */
export async function withLock<T>(
  ref: ConversationRef,
  fn: () => Promise<T>,
  timeoutMs: number = TIMEOUTS.LOCK_DEFAULT,
): Promise<T> {
  const acquiring = acquireLock(ref);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline: Deadline = {
    key: lockKey(ref),
    timeoutMs,
    expired: new Promise((resolve) => {
      timer = setTimeout(() => resolve(EXPIRED), timeoutMs);
    }),
  };

  try {
    const release = await waitForTurn(acquiring, deadline);
    return await runHoldingLock(fn, release, deadline);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForTurn(
  acquiring: Promise<ReleaseLock>,
  deadline: Deadline,
): Promise<ReleaseLock> {
  const turn = await Promise.race([acquiring, deadline.expired]);
  if (turn !== EXPIRED) return turn;

  // The abandoned place in the queue is kept until its turn comes, then
  // released at once. Dropping it early would let the caller behind overtake
  // whoever is still holding.
  acquiring.then((release) => release());
  logger.error(
    { key: deadline.key, timeoutMs: deadline.timeoutMs },
    "Gave up waiting for the conversation lock; nothing was run",
  );
  throw new ConversationBusyError(deadline.key, deadline.timeoutMs);
}

async function runHoldingLock<T>(
  fn: () => Promise<T>,
  release: ReleaseLock,
  deadline: Deadline,
): Promise<T> {
  const startedAt = Date.now();
  const running = Promise.resolve().then(fn);
  // The lock is released when `fn` settles and never at the timeout. A promise
  // cannot be cancelled, so an `fn` whose caller gave up is still writing to
  // the conversation.
  running.then(release, release);

  const outcome = await Promise.race([running, deadline.expired]);
  if (outcome !== EXPIRED) return outcome;

  logger.error(
    { key: deadline.key, timeoutMs: deadline.timeoutMs },
    "Lock timeout exceeded; the operation is still running and keeps the conversation locked",
  );
  const settled = () =>
    logger.warn(
      { key: deadline.key, durationMs: Date.now() - startedAt },
      "Timed-out operation settled; conversation unlocked",
    );
  running.then(settled, settled);
  throw new LockTimeoutError(deadline.key, deadline.timeoutMs, running);
}
