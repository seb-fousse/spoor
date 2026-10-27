//! SQLite access for the `Database` seam (`packages/core/src/platform`).
//!
//! The frontend sends SQL and positional params over IPC; this module runs
//! them against the single user-owned database file. One connection, behind a
//! mutex, so statements run one at a time in the order they arrive.
//!
//! Why not `tauri-plugin-sql`: it runs each call on any connection from a sqlx
//! pool, with no way to pin one or configure each connection. A `BEGIN` and
//! the statements after it can land on different connections, so transactions
//! are not reliable, and per-connection pragmas (`secure_delete`, a future
//! SQLCipher key) cannot be guaranteed.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde_json::{Map, Number, Value};
use tauri::State;

pub struct Db(pub Mutex<Connection>);

/// Opens (or creates) the database at `path` and applies the settings the
/// data spec relies on.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // Erased content is overwritten, not left in free pages (see data-spec, Purge).
    conn.pragma_update(None, "secure_delete", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

/// Converts a JSON param to a SQLite value. Booleans become 0/1, matching the
/// `value_bool` column. Arrays and objects are rejected: the spec stores no JSON.
fn to_sql(value: Value) -> Result<SqlValue, String> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(b) => Ok(SqlValue::Integer(b.into())),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Ok(SqlValue::Integer(i)),
            None => n
                .as_f64()
                .map(SqlValue::Real)
                .ok_or_else(|| format!("unsupported number param: {n}")),
        },
        Value::String(s) => Ok(SqlValue::Text(s)),
        other => Err(format!("unsupported param type: {other}")),
    }
}

/// Converts a SQLite value to JSON. Integers beyond 2^53 lose precision once
/// they reach JavaScript; the spec uses TEXT ids and REAL values, so this is
/// accepted rather than worked around. Blobs come back as arrays of bytes.
fn to_json(value: ValueRef<'_>) -> Result<Value, String> {
    match value {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(i) => Ok(Value::from(i)),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .ok_or_else(|| format!("non-finite real: {f}")),
        ValueRef::Text(t) => std::str::from_utf8(t)
            .map(|s| Value::String(s.to_owned()))
            .map_err(|e| e.to_string()),
        ValueRef::Blob(b) => Ok(Value::from(b.to_vec())),
    }
}

fn bind(params: Vec<Value>) -> Result<Vec<SqlValue>, String> {
    params.into_iter().map(to_sql).collect()
}

pub fn execute(conn: &Connection, sql: &str, params: Vec<Value>) -> Result<(), String> {
    conn.execute(sql, params_from_iter(bind(params)?))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn query(
    conn: &Connection,
    sql: &str,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().map(String::from).collect();
    let mut rows = stmt
        .query(params_from_iter(bind(params)?))
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::with_capacity(columns.len());
        for (i, name) in columns.iter().enumerate() {
            let value = row.get_ref(i).map_err(|e| e.to_string())?;
            obj.insert(name.clone(), to_json(value)?);
        }
        out.push(obj);
    }
    Ok(out)
}

fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock()
        .map_err(|_| "database lock poisoned".to_string())
}

// Async so the work runs off the main thread and never blocks the UI.
#[tauri::command]
pub async fn db_execute(
    db: State<'_, Db>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<(), String> {
    let conn = lock(&db)?;
    execute(&conn, &sql, params.unwrap_or_default())
}

#[tauri::command]
pub async fn db_query(
    db: State<'_, Db>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = lock(&db)?;
    query(&conn, &sql, params.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        execute(
            &conn,
            "CREATE TABLE t (id TEXT PRIMARY KEY, b INTEGER, n REAL, i INTEGER, s TEXT) STRICT",
            vec![],
        )
        .unwrap();
        conn
    }

    #[test]
    fn round_trips_every_value_type() {
        let conn = memory();
        execute(
            &conn,
            "INSERT INTO t VALUES (?, ?, ?, ?, ?)",
            vec![json!("a"), json!(true), json!(1.5), json!(42), Value::Null],
        )
        .unwrap();

        let rows = query(&conn, "SELECT * FROM t WHERE id = ?", vec![json!("a")]).unwrap();
        assert_eq!(
            Value::Object(rows[0].clone()),
            json!({ "id": "a", "b": 1, "n": 1.5, "i": 42, "s": null })
        );
    }

    #[test]
    fn returns_empty_when_nothing_matches() {
        let conn = memory();
        let rows = query(&conn, "SELECT * FROM t WHERE id = ?", vec![json!("x")]).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn returns_blobs_as_byte_arrays() {
        let conn = memory();
        let rows = query(&conn, "SELECT x'0102' AS blob", vec![]).unwrap();
        assert_eq!(rows[0]["blob"], json!([1, 2]));
    }

    #[test]
    fn rejects_unsupported_params() {
        let conn = memory();
        let err = execute(
            &conn,
            "INSERT INTO t (id) VALUES (?)",
            vec![json!({ "a": 1 })],
        )
        .unwrap_err();
        assert!(err.contains("unsupported param"));
    }

    // The migration runner in core drives transactions and `user_version`
    // through these two functions, one statement per call.
    #[test]
    fn supports_the_migration_runner_statements() {
        let conn = memory();
        let user_version = |conn: &Connection| {
            query(conn, "PRAGMA user_version", vec![]).unwrap()[0]["user_version"].clone()
        };

        execute(&conn, "BEGIN IMMEDIATE", vec![]).unwrap();
        execute(&conn, "CREATE TABLE m (id TEXT PRIMARY KEY) STRICT", vec![]).unwrap();
        execute(&conn, "PRAGMA user_version = 1", vec![]).unwrap();
        execute(&conn, "COMMIT", vec![]).unwrap();
        assert_eq!(user_version(&conn), json!(1));

        execute(&conn, "BEGIN IMMEDIATE", vec![]).unwrap();
        execute(&conn, "CREATE TABLE r (id TEXT PRIMARY KEY) STRICT", vec![]).unwrap();
        execute(&conn, "PRAGMA user_version = 2", vec![]).unwrap();
        execute(&conn, "ROLLBACK", vec![]).unwrap();
        assert_eq!(user_version(&conn), json!(1));
        assert!(
            query(
                &conn,
                "SELECT name FROM sqlite_master WHERE name = 'r'",
                vec![]
            )
            .unwrap()
            .is_empty()
        );
    }

    #[test]
    fn applies_connection_settings() {
        let dir = std::env::temp_dir().join(format!("spoor-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("test.db")).unwrap();

        let pragma = |name: &str| -> Value {
            query(&conn, &format!("PRAGMA {name}"), vec![]).unwrap()[0]
                .values()
                .next()
                .unwrap()
                .clone()
        };
        assert_eq!(pragma("foreign_keys"), json!(1));
        assert_eq!(pragma("journal_mode"), json!("wal"));
        assert_eq!(pragma("secure_delete"), json!(1));

        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
