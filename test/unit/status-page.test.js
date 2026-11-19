import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { resolveApiBase, summarizeOverallStatus } from '../../status-page/app.js';

test('Unit: status-page resolves API overrides, hides internal infra labels, and aggregates health states cleanly', () => {
  assert.equal(resolveApiBase('', 'localhost', 'https://api.veyroq.xyz'), 'http://localhost:3000');
  assert.equal(resolveApiBase('?api=https://api-staging.veyroq.xyz/', 'status.veyroq.xyz'), 'https://api-staging.veyroq.xyz');
  assert.equal(resolveApiBase('?api=javascript:alert(1)', 'status.veyroq.xyz', 'https://api.veyroq.xyz'), 'https://api.veyroq.xyz');

  assert.equal(summarizeOverallStatus([{ state: 'ok' }, { state: 'ok' }]).level, 'ok');
  assert.equal(summarizeOverallStatus([{ state: 'ok' }, { state: 'degraded' }]).level, 'degraded');
  assert.equal(summarizeOverallStatus([{ state: 'ok' }, { state: 'down' }]).level, 'outage');
  assert.equal(summarizeOverallStatus([{ state: 'ok' }], [], [{ status: 'in_progress' }]).label, 'MAINTENANCE');

  const raw = fs.readFileSync(new URL('../../status-page/status.json', import.meta.url), 'utf8');
  const cfg = JSON.parse(raw);
  assert.ok(cfg.errorBudgets.length >= 3);
  assert.equal(/railway|render|vercel|runbook|ARC_RPC_URL/i.test(raw), false);
});
