use crate::app::models::{
    BugreportExtractIndexSummary, BugreportExtractMatch, BugreportExtractQuery,
    BugreportExtractResult, BugreportExtractTemplateKind,
};
use dirs::home_dir;
use regex::{Regex, RegexBuilder};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;
use tracing::{info, warn};
use uuid::Uuid;
use zip::read::ZipArchive;

const READ_BUFFER_SIZE: usize = 64 * 1024;
const MAX_INDEX_LINE_BYTES: usize = 1_000_000;
const CACHE_SCHEMA_VERSION: u32 = 1;
const DEFAULT_QUERY_LIMIT: usize = 12;
const MAX_QUERY_LIMIT: usize = 50;
const MAX_INTERNAL_QUERY_LIMIT: usize = 200;
const MAX_QUERY_INPUT_LEN: usize = 160;
const MAX_REGEX_FILTERS: usize = 20;
const MAX_REGEX_PATTERN_LEN: usize = 512;
const SNIPPET_CONTEXT_LINES: usize = 2;
const SNIPPET_MAX_CHARS: usize = 2400;
const DEFAULT_SUGGESTION_LIMIT: usize = 6;
const MAX_SUGGESTION_SCAN: usize = 1500;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExtractCacheMeta {
    #[serde(default)]
    schema_version: u32,
    report_id: String,
    source_path: String,
    source_size: u64,
    source_modified: u64,
    total_sections: usize,
    total_lines: usize,
    service_sections: usize,
}

#[derive(Debug, Clone)]
struct DetectedSection {
    name: String,
    kind: String,
}

#[derive(Debug, Clone)]
struct ActiveSection {
    id: i64,
    name: String,
    kind: String,
    start_line: usize,
    end_line: usize,
}

#[derive(Debug, Clone)]
struct SectionCandidate {
    section_id: i64,
    section_name: String,
    section_kind: String,
    first_hit_line: Option<usize>,
    hit_count: usize,
}

#[derive(Debug, Clone)]
struct SectionWindow {
    start_line: usize,
    end_line: usize,
}

pub fn prepare_bugreport_extract_index(
    source_path: &Path,
    trace_id: &str,
) -> Result<BugreportExtractIndexSummary, String> {
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
    let meta_path = cache_dir.join("extract_meta.json");
    let db_path = cache_dir.join("extract.db");

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
            if meta.schema_version == CACHE_SCHEMA_VERSION
                && meta.source_size == source_size
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
                "Failed to load bugreport extract cache meta; rebuilding index"
            );
            if let Err(err) = fs::remove_file(&meta_path) {
                warn!(
                    trace_id = %trace_id,
                    error = %err,
                    "Failed to remove invalid bugreport extract cache meta"
                );
            }
        }
    }

    if db_path.exists() {
        fs::remove_file(&db_path)
            .map_err(|err| format!("Failed to remove stale cache db: {err}"))?;
    }

    let meta = build_extract_index(
        source_path,
        &db_path,
        &report_id,
        source_size,
        source_modified,
        &trace_id,
    )?;

    let payload = serde_json::to_vec_pretty(&meta)
        .map_err(|err| format!("Failed to serialize cache meta: {err}"))?;
    fs::write(&meta_path, payload).map_err(|err| format!("Failed to write cache meta: {err}"))?;

    Ok(meta_to_summary(meta, db_path))
}

