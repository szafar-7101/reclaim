import { useMemo, useState } from "react";
import type { Assessment, Project } from "../agents/types";
import { age, bytes, onDate, shortPath } from "../lib/format";
import { KIND_NAME, VERDICT_PILL } from "../lib/language";

export type SortKey = "size" | "age" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "size", label: "Size" },
  { key: "age", label: "Last used" },
  { key: "name", label: "Name" },
];

export function ArtifactTable({
  assessments,
  projects,
  home,
  selected,
  onToggle,
  onToggleAll,
  sort,
  onSort,
  title,
}: {
  assessments: Assessment[];
  projects: Project[];
  home: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  title: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const rows = useMemo(() => {
    const copy = [...assessments];
    copy.sort((a, b) => {
      if (sort === "size") return b.candidate.size_bytes - a.candidate.size_bytes;
      if (sort === "age") return b.candidate.age_days - a.candidate.age_days;
      return a.candidate.name.localeCompare(b.candidate.name);
    });
    return copy;
  }, [assessments, sort]);

  const selectableIds = rows
    .filter((r) => r.verdict !== "keep")
    .map((r) => r.candidate.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  return (
    <div className="card">
      <div className="list-head">
        <h2>{title}</h2>
        <span className="list-count">
          {rows.length} {rows.length === 1 ? "folder" : "folders"}
        </span>
        <div className="spacer" />
        <div className="sortbar">
          <span>Sort by</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              className={`sort-btn${sort === s.key ? " is-active" : ""}`}
              onClick={() => onSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty">Nothing here.</p>
      ) : (
        <>
          <div className="item-row" style={{ paddingTop: 10, paddingBottom: 10 }}>
            <input
              type="checkbox"
              checked={allSelected}
              disabled={selectableIds.length === 0}
              onChange={(e) => onToggleAll(selectableIds, e.target.checked)}
              aria-label="Select all"
            />
            <span className="item-where">Select all that can be removed</span>
          </div>

          {rows.map((a) => {
            const c = a.candidate;
            const project = c.project_id ? projectById.get(c.project_id) : undefined;
            const isOpen = open.has(c.id);

            return (
              <div
                key={c.id}
                className={`item${selected.has(c.id) ? " is-selected" : ""}`}
              >
                <div className="item-row">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    disabled={a.verdict === "keep"}
                    onChange={() => onToggle(c.id)}
                    aria-label={`Select ${c.path}`}
                  />

                  <button
                    className="item-id"
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                        return next;
                      })
                    }
                  >
                    <div className="item-name">{c.name}</div>
                    <div className="item-where">
                      {project ? project.name : shortPath(c.parent_path, home)}
                    </div>
                  </button>

                  <span className="item-kind">{KIND_NAME[a.classification.kind]}</span>
                  <span className="item-when" title={onDate(c.modified_secs)}>
                    {age(c.age_days)}
                  </span>
                  <span className="item-size">{bytes(c.size_bytes)}</span>
                  <span className={`pill pill-${a.verdict}`}>
                    {VERDICT_PILL[a.verdict]}
                  </span>
                </div>

                {isOpen && <Detail assessment={a} project={project} home={home} />}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Detail({
  assessment: a,
  project,
  home,
}: {
  assessment: Assessment;
  project?: Project;
  home: string;
}) {
  const c = a.candidate;

  return (
    <div className="item-detail">
      <p className="detail-text">{a.rationale}</p>

      <div className="facts">
        <div className="fact">
          <dt>Where it is</dt>
          <dd className="mono">{shortPath(c.path, home)}</dd>
        </div>
        <div className="fact">
          <dt>What's inside</dt>
          <dd>
            {c.file_count.toLocaleString()} files · {bytes(c.size_bytes)}
          </dd>
        </div>
        <div className="fact">
          <dt>Last changed</dt>
          <dd>{onDate(c.modified_secs)}</dd>
        </div>

        {a.reconstruction.restoreCommand && (
          <div className="fact">
            <dt>To get it back</dt>
            <dd className="mono cmd">{a.reconstruction.restoreCommand}</dd>
          </div>
        )}

        {project?.is_git && (
          <div className="fact">
            <dt>Project activity</dt>
            <dd>
              {project.last_commit_days !== null
                ? `Last saved ${age(project.last_commit_days)}`
                : "No history yet"}
            </dd>
          </div>
        )}

        {project && project.uncommitted_files > 0 && (
          <div className="fact">
            <dt>Unsaved work</dt>
            <dd className="warn">
              {project.uncommitted_files} files with changes
            </dd>
          </div>
        )}
      </div>

      {a.error && <p className="detail-error">{a.error}</p>}
    </div>
  );
}
