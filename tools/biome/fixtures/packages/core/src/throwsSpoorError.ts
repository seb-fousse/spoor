// Rule 5: core throws SpoorErrors, and may rethrow an error it caught.
import { SpoorError } from "./lib/spoor-error";

export function check(name: string, id: string): void {
  if (name === "") {
    throw new SpoorError("invalid", `Thing ${id}: name is required`, {
      entity: "thing",
      id,
      field: "name",
    });
  }
}

export function rethrow(error: unknown): never {
  throw error;
}
