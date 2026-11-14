// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import type { Database } from "@spoor/core";
import {
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
  useQuery,
} from "@tanstack/react-query";
import { createTestRoot, type TestRoot, tick } from "@test/render";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDbWrite } from "./useDbWrite";

// Handed to every write; the writes here never use it.
const db = {} as Database;

let root: TestRoot;
let queryClient: QueryClient;

// Cached reads with no component showing them, so invalidating only marks them stale.
const first = ["db", "test", "first"] as const;
const second = ["db", "test", "second"] as const;
const unrelated = ["db", "other"] as const;

const invalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;

beforeEach(() => {
  queryClient = createQueryClient();
  for (const key of [first, second, unrelated]) queryClient.setQueryData(key, "loaded");
  root = createTestRoot({ queryClient, db });
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
});

/** A promise the test settles when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type WriterProps<Vars, Result> = {
  write: (db: Database, vars: Vars) => Promise<Result>;
  options: Parameters<typeof useDbWrite<Vars, Result>>[1];
  /** Called with the mutation on each render. */
  onRender: (mutation: UseMutationResult<Result, Error, Vars>) => void;
};

/** A component writing through `useDbWrite`. */
function Writer<Vars, Result>({ write, options, onRender }: WriterProps<Vars, Result>) {
  onRender(useDbWrite(write, options));
  return null;
}

/** A component showing the query at `first`, so invalidating it refetches. */
function Reader({ queryFn }: { queryFn: () => Promise<string> }) {
  useQuery({ queryKey: first, queryFn });
  return null;
}

/**
 * Renders a component writing through `useDbWrite`, beside `children`;
 * returns its latest mutation.
 */
async function mount<Vars, Result>(
  write: WriterProps<Vars, Result>["write"],
  options: WriterProps<Vars, Result>["options"],
  children?: ReactNode,
) {
  let mutation: UseMutationResult<Result, Error, Vars> | undefined;
  await root.renderAsync(
    <>
      <Writer write={write} options={options} onRender={(m) => (mutation = m)} />
      {children}
    </>,
  );
  return () => {
    if (!mutation) throw new Error("The writer did not render");
    return mutation;
  };
}

describe("useDbWrite", () => {
  it("passes the database and the variables to the write, and invalidates the given keys", async () => {
    const write = vi.fn(async (_db: Database, id: string) => `wrote ${id}`);
    const mutation = await mount(write, { invalidates: [first, second] });

    let result: string | undefined;
    await act(async () => {
      result = await mutation().mutateAsync("a");
    });

    expect(write).toHaveBeenCalledWith(db, "a");
    expect(result).toBe("wrote a");
    expect(invalidated(first)).toBe(true);
    expect(invalidated(second)).toBe(true);
    expect(invalidated(unrelated)).toBe(false);
  });

  it("invalidates keys derived from the write's result and variables", async () => {
    const byResult = ["db", "test", "result", "r1"] as const;
    const byVars = ["db", "test", "vars", "v1"] as const;
    const otherVars = ["db", "test", "vars", "v2"] as const;
    for (const key of [byResult, byVars, otherVars]) queryClient.setQueryData(key, "loaded");
    const mutation = await mount(async (_db, id: string) => ({ id: "r1", from: id }), {
      invalidates: (result, vars) => [
        ["db", "test", "result", result.id],
        ["db", "test", "vars", vars],
      ],
    });

    await act(async () => {
      await mutation().mutateAsync("v1");
    });

    expect(invalidated(byResult)).toBe(true);
    expect(invalidated(byVars)).toBe(true);
    expect(invalidated(otherVars)).toBe(false);
    expect(invalidated(first)).toBe(false);
  });

  it("stays pending until the queries it invalidates have refetched", async () => {
    // The first load answers at once; the refetch waits until the test lets it finish.
    const refetch = deferred<string>();
    let fetches = 0;
    const queryFn = () => (fetches++ === 0 ? Promise.resolve("loaded") : refetch.promise);
    queryClient.removeQueries({ queryKey: first });
    const mutation = await mount(
      async (_db, _id: string) => {},
      { invalidates: [first] },
      <Reader queryFn={queryFn} />,
    );
    await tick();

    let settled = false;
    act(() => {
      void mutation()
        .mutateAsync("a")
        .then(() => {
          settled = true;
        });
    });
    await tick();
    await tick();

    expect(fetches).toBe(2);
    expect(settled).toBe(false);
    expect(mutation().isPending).toBe(true);

    await act(async () => {
      refetch.resolve("refetched");
      await refetch.promise;
    });
    await tick();

    expect(settled).toBe(true);
    expect(mutation().isSuccess).toBe(true);
    expect(queryClient.getQueryData(first)).toBe("refetched");
  });

  it("runs `update` before invalidating", async () => {
    const order: string[] = [];
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    invalidate.mockImplementation(async () => {
      order.push("invalidate");
    });
    const mutation = await mount(async (_db, id: string) => `stored ${id}`, {
      invalidates: [first],
      update: (client, result, vars) => {
        order.push("update");
        client.setQueryData(second, { result, vars });
      },
    });

    await act(async () => {
      await mutation().mutateAsync("a");
    });

    expect(order).toEqual(["update", "invalidate"]);
    expect(queryClient.getQueryData(second)).toEqual({ result: "stored a", vars: "a" });
  });

  it("sets the mutation's error and invalidates nothing when the write fails", async () => {
    const update = vi.fn();
    const mutation = await mount(
      async (_db, _id: string): Promise<string> => {
        throw new Error("Thing t1: not found");
      },
      { invalidates: [first, second], update },
    );

    await act(async () => {
      await mutation()
        .mutateAsync("t1")
        .catch(() => {});
    });
    await tick();

    expect(mutation().error?.message).toBe("Thing t1: not found");
    expect(update).not.toHaveBeenCalled();
    expect(invalidated(first)).toBe(false);
    expect(invalidated(second)).toBe(false);
  });
});
