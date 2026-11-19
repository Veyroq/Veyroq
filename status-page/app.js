export function resolveApiBase(search = '', hostname = '', defaultBase = 'https://api.veyroq.xyz') {
  const params = new URLSearchParams(search);
  const override = (params.get('api') || '').trim();
  if (override && /^https?:\/\//i.test(override)) {
    return override.replace(/\/+$/, '');
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  return String(defaultBase || 'https://api.veyroq.xyz').replace(/\/+$/, '');
}

export function summarizeOverallStatus(results, incidents = [], maintenance = []) {
  const activeIncidents = incidents.filter(i => i && i.status !== 'resolved');
  const activeMaint = maintenance.filter(m => m && m.status === 'in_progress');

  if (results.some(r => r.state === 'down') || activeIncidents.some(i => i.severity === 'outage')) {
    return { level: 'outage', label: 'OUTAGE', title: 'Service Disruption Detected' };
  }
  if (results.some(r => r.state === 'degraded') || activeIncidents.length > 0) {
    return { level: 'degraded', label: 'DEGRADED', title: 'Partial Service Degradation' };
  }
  if (activeMaint.length > 0) {
    return { level: 'degraded', label: 'MAINTENANCE', title: 'Scheduled Maintenance in Progress' };
  }
  if (results.length === 0 || results.every(r => r.state === 'pending')) {
    return { level: 'degraded', label: 'UNVERIFIED', title: 'Health Probes Pending or Unreachable' };
  }
  return { level: 'ok', label: 'OPERATIONAL', title: 'All Systems Operational' };
}

async function timedFetch(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    return { res, latencyMs: Math.round(performance.now() - started), error: null };
  } catch (err) {
    return { res: null, latencyMs: Math.round(performance.now() - started), error: err };
  } finally {
    clearTimeout(timer);
  }
}

async function probeSurface(surface, apiBase) {
  if (surface.kind === 'web' && surface.probeUrl) {
    const { error, latencyMs } = await timedFetch(surface.probeUrl, { mode: 'no-cors' });
    if (error) return { ...surface, state: 'down', badge: `UNREACHABLE (${latencyMs}ms)` };
    return { ...surface, state: 'ok', badge: `OPERATIONAL (${latencyMs}ms)` };
  }

  const target = `${apiBase}${surface.probePath || '/health'}`;
  const { res, latencyMs, error } = await timedFetch(target, { mode: 'cors' });
  if (error || !res) {
    return { ...surface, state: 'down', badge: 'UNREACHABLE' };
  }

  try {
    const body = await res.json();
    if (res.status === 200 && body.status === 'ok') {
      const extra = body.checks?.arcRpc?.blockNumber ? ` · Block #${body.checks.arcRpc.blockNumber}` : '';
      return { ...surface, state: 'ok', badge: `OPERATIONAL (${latencyMs}ms${extra})` };
    }
    return { ...surface, state: 'degraded', badge: `DEGRADED HTTP ${res.status}` };
  } catch {
    return { ...surface, state: res.ok ? 'ok' : 'down', badge: `HTTP ${res.status} (${latencyMs}ms)` };
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function renderServices(results) {
  const root = document.getElementById('services-list');
  root.replaceChildren();
  for (const r of results) {
    const row = el('div', 'service-row');
    const left = el('div');
    left.append(el('div', 'service-name', r.name), el('div', 'service-host', r.host));
    const pillClass = r.state === 'ok' ? 'ok' : (r.state === 'degraded' ? 'degraded' : 'down');
    row.append(left, el('span', `pill ${pillClass}`, r.badge));
    root.append(row);
  }
}

function renderMaintenance(items) {
  const root = document.getElementById('maintenance-list');
  root.replaceChildren();
  if (!items.length) {
    root.append(el('p', 'empty-note', 'No scheduled maintenance windows.'));
    return;
  }
  for (const m of items) {
    const item = el('div', 'template-item');
    item.append(
      el('div', 'template-stage', `${m.title || 'Maintenance'} — ${m.window || ''}`),
      el('div', 'empty-note', m.impact || '')
    );
    root.append(item);
  }
}

function renderBudgets(budgets) {
  const body = document.getElementById('budgets-body');
  body.replaceChildren();
  for (const b of budgets) {
    const tr = el('tr');
    tr.append(
      el('td', 'service-name', b.service),
      el('td', '', b.criticality),
      el('td', '', `${b.sloTarget} (${b.rollingWindow})`),
      el('td', '', b.monthlyBudget)
    );
    body.append(tr);
  }
}

function renderIncidents(incidents) {
  const root = document.getElementById('incidents-list');
  root.replaceChildren();
  if (!incidents.length) {
    root.append(el('p', 'empty-note', 'No active incidents reported.'));
    return;
  }
  for (const inc of incidents) {
    const item = el('div', 'template-item');
    item.append(
      el('div', 'template-stage', `[${(inc.status || 'active').toUpperCase()}] ${inc.title || 'Incident'}`),
      el('div', 'empty-note', `${inc.startedAt || ''} — ${inc.summary || ''}`)
    );
    root.append(item);
  }
}

async function runDashboard() {
  const res = await fetch('./status.json', { cache: 'no-store' });
  const cfg = await res.json();
  const apiBase = resolveApiBase(window.location.search, window.location.hostname, cfg.defaultApiBase);

  renderMaintenance(cfg.maintenance || []);
  renderBudgets(cfg.errorBudgets || []);
  renderIncidents(cfg.incidents || []);

  const results = await Promise.all((cfg.surfaces || []).map(s => probeSurface(s, apiBase)));
  renderServices(results);

  const summary = summarizeOverallStatus(results, cfg.incidents, cfg.maintenance);
  const banner = document.getElementById('overall-banner');
  banner.className = `banner ${summary.level}`;
  document.getElementById('overall-title').textContent = summary.title;
  document.getElementById('overall-meta').textContent = `Last checked: ${new Date().toUTCString()}`;
  const pill = document.getElementById('overall-pill');
  pill.className = `pill ${summary.level === 'outage' ? 'down' : summary.level}`;
  pill.textContent = summary.label;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    runDashboard().catch(() => {
      document.getElementById('overall-title').textContent = 'Unable to load status feed';
    });
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      runDashboard().catch(() => {});
    });
  });
}
