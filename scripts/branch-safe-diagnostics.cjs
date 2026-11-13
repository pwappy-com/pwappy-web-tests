'use strict';
// Only literal enum values and booleans cross the child/parent boundary.
const { readFileSync, statSync } = require('node:fs');
const { sourceLocations, statuses } = require('./branch-safe-locations.cjs');
const LIMIT = 256;
const classes = ['assertion', 'timeout', 'navigation-offline', 'navigation-reset', 'navigation-dns',
  'navigation-http', 'navigation-connection', 'page-closed', 'page-crashed', 'unknown'];
const operations = ['page.goto', 'page.reload', 'page.waitForURL', 'page.waitForLoadState', 'page.waitForEvent',
  'page.evaluate', 'page.waitForFunction', 'locator.click', 'locator.dblclick', 'locator.fill', 'locator.press',
  'locator.hover', 'locator.waitFor', 'locator.dragTo', 'locator.selectOption', 'locator.check', 'locator.uncheck',
  'locator.evaluate', 'browserContext.waitForEvent', 'expect', 'unknown'];
const matchers = ['toBe', 'toEqual', 'toStrictEqual', 'toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeNull',
  'toContain', 'toMatch', 'toHaveLength', 'toBeGreaterThan', 'toBeLessThan', 'toBeVisible', 'toBeHidden',
  'toBeAttached', 'toBeEnabled', 'toBeDisabled', 'toBeChecked', 'toBeEditable', 'toBeEmpty', 'toBeFocused',
  'toHaveText', 'toContainText', 'toHaveValue', 'toHaveValues', 'toHaveAttribute', 'toHaveClass', 'toHaveCSS',
  'toHaveCount', 'toHaveURL', 'toHaveTitle', 'toPass', 'unknown'];
