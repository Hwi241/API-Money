var STORAGE_KEYS = {
  apiKey: "deepseekApiKey",
  lastBalance: "lastBalanceData",
  history: "balanceHistory",
  lastError: "lastError"
};

var els = {
  statusPill: null,
  balanceValue: null,
  lastUpdated: null,
  hourUsage: null,
  todayUsage: null,
  messageBox: null,
  apiKeyInput: null,
  saveKeyButton: null,
  deleteKeyButton: null,
  refreshButton: null,
  showFloatingButton: null,
  keyState: null
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindPopupElements();

  if (!hasRequiredElements()) {
    console.error("[API Money] Required popup elements are missing.", els);
    showMessage("팝업 요소를 찾지 못했습니다. 확장프로그램을 새로고침한 뒤 다시 열어주세요.", true);
    return;
  }

  if (els.saveKeyButton) els.saveKeyButton.addEventListener("click", saveApiKey);
  if (els.deleteKeyButton) els.deleteKeyButton.addEventListener("click", deleteApiKey);
  if (els.refreshButton) els.refreshButton.addEventListener("click", manualRefresh);
  if (els.showFloatingButton) els.showFloatingButton.addEventListener("click", showFloatingPanel);

  sendRuntimeMessage({ type: "ENSURE_ALARM" }).then(loadState).catch(loadState);
  window.setInterval(loadState, 5000);
}

function bindPopupElements() {
  els.statusPill = document.getElementById("statusPill");
  els.balanceValue = document.getElementById("balanceValue");
  els.lastUpdated = document.getElementById("lastUpdated");
  els.hourUsage = document.getElementById("hourUsage");
  els.todayUsage = document.getElementById("todayUsage");
  els.messageBox = document.getElementById("messageBox");
  els.apiKeyInput = document.getElementById("apiKeyInput");
  els.saveKeyButton = document.getElementById("saveKeyButton");
  els.deleteKeyButton = document.getElementById("deleteKeyButton");
  els.refreshButton = document.getElementById("refreshButton");
  els.showFloatingButton = document.getElementById("showFloatingButton");
  els.keyState = document.getElementById("keyState");
}

function hasRequiredElements() {
  return Boolean(
    els.statusPill &&
    els.balanceValue &&
    els.lastUpdated &&
    els.hourUsage &&
    els.todayUsage &&
    els.messageBox &&
    els.apiKeyInput &&
    els.saveKeyButton &&
    els.deleteKeyButton &&
    els.refreshButton &&
    els.keyState
  );
}

function saveApiKey() {
  if (!els.apiKeyInput) return;
  var apiKey = els.apiKeyInput.value.trim();
  if (!apiKey) { showMessage("DeepSeek API Key를 입력해 주세요.", true); return; }
  setLoading(true);
  sendRuntimeMessage({ type: "SAVE_API_KEY", apiKey: apiKey }).then(function(response) {
    setLoading(false);
    if (!response.ok) { showMessage(response.error || "API Key 저장 또는 잔액 조회에 실패했습니다.", true); loadState(); return; }
    if (els.apiKeyInput) els.apiKeyInput.value = "";
    showMessage("API Key를 저장하고 잔액을 조회했습니다.", false);
    loadState();
  }).catch(function(err) {
    setLoading(false);
    showMessage(err.message || "오류가 발생했습니다.", true);
    loadState();
  });
}

function deleteApiKey() {
  if (!els.apiKeyInput) return;
  setLoading(true);
  sendRuntimeMessage({ type: "DELETE_API_KEY" }).then(function(response) {
    setLoading(false);
    if (!response.ok) { showMessage(response.error || "API Key 삭제에 실패했습니다.", true); return; }
    if (els.apiKeyInput) els.apiKeyInput.value = "";
    showMessage("API Key와 잔액 기록을 삭제했습니다.", false);
    loadState();
  }).catch(function(err) {
    setLoading(false);
    showMessage(err.message || "오류가 발생했습니다.", true);
    loadState();
  });
}

function showFloatingPanel() {
  setLoading(true);

  sendRuntimeMessage({
    type: "API_MONEY_SET_FLOATING_ENABLED",
    enabled: true
  }).then(function(response) {
    setLoading(false);

    if (!response.ok) {
      showMessage(response.error || "플로팅 패널 켜기에 실패했습니다.", true);
      return;
    }

    showMessage("플로팅 패널을 켰습니다. 일반 웹사이트의 활성 탭에서 표시됩니다.", false);
  }).catch(function(err) {
    setLoading(false);
    showMessage(err.message || "플로팅 패널 켜기 중 오류가 발생했습니다.", true);
  });
}

function manualRefresh() {
  setLoading(true);
  sendRuntimeMessage({ type: "REFRESH_BALANCE" }).then(function(response) {
    setLoading(false);
    if (!response.ok) { showMessage(response.error || "잔액 조회에 실패했습니다.", true); loadState(); return; }
    showMessage("잔액을 새로고침했습니다.", false);
    loadState();
  }).catch(function(err) {
    setLoading(false);
    showMessage(err.message || "오류가 발생했습니다.", true);
    loadState();
  });
}

