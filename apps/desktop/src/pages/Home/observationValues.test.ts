import type { MetricDay, Observation, ObservationMetric } from "@spoor/core";
import { describe, expect, it } from "vitest";
import {
  atMaximum,
  countRecorded,
  meetsMinimum,
  normalizeNumber,
  stepNumber,
  toggleOption,
} from "./observationValues";

const OPTIONS = ["a", "b", "c"].map((key, order) => ({ key, order }));

describe("countRecorded", () => {
  it("counts the metrics with a value out of all of them", () => {
    const item = (recorded: boolean) =>
      ({
        metric: {} as ObservationMetric,
        observation: recorded ? ({} as Observation) : null,
      }) satisfies MetricDay;
    expect(countRecorded([item(true), item(false), item(true)])).toEqual({
      recorded: 2,
      total: 3,
    });
    expect(countRecorded([])).toEqual({ recorded: 0, total: 0 });
  });
});

describe("normalizeNumber", () => {
  it("leaves an unconstrained number alone", () => {
    expect(normalizeNumber(1.23456, {})).toBe(1.23456);
  });

  it("clamps to min and max", () => {
    expect(normalizeNumber(-3, { min: 0, max: 10 })).toBe(0);
    expect(normalizeNumber(12, { min: 0, max: 10 })).toBe(10);
    expect(normalizeNumber(4, { min: 0, max: 10 })).toBe(4);
  });

  it("rounds to the precision, the way core checks it", () => {
    expect(normalizeNumber(2.345, { precision: 0 })).toBe(2);
    expect(normalizeNumber(2.36, { precision: 1 })).toBe(2.4);
    const value = normalizeNumber(0.1 + 0.2, { precision: 2 });
    expect(value).toBe(0.3);
    expect(Number(value.toFixed(2))).toBe(value);
  });

  it("stays inside a range whose bounds are finer than the precision", () => {
    expect(normalizeNumber(1.26, { max: 1.25, precision: 1 })).toBe(1.2);
    expect(normalizeNumber(0, { min: 0.25, precision: 1 })).toBe(0.3);
    expect(normalizeNumber(1.2, { min: 1.15, max: 1.25, precision: 1 })).toBe(1.2);
  });
});

describe("stepNumber", () => {
  it("steps by one from the current value", () => {
    expect(stepNumber(3, 1, {})).toBe(4);
    expect(stepNumber(3, -1, {})).toBe(2);
    expect(stepNumber(1.5, 1, { precision: 1 })).toBe(2.5);
  });

  it("starts an unrecorded day from 0, brought into range", () => {
    expect(stepNumber(null, 1, {})).toBe(1);
    expect(stepNumber(null, -1, { min: 0 })).toBe(0);
    expect(stepNumber(null, 1, { min: 5 })).toBe(6);
  });

  it("does not step past the bounds", () => {
    expect(stepNumber(10, 1, { max: 10 })).toBe(10);
    expect(stepNumber(0.5, -1, { min: 0 })).toBe(0);
  });
});

describe("multi_enum selections", () => {
  it("toggles an option, keeping option order", () => {
    expect(toggleOption(["c"], "a", { options: OPTIONS })).toEqual(["a", "c"]);
    expect(toggleOption(["a", "c"], "a", { options: OPTIONS })).toEqual(["c"]);
  });

  it("drops keys that are no longer options", () => {
    expect(toggleOption(["gone"], "b", { options: OPTIONS })).toEqual(["b"]);
  });

  it("knows when a selection can be recorded and when it is full", () => {
    const c = { options: OPTIONS, minSelected: 1, maxSelected: 2 };
    expect(meetsMinimum([], c)).toBe(false);
    expect(meetsMinimum(["a"], c)).toBe(true);
    expect(meetsMinimum([], { options: OPTIONS })).toBe(true);
    expect(atMaximum(["a"], c)).toBe(false);
    expect(atMaximum(["a", "b"], c)).toBe(true);
    expect(atMaximum(["a", "b", "c"], { options: OPTIONS })).toBe(false);
  });
});
