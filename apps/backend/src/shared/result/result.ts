/**
 * Result<T, E> represents the outcome of an operation that may fail.
 * - Ok(value): Operation succeeded with value
 * - Err(error): Operation failed with error
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Create a successful Result
 */
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * Create a failed Result
 */
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Type guard: check if Result is Ok
 */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { ok: true; value: T } {
  return result.ok === true;
}

/**
 * Type guard: check if Result is Err
 */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { ok: false; error: E } {
  return result.ok === false;
}

/**
 * Unwrap Result with default value
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Map over success value
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? Ok(fn(result.value)) : result;
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}
