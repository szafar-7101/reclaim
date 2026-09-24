import { classify } from "./classifier";
import { audit } from "./auditor";
import { reconstruct } from "./reconstructor";
import { triage } from "./triage";
import { consequence, KIND_NAME } from "../lib/language";
import type {
  Assessment,
  Candidate,
  Classification,
  Reconstruction,
  SafetyAudit,
  Verdict,
} from "./types";

/** Kinds that are never auto-selected, whatever the probabilities say. */
const NEVER_AUTO = new Set(["source_code", "user_data"]);

export const GATE = {
  /** At or above this, a candidate is pre-selected for the user. */
  safe: 0.95,
  /** Between `review` and `safe`, we show it and let the user decide. */
  review: 0.7,
} as const;

/**
 * Combine the model agents into one score.
 *
 * The factors multiply rather than average, and that is the whole point. An
 * average lets a confident "definitely regenerable" drown out a quiet "might
 * contain original work". A product means any single agent raising its hand
 * drags the result out of the safe band — which is the behaviour you want from
 * something that deletes files.
 */
export function gateScore(
  classification: Classification,
  safety: SafetyAudit,
  reconstruction: Reconstruction,
): number {
  const notOriginal = 1 - safety.containsOriginalWork;
  const lowRisk = 1 - safety.risk / 2;
  // A known restore command is a bonus, not a requirement: plenty of caches
  // rebuild with no manifest at all, so its absence must not veto.
  const restoreBonus = 0.9 + 0.1 * reconstruction.restorable;

  const base = safety.regenerable * notOriginal * lowRisk * restoreBonus;

  // A low-confidence identification must not produce a high-confidence verdict,
  // so the classifier's certainty caps the result rather than contributing.
  return Math.min(base, classification.confidence);
}

export function decide(kind: string, score: number): Verdict {
  if (NEVER_AUTO.has(kind)) return "keep";
  if (score >= GATE.safe) return "safe";
  if (score >= GATE.review) return "review";
  return "keep";
}

/**
 * Safety figures for a candidate triage settled on its own.
 *
 * These are derived, not guessed: triage only settles at 95%+ certainty about
 * the *kind*, and every kind it can settle is regenerable by definition. They
 * are labelled `decidedBy: "triage"` in the UI so a user is never misled into
 * thinking a model produced them.
 */
function derivedSafety(): SafetyAudit {
  return { regenerable: 0.98, containsOriginalWork: 0.02, risk: 0.1, riskConfidence: 1 };
}

function humanKind(kind: string): string {
  return kind === "user_data" ? "your own files" : "code someone wrote";
}

/**
 * Assess one candidate.
 *
 * Triage runs first and settles most of them for free. Only what it cannot
 * settle costs a model call — and with no API key, unsettled cases surface as
 * "review" rather than blocking the scan.
 */
