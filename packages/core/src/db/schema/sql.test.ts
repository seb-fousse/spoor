import { describe, expect, it } from "vitest";
import { splitStatements } from "./sql";

describe("splitStatements", () => {
  it("splits on a semicolon that ends a line", () => {
    expect(splitStatements("CREATE TABLE a (id TEXT);\nCREATE TABLE b (id TEXT);\n")).toEqual([
      "CREATE TABLE a (id TEXT)",
      "CREATE TABLE b (id TEXT)",
    ]);
  });

  it("keeps a multi-line statement intact", () => {
    const sql = "CREATE TABLE a (\n  id TEXT,\n  name TEXT\n) STRICT;\n";
    expect(splitStatements(sql)).toEqual(["CREATE TABLE a (\n  id TEXT,\n  name TEXT\n) STRICT"]);
  });

  it("allows whitespace after the semicolon", () => {
    expect(splitStatements("SELECT 1;  \t\r\nSELECT 2; \n")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("accepts a last statement without a semicolon", () => {
    expect(splitStatements("SELECT 1;\nSELECT 2\n")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("drops pieces that are only comments or blank lines", () => {
    const sql = "SELECT 1;\n\n-- between;\n\n-- trailing note\n";
    expect(splitStatements(sql)).toEqual(["SELECT 1"]);
  });

  it("keeps comments that lead into a statement", () => {
    expect(splitStatements("-- why\nSELECT 1;\n")).toEqual(["-- why\nSELECT 1"]);
  });

  it("does not end a statement at a semicolon in a comment line", () => {
    expect(splitStatements("SELECT\n  -- one; two;\n  1;\n")).toEqual([
      "SELECT\n  -- one; two;\n  1",
    ]);
  });

  it("returns nothing for an empty script", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("\n-- nothing here;\n\n")).toEqual([]);
  });
});
