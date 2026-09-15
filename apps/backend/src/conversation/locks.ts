/**
 * Makes sure that messages from the same conversation are processed
 * sequentially, while allowing different conversations to be processed in
 * parallel.
 *
 * The lock key is the whole conversation identity: the same contact number
 * writing to two businesses must not serialise behind each other.
 *
 * Each key has a queue of acquisitions, and an acquisition only ever moves
 * waiting -> holding -> released:
 *
 *  - waiting -> holding happens when every acquisition queued before it on the
 *    same key has been released. The place in the queue is taken synchronously
 *    inside `acquireLock`, so two callers can never both be next.
 *  - holding -> released happens only through the release function that
 *    acquisition was handed. `withLock` calls it when `fn` settles and never
 *    earlier, because a promise cannot be cancelled: an `fn` whose caller has
 *    timed out is still writing to the conversation.
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
  return `${ref.tenantId}:${ref.channelAccountId}:${ref.phoneNumber}`;
}

/**
 * The time ran out while `fn` was running. It is still running, and still holds
 * the lock.
 *
 * Whatever `fn` goes on to do has not happened yet when this is thrown, so a
 * caller that records the outcome of its work waits for `operation`: it settles
 * when `fn` does, with `fn`'s result or `fn`'s error.
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
 * Wait for this conversation's turn. Resolves with the function that ends it;
 * calling that function more than once is harmless.
 */
export function acquireLock(ref: ConversationRef): Promise<ReleaseLock> {
  const key = lockKey(ref);
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
 * Execute a function with the conversation lock held.
 *
 * The caller hears back within `timeoutMs`, counting the time spent queued.
 * The timeout does not end the turn: the conversation stays locked until `fn`
 * settles, and a caller that runs out of time while still queued gives its
 * turn straight back without running `fn` at all.
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

  // Leaving the middle of the queue would let the caller behind overtake
  // whoever is still holding, so the turn is passed on when it comes up.
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