pub fn query_bugreport_extract(
    report_id: &str,
    query: BugreportExtractQuery,
) -> Result<BugreportExtractResult, String> {
    let report_id = report_id.trim();
    if report_id.is_empty() {
        return Err(validation_error("report_id is required"));
    }

    let input =
        normalize_text(&query.input).ok_or_else(|| validation_error("query input is required"))?;
    if input.len() > MAX_QUERY_INPUT_LEN {
        return Err(validation_error(format!(
            "query input is too long (max {MAX_QUERY_INPUT_LEN} characters)"
        )));
    }

    let limit = query
        .limit
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .clamp(1, MAX_QUERY_LIMIT);
    let internal_limit = (limit * 4).clamp(limit, MAX_INTERNAL_QUERY_LIMIT);

    let include_regex = compile_overlay_regex(&query.include_regex, "include")?;
    let exclude_regex = compile_overlay_regex(&query.exclude_regex, "exclude")?;

    let cache_dir = cache_dir_for_report(report_id)?;
    let db_path = cache_dir.join("extract.db");
    if !db_path.exists() {
        return Err("Bugreport extract index not found. Load a bugreport first.".to_string());
    }

    let connection = Connection::open(db_path)
        .map_err(|err| format!("Failed to open bugreport extract index: {err}"))?;

    let mut candidates = match query.kind {
        BugreportExtractTemplateKind::Service => {
            query_service_sections(&connection, &input, internal_limit)?
        }
        BugreportExtractTemplateKind::App => {
            query_fts_grouped(&connection, &input, internal_limit, true)?
        }
        BugreportExtractTemplateKind::Keyword => {
            query_fts_grouped(&connection, &input, internal_limit, false)?
        }
    };

    candidates.sort_by(compare_candidates);

    let mut matches: Vec<BugreportExtractMatch> = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if let Some(result) = candidate_to_match(&connection, &candidate)? {
            matches.push(result);
        }
    }

    if !include_regex.is_empty() || !exclude_regex.is_empty() {
        matches = apply_overlay_regex(matches, &include_regex, &exclude_regex);
    }

    let truncated = matches.len() > limit;
    if truncated {
        matches.truncate(limit);
    }

    let suggestions = if matches.is_empty() {
        build_suggestions(&connection, query.kind, &input, DEFAULT_SUGGESTION_LIMIT)?
    } else {
        Vec::new()
    };

    Ok(BugreportExtractResult {
        report_id: report_id.to_string(),
        kind: query.kind,
        input,
        matches,
        suggestions,
        truncated,
    })
}

