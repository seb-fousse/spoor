/** Vite and Vitest load a `?raw` import as the file's text; this tells `tsc` the same. */
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
