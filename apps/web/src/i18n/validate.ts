export type TranslationTree = { [key: string]: string | TranslationTree };

/** Flattens nested JSON into dot-separated keys: { a: { b: "x" } } -> { "a.b": "x" }. */
export function flatten(tree: TranslationTree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[path] = value;
    else Object.assign(result, flatten(value, path));
  }
  return result;
}

function placeholders(text: string): string {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

/**
 * Compares a translation against the reference (English) and returns human-readable problems:
 * missing keys, extra keys, empty values and mismatched {{placeholders}}.
 */
export function compareTranslations(
  reference: TranslationTree,
  candidate: TranslationTree,
): string[] {
  const ref = flatten(reference);
  const cand = flatten(candidate);
  const problems: string[] = [];

  for (const key of Object.keys(ref)) {
    const value = cand[key];
    if (value === undefined) problems.push(`missing key "${key}"`);
    else if (value.trim() === '') problems.push(`empty value for "${key}"`);
    else if (placeholders(value) !== placeholders(ref[key] ?? '')) {
      problems.push(`placeholder mismatch in "${key}"`);
    }
  }
  for (const key of Object.keys(cand)) {
    if (!(key in ref)) problems.push(`unexpected key "${key}"`);
  }
  return problems;
}
