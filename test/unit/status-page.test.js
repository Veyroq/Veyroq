import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { resolveApiBase, summarizeOverallStatus } from '../../status-page/app.js';

test('Unit: status-page resolves API overrides and aggregates surface health states cleanly', () => {
  assert.equal(resolveApiBase('', 'localhost', 'https://api.veyroq.xyz'), 'http://localhost:3000');
  assert.equal(resolveApiBase('?api=https://api-staging.veyroq.xyz/', 'status.veyroq.xyz'), 'https://api-staging.veyroq.xyz');
  assert.equal(resolveApiBase('?api=javascript:alert(1)', 'status.veyroq.xyz', 'https://api.veyroq.xyz'), 'https://api.veyroq.xyz');

  assert.equal(summarizeOverallStatus([{ state: 'ok' }, { state: 'ok' }]).level, 'ok');
  assert.equal(summarizeOverallStatus([{ state: 'ok' }, { state: 'degraded' }]).level, 'degraded');
  assert.equal(summarizeOverallStatus([{ state: 'ok' }, { state: 'down' }]).level, 'outage');
  assert.equal(summarizeOverallStatus([{ state: 'ok' }], [], [{ status: 'in_progress' }]).label, 'MAINTENANCE');

  const cfg = JSON.parse(fs.readFileSync(new URL('../../status-page/status.json', import.meta.url), 'utf8'));
  assert.ok(cfg.errorBudgets.length >= 3);
  assert.ok(cfg.communicationTemplates.length >= 4);
});
