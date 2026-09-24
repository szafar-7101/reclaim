import { TypeSafeClient } from "@typesafe-ai/sdk";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * JEV client factory.
 *
 * Two things are non-obvious here:
 *
 * 1. We hand the SDK Tauri's `fetch`, which tunnels the request through Rust.
 *    The webview's origin is `tauri://localhost`, so the browser `fetch` would
 *    be blocked by CORS before it ever left the machine.
 *
 * 2. `dangerouslyAllowBrowser` is correct in this context and only this one.
 *    The flag exists to stop you shipping *your* key to strangers' browsers.
 *    Here the key is the user's own, entered on their own machine, kept in the
 *    Tauri store, and never bundled into the binary.
 */
let cached: { key: string; client: TypeSafeClient } | null = null;

export function getClient(apiKey: string): TypeSafeClient {
  if (cached && cached.key === apiKey) return cached.client;

  const client = new TypeSafeClient({
    apiKey,
    fetch: tauriFetch as unknown as typeof globalThis.fetch,
    dangerouslyAllowBrowser: true,
    timeout: 15_000,
    retry: { maxRetries: 2 },
  });

  cached = { key: apiKey, client };
  return client;
}

/** Noul returns a probability, not a confidence. How far it sits from a coin
 *  flip is the confidence: 0.5 → 0 (no idea), 0.0 or 1.0 → 1 (certain). */
export function noulConfidence(p: number): number {
  return Math.abs(p - 0.5) * 2;
}

/** The compact JSON we hand JEV as `state`. Everything a decision needs, and
 *  nothing that would just burn input tokens. */
export function describe(c: {
  path: string;
  name: string;
  parent_path: string;
  size_bytes: number;
  file_count: number;
  age_days: number;
  sibling_manifests: string[];
  in_git_repo: boolean;
}) {
  return {
    directory_name: c.name,
    full_path: c.path,
    parent_directory: c.parent_path,
    size_mb: Math.round(c.size_bytes / 1_048_576),
    file_count: c.file_count,
    days_since_last_modified: c.age_days === Number.MAX_SAFE_INTEGER ? "unknown" : c.age_days,
    manifests_next_to_it: c.sibling_manifests.length ? c.sibling_manifests : "none",
    parent_is_git_repo: c.in_git_repo,
  };
}