const keys = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === names.split(',').sort().join(',');
const member = (value, values) => values.includes(value);
function classify(error, status) {
  const message = typeof error?.message === 'string' ? error.message.slice(0, 8192).replace(/\x1b\[[0-9;]*m/g, '') : '';
  const first = message.split('\n', 1)[0].replace(/^(?:Error|TimeoutError): /, '');
  const operation = operations.find(value => value !== 'unknown' && value !== 'expect' && first.startsWith(value + ':'))
    || (/^expect\(/.test(first) ? 'expect' : 'unknown');
  const matched = /^expect\(.*\)(?:\.not)?\.([A-Za-z]+)\(/.exec(first)?.[1];
  const matcher = matchers.find(value => value === matched) || 'unknown';
  // Match only primary error text, never selectors, call logs or expected/actual values.
  const detail = operation !== 'unknown' && operation !== 'expect' ? first.slice(operation.length + 1).trim() : first;
  let errorClass = 'unknown';
  if (/^(?:Target page, context or browser has been closed|Page closed|Browser has been closed)/.test(detail)) errorClass = 'page-closed';
  else if (/^(?:Page crashed|Target crashed)/.test(detail)) errorClass = 'page-crashed';
  else if (/^(?:net::ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE)\b/.test(detail)
      || /^The Internet connection appears to be offline\.(?:$| while navigating to )/.test(detail)) errorClass = 'navigation-offline';
  else if (/^(?:net::ERR_CONNECTION_RESET|NS_ERROR_NET_RESET)\b/.test(detail)) errorClass = 'navigation-reset';
  else if (/^(?:net::ERR_NAME_NOT_RESOLVED|NS_ERROR_UNKNOWN_HOST)\b/.test(detail)) errorClass = 'navigation-dns';
  else if (/^net::ERR_HTTP_RESPONSE_CODE_FAILURE\b/.test(detail)) errorClass = 'navigation-http';
  else if (/^(?:net::ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_CLOSED|net::ERR_CONNECTION_TIMED_OUT|NS_ERROR_CONNECTION_REFUSED)\b/.test(detail)) errorClass = 'navigation-connection';
  else if (status === 'timedOut' || /^(?:Test timeout of \d+ms exceeded|Timeout \d+ms exceeded|Timed out \d+ms waiting for)/.test(detail)) errorClass = 'timeout';
  else if (operation === 'expect') errorClass = 'assertion';
  return { errorClass, operation, matcher };
}
const navBools = ['failedDocument', 'responseSeen', 'committed', 'nonGetSeen', 'crashed', 'closed', 'disconnected'];
const startupBools = ['captured', 'containerPresent', 'storePresent', 'starterVisible', 'messageVisible', 'initialSaveError', 'pageNodesPresent', 'navigatorNodesPresent'];
const startupNullable = ['loading', 'empty', 'initialVersionInit', 'serverSaved', 'serverVerified'];
const startupKeys = [...startupBools, ...startupNullable, 'saveStatus', 'errorClassification'].join(',');
const dragBools = ['captured', 'targetExists', 'targetInScrollport', 'pointerInScrollport', 'dragImageActive', 'dragActive', 'sourceMatched', 'siblingMarkerSelected', 'scrollAtBottom', 'scrollAtTop', 'canScroll', 'targetBelow', 'pointerInViewport', 'popupOpen', 'pointerAtScrollEdge', 'hitWithinTree'];
const dragKeys = ['phase', ...dragBools, 'hit'].join(',');
function validHelper(value) {
  if (value?.kind === 'editor-attribute') return keys(value, 'kind,state')
    && member(value.state, ['unobserved', 'application-rejected', 'dialog-open', 'added', 'input-not-visible']);
  if (value?.kind === 'editor-drag') return keys(value, 'kind,' + dragKeys)
    && dragBools.every(key => typeof value[key] === 'boolean')
    && member(value.phase, ['before-assert', 'assertion-failed'])
    && member(value.hit, ['target-gap', 'target-node', 'dragged-node', 'toolbar', 'outside', 'other']);
  if (value?.kind === 'editor-startup') return keys(value, 'kind,' + startupKeys)
    && startupBools.every(key => typeof value[key] === 'boolean')
    && startupNullable.every(key => value[key] === null || typeof value[key] === 'boolean')
    && member(value.saveStatus, ['unknown', 'saving', 'saved', 'failed'])
    && member(value.errorClassification, ['unknown', 'readback-mismatch', 'readback-invalid', 'readback-failed']);
  if (value?.kind === 'navigation') return keys(value, 'kind,event,reason,attempt,' + navBools.join(','))
    && member(value.event, ['blocked', 'eligible', 'recovered', 'failed'])
    && member(value.reason, ['offline_precommit', 'unverified_document', 'navigation_progressed', 'target_unhealthy', 'budget_exhausted'])
    && member(value.attempt, [1, 2]) && navBools.every(key => typeof value[key] === 'boolean');
  if (value?.kind === 'http') return keys(value, 'kind,status,method,resource,pathKind,serverFamily,retryAfter,contentType')
    && member(value.status, ['500', '503', '507', 'other-5xx'])
    && member(value.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'other'])
    && member(value.resource, ['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'websocket', 'eventsource', 'other'])
    && member(value.pathKind, ['editor-json', 'publish-list', 'pwappy-api', 'wordpress-api', 'document', 'other'])
    && member(value.serverFamily, ['nginx', 'apache', 'cloudflare', 'iis', 'litespeed', 'unknown'])
    && member(value.retryAfter, ['absent', 'seconds', 'date', 'invalid'])
    && member(value.contentType, ['json', 'html', 'text', 'absent', 'other']);
  return false;
}
function parseHelper(chunk) {
  if (!(typeof chunk === 'string' || Buffer.isBuffer(chunk)) || chunk.length > 4096) return null;
  const match = /^\[(dashboard-navigation-recovery|HttpFailure|EditorStartupFailure|EditorDragState|EditorAttributeState)\] (\{[^\r\n]*\})\r?\n?$/.exec(chunk.toString());
  if (!match) return null;
  try {
    const raw = JSON.parse(match[2]);
    if (match[1] === 'EditorAttributeState') {
      if (!keys(raw, 'state')) return null;
      const value = { kind: 'editor-attribute', ...raw };
      return validHelper(value) ? value : null;
    }
    if (match[1] === 'EditorDragState') {
      if (!keys(raw, dragKeys)) return null;
      const value = { kind: 'editor-drag', ...raw };
      return validHelper(value) ? value : null;
    }
    if (match[1] === 'EditorStartupFailure') {
      if (!keys(raw, startupKeys)) return null;
      const value = { kind: 'editor-startup', ...raw };
      return validHelper(value) ? value : null;
    }
    if (match[1] === 'dashboard-navigation-recovery') {
      if (!keys(raw, 'event,reason,attempt,' + navBools.join(','))) return null;
      const value = { kind: 'navigation', ...raw };
      return validHelper(value) ? value : null;
    }
    if (!keys(raw, 'status,method,resource,pathKind,serverFamily,retryAfter,contentType')
        || !Number.isInteger(raw.status) || raw.status < 500 || raw.status > 599) return null;
    const retry = raw.retryAfter;
    if (!(keys(retry, 'kind') && member(retry.kind, ['absent', 'date', 'invalid']))
        && !(keys(retry, 'kind,seconds,capped') && retry.kind === 'seconds'
          && Number.isInteger(retry.seconds) && retry.seconds >= 0 && retry.seconds <= 86400
          && typeof retry.capped === 'boolean' && (!retry.capped || retry.seconds === 86400))) return null;
    const value = { kind: 'http', ...raw, status: [500, 503, 507].includes(raw.status) ? String(raw.status) : 'other-5xx', retryAfter: retry.kind };
    return validHelper(value) ? value : null;
  } catch { return null; }
}
function validate(entries, sources = sourceLocations()) {
  if (!Array.isArray(entries) || entries.length > LIMIT) throw new Error('Invalid branch diagnostics');
  for (const entry of entries) {
    const location = sources.location(entry?.file, entry?.line);
    if (!location || location.file !== entry.file) throw new Error('Invalid branch diagnostics');
    if (entry.kind === 'error') {
      if (!keys(entry, 'kind,file,line,status,errorClass,operation,matcher') || !member(entry.status, statuses)
          || !member(entry.errorClass, classes) || !member(entry.operation, operations) || !member(entry.matcher, matchers)) throw new Error('Invalid branch diagnostics');
    } else {
      const { file, line, ...helper } = entry;
      if (!validHelper(helper)) throw new Error('Invalid branch diagnostics');
    }
  }
  return entries;
}
function readDiagnostics(file) {
  if (statSync(file).size > 262144) throw new Error('Invalid branch diagnostics');
  try { return validate(JSON.parse(readFileSync(file, 'utf8'))); }
  catch { throw new Error('Invalid branch diagnostics'); }
}
module.exports = { classify, parseHelper, validate, readDiagnostics, LIMIT };
