// @vitest-environment jsdom

import { createQueryClient } from "@lib/queryClient";
import {
  type Database,
  getTimeZone,
  type LocalDate,
  type LogField,
  SpoorError,
  startOfDay,
  type Value,
} from "@spoor/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, waitFor } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogEntryForm } from "./LogEntryForm";

// The form's job here is which zone it reads a datetime in, so only the setting is stubbed.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  getTimeZone: vi.fn(),
}));

// Never touched: the one core call that would use it is stubbed.
const db = {} as Database;

const started = {
  id: "started",
  name: "Started",
  required: false,
  optionLabels: {},
  shape: { valueType: "datetime", constraints: {} },
} as Partial<LogField> as LogField;

let root: TestRoot;
let queryClient: QueryClient;
let onCreate: ReturnType<typeof vi.fn<(time: unknown, values: Record<string, Value>) => void>>;

function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button`);
  return found;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The input its label names. */
function labelled(name: string): HTMLElement {
  const label = [...document.body.querySelectorAll("label")].find(
    (l) => l.textContent?.trim() === name,
  );
  const found = label && document.getElementById(label.htmlFor);
  if (!found) throw new Error(`No "${name}" input`);
  return found;
}

/** Opens the Started picker and picks the first day of the month it shows, at 00:00. */
async function pickFirstOfMonth(): Promise<LocalDate> {
  act(() => labelled("Started").click());
  const day = await waitFor(() => {
    const found = document.body.querySelector<HTMLButtonElement>(
      "button[aria-label^='1 ']:not([data-outside])",
    );
    if (!found) throw new Error("No first of the month");
    return found;
  });
  // Its label is "1 November 2026".
  const [, month, year] = (day.getAttribute("aria-label") ?? "").split(" ");
  const monthNumber = MONTHS.indexOf(month) + 1;
  act(() => day.click());
  return `${year}-${String(monthNumber).padStart(2, "0")}-01`;
}

beforeEach(() => {
  queryClient = createQueryClient();
  onCreate = vi.fn();
  root = createTestRoot({ queryClient, db, mantine: true });
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
  vi.resetAllMocks();
});

describe("LogEntryForm", () => {
  // The device has one zone, so at least one of these differs from it, whichever it is.
  for (const zone of ["Pacific/Auckland", "America/Los_Angeles"]) {
    it(`reads a picked datetime in the time_zone setting (${zone}), not the device's`, async () => {
      vi.mocked(getTimeZone).mockResolvedValue(zone);
      root.render(<LogEntryForm fields={[started]} child layout="stacked" onCreate={onCreate} />);
      await waitFor(() => expect(button("Add").disabled).toBe(false));

      const date = await pickFirstOfMonth();
      act(() => button("Add").click());

      expect(onCreate).toHaveBeenCalledWith({}, { started: startOfDay(date, zone) });
    });
  }

  it("can't add until the setting loads, and shows why when it fails", async () => {
    vi.mocked(getTimeZone).mockRejectedValue(new SpoorError("not_found", "no zone"));
    root.render(<LogEntryForm fields={[started]} child layout="stacked" onCreate={onCreate} />);
    expect(button("Add").disabled).toBe(true);

    await waitFor(() => expect(document.body.querySelector('[role="alert"]')).not.toBeNull());
    expect(button("Add").disabled).toBe(true);
  });
});
