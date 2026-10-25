/** Hands text to the browser as a file download; nothing is kept in memory afterwards. */
export function saveText(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Hands a JSON document to the browser as a file download. */
export function saveJson(data: unknown, filename: string): void {
  saveText(JSON.stringify(data, null, 2), filename, 'application/json');
}
