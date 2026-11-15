import { expect } from "vitest";
import { SpoorError, type SpoorErrorCode, type SpoorErrorDetails } from "../lib/spoor-error";

/**
 * Asserts that `run` throws, or rejects with, a `SpoorError` with `code`, and with
 * `details` among its details if they are given. `run` is a function, called
 * here, or a promise. Returns the error, for any further checks.
 *
 * Tests assert the code, and the details where they are the point, never the
 * message: the message is for developers and free to change.
 */
export async function expectSpoorError(
  run: (() => unknown) | Promise<unknown>,
  code: SpoorErrorCode,
  details?: SpoorErrorDetails,
): Promise<SpoorError> {
  let thrown: unknown;
  try {
    await (typeof run === "function" ? run() : run);
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof SpoorError)) {
    expect.fail(`expected a SpoorError "${code}", got ${thrown === undefined ? "none" : thrown}`);
  }
  expect(thrown.code, thrown.message).toBe(code);
  if (details !== undefined) expect(thrown.details, thrown.message).toMatchObject(details);
  return thrown;
}
