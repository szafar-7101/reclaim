# The six agents

Reclaim answers one question — *is this directory safe to delete?* — by passing
it through six stages. Three of them contain no model at all.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  1  PROSPECTOR      Rust          finds candidates                │  no AI
  │  2  TRIAGE          TypeScript    settles the obvious ones        │  no AI
  ├───────────────────────────────────────────────────────────────────┤
  │  3  CLASSIFIER      Jev Choice    what is this?                   │
  │  4  SAFETY AUDITOR  Jev Noul×2    can it come back? is it unique? │   model
  │  5  RECONSTRUCTOR   Jev Noul×2    how do we restore it?           │
  ├───────────────────────────────────────────────────────────────────┤
  │  6  RECLAIMER       Rust          moves to Trash, writes receipt  │  no AI
  └───────────────────────────────────────────────────────────────────┘
```

Only what stage 2 cannot settle reaches stages 3–5. In a typical scan that is
around one directory in five.

---

## 1 — Prospector
`src-tauri/src/prospector.rs` · Rust · **no model**

**Does:** Walks the filesystem and produces a list of candidate directories with
everything a decision needs — size, file count, newest write, the manifests
sitting beside it, whether the parent is a git repository.

**How:** Single pass with `walkdir`, stopping the moment it finds a candidate
(everything below is part of the same blob). Measuring sizes is the expensive
half and each candidate is independent, so that runs in parallel via `rayon`.

**Does not:** Decide anything. It never judges what should be deleted — it only
establishes what exists and what is true about it.

**Why no model:** A filesystem walk should be fast and give the same answer
twice. There is nothing here to be uncertain about.

> Companion module `project.rs` groups candidates into projects by walking up to
> the nearest `.git` or manifest, then reads each project's git branch, last
> commit, and uncommitted file count. That is what lets the UI say *"belongs to
> arxiv-copilot, last commit 3 days ago, 4 uncommitted files"* instead of
> showing a bare path.

---

## 2 — Triage
`src/agents/triage.ts` · TypeScript · **no model**

**Does:** Settles the cases that are not actually ambiguous, and identifies the
ones that are.

**How:** A lookup table keyed on directory name, cross-checked against the
manifests beside it. Each rule carries two numbers — confidence *with* a
corroborating manifest and *without* one:

| Directory | With manifest | Bare | Why |
|---|---|---|---|
| `__pycache__` | 0.99 | 0.99 | Nothing else is ever called this |
| `node_modules` | 0.99 | 0.88 | A lockfile removes all doubt |
| `target` | 0.98 | **0.40** | Conclusive next to `Cargo.toml`. Otherwise, who knows |
| `build` | 0.94 | **0.30** | A common English word that happens to be a build directory |

At **0.95 or above, triage settles it alone** and no model is consulted. Below
that, it escalates.

**Why it exists:** You do not need a frontier model to know that `__pycache__`
is `__pycache__` — a lookup table is both more accurate and more honest there.
Two consequences fall out of that:

- **The app works with no API key.** Every unambiguous case is handled offline
  and free. Without a key, ambiguous cases surface as *review* rather than
  blocking the scan.
- **Scans make roughly 80% fewer model calls**, so they are faster and cheaper.

The `bare` column is where the real information lives. A low number is triage
saying *"this name is a coincidence waiting to happen"* — and those are exactly
the cases worth spending a model on.

---

## 3 — Classifier
`src/agents/classifier.ts` · Jev `Choice` · **model**

**Does:** Decides what kind of directory this is, across seven categories:
`package_deps`, `virtual_env`, `build_output`, `tool_cache`, `ide_artifact`,
`source_code`, `user_data`.

**Returns:** The chosen label, a confidence, and the full probability
distribution across all seven.

**Why separate from judgement:** Splitting *identification* from *safety* lets
the app say something a single combined question cannot —

> *"99% sure this is `node_modules`, but only 60% sure it's safe to remove."*

The last two categories are the important ones: anything landing on
`source_code` or `user_data` is **never auto-selected**, whatever its score.

---

## 4 — Safety Auditor
`src/agents/auditor.ts` · Jev `Noul` ×2 + `Score` · **model**

**Does:** Asks the question that actually matters, from both directions at once.

| Question | Type | Reads |
|---|---|---|
| `regenerable` | Noul | *Can a standard command rebuild this with no loss?* |
| `contains_original_work` | Noul | *Could something here exist nowhere else?* |
| `risk` | Score 0–2 | *None / minor / severe* damage if deleted |

**Why both directions:** They are not the same question inverted. A `build/`
folder someone committed a hand-edited deploy script into is *both* regenerable
*and* holds original work. Asking only the first waves it straight through.
Requiring both to agree catches it.

---

## 5 — Reconstructor
`src/agents/reconstructor.ts` · Jev `Noul` ×2 + lookup · **model**

**Does:** Establishes how *cheap* the mistake would be, which is a different
claim from whether it is safe.

| Question | Reads |
|---|---|
| `restorable` | *Do the manifests here prove a single command restores this?* |
| `actively_in_use` | *Is this a project someone is working on right now?* |

It also maps manifests to the literal command — 20 package managers, ordered by
specificity so a lockfile pins the right tool (`pnpm-lock.yaml` → `pnpm install`,
not `npm install`).

**Why it matters:** If we can name the command that brings a directory back, the
worst case is an `npm install`, not a lost afternoon. And a 40 GB `node_modules`
touched this morning is a worse target than a 2 GB one untouched since last
year, even though both are perfectly regenerable.

---

## The gate

Stages 3–5 produce three independent readings, combined in `pipeline.ts`:

```ts
score = regenerable
      × (1 − containsOriginalWork)
      × (1 − risk / 2)
      × restoreBonus              // 0.9–1.0, a bonus and never a veto

score = min(score, classifierConfidence)
```

**They multiply, they do not average.** An average lets a confident *"definitely
regenerable"* drown out a quiet *"might contain original work."* A product means
any single agent raising its hand drags the result out of the safe band — which
is the behaviour you want from something that deletes files.

**Classifier confidence caps the result** rather than contributing to it: a
low-confidence identification must never produce a high-confidence verdict.

```
score ≥ 0.95   →  safe      pre-selected
0.70 – 0.95    →  review    shown with reasoning, your call
< 0.70         →  keep      never auto-selected
```

Anything that errors is scored `0` and kept. **Failures fail closed.**

---

## 6 — Reclaimer
`src-tauri/src/reclaimer.rs` · Rust · **no model**

**Does:** Moves the chosen paths to Trash and writes a receipt.

**Refuses, unconditionally:** the home directory, top-level user folders
(`Documents`, `Desktop`, …), system paths, anything less than two levels deep,
and any directory containing a `.git`. This floor runs *after* every decision
layer and **cannot be overridden from the UI** — no score, from triage or model,
can reach past it.

**Always rehearses first.** A dry pass runs the identical checks; if anything
would be refused, nothing moves at all.

**Receipts:** every run writes a JSON manifest to
`~/Library/Application Support/ai.reclaim.app/receipts/` recording what was
moved and how large it was.

**Why no model:** The component that touches a user's files is the last place
that should be probabilistic. It takes an explicit list and does exactly what it
is told — dumb, auditable, reversible.
