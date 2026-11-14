import type { UseQueryResult } from "@tanstack/react-query";
import { describe, expectTypeOf, it } from "vitest";
import type { ReadResult } from "./readResult";

// Checked by `tsc` (`pnpm typecheck`), which compiles the tests too; at run time these do nothing.
describe("ReadResult", () => {
  it("takes any single query's result", () => {
    expectTypeOf<UseQueryResult<string[], Error>>().toExtend<ReadResult<string[]>>();
  });

  it("narrows on `status`, like a query's result", () => {
    expectTypeOf<Extract<ReadResult<string[]>, { status: "success" }>["data"]>().toEqualTypeOf<
      string[]
    >();
    expectTypeOf<Extract<ReadResult<string[]>, { status: "pending" }>["data"]>().toBeUndefined();
    expectTypeOf<
      Extract<ReadResult<string[]>, { status: "error" }>["error"]
    >().toEqualTypeOf<Error>();
  });

  it("doesn't take another data type's result", () => {
    expectTypeOf<UseQueryResult<number, Error>>().not.toExtend<ReadResult<string[]>>();
  });
});
