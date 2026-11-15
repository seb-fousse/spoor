// @vitest-environment jsdom
/**
 * Example: a component test, checking how it shows errors. Illustrates
 * docs/conventions/testing.md and docs/conventions/errors.md.
 *
 * Core's calls are stubbed, as in a hook test. It asserts what the user sees: the
 * error in words written for users, never core's message or an id.
 */
import { createQueryClient } from "@lib/queryClient";
import {
  type Database,
  listMetrics,
  type ObservationMetric,
  SpoorError,
  updateMetric,
} from "@spoor/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, waitFor } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenameMetric } from "./RenameMetric";

vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  listMetrics: vi.fn(),
  updateMetric: vi.fn(),
}));

// Never touched: every core call that would use it is stubbed.
const db = {} as Database;

const ID = "0b7f3c1e-5d2a-4e9f-8c61-2a7d9e4b1f03";
const sleep = { id: ID, name: "Sleep" } as ObservationMetric;

let root: TestRoot;
let queryClient: QueryClient;
let onDone: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.mocked(listMetrics).mockReset().mockResolvedValue([sleep]);
  vi.mocked(updateMetric).mockReset();
  queryClient = createQueryClient();
  onDone = vi.fn<() => void>();
  root = createTestRoot({ queryClient, db, mantine: true });
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
});

const alert = () => document.body.querySelector<HTMLElement>('[role="alert"]');

function save() {
  const button = root.container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error("No save button");
  act(() => button.click());
}

describe("RenameMetric", () => {
  it("words a refused save for users, and clears it on the next attempt", async () => {
    vi.mocked(updateMetric)
      .mockRejectedValueOnce(
        new SpoorError("conflict", `Observation metric ${ID}: name Sleep is used`, {
          entity: "observation_metric",
          id: ID,
          field: "name",
        }),
      )
      .mockResolvedValueOnce(sleep);
    await root.renderAsync(<RenameMetric metricId={ID} onDone={onDone} />);
    await waitFor(() => expect(root.container.querySelector("input")).not.toBeNull());

    save();
    await waitFor(() =>
      expect(alert()?.textContent).toBe("That name is already used. Choose another."),
    );
    expect(alert()?.textContent).not.toContain(ID);
    expect(onDone).not.toHaveBeenCalled();

    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(alert()).toBeNull();
  });

  it("titles a failed read with what was being done", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listMetrics).mockRejectedValue(new Error("SQLITE_BUSY"));
    await root.renderAsync(<RenameMetric metricId={ID} onDone={onDone} />);

    await waitFor(() => expect(alert()?.textContent).toContain("Could not load metrics"));
    expect(alert()?.textContent).not.toContain("SQLITE");
    // Not something the user caused, so ErrorAlert logged it in full.
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
