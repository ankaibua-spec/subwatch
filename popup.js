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
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
  }
}

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', showAddForm);
  document.getElementById('btn-cancel').addEventListener('click', hideForm);
  document.getElementById('sub-form').addEventListener('submit', handleSubmit);
  document.getElementById('btn-export').addEventListener('click', exportCSV);
  document.getElementById('btn-sort').addEventListener('click', toggleSort);
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

  const sorted = [...subscriptions].sort((a, b) => {
    const da = daysUntil(a.nextDate);
    const db = daysUntil(b.nextDate);
    return sortAsc ? da - db : db - da;
  });

  listEl.innerHTML = sorted.map(sub => {
    const days = daysUntil(sub.nextDate);
    let statusClass = 'status-ok';
    if (sub.isTrial) statusClass = 'status-trial';
    else if (days <= 3) statusClass = 'status-urgent';
    else if (days <= 7) statusClass = 'status-soon';

    const daysText = days < 0 ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`;
    const trialBadge = sub.isTrial ? '<span class="trial-badge">TRIAL</span>' : '';
    const costText = sub.cost === 0 ? 'Free' : formatCurrency(sub.cost);

    return `
      <div class="sub-item" role="listitem" data-id="${sub.id}" data-subscription="${escapeHtml(sub.name)}" data-billing-cycle="${sub.cycle}" data-renewal-status="${statusClass}">
        <div class="sub-status ${statusClass}" title="Renewal status: ${days <= 3 ? 'urgent' : days <= 7 ? 'upcoming' : 'safe'}"></div>
        <div class="sub-info">
          <div class="sub-name" title="Subscription: ${escapeHtml(sub.name)} — ${capitalize(sub.cycle)} recurring payment">${escapeHtml(sub.name)}${trialBadge}</div>
          <div class="sub-meta">${capitalize(sub.cycle)} · Renews ${daysText} · ${capitalize(sub.category)}</div>
        </div>
        <div class="sub-cost" title="${costText} per ${sub.cycle} — recurring charge">${costText}</div>
        <div class="sub-actions">
          <button class="btn-edit" data-id="${sub.id}" title="Edit">✏️</button>
          <button class="btn-delete" data-id="${sub.id}" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditForm(btn.dataset.id);
    });
  });

  listEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSub(btn.dataset.id);
    });
  });
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
    `"${s.name}",${s.cost},${s.cycle},${s.nextDate},${s.category},${s.isTrial}`
  ).join('\n');

  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `subwatch-export-${formatDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
  return d.toISOString().split('T')[0];
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
