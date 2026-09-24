//! Agent 1 — Prospector.
//!
//! Deliberately contains no AI. Its job is to walk the filesystem fast and
//! deterministically, gather the *context* a decision needs, and hand that
//! context downstream. It never decides what is safe to delete.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// Directory names worth *considering*. This is a wide net on purpose — it
/// decides what gets looked at, never what gets deleted. Narrowing this list
/// costs recall; the confidence gate downstream is what protects the user.
pub const CANDIDATE_DIRS: &[&str] = &[
    // JavaScript / TypeScript
    "node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache",
    "bower_components", ".angular", ".vite",
    // Python
    ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".tox", ".eggs", "htmlcov",
    // Rust / Go / JVM
    "target", ".gradle", ".m2", "build",
    // Apple
    "DerivedData", "Pods", ".build",
    // General
    "dist", ".cache", "coverage", ".nyc_output", ".terraform", "vendor",
];

/// Manifests that prove a directory can be rebuilt. Their presence is the
/// single strongest signal Agent 5 has, so we collect them precisely.
const MANIFESTS: &[&str] = &[
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
    "Cargo.toml", "Cargo.lock",
    "requirements.txt", "pyproject.toml", "Pipfile", "Pipfile.lock", "poetry.lock",
    "go.mod", "go.sum", "Gemfile", "Gemfile.lock",
    "pom.xml", "build.gradle", "build.gradle.kts", "Podfile", "Podfile.lock",
];

/// One directory worth asking about, with everything a decision needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub path: String,
    pub name: String,
    pub parent_path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    /// Days since the most recent write anywhere inside.
    pub age_days: u64,
    /// Manifests sitting next to this directory, e.g. ["package.json", "pnpm-lock.yaml"].
    pub sibling_manifests: Vec<String>,
    /// Whether the parent tree is a git repository.
    pub in_git_repo: bool,
    /// Depth below the scan root.
    pub depth: usize,
    /// Unix seconds of the newest write inside. Lets the UI show a real date
    /// rather than only a relative age.
    pub modified_secs: u64,
    /// The project this artifact belongs to, if we could find one.
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanSummary {
    pub root: String,
    pub candidates: Vec<Candidate>,
    pub total_bytes: u64,
    pub scanned_dirs: u64,
    pub elapsed_ms: u128,
    /// Paths we could not read. Surfaced rather than swallowed — a silent
    /// permission failure would understate the total and erode trust.
    pub skipped: Vec<String>,
    /// Projects the candidates belong to, largest reclaimable first.
    pub projects: Vec<crate::project::Project>,
    /// Capacity of the volume holding the scan root.
    pub disk: Option<crate::disk::DiskInfo>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Size, file count, and newest mtime for a subtree. Errors are counted as
/// zero rather than aborting the walk; a partial number beats no number.
fn measure(path: &Path) -> (u64, u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut newest = 0u64;

    for entry in WalkDir::new(path).follow_links(false).into_iter().filter_map(Result::ok) {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                bytes += meta.len();
                files += 1;
                if let Ok(modified) = meta.modified() {
                    if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
                        newest = newest.max(d.as_secs());
                    }
                }
            }
        }
    }
    (bytes, files, newest)
}

/// Manifest filenames sitting directly inside `dir`.
fn manifests_in(dir: &Path) -> Vec<String> {
    let manifest_set: HashSet<&str> = MANIFESTS.iter().copied().collect();
    let mut found = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(Result::ok) {
            if let Some(name) = entry.file_name().to_str() {
                if manifest_set.contains(name) {
                    found.push(name.to_string());
                }
            }
        }
    }
    found.sort();
    found
}

