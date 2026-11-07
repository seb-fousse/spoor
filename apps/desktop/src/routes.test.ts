import { describe, expect, it } from "vitest";
import { parseRoute } from "./routes";

describe("parseRoute", () => {
  it("reads a known route from the hash", () => {
    expect(parseRoute("#/logs")).toBe("logs");
    expect(parseRoute("#settings")).toBe("settings");
  });

  it("defaults to home for an empty hash", () => {
    expect(parseRoute("")).toBe("home");
    expect(parseRoute("#/")).toBe("home");
  });

  it("defaults to home for an unknown hash", () => {
    expect(parseRoute("#/nowhere")).toBe("home");
  });
});
