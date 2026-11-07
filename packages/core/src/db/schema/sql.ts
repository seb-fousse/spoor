/**
 * Splits a SQL script into single statements, since neither `Database` backend
 * accepts several statements in one call.
 *
 * A statement ends at a `;` that ends its line (trailing whitespace allowed).
 * The `;` is dropped and each statement is trimmed. Whole-line `--` comments
 * never end a statement. A piece made only of comments and blank lines is
 * dropped; comments inside a statement are kept, since SQLite ignores them.
 * The last statement may omit its `;`.
 *
 * The limit: no `;` at the end of a line inside a statement, as in a trigger
 * body, and no comment after a statement's final `;` on the same line. Either
 * one splits wrongly, but not silently: the backend rejects the resulting
 * fragment or multi-statement string, so the migration tests catch it.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let lines: string[] = [];

  const flush = () => {
    const statement = lines.join("\n").trim();
    lines = [];
    const onlyComments = statement
      .split("\n")
      .every((line) => line.trim() === "" || line.trim().startsWith("--"));
    if (!onlyComments) statements.push(statement);
  };

  for (const line of sql.split(/\r?\n/)) {
    const end = line.trimEnd();
    if (end.endsWith(";") && !end.trimStart().startsWith("--")) {
      lines.push(end.slice(0, -1));
      flush();
    } else {
      lines.push(line);
    }
  }
  flush();

  return statements;
}
