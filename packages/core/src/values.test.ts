import { describe, expect, it } from "vitest";
import {
  decodeValue,
  encodeValue,
  FIELD_VALUE_TYPES,
  METRIC_VALUE_TYPES,
  optionLabel,
  parseOptionLabels,
  parseShape,
  sameShape,
  VALUE_TYPES,
  type ValueShape,
  validateValue,
} from "./values";

const L = "Field f1";
const THING_TYPE = "0190abcd-0000-7000-8000-00000000000f";
const shape = (valueType: string, constraints?: unknown) =>
  parseShape(L, VALUE_TYPES, valueType, constraints);
const mood = shape("enum", {
  options: [
    { key: "good", order: 2, score: 5 },
    { key: "bad", order: 1, score: 1 },
  ],
});

describe("parseShape", () => {
  it("accepts every value type with no constraints where none are required", () => {
    for (const t of ["boolean", "number", "text", "date", "datetime"]) {
      expect(shape(t)).toEqual({ valueType: t, constraints: {} });
    }
  });

  it("limits value types to the allowed ones", () => {
    expect(() => parseShape(L, METRIC_VALUE_TYPES, "text", {})).toThrow(
      "Field f1: value type must be one of boolean, number, enum, multi_enum",
    );
    expect(() => parseShape(L, FIELD_VALUE_TYPES, "multi_enum", {})).toThrow(/value type/);
    expect(() => shape("color")).toThrow(/value type/);
  });

  it("canonicalises: known keys in a fixed order, options sorted, no undefined", () => {
    expect(shape("number", { precision: 1, max: 10, min: 0, unit: " kg " })).toEqual({
      valueType: "number",
      constraints: { unit: "kg", min: 0, max: 10, precision: 1 },
    });
    expect(mood.constraints).toEqual({
      options: [
        { key: "bad", order: 1, score: 1 },
        { key: "good", order: 2, score: 5 },
      ],
    });
    expect(JSON.stringify(shape("number", { max: 1, min: 0 }).constraints)).toBe(
      '{"min":0,"max":1}',
    );
  });

  it.each([
    ["boolean", { x: 1 }, /unknown boolean constraint "x"/],
    ["number", { min: 2, max: 1 }, /min must not be greater than max/],
    ["number", { min: Number.NaN }, /min must be a number/],
    ["number", { precision: 1.5 }, /precision must be a whole number/],
    ["number", { unit: " " }, /unit must be a non-empty string/],
    ["enum", { options: [] }, /options must be a non-empty array/],
    ["enum", {}, /options must be a non-empty array/],
    ["enum", { options: [{ key: "a", order: 1, label: "A" }] }, /unknown field "label"/],
    ["enum", { options: [{ key: " a", order: 1 }] }, /key must be a non-empty string/],
    ["enum", { options: [{ key: "a", order: 1.5 }] }, /order must be an integer/],
    [
      "enum",
      {
        options: [
          { key: "a", order: 1 },
          { key: "a", order: 2 },
        ],
      },
      /keys must be unique/,
    ],
    [
      "enum",
      {
        options: [
          { key: "a", order: 1 },
          { key: "b", order: 1 },
        ],
      },
      /orders must be unique/,
    ],
    ["enum", { options: [{ key: "a", order: 1 }], minSelected: 1 }, /unknown enum constraint/],
    [
      "multi_enum",
      { options: [{ key: "a", order: 1 }], minSelected: 2 },
      /minSelected must not exceed the number of options/,
    ],
    [
      "multi_enum",
      { options: [{ key: "a", order: 1 }], minSelected: 1, maxSelected: 0 },
      /minSelected must not be greater than maxSelected/,
    ],
    ["text", { maxLength: -1 }, /maxLength must be a whole number/],
    ["date", { min: "2026-02-30" }, /min must be a YYYY-MM-DD date/],
    ["date", { min: "2026-02-02", max: "2026-02-01" }, /min must not be greater than max/],
    ["ref", {}, /thingTypeId must be a lowercase UUID/],
    ["multi_ref", { thingTypeId: THING_TYPE.toUpperCase() }, /thingTypeId/],
  ])("refuses invalid %s constraints %j", (type, constraints, error) => {
    expect(() => shape(type, constraints)).toThrow(error);
  });

  it("refuses constraints that are not an object", () => {
    expect(() => shape("number", [])).toThrow("Field f1: constraints must be an object");
  });
});

describe("sameShape", () => {
  it("is true only when type and constraints match", () => {
    const a = shape("number", { min: 0, max: 5 });
    expect(sameShape(a, shape("number", { max: 5, min: 0 }))).toBe(true);
    expect(sameShape(a, shape("number", { min: 0, max: 6 }))).toBe(false);
    expect(
      sameShape(
        shape("ref", { thingTypeId: THING_TYPE }),
        shape("multi_ref", { thingTypeId: THING_TYPE }),
      ),
    ).toBe(false);
  });

  it("treats an option change as a new shape", () => {
    const moved = shape("enum", {
      options: [
        { key: "good", order: 1, score: 5 },
        { key: "bad", order: 2, score: 1 },
      ],
    });
    expect(sameShape(mood, moved)).toBe(false);
  });
});

