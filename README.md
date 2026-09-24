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

Reclaim asks [TypeSafe AI's **Jev**](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
— a System One model that returns typed probabilistic decisions rather than text
— and gates on the calibrated confidence that comes back.

```
confidence ≥ 95%   →  safe        pre-selected for you
70% – 95%          →  review      shown with reasoning, your call
< 70%              →  keep        never auto-selected
```

Nothing is deleted on a probability alone. Everything goes to Trash, with a
receipt.

---

## The five agents

```
┌─ 1. PROSPECTOR ──────  Rust. Walks the filesystem, gathers context.        no AI
│
├─ 2. CLASSIFIER ──────  Jev Choice.  What kind of directory is this?
│
├─ 3. SAFETY AUDITOR ──  Jev Noul + Score.  Regenerable? Unique work? Risk?
│
├─ 4. RECONSTRUCTOR ───  Jev Noul.  Can we name the command that restores it?
│
└─ 5. RECLAIMER ───────  Rust. Moves to Trash, writes an undo receipt.       no AI
```

**Agents 1 and 5 have no AI in them, on purpose.** The filesystem walk should be
fast and deterministic. The component that touches your files should be dumb,
auditable, and reversible. Putting a model in either would be a mistake.

Agents 2, 3 and 4 are independent given the same input, so they run
concurrently — one round trip, not three.

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

Requires [Rust](https://rustup.rs), Node 20+, and a TypeSafe API key from
[console.typesafe.ai/keys](https://console.typesafe.ai/keys).

```sh
npm install
npm run tauri dev
```

Paste your key on first launch. It's stored in the Tauri store on your machine
and is never bundled into the binary.

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
