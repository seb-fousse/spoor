import { describe, expect, it } from "vitest";
import type { SpoorValueRule } from "../lib/spoor-error";
import { expectSpoorError } from "../testing/expect-spoor-error";
import {
  decodeValue,
  encodeValue,
  FIELD_VALUE_TYPES,
  METRIC_VALUE_TYPES,
  optionLabel,
  parseOptionLabels,
  parseShape,
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

  it("limits value types to the allowed ones", async () => {
    const valueType = { field: "valueType" };
    await expectSpoorError(
      () => parseShape(L, METRIC_VALUE_TYPES, "text", {}),
      "invalid",
      valueType,
    );
    await expectSpoorError(
      () => parseShape(L, FIELD_VALUE_TYPES, "multi_enum", {}),
      "invalid",
      valueType,
    );
    await expectSpoorError(() => shape("color"), "invalid", valueType);
  });

  it("names the definition it parses for in the details", async () => {
    await expectSpoorError(
      () => parseShape(L, VALUE_TYPES, "color", {}, { entity: "log_field", id: "f1" }),
      "invalid",
      { entity: "log_field", id: "f1", field: "valueType" },
    );
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
    ["boolean", { x: 1 }, "x"],
    ["number", { min: 2, max: 1 }, "min"],
    ["number", { min: Number.NaN }, "min"],
    ["number", { precision: 1.5 }, "precision"],
    ["number", { precision: 16 }, "precision"],
    ["number", { unit: " " }, "unit"],
    ["enum", { options: [] }, "options"],
    ["enum", {}, "options"],
    ["enum", { options: [{ key: "a", order: 1, label: "A" }] }, "options"],
    ["enum", { options: [{ key: " a", order: 1 }] }, "options"],
    ["enum", { options: [{ key: "a", order: 1.5 }] }, "options"],
    [
      "enum",
      {
        options: [
          { key: "a", order: 1 },
          { key: "a", order: 2 },
        ],
      },
      "options",
    ],
    [
      "enum",
      {
        options: [
          { key: "a", order: 1 },
          { key: "b", order: 1 },
        ],
      },
      "options",
    ],
    ["enum", { options: [{ key: "a", order: 1 }], minSelected: 1 }, "minSelected"],
    ["multi_enum", { options: [{ key: "a", order: 1 }], minSelected: 2 }, "minSelected"],
    [
      "multi_enum",
      { options: [{ key: "a", order: 1 }], minSelected: 1, maxSelected: 0 },
      "minSelected",
    ],
    ["text", { maxLength: -1 }, "maxLength"],
    ["date", { min: "2026-02-30" }, "min"],
    ["date", { min: "2026-02-02", max: "2026-02-01" }, "min"],
    ["ref", {}, "thingTypeId"],
    ["multi_ref", { thingTypeId: THING_TYPE.toUpperCase() }, "thingTypeId"],
  ])(
    "refuses invalid %s constraints %j, naming the constraint",
    async (type, constraints, constraint) => {
      await expectSpoorError(() => shape(type, constraints), "invalid", {
        field: "constraints",
        constraint,
      });
    },
  );

  it("refuses constraints that are not an object", async () => {
    await expectSpoorError(() => shape("number", []), "invalid", { field: "constraints" });
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

  it("refuses blank or non-string labels", async () => {
    const optionLabels = { field: "optionLabels" };
    await expectSpoorError(() => parseOptionLabels(L, { good: "" }), "invalid", optionLabels);
    await expectSpoorError(() => parseOptionLabels(L, { good: 1 }), "invalid", optionLabels);
    await expectSpoorError(() => parseOptionLabels(L, ["good"]), "invalid", optionLabels);
  });

  it("falls back to the key", () => {
    expect(optionLabel({ good: "Good" }, "good")).toBe("Good");
    expect(optionLabel({}, "bad")).toBe("bad");
  });
});

describe("validateValue", () => {
  const ok = (s: ValueShape, value: unknown) => expect(validateValue(L, s, value)).toEqual(value);
  /** Asserts the value is refused by `rule`, with `limit` if given, and no other details. */
  const bad = async (
    s: ValueShape,
    value: unknown,
    rule: SpoorValueRule,
    limit?: number | string,
  ) => {
    const error = await expectSpoorError(() => validateValue(L, s, value), "invalid");
    expect(error.details).toEqual(limit === undefined ? { rule } : { rule, limit });
  };

  it("checks booleans without coercing", async () => {
    ok(shape("boolean"), false);
    await bad(shape("boolean"), 0, "type");
  });

  it("checks numbers against bounds and precision", async () => {
    const cups = shape("number", { min: 0, max: 10, precision: 1 });
    ok(cups, 0);
    ok(cups, 2.5);
    await bad(cups, -1, "min", 0);
    await bad(cups, 11, "max", 10);
    await bad(cups, 2.55, "precision", 1);
    await bad(cups, Number.POSITIVE_INFINITY, "type");
    await bad(cups, "2", "type");
    await bad(shape("number", { precision: 2 }), 0.1 + 0.2, "precision", 2);
  });

  it("checks enum keys", async () => {
    ok(mood, "good");
    await bad(mood, "meh", "option");
    await bad(mood, 1, "option");
  });

  it("names the value's record and field in the details", async () => {
    const details = { entity: "log_entry", id: "e1", field: "values", fieldId: "f1" } as const;
    await expectSpoorError(() => validateValue(L, mood, "meh", details), "invalid", {
      ...details,
      rule: "option",
    });
  });

  it("checks multi_enum selections", async () => {
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
    await bad(symptoms, ["a", "b", "c"], "maxSelected", 2);
    await bad(symptoms, ["a", "a"], "unique");
    await bad(symptoms, ["z"], "option");
    await bad(symptoms, "a", "type");
    await bad(
      shape("multi_enum", { options: [{ key: "a", order: 1 }], minSelected: 1 }),
      [],
      "minSelected",
      1,
    );
  });

  it("checks text, keeping the empty string distinct from missing", async () => {
    ok(shape("text"), "");
    ok(shape("text", { maxLength: 3 }), "abc");
    await bad(shape("text", { maxLength: 3 }), "abcd", "maxLength", 3);
    await bad(shape("text", { minLength: 1 }), "", "minLength", 1);
    await bad(shape("text"), 3, "type");
  });

  it("checks dates and their bounds", async () => {
    const d = shape("date", { min: "2000-01-01" });
    ok(d, "2026-10-27");
    await bad(d, "1999-12-31", "min", "2000-01-01");
    await bad(d, "2026-13-01", "type");
    await bad(shape("date", { max: "2000-01-01" }), "2000-01-02", "max", "2000-01-01");
  });

  it("checks datetimes are representable instants", async () => {
    ok(shape("datetime"), Date.UTC(2026, 9, 27));
    await bad(shape("datetime"), 1.5, "type");
    await bad(shape("datetime"), 300_000_000_000_000, "range");
  });

  it("checks references are thing ids", async () => {
    const ref = shape("ref", { thingTypeId: THING_TYPE });
    const multi = shape("multi_ref", { thingTypeId: THING_TYPE });
    ok(ref, THING_TYPE);
    await bad(ref, "alex", "type");
    ok(multi, [THING_TYPE]);
    ok(multi, []);
    await bad(multi, [THING_TYPE, THING_TYPE], "unique");
    await bad(multi, ["alex"], "type");
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

  it("encodes into only the columns a table has", async () => {
    const columns = ["value_bool", "value_num", "value_enum"] as const;
    expect(encodeValue("number", 3, columns)).toEqual({
      value_bool: null,
      value_num: 3,
      value_enum: null,
    });
    await expectSpoorError(() => encodeValue("text", "x", columns), "internal");
  });

  it("refuses to decode a missing value, as corrupt data", async () => {
    await expectSpoorError(() => decodeValue(L, "number", { value_num: null }), "internal");
    await expectSpoorError(() => decodeValue(L, "text", {}), "internal");
  });
});