function loadState() {
  getStorage([STORAGE_KEYS.apiKey, STORAGE_KEYS.lastBalance, STORAGE_KEYS.history, STORAGE_KEYS.lastError]).then(function(stored) {
    var hasKey = Boolean(stored[STORAGE_KEYS.apiKey]);
    var lastBalance = stored[STORAGE_KEYS.lastBalance] || null;
    var history = Array.isArray(stored[STORAGE_KEYS.history]) ? stored[STORAGE_KEYS.history] : [];
    var lastError = stored[STORAGE_KEYS.lastError] || null;

    renderKeyState(hasKey);
    renderBalance(lastBalance);
    renderUsage(lastBalance, history);
    renderStatus(hasKey, lastBalance, lastError);

    if (lastError) {
      showMessage(lastError.message || "잔액 조회 오류가 있습니다.", true);
    } else if (!hasKey) {
      showMessage("DeepSeek API Key를 저장하면 1분마다 잔액을 자동 확인합니다.", false);
    }
  });
}

function renderKeyState(hasKey) {
  if (!els.keyState || !els.apiKeyInput) return;
  if (hasKey) {
    els.keyState.textContent = "API Key 저장됨";
    els.apiKeyInput.placeholder = "새 키를 입력하면 교체됩니다";
    return;
  }
  els.keyState.textContent = "API Key 미저장";
  els.apiKeyInput.placeholder = "sk-...";
}

function renderBalance(lastBalance) {
  if (!els.balanceValue || !els.lastUpdated) return;
  if (!lastBalance) {
    els.balanceValue.textContent = "--";
    els.lastUpdated.textContent = "마지막 업데이트 없음";
    return;
  }
  els.balanceValue.textContent = formatMoney(lastBalance.balance, lastBalance.currency);
  els.lastUpdated.textContent = "마지막 업데이트 " + formatDateTime(lastBalance.updatedAt);
}

function renderUsage(lastBalance, history) {
  if (!els.hourUsage || !els.todayUsage) return;
  if (!lastBalance || history.length === 0) {
    els.hourUsage.textContent = "--";
    els.todayUsage.textContent = "--";
    return;
  }
  var currentBalance = Number(lastBalance.balance);
  var currency = lastBalance.currency || "USD";
  var oneHourUsage = calculateUsageSince(history, currentBalance, 60 * 60 * 1000);
  var todayUsageValue = calculateTodayUsage(history, currentBalance);
  els.hourUsage.textContent = formatMoney(oneHourUsage, currency);
  els.todayUsage.textContent = formatMoney(todayUsageValue, currency);
}

function renderStatus(hasKey, lastBalance, lastError) {
  if (!hasKey) { setStatus("KEY", "status-idle"); return; }
  if (lastError) { setStatus("오류", "status-error"); return; }
  if (lastBalance) { setStatus("정상", "status-ok"); return; }
  setStatus("대기", "status-idle");
}

function calculateUsageSince(history, currentBalance, durationMs) {
  var now = Date.now();
  var target = now - durationMs;
  var candidates = history.filter(function(item) { return Number.isFinite(Date.parse(item.updatedAt)); });
  candidates.sort(function(a, b) { return Date.parse(a.updatedAt) - Date.parse(b.updatedAt); });
  if (candidates.length === 0) return 0;
  var ref = candidates.find(function(item) { return Date.parse(item.updatedAt) >= target; }) || candidates[0];
  var diff = Number(ref.balance) - currentBalance;
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

function calculateTodayUsage(history, currentBalance) {
  var todayKey = new Date().toDateString();
  var todayRecords = history.filter(function(item) {
    var d = new Date(item.updatedAt);
    return Number.isFinite(d.getTime()) && d.toDateString() === todayKey;
  });
  todayRecords.sort(function(a, b) { return Date.parse(a.updatedAt) - Date.parse(b.updatedAt); });
  if (todayRecords.length === 0) return 0;
  var diff = Number(todayRecords[0].balance) - currentBalance;
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

function setStatus(text, className) {
  if (!els.statusPill) return;
  els.statusPill.textContent = text;
  els.statusPill.className = "status " + className;
}

function setLoading(isLoading) {
  els.saveKeyButton.disabled = isLoading;
  els.deleteKeyButton.disabled = isLoading;
  els.refreshButton.disabled = isLoading;

  if (els.showFloatingButton) {
    els.showFloatingButton.disabled = isLoading;
  }
  if (isLoading) setStatus("조회중", "status-loading");
}

function showMessage(message, isError) {
  if (!els.messageBox) {
    if (message) console.log("[API Money]", isError ? "Error:" : "Info:", message);
    return;
  }
  if (!message) {
    els.messageBox.classList.add("hidden");
    els.messageBox.textContent = "";
    return;
  }
  els.messageBox.textContent = message;
  els.messageBox.classList.remove("hidden");
  els.messageBox.classList.toggle("error", Boolean(isError));
}

function formatMoney(value, currency) {
  var amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  var code = String(currency || "USD").toUpperCase();
  if (code === "USD") return "$" + amount.toFixed(4);
  if (code === "CNY") return "\u00A5" + amount.toFixed(4);
  return amount.toFixed(4) + " " + code;
}

function formatDateTime(value) {
  if (!value) return "없음";
  var date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "없음";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sendRuntimeMessage(message) {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage(message, function(response) {
      var err = chrome.runtime.lastError;
      if (err) { resolve({ ok: false, error: err.message }); return; }
      resolve(response || { ok: false, error: "No response from background." });
    });
  });
}

function getStorage(keys) {
  return new Promise(function(resolve) {
    chrome.storage.local.get(keys, function(items) { resolve(items || {}); });
  });
}
