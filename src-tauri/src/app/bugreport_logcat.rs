use crate::app::models::{
    BugreportLogFilters, BugreportLogPage, BugreportLogRow, BugreportLogSummary,
};
use dirs::home_dir;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tracing::warn;
use uuid::Uuid;
use zip::read::ZipArchive;

const LOGCAT_TABLE: &str = "logcat";
const LOGCAT_FTS_TABLE: &str = "logcat_fts";
const BATCH_COMMIT_SIZE: usize = 50_000;
const READ_BUFFER_SIZE: usize = 64 * 1024;
const DEFAULT_QUERY_LIMIT: usize = 200;
const MAX_QUERY_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LogcatCacheMeta {
    report_id: String,
    source_path: String,
    source_size: u64,
    source_modified: u64,
    total_rows: usize,
    min_ts: Option<String>,
    max_ts: Option<String>,
    levels: HashMap<String, usize>,
}

#[derive(Debug)]
struct ParsedLogcatLine {
    ts_raw: String,
    ts_key: u64,
    level: String,
    tag: String,
    pid: i64,
    tid: i64,
    msg: String,
    raw_line: String,
}

pub fn prepare_bugreport_logcat(
    source_path: &Path,
    trace_id: &str,
) -> Result<BugreportLogSummary, String> {
    let trace_id = trace_id.trim();
    let trace_id = if trace_id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        trace_id.to_string()
    };
    if !source_path.exists() {
        return Err("Bugreport path not found".to_string());
    }
    if !source_path.is_file() {
        return Err("Bugreport path is not a file".to_string());
    }

    let report_id = stable_path_hash(&source_path.to_string_lossy());
    let cache_dir = cache_dir_for_report(&report_id)?;
    fs::create_dir_all(&cache_dir).map_err(|err| format!("Failed to create cache dir: {err}"))?;
    let meta_path = cache_dir.join("meta.json");
    let db_path = cache_dir.join("logcat.db");

    let metadata = fs::metadata(source_path)
        .map_err(|err| format!("Failed to read bugreport metadata: {err}"))?;
    let source_size = metadata.len();
    let source_modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    match load_meta(&meta_path) {
        Ok(Some(meta)) => {
            if meta.source_size == source_size
                && meta.source_modified == source_modified
                && meta.source_path == source_path.to_string_lossy()
                && db_path.exists()
            {
                return Ok(meta_to_summary(meta, db_path));
            }
        }
        Ok(None) => {}
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                error = %err,
                "Failed to load bugreport logcat cache meta; rebuilding index"
            );
            if let Err(err) = fs::remove_file(&meta_path) {
                warn!(
                    trace_id = %trace_id,
                    error = %err,
                    "Failed to remove invalid bugreport logcat cache meta"
                );
            }
        }
    }

    if db_path.exists() {
        fs::remove_file(&db_path)
            .map_err(|err| format!("Failed to remove stale cache db: {err}"))?;
    }

    let meta = build_logcat_index(
        source_path,
        &db_path,
        &report_id,
        source_size,
        source_modified,
    )?;

    let payload = serde_json::to_vec_pretty(&meta)
        .map_err(|err| format!("Failed to serialize cache meta: {err}"))?;
    fs::write(&meta_path, payload).map_err(|err| format!("Failed to write cache meta: {err}"))?;

    Ok(meta_to_summary(meta, db_path))
}

