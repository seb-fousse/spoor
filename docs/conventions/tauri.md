# Tauri

How the app talks to its Rust side, in `apps/desktop/src-tauri/`.

## Only `platform/` knows about Tauri

[`src/platform/`](../../apps/desktop/src/platform) is the only code that touches the desktop
shell:

- **[`database.ts`](../../apps/desktop/src/platform/database.ts)** implements core's `Database`
  seam over Tauri IPC. It's the only file that imports `@tauri-apps/api`.
- **[`DatabaseProvider.tsx`](../../apps/desktop/src/platform/DatabaseProvider.tsx)** gives the
  app that database.
- **[`os.ts`](../../apps/desktop/src/platform/os.ts)** says whether it runs on macOS.

Everything else sees core's `Database`, with its `execute` and `query`, and nothing of Tauri.

**Why:** the rest of the app runs unchanged on another database, such as core's in-memory one in
the integration tests, and in Node, where the tests run.

- **Source:** [`apps/desktop/README.md`](../../apps/desktop/README.md)
- **Lint:** none. No rule restricts `@tauri-apps/*` imports yet.
- **Example:** [`platform/database.ts`](../../apps/desktop/src/platform/database.ts)

## Grant the least the window needs

[`src-tauri/capabilities/default.json`](../../apps/desktop/src-tauri/capabilities/default.json)
lists what the main window may call. Add a permission only with the frontend code that needs
it.

Today it grants `core:default` and `opener:default`. The opener plugin is registered in
`lib.rs` too, but nothing in the frontend calls it. Both are left from the Tauri scaffold. The
app's own commands, `db_execute` and `db_query`, aren't listed: Tauri allows an app's own
commands unless its build declares them in an app manifest, which `build.rs` doesn't.

**Why:** a permission the app doesn't use is only more for a compromised webview to reach.

- **Source:** Tauri, [Capabilities](https://v2.tauri.app/security/capabilities/)
- **Lint:** none
- **Example:** [`src-tauri/capabilities/default.json`](../../apps/desktop/src-tauri/capabilities/default.json)

## Commands return a `Result`, and the frontend gets an `Error`

A command is an `async` function, so its work runs off the main thread and never blocks the UI.
It returns `Result<T, String>`: on failure, Tauri rejects the frontend's `invoke` with the
string. See `db_execute` and `db_query` in
[`src-tauri/src/db.rs`](../../apps/desktop/src-tauri/src/db.rs).

On the frontend, `call()` in [`platform/database.ts`](../../apps/desktop/src/platform/database.ts)
wraps a rejected string in an `Error`, so callers always get an `Error`. A failure in SQL
reaches the app as that plain `Error`, not a `SpoorError`, so `describeError` treats it as a bug
and `ErrorAlert` logs it in full (see [errors.md](errors.md)).

Params are JSON scalars (null, boolean, number or string), and integers beyond 2^53 lose
precision on the way back.

- **Source:** Tauri, [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)
- **Lint:** CI's `tauri` job runs `cargo fmt --check`, `cargo clippy -- -D warnings` and
  `cargo test`
- **Example:** [`src-tauri/src/db.rs`](../../apps/desktop/src-tauri/src/db.rs)
