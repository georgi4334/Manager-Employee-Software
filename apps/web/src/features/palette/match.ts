/** Lower case without accents, so "Ünal" matches "unal" and "Ива" matches "ива". */
export const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const words = (text: string) => normalize(text).split(/\s+/).filter(Boolean);

/**
 * How well `query` matches `text` (docs/adr/0039-command-palette.md): every typed word must occur; a word that
 * starts a word of the text scores 2, one inside a word 1, and the text starting with the query adds 1.
 * 0 means no match. An empty query matches everything with 1.
 */
export function matchScore(query: string, text: string): number {
  const typed = words(query);
  if (typed.length === 0) return 1;
  const target = normalize(text);
  const targetWords = target.split(/[\s›/,.\-–:()]+/).filter(Boolean);
  let score = 0;
  for (const word of typed) {
    if (targetWords.some((w) => w.startsWith(word))) score += 2;
    else if (target.includes(word)) score += 1;
    else return 0;
  }
  return target.startsWith(typed.join(' ')) ? score + 1 : score;
}

/** The entries that match, best first; ties keep their order. */
export function rank<T>(query: string, entries: readonly T[], text: (entry: T) => string): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: matchScore(query, text(entry)) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((e) => e.entry);
}