pub fn query_bugreport_logcat(
    report_id: &str,
    filters: BugreportLogFilters,
    offset: usize,
    limit: usize,
) -> Result<BugreportLogPage, String> {
    let cache_dir = cache_dir_for_report(report_id)?;
    let db_path = cache_dir.join("logcat.db");
    if !db_path.exists() {
        return Err("Bugreport log index not found. Load a bugreport first.".to_string());
    }

    let connection =
        Connection::open(db_path).map_err(|err| format!("Failed to open logcat index: {err}"))?;

    let (sql, params) = build_query_sql(filters, offset, limit);
    let mut stmt = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare logcat query: {err}"))?;

    let mut rows = Vec::new();
    let rows_iter = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok(BugreportLogRow {
                id: row.get(0)?,
                ts: row.get(1)?,
                level: row.get(2)?,
                tag: row.get(3)?,
                pid: row.get(4)?,
                tid: row.get(5)?,
                msg: row.get(6)?,
                raw_line: row.get(7)?,
            })
        })
        .map_err(|err| format!("Failed to execute logcat query: {err}"))?;

    for row in rows_iter {
        rows.push(row.map_err(|err| format!("Failed to read logcat row: {err}"))?);
    }

    let limit = if limit == 0 {
        DEFAULT_QUERY_LIMIT
    } else {
        limit
    }
    .clamp(1, MAX_QUERY_LIMIT);
    let mut has_more = false;
    if rows.len() > limit {
        rows.truncate(limit);
        has_more = true;
    }

    Ok(BugreportLogPage {
        rows,
        has_more,
        next_offset: if has_more { offset + limit } else { offset },
    })
}

fn build_query_sql(
    filters: BugreportLogFilters,
    offset: usize,
    limit: usize,
) -> (String, Vec<rusqlite::types::Value>) {
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    let mut clauses: Vec<String> = Vec::new();
    let mut from = LOGCAT_TABLE.to_string();

    let levels = normalize_levels(filters.levels);
    if !levels.is_empty() {
        let placeholders = vec!["?"; levels.len()].join(", ");
        clauses.push(format!("{LOGCAT_TABLE}.level IN ({placeholders})"));
        for level in levels {
            params.push(level.into());
        }
    }

    if let Some(tag) = filters.tag.and_then(normalize_text) {
        clauses.push(format!("{LOGCAT_TABLE}.tag = ?"));
        params.push(tag.into());
    }

    if let Some(pid) = filters.pid {
        clauses.push(format!("{LOGCAT_TABLE}.pid = ?"));
        params.push(pid.into());
    }

    if let Some(start_ts) = filters
        .start_ts
        .and_then(normalize_text)
        .and_then(|value| parse_ts_key(&value).map(|key| (value, key)))
    {
        clauses.push(format!("{LOGCAT_TABLE}.ts_key >= ?"));
        params.push(rusqlite::types::Value::Integer(start_ts.1 as i64));
    }

    if let Some(end_ts) = filters
        .end_ts
        .and_then(normalize_text)
        .and_then(|value| parse_ts_key(&value).map(|key| (value, key)))
    {
        clauses.push(format!("{LOGCAT_TABLE}.ts_key <= ?"));
        params.push(rusqlite::types::Value::Integer(end_ts.1 as i64));
    }

    let include_terms = normalize_text_list(filters.text_terms);
    let exclude_terms = normalize_text_list(filters.text_excludes);
    let include_terms = if include_terms.is_empty() {
        filters
            .text
            .and_then(normalize_text)
            .map(|value| vec![value])
            .unwrap_or_default()
    } else {
        include_terms
    };

    if let Some(include_expr) = fts_or_expression(&include_terms) {
        from = format!(
            "{LOGCAT_TABLE} JOIN {LOGCAT_FTS_TABLE} ON {LOGCAT_FTS_TABLE}.rowid = {LOGCAT_TABLE}.id"
        );
        clauses.push(format!("{LOGCAT_FTS_TABLE} MATCH ?"));
        params.push(include_expr.into());
    }

    if let Some(exclude_expr) = fts_or_expression(&exclude_terms) {
        clauses.push(format!(
            "{LOGCAT_TABLE}.id NOT IN (SELECT rowid FROM {LOGCAT_FTS_TABLE} WHERE {LOGCAT_FTS_TABLE} MATCH ?)"
        ));
        params.push(exclude_expr.into());
    }

    let mut sql = format!(
        "SELECT {LOGCAT_TABLE}.id, {LOGCAT_TABLE}.ts_raw, {LOGCAT_TABLE}.level, {LOGCAT_TABLE}.tag, {LOGCAT_TABLE}.pid, {LOGCAT_TABLE}.tid, {LOGCAT_TABLE}.msg, {LOGCAT_TABLE}.raw_line FROM {from}"
    );

    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }

    sql.push_str(&format!(
        " ORDER BY {LOGCAT_TABLE}.ts_key ASC, {LOGCAT_TABLE}.id ASC"
    ));
    sql.push_str(" LIMIT ? OFFSET ?");

    let normalized_limit = if limit == 0 {
        DEFAULT_QUERY_LIMIT
    } else {
        limit
    };
    let normalized_limit = normalized_limit.clamp(1, MAX_QUERY_LIMIT);
    params.push(rusqlite::types::Value::Integer(
        (normalized_limit + 1) as i64,
    ));
    params.push(rusqlite::types::Value::Integer(offset as i64));

    (sql, params)
}

