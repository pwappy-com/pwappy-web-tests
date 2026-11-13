'use strict';
const { gunzipSync } = require('node:zlib');
const { isDeepStrictEqual } = require('node:util');
const { ORIGIN, VERSION } = require('./staging-native-contract.cjs');
const FIELDS = ['appSettings', 'attributeItems', 'eventItems', 'scriptItems', 'serviceWorkerItems', 'templateItems', 'toolBoxItems', 'testItems'];
const ERRORS = {
  '保存後のサーバー内容が送信内容と一致しません。ローカル変更を保持しました。': 'readback-mismatch',
  '保存後のサーバーデータを確認できませんでした。再取得を確認してから再試行してください。': 'readback-invalid',
  '保存後の再取得に失敗しました。': 'readback-failed',
};
const code = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const tri = value => typeof value === 'boolean' ? value : null;
function emptyDiagnostic() {
  return { schemaVersion: 1, phase: 'editor-startup', captured: false, getHttpStatus: null, getCode: null,
    putHttpStatus: null, putCode: null, fields: Object.fromEntries(FIELDS.map(key => [key, { present: false, equal: null }])),
    editorJsonVersionPresent: false, saveStatus: 'unknown', serverSaved: null, serverVerified: null,
    initialVersionInit: null, starterVisible: false, snapshotVisible: false, pageNodes: 0, navigatorNodes: 0,
    errorClassification: 'unknown' };
}
function ownEditorRequest(url, method, appKey, body) {
  if (!/^wmcpstage-[a-f0-9]{20}$/.test(appKey)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN || parsed.pathname !== (method === 'GET' ? '/pwappy-api/read/v1/editor-json' : '/pwappy-api/rest/v1/editor-json') || parsed.hash || parsed.username || parsed.password) return false;
    if (method === 'PUT') return !parsed.search && body?.appKey === appKey && body?.version === VERSION;
    return method === 'GET' && [...parsed.searchParams.keys()].sort().join(',') === 'appKey,version'
      && parsed.searchParams.get('appKey') === appKey && parsed.searchParams.get('version') === VERSION;
  } catch { return false; }
}
function decode(value) {
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) throw Error('Invalid compressed field');
  return JSON.parse(gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: 8 * 1024 * 1024 }).toString('utf8'));
}
function responseEvidence(method, status, body, sent) {
  if (method === 'PUT') return { putHttpStatus: code(status), putCode: code(body?.code) };
  const details = body?.details;
  return { getHttpStatus: code(status), getCode: code(body?.code), editorJsonVersionPresent: typeof details?.editorJsonVersion === 'string',
    fields: Object.fromEntries(FIELDS.map(key => {
      const present = Object.prototype.hasOwnProperty.call(details || {}, key);
      let equal = null;
      if (present && sent) { try { equal = isDeepStrictEqual(decode(details[key]), decode(sent[key])); } catch {} }
      return [key, { present, equal }];
    })) };
}
function sanitizeSnapshot(value) {
  return { captured: true, saveStatus: ['saving', 'saved', 'failed'].includes(value.saveStatus) ? value.saveStatus : 'unknown',
    serverSaved: tri(value.serverSaved), serverVerified: tri(value.serverVerified), initialVersionInit: tri(value.initialVersionInit),
    starterVisible: value.starterVisible === true, snapshotVisible: value.snapshotVisible === true,
    pageNodes: count(value.pageNodes) ? value.pageNodes : 0, navigatorNodes: count(value.navigatorNodes) ? value.navigatorNodes : 0,
    errorClassification: Object.prototype.hasOwnProperty.call(ERRORS, value.error) ? ERRORS[value.error] : 'unknown' };
}
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
function validateDiagnostic(value) {
  const expected = emptyDiagnostic();
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), Object.keys(expected).sort())) return null;
  if (value.schemaVersion !== 1 || value.phase !== 'editor-startup' || !['unknown', ...Object.values(ERRORS)].includes(value.errorClassification)
    || !['unknown', 'saving', 'saved', 'failed'].includes(value.saveStatus)) return null;
  for (const key of ['captured', 'editorJsonVersionPresent', 'starterVisible', 'snapshotVisible']) if (typeof value[key] !== 'boolean') return null;
  for (const key of ['serverSaved', 'serverVerified', 'initialVersionInit']) if (value[key] !== null && typeof value[key] !== 'boolean') return null;
  for (const key of ['getHttpStatus', 'getCode', 'putHttpStatus', 'putCode']) if (value[key] !== null && code(value[key]) === null) return null;
  for (const key of ['pageNodes', 'navigatorNodes']) if (!count(value[key])) return null;
  if (!value.fields || !isDeepStrictEqual(Object.keys(value.fields).sort(), [...FIELDS].sort())) return null;
  for (const field of FIELDS) {
    const item = value.fields[field];
    if (!item || !isDeepStrictEqual(Object.keys(item).sort(), ['equal', 'present']) || typeof item.present !== 'boolean'
      || (item.equal !== null && typeof item.equal !== 'boolean')) return null;
  }
  return value;
}
module.exports = { FIELDS, ERRORS, emptyDiagnostic, ownEditorRequest, responseEvidence, sanitizeSnapshot, validateDiagnostic };