describe("option labels", () => {
  it("parses labels, trimmed, for any key", () => {
    expect(parseOptionLabels(L, { good: " Good ", retired: "Old" })).toEqual({
      good: "Good",
      retired: "Old",
    });
    expect(parseOptionLabels(L, undefined)).toEqual({});
  });

  it("refuses blank or non-string labels", () => {
    expect(() => parseOptionLabels(L, { good: "" })).toThrow(/label for option "good"/);
    expect(() => parseOptionLabels(L, { good: 1 })).toThrow(/label for option "good"/);
    expect(() => parseOptionLabels(L, ["good"])).toThrow(/must be an object/);
  });

  it("falls back to the key", () => {
    expect(optionLabel({ good: "Good" }, "good")).toBe("Good");
    expect(optionLabel({}, "bad")).toBe("bad");
  });
});

describe("validateValue", () => {
  const ok = (s: ValueShape, value: unknown) => expect(validateValue(L, s, value)).toEqual(value);
  const bad = (s: ValueShape, value: unknown, error: RegExp) =>
    expect(() => validateValue(L, s, value)).toThrow(error);

  it("checks booleans without coercing", () => {
    ok(shape("boolean"), false);
    bad(shape("boolean"), 0, /^Field f1: must be true or false$/);
  });

  it("checks numbers against bounds and precision", () => {
    const cups = shape("number", { min: 0, max: 10, precision: 1 });
    ok(cups, 0);
    ok(cups, 2.5);
    bad(cups, -1, /at least 0/);
    bad(cups, 11, /at most 10/);
    bad(cups, 2.55, /at most 1 decimal places/);
    bad(cups, Number.POSITIVE_INFINITY, /must be a number/);
    bad(cups, "2", /must be a number/);
    bad(shape("number", { precision: 2 }), 0.1 + 0.2, /decimal places/);
  });

  it("checks enum keys", () => {
    ok(mood, "good");
    bad(mood, "meh", /"meh" is not an option/);
    bad(mood, 1, /is not an option/);
  });

  it("checks multi_enum selections", () => {
    const symptoms = shape("multi_enum", {
      options: [
        { key: "a", order: 1 },
        { key: "b", order: 2 },
        { key: "c", order: 3 },
      ],
      maxSelected: 2,
    });
    ok(symptoms, []);
    ok(symptoms, ["b", "a"]);
    bad(symptoms, ["a", "b", "c"], /at most 2/);
    bad(symptoms, ["a", "a"], /must not repeat/);
    bad(symptoms, ["z"], /"z" is not an option/);
    bad(symptoms, "a", /must be an array/);
    bad(
      shape("multi_enum", { options: [{ key: "a", order: 1 }], minSelected: 1 }),
      [],
      /at least 1/,
    );
  });

  it("checks text, keeping the empty string distinct from missing", () => {
    ok(shape("text"), "");
    ok(shape("text", { maxLength: 3 }), "abc");
    bad(shape("text", { maxLength: 3 }), "abcd", /at most 3 characters/);
    bad(shape("text", { minLength: 1 }), "", /at least 1 characters/);
    bad(shape("text"), 3, /must be a string/);
  });

  it("checks dates and their bounds", () => {
    const d = shape("date", { min: "2000-01-01" });
    ok(d, "2026-10-27");
    bad(d, "1999-12-31", /on or after 2000-01-01/);
    bad(d, "2026-13-01", /YYYY-MM-DD/);
    bad(shape("date", { max: "2000-01-01" }), "2000-01-02", /on or before/);
  });

  it("checks datetimes are representable instants", () => {
    ok(shape("datetime"), Date.UTC(2026, 9, 27));
    bad(shape("datetime"), 1.5, /epoch milliseconds/);
    bad(shape("datetime"), 300_000_000_000_000, /years 0000 and 9999/);
  });

  it("checks references are thing ids", () => {
    const ref = shape("ref", { thingTypeId: THING_TYPE });
    const multi = shape("multi_ref", { thingTypeId: THING_TYPE });
    ok(ref, THING_TYPE);
    bad(ref, "alex", /must be a thing id/);
    ok(multi, [THING_TYPE]);
    ok(multi, []);
    bad(multi, [THING_TYPE, THING_TYPE], /must not repeat/);
    bad(multi, ["alex"], /"alex" is not a thing id/);
  });
});

describe("encodeValue and decodeValue", () => {
  it.each([
    ["boolean", true, "value_bool", 1],
    ["boolean", false, "value_bool", 0],
    ["number", 2.5, "value_num", 2.5],
    ["enum", "good", "value_enum", "good"],
    ["text", "", "value_text", ""],
    ["date", "2026-10-27", "value_date", "2026-10-27"],
    ["datetime", 1_790_000_000_000, "value_instant", 1_790_000_000_000],
    ["ref", THING_TYPE, "value_ref", THING_TYPE],
  ] as const)("stores %s %j in %s alone and reads it back", (type, value, column, stored) => {
    const row = encodeValue(type, value);
    expect(row).toEqual({
      value_bool: null,
      value_num: null,
      value_enum: null,
      value_text: null,
      value_date: null,
      value_instant: null,
      value_ref: null,
      [column]: stored,
    });
    expect(decodeValue(L, type, row)).toEqual(value);
  });

  it("encodes into only the columns a table has", () => {
    const columns = ["value_bool", "value_num", "value_enum"] as const;
    expect(encodeValue("number", 3, columns)).toEqual({
      value_bool: null,
      value_num: 3,
      value_enum: null,
    });
    expect(() => encodeValue("text", "x", columns)).toThrow(
      "No value_text column for a text value",
    );
  });

  it("refuses to decode a missing value", () => {
    expect(() => decodeValue(L, "number", { value_num: null })).toThrow(
      "Field f1: no number value stored",
    );
    expect(() => decodeValue(L, "text", {})).toThrow(/no text value/);
  });
});
