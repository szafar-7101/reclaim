# Reclaim

**Confidence-gated disk space recovery for developers.**

Your Mac is full of `node_modules`, `.venv`, `target/`, `DerivedData`, and stale
build caches. Reclaim finds them, works out which are genuinely safe to delete,
and moves those to Trash.

The interesting part is *how* it decides.

---

## The problem with every other disk cleaner

They delete by pattern match.

```
**/node_modules  →  delete
**/target        →  delete
```

That's why people don't trust them. A hardcoded rule can't tell the difference
between a `build/` directory that Webpack regenerates in nine seconds and a
`build/` directory someone hand-edited a deploy script into three years ago. It
has no notion of being *unsure*, so it can't hesitate — it either deletes or it
doesn't.

## What Reclaim does instead

Reclaim settles the obvious cases with deterministic rules — `__pycache__` is
`__pycache__`, and a lookup table is more accurate than a model there — and
escalates only what is genuinely ambiguous to
[TypeSafe AI's **Jev**](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
a System One model that returns typed probabilistic decisions rather than text.
Either way, the verdict gates on calibrated confidence.

```
confidence ≥ 95%   →  safe        pre-selected for you
70% – 95%          →  review      shown with reasoning, your call
< 70%              →  keep        never auto-selected
```

Nothing is deleted on a probability alone. Everything goes to Trash, with a
receipt.

---

## The six agents

```
┌─ 1. PROSPECTOR ──────  Rust. Walks the disk, gathers context.              no AI
├─ 2. TRIAGE ──────────  Rules. Settles the obvious, flags the ambiguous.    no AI
│
├─ 3. CLASSIFIER ──────  Jev Choice.  What kind of directory is this?
├─ 4. SAFETY AUDITOR ──  Jev Noul ×2 + Score.  Can it come back? Is it unique?
├─ 5. RECONSTRUCTOR ───  Jev Noul ×2.  What command restores it?
│
└─ 6. RECLAIMER ───────  Rust. Moves to Trash, writes a receipt.             no AI
```

**Half the pipeline has no model in it, on purpose.** The filesystem walk should
be fast and deterministic. Most classification is a lookup, not a judgement. And
the component that touches your files should be dumb, auditable, and reversible.

Only what stage 2 cannot settle reaches 3–5 — about one directory in five. Those
three are independent given the same input, so they run concurrently: one round
trip, not three.

**Full detail on each: [AGENTS.md](AGENTS.md).**

### Why three agents instead of one call

Separating identification from judgement lets the app say something a single
combined question cannot:

> *"99% sure this is `node_modules`, but only 60% sure it's safe to remove."*

Agent 3 also asks the safety question from both directions — *can this come
back?* and *could something unique be lost?* — and requires both to agree. That
catches the `build/` folder with hand-edited files in it that a single question
would wave through.

### How the score combines

The three factors **multiply**, they don't average:

```ts
score = regenerable
      × (1 − containsOriginalWork)
      × (1 − risk / 2)
      × restoreBonus
score = min(score, classifierConfidence)
```

An average lets a confident *"definitely regenerable"* drown out a quiet
*"might contain original work."* A product means any single agent raising its
hand drags the result out of the safe band — which is the behaviour you want
from something that deletes files.

The classifier's confidence **caps** the result rather than contributing to it:
a low-confidence identification must never produce a high-confidence verdict.

---

## Safety

- **Trash, never `rm`.** Everything is recoverable until you empty it.
- **Every artifact is tied to its project.** Reclaim walks up to the nearest git
  repository, then shows you the branch, the last commit, and how many files have
  uncommitted changes — so you know what you'd actually be disturbing.
- **Every run rehearses first.** A dry pass runs the identical protected-path
  checks; if anything would be refused, nothing moves.
- **A hard floor below the model.** `reclaimer.rs` refuses the home directory,
  top-level user folders, system paths, anything shallower than two levels, and
  any directory containing a `.git` — regardless of what any agent scored. It
  cannot be overridden from the UI.
- **Failures fail closed.** An assessment that errors is scored `0` and kept.
- **Receipts.** Each run writes a JSON manifest to
  `~/Library/Application Support/ai.reclaim.app/receipts/`.

---

## Running it

Requires [Rust](https://rustup.rs) and Node 20+.

```sh
npm install
npm run tauri dev
```

**No API key needed.** Triage handles every unambiguous case offline and free;
anything it can't settle is shown as "worth checking" for you to decide.

Adding a [TypeSafe key](https://console.typesafe.ai/keys) in Settings lets the
model resolve those automatically. It's stored on your machine and never bundled
into the binary.

To build a distributable `.dmg`:

```sh
npm run tauri build
```

---

## Stack

| | |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | React 19 + TypeScript |
| Decisions | [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) — Jev |
| Deletion | [`trash`](https://crates.io/crates/trash) |

Jev calls are tunnelled through Rust via `@tauri-apps/plugin-http`. The webview's
origin is `tauri://localhost`, so a browser `fetch` would be blocked by CORS
before it ever left the machine.

## Licence

MIT
