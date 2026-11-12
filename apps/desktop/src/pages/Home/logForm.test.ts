import type { LogType } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { childTypes, topLevelTypes } from "./logForm";

const type = (
  id: string,
  parentTypeId: string | null,
  archivedAt: number | null = null,
): LogType => ({
  id,
  name: id,
  description: null,
  parentTypeId,
  createdAt: 0,
  updatedAt: 0,
  archivedAt,
});

describe("log type choices", () => {
  const types = [
    type("workout", null),
    type("set", "workout"),
    type("old-set", "workout", 5),
    type("movie", null),
    type("old", null, 5),
  ];

  it("offers live top-level types", () => {
    expect(topLevelTypes(types).map((t) => t.id)).toEqual(["workout", "movie"]);
  });

  it("finds the live child types of a type", () => {
    expect(childTypes(types, "workout").map((t) => t.id)).toEqual(["set"]);
    expect(childTypes(types, "movie")).toEqual([]);
  });
});