fn build_extract_index(
    source_path: &Path,
    db_path: &Path,
    report_id: &str,
    source_size: u64,
    source_modified: u64,
    trace_id: &str,
) -> Result<ExtractCacheMeta, String> {
    let mut connection =
        Connection::open(db_path).map_err(|err| format!("Failed to create extract db: {err}"))?;
    connection
        .execute_batch(
            "
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            CREATE TABLE sections (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              start_line INTEGER NOT NULL,
              end_line INTEGER NOT NULL
            );
            CREATE TABLE lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              line_no INTEGER NOT NULL,
              section_id INTEGER NOT NULL,
              text TEXT NOT NULL
            );
            CREATE INDEX idx_lines_section_line ON lines(section_id, line_no);
            CREATE INDEX idx_sections_kind_name ON sections(kind, name);
            CREATE VIRTUAL TABLE lines_fts USING fts5(text, section_name);
            ",
        )
        .map_err(|err| format!("Failed to initialize extract schema: {err}"))?;

    let tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start extract transaction: {err}"))?;

    let mut insert_section_stmt = tx
        .prepare("INSERT INTO sections(name, kind, start_line, end_line) VALUES (?, ?, ?, ?)")
        .map_err(|err| format!("Failed to prepare section insert: {err}"))?;
    let mut update_section_stmt = tx
        .prepare("UPDATE sections SET end_line = ? WHERE id = ?")
        .map_err(|err| format!("Failed to prepare section update: {err}"))?;
    let mut insert_line_stmt = tx
        .prepare("INSERT INTO lines(line_no, section_id, text) VALUES (?, ?, ?)")
        .map_err(|err| format!("Failed to prepare line insert: {err}"))?;
    let mut insert_fts_stmt = tx
        .prepare("INSERT INTO lines_fts(rowid, text, section_name) VALUES (?, ?, ?)")
        .map_err(|err| format!("Failed to prepare FTS insert: {err}"))?;

    let mut section_stats: HashMap<String, usize> = HashMap::new();
    let mut current_section: Option<ActiveSection> = None;
    let mut total_lines = 0usize;

    for_each_bugreport_line(source_path, |line_no, line| {
        if let Some(next_section) = detect_section_start(line) {
            let should_rotate = current_section
                .as_ref()
                .map(|active| {
                    line_no > active.start_line
                        || !active.name.eq_ignore_ascii_case(&next_section.name)
                        || active.kind != next_section.kind
                })
                .unwrap_or(true);
            if should_rotate {
                if let Some(active) = current_section.take() {
                    update_section_stmt
                        .execute(params![active.end_line as i64, active.id])
                        .map_err(|err| format!("Failed to update section range: {err}"))?;
                }
                let section_id = insert_section_stmt
                    .insert(params![
                        next_section.name,
                        next_section.kind,
                        line_no as i64,
                        line_no as i64
                    ])
                    .map_err(|err| format!("Failed to insert section: {err}"))?;
                *section_stats.entry(next_section.kind.clone()).or_insert(0) += 1;
                current_section = Some(ActiveSection {
                    id: section_id,
                    name: next_section.name,
                    kind: next_section.kind,
                    start_line: line_no,
                    end_line: line_no,
                });
            }
        }

        if current_section.is_none() {
            let fallback = DetectedSection {
                name: "Document".to_string(),
                kind: "generic".to_string(),
            };
            let section_id = insert_section_stmt
                .insert(params![
                    fallback.name,
                    fallback.kind,
                    line_no as i64,
                    line_no as i64
                ])
                .map_err(|err| format!("Failed to insert fallback section: {err}"))?;
            *section_stats.entry("generic".to_string()).or_insert(0) += 1;
            current_section = Some(ActiveSection {
                id: section_id,
                name: fallback.name,
                kind: fallback.kind,
                start_line: line_no,
                end_line: line_no,
            });
        }

        if let Some(active) = current_section.as_mut() {
            active.end_line = line_no;
            insert_line_stmt
                .execute(params![line_no as i64, active.id, line])
                .map_err(|err| format!("Failed to insert extract line: {err}"))?;
            let row_id = tx.last_insert_rowid();
            insert_fts_stmt
                .execute(params![row_id, line, active.name])
                .map_err(|err| format!("Failed to insert extract FTS line: {err}"))?;
            total_lines += 1;
        }

        Ok(())
    })?;

    if let Some(active) = current_section.take() {
        update_section_stmt
            .execute(params![active.end_line as i64, active.id])
            .map_err(|err| format!("Failed to finalize section range: {err}"))?;
    }

    drop(insert_fts_stmt);
    drop(insert_line_stmt);
    drop(update_section_stmt);
    drop(insert_section_stmt);

    tx.commit()
        .map_err(|err| format!("Failed to commit extract index: {err}"))?;

    let total_sections: usize = section_stats.values().sum();
    let service_sections = section_stats.get("service").copied().unwrap_or(0);

    info!(
        trace_id = %trace_id,
        report_id = %report_id,
        total_sections,
        total_lines,
        service_sections,
        "Prepared bugreport extract index"
    );

    Ok(ExtractCacheMeta {
        schema_version: CACHE_SCHEMA_VERSION,
        report_id: report_id.to_string(),
        source_path: source_path.to_string_lossy().to_string(),
        source_size,
        source_modified,
        total_sections,
        total_lines,
        service_sections,
    })
}