function validateCleanup(value) {
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), ['absenceVerified', 'blockedWrites', 'deleteRequested', 'outcome'])
    || !['not-needed', 'succeeded', 'failed', 'unknown'].includes(value.outcome)
    || ['deleteRequested', 'absenceVerified', 'blockedWrites'].some(key => typeof value[key] !== 'boolean')) return null;
  if (value.outcome === 'succeeded' && (!value.deleteRequested || !value.absenceVerified || value.blockedWrites)) return null;
  if (value.outcome === 'not-needed' && (value.deleteRequested || value.absenceVerified || value.blockedWrites)) return null;
  return value;
}
module.exports.validateCleanup = validateCleanup;

// Public evidence contains only fixed classifications and bounded counts. Never retain
// request URLs, bodies, headers, app keys, titles, or error text in this structure.
const REQUEST_PHASES = ['unknown', 'not-started', 'guard', 'native-preflight', 'authentication', 'create-app',
  'editor-startup', 'native-discovery', 'native-edit', 'asset-upload-read', 'save', 'fresh-context-readback',
  'readback-context', 'readback-navigation', 'readback-loading', 'readback-native-connect',
  'readback-export', 'readback-templates', 'readback-scripts', 'readback-css', 'readback-settings',
  'readback-save-status', 'readback-asset-list', 'readback-asset-bytes', 'readback-asset-count', 'readback-blocked-writes',
  'cleanup', 'cleanup-close-clients', 'cleanup-close-contexts', 'cleanup-guard', 'cleanup-delete',
  'cleanup-verify-absence', 'cleanup-assertions', 'complete'];
const BLOCK_ENUMS = {
  phase: REQUEST_PHASES,
  context: ['original', 'fresh', 'unknown'],
  method: ['POST', 'PUT', 'DELETE', 'PATCH', 'other'],
  endpoint: ['application', 'daily-report', 'editor-json', 'file-upload', 'file-download', 'admax-remaining-count', 'other'],
  reason: ['outside-origin', 'outside-rest-api', 'query-present', 'endpoint-method', 'payload-mismatch', 'parse-failed'],
};
const ENDPOINT_LABELS = new Map([
  ['application', 'application'], ['application/daily-report', 'daily-report'], ['editor-json', 'editor-json'],
  ['file-upload', 'file-upload'], ['file-download', 'file-download'], ['admax-view-status/remaining-count', 'admax-remaining-count'],
]);
const WRITE_PAIRS = new Set(['POST application', 'DELETE application', 'POST application/daily-report',
  'PUT editor-json', 'POST file-upload', 'POST file-download']);
function classifyBlockedRequest(url, method, phase, context, parseFailed = false) {
  let endpoint = 'other', reason = 'outside-origin';
  try {
    const parsed = new URL(url), prefix = '/pwappy-api/rest/v1/';
    if (parsed.origin === ORIGIN) {
      reason = 'outside-rest-api';
      if (parsed.pathname.startsWith(prefix)) {
        const name = parsed.pathname.slice(prefix.length);
        endpoint = ENDPOINT_LABELS.get(name) || 'other';
        reason = parsed.search ? 'query-present' : !WRITE_PAIRS.has(`${method} ${name}`) ? 'endpoint-method'
          : parseFailed ? 'parse-failed' : 'payload-mismatch';
      }
    }
  } catch {}
  return { phase: REQUEST_PHASES.includes(phase) ? phase : 'unknown',
    context: BLOCK_ENUMS.context.includes(context) ? context : 'unknown',
    method: BLOCK_ENUMS.method.includes(method) ? method : 'other', endpoint, reason };
}
function emptyBlockedDiagnostic() { return { schemaVersion: 1, total: 0, overflow: 0, entries: [] }; }
function recordBlockedRequest(value, entry) {
  // Input must already be classified. Fail closed rather than publish free text.
  if (!validBlockEntry({ ...entry, count: 1 })) throw Error('Invalid request classification');
  if (value.total === 1000000) throw Error('Request diagnostic count exceeded');
  value.total++;
  const existing = value.entries.find(item => Object.keys(BLOCK_ENUMS).every(key => item[key] === entry[key]));
  if (existing) existing.count++;
  else if (value.entries.length < 64) value.entries.push({ ...entry, count: 1 });
  else value.overflow++;
}
function validBlockEntry(value) {
  return value && isDeepStrictEqual(Object.keys(value).sort(), [...Object.keys(BLOCK_ENUMS), 'count'].sort())
    && count(value.count) && value.count > 0 && Object.entries(BLOCK_ENUMS).every(([key, choices]) => choices.includes(value[key]));
}
function validateBlockedDiagnostic(value) {
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), ['entries', 'overflow', 'schemaVersion', 'total'])
    || value.schemaVersion !== 1 || !count(value.total) || !count(value.overflow)
    || !Array.isArray(value.entries) || value.entries.length > 64 || !value.entries.every(validBlockEntry)) return null;
  if (value.entries.reduce((sum, entry) => sum + entry.count, value.overflow) !== value.total) return null;
  const signatures = value.entries.map(entry => JSON.stringify(Object.keys(BLOCK_ENUMS).map(key => entry[key])));
  if (new Set(signatures).size !== signatures.length || (value.overflow > 0 && value.entries.length !== 64)) return null;
  return value;
}
Object.assign(module.exports, { REQUEST_PHASES, BLOCK_ENUMS, classifyBlockedRequest, emptyBlockedDiagnostic, recordBlockedRequest, validateBlockedDiagnostic });
