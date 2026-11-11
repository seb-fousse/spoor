import { describe, expect, it } from "vitest";
import { completeness, completenessLabel } from "./completeness";

describe("completeness", () => {
  it("is complete when every metric is recorded", () => {
    expect(completeness({ recorded: 7, total: 7 })).toBe("complete");
    expect(completeness({ recorded: 1, total: 1 })).toBe("complete");
  });

  it("is partial when some are recorded", () => {
    expect(completeness({ recorded: 3, total: 7 })).toBe("partial");
    expect(completeness({ recorded: 6, total: 7 })).toBe("partial");
  });

  it("is empty when none are recorded", () => {
    expect(completeness({ recorded: 0, total: 7 })).toBe("empty");
  });

  it("is null when there are no metrics", () => {
    expect(completeness({ recorded: 0, total: 0 })).toBeNull();
  });
});

describe("completenessLabel", () => {
  it("reads the count out in words", () => {
    expect(completenessLabel({ recorded: 3, total: 7 })).toBe("3 of 7 observations recorded");
    expect(completenessLabel({ recorded: 0, total: 1 })).toBe("0 of 1 observation recorded");
  });
});