fn query_service_sections(
    connection: &Connection,
    input: &str,
    limit: usize,
) -> Result<Vec<SectionCandidate>, String> {
    let mut candidates = Vec::new();

    let input_lower = input.to_lowercase();
    let contains_pattern = format!("%{input_lower}%");
    let prefix_pattern = format!("{input_lower}%");

    let mut stmt = connection
        .prepare(
            "
            SELECT id, name, kind, start_line
            FROM sections
            WHERE kind = 'service' AND lower(name) LIKE ?
            ORDER BY
              CASE
                WHEN lower(name) = ? THEN 0
                WHEN lower(name) LIKE ? THEN 1
                ELSE 2
              END,
              length(name) ASC,
              id ASC
            LIMIT ?
            ",
        )
        .map_err(|err| format!("Failed to prepare service section query: {err}"))?;

    let rows = stmt
        .query_map(
            params![contains_pattern, input_lower, prefix_pattern, limit as i64],
            |row| {
                Ok(SectionCandidate {
                    section_id: row.get(0)?,
                    section_name: row.get(1)?,
                    section_kind: row.get(2)?,
                    first_hit_line: Some(row.get::<_, i64>(3)? as usize),
                    hit_count: 0,
                })
            },
        )
        .map_err(|err| format!("Failed to execute service section query: {err}"))?;

    for row in rows {
        let mut item = row.map_err(|err| format!("Failed to read service section row: {err}"))?;
        let (first_hit_line, hit_count) = section_hit_meta(connection, item.section_id, input)?;
        item.first_hit_line = first_hit_line.or(item.first_hit_line);
        item.hit_count = hit_count.max(1);
        candidates.push(item);
    }

    if candidates.is_empty() {
        return query_fts_grouped(connection, input, limit, false).map(|items| {
            items
                .into_iter()
                .filter(|item| item.section_kind == "service")
                .collect()
        });
    }

    Ok(candidates)
}

fn query_fts_grouped(
    connection: &Connection,
    input: &str,
    limit: usize,
    prefer_app_sections: bool,
) -> Result<Vec<SectionCandidate>, String> {
    let fts_expr = fts_escape_and(input)
        .ok_or_else(|| validation_error("query input produced an empty FTS expression"))?;

    let mut sql = String::from(
        "
        SELECT lines.section_id, sections.name, sections.kind, MIN(lines.line_no), COUNT(*) AS hit_count
        FROM lines_fts
        JOIN lines ON lines_fts.rowid = lines.id
        JOIN sections ON sections.id = lines.section_id
        WHERE lines_fts MATCH ?
        GROUP BY lines.section_id, sections.name, sections.kind
        ",
    );

    if prefer_app_sections {
        sql.push_str(
            " ORDER BY CASE WHEN sections.kind = 'app' THEN 0 ELSE 1 END, hit_count DESC, length(sections.name) ASC, lines.section_id ASC",
        );
    } else {
        sql.push_str(" ORDER BY hit_count DESC, length(sections.name) ASC, lines.section_id ASC");
    }
    sql.push_str(" LIMIT ?");

    let mut stmt = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare extract FTS query: {err}"))?;

    let rows = stmt
        .query_map(params![fts_expr, limit as i64], |row| {
            Ok(SectionCandidate {
                section_id: row.get(0)?,
                section_name: row.get(1)?,
                section_kind: row.get(2)?,
                first_hit_line: Some(row.get::<_, i64>(3)? as usize),
                hit_count: row.get::<_, i64>(4)? as usize,
            })
        })
        .map_err(|err| format!("Failed to execute extract FTS query: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read extract FTS row: {err}"))?);
    }

    Ok(items)
}

fn section_hit_meta(
    connection: &Connection,
    section_id: i64,
    input: &str,
) -> Result<(Option<usize>, usize), String> {
    let Some(fts_expr) = fts_escape_and(input) else {
        return Ok((None, 0));
    };

    let mut stmt = connection
        .prepare(
            "
            SELECT MIN(lines.line_no), COUNT(*)
            FROM lines_fts
            JOIN lines ON lines_fts.rowid = lines.id
            WHERE lines.section_id = ? AND lines_fts MATCH ?
            ",
        )
        .map_err(|err| format!("Failed to prepare section hit query: {err}"))?;

    let mut rows = stmt
        .query(params![section_id, fts_expr])
        .map_err(|err| format!("Failed to execute section hit query: {err}"))?;
    let row = rows
        .next()
        .map_err(|err| format!("Failed to read section hit row: {err}"))?;

    if let Some(row) = row {
        let line_no: Option<i64> = row
            .get(0)
            .map_err(|err| format!("Failed to read hit line: {err}"))?;
        let hit_count: i64 = row
            .get(1)
            .map_err(|err| format!("Failed to read hit count: {err}"))?;
        return Ok((
            line_no.map(|value| value as usize),
            hit_count.max(0) as usize,
        ));
    }

    Ok((None, 0))
}

