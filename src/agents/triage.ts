import type { ArtifactKind, Candidate } from "./types";
import { inferRestoreCommand } from "./reconstructor";
import { KIND_NAME } from "../lib/language";

/**
 * Agent 2 — Triage.
 *
 * Deterministic, offline, free. It exists because most of what a disk scanner
 * finds is not ambiguous: `__pycache__` is `__pycache__`, and a lookup table is
 * both more accurate and more honest about that than a model would be.
 *
 * Its real job is deciding what it *cannot* settle. A directory called `build`
 * with no manifest beside it could be Webpack output or four years of someone's
 * work — that is a genuine judgement call, and those are the cases worth
 * spending a model on.
 *
 * Practically this means the app works with no API key at all, and that scans
 * with a key make roughly 80% fewer calls.
 */

interface Rule {
  kind: ArtifactKind;
  /** Confidence when a corroborating manifest sits beside it. */
  corroborated: number;
  /** Confidence with nothing to corroborate it. */
  bare: number;
  /** Manifests whose presence proves this is what we think it is. */
  corroborators?: string[];
}

/**
 * The `bare` figures carry the real information here. A high one means the name
 * alone is conclusive; a low one means the name is a coincidence waiting to
 * happen and the case belongs to the model.
 */
const RULES: Record<string, Rule> = {
  // Unambiguous by name alone — no manifest can make these more certain.
  __pycache__:       { kind: "tool_cache",   corroborated: 0.99, bare: 0.99 },
  ".pytest_cache":   { kind: "tool_cache",   corroborated: 0.99, bare: 0.99 },
  ".mypy_cache":     { kind: "tool_cache",   corroborated: 0.99, bare: 0.99 },
  ".ruff_cache":     { kind: "tool_cache",   corroborated: 0.99, bare: 0.99 },
  ".turbo":          { kind: "tool_cache",   corroborated: 0.99, bare: 0.98 },
  ".parcel-cache":   { kind: "tool_cache",   corroborated: 0.99, bare: 0.98 },
  ".nyc_output":     { kind: "tool_cache",   corroborated: 0.98, bare: 0.97 },
  DerivedData:       { kind: "ide_artifact", corroborated: 0.99, bare: 0.99 },
  ".gradle":         { kind: "ide_artifact", corroborated: 0.98, bare: 0.97 },
  ".angular":        { kind: "tool_cache",   corroborated: 0.98, bare: 0.97 },
  ".vite":           { kind: "tool_cache",   corroborated: 0.98, bare: 0.97 },
  ".svelte-kit":     { kind: "build_output", corroborated: 0.98, bare: 0.96 },
  ".next":           { kind: "build_output", corroborated: 0.99, bare: 0.96 },
  ".nuxt":           { kind: "build_output", corroborated: 0.99, bare: 0.96 },
  bower_components:  { kind: "package_deps", corroborated: 0.98, bare: 0.96 },

  // Strong by name, stronger with a lockfile.
  node_modules: {
    kind: "package_deps", corroborated: 0.99, bare: 0.88,
    corroborators: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"],
  },
  ".venv": {
    kind: "virtual_env", corroborated: 0.99, bare: 0.95,
    corroborators: ["requirements.txt", "pyproject.toml", "Pipfile", "poetry.lock", "setup.py"],
  },
  venv: {
    kind: "virtual_env", corroborated: 0.98, bare: 0.90,
    corroborators: ["requirements.txt", "pyproject.toml", "Pipfile", "poetry.lock", "setup.py"],
  },
  Pods: {
    kind: "package_deps", corroborated: 0.99, bare: 0.90,
    corroborators: ["Podfile", "Podfile.lock"],
  },

  // The interesting ones. Common English words that happen to be build
  // directories — conclusive with a manifest, a coin flip without one.
  target: {
    kind: "build_output", corroborated: 0.98, bare: 0.40,
    corroborators: ["Cargo.toml", "Cargo.lock", "pom.xml"],
  },
  build: {
    kind: "build_output", corroborated: 0.94, bare: 0.30,
    corroborators: ["package.json", "build.gradle", "build.gradle.kts", "pom.xml", "pyproject.toml", "setup.py"],
  },
  dist: {
    kind: "build_output", corroborated: 0.95, bare: 0.38,
    corroborators: ["package.json", "pyproject.toml", "setup.py", "Cargo.toml"],
  },
  vendor: {
    kind: "package_deps", corroborated: 0.95, bare: 0.35,
    corroborators: ["go.mod", "composer.json", "Gemfile"],
  },
  ".cache": {
    kind: "tool_cache", corroborated: 0.95, bare: 0.55,
  },
  coverage: {
    kind: "tool_cache", corroborated: 0.93, bare: 0.50,
    corroborators: ["package.json", "pyproject.toml"],
  },
  ".build": {
    kind: "build_output", corroborated: 0.95, bare: 0.45,
    corroborators: ["Package.swift"],
  },
  ".terraform": {
    kind: "tool_cache", corroborated: 0.97, bare: 0.85,
  },
  ".tox":  { kind: "tool_cache", corroborated: 0.97, bare: 0.90 },
  ".eggs": { kind: "tool_cache", corroborated: 0.96, bare: 0.88 },
  htmlcov: { kind: "tool_cache", corroborated: 0.94, bare: 0.75 },
  ".m2":   { kind: "package_deps", corroborated: 0.97, bare: 0.93 },
};

/** At or above this, triage settles it alone and no model is consulted. */
export const SETTLE_AT = 0.95;

export interface TriageResult {
  kind: ArtifactKind;
  confidence: number;
  /** True when triage could not settle it and a model should decide. */
  escalate: boolean;
  restoreCommand: string | null;
  reason: string;
}

export function triage(candidate: Candidate): TriageResult {
  const rule = RULES[candidate.name];
  const restoreCommand = inferRestoreCommand(candidate.sibling_manifests);

  if (!rule) {
    return {
      kind: "source_code",
      confidence: 0,
      escalate: true,
      restoreCommand,
      reason: `Reclaim doesn't recognise a folder called "${candidate.name}".`,
    };
  }

  const matched = (rule.corroborators ?? []).filter((m) =>
    candidate.sibling_manifests.includes(m),
  );
  const corroborated = rule.corroborators ? matched.length > 0 : true;
  let confidence = corroborated ? rule.corroborated : rule.bare;

  // A directory sitting directly inside a git repo with a manifest beside it is
  // a conventional project layout, which makes the conventional reading likelier.
  if (candidate.in_git_repo && candidate.sibling_manifests.length > 0) {
    confidence = Math.min(0.99, confidence + 0.02);
  }

  const escalate = confidence < SETTLE_AT;

  const kindName = KIND_NAME[rule.kind].toLowerCase();

  const reason = escalate
    ? corroborated
      ? `This looks like ${kindName}, but Reclaim isn't certain.`
      : `Nothing next to this folder says what it is — a folder called "${candidate.name}" could be anything.`
    : matched.length > 0
      ? `The ${matched[0]} file next to it confirms these are ${kindName}.`
      : `Folders named "${candidate.name}" are always ${kindName}.`;

  return { kind: rule.kind, confidence, escalate, restoreCommand, reason };
}
