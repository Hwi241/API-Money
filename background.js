const STORAGE_KEYS = {
  apiKey: "deepseekApiKey",
  lastBalance: "lastBalanceData",
  history: "balanceHistory",
  lastError: "lastError",
  autoRefreshEnabled: "autoRefreshEnabled"
};

const ALARM_NAME = "api-money-refresh";
const REFRESH_PERIOD_MINUTES = 1;
const HISTORY_MAX_DAYS = 2;
const HISTORY_MAX_ITEMS = 3000;
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAutoRefreshAlarm();
  await setBadgeFromStorage();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAutoRefreshAlarm();
  await setBadgeFromStorage();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    await refreshBalance("alarm");
  } catch (error) {
    await saveError(error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      return { ok: false, error: "Unknown message." };
    }

    if (message.type === "SAVE_API_KEY") {
      const apiKey = String(message.apiKey || "").trim();
      if (!apiKey) throw new Error("API key is required.");
      await chrome.storage.local.set({
        [STORAGE_KEYS.apiKey]: apiKey,
        [STORAGE_KEYS.autoRefreshEnabled]: true
      });
      await ensureAutoRefreshAlarm();
      const result = await refreshBalance("save-api-key");
      return { ok: true, data: result };
    }

    if (message.type === "DELETE_API_KEY") {
      await chrome.storage.local.remove([
        STORAGE_KEYS.apiKey,
        STORAGE_KEYS.lastBalance,
        STORAGE_KEYS.history,
        STORAGE_KEYS.lastError
      ]);
      await chrome.alarms.clear(ALARM_NAME);
      await setBadgeText("KEY", "#6b7280");
      return { ok: true };
    }

    if (message.type === "REFRESH_BALANCE") {
      const result = await refreshBalance("manual");
      return { ok: true, data: result };
    }

    if (message.type === "ENSURE_ALARM") {
      await ensureAutoRefreshAlarm();
      return { ok: true };
    }

    return { ok: false, error: "Unsupported message type." };
  })()
  .then((result) => sendResponse(result))
  .catch(async (error) => {
    await saveError(error);
    sendResponse({
      ok: false,
      error: error && error.message ? error.message : "Unknown error."
    });
  });

  return true;
});

async function ensureAutoRefreshAlarm() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.autoRefreshEnabled
  ]);
  const hasApiKey = Boolean(stored[STORAGE_KEYS.apiKey]);
  const autoRefreshEnabled = stored[STORAGE_KEYS.autoRefreshEnabled] !== false;
  await chrome.alarms.clear(ALARM_NAME);
  if (!hasApiKey || !autoRefreshEnabled) return;
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
}

async function refreshBalance(source) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.history
  ]);
  const apiKey = stored[STORAGE_KEYS.apiKey];
  if (!apiKey) {
    await setBadgeText("KEY", "#6b7280");
    throw new Error("DeepSeek API key is not saved.");
  }

  const response = await fetch(DEEPSEEK_BALANCE_URL, {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const detail = await readResponseText(response);
    throw new Error("DeepSeek balance request failed. HTTP " + response.status + (detail ? ": " + detail : ""));
  }

  const payload = await response.json();
  const balanceData = extractBalance(payload);
  const now = new Date().toISOString();

  const current = {
    balance: balanceData.balance,
    currency: balanceData.currency,
    isAvailable: payload.is_available !== false,
    updatedAt: now,
    source: source
  };

  const oldHistory = Array.isArray(stored[STORAGE_KEYS.history])
    ? stored[STORAGE_KEYS.history]
    : [];

  const newHistory = pruneHistory([...oldHistory, current]);

  await chrome.storage.local.set({
    [STORAGE_KEYS.lastBalance]: current,
    [STORAGE_KEYS.history]: newHistory,
    [STORAGE_KEYS.lastError]: null
  });

  await setBadgeForBalance(current);
  return current;
}

function extractBalance(payload) {
  const infos = Array.isArray(payload && payload.balance_infos)
    ? payload.balance_infos
    : [];

  if (infos.length === 0) {
    throw new Error("No balance information was returned by DeepSeek.");
  }

  const preferred = infos.find(function(item) {
    return String(item.currency || "").toUpperCase() === "USD";
  }) || infos[0];

  const currency = String(preferred.currency || "USD").toUpperCase();
  const rawBalance =
    preferred.total_balance ??
    preferred.balance ??
    preferred.available_balance ??
    preferred.topped_up_balance ??
    preferred.granted_balance;

  const balance = Number(rawBalance);
  if (!Number.isFinite(balance)) {
    throw new Error("Could not parse DeepSeek balance.");
  }

  return { balance: balance, currency: currency };
}

function pruneHistory(history) {
  const now = Date.now();
  const minTime = now - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
  return history
    .filter(function(item) {
      var time = Date.parse(item.updatedAt);
      return Number.isFinite(time) && time >= minTime;
    })
    .slice(-HISTORY_MAX_ITEMS);
}

async function saveError(error) {
  const message = error && error.message ? error.message : "Unknown error.";
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEYS.lastError]: { message: message, updatedAt: now }
  });
  await setBadgeText("ERR", "#dc2626");
}

async function setBadgeFromStorage() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.lastBalance,
    STORAGE_KEYS.lastError
  ]);

  if (!stored[STORAGE_KEYS.apiKey]) {
    await setBadgeText("KEY", "#6b7280");
    return;
  }
  if (stored[STORAGE_KEYS.lastError]) {
    await setBadgeText("ERR", "#dc2626");
    return;
  }
  if (stored[STORAGE_KEYS.lastBalance]) {
    await setBadgeForBalance(stored[STORAGE_KEYS.lastBalance]);
    return;
  }
  await setBadgeText("...", "#2563eb");
}

async function setBadgeForBalance(balanceData) {
  const text = formatBadgeBalance(balanceData.balance);
  await setBadgeText(text, "#2563eb");
}

async function setBadgeText(text, color) {
  await chrome.action.setBadgeText({ text: text });
  await chrome.action.setBadgeBackgroundColor({ color: color });
}

function formatBadgeBalance(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return "ERR";
  }
  return "$" + amount.toFixed(2);
}

async function readResponseText(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : "";
  } catch (error) {
    return "";
  }
}
