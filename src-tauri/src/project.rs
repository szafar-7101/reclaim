//! Project association.
//!
//! A path like `~/src/foo/node_modules` tells a user almost nothing. "2.1 GB,
//! belongs to arxiv-copilot, last commit 3 days ago, 4 uncommitted files" tells
//! them everything they need to decide. This module builds the second thing.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Files that mark a directory as the root of *something*, even without git.
const ROOT_MARKERS: &[&str] = &[
    "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt",
    "go.mod", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts",
    "Podfile", "Pipfile", "composer.json", "pubspec.yaml", "setup.py",
];

/// How alive a project looks. This is the signal that makes a 40 GB
/// `node_modules` feel different from a 2 GB one.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    /// Touched in the last week. Deleting costs you a rebuild today.
    Live,
    /// Within a month.
    Recent,
    /// Within a quarter.
    Dormant,
    /// Within a year.
    Stale,
    /// Over a year untouched.
    Abandoned,
    /// No usable timestamp.
    Unknown,
}

impl Activity {
    fn from_days(days: Option<u64>) -> Self {
        match days {
            None => Activity::Unknown,
            Some(d) if d < 7 => Activity::Live,
            Some(d) if d < 30 => Activity::Recent,
            Some(d) if d < 90 => Activity::Dormant,
            Some(d) if d < 365 => Activity::Stale,
            Some(_) => Activity::Abandoned,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub root: String,
    pub name: String,
    pub manifests: Vec<String>,
    pub is_git: bool,
    pub git_branch: Option<String>,
    /// Days since the last commit. `None` for non-git or empty repos.
    pub last_commit_days: Option<u64>,
    /// Days since the newest *source* file changed, ignoring build artifacts.
    /// This is the honest answer to "when was this last worked on".
    pub source_age_days: Option<u64>,
    /// Count of tracked files with uncommitted changes. The loudest possible
    /// "do not touch this project right now" signal.
    pub uncommitted_files: usize,
    pub activity: Activity,
    /// Total bytes of reclaimable artifacts belonging to this project.
    pub reclaimable_bytes: u64,
    pub candidate_count: usize,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn days_since(secs: u64) -> u64 {
    now_secs().saturating_sub(secs) / 86_400
}

fn has_marker(dir: &Path) -> bool {
    ROOT_MARKERS.iter().any(|m| dir.join(m).exists())
}

/// Walk up from `start` to find the project this path belongs to.
///
/// A `.git` directory wins over a manifest: in a monorepo the manifest in a
/// sub-package is real, but the thing a developer calls "the project" — and the
/// thing whose commit history means anything — is the repository.
pub fn find_root(start: &Path, ceiling: &Path) -> Option<PathBuf> {
    let mut cursor = Some(start);
    let mut manifest_fallback: Option<PathBuf> = None;

    while let Some(dir) = cursor {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        if manifest_fallback.is_none() && has_marker(dir) {
            manifest_fallback = Some(dir.to_path_buf());
        }
        if dir == ceiling {
            break;
        }
        cursor = dir.parent().filter(|p| p.starts_with(ceiling) || *p == ceiling);
    }

    manifest_fallback
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Git facts for a project root. Every call is allowed to fail — a repo with no
/// commits, a detached HEAD, or no `git` binary should degrade, not error.
fn git_facts(root: &Path) -> (Option<String>, Option<u64>, usize) {
    let branch = git(root, &["rev-parse", "--abbrev-ref", "HEAD"]).filter(|b| !b.is_empty());

    let last_commit_days = git(root, &["log", "-1", "--format=%ct"])
        .and_then(|s| s.parse::<u64>().ok())
        .map(days_since);

    // `--untracked-files=no` matters for speed: the untracked scan would walk
    // straight into node_modules, which is exactly what we are trying to avoid.
    let uncommitted = git(root, &["status", "--porcelain", "--untracked-files=no"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);

    (branch, last_commit_days, uncommitted)
}

/// Newest mtime among the project's own files, skipping build artifacts.
///
/// Without the skip this always returns "modified seconds ago", because a build
/// touches thousands of files in `target/` and tells you nothing about whether
/// a human has been here.
fn newest_source_mtime(root: &Path, skip: &[String], max_depth: usize) -> Option<u64> {
    let mut newest = 0u64;

    let mut walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter();

    while let Some(entry) = walker.next() {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().is_dir() {
            if name == ".git" || skip.contains(&name) {
                walker.skip_current_dir();
            }
            continue;
        }
        if name.starts_with('.') {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
                    newest = newest.max(d.as_secs());
                }
            }
        }
    }

    (newest > 0).then(|| days_since(newest))
}

fn manifests_in(dir: &Path) -> Vec<String> {
    let mut found: Vec<String> = ROOT_MARKERS
        .iter()
        .filter(|m| dir.join(m).exists())
        .map(|m| m.to_string())
        .collect();
    found.sort();
    found
}

/// Build the full profile for one project root.
pub fn profile(root: &Path, artifact_names: &[String]) -> Project {
    let is_git = root.join(".git").exists();
    let (git_branch, last_commit_days, uncommitted_files) =
        if is_git { git_facts(root) } else { (None, None, 0) };

    let source_age_days = newest_source_mtime(root, artifact_names, 6);

    // Prefer commit history when it exists — it reflects deliberate human work,
    // where an mtime can be moved by any tool that touches the tree.
    let effective_age = match (last_commit_days, source_age_days) {
        (Some(c), Some(s)) => Some(c.min(s)),
        (Some(c), None) => Some(c),
        (None, s) => s,
    };

    Project {
        id: uuid::Uuid::new_v4().to_string(),
        root: root.display().to_string(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root.display().to_string()),
        manifests: manifests_in(root),
        is_git,
        git_branch,
        last_commit_days,
        source_age_days,
        uncommitted_files,
        activity: Activity::from_days(effective_age),
        reclaimable_bytes: 0,
        candidate_count: 0,
    }
}
