import { useState } from "react";

export function SettingsSheet({
  apiKey,
  onSave,
  onClose,
}: {
  apiKey: string;
  onSave: (key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(apiKey);
  const [saving, setSaving] = useState(false);

  const save = () => {
    setSaving(true);
    void onSave(value.trim());
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="field">
          <label htmlFor="key">Smarter checks</label>
          <p className="field-help">
            Reclaim handles most folders on its own. For the unusual ones — a folder
            called <code>build</code> with nothing to identify it — it can ask an AI
            service to take a look. This is optional.
          </p>
          <input
            id="key"
            type="password"
            placeholder="Paste a TypeSafe key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <p className="field-foot">
            Stored on this Mac only. Get a key at console.typesafe.ai
          </p>
        </div>

        <div className="sheet-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