fn normalize_text(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_levels(levels: Vec<String>) -> Vec<String> {
    let allowed = ["V", "D", "I", "W", "E", "F"];
    levels
        .into_iter()
        .filter_map(|level| {
            let upper = level.trim().to_uppercase();
            if allowed.contains(&upper.as_str()) {
                Some(upper)
            } else {
                None
            }
        })
        .collect()
}

fn normalize_text_list(values: Vec<String>) -> Vec<String> {
    values.into_iter().filter_map(normalize_text).collect()
}

fn fts_escape_and(input: &str) -> String {
    let tokens: Vec<String> = input
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "")))
        .collect();
    if tokens.is_empty() {
        return "".to_string();
    }
    tokens.join(" ")
}

fn fts_or_expression(terms: &[String]) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for term in terms {
        let escaped = fts_escape_and(term);
        if escaped.is_empty() {
            continue;
        }
        parts.push(format!("({escaped})"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" OR "))
    }
}

fn build_logcat_index(
    source_path: &Path,
    db_path: &Path,
    report_id: &str,
    source_size: u64,
    source_modified: u64,
) -> Result<LogcatCacheMeta, String> {
    let mut connection =
        Connection::open(db_path).map_err(|err| format!("Failed to create logcat index: {err}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             DROP TABLE IF EXISTS logcat;
             DROP TABLE IF EXISTS logcat_fts;
             CREATE TABLE logcat (
               id INTEGER PRIMARY KEY,
               ts_key INTEGER NOT NULL,
               ts_raw TEXT NOT NULL,
               level TEXT NOT NULL,
               tag TEXT NOT NULL,
               pid INTEGER NOT NULL,
               tid INTEGER NOT NULL,
               msg TEXT NOT NULL,
               raw_line TEXT NOT NULL
             );
             CREATE INDEX idx_logcat_ts ON logcat(ts_key);
             CREATE INDEX idx_logcat_level ON logcat(level);
             CREATE INDEX idx_logcat_tag ON logcat(tag);
             CREATE INDEX idx_logcat_pid ON logcat(pid);
             CREATE VIRTUAL TABLE logcat_fts USING fts5(tag, msg, raw_line);
            ",
        )
        .map_err(|err| format!("Failed to initialize logcat index: {err}"))?;

    let logcat_regex = logcat_regex();
    let mut total_rows = 0usize;
    let mut min_ts_key = None;
    let mut max_ts_key = None;
    let mut min_ts_raw: Option<String> = None;
    let mut max_ts_raw: Option<String> = None;
    let mut levels: HashMap<String, usize> = HashMap::new();

    if is_zip(source_path) {
        let file = File::open(source_path)
            .map_err(|err| format!("Failed to open bugreport zip: {err}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|err| format!("Failed to read bugreport zip: {err}"))?;
        let index = find_bugreport_entry(&mut archive)?;
        let zip_file = archive
            .by_index(index)
            .map_err(|err| format!("Failed to open bugreport entry: {err}"))?;
        stream_logcat_lines(
            zip_file,
            &mut connection,
            &logcat_regex,
            &mut total_rows,
            &mut min_ts_key,
            &mut max_ts_key,
            &mut min_ts_raw,
            &mut max_ts_raw,
            &mut levels,
        )?;
    } else {
        let file = File::open(source_path)
            .map_err(|err| format!("Failed to open bugreport file: {err}"))?;
        stream_logcat_lines(
            file,
            &mut connection,
            &logcat_regex,
            &mut total_rows,
            &mut min_ts_key,
            &mut max_ts_key,
            &mut min_ts_raw,
            &mut max_ts_raw,
            &mut levels,
        )?;
    }

    Ok(LogcatCacheMeta {
        report_id: report_id.to_string(),
        source_path: source_path.to_string_lossy().to_string(),
        source_size,
        source_modified,
        total_rows,
        min_ts: min_ts_raw,
        max_ts: max_ts_raw,
        levels,
    })
}

#[allow(clippy::too_many_arguments)]
fn stream_logcat_lines<R: Read>(
    reader: R,
    connection: &mut Connection,
    logcat_regex: &Regex,
    total_rows: &mut usize,
    min_ts_key: &mut Option<u64>,
    max_ts_key: &mut Option<u64>,
    min_ts_raw: &mut Option<String>,
    max_ts_raw: &mut Option<String>,
    levels: &mut HashMap<String, usize>,
) -> Result<(), String> {
    let mut buf_reader = BufReader::with_capacity(READ_BUFFER_SIZE, reader);
    let mut buffer = Vec::with_capacity(4096);

    let mut batch_count = 0usize;
    let mut tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start logcat transaction: {err}"))?;
    let mut insert_stmt = prepare_insert(&tx)?;
    let mut fts_stmt = prepare_fts_insert(&tx)?;

    loop {
        buffer.clear();
        let bytes = buf_reader
            .read_until(b'\n', &mut buffer)
            .map_err(|err| format!("Failed to read bugreport content: {err}"))?;
        if bytes == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&buffer);
        let trimmed = line.trim_end_matches(&['\n', '\r'][..]);
        if trimmed.is_empty() {
            continue;
        }
        if let Some(parsed) = parse_logcat_line(trimmed, logcat_regex) {
            let ParsedLogcatLine {
                ts_raw,
                ts_key,
                level,
                tag,
                pid,
                tid,
                msg,
                raw_line,
            } = parsed;
            let row_id = insert_stmt
                .insert(params![
                    ts_key as i64,
                    &ts_raw,
                    &level,
                    &tag,
                    pid,
                    tid,
                    &msg,
                    &raw_line,
                ])
                .map_err(|err| format!("Failed to insert logcat row: {err}"))?;
            fts_stmt
                .execute(params![row_id, &tag, &msg, &raw_line,])
                .map_err(|err| format!("Failed to insert logcat search row: {err}"))?;

            *total_rows += 1;
            batch_count += 1;
            *levels.entry(level).or_insert(0) += 1;
            update_time_range(
                ts_key, ts_raw, min_ts_key, max_ts_key, min_ts_raw, max_ts_raw,
            );

            if batch_count >= BATCH_COMMIT_SIZE {
                drop(insert_stmt);
                drop(fts_stmt);
                tx.commit()
                    .map_err(|err| format!("Failed to commit logcat batch: {err}"))?;
                tx = connection
                    .transaction()
                    .map_err(|err| format!("Failed to start logcat transaction: {err}"))?;
                insert_stmt = prepare_insert(&tx)?;
                fts_stmt = prepare_fts_insert(&tx)?;
                batch_count = 0;
            }
        }
    }

    if batch_count > 0 {
        drop(insert_stmt);
        drop(fts_stmt);
        tx.commit()
            .map_err(|err| format!("Failed to commit logcat batch: {err}"))?;
    }

    Ok(())
}

fn prepare_insert<'a>(
    tx: &'a rusqlite::Transaction<'a>,
) -> Result<rusqlite::Statement<'a>, String> {
    tx.prepare(
        "INSERT INTO logcat (ts_key, ts_raw, level, tag, pid, tid, msg, raw_line) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .map_err(|err| format!("Failed to prepare logcat insert: {err}"))
}

fn prepare_fts_insert<'a>(
    tx: &'a rusqlite::Transaction<'a>,
) -> Result<rusqlite::Statement<'a>, String> {
    tx.prepare("INSERT INTO logcat_fts (rowid, tag, msg, raw_line) VALUES (?1, ?2, ?3, ?4)")
        .map_err(|err| format!("Failed to prepare logcat search insert: {err}"))
}

