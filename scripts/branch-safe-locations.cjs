'use strict';
const { readFileSync, lstatSync } = require('node:fs');
const path = require('node:path');
const sources = require('./branch-safe-sources.json');
const statuses = ['failed', 'timedOut', 'interrupted'];
const kinds = ['definition', 'stack'];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function sourceLocations(root = process.cwd()) {
  const limits = new Map();
  for (const file of sources) {
    if (!/^tests\/(?:specs\/(?:normal|premium)|tools)\/[a-z0-9-]+(?:\.spec)?\.ts$/.test(file)) throw new Error('Invalid source allowlist');
    const absolute = path.resolve(root, file);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid source file');
    limits.set(file, readFileSync(absolute, 'utf8').split('\n').length);
  }
  function location(file, line) {
    if (typeof file !== 'string' || !Number.isInteger(line) || line < 1) return null;
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    if (!limits.has(relative) || line > limits.get(relative)) return null;
    return { file: relative, line };
  }
  function fromStack(stack) {
    if (typeof stack !== 'string') return [];
    const matches = [];
    const text = stack.slice(0, 65536).replaceAll('\\', '/');
    for (const [file, max] of limits) {
      const absolute = path.resolve(root, file).split(path.sep).join('/');
      const pattern = new RegExp(`(?:^|[\\s(])(?:${escape(absolute)}|${escape(file)}):([1-9][0-9]{0,5}):[1-9][0-9]{0,5}(?=[)\\s]|$)`, 'gm');
      for (const match of text.matchAll(pattern)) {
        const line = Number(match[1]);
        if (line <= max && !matches.some(item => item.file === file && item.line === line)) matches.push({ file, line });
        if (matches.length >= 5) return matches;
      }
    }
    return matches;
  }
  function validate(entries) {
    if (!Array.isArray(entries) || entries.length > 256) throw new Error('Invalid failure coordinates');
    for (const entry of entries) {
      if (!entry || Object.keys(entry).sort().join(',') !== 'file,kind,line,status'
          || !statuses.includes(entry.status) || !kinds.includes(entry.kind)
          || !location(entry.file, entry.line) || entry.file !== location(entry.file, entry.line).file) {
        throw new Error('Invalid failure coordinates');
      }
    }
    return entries;
  }
  return { location, fromStack, validate };
}
module.exports = { sourceLocations, statuses };
