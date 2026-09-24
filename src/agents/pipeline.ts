import { classify } from "./classifier";
import { audit } from "./auditor";
import { reconstruct } from "./reconstructor";
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
 * Combine three agents into one score.
 *
 * The three factors multiply rather than average, and that is the whole point.
 * An average lets a confident "definitely regenerable" drown out a quiet
 * "might contain original work". A product means any single agent raising its
 * hand drags the result down and drops the candidate out of the safe band —
 * which is the behaviour you want from something that deletes files.
 */
export function gateScore(
  classification: Classification,
  safety: SafetyAudit,
  reconstruction: Reconstruction,
): number {
  const regenerable = safety.regenerable;
  const notOriginal = 1 - safety.containsOriginalWork;
  // risk is 0..2 from the rubric; 0 is harmless, 2 is severe.
  const lowRisk = 1 - safety.risk / 2;
  // A known restore command is a bonus, not a requirement: plenty of caches
  // rebuild themselves with no manifest at all, so its absence must not veto.
  const restoreBonus = 0.9 + 0.1 * reconstruction.restorable;

  const base = regenerable * notOriginal * lowRisk * restoreBonus;

  // A low-confidence identification should not produce a high-confidence
  // verdict, so the classifier's certainty caps the result rather than
  // contributing to it.
  return Math.min(base, classification.confidence);
}

export function decide(
  classification: Classification,
  score: number,
): Verdict {
  if (NEVER_AUTO.has(classification.kind)) return "keep";
  if (score >= GATE.safe) return "safe";
  if (score >= GATE.review) return "review";
  return "keep";
}

function explain(
  c: Candidate,
  classification: Classification,
  safety: SafetyAudit,
  reconstruction: Reconstruction,
  verdict: Verdict,
): string {
  const kind = classification.kind.replace(/_/g, " ");
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  if (verdict === "keep" && NEVER_AUTO.has(classification.kind)) {
    return `Identified as ${kind} (${pct(classification.confidence)} confidence). Never auto-selected, regardless of score.`;
  }

  const parts = [
    `Identified as ${kind} at ${pct(classification.confidence)} confidence.`,
    `${pct(safety.regenerable)} regenerable, ${pct(safety.containsOriginalWork)} chance of holding original work.`,
  ];

  if (reconstruction.restoreCommand) {
    parts.push(`Restorable with \`${reconstruction.restoreCommand}\`.`);
  } else {
    parts.push(`No restore command found next to it.`);
  }

  if (reconstruction.activelyInUse > 0.6) {
    parts.push(`Looks like an active project — deleting costs you a rebuild today.`);
  } else if (c.age_days < 365 * 100) {
    parts.push(`Untouched for ${c.age_days} days.`);
  }

  return parts.join(" ");
}

/**
 * Assess one candidate. Agents 2, 3 and 4 are independent given the same
 * input, so they run concurrently — the cost is one round trip, not three.
 */
export async function assess(apiKey: string, candidate: Candidate): Promise<Assessment> {
  try {
    const [classification, safety, reconstruction] = await Promise.all([
      classify(apiKey, candidate),
      audit(apiKey, candidate),
      reconstruct(apiKey, candidate),
    ]);

    const score = gateScore(classification, safety, reconstruction);
    const verdict = decide(classification, score);

    return {
      candidate,
      classification,
      safety,
      reconstruction,
      score,
      verdict,
      rationale: explain(candidate, classification, safety, reconstruction, verdict),
    };
  } catch (err) {
    // A failed assessment must never read as "safe". Fail closed.
    const message = err instanceof Error ? err.message : String(err);
    return {
      candidate,
      classification: { kind: "source_code", confidence: 0, probabilities: {} },
      safety: { regenerable: 0, containsOriginalWork: 1, risk: 2, riskConfidence: 0 },
      reconstruction: { restorable: 0, activelyInUse: 0, restoreCommand: null },
      score: 0,
      verdict: "keep",
      rationale: `Could not assess this directory, so it is being kept.`,
      error: message,
    };
  }
}

export interface PipelineProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * Run the pipeline over every candidate with bounded concurrency. Unbounded
 * `Promise.all` over a few hundred directories would rate-limit us and make
 * the progress bar useless.
 */
export async function runPipeline(
  apiKey: string,
  candidates: Candidate[],
  onProgress?: (p: PipelineProgress) => void,
  concurrency = 6,
): Promise<Assessment[]> {
  const results: Assessment[] = new Array(candidates.length);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= candidates.length) return;

      const candidate = candidates[index];
      results[index] = await assess(apiKey, candidate);

      done += 1;
      onProgress?.({ done, total: candidates.length, current: candidate.path });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker),
  );

  return results;
}
