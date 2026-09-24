import { useState } from "react";

/** Shown until a key exists. The key goes straight to the Tauri store on disk,
 *  so it is never compiled into the app bundle. */
export function ApiKeyGate({ onSave }: { onSave: (key: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>Reclaim</h1>
        <p className="gate-lede">
          Reclaim uses TypeSafe AI's Jev model to decide what is safe to delete. Paste your
          API key to get started.
        </p>
        <input
          type="password"
          className="gate-input"
          placeholder="TypeSafe API key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              setSaving(true);
              void onSave(value.trim());
            }
          }}
        />
        <button
          className="primary gate-button"
          disabled={!value.trim() || saving}
          onClick={() => {
            setSaving(true);
            void onSave(value.trim());
          }}
        >
          {saving ? "Saving…" : "Continue"}
        </button>
        <p className="gate-foot">
          Stored locally on this Mac. Get one at console.typesafe.ai/keys
        </p>
      </div>
    </div>
  );
}
