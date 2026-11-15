// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { useGridData } from "@pages/Home/grid/useGridData";
import {
  createCategory,
  createThing,
  createThingType,
  createTimeline,
  updateThingValues,
} from "@spoor/core";
import { createTestDatabase } from "@test/database";
import { renderHook, run, waitFor } from "@test/render";
import { describe, expect, it } from "vitest";
import { useThingWrite } from "./things";

// The hooks on core's real database: a write has to reach the reads already on screen.

const DAYS = ["2026-11-08", "2026-11-09", "2026-11-10"];

describe("renaming a thing", () => {
  it("renames the grid's category that takes its title", async () => {
    const db = await createTestDatabase();
    const project = await createThingType(db, {
      name: "Project",
      fields: [{ name: "Name", valueType: "text", required: true }],
    });
    const spoor = await createThing(db, {
      thingTypeId: project.id,
      values: { [project.titleFieldId]: "Spoor" },
    });
    const timeline = await createTimeline(db, { name: "Projects", exclusive: true });
    const category = await createCategory(db, timeline.id, { thingId: spoor.id });

    const hooks = await renderHook(() => ({ grid: useGridData(DAYS), write: useThingWrite() }), {
      db,
      queryClient: createQueryClient(),
    });
    const name = () => hooks.current.grid.data?.categories.get(category.id)?.name;
    await waitFor(() => expect(name()).toBe("Spoor"));

    // As the Things page saves an edited thing.
    await run(() =>
      hooks.current.write(
        () => updateThingValues(db, spoor.id, { [project.titleFieldId]: "Spoor app" }),
        "titles",
      ),
    );

    expect(name()).toBe("Spoor app");
  });
});
