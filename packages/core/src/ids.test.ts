import { afterEach, describe, expect, it, vi } from "vitest";
import { isUuid, newId } from "./ids";

afterEach(() => {
  vi.useRealTimers();
});

describe("newId", () => {
  it("returns a lowercase hyphenated UUID v7 with the RFC 9562 variant", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuid(id)).toBe(true);
  });

  it("encodes the current Unix milliseconds in the first 48 bits", () => {
    vi.useFakeTimers();
    const ms = Date.UTC(2026, 9, 24, 18, 0, 0, 123);
    vi.setSystemTime(ms);
    const id = newId();
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(ms);
  });

  it("sorts lexicographically by creation time across milliseconds", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 1);
    const ids = [0, 1, 2, 255, 256, 65_536, 2 ** 32].map((offset) => {
      vi.setSystemTime(start + offset);
      return newId();
    });
    expect([...ids].sort()).toEqual(ids);
  });

  it("does not repeat over many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });
});

describe("isUuid", () => {
  it("accepts lowercase canonical UUIDs of any version", () => {
    expect(isUuid("0192d5f0-6c00-7abc-8def-0123456789ab")).toBe(true); // v7
    expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true); // v4
    expect(isUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true); // v1
  });

  it("rejects uppercase, which is not the storage form", () => {
    expect(isUuid("F47AC10B-58CC-4372-A567-0E02B2C3D479")).toBe(false);
  });

  it("rejects malformed strings, nil/max UUIDs and wrong variants", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("f47ac10b58cc4372a5670e02b2c3d479")).toBe(false);
    expect(isUuid("{f47ac10b-58cc-4372-a567-0e02b2c3d479}")).toBe(false);
    expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d47")).toBe(false);
    expect(isUuid("f47ac10b-58cc-4372-c567-0e02b2c3d479")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isUuid("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
