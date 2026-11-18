// Text normalisation shared by the matcher and time parser.

export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "") // zero-width joiners (e.g. order‌లో)
    .replace(/[.,!?;:"“”‘’()\[\]{}…।|/\\*_~`]/g, " ")
    .replace(/(\p{L})-(\p{L})/gu, "$1 $2") // Assistant-ని → assistant ని
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/**
 * Phrase matcher over tokens. A phrase is one or more words; a word ending in "*"
 * matches any token starting with it (e.g. "matlad*" → matladochu, matladandi).
 */
export function hasPhrase(toks: string[], phrase: string): boolean {
  const words = phrase.split(" ");
  outer: for (let i = 0; i + words.length <= toks.length; i++) {
    for (let j = 0; j < words.length; j++) {
      const w = words[j];
      const t = toks[i + j];
      if (w.endsWith("*") ? !t.startsWith(w.slice(0, -1)) : t !== w) continue outer;
    }
    return true;
  }
  return false;
}

export function hasAny(toks: string[], phrases: readonly string[]): boolean {
  return phrases.some((p) => hasPhrase(toks, p));
}

/** Tokens not covered by any phrase in `phrases` (used to spot extra content). */
export function uncovered(toks: string[], phrases: readonly string[]): string[] {
  const covered = new Array(toks.length).fill(false);
  for (const p of phrases) {
    const words = p.split(" ");
    for (let i = 0; i + words.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < words.length; j++) {
        const w = words[j];
        const t = toks[i + j];
        if (w.endsWith("*") ? !t.startsWith(w.slice(0, -1)) : t !== w) { ok = false; break; }
      }
      if (ok) for (let j = 0; j < words.length; j++) covered[i + j] = true;
    }
  }
  return toks.filter((_, i) => !covered[i]);
}
