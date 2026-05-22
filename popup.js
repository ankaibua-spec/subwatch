const STORAGE_KEY = 'subwatch_subscriptions';

let subscriptions = [];
let sortAsc = true;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSubscriptions();
  render();
  bindEvents();
});

const hasChrome = typeof chrome !== 'undefined' && chrome.storage;

async function loadSubscriptions() {
  if (hasChrome) {
    const data = await chrome.storage.sync.get(STORAGE_KEY);
    subscriptions = data[STORAGE_KEY] || [];
  } else {
    subscriptions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }
}

async function saveSubscriptions() {
  if (hasChrome) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: subscriptions });
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
  }
}

if (hasChrome && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) {
      subscriptions = changes[STORAGE_KEY].newValue || [];
      render();
    }
  });
}

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', showAddForm);
  document.getElementById('btn-cancel').addEventListener('click', hideForm);
  document.getElementById('sub-form').addEventListener('submit', handleSubmit);
  document.getElementById('btn-export').addEventListener('click', exportCSV);
  document.getElementById('btn-sort').addEventListener('click', toggleSort);

  document.getElementById('sub-list').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) { e.stopPropagation(); showEditForm(editBtn.dataset.id); return; }
    const delBtn = e.target.closest('.btn-delete');
    if (delBtn) { e.stopPropagation(); deleteSub(delBtn.dataset.id); return; }
  });
}

function render() {
  renderList();
  renderSummary();
  renderRenewalAlert();
}

function renderSummary() {
  let monthlyTotal = 0;
  for (const sub of subscriptions) {
    monthlyTotal += toMonthly(sub.cost, sub.cycle);
  }
  document.getElementById('monthly-total').textContent = formatCurrency(monthlyTotal);
  document.getElementById('yearly-total').textContent = formatCurrency(monthlyTotal * 12);
  document.getElementById('sub-count').textContent = subscriptions.length;
}

function renderRenewalAlert() {
  const now = new Date();
  const soon = subscriptions.filter(s => {
    const days = daysUntil(s.nextDate);
    return days >= 0 && days <= 7;
  });

  const alertEl = document.getElementById('renewal-alert');
  const alertText = document.getElementById('renewal-alert-text');

  if (soon.length > 0) {
    const names = soon.map(s => s.name).join(', ');
    alertText.textContent = `${soon.length} renewal${soon.length > 1 ? 's' : ''} this week: ${names}`;
    alertEl.classList.remove('hidden');
  } else {
    alertEl.classList.add('hidden');
  }
}

function renderList() {
  const listEl = document.getElementById('sub-list');

  if (subscriptions.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>No subscriptions tracked yet.</p>
        <p class="hint">Click <strong>+</strong> to add your first subscription.</p>
      </div>`;
    return;
  }

  const withDays = subscriptions.map(s => ({ sub: s, days: daysUntil(s.nextDate) }));
  withDays.sort((a, b) => sortAsc ? a.days - b.days : b.days - a.days);

  const fragment = document.createDocumentFragment();
  for (const { sub, days } of withDays) {
    let statusClass = 'status-ok';
    if (sub.isTrial) statusClass = 'status-trial';
    else if (days <= 3) statusClass = 'status-urgent';
    else if (days <= 7) statusClass = 'status-soon';

    const daysText = days < 0 ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`;
    const costText = sub.cost === 0 ? 'Free' : formatCurrency(sub.cost);
    const eName = escapeHtml(sub.name);
    const eId = escapeHtml(sub.id);
    const eCycle = escapeHtml(sub.cycle);
    const eCat = escapeHtml(sub.category);

    const div = document.createElement('div');
    div.className = 'sub-item';
    div.setAttribute('role', 'listitem');
    div.dataset.id = sub.id;
    div.dataset.subscription = sub.name;
    div.dataset.billingCycle = sub.cycle;
    div.dataset.renewalStatus = statusClass;
    div.innerHTML = `
      <div class="sub-status ${statusClass}" title="Renewal status: ${days <= 3 ? 'urgent' : days <= 7 ? 'upcoming' : 'safe'}"></div>
      <div class="sub-info">
        <div class="sub-name" title="Subscription: ${eName} — ${capitalize(eCycle)} recurring payment">${eName}${sub.isTrial ? '<span class="trial-badge">TRIAL</span>' : ''}</div>
        <div class="sub-meta">${capitalize(eCycle)} · Renews ${daysText} · ${capitalize(eCat)}</div>
      </div>
      <div class="sub-cost" title="${costText} per ${eCycle} — recurring charge">${costText}</div>
      <div class="sub-actions">
        <button class="btn-edit" data-id="${eId}" title="Edit">✏️</button>
        <button class="btn-delete" data-id="${eId}" title="Delete">🗑️</button>
      </div>
    `;
    fragment.appendChild(div);
  }
  listEl.replaceChildren(fragment);
}

