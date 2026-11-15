// Rule 5: tests may throw plain errors, to stand in for a failure or guard a fixture.
export function boom(): never {
  throw new Error("boom");
}
