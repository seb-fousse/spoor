import { describe, expect, it } from "vitest";
import { expectSpoorError } from "../testing/expect-spoor-error";
import { isSpoorError, parseStored, SpoorError } from "./spoor-error";

describe("SpoorError", () => {
  it("is an Error with a name, a code and details", () => {
    const error = new SpoorError("not_found", "Thing t1: not found", { entity: "thing", id: "t1" });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SpoorError");
    expect(error.code).toBe("not_found");
    expect(error.message).toBe("Thing t1: not found");
    expect(error.details).toEqual({ entity: "thing", id: "t1" });
  });

  it("defaults to no details, and keeps a cause", () => {
    const cause = new Error("disk full");
    const error = new SpoorError("internal", "Migration 1 failed", undefined, { cause });
    expect(error.details).toEqual({});
    expect(error.cause).toBe(cause);
  });

  it("is told apart from other errors", () => {
    expect(isSpoorError(new SpoorError("invalid", "x"))).toBe(true);
    expect(isSpoorError(new Error("x"))).toBe(false);
    expect(isSpoorError({ code: "invalid", message: "x" })).toBe(false);
    expect(isSpoorError(undefined)).toBe(false);
  });
});

describe("parseStored", () => {
  it("returns what the parser returns", () => {
    expect(parseStored(() => 42)).toBe(42);
  });

  it("rethrows an invalid error as internal, keeping the record and the cause", async () => {
    const invalid = new SpoorError("invalid", "Thing field f1: bad", {
      entity: "thing_field",
      id: "f1",
      field: "constraints",
    });
    const error = await expectSpoorError(
      () =>
        parseStored(() => {
          throw invalid;
        }),
      "internal",
    );
    expect(error.details).toEqual({ entity: "thing_field", id: "f1" });
    expect(error.cause).toBe(invalid);
  });

  it("lets any other error through unchanged", () => {
    const syntax = new SyntaxError("Unexpected token");
    expect(() =>
      parseStored(() => {
        throw syntax;
      }),
    ).toThrow(syntax);
  });
});
