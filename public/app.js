// Sovereign OS Dashboard — app.js
// Handles: auth, polling, rendering all 7 panels, dark mode, task CRUD, action routing.

const POLL_INTERVAL = 30_000;
const ORIGIN_URLS = {
  crm:      'https://crm.gemmaserenity.com',
  social:   'https://content-engine.gemmaserenity.com',
  email:    'https://mailer.gemmaserenity.com',
  revenue:  'https://mailer.gemmaserenity.com',        // placeholder — update when Stripe UI known
  calendar: 'https://calendar.google.com/calendar/r?authuser=gorokhoff.gemma@gmail.com',
  todo:     'https://next.themanifestingqueen.com',
  done:     'https://next.themanifestingqueen.com'
};

// ─── State ────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('sovdash_token') || null;
let userId = localStorage.getItem('sovdash_user') || null;
let lastData = null;
let pollTimer = null;
let pendingActionId = null;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('login-screen');
const app         = document.getElementById('app');
const usernameEl  = document.getElementById('login-username');
const passwordEl  = document.getElementById('login-password');
const loginBtn    = document.getElementById('login-btn');
const loginErr    = document.getElementById('login-error');
const userLabel   = document.getElementById('user-label');
const lastUpdEl   = document.getElementById('last-updated');
const themeBtn    = document.getElementById('theme-btn');
const logoutBtn   = document.getElementById('logout-btn');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  applyTheme(localStorage.getItem('sovdash_theme') || 'light');

  if (token) {
    const ok = await checkSession();
    if (ok) { showDashboard(); return; }
  }
  showLogin();
})();

// ─── Auth ─────────────────────────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
  loginErr.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameEl.value, password: passwordEl.value })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Login failed');

    token = data.token;
    userId = data.userId;
    localStorage.setItem('sovdash_token', token);
    localStorage.setItem('sovdash_user', userId);
    showDashboard();
  } catch (err) {
    loginErr.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

passwordEl.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  }).catch(() => {});
  token = null; userId = null;
  localStorage.removeItem('sovdash_token');
  localStorage.removeItem('sovdash_user');
  clearInterval(pollTimer);
  showLogin();
});

