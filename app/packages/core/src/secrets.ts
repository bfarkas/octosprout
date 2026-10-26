/**
 * Possible secrets in record text (spec §18.3, §19 OSV013). A heuristic that
 * only ever produces warnings: known token formats, private key blocks and
 * long high-entropy strings.
 */

export interface SecretHit {
  /** 0-based line within the scanned text. */
  index: number;
  kind: string;
  /** The first characters of the match, never the whole secret. */
  preview: string;
}

const KNOWN: ReadonlyArray<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["OctoSprout inbox token", /\bost_[A-Za-z0-9_-]{40,}/],
];

/** Runs of base64-ish characters. Hyphens and slashes split runs, so IDs, UUIDs and URL paths stay short. */
const CANDIDATE = /[A-Za-z0-9+_=]{32,}/g;

export function scanForSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [kind, pattern] of KNOWN) {
      const match = pattern.exec(line);
      if (match) {
        hits.push({ index, kind, preview: preview(match[0]) });
        return;
      }
    }
    for (const match of line.matchAll(CANDIDATE)) {
      const value = match[0];
      const before = line.slice(0, match.index);
      // Signatures and public keys carry their algorithm prefix.
      if (/ed25519:$/.test(before)) continue;
      if (looksRandom(value)) {
        hits.push({ index, kind: "high-entropy string", preview: preview(value) });
        return;
      }
    }
  });
  return hits;
}

function preview(value: string): string {
  return `${value.slice(0, 6)}…`;
}

/**
 * Mixed-case letters and digits with high Shannon entropy. Pure hex (commit
 * SHAs, content hashes) is excluded, because records are full of it.
 */
function looksRandom(value: string): boolean {
  if (/^[0-9a-f]+$/i.test(value)) return false;
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) return false;
  return entropy(value) >= 4.5;
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