fn has_git(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// Walk `root` and collect candidates. Does not descend into a candidate once
/// found — the whole point is that we do not need to know its insides.
pub fn scan(root: &Path, max_depth: usize) -> ScanSummary {
    let started = std::time::Instant::now();
    let candidate_set: HashSet<&str> = CANDIDATE_DIRS.iter().copied().collect();

    let mut raw: Vec<(std::path::PathBuf, usize)> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut scanned_dirs = 0u64;

    let mut walker = WalkDir::new(root)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter();

    loop {
        let next = match walker.next() {
            None => break,
            Some(Ok(entry)) => entry,
            Some(Err(err)) => {
                if let Some(p) = err.path() {
                    skipped.push(p.display().to_string());
                }
                continue;
            }
        };

        if !next.file_type().is_dir() {
            continue;
        }
        scanned_dirs += 1;

        let name = next.file_name().to_string_lossy().to_string();

        if candidate_set.contains(name.as_str()) {
            raw.push((next.path().to_path_buf(), next.depth()));
            // Found one — everything below it is part of the same blob.
            walker.skip_current_dir();
        }
    }

    // Measuring is the expensive half, and each candidate is independent.
    let candidates: Vec<Candidate> = raw
        .par_iter()
        .map(|(path, depth)| {
            let (size_bytes, file_count, newest) = measure(path);
            let parent = path.parent().unwrap_or(Path::new("/"));
            let age_days = if newest == 0 {
                u64::MAX
            } else {
                now_secs().saturating_sub(newest) / 86_400
            };

            Candidate {
                id: uuid::Uuid::new_v4().to_string(),
                path: path.display().to_string(),
                name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                parent_path: parent.display().to_string(),
                size_bytes,
                file_count,
                age_days,
                sibling_manifests: manifests_in(parent),
                in_git_repo: has_git(parent),
                depth: *depth,
                modified_secs: newest,
                project_id: None,
            }
        })
        .filter(|c| c.size_bytes > 0)
        .collect();

    let mut candidates = candidates;
    let total_bytes = candidates.iter().map(|c| c.size_bytes).sum();

    // --- project association -------------------------------------------------
    //
    // Profiling a project runs `git` and walks its source tree, so it must
    // happen once per project, not once per candidate. Resolve roots first,
    // deduplicate, then profile the unique set in parallel.

    let artifact_names: Vec<String> =
        CANDIDATE_DIRS.iter().map(|s| s.to_string()).collect();

    let roots: Vec<Option<std::path::PathBuf>> = candidates
        .par_iter()
        .map(|c| {
            let start = Path::new(&c.parent_path);
            crate::project::find_root(start, root)
        })
        .collect();

    let mut unique: Vec<std::path::PathBuf> = roots.iter().flatten().cloned().collect();
    unique.sort();
    unique.dedup();

    let mut projects: Vec<crate::project::Project> = unique
        .par_iter()
        .map(|r| crate::project::profile(r, &artifact_names))
        .collect();

    // Index by root path so candidates can be stamped with their project id.
    let index: std::collections::HashMap<String, String> = projects
        .iter()
        .map(|p| (p.root.clone(), p.id.clone()))
        .collect();

    for (candidate, project_root) in candidates.iter_mut().zip(roots.iter()) {
        candidate.project_id = project_root
            .as_ref()
            .and_then(|r| index.get(&r.display().to_string()))
            .cloned();
    }

    // Roll the artifact totals back up onto each project.
    for project in projects.iter_mut() {
        let owned: Vec<&Candidate> = candidates
            .iter()
            .filter(|c| c.project_id.as_deref() == Some(project.id.as_str()))
            .collect();
        project.reclaimable_bytes = owned.iter().map(|c| c.size_bytes).sum();
        project.candidate_count = owned.len();
    }

    projects.sort_by(|a, b| b.reclaimable_bytes.cmp(&a.reclaimable_bytes));
    candidates.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    ScanSummary {
        root: root.display().to_string(),
        candidates,
        total_bytes,
        scanned_dirs,
        elapsed_ms: started.elapsed().as_millis(),
        skipped,
        projects,
        disk: crate::disk::for_path(&root.display().to_string()),
    }
}
