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
