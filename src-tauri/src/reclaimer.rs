//! Agent 6 — Reclaimer.
//!
//! Deliberately contains no AI. The component that touches a user's files is
//! the last place that should be probabilistic. It takes an explicit list of
//! paths, moves them to Trash (never `rm -rf`), and records what it did.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReclaimOutcome {
    pub path: String,
    pub bytes: u64,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReclaimReport {
    pub receipt_id: String,
    pub timestamp: u64,
    pub outcomes: Vec<ReclaimOutcome>,
    pub bytes_reclaimed: u64,
    pub succeeded: usize,
    pub failed: usize,
    /// Where the undo manifest was written.
    pub receipt_path: Option<String>,
    /// True when nothing was actually moved.
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReclaimRequest {
    pub path: String,
    pub bytes: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn receipts_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?.join("ai.reclaim.app").join("receipts");
    std::fs::create_dir_all(&base).ok()?;
    Some(base)
}

/// Refuse paths that should never be trashed regardless of what any model said.
/// This is a hard floor, not a heuristic — it runs after every decision layer
/// and cannot be overridden from the UI.
fn is_protected(path: &Path) -> Option<String> {
    let home = dirs::home_dir();

    if !path.is_absolute() {
        return Some("path is not absolute".into());
    }
    if !path.exists() {
        return Some("path no longer exists".into());
    }
    if path.components().count() <= 2 {
        return Some("path is too close to the filesystem root".into());
    }
    if let Some(home) = home {
        if path == home {
            return Some("path is the home directory".into());
        }
        for critical in ["Documents", "Desktop", "Downloads", "Pictures", "Movies", "Music", "Library"] {
            if path == home.join(critical) {
                return Some(format!("path is the top-level {critical} folder"));
            }
        }
    }
    for critical in ["/", "/System", "/Users", "/Applications", "/Library", "/bin", "/usr", "/etc", "/var"] {
        if path == Path::new(critical) {
            return Some(format!("path is the protected system directory {critical}"));
        }
    }
    // A directory holding a .git is source, not an artifact — never a candidate.
    if path.join(".git").exists() {
        return Some("path is a git repository root".into());
    }
    None
}

/// Move the given paths to Trash. With `dry_run`, validates everything and
/// reports what *would* happen without touching a single file.
pub fn reclaim(requests: Vec<ReclaimRequest>, dry_run: bool) -> ReclaimReport {
    let receipt_id = uuid::Uuid::new_v4().to_string();
    let mut outcomes = Vec::with_capacity(requests.len());

    for req in &requests {
        let path = PathBuf::from(&req.path);

        if let Some(reason) = is_protected(&path) {
            outcomes.push(ReclaimOutcome {
                path: req.path.clone(),
                bytes: req.bytes,
                ok: false,
                error: Some(format!("refused: {reason}")),
            });
            continue;
        }

        if dry_run {
            outcomes.push(ReclaimOutcome {
                path: req.path.clone(),
                bytes: req.bytes,
                ok: true,
                error: None,
            });
            continue;
        }

        match trash::delete(&path) {
            Ok(()) => outcomes.push(ReclaimOutcome {
                path: req.path.clone(),
                bytes: req.bytes,
                ok: true,
                error: None,
            }),
            Err(e) => outcomes.push(ReclaimOutcome {
                path: req.path.clone(),
                bytes: req.bytes,
                ok: false,
                error: Some(e.to_string()),
            }),
        }
    }

    let succeeded = outcomes.iter().filter(|o| o.ok).count();
    let failed = outcomes.len() - succeeded;
    let bytes_reclaimed = outcomes.iter().filter(|o| o.ok).map(|o| o.bytes).sum();

    let mut report = ReclaimReport {
        receipt_id: receipt_id.clone(),
        timestamp: now_secs(),
        outcomes,
        bytes_reclaimed,
        succeeded,
        failed,
        receipt_path: None,
        dry_run,
    };

    // A receipt is what makes this reversible in practice: every path is still
    // in Trash, and this file says what was there and why.
    if !dry_run && succeeded > 0 {
        if let Some(dir) = receipts_dir() {
            let file = dir.join(format!("{receipt_id}.json"));
            if let Ok(json) = serde_json::to_string_pretty(&report) {
                if std::fs::write(&file, json).is_ok() {
                    report.receipt_path = Some(file.display().to_string());
                }
            }
        }
    }

    report
}

/// Past receipts, newest first.
pub fn list_receipts() -> Vec<ReclaimReport> {
    let Some(dir) = receipts_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut reports: Vec<ReclaimReport> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|s| serde_json::from_str::<ReclaimReport>(&s).ok())
        .collect();

    reports.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    reports
}
