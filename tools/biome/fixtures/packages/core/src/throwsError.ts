// Rule 5: core throws only SpoorError, so a plain Error is reported, with or without a
// message, built where it is thrown or ahead of it, with or without `new`.
export function check(name: string, id: string): void {
  if (name === "") throw new Error(`Thing ${id}: name is required`); // lint-expect: plugin "SpoorError"
  if (id === "") {
    throw new Error(); // lint-expect: plugin "SpoorError"
  }
  if (id === name) throw Error("same"); // lint-expect: plugin "SpoorError"
}

export const fail = (cause: unknown) => new Error("Migration failed", { cause }); // lint-expect: plugin "SpoorError"
