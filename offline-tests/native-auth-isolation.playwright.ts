// Browserless integration fixture: use the production cache path, never log in.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getStorageStatePath, generateIdentKey } from '../tests/constants';

test('synthetic native state stays in the wrapper-owned directory', () => {
  const root = dirname(process.env.PWAPPY_STAGING_NATIVE_PHASE_PATH!);
  expect(process.cwd()).toBe(root);
  expect(generateIdentKey('0', 'c')).toBe('pwuc000');
  const path = getStorageStatePath('0', 'c');
  expect(path).toBe(join(root, '.auth/user-u-c-0.json'));
  expect(readFileSync(path, 'utf8')).toBe('{}');
  writeFileSync(path, JSON.stringify({ cookies: [], origins: [], synthetic: true }));
  writeFileSync(process.env.PWAPPY_STAGING_NATIVE_PHASE_PATH!, JSON.stringify('complete'));
});
