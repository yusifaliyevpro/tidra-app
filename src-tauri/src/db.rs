use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde_json::{Number, Value};
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

/// One connection behind a mutex: SQLite serializes writes anyway, and queries here are small and local.
pub struct Db(pub Mutex<Connection>);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

fn to_sql(value: Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(b)),
        Value::Number(n) => {
            n.as_i64().map_or_else(|| SqlValue::Real(n.as_f64().unwrap_or_default()), SqlValue::Integer)
        }
        Value::String(s) => SqlValue::Text(s),
        other => SqlValue::Text(other.to_string()),
    }
}

fn to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Value::Null, Value::Number),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|byte| Value::Number((*byte).into())).collect()),
    }
}

/// Rows as positional arrays in select order, which is what Drizzle's proxy driver expects.
pub fn query(conn: &Connection, sql: &str, params: Vec<Value>) -> rusqlite::Result<Vec<Vec<Value>>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let columns = stmt.column_count();
    let mut rows = stmt.query(params_from_iter(params.into_iter().map(to_sql)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push((0..columns).map(|i| row.get_ref(i).map(to_json)).collect::<rusqlite::Result<_>>()?);
    }
    Ok(out)
}

// Commands marked `async` run off the main thread; a big read there would freeze the window.
#[tauri::command(async)]
pub fn db_query(sql: String, params: Vec<Value>, db: State<'_, Db>) -> Result<Vec<Vec<Value>>, String> {
    let conn = db.0.lock().map_err(|err| err.to_string())?;
    query(&conn, &sql, params).map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn db_execute(sql: String, params: Vec<Value>, db: State<'_, Db>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|err| err.to_string())?;
    let mut stmt = conn.prepare_cached(&sql).map_err(|err| err.to_string())?;
    stmt.execute(params_from_iter(params.into_iter().map(to_sql))).map_err(|err| err.to_string())
}

fn exec_script(conn: &Connection, sql: &str) -> Result<(), String> {
    conn.execute_batch(&format!("BEGIN;\n{sql}\nCOMMIT;")).map_err(|err| {
        let _ = conn.execute_batch("ROLLBACK;");
        err.to_string()
    })
}

/// Runs a script of statements (migrations) inside one transaction.
#[tauri::command(async)]
pub fn db_exec_script(sql: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|err| err.to_string())?;
    exec_script(&conn, &sql)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_rows_in_select_order() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a INTEGER, b TEXT, c REAL)").unwrap();
        conn.execute("INSERT INTO t VALUES (?1, ?2, ?3)", (1, "x", 1.5)).unwrap();
        let rows = query(&conn, "SELECT c, b, a FROM t WHERE b = ?", vec![json!("x")]).unwrap();
        assert_eq!(rows, vec![vec![json!(1.5), json!("x"), json!(1)]]);
    }

    #[test]
    fn a_failing_script_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a INTEGER)").unwrap();
        assert!(exec_script(&conn, "INSERT INTO t VALUES (1); INSERT INTO missing VALUES (2);").is_err());
        assert_eq!(query(&conn, "SELECT COUNT(*) FROM t", vec![]).unwrap(), vec![vec![json!(0)]]);
        exec_script(&conn, "INSERT INTO t VALUES (1);").unwrap();
        assert_eq!(query(&conn, "SELECT COUNT(*) FROM t", vec![]).unwrap(), vec![vec![json!(1)]]);
    }

    #[test]
    fn maps_every_stored_type_to_json() {
        let conn = Connection::open_in_memory().unwrap();
        let rows = query(&conn, "SELECT NULL, 1.5, 'x', x'0102', 9007199254740993", vec![]).unwrap();
        assert_eq!(rows, vec![vec![Value::Null, json!(1.5), json!("x"), json!([1, 2]), json!(9007199254740993_i64)]]);
    }

    #[test]
    fn reports_bad_sql() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(query(&conn, "SELECT * FROM missing", vec![]).is_err());
    }

    #[test]
    fn opens_a_database_file_in_wal_mode() {
        let path = std::env::temp_dir().join(format!("tidra-db-test-{}.db", std::process::id()));
        let conn = open(&path).unwrap();
        let rows = query(&conn, "PRAGMA journal_mode", vec![]).unwrap();
        drop(conn);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
        assert_eq!(rows, vec![vec![json!("wal")]]);
    }

    #[test]
    fn maps_json_params() {
        let conn = Connection::open_in_memory().unwrap();
        let rows = query(&conn, "SELECT ?, ?, ?", vec![json!(true), json!(null), json!({"a": 1})]).unwrap();
        assert_eq!(rows, vec![vec![json!(1), Value::Null, json!("{\"a\":1}")]]);
    }
}
