import { noul } from "@typesafe-ai/sdk";
import { getClient, describe } from "./jev";
import type { Candidate, Reconstruction } from "./types";

/**
 * Agent 5 — Reconstructor.
 *
 * "Safe to delete" and "easy to get back" are different claims. This agent
 * establishes the second one, and it is what turns a scary delete into a
 * cheap one: if we can name the exact command that restores a directory, the
 * worst case is a `npm install`, not a lost afternoon.
 *
 * It also asks whether the project is live. A 40 GB node_modules touched this
 * morning is a worse target than a 2 GB one untouched since last year, even
 * though both are perfectly regenerable.
 */

/** Manifest → the command that rebuilds what sits beside it. Ordered by
 *  specificity: a lockfile pins the package manager, a bare manifest does not. */
const RESTORE_COMMANDS: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm install"],
  ["yarn.lock", "yarn install"],
  ["bun.lockb", "bun install"],
  ["package-lock.json", "npm ci"],
  ["package.json", "npm install"],
  ["Cargo.lock", "cargo build"],
  ["Cargo.toml", "cargo build"],
  ["poetry.lock", "poetry install"],
  ["Pipfile.lock", "pipenv install"],
  ["pyproject.toml", "pip install -e ."],
  ["requirements.txt", "pip install -r requirements.txt"],
  ["go.sum", "go mod download"],
  ["go.mod", "go mod download"],
  ["Gemfile.lock", "bundle install"],
  ["Gemfile", "bundle install"],
  ["Podfile.lock", "pod install"],
  ["Podfile", "pod install"],
  ["build.gradle.kts", "./gradlew build"],
  ["build.gradle", "./gradlew build"],
  ["pom.xml", "mvn install"],
];

export function inferRestoreCommand(manifests: string[]): string | null {
  for (const [manifest, command] of RESTORE_COMMANDS) {
    if (manifests.includes(manifest)) return command;
  }
  return null;
}

export async function reconstruct(
  apiKey: string,
  candidate: Candidate,
): Promise<Reconstruction> {
  const client = getClient(apiKey);

  const response = await client.systemOne({
    state: describe(candidate),
    questions: {
      restorable: noul(
        "The manifests or lockfiles sitting next to this directory are sufficient to restore its full contents by running a single standard command.",
      ),
      actively_in_use: noul(
        "This directory belongs to a project the developer is actively working on right now, judging from how recently it was modified.",
      ),
    },
  });

  return {
    restorable: response.answers.restorable.noul,
    activelyInUse: response.answers.actively_in_use.noul,
    restoreCommand: inferRestoreCommand(candidate.sibling_manifests),
  };
}
