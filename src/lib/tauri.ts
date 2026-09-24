import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReclaimReport, ReclaimRequestItem, ScanSummary } from "../agents/types";

const STORE_FILE = "reclaim-settings.json";
const KEY_FIELD = "typesafe_api_key";

/** Agent 1. */
export function scanDisk(root: string, maxDepth = 8): Promise<ScanSummary> {
  return invoke<ScanSummary>("scan_disk", { root, maxDepth });
}

/** Agent 5. `dryRun` validates without touching anything. */
export function reclaimPaths(
  requests: ReclaimRequestItem[],
  dryRun: boolean,
): Promise<ReclaimReport> {
  return invoke<ReclaimReport>("reclaim_paths", { requests, dryRun });
}

export function reclaimHistory(): Promise<ReclaimReport[]> {
  return invoke<ReclaimReport[]>("reclaim_history");
}

export function defaultScanRoot(): Promise<string> {
  return invoke<string>("default_scan_root");
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, defaultPath });
  return typeof selected === "string" ? selected : null;
}

/** The key lives in the Tauri store on disk, never in the bundle. */
export async function loadApiKey(): Promise<string> {
  const store = await load(STORE_FILE, { autoSave: true });
  return (await store.get<string>(KEY_FIELD)) ?? "";
}

export async function saveApiKey(key: string): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set(KEY_FIELD, key.trim());
  await store.save();
}

/** Opens a path in Finder. Used to show the Trash after a clear-out, because
 *  "it's recoverable" only reassures someone who can see where it went. */
export async function revealInFinder(path: string): Promise<void> {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** The user's Trash. Tauri resolves `~` itself only for its own path APIs, so
 *  the home directory comes from the Rust side. */
export async function openTrash(): Promise<void> {
  const home = await defaultScanRoot();
  await revealInFinder(`${home}/.Trash`);
}

export type Theme = "system" | "light" | "dark";

const THEME_FIELD = "theme";

export async function loadTheme(): Promise<Theme> {
  const store = await load(STORE_FILE, { autoSave: true });
  const saved = await store.get<Theme>(THEME_FIELD);
  return saved === "light" || saved === "dark" ? saved : "system";
}

export async function saveTheme(theme: Theme): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set(THEME_FIELD, theme);
  await store.save();
}
