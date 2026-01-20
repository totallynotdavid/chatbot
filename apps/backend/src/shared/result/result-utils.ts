import type { Result } from "./result.ts";
import { Ok, Err } from "./result.ts";

/**
 * Combine multiple Results into a single Result containing an array.
 * If any Result is Err, returns the first error.
 */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return Ok(values);
}

/**
 * Run async function and catch errors into Result.
 */
export async function fromAsync<T>(
  fn: () => Promise<T>,
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return Ok(value);
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Sequence an array of Result-returning functions, short-circuiting on first error.
 */
export function sequence<T, E>(fns: Array<() => Result<T, E>>): Result<T[], E> {
  const results = fns.map((fn) => fn());
  return combine(results);
}

/**
 * Run an async function that returns Result, catching any thrown errors.
 */
export async function fromAsyncResult<T, E>(
  fn: () => Promise<Result<T, E>>,
): Promise<Result<T, E | Error>> {
  try {
    return await fn();
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}
