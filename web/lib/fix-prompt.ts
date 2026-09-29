// The "copy a fix prompt" text: one finding, written for an AI coding assistant.
//
// Built ONLY from what the report already shows its reader. The API decides what that is
// (lib/evidence.ts): for the secrets, backend and exposure families, a reader who is not the app's
// verified owner never receives the reason, target or evidence, so a prompt built here cannot carry
// a location the page withheld. Evidence stays out even for owners: it is machine output, and for a
// leaked secret it can hold part of the secret, which does not belong in a chat with a model.

export type FixPromptInput = {
  origin: string;
  /** The category as a reader meets it, e.g. "security headers". */
  category: string;
  probeId: string;
  reason?: string | null;
  targets?: string[];
  expected?: string | null;
  actual?: string | null;
  remediation?: string | null;
};

// A finding can fire on dozens of paths; the first few are enough to start from.
const MAX_TARGETS = 5;

export function fixPrompt(p: FixPromptInput): string {
  const targets = (p.targets ?? []).filter(Boolean);
  const where =
    targets.length > MAX_TARGETS
      ? `${targets.slice(0, MAX_TARGETS).join(", ")}, and ${targets.length - MAX_TARGETS} more`
      : targets.join(", ");
  const lines = [
    `Sloptic tested my web app at ${p.origin} from the outside and found a problem.`,
    "",
    `Check: ${p.category} (${p.probeId})`,
    p.reason ? `Problem: ${p.reason}` : null,
    where ? `Where: ${where}` : null,
    p.expected ? `Expected: ${p.expected}` : null,
    p.actual ? `Found instead: ${p.actual}` : null,
    p.remediation ? `Suggested fix: ${p.remediation}` : null,
    "",
    "Sloptic cannot see my code. Find where this comes from in my code and fix it.",
    "Then tell me what you changed and how I can check that it worked.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}
