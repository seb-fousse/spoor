// Rule 5: the testing helpers may throw plain errors too.
export function boom(): never {
  throw new Error("boom");
}
