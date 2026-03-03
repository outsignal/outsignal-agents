// Outsignal LinkedIn Connector — Service Worker (Manifest V3)
// Monitors LinkedIn session cookie health on a 4-hour cycle.
// Detects li_at expiry, alerts the user via badge + notification,
// and reports the expiry to the Outsignal API for Phase 13 health check pickup.

const API_BASE = 'https://admin.outsignal.ai';
const ALARM_NAME = 'check-linkedin-cookies';
const CHECK_INTERVAL_MINUTES = 240; // 4 hours

// ---------------------------------------------------------------------------
// Alarm setup
// ---------------------------------------------------------------------------

// Create alarm on first install
chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  console.log('[Outsignal] Extension installed — cookie check alarm registered');
});

// Re-create alarm on Chrome startup (alarms don't persist across restarts)
chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  console.log('[Outsignal] Chrome started — cookie check alarm re-registered');
});

async function ensureAlarm() {
  try {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
      console.log('[Outsignal] Cookie check alarm created (every 4 hours)');
    }
  } catch (err) {
    console.error('[Outsignal] Failed to create alarm:', err);
  }
}

// ---------------------------------------------------------------------------
// Alarm handler
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  console.log('[Outsignal] Alarm fired — running cookie health check');
  await checkCookieHealth();
});

// ---------------------------------------------------------------------------
// Cookie health check
// ---------------------------------------------------------------------------

async function checkCookieHealth() {
  // 1. Check if extension is configured (has token + sender)
  let apiToken, selectedSenderId;
  try {
    const stored = await chrome.storage.local.get(['apiToken', 'selectedSenderId']);
    apiToken = stored.apiToken;
    selectedSenderId = stored.selectedSenderId;
  } catch (err) {
    console.error('[Outsignal] Failed to read storage:', err);
    return;
  }

  if (!apiToken || !selectedSenderId) {
    console.log('[Outsignal] Not configured — skipping cookie check');
    return;
  }

  // 2. Read all LinkedIn cookies
  let cookies;
  try {
    cookies = await chrome.cookies.getAll({ domain: '.linkedin.com' });
  } catch (err) {
    console.error('[Outsignal] Failed to read cookies:', err);
    return;
  }

  // 3. Check for li_at cookie (primary session indicator)
  const liAt = cookies.find(c => c.name === 'li_at');

  if (liAt) {
    // Session looks healthy — clear any badge
    try {
      chrome.action.setBadgeText({ text: '' });
    } catch (err) {
      // Non-fatal — badge clear is best-effort
    }
    console.log('[Outsignal] LinkedIn session healthy (li_at present)');
    return;
  }

  // 4. Session expired — li_at cookie missing
  console.log('[Outsignal] LinkedIn session expired — li_at cookie missing');

  // Set red "!" badge
  try {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  } catch (err) {
    console.error('[Outsignal] Failed to set badge:', err);
  }

  // Show browser notification
  try {
    chrome.notifications.create('session-expired', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'LinkedIn Session Expired',
      message: 'Your LinkedIn session has expired. Click to reconnect in Outsignal.',
      priority: 2
    });
  } catch (err) {
    console.error('[Outsignal] Failed to create notification:', err);
  }

  // 5. Notify Outsignal API — mark sender as session_expired for Phase 13 health check
  try {
    const response = await fetch(`${API_BASE}/api/extension/senders/${selectedSenderId}/expiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (response.status === 401) {
      // Token expired — user needs to re-login via popup
      console.log('[Outsignal] Extension token expired — user must re-login');
    } else if (response.ok) {
      console.log('[Outsignal] Session expiry reported to Outsignal API');
    } else {
      console.warn('[Outsignal] API returned unexpected status:', response.status);
    }
  } catch (err) {
    // Non-fatal — badge and notification still work even if API call fails
    console.error('[Outsignal] Failed to report expiry to API:', err);
  }
}

// ---------------------------------------------------------------------------
// Notification click handler
// ---------------------------------------------------------------------------

// Clicking the expiry notification opens the extension popup for reconnect
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'session-expired') {
    // chrome.action.openPopup() works in MV3 (Chrome 99+) when triggered from a user gesture.
    // Notification click IS a user gesture context.
    chrome.action.openPopup().catch(() => {
      // openPopup may not be available in all contexts; user will see the badge
      // and can click the extension icon manually.
      console.log('[Outsignal] openPopup not available — user should click extension icon');
    });
    chrome.notifications.clear('session-expired');
  }
});

// ---------------------------------------------------------------------------
// Message handler (popup communication)
// ---------------------------------------------------------------------------

// Popup can request an immediate cookie check (e.g., after reconnect)
// or clear the badge (e.g., after successful login)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'check-cookies-now') {
    checkCookieHealth().then(() => sendResponse({ ok: true })).catch((err) => {
      console.error('[Outsignal] check-cookies-now failed:', err);
      sendResponse({ ok: false, error: String(err) });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'clear-badge') {
    try {
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }
});
