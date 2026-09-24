mod disk;
mod project;
mod prospector;
mod reclaimer;

use prospector::ScanSummary;
use reclaimer::{ReclaimReport, ReclaimRequest};
use std::path::PathBuf;

/// Agent 1 entry point. `max_depth` bounds the walk so a scan of `~` cannot
/// run away; 8 covers realistic project nesting.
#[tauri::command]
async fn scan_disk(root: String, max_depth: Option<usize>) -> Result<ScanSummary, String> {
    let path = PathBuf::from(shellexpand_home(&root));
    if !path.exists() {
        return Err(format!("{} does not exist", path.display()));
    }
    let depth = max_depth.unwrap_or(8);

    // Keep the walk off the UI thread — a cold scan of a home directory is
    // seconds of blocking I/O.
    tauri::async_runtime::spawn_blocking(move || prospector::scan(&path, depth))
        .await
        .map_err(|e| e.to_string())
}

/// Agent 6 entry point.
#[tauri::command]
async fn reclaim_paths(
    requests: Vec<ReclaimRequest>,
    dry_run: bool,
) -> Result<ReclaimReport, String> {
    tauri::async_runtime::spawn_blocking(move || reclaimer::reclaim(requests, dry_run))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reclaim_history() -> Vec<ReclaimReport> {
    reclaimer::list_receipts()
}

#[tauri::command]
fn default_scan_root() -> String {
    dirs::home_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "/".into())
}

fn shellexpand_home(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), rest);
        }
    }
    input.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_disk,
            reclaim_paths,
            reclaim_history,
            default_scan_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
