(function() {
  var STORAGE_KEYS = {
    lastBalance: "lastBalanceData",
    history: "balanceHistory",
    lastError: "lastError",
    floatingEnabled: "floatingPanelEnabled",
    floatingState: "floatingPanelState"
  };

  var PANEL_ID = "api-money-floating-panel";
  var DEFAULT_STATE = { left: 24, top: 88, width: 240, height: null, minimized: false };

  var panel = null;
  var dragState = null;
  var saveTimer = null;
  var refreshTimer = null;
  var lastAlertKey = null;

  init();

  function init() {
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
      if (!message || !message.type) return;

      if (message.type === "API_MONEY_FLOATING_VISIBILITY") {
        setPanelVisible(Boolean(message.visible));
        if (message.visible) renderFromStorage();
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "API_MONEY_FLOATING_REFRESH") {
        renderFromStorage();
        sendResponse({ ok: true });
        return true;
      }
    });

    document.addEventListener("visibilitychange", claimWhenVisible);
    window.addEventListener("focus", claimWhenVisible);
    window.addEventListener("resize", keepPanelInsideViewport);

    claimWhenVisible();
    refreshTimer = window.setInterval(renderFromStorage, 5000);
  }

  function claimWhenVisible() {
    if (document.visibilityState !== "visible") return;

    sendRuntimeMessage({ type: "API_MONEY_CLAIM_FLOATING" }).then(function(response) {
      if (response && response.ok && response.visible) {
        ensurePanel().then(function() {
          setPanelVisible(true);
          renderFromStorage();
        });
      } else {
        setPanelVisible(false);
      }
    });
  }

  function ensurePanel() {
    if (panel && document.documentElement.contains(panel)) {
      return Promise.resolve(panel);
    }

    panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="api-money-floating-header" data-drag-handle="true">' +
        '<div class="api-money-floating-title">API Money</div>' +
        '<div class="api-money-floating-mini-value" data-role="mini-balance">--</div>' +
        '<div class="api-money-floating-actions">' +
          '<button class="api-money-floating-button" type="button" data-action="minimize" title="최소화">−</button>' +
          '<button class="api-money-floating-button" type="button" data-action="refresh" title="새로고침">↻</button>' +
          '<button class="api-money-floating-button" type="button" data-action="close" title="끄기">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="api-money-floating-body">' +
        '<div class="api-money-floating-card">' +
          '<span class="api-money-floating-label">잔액</span>' +
          '<span class="api-money-floating-value" data-role="balance">--</span>' +
        '</div>' +
        '<div class="api-money-floating-card">' +
          '<span class="api-money-floating-label">최근 1시간 사용</span>' +
          '<span class="api-money-floating-value" data-role="hour-usage">--</span>' +
        '</div>' +
        '<div class="api-money-floating-card">' +
          '<span class="api-money-floating-label">오늘 사용</span>' +
          '<span class="api-money-floating-value" data-role="today-usage">--</span>' +
        '</div>' +
      '</div>';

    document.documentElement.appendChild(panel);

    panel.addEventListener("mousedown", startDrag);
    panel.addEventListener("click", handleClick);

    var resizeObserver = new ResizeObserver(function() { scheduleSaveState(); });
    resizeObserver.observe(panel);

    return applySavedState().then(function() { return panel; });
  }

  function applySavedState() {
    return new Promise(function(resolve) {
      chrome.storage.local.get([STORAGE_KEYS.floatingState], function(stored) {
        var state = {};
        for (var k in DEFAULT_STATE) { state[k] = DEFAULT_STATE[k]; }
        if (stored[STORAGE_KEYS.floatingState]) {
          for (var k in stored[STORAGE_KEYS.floatingState]) { state[k] = stored[STORAGE_KEYS.floatingState][k]; }
        }
        setPanelLeft(safeNumber(state.left, DEFAULT_STATE.left));
        setPanelTop(safeNumber(state.top, DEFAULT_STATE.top));
        setPanelWidth(safeNumber(state.width, DEFAULT_STATE.width));
        if (state.height) setPanelHeight(safeNumber(state.height, 0));
        setMinimized(Boolean(state.minimized));
        keepPanelInsideViewport();
        resolve();
      });
    });
  }

  function startDrag(event) {
    var handle = event.target.closest("[data-drag-handle='true']");
    var isButton = event.target.closest("button");
    if (!handle || isButton || !panel) return;

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panel.offsetLeft,
      startTop: panel.offsetTop
    };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
    event.preventDefault();
  }

  function onDrag(event) {
    if (!dragState || !panel) return;
    setPanelLeft(clamp(dragState.startLeft + event.clientX - dragState.startX, 0, window.innerWidth - 48));
    setPanelTop(clamp(dragState.startTop + event.clientY - dragState.startY, 0, window.innerHeight - 32));
    scheduleSaveState();
  }

  function stopDrag() {
    dragState = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
    saveState();
  }

  function handleClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var action = button.dataset.action;

    if (action === "minimize") {
      var isMinimized = panel.classList.contains("api-money-minimized");
      setMinimized(!isMinimized);
      button.textContent = isMinimized ? "−" : "□";
      saveState();
      return;
    }

    if (action === "refresh") {
      sendRuntimeMessage({ type: "REFRESH_BALANCE" }).then(function() { renderFromStorage(); });
      return;
    }

    if (action === "close") {
      sendRuntimeMessage({ type: "API_MONEY_SET_FLOATING_ENABLED", enabled: false });
      setPanelVisible(false);
    }
  }

  function renderFromStorage() {
    if (!panel || panel.classList.contains("api-money-hidden")) return;

    chrome.storage.local.get([STORAGE_KEYS.lastBalance, STORAGE_KEYS.history, STORAGE_KEYS.lastError], function(stored) {
      var lastBalance = stored[STORAGE_KEYS.lastBalance] || null;
      var history = Array.isArray(stored[STORAGE_KEYS.history]) ? stored[STORAGE_KEYS.history] : [];

      var balanceEl = panel.querySelector("[data-role='balance']");
      var hourEl = panel.querySelector("[data-role='hour-usage']");
      var todayEl = panel.querySelector("[data-role='today-usage']");
      var miniEl = panel.querySelector("[data-role='mini-balance']");

      if (!lastBalance) {
        if (balanceEl) balanceEl.textContent = "--";
        if (hourEl) hourEl.textContent = "--";
        if (todayEl) todayEl.textContent = "--";
        if (miniEl) miniEl.textContent = "--";
        return;
      }

      var currentBalance = Number(lastBalance.balance);
      var currency = lastBalance.currency || "USD";
      var hourUsage = calculateUsageSince(history, currentBalance, 60 * 60 * 1000);
      var todayUsage = calculateTodayUsage(history, currentBalance);

      if (balanceEl) balanceEl.textContent = formatMoney(currentBalance, currency);
      if (hourEl) hourEl.textContent = formatMoney(hourUsage, currency);
      if (todayEl) todayEl.textContent = formatMoney(todayUsage, currency);
      if (miniEl) miniEl.textContent = formatMoney(currentBalance, currency);

      checkRapidSpendAlert(history, currentBalance, currency, lastBalance.updatedAt);
    });
  }

  function checkRapidSpendAlert(history, currentBalance, currency, updatedAt) {
    var sorted = getSortedHistory(history);
    if (sorted.length < 3) return;

    var now = Date.now();
    var balance5mAgo = getBalanceAtOrBefore(sorted, now - 5 * 60 * 1000);
    var balance10mAgo = getBalanceAtOrBefore(sorted, now - 10 * 60 * 1000);

    if (!Number.isFinite(balance5mAgo) || !Number.isFinite(balance10mAgo)) return;

    var recent5 = Math.max(0, balance5mAgo - currentBalance);
    var previous5 = Math.max(0, balance10mAgo - balance5mAgo);

    if (previous5 < 0.1) return;

    var alertKey = String(updatedAt || "");
    if (recent5 > previous5 * 1.5 && alertKey && alertKey !== lastAlertKey) {
      lastAlertKey = alertKey;
      flashRed();
    }
  }

  function flashRed() {
    if (!panel) return;
    panel.classList.add("api-money-flash");
    window.setTimeout(function() {
      if (panel) panel.classList.remove("api-money-flash");
    }, 5000);
  }

  function calculateUsageSince(history, currentBalance, durationMs) {
    var sorted = getSortedHistory(history);
    if (sorted.length === 0) return 0;
    var target = Date.now() - durationMs;
    var ref = sorted.find(function(item) { return Date.parse(item.updatedAt) >= target; }) || sorted[0];
    var diff = Number(ref.balance) - currentBalance;
    return Number.isFinite(diff) ? Math.max(0, diff) : 0;
  }

  function calculateTodayUsage(history, currentBalance) {
    var todayKey = new Date().toDateString();
    var records = getSortedHistory(history).filter(function(item) {
      var d = new Date(item.updatedAt);
      return Number.isFinite(d.getTime()) && d.toDateString() === todayKey;
    });
    if (records.length === 0) return 0;
    var diff = Number(records[0].balance) - currentBalance;
    return Number.isFinite(diff) ? Math.max(0, diff) : 0;
  }

  function getSortedHistory(history) {
    var copy = history.slice().filter(function(item) { return Number.isFinite(Date.parse(item.updatedAt)); });
    copy.sort(function(a, b) { return Date.parse(a.updatedAt) - Date.parse(b.updatedAt); });
    return copy;
  }

  function getBalanceAtOrBefore(sorted, targetTime) {
    var result = null;
    for (var i = 0; i < sorted.length; i++) {
      var time = Date.parse(sorted[i].updatedAt);
      if (time <= targetTime) { result = sorted[i]; }
      else { break; }
    }
    return result ? Number(result.balance) : NaN;
  }

  function setPanelVisible(visible) {
    if (!panel) return;
    if (visible) { panel.classList.remove("api-money-hidden"); }
    else { panel.classList.add("api-money-hidden"); }
  }

  function setMinimized(minimized) {
    if (!panel) return;
    if (minimized) { panel.classList.add("api-money-minimized"); }
    else { panel.classList.remove("api-money-minimized"); }
  }

  function setPanelLeft(v) { if (panel) panel.style.left = v + "px"; }
  function setPanelTop(v) { if (panel) panel.style.top = v + "px"; }
  function setPanelWidth(v) { if (panel) panel.style.width = v + "px"; }
  function setPanelHeight(v) { if (panel) panel.style.height = v + "px"; }

  function keepPanelInsideViewport() {
    if (!panel) return;
    var rect = panel.getBoundingClientRect();
    setPanelLeft(clamp(rect.left, 0, Math.max(0, window.innerWidth - 48)));
    setPanelTop(clamp(rect.top, 0, Math.max(0, window.innerHeight - 32)));
  }

  function scheduleSaveState() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveState, 300);
  }

  function saveState() {
    if (!panel) return;
    var state = {
      left: panel.offsetLeft,
      top: panel.offsetTop,
      width: panel.offsetWidth,
      height: panel.classList.contains("api-money-minimized") ? null : panel.offsetHeight,
      minimized: panel.classList.contains("api-money-minimized")
    };
    chrome.storage.local.set({ [STORAGE_KEYS.floatingState]: state });
  }

  function formatMoney(value, currency) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) return "--";
    var code = String(currency || "USD").toUpperCase();
    if (code === "USD") return "$" + amount.toFixed(4);
    if (code === "CNY") return "\u00A5" + amount.toFixed(4);
    return amount.toFixed(4) + " " + code;
  }

  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
  function safeNumber(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : fallback; }

  function sendRuntimeMessage(message) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage(message, function(response) {
        var err = chrome.runtime.lastError;
        if (err) { resolve({ ok: false, error: err.message }); return; }
        resolve(response || { ok: false, error: "No response." });
      });
    });
  }
})();
