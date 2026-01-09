/**
 * Makes sure that messages from the same user are processed sequentially,
 * while allowing messages from different users to be processed in parallel.
 */

type LockEntry = {
  promise: Promise<void>;
  resolve: () => void;
};

const locks = new Map<string, LockEntry>();

/**
 * Acquire a lock for a user. Returns when the lock is acquired.
 */
export async function acquireLock(phoneNumber: string): Promise<void> {
  // Wait for any existing lock
  const existing = locks.get(phoneNumber);
  if (existing) {
    await existing.promise;
  }

  // Create new lock
  let resolve: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  locks.set(phoneNumber, { promise, resolve: resolve! });
}

/**
 * Release the lock for a user
 */
export function releaseLock(phoneNumber: string): void {
  const entry = locks.get(phoneNumber);
  if (entry) {
    locks.delete(phoneNumber);
    entry.resolve();
  }
}

/**
 * Execute a function with the user lock held
 */
export async function withLock<T>(
  phoneNumber: string,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireLock(phoneNumber);
  try {
    return await fn();
  } finally {
    releaseLock(phoneNumber);
  }
}
