// @vitest-environment jsdom
import { SpoorError } from "@spoor/core";
import { createTestRoot, type TestRoot } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ErrorAlert } from "./ErrorAlert";

const ID = "0b7f3c1e-5d2a-4e9f-8c61-2a7d9e4b1f03";
const archived = new SpoorError("archived", `Timeline ${ID}: archived`, {
  entity: "timeline",
  id: ID,
});

let root: TestRoot;
let logged: MockInstance<typeof console.error>;

beforeEach(() => {
  root = createTestRoot({ mantine: true });
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  root.unmount();
  logged.mockRestore();
});

function alert(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[role="alert"]');
  if (!found) throw new Error("No alert");
  return found;
}

describe("ErrorAlert", () => {
  it("words a SpoorError for users, without its message or ids, and logs nothing", () => {
    root.render(<ErrorAlert error={archived} />);

    expect(alert().textContent).toBe("This timeline is archived, so it can't be changed.");
    expect(alert().textContent).not.toContain(ID);
    expect(logged).not.toHaveBeenCalled();
  });

  it("titles the alert with what was being done, over the error's own title", () => {
    const newer = new SpoorError("newer_version", "Database version 3 > 2", { version: 3 });
    root.render(<ErrorAlert title="Could not open the database" error={newer} />);

    expect(alert().textContent).toBe(
      "Could not open the database" +
        "This data was saved by a newer version of Spoor. Update Spoor to open it.",
    );
  });

  it("says something went wrong for an unknown error, and logs it once in full", () => {
    const bug = new Error(`SQLITE_CONSTRAINT: thing ${ID}`);
    root.render(<ErrorAlert error={bug} />);
    root.render(<ErrorAlert error={bug} m="md" />);

    expect(alert().textContent).toContain("Something went wrong");
    expect(alert().textContent).not.toContain("SQLITE");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(bug);
  });

  it("passes a close button through to the alert", () => {
    const onClose = vi.fn();
    root.render(
      <ErrorAlert error={archived} withCloseButton closeButtonLabel="Dismiss" onClose={onClose} />,
    );

    const close = alert().querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
