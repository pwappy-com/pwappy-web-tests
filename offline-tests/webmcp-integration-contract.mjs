import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const approved = JSON.parse(readFileSync(new URL('./webmcp-integration-approved.json', import.meta.url), 'utf8'));
// Reverse only exact reviewed integration edits; preserve the prior baseline hashes.
export function restoreApprovedWebMcpIntegration(path, source) {
  for (const { before, after } of [...approved[path]].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `Exact WebMCP integration edit must occur once: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