async function checkSession() {
  try {
    const res = await fetch('/api/auth/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.ok) { userId = data.userId; return true; }
    return false;
  } catch { return false; }
}

// ─── Theme ────────────────────────────────────────────────────────────────────
themeBtn.addEventListener('click', () => {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('sovdash_theme', next);
});

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─── Show / Hide ──────────────────────────────────────────────────────────────
function showLogin() {
  loginScreen.style.display = 'flex';
  app.classList.remove('visible');
  passwordEl.value = '';
}

function showDashboard() {
  loginScreen.style.display = 'none';
  app.classList.add('visible');
  userLabel.textContent = userId === 'gemma' ? 'Gemma' : 'Sascha';
  startPolling();
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function startPolling() {
  fetchAll();
  pollTimer = setInterval(fetchAll, POLL_INTERVAL);
}

async function fetchAll() {
  try {
    const res = await fetch('/api/dashboard', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json();
    if (!data.ok) return;
    lastData = data;
    renderAll(data);
    lastUpdEl.textContent = 'Updated ' + new Date(data.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.error('[poll]', err);
  }
}

// ─── Render All ───────────────────────────────────────────────────────────────
function renderAll(data) {
  renderCRM(data.crm);
  renderSocial(data.social);
  renderEmail(data.email);
  renderRevenue(data.revenue);
  renderCalendar(data.calendar);
  renderTasks(data.tasks);
}

// ─── CRM ──────────────────────────────────────────────────────────────────────
function renderCRM(d) {
  const el = document.getElementById('panel-crm');
  if (d?.error) { el.querySelector('.panel-content').innerHTML = `<div class="panel-error">${d.error}</div>`; return; }

  const recent = (d?.recent || []).map(c => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '(no name)';
    const sub  = c.company || c.email || '';
    const date = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `
      <div class="crm-contact-row">
        <div class="crm-contact-name">${esc(name)}</div>
        <div class="crm-contact-meta">${esc(sub)}</div>
        <div class="crm-contact-date">${date}</div>
      </div>`;
  }).join('');

  el.querySelector('.panel-content').innerHTML = `
    <div class="crm-stats">
      <div class="stat-block">
        <div class="stat-number" style="color:var(--a-crm)">${d?.new_14d ?? '—'}</div>
        <div class="stat-label">New (14 days)</div>
      </div>
      <div class="stat-block">
        <div class="stat-number">${d?.total ?? '—'}</div>
        <div class="stat-label">Total contacts</div>
      </div>
    </div>
    ${recent ? `<div class="crm-recent">${recent}</div>` : ''}`;
}

// ─── Social Forge ─────────────────────────────────────────────────────────────
function renderSocial(d) {
  const el = document.getElementById('panel-social');
  if (d?.error) { el.querySelector('.panel-content').innerHTML = `<div class="panel-error">${d.error}</div>`; return; }

  const t = d?.totals || {};
  const brands = d?.byBrand || {};

  const brandRows = Object.entries(brands).map(([name, c]) => `
    <tr>
      <td>${name}</td>
      <td>${c.draft || 0}</td>
      <td>${c.approved || 0}</td>
      <td>${c.published || 0}</td>
    </tr>`).join('');

  el.querySelector('.panel-content').innerHTML = `
    <table class="status-table">
      <thead>
        <tr>
          <th>Brand</th>
          <th>Draft</th>
          <th>Approved</th>
          <th>Published</th>
        </tr>
      </thead>
      <tbody>
        ${brandRows}
        <tr class="total-row">
          <td>Total</td>
          <td>${t.draft || 0}</td>
          <td>${t.approved || 0}</td>
          <td>${t.published || 0}</td>
        </tr>
      </tbody>
    </table>`;
}

// ─── Email Sequences ──────────────────────────────────────────────────────────
function renderEmail(d) {
  const el = document.getElementById('panel-email');
  if (d?.error) { el.querySelector('.panel-content').innerHTML = `<div class="panel-error">${d.error}</div>`; return; }

  const seqs = d?.sequences || [];
  if (seqs.length === 0) {
    el.querySelector('.panel-content').innerHTML = '<div class="panel-error" style="color:var(--text-muted)">No sequences yet</div>';
    return;
  }

  el.querySelector('.panel-content').innerHTML = `<div class="seq-list">${seqs.map(s => {
    const total = s.total || 1;
    const pct = v => Math.max(0, Math.round((v / total) * 100));
    return `
      <div class="seq-item">
        <div class="seq-name">${esc(s.name)}</div>
        <div class="seq-bars">
          ${s.active      ? `<div class="seq-bar-segment bar-active"      style="flex:${pct(s.active)}"      title="Active: ${s.active}"></div>`      : ''}
          ${s.completed   ? `<div class="seq-bar-segment bar-completed"   style="flex:${pct(s.completed)}"   title="Completed: ${s.completed}"></div>` : ''}
          ${s.exited      ? `<div class="seq-bar-segment bar-exited"      style="flex:${pct(s.exited)}"      title="Exited: ${s.exited}"></div>`       : ''}
          ${s.bounced     ? `<div class="seq-bar-segment bar-bounced"     style="flex:${pct(s.bounced)}"     title="Bounced: ${s.bounced}"></div>`     : ''}
          ${s.unsubscribed? `<div class="seq-bar-segment bar-unsubscribed"style="flex:${pct(s.unsubscribed)}"title="Unsub: ${s.unsubscribed}"></div>`  : ''}
        </div>
        <div class="seq-meta">
          <span>📥 ${s.total} enrolled</span>
          <span>✉️ ${s.sent} sent</span>
          <span>👁️ ${s.opened} opened</span>
          <span>🔗 ${s.clicked} clicked</span>
        </div>
      </div>`;
  }).join('')}</div>`;
}

// ─── Revenue ──────────────────────────────────────────────────────────────────
function renderRevenue(d) {
  const el = document.getElementById('panel-revenue');
  if (d?.error) { el.querySelector('.panel-content').innerHTML = `<div class="panel-error">${d.error}</div>`; return; }

  const fmt = n => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const forecast = d?.forecast || [];

  const forecastRows = forecast.map(f => `
    <div class="forecast-row">
      <span class="forecast-month">${new Date(f.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
      <span class="forecast-amount">${fmt(f.projected_amount)}</span>
    </div>`).join('');

  el.querySelector('.panel-content').innerHTML = `
    <div class="revenue-grid">
      <div class="rev-tile">
        <div class="rev-amount" style="color:var(--a-revenue)">${fmt(d?.pending)}</div>
        <div class="rev-label">Pending</div>
      </div>
      <div class="rev-tile">
        <div class="rev-amount" style="color:var(--a-done)">${fmt(d?.realized)}</div>
        <div class="rev-label">Realized (this month)</div>
      </div>
    </div>
    <div class="forecast-list">${forecastRows || '<div style="font-size:13px;color:var(--text-muted)">No forecast entries</div>'}</div>
    <button class="add-forecast-btn" onclick="openForecastModal()">+ Add / edit forecast</button>`;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function renderCalendar(d) {
  const el = document.getElementById('panel-calendar');
  if (d?.error) { el.querySelector('.panel-content').innerHTML = `<div class="panel-error">${d.error}</div>`; return; }
  if (d?.note)  { el.querySelector('.panel-content').innerHTML = `<div class="panel-error" style="color:var(--text-muted)">${d.note}</div>`; return; }

  const events = d?.events || [];
  if (events.length === 0) {
    el.querySelector('.panel-content').innerHTML = '<div class="cal-empty">No upcoming events in next 48h</div>';
    return;
  }

  const now = new Date();
  el.querySelector('.panel-content').innerHTML = `<div class="cal-events">${events.map(e => {
    const start = new Date(e.start);
    const isPast = start < now;
    const timeStr = e.allDay ? 'All day' : start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="cal-event" style="${isPast ? 'opacity:0.5' : ''}">
        <div class="cal-time">${timeStr}</div>
        <div class="cal-details">
          <div class="cal-title">${esc(e.title)}</div>
          ${e.location ? `<div class="cal-location">📍 ${esc(e.location)}</div>` : ''}
        </div>
      </div>`;
  }).join('')}</div>`;
}

// ─── Tasks (To-Do / Done) ─────────────────────────────────────────────────────
function renderTasks(d) {
  if (d?.error) {
    document.getElementById('todo-list').innerHTML = `<div class="panel-error">${d.error}</div>`;
    document.getElementById('done-list').innerHTML = '';
    return;
  }

  const todo = d?.todo || [];
  const done = d?.done || [];

  document.getElementById('todo-list').innerHTML = todo.length
    ? todo.map(t => taskItem(t, false)).join('')
    : '<div class="cal-empty">All clear!</div>';

  document.getElementById('done-list').innerHTML = done.length
    ? done.map(t => taskItem(t, true)).join('')
    : '<div class="cal-empty">Nothing done yet</div>';
}

function taskItem(t, isDone) {
  return `
    <div class="task-item">
      <div class="task-check ${isDone ? 'checked' : ''}" onclick="toggleTask('${t.id}', ${isDone})">
        ${isDone ? '✓' : ''}
      </div>
      <div class="task-text">
        <div>${esc(t.title)}</div>
        ${t.owner === 'sascha' ? `<div class="task-owner">Sascha</div>` : ''}
      </div>
    </div>`;
}

window.toggleTask = async function(id, isDone) {
  await apiFetch('/api/tasks', 'PATCH', { id, status: isDone ? 'todo' : 'done' });
  fetchAll();
};

document.getElementById('add-task-btn').addEventListener('click', addTask);
document.getElementById('add-task-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

async function addTask() {
  const input = document.getElementById('add-task-input');
  const title = input.value.trim();
  if (!title) return;
  input.value = '';
  await apiFetch('/api/tasks', 'POST', { title, owner: userId });
  fetchAll();
}

// ─── Action Input ─────────────────────────────────────────────────────────────
const actionTextarea  = document.getElementById('action-textarea');
const actionSendBtn   = document.getElementById('action-send-btn');
const actionStatus    = document.getElementById('action-status');
const actionHistory   = document.getElementById('action-history');
const confirmBar      = document.getElementById('action-confirm-bar');
const confirmText     = document.getElementById('action-confirm-text');

actionSendBtn.addEventListener('click', submitAction);
actionTextarea.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAction();
});

async function submitAction() {
  const raw = actionTextarea.value.trim();
  if (!raw) return;

  actionSendBtn.disabled = true;
  actionStatus.textContent = 'Routing…';
  actionTextarea.value = '';

  try {
    const data = await apiFetch('/api/actions', 'POST', { input_type: 'text', raw_input: raw });
    if (!data.ok) throw new Error(data.error);

    if (data.action.status === 'pending_confirmation') {
      pendingActionId = data.action.id;
      confirmText.textContent = data.action.proposed_action?.proposed_description || 'Confirm this action?';
      confirmBar.style.display = 'block';
      actionStatus.textContent = 'Waiting for your confirmation…';
    } else {
      actionStatus.textContent = data.action.status === 'completed' ? 'Done!' : 'Logged';
      pendingActionId = null;
    }

    prependActionLog(raw, data.action);
    if (data.action.status === 'completed') fetchAll();
  } catch (err) {
    actionStatus.textContent = 'Error: ' + err.message;
  } finally {
    actionSendBtn.disabled = false;
  }
}

document.getElementById('action-yes-btn').addEventListener('click', () => confirmAction(true));
document.getElementById('action-no-btn').addEventListener('click',  () => confirmAction(false));

async function confirmAction(confirmed) {
  if (!pendingActionId) return;
  confirmBar.style.display = 'none';
  actionStatus.textContent = confirmed ? 'Executing…' : 'Dismissed';

  try {
    const data = await apiFetch('/api/actions', 'PATCH', { id: pendingActionId, confirm: confirmed });
    actionStatus.textContent = confirmed
      ? (data.status === 'completed' ? 'Done!' : 'Failed: ' + (data.result?.error || ''))
      : 'Dismissed';
    if (confirmed && data.status === 'completed') fetchAll();
  } catch (err) {
    actionStatus.textContent = 'Error: ' + err.message;
  } finally {
    pendingActionId = null;
  }
}

function prependActionLog(input, action) {
  const item = document.createElement('div');
  item.className = 'action-log-item';
  const status = action.status === 'completed' ? '✅' : action.status === 'pending_confirmation' ? '⏳' : '📝';
  item.innerHTML = `
    <div class="action-log-input">${status} ${esc(input.slice(0, 80))}${input.length > 80 ? '…' : ''}</div>
    <div class="action-log-result">${esc(action.interpretation || '')}</div>`;
  actionHistory.prepend(item);
}

// ─── Forecast Modal ───────────────────────────────────────────────────────────
window.openForecastModal = function() {
  document.getElementById('forecast-modal').style.display = 'flex';
  const today = new Date();
  document.getElementById('fm-month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
};

document.getElementById('fm-cancel').addEventListener('click', () => {
  document.getElementById('forecast-modal').style.display = 'none';
});

document.getElementById('fm-save').addEventListener('click', async () => {
  const month  = document.getElementById('fm-month').value;
  const amount = parseFloat(document.getElementById('fm-amount').value) || 0;
  const notes  = document.getElementById('fm-notes').value.trim() || null;

  await apiFetch('/api/forecast', 'POST', { month, projected_amount: amount, notes });
  document.getElementById('forecast-modal').style.display = 'none';
  fetchAll();
});

// ─── Panel click → deep-link ──────────────────────────────────────────────────
document.querySelectorAll('.panel[data-url]').forEach(panel => {
  panel.addEventListener('click', e => {
    if (e.target.closest('button, input, textarea, a, .task-check')) return;
    window.open(panel.dataset.url, '_blank', 'noopener');
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function apiFetch(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
