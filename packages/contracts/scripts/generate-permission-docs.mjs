// Rewrites the generated matrix block in docs/permission-matrix.md from the catalog.
// Usage: pnpm --filter @intime/contracts docs:permissions   (builds first, see package.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { MATRIX_END, MATRIX_START, renderPermissionMatrix } from '../dist/index.js';

const docPath = new URL('../../../docs/permission-matrix.md', import.meta.url);
const doc = readFileSync(docPath, 'utf8');
const start = doc.indexOf(MATRIX_START);
const end = doc.indexOf(MATRIX_END);
if (start < 0 || end < start) {
  console.error('Markers not found in docs/permission-matrix.md');
  process.exit(1);
}
const updated = `${doc.slice(0, start + MATRIX_START.length)}\n\n${renderPermissionMatrix()}\n\n${doc.slice(end)}`;
if (updated === doc) {
  console.log('permission-matrix.md is already up to date');
} else {
  writeFileSync(docPath, updated);
  console.log('permission-matrix.md updated');
}