fn update_time_range(
    ts_key: u64,
    ts_raw: String,
    min_ts_key: &mut Option<u64>,
    max_ts_key: &mut Option<u64>,
    min_ts_raw: &mut Option<String>,
    max_ts_raw: &mut Option<String>,
) {
    if ts_key == 0 {
        return;
    }
    if min_ts_key.is_none_or(|value| ts_key < value) {
        *min_ts_key = Some(ts_key);
        *min_ts_raw = Some(ts_raw.clone());
    }
    if max_ts_key.is_none_or(|value| ts_key > value) {
        *max_ts_key = Some(ts_key);
        *max_ts_raw = Some(ts_raw);
    }
}

fn parse_logcat_line(line: &str, regex: &Regex) -> Option<ParsedLogcatLine> {
    let caps = regex.captures(line)?;
    let ts_raw = format!("{} {}", &caps["date"], &caps["time"]);
    let ts_key = parse_ts_key(&ts_raw).unwrap_or(0);
    let level = caps["level"].to_string();
    let tag = caps["tag"].to_string();
    let pid = caps["pid"].parse().unwrap_or(0);
    let tid = caps["tid"].parse().unwrap_or(0);
    let msg = caps["msg"].to_string();

    Some(ParsedLogcatLine {
        ts_raw,
        ts_key,
        level,
        tag,
        pid,
        tid,
        msg,
        raw_line: line.to_string(),
    })
}

