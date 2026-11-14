// @vitest-environment jsdom
import type { Database } from "@spoor/core";
import { createTestRoot } from "@test/render";
import { describe, expect, it, vi } from "vitest";
import { useDatabase } from "./DatabaseProvider";

describe("useDatabase", () => {
  it("is the database of the enclosing provider", () => {
    const db = {} as Database;
    let seen: Database | undefined;
    function Probe() {
      seen = useDatabase();
      return null;
    }
    const root = createTestRoot({ db });
    root.render(<Probe />);
    root.unmount();
    expect(seen).toBe(db);
  });

  it("throws outside a provider, so a missing one fails loudly", () => {
    // React logs the render error; it is expected here.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useDatabase();
      return null;
    }
    const root = createTestRoot();
    expect(() => root.render(<Probe />)).toThrow("inside a DatabaseProvider");
    root.unmount();
    error.mockRestore();
  });
});