export async function assess(
  apiKey: string | null,
  candidate: Candidate,
): Promise<Assessment> {
  const t = triage(candidate);

  // --- settled deterministically ------------------------------------------
  if (!t.escalate) {
    const classification: Classification = {
      kind: t.kind,
      confidence: t.confidence,
      probabilities: { [t.kind]: t.confidence },
    };
    const safety = derivedSafety();
    const reconstruction: Reconstruction = {
      restorable: t.restoreCommand ? 0.98 : 0.6,
      activelyInUse: 0,
      restoreCommand: t.restoreCommand,
    };
    const score = Math.min(t.confidence, gateScore(classification, safety, reconstruction));

    return {
      candidate,
      classification,
      safety,
      reconstruction,
      score,
      verdict: decide(t.kind, score),
      rationale: `${t.reason} ${consequence(t.kind, t.restoreCommand)}`,
      decidedBy: "triage",
    };
  }

  // --- ambiguous, but no key to resolve it --------------------------------
  if (!apiKey) {
    return {
      candidate,
      classification: { kind: t.kind, confidence: t.confidence, probabilities: {} },
      safety: { regenerable: 0, containsOriginalWork: 0.5, risk: 1, riskConfidence: 0 },
      reconstruction: {
        restorable: t.restoreCommand ? 0.9 : 0,
        activelyInUse: 0,
        restoreCommand: t.restoreCommand,
      },
      score: Math.min(t.confidence, GATE.safe - 0.01),
      verdict: "review",
      rationale: `${t.reason} Reclaim has left this one for you to decide.`,
      decidedBy: "triage",
    };
  }

  // --- escalated to the model ---------------------------------------------
  try {
    const [classification, safety, reconstruction] = await Promise.all([
      classify(apiKey, candidate),
      audit(apiKey, candidate),
      reconstruct(apiKey, candidate),
    ]);

    const score = gateScore(classification, safety, reconstruction);
    const verdict = decide(classification.kind, score);

    const parts: string[] = [];

    if (NEVER_AUTO.has(classification.kind)) {
      parts.push(
        `This looks like ${humanKind(classification.kind)}, so Reclaim won't touch it.`,
      );
    } else {
      parts.push(
        `Reclaim wasn't sure, so it checked more closely: this is ${KIND_NAME[classification.kind].toLowerCase()}.`,
        consequence(classification.kind, reconstruction.restoreCommand),
      );
      if (safety.containsOriginalWork > 0.2) {
        parts.push(`There's a chance it holds something that isn't saved anywhere else.`);
      }
      if (reconstruction.activelyInUse > 0.6) {
        parts.push(`You've been working here recently, so you'd have to rebuild it today.`);
      }
    }

    return {
      candidate,
      classification,
      safety,
      reconstruction,
      score,
      verdict,
      rationale: parts.join(" "),
      decidedBy: "model",
    };
  } catch (err) {
    // A failed assessment must never read as "safe". Fail closed.
    return {
      candidate,
      classification: { kind: "source_code", confidence: 0, probabilities: {} },
      safety: { regenerable: 0, containsOriginalWork: 1, risk: 2, riskConfidence: 0 },
      reconstruction: { restorable: 0, activelyInUse: 0, restoreCommand: t.restoreCommand },
      score: 0,
      verdict: "keep",
      rationale: `Could not assess this directory, so it is being kept.`,
      decidedBy: "model",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PipelineProgress {
  done: number;
  total: number;
  current: string;
  /** How many needed a model call. Surfaced so the cost of a scan is visible. */
  escalated: number;
}

/**
 * Run the pipeline over every candidate.
 *
 * Triage is synchronous and free, so it runs over everything first. Only the
 * escalations go through the bounded worker pool — which means the concurrency
 * limit protects the API, not the scan.
 */
export async function runPipeline(
  apiKey: string | null,
  candidates: Candidate[],
  onProgress?: (p: PipelineProgress) => void,
  concurrency = 6,
): Promise<Assessment[]> {
  const results: Assessment[] = new Array(candidates.length);
  const needsModel: number[] = [];

  // Pass one: settle everything triage can, instantly.
  candidates.forEach((candidate, i) => {
    if (triage(candidate).escalate) needsModel.push(i);
  });

  let done = 0;
  const total = candidates.length;
  const escalated = apiKey ? needsModel.length : 0;

  const settleImmediately = candidates
    .map((_, i) => i)
    .filter((i) => !needsModel.includes(i));

  for (const i of settleImmediately) {
    results[i] = await assess(apiKey, candidates[i]);
    done += 1;
  }
  onProgress?.({ done, total, current: "", escalated });

  // Pass two: the ambiguous remainder.
  let cursor = 0;
  async function worker() {
    while (true) {
      const slot = cursor++;
      if (slot >= needsModel.length) return;
      const i = needsModel[slot];

      results[i] = await assess(apiKey, candidates[i]);
      done += 1;
      onProgress?.({ done, total, current: candidates[i].path, escalated });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, needsModel.length) }, worker),
  );

  return results;
}

/** How many candidates would need a model call, without making any. */
export function countEscalations(candidates: Candidate[]): number {
  return candidates.filter((c) => triage(c).escalate).length;
}
