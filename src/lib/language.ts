import type { ArtifactKind, Activity, Verdict } from "../agents/types";

/**
 * Everything the user reads, in one place.
 *
 * The internal names are precise for the code and useless for a person.
 * Nobody scanning their Mac wants to read "package_deps, regenerable 0.98".
 * They want to know what it is and what happens if it goes.
 */

export const KIND_NAME: Record<ArtifactKind, string> = {
  package_deps: "Installed packages",
  virtual_env: "Python environment",
  build_output: "Build files",
  tool_cache: "Cache",
  ide_artifact: "Xcode files",
  source_code: "Your code",
  user_data: "Your files",
};

/** What this kind *is*, in one plain sentence. */
export const KIND_MEANING: Record<ArtifactKind, string> = {
  package_deps: "Code downloaded from the internet that your project depends on.",
  virtual_env: "A self-contained Python setup for one project.",
  build_output: "Files created when the project was built.",
  tool_cache: "Saved work from a tool, kept around to make it faster next time.",
  ide_artifact: "Working files your editor generated.",
  source_code: "Code someone wrote by hand.",
  user_data: "Personal files.",
};

export const VERDICT_PILL: Record<Verdict, string> = {
  safe: "Safe to remove",
  review: "Worth checking",
  keep: "Keeping",
};

export const ACTIVITY_TEXT: Record<Activity, string> = {
  live: "Used this week",
  recent: "Used this month",
  dormant: "Quiet for months",
  stale: "Not touched this year",
  abandoned: "Abandoned",
  unknown: "No recent activity",
};

/** Plain-English consequence. This is the sentence that actually decides it. */
export function consequence(
  kind: ArtifactKind,
  restoreCommand: string | null,
): string {
  if (kind === "source_code" || kind === "user_data") {
    return "This can't be recreated, so Reclaim won't touch it.";
  }
  if (restoreCommand) {
    return `If you need it again, run ${restoreCommand} and it comes straight back.`;
  }
  const back: Record<string, string> = {
    package_deps: "Reinstalling the project's packages brings them back.",
    virtual_env: "You'd set the environment up again, which takes a minute.",
    build_output: "They're recreated the next time you build.",
    tool_cache: "It refills on its own as you work.",
    ide_artifact: "Your editor regenerates these automatically.",
  };
  return back[kind] ?? "It can be recreated.";
}