function showAddForm() {
  document.getElementById('form-title').textContent = 'Add Subscription';
  document.getElementById('sub-form').reset();
  document.getElementById('edit-id').value = '';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('sub-date').value = formatDate(tomorrow);

  document.getElementById('form-overlay').classList.remove('hidden');
}

function showEditForm(id) {
  const sub = subscriptions.find(s => s.id === id);
  if (!sub) return;

  document.getElementById('form-title').textContent = 'Edit Subscription';
  document.getElementById('edit-id').value = sub.id;
  document.getElementById('sub-name').value = sub.name;
  document.getElementById('sub-cost').value = sub.cost;
  document.getElementById('sub-cycle').value = sub.cycle;
  document.getElementById('sub-date').value = sub.nextDate;
  document.getElementById('sub-category').value = sub.category;
  document.getElementById('sub-remind').value = sub.remindDays;
  document.getElementById('sub-trial').checked = sub.isTrial;

  document.getElementById('form-overlay').classList.remove('hidden');
}

function hideForm() {
  document.getElementById('form-overlay').classList.add('hidden');
}

async function handleSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('edit-id').value;
  const sub = {
    id: id || generateId(),
    name: document.getElementById('sub-name').value.trim(),
    cost: parseFloat(document.getElementById('sub-cost').value) || 0,
    cycle: document.getElementById('sub-cycle').value,
    nextDate: document.getElementById('sub-date').value,
    category: document.getElementById('sub-category').value,
    remindDays: parseInt(document.getElementById('sub-remind').value),
    isTrial: document.getElementById('sub-trial').checked,
    createdAt: id ? subscriptions.find(s => s.id === id)?.createdAt : Date.now()
  };

  if (id) {
    const idx = subscriptions.findIndex(s => s.id === id);
    if (idx !== -1) subscriptions[idx] = sub;
  } else {
    subscriptions.push(sub);
  }

  await saveSubscriptions();
  hideForm();
  render();
}

async function deleteSub(id) {
  subscriptions = subscriptions.filter(s => s.id !== id);
  await saveSubscriptions();
  render();
}

function toggleSort() {
  sortAsc = !sortAsc;
  render();
}

function exportCSV() {
  if (subscriptions.length === 0) return;

  const header = 'Name,Cost,Cycle,Next Renewal,Category,Free Trial\n';
  const rows = subscriptions.map(s =>
    `${csvSafe(s.name)},${s.cost},${csvSafe(s.cycle)},${s.nextDate},${csvSafe(s.category)},${s.isTrial}`
  ).join('\n');

  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `subwatch-export-${formatDate(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Utilities ---

function toMonthly(cost, cycle) {
  switch (cycle) {
    case 'weekly': return cost * 4.33;
    case 'monthly': return cost;
    case 'quarterly': return cost / 3;
    case 'yearly': return cost / 12;
    default: return cost;
  }
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / 86400000);
}

function formatCurrency(n) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function csvSafe(s) {
  if (typeof s !== 'string') s = String(s);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return s.replace(/[&<>"']/g, c => map[c]);
}