fn parse_ts_key(raw: &str) -> Option<u64> {
    let bytes = raw.as_bytes();
    if bytes.len() < 18 {
        return None;
    }
    if bytes.get(2) != Some(&b'-')
        || bytes.get(5) != Some(&b' ')
        || bytes.get(8) != Some(&b':')
        || bytes.get(11) != Some(&b':')
        || bytes.get(14) != Some(&b'.')
    {
        return None;
    }
    let month = parse_two_digits(&bytes[0..2])?;
    let day = parse_two_digits(&bytes[3..5])?;
    let hour = parse_two_digits(&bytes[6..8])?;
    let minute = parse_two_digits(&bytes[9..11])?;
    let second = parse_two_digits(&bytes[12..14])?;
    let millis = parse_three_digits(&bytes[15..18])?;

    Some((((((month * 100 + day) * 100 + hour) * 100 + minute) * 100 + second) * 1000) + millis)
}

fn parse_two_digits(bytes: &[u8]) -> Option<u64> {
    if bytes.len() != 2 || !bytes[0].is_ascii_digit() || !bytes[1].is_ascii_digit() {
        return None;
    }
    let value = (bytes[0] - b'0') as u64 * 10 + (bytes[1] - b'0') as u64;
    Some(value)
}

fn parse_three_digits(bytes: &[u8]) -> Option<u64> {
    if bytes.len() != 3 || bytes.iter().any(|b| !b.is_ascii_digit()) {
        return None;
    }
    let value =
        (bytes[0] - b'0') as u64 * 100 + (bytes[1] - b'0') as u64 * 10 + (bytes[2] - b'0') as u64;
    Some(value)
}

fn logcat_regex() -> Regex {
    Regex::new(
        r"^(?P<date>\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3})\s+(?:\S+\s+)?(?P<pid>\d+)\s+(?P<tid>\d+)\s+(?P<level>[VDIWEF])\s+(?P<tag>[^:]+):\s(?P<msg>.*)$",
    )
    .expect("logcat regex should compile")
}

fn is_zip(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
}

fn find_bugreport_entry(archive: &mut ZipArchive<File>) -> Result<usize, String> {
    let mut chosen_index = None;
    let mut chosen_size = 0u64;
    for idx in 0..archive.len() {
        let file = archive
            .by_index(idx)
            .map_err(|err| format!("Failed to scan bugreport zip: {err}"))?;
        let name = file.name().to_ascii_lowercase();
        if name.ends_with(".txt") && (name.contains("bugreport") || name.contains("main_entry")) {
            let size = file.size();
            if size >= chosen_size {
                chosen_index = Some(idx);
                chosen_size = size;
            }
        }
    }
    chosen_index.ok_or_else(|| "No bugreport entry found in archive".to_string())
}

fn load_meta(path: &Path) -> Result<Option<LogcatCacheMeta>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|err| format!("Failed to read cache meta: {err}"))?;
    let parsed = serde_json::from_slice(&bytes)
        .map_err(|err| format!("Failed to parse cache meta: {err}"))?;
    Ok(Some(parsed))
}

