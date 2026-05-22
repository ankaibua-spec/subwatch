const STORAGE_KEY = 'subwatch_subscriptions';
const ALARM_NAME = 'subwatch_daily_check';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 360 // check every 6 hours
  });
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkRenewals();
    updateBadge();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_BADGE') {
    updateBadge();
  }
});

async function checkRenewals() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  const subs = data[STORAGE_KEY] || [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const sub of subs) {
    if (sub.remindDays === 0) continue;

    const target = new Date(sub.nextDate + 'T00:00:00');
    const diff = Math.ceil((target - now) / 86400000);

    if (diff === sub.remindDays) {
      const cost = sub.cost === 0 ? 'Free' : `$${sub.cost.toFixed(2)}`;
      const trialText = sub.isTrial ? ' (FREE TRIAL ending!)' : '';

      chrome.notifications.create(`subwatch-${sub.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `SubWatch — Renewal Reminder`,
        message: `${sub.name} (${cost}/${sub.cycle}) renews in ${diff} day${diff > 1 ? 's' : ''}.${trialText} Still need it?`,
        priority: 2
      });
    }
  }

  await autoAdvanceRenewals(subs);
}

async function autoAdvanceRenewals(subs) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let changed = false;

  for (const sub of subs) {
    const target = new Date(sub.nextDate + 'T00:00:00');
    if (target < now) {
      sub.nextDate = getNextRenewal(sub.nextDate, sub.cycle);
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: subs });
  }
}

function getNextRenewal(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (cycle) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

async function updateBadge() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  const subs = data[STORAGE_KEY] || [];

  if (subs.length === 0) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  let monthlyTotal = 0;
  for (const sub of subs) {
    switch (sub.cycle) {
      case 'weekly': monthlyTotal += sub.cost * 4.33; break;
      case 'monthly': monthlyTotal += sub.cost; break;
      case 'quarterly': monthlyTotal += sub.cost / 3; break;
      case 'yearly': monthlyTotal += sub.cost / 12; break;
    }
  }

  const text = monthlyTotal >= 100 ? `$${Math.round(monthlyTotal)}` : `$${monthlyTotal.toFixed(0)}`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
}