fn candidate_to_match(
    connection: &Connection,
    candidate: &SectionCandidate,
) -> Result<Option<BugreportExtractMatch>, String> {
    let section_window = section_window(connection, candidate.section_id)?;
    let anchor_line = candidate
        .first_hit_line
        .unwrap_or(section_window.start_line);

    let line_start = anchor_line
        .saturating_sub(SNIPPET_CONTEXT_LINES)
        .max(section_window.start_line);
    let line_end = (anchor_line + SNIPPET_CONTEXT_LINES).min(section_window.end_line);

    let mut stmt = connection
        .prepare(
            "SELECT line_no, text FROM lines WHERE section_id = ? AND line_no >= ? AND line_no <= ? ORDER BY line_no ASC",
        )
        .map_err(|err| format!("Failed to prepare snippet query: {err}"))?;
    let mut rows = stmt
        .query(params![
            candidate.section_id,
            line_start as i64,
            line_end as i64
        ])
        .map_err(|err| format!("Failed to execute snippet query: {err}"))?;

    let mut snippets: Vec<String> = Vec::new();
    let mut actual_start = None::<usize>;
    let mut actual_end = None::<usize>;

    while let Some(row) = rows
        .next()
        .map_err(|err| format!("Failed to read snippet row: {err}"))?
    {
        let line_no: i64 = row
            .get(0)
            .map_err(|err| format!("Failed to read snippet line_no: {err}"))?;
        let text: String = row
            .get(1)
            .map_err(|err| format!("Failed to read snippet text: {err}"))?;
        actual_start.get_or_insert(line_no as usize);
        actual_end = Some(line_no as usize);
        snippets.push(text);
    }

    if snippets.is_empty() {
        return Ok(None);
    }

    let mut snippet = snippets.join("\n");
    if snippet.chars().count() > SNIPPET_MAX_CHARS {
        snippet = snippet.chars().take(SNIPPET_MAX_CHARS).collect::<String>();
        snippet.push_str(" …");
    }

    Ok(Some(BugreportExtractMatch {
        section_name: candidate.section_name.clone(),
        line_start: actual_start.unwrap_or(section_window.start_line),
        line_end: actual_end.unwrap_or(section_window.end_line),
        snippet,
        hit_count: candidate.hit_count,
    }))
}

fn section_window(connection: &Connection, section_id: i64) -> Result<SectionWindow, String> {
    let mut stmt = connection
        .prepare("SELECT start_line, end_line FROM sections WHERE id = ?")
        .map_err(|err| format!("Failed to prepare section range query: {err}"))?;
    let mut rows = stmt
        .query(params![section_id])
        .map_err(|err| format!("Failed to execute section range query: {err}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|err| format!("Failed to read section range row: {err}"))?
    {
        let start_line: i64 = row
            .get(0)
            .map_err(|err| format!("Failed to read section start_line: {err}"))?;
        let end_line: i64 = row
            .get(1)
            .map_err(|err| format!("Failed to read section end_line: {err}"))?;
        return Ok(SectionWindow {
            start_line: start_line.max(0) as usize,
            end_line: end_line.max(start_line).max(0) as usize,
        });
    }

    Err("Failed to locate extract section range".to_string())
}

fn apply_overlay_regex(
    matches: Vec<BugreportExtractMatch>,
    include_regex: &[Regex],
    exclude_regex: &[Regex],
) -> Vec<BugreportExtractMatch> {
    matches
        .into_iter()
        .filter(|item| {
            let include_ok = include_regex.is_empty()
                || include_regex
                    .iter()
                    .any(|pattern| pattern.is_match(&item.snippet));
            if !include_ok {
                return false;
            }
            !exclude_regex
                .iter()
                .any(|pattern| pattern.is_match(&item.snippet))
        })
        .collect()
}

fn compile_overlay_regex(patterns: &[String], field_name: &str) -> Result<Vec<Regex>, String> {
    if patterns.len() > MAX_REGEX_FILTERS {
        return Err(validation_error(format!(
            "{field_name} regex count exceeds the limit ({MAX_REGEX_FILTERS})"
        )));
    }

    let mut compiled = Vec::new();
    for pattern in patterns {
        let Some(pattern) = normalize_text(pattern) else {
            continue;
        };
        if pattern.len() > MAX_REGEX_PATTERN_LEN {
            return Err(validation_error(format!(
                "{field_name} regex is too long (max {MAX_REGEX_PATTERN_LEN} characters)"
            )));
        }
        let regex = RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|err| {
                validation_error(format!("Invalid {field_name} regex pattern: {err}"))
            })?;
        compiled.push(regex);
    }

    Ok(compiled)
}

fn detect_section_start(line: &str) -> Option<DetectedSection> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(captures) = service_section_regex().captures(trimmed) {
        let raw_name = captures.get(1).map(|m| m.as_str()).unwrap_or("");
        let name = normalize_service_name(raw_name);
        if !name.is_empty() {
            return Some(DetectedSection {
                name,
                kind: "service".to_string(),
            });
        }
    }

    let generic_name = detect_generic_header(trimmed)?;
    let kind = classify_generic_section_kind(&generic_name);
    Some(DetectedSection {
        name: generic_name,
        kind,
    })
}