fn meta_to_summary(meta: LogcatCacheMeta, db_path: PathBuf) -> BugreportLogSummary {
    BugreportLogSummary {
        report_id: meta.report_id,
        source_path: meta.source_path,
        db_path: db_path.to_string_lossy().to_string(),
        total_rows: meta.total_rows,
        min_ts: meta.min_ts,
        max_ts: meta.max_ts,
        levels: meta.levels,
    }
}

fn cache_dir_for_report(report_id: &str) -> Result<PathBuf, String> {
    let base = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    Ok(base
        .join(".lazy_blacktea_cache")
        .join("bugreport")
        .join(report_id))
}

fn stable_path_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parse_ts_key_orders_values() {
        let first = parse_ts_key("01-01 00:00:00.000").unwrap();
        let second = parse_ts_key("01-01 00:00:00.100").unwrap();
        assert!(second > first);
    }

    #[test]
    fn load_meta_reports_parse_errors() {
        let dir = TempDir::new().expect("tmp");
        let path = dir.path().join("meta.json");
        fs::write(&path, b"{not json").expect("write");
        let err = load_meta(&path).expect_err("expected error");
        assert!(err.contains("Failed to parse cache meta"));
    }

    #[test]
    fn query_sql_qualifies_columns_when_using_fts() {
        let filters = BugreportLogFilters {
            levels: vec!["I".to_string()],
            tag: Some("Bluetooth".to_string()),
            pid: None,
            text: Some("Bluetooth".to_string()),
            text_terms: Vec::new(),
            text_excludes: Vec::new(),
            start_ts: None,
            end_ts: None,
        };
        let (sql, _params) = build_query_sql(filters, 0, 200);
        assert!(sql.contains("FROM logcat JOIN logcat_fts"));
        assert!(sql.contains("logcat.tag = ?"));
        assert!(sql.contains("SELECT logcat.id, logcat.ts_raw"));
        assert!(sql.contains("ORDER BY logcat.ts_key ASC, logcat.id ASC"));
    }

    #[test]
    fn query_sql_builds_or_expression_for_text_terms() {
        let filters = BugreportLogFilters {
            levels: vec![],
            tag: None,
            pid: None,
            text: None,
            text_terms: vec!["Bluetooth".to_string(), "wifi".to_string()],
            text_excludes: Vec::new(),
            start_ts: None,
            end_ts: None,
        };
        let (sql, params) = build_query_sql(filters, 0, 200);
        assert!(sql.contains("FROM logcat JOIN logcat_fts"));
        assert!(sql.contains("logcat_fts MATCH ?"));
        let fts_param = params
            .iter()
            .find_map(|value| match value {
                rusqlite::types::Value::Text(text) => Some(text.clone()),
                _ => None,
            })
            .unwrap_or_default();
        assert!(fts_param.contains(" OR "));
    }

    #[test]
    fn query_sql_supports_exclude_only_without_join() {
        let filters = BugreportLogFilters {
            levels: vec![],
            tag: None,
            pid: None,
            text: None,
            text_terms: Vec::new(),
            text_excludes: vec!["Bluetooth".to_string()],
            start_ts: None,
            end_ts: None,
        };
        let (sql, _params) = build_query_sql(filters, 0, 200);
        assert!(!sql.contains("JOIN logcat_fts ON"));
        assert!(sql.contains("logcat.id NOT IN (SELECT rowid FROM logcat_fts"));
        assert!(sql.contains("WHERE logcat_fts MATCH ?"));
    }

    #[test]
    fn parse_logcat_line_extracts_fields() {
        let regex = logcat_regex();
        let line = "08-24 14:22:33.123  1234  5678 E ActivityManager: ANR in com.foo";
        let parsed = parse_logcat_line(line, &regex).unwrap();
        assert_eq!(parsed.ts_raw, "08-24 14:22:33.123");
        assert_eq!(parsed.level, "E");
        assert_eq!(parsed.tag, "ActivityManager");
        assert_eq!(parsed.pid, 1234);
        assert_eq!(parsed.tid, 5678);
        assert_eq!(parsed.msg, "ANR in com.foo");
    }
}
