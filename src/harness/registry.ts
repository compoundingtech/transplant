import { ClaudeHarness } from "./claude.ts";
import { CodexHarness } from "./codex.ts";
import type { Harness, HarnessName, SessionRef } from "./types.ts";

const REGISTRY: Record<HarnessName, Harness> = {
  "claude-code": new ClaudeHarness(),
  "codex": new CodexHarness(),
};

export const HARNESS_NAMES = Object.keys(REGISTRY) as HarnessName[];

export function getHarness(name: HarnessName): Harness {
  const h = REGISTRY[name];
  if (!h) throw new Error(`unknown harness: ${name}`);
  return h;
}

export function isHarnessName(value: string): value is HarnessName {
  return value in REGISTRY;
}

/** Harnesses that have any state under `home`. */
export async function detectHarnesses(home: string): Promise<Harness[]> {
  const present: Harness[] = [];
  for (const name of HARNESS_NAMES) {
    const h = getHarness(name);
    if (await h.detect(home)) present.push(h);
  }
  return present;
}

/** Every session across all (or one) harness, newest first. */
export async function listAll(
  home: string,
  only?: HarnessName,
): Promise<SessionRef[]> {
  const names = only ? [only] : HARNESS_NAMES;
  const all: SessionRef[] = [];
  for (const name of names) {
    all.push(...(await getHarness(name).list(home)));
  }
  all.sort((a, b) => b.lastModified - a.lastModified);
  return all;
}

/**
 * Locate a session by id across harnesses. Returns all matches (usually one).
 * `only` restricts the search to a single harness for disambiguation.
 */
export async function findAcross(
  home: string,
  sessionId: string,
  only?: HarnessName,
): Promise<SessionRef[]> {
  const names = only ? [only] : HARNESS_NAMES;
  const matches: SessionRef[] = [];
  for (const name of names) {
    const ref = await getHarness(name).find(home, sessionId);
    if (ref) matches.push(ref);
  }
  return matches;
}
