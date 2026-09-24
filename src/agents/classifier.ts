import { choice } from "@typesafe-ai/sdk";
import { getClient, describe } from "./jev";
import type { Candidate, Classification, ArtifactKind } from "./types";

/**
 * Agent 2 — Classifier.
 *
 * Answers one question: what *is* this directory? It does not decide whether
 * to delete anything. Keeping identification separate from judgement is what
 * lets us say "we are 99% sure this is node_modules, but only 60% sure it is
 * safe to remove" — a sentence a single combined call cannot produce.
 */
export const KIND_CRITERIA = {
  package_deps:
    "Third-party dependencies installed by a package manager, such as node_modules, vendor, or Pods. Reinstallable from a lockfile.",
  virtual_env:
    "A language virtual environment or interpreter sandbox, such as .venv, venv, or a conda environment.",
  build_output:
    "Compiled or bundled output produced by a build, such as target, dist, build, or .next.",
  tool_cache:
    "A cache written by a build tool, test runner, or linter, such as .cache, __pycache__, .pytest_cache, or .turbo.",
  ide_artifact:
    "Derived data written by an editor or IDE, such as Xcode DerivedData or Gradle caches.",
  source_code:
    "Hand-written source code or project files that a developer authored themselves.",
  user_data:
    "Personal documents, media, or other irreplaceable data belonging to the user.",
} as const;

export async function classify(
  apiKey: string,
  candidate: Candidate,
): Promise<Classification> {
  const client = getClient(apiKey);

  const response = await client.systemOne({
    state: describe(candidate),
    questions: {
      kind: choice(
        "What kind of directory is this, judged from its name, location, size, and the manifests sitting beside it?",
        KIND_CRITERIA,
      ),
    },
  });

  const answer = response.answers.kind;

  return {
    kind: answer.choice as ArtifactKind,
    confidence: answer.confidence,
    probabilities: answer.probabilities as Record<string, number>,
  };
}