fn service_section_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)^DUMP OF SERVICE\s+(.+?):\s*$").expect("service section regex")
    })
}

fn normalize_service_name(name: &str) -> String {
    name.trim()
        .trim_matches('"')
        .trim_matches('`')
        .replace('\t', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn detect_generic_header(trimmed: &str) -> Option<String> {
    if trimmed.len() > 140 {
        return None;
    }

    if (trimmed.starts_with("------") && trimmed.ends_with("------"))
        || (trimmed.starts_with("====") && trimmed.ends_with("===="))
    {
        let candidate = trimmed.trim_matches('-').trim_matches('=').trim();
        if candidate.len() >= 3 {
            return Some(candidate.to_string());
        }
        return None;
    }

    if trimmed.ends_with(':') {
        let candidate = trimmed.trim_end_matches(':').trim();
        if is_uppercase_heading(candidate) {
            return Some(candidate.to_string());
        }
    }

    None
}

fn is_uppercase_heading(value: &str) -> bool {
    if value.len() < 3 || value.len() > 80 {
        return false;
    }

    let tokens = value.split_whitespace().collect::<Vec<_>>();
    if tokens.is_empty() || tokens.len() > 8 {
        return false;
    }

    let mut alphabetic = 0usize;
    let mut uppercase = 0usize;
    for ch in value.chars() {
        if ch.is_ascii_alphabetic() {
            alphabetic += 1;
            if ch.is_ascii_uppercase() {
                uppercase += 1;
            }
        }
    }

    alphabetic >= 3 && uppercase * 100 / alphabetic >= 70
}

fn classify_generic_section_kind(name: &str) -> String {
    let lowered = name.to_lowercase();
    if lowered.contains("package")
        || lowered.contains("application")
        || lowered.contains("process")
        || lowered.contains("activity")
        || lowered.contains("uid")
        || lowered.contains("proc")
        || lowered.contains("app")
    {
        return "app".to_string();
    }
    "generic".to_string()
}

fn build_suggestions(
    connection: &Connection,
    kind: BugreportExtractTemplateKind,
    input: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    let normalized_input = input.to_lowercase();
    let tokens = suggestion_tokens(&normalized_input);

    let mut sql = String::from("SELECT DISTINCT name FROM sections");
    if matches!(kind, BugreportExtractTemplateKind::Service) {
        sql.push_str(" WHERE kind = 'service'");
    }
    sql.push_str(" ORDER BY name ASC LIMIT ?");

    let mut stmt = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare suggestions query: {err}"))?;
    let rows = stmt
        .query_map(params![MAX_SUGGESTION_SCAN as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| format!("Failed to execute suggestions query: {err}"))?;

    let mut scored: Vec<(i32, String)> = Vec::new();
    let mut seen = HashSet::new();

    for row in rows {
        let name = row.map_err(|err| format!("Failed to read suggestion row: {err}"))?;
        let key = name.to_lowercase();
        if !seen.insert(key.clone()) {
            continue;
        }
        let score = suggestion_score(&key, &normalized_input, &tokens);
        if score > 0 {
            scored.push((score, name));
        }
    }

    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.to_lowercase().cmp(&right.1.to_lowercase()))
    });

    Ok(scored
        .into_iter()
        .take(limit)
        .map(|(_, name)| name)
        .collect())
}

fn suggestion_tokens(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.' && ch != '_')
        .map(str::trim)
        .filter(|token| token.len() >= 2)
        .map(|token| token.to_string())
        .collect()
}

fn suggestion_score(candidate: &str, input: &str, tokens: &[String]) -> i32 {
    if candidate == input {
        return 10_000;
    }

    if candidate.starts_with(input) {
        return 9_000 - (candidate.len() as i32 - input.len() as i32).abs();
    }

    if candidate.contains(input) {
        return 8_000 - (candidate.len() as i32 - input.len() as i32).abs();
    }

    let token_hits = tokens
        .iter()
        .filter(|token| candidate.contains(token.as_str()))
        .count();
    if token_hits > 0 {
        return 3_000 + (token_hits as i32 * 300);
    }

    let common = input
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .filter(|ch| candidate.contains(*ch))
        .count();
    if common >= 3 {
        return 500 + common as i32;
    }

    0
}

fn compare_candidates(left: &SectionCandidate, right: &SectionCandidate) -> Ordering {
    right
        .hit_count
        .cmp(&left.hit_count)
        .then_with(|| left.section_name.len().cmp(&right.section_name.len()))
        .then_with(|| {
            left.section_name
                .to_lowercase()
                .cmp(&right.section_name.to_lowercase())
        })
}

fn for_each_bugreport_line(
    source_path: &Path,
    mut on_line: impl FnMut(usize, &str) -> Result<(), String>,
) -> Result<(), String> {
    if is_zip(source_path) {
        let file = File::open(source_path)
            .map_err(|err| format!("Failed to open bugreport zip: {err}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|err| format!("Failed to read bugreport zip: {err}"))?;
        let entry_index = find_bugreport_entry(&mut archive)?;
        let mut entry = archive
            .by_index(entry_index)
            .map_err(|err| format!("Failed to read bugreport zip entry: {err}"))?;
        return process_reader_lines(&mut entry, &mut on_line);
    }

    let file =
        File::open(source_path).map_err(|err| format!("Failed to open bugreport file: {err}"))?;
    let mut reader = BufReader::with_capacity(READ_BUFFER_SIZE, file);
    process_reader_lines(&mut reader, &mut on_line)
}

fn process_reader_lines(
    reader: &mut dyn Read,
    on_line: &mut impl FnMut(usize, &str) -> Result<(), String>,
) -> Result<(), String> {
    let mut buffered = BufReader::with_capacity(READ_BUFFER_SIZE, reader);
    let mut raw_line = Vec::new();
    let mut line_no = 0usize;

    loop {
        raw_line.clear();
        let bytes = buffered
            .read_until(b'\n', &mut raw_line)
            .map_err(|err| format!("Failed to read bugreport line: {err}"))?;
        if bytes == 0 {
            break;
        }
        line_no += 1;

        if raw_line.len() > MAX_INDEX_LINE_BYTES {
            continue;
        }

        while matches!(raw_line.last(), Some(b'\n' | b'\r')) {
            raw_line.pop();
        }

        if raw_line.contains(&0) {
            raw_line.retain(|byte| *byte != 0);
        }

        let text = String::from_utf8_lossy(&raw_line);
        on_line(line_no, text.as_ref())?;
    }

    Ok(())
}

fn fts_escape_and(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|term| term.trim())
        .filter(|term| !term.is_empty())
        .map(fts_quote)
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn fts_quote(term: &str) -> String {
    let escaped = term.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
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

fn load_meta(path: &Path) -> Result<Option<ExtractCacheMeta>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|err| format!("Failed to read cache meta: {err}"))?;
    let parsed = serde_json::from_slice(&bytes)
        .map_err(|err| format!("Failed to parse cache meta: {err}"))?;
    Ok(Some(parsed))
}

fn meta_to_summary(meta: ExtractCacheMeta, db_path: PathBuf) -> BugreportExtractIndexSummary {
    BugreportExtractIndexSummary {
        report_id: meta.report_id,
        source_path: meta.source_path,
        db_path: db_path.to_string_lossy().to_string(),
        total_sections: meta.total_sections,
        total_lines: meta.total_lines,
        service_sections: meta.service_sections,
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

fn validation_error(message: impl AsRef<str>) -> String {
    format!("VALIDATION: {}", message.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn build_test_index(content: &str) -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("tmp dir");
        let bugreport_path = dir.path().join("bugreport.txt");
        let db_path = dir.path().join("extract.db");
        fs::write(&bugreport_path, content).expect("write bugreport");

        let metadata = fs::metadata(&bugreport_path).expect("metadata");
        let modified = metadata
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        build_extract_index(
            &bugreport_path,
            &db_path,
            "report",
            metadata.len(),
            modified,
            "trace-test",
        )
        .expect("build extract index");

        (dir, db_path)
    }

    #[test]
    fn detects_service_and_generic_sections() {
        let service = detect_section_start("DUMP OF SERVICE bluetooth_manager:").expect("service");
        assert_eq!(service.name, "bluetooth_manager");
        assert_eq!(service.kind, "service");

        let generic = detect_section_start("------ PACKAGE MANAGER ------").expect("generic");
        assert_eq!(generic.name, "PACKAGE MANAGER");
        assert_eq!(generic.kind, "app");
    }

    #[test]
    fn fts_query_groups_results_by_section() {
        let (_dir, db_path) = build_test_index(concat!(
            "DUMP OF SERVICE bluetooth_manager:\n",
            "enabled=true\n",
            "DUMP OF SERVICE audio:\n",
            "audio focus owner=com.example.music\n",
            "------ PACKAGE MANAGER ------\n",
            "package:com.example.music uid:10234\n",
        ));

        let conn = Connection::open(db_path).expect("open db");
        let matches = query_fts_grouped(&conn, "com.example.music", 10, true).expect("fts query");
        assert!(!matches.is_empty());
        assert!(matches
            .iter()
            .any(|item| item.section_name.contains("PACKAGE MANAGER")));
    }

    #[test]
    fn overlay_regex_filters_matches() {
        let rows = vec![
            BugreportExtractMatch {
                section_name: "A".to_string(),
                line_start: 1,
                line_end: 2,
                snippet: "Bluetooth active".to_string(),
                hit_count: 2,
            },
            BugreportExtractMatch {
                section_name: "B".to_string(),
                line_start: 3,
                line_end: 4,
                snippet: "Audio muted".to_string(),
                hit_count: 1,
            },
        ];

        let include =
            compile_overlay_regex(&["Bluetooth".to_string()], "include").expect("include");
        let exclude = compile_overlay_regex(&["muted".to_string()], "exclude").expect("exclude");

        let filtered = apply_overlay_regex(rows, &include, &exclude);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].section_name, "A");
    }

    #[test]
    fn builds_suggestions_when_no_matches() {
        let (_dir, db_path) = build_test_index(concat!(
            "DUMP OF SERVICE bluetooth_manager:\n",
            "enabled=true\n",
            "DUMP OF SERVICE audio:\n",
            "focus stack\n",
            "------ ACTIVITY MANAGER ------\n",
            "proc #123 com.example.camera\n",
        ));
        let conn = Connection::open(db_path).expect("open db");
        let suggestions =
            build_suggestions(&conn, BugreportExtractTemplateKind::Service, "blueto", 5)
                .expect("suggestions");
        assert!(!suggestions.is_empty());
        assert_eq!(suggestions[0], "bluetooth_manager");
    }

    #[test]
    fn query_extract_returns_validation_for_invalid_regex() {
        let err = compile_overlay_regex(&["(".to_string()], "include").expect_err("invalid regex");
        assert!(err.starts_with("VALIDATION:"));
    }
}
