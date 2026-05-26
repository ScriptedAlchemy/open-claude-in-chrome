// Background service worker for Open Claude in Chrome extension.
// Handles: native messaging, CDP via chrome.debugger, tool dispatch, tab group management.
import { getBlockedUrlPatterns, isUrlBlockedByPatterns } from "./managed-policy.js";

// Prevent unhandled rejections from killing the service worker
self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
});

const NATIVE_HOST_NAME = "com.openclaude.chrome";

// --- State ---
let nativePort = null;
let connectedNativeHostName = null;
let tabGroupId = null;
let tabGroupTabs = new Set();
const attachedTabs = new Map(); // tabId -> { enabledDomains: Set }
const consoleMessages = new Map(); // tabId -> [{level, text, timestamp, url}]
const networkRequests = new Map(); // tabId -> [{url, method, status, type, timestamp}]
const screenshotStore = new Map(); // imageId -> base64
let gifRecording = null;
const pendingPairingRequests = new Set();

// --- Keep-alive alarm ---
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") {
    if (!nativePort) connectNativeHost();
  }
});

// --- Native messaging ---
function connectNativeHost() {
  if (nativePort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort = port;
    connectedNativeHostName = NATIVE_HOST_NAME;

    port.onMessage.addListener((msg) => {
      if (msg.type === "tool_request" && msg.id) {
        handleToolRequest(msg.id, msg.tool, msg.args || {});
      } else if (msg.type === "status_response") {
        chrome.storage.local.set({ nativeHostStatus: msg }).catch(() => {});
      } else if (msg.type === "pairing_request") {
        handlePairingRequest(msg).catch(() => {});
      }
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError?.message;
      if (nativePort === port) nativePort = null;
      if (connectedNativeHostName === NATIVE_HOST_NAME) connectedNativeHostName = null;
      setTimeout(connectNativeHost, 2000);
    });
  } catch (e) {
    nativePort = null;
    connectedNativeHostName = null;
    setTimeout(connectNativeHost, 2000);
  }
}

async function openProductSurface(tabId) {
  const path = tabId === undefined ? "sidepanel.html" : `sidepanel.html?tabId=${encodeURIComponent(tabId)}`;
  if (chrome.sidePanel && tabId !== undefined) {
    await chrome.sidePanel.setOptions({
      tabId,
      path,
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId });
    return;
  }
  await chrome.windows.create({
    url: chrome.runtime.getURL(path),
    type: "popup",
    width: 420,
    height: 720,
  });
}

async function getBridgeDisplayName() {
  const { bridgeDisplayName } = await chrome.storage.local
    .get(["bridgeDisplayName"])
    .catch(() => ({}));
  if (typeof bridgeDisplayName === "string" && bridgeDisplayName.trim()) {
    return bridgeDisplayName.trim();
  }
  return "OpenClaude Browser";
}

async function getOrCreatePairingDeviceId() {
  const { pairingDeviceId } = await chrome.storage.local
    .get(["pairingDeviceId"])
    .catch(() => ({}));
  if (typeof pairingDeviceId === "string" && pairingDeviceId.trim()) {
    return pairingDeviceId.trim();
  }
  const generated =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await chrome.storage.local.set({ pairingDeviceId: generated });
  return generated;
}

function postPairingResponse(payload) {
  if (!nativePort) return false;
  try {
    nativePort.postMessage(payload);
    return true;
  } catch {
    return false;
  }
}

async function handlePairingRequest(message) {
  const requestId =
    typeof message.request_id === "string" ? message.request_id.trim() : "";
  if (!requestId || pendingPairingRequests.has(requestId)) return;
  pendingPairingRequests.add(requestId);

  const clientType =
    typeof message.client_type === "string" && message.client_type.trim()
      ? message.client_type.trim()
      : "desktop";
  const currentName = await getBridgeDisplayName();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "show_pairing_prompt",
      request_id: requestId,
      client_type: clientType,
      current_name: currentName,
    });
    if (response?.handled) return;
  } catch {
    // Side panel might not be open; fallback to pairing page.
  }

  const query = new URLSearchParams({
    request_id: requestId,
    client_type: clientType,
    current_name: currentName,
  });
  await chrome.windows
    .create({
      url: chrome.runtime.getURL(`pairing.html?${query.toString()}`),
      type: "popup",
      width: 420,
      height: 560,
    })
    .catch(() => {});
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return false;
  if (await chrome.offscreen.hasDocument()) return true;
  const reasons = [chrome.offscreen.Reason.BLOBS];
  if (chrome.offscreen.Reason.AUDIO_PLAYBACK) {
    reasons.push(chrome.offscreen.Reason.AUDIO_PLAYBACK);
  }
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons,
    justification:
      "Generate browser recording exports and play notification audio for Open Claude in Chrome.",
  });
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SW_KEEPALIVE") {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "get_status") {
    sendResponse({
      connected: Boolean(nativePort),
      hostName: connectedNativeHostName || NATIVE_HOST_NAME,
    });
    return true;
  }
  if (message.type === "open_side_panel") {
    openProductSurface(sender.tab?.id)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }
  if (message.type === "pairing_confirmed") {
    const requestId =
      typeof message.request_id === "string" ? message.request_id.trim() : "";
    if (!requestId) {
      sendResponse({ success: false, error: "pairing_confirmed missing request_id" });
      return true;
    }

    (async () => {
      const providedName =
        typeof message.name === "string" ? message.name.trim() : "";
      const bridgeDisplayName = providedName || (await getBridgeDisplayName());
      await chrome.storage.local.set({ bridgeDisplayName });
      const deviceId = await getOrCreatePairingDeviceId();
      pendingPairingRequests.delete(requestId);
      const sent = postPairingResponse({
        type: "pairing_response",
        request_id: requestId,
        approved: true,
        device_id: deviceId,
        bridgeDisplayName,
      });
      sendResponse(
        sent
          ? { success: true }
          : { success: false, error: "Native host unavailable for pairing response." },
      );
    })().catch((error) =>
      sendResponse({ success: false, error: String(error) }),
    );
    return true;
  }
  if (message.type === "pairing_dismissed") {
    const requestId =
      typeof message.request_id === "string" ? message.request_id.trim() : "";
    if (!requestId) {
      sendResponse({ success: false, error: "pairing_dismissed missing request_id" });
      return true;
    }
    pendingPairingRequests.delete(requestId);
    const sent = postPairingResponse({
      type: "pairing_response",
      request_id: requestId,
      approved: false,
      reason: "dismissed",
    });
    sendResponse(
      sent
        ? { success: true }
        : { success: false, error: "Native host unavailable for pairing response." },
    );
    return true;
  }
  return false;
});

function isTrustedClaudeOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" &&
      (hostname === "claude.ai" || hostname.endsWith(".claude.ai"))
    );
  } catch {
    return false;
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = sender.origin || sender.url || "";
  if (!isTrustedClaudeOrigin(origin)) {
    sendResponse({ success: false, error: "Untrusted origin" });
    return true;
  }
  if (message.type === "ping") {
    sendResponse({ success: true, exists: true });
    return true;
  }
  if (message.type === "onboarding_task") {
    chrome.runtime
      .sendMessage({
        type: "POPULATE_INPUT_TEXT",
        prompt: message.payload?.prompt || "",
      })
      .catch(() => {});
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "oauth_redirect") {
    chrome.runtime
      .sendMessage({
        type: "OAUTH_REDIRECT",
        payload: message.payload || null,
      })
      .catch(() => {});
    sendResponse({ success: true });
    return true;
  }
  sendResponse({ success: false, error: "Unsupported message type" });
  return true;
});

chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command === "toggle-side-panel") {
    openProductSurface(tab?.id).catch(() => {});
  }
});

chrome.action?.onClicked?.addListener(tab => {
  openProductSurface(tab?.id).catch(() => {});
});

function sendResponse(id, result) {
  if (!nativePort) return;
  try {
    nativePort.postMessage({ id, type: "tool_response", result });
  } catch {
    // Port disconnected
  }
}

function sendError(id, error) {
  if (!nativePort) return;
  try {
    nativePort.postMessage({ id, type: "tool_error", error: String(error) });
  } catch {
    // Port disconnected
  }
}

// --- Tab group management ---
async function ensureTabGroup(createIfEmpty) {
  if (tabGroupId !== null) {
    try {
      const group = await chrome.tabGroups.get(tabGroupId);
      if (group) {
        // Verify tabs are still in the group
        const tabs = await chrome.tabs.query({ groupId: tabGroupId });
        tabGroupTabs = new Set(tabs.map((t) => t.id));
        if (tabGroupTabs.size > 0) return;
      }
    } catch {
      tabGroupId = null;
      tabGroupTabs.clear();
    }
  }

  if (!createIfEmpty) return;

  const existingGroups = await chrome.tabGroups.query({ title: "MCP" }).catch(() => []);
  for (const group of existingGroups) {
    const tabs = await chrome.tabs.query({ groupId: group.id }).catch(() => []);
    if (tabs.length > 0) {
      tabGroupId = group.id;
      tabGroupTabs = new Set(tabs.map((tab) => tab.id));
      return;
    }
  }

  // Create a new window with a tab, group it
  const win = await chrome.windows.create({ focused: true, url: "about:blank" });
  const tab = win.tabs[0];
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, { title: "MCP", color: "blue" });
  tabGroupId = groupId;
  tabGroupTabs = new Set([tab.id]);
}

function formatTabContext(tabs) {
  const available = tabs.map((t) => ({
    tabId: t.id,
    title: t.title || "Untitled",
    url: t.url || "",
  }));

  let text = `Tab Context:\n- Available tabs:\n`;
  for (const t of available) {
    text += `  \u2022 tabId ${t.tabId}: "${t.title}" (${t.url})\n`;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ availableTabs: available, tabGroupId }) + "\n\n" + text,
      },
    ],
  };
}

async function isInGroup(tabId) {
  // Always check live state — in-memory tabGroupTabs can be stale after service worker restart
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1) {
      // Recover tabGroupId if we lost it (service worker restart)
      if (tabGroupId === null) {
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          if (group.title === "MCP") {
            tabGroupId = group.id;
            const groupTabs = await chrome.tabs.query({ groupId: tabGroupId });
            tabGroupTabs = new Set(groupTabs.map((t) => t.id));
          }
        } catch {}
      }
      return tab.groupId === tabGroupId;
    }
    return tabGroupTabs.has(tabId);
  } catch {
    return false;
  }
}

// --- CDP helpers ---
async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attachedTabs.set(tabId, { enabledDomains: new Set() });
  // Force devicePixelRatio to 1 so screenshots match CSS coordinate space.
  // Without this, Retina displays produce 2x screenshots and all coordinates are wrong.
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
    width: win.width,
    height: win.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function ensureDomain(tabId, domain) {
  const state = attachedTabs.get(tabId);
  if (!state) throw new Error("Not attached to tab");
  if (state.enabledDomains.has(domain)) return;
  await chrome.debugger.sendCommand({ tabId }, `${domain}.enable`, {});
  state.enabledDomains.add(domain);
}

async function cdp(tabId, method, params = {}) {
  await ensureAttached(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabGroupTabs.delete(tabId);
  if (attachedTabs.has(tabId)) {
    try { chrome.debugger.detach({ tabId }); } catch {}
    attachedTabs.delete(tabId);
  }
  consoleMessages.delete(tabId);
  networkRequests.delete(tabId);
});

// Handle user dismissing debugger bar
chrome.debugger.onDetach.addListener((source, reason) => {
  attachedTabs.delete(source.tabId);
});

// --- CDP event listeners for console and network ---
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;

  if (method === "Console.messageAdded" && params.message) {
    const msgs = consoleMessages.get(tabId) || [];
    msgs.push({
      level: params.message.level,
      text: params.message.text,
      url: params.message.url || "",
      timestamp: Date.now(),
    });
    // Keep last 1000
    if (msgs.length > 1000) msgs.splice(0, msgs.length - 1000);
    consoleMessages.set(tabId, msgs);
  }

  if (method === "Runtime.consoleAPICalled" && params.args) {
    const msgs = consoleMessages.get(tabId) || [];
    const text = params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    msgs.push({
      level: params.type || "log",
      text,
      url: params.stackTrace?.callFrames?.[0]?.url || "",
      timestamp: Date.now(),
    });
    if (msgs.length > 1000) msgs.splice(0, msgs.length - 1000);
    consoleMessages.set(tabId, msgs);
  }

  if (method === "Network.requestWillBeSent" && params.request) {
    const reqs = networkRequests.get(tabId) || [];
    reqs.push({
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      status: 0,
      type: params.type || "Other",
      timestamp: Date.now(),
    });
    if (reqs.length > 1000) reqs.splice(0, reqs.length - 1000);
    networkRequests.set(tabId, reqs);
  }

  if (method === "Network.responseReceived" && params.response) {
    const reqs = networkRequests.get(tabId) || [];
    const existing = reqs.find((request) => request.requestId === params.requestId);
    const entry = existing || {
      requestId: params.requestId,
      url: params.response.url,
      method: params.response.requestHeaders?.[":method"] || "GET",
      timestamp: Date.now(),
    };
    entry.url = params.response.url;
    entry.status = params.response.status;
    entry.statusText = params.response.statusText;
    entry.type = params.type || entry.type || "Other";
    entry.mimeType = params.response.mimeType;
    if (!existing) reqs.push(entry);
    if (reqs.length > 1000) reqs.splice(0, reqs.length - 1000);
    networkRequests.set(tabId, reqs);
  }
});

// --- Key code mapping ---
const KEY_MAP = {
  enter: "Enter", return: "Enter", tab: "Tab", escape: "Escape", esc: "Escape",
  backspace: "Backspace", delete: "Delete", space: "Space", " ": "Space",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
  f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
  f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12",
};

function parseKeyCombo(keyStr) {
  const parts = keyStr.split("+").map((p) => p.trim().toLowerCase());
  let modifiers = 0;
  let key = "";
  for (const part of parts) {
    if (part === "ctrl" || part === "control") modifiers |= 2;
    else if (part === "alt") modifiers |= 1;
    else if (part === "shift") modifiers |= 8;
    else if (part === "meta" || part === "cmd" || part === "command" || part === "win" || part === "windows") modifiers |= 4;
    else key = KEY_MAP[part] || part;
  }
  return { key, modifiers };
}

function parseModifierString(modStr) {
  if (!modStr) return 0;
  let modifiers = 0;
  const parts = modStr.split("+").map((p) => p.trim().toLowerCase());
  for (const part of parts) {
    if (part === "ctrl" || part === "control") modifiers |= 2;
    else if (part === "alt") modifiers |= 1;
    else if (part === "shift") modifiers |= 8;
    else if (part === "meta" || part === "cmd" || part === "command" || part === "win" || part === "windows") modifiers |= 4;
  }
  return modifiers;
}

// --- Content script communication ---
async function sendContentMessage(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch {
    // Content script might not be injected yet, try injecting
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    // Retry
    return chrome.tabs.sendMessage(tabId, message);
  }
}

// --- Resolve ref to coordinates ---
async function resolveRefToCoordinates(tabId, ref) {
  const resp = await sendContentMessage(tabId, { type: "getRefCoordinates", ref });
  if (resp?.result) return [resp.result.x, resp.result.y];
  return null;
}

// --- Screenshot helper ---
async function takeScreenshot(tabId) {
  await ensureAttached(tabId);

  // With deviceScaleFactor: 1 set in ensureAttached, screenshots are captured
  // at CSS pixel dimensions (e.g., 1080x746), matching the coordinate space
  // used by Input.dispatchMouseEvent. No scaling tricks needed.
  const result = await cdp(tabId, "Page.captureScreenshot", {
    format: "jpeg",
    quality: 55,
    optimizeForSpeed: true,
    captureBeyondViewport: false,
  });
  let base64 = result.data;

  // If still too large (>500KB base64 ≈ ~375KB binary), reduce quality further
  if (base64.length > 500000) {
    const smaller = await cdp(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 30,
      optimizeForSpeed: true,
      captureBeyondViewport: false,
    });
    base64 = smaller.data;
  }

  const imageId = `screenshot_${Date.now()}`;
  screenshotStore.set(imageId, base64);
  // Keep only last 10 screenshots (less memory pressure)
  const keys = Array.from(screenshotStore.keys());
  while (keys.length > 10) {
    screenshotStore.delete(keys.shift());
  }

  return { base64, imageId };
}

// --- Mouse helpers ---
async function dispatchMouse(tabId, type, x, y, opts = {}) {
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: opts.button || "left",
    clickCount: opts.clickCount || 1,
    modifiers: opts.modifiers || 0,
  });
}

async function mouseClick(tabId, x, y, opts = {}) {
  const button = opts.button || "left";
  const clickCount = opts.clickCount || 1;
  const modifiers = opts.modifiers || 0;

  await dispatchMouse(tabId, "mouseMoved", x, y, { modifiers });
  await sleep(50);
  await dispatchMouse(tabId, "mousePressed", x, y, { button, clickCount, modifiers });
  await sleep(50);
  await dispatchMouse(tabId, "mouseReleased", x, y, { button, clickCount, modifiers });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_GIF_FRAMES = 50;

function appendGifFrame(tabId, base64, label) {
  if (!gifRecording || gifRecording.tabId !== tabId || typeof base64 !== "string") {
    return;
  }
  gifRecording.frames.push({ base64, label, at: Date.now() });
  if (gifRecording.frames.length > MAX_GIF_FRAMES) {
    gifRecording.frames.splice(0, gifRecording.frames.length - MAX_GIF_FRAMES);
  }
}

async function captureGifFrameIfRecording(tabId, label) {
  if (!gifRecording || gifRecording.tabId !== tabId) return;
  const { base64 } = await takeScreenshot(tabId);
  appendGifFrame(tabId, base64, label);
}

const DEFAULT_SHORTCUTS = [
  {
    id: "summarize-page",
    command: "summarize",
    title: "Summarize page",
    prompt: "Summarize the current page with key points and next actions.",
    isWorkflow: false,
  },
  {
    id: "find-controls",
    command: "find-controls",
    title: "Find controls",
    prompt: "Find key interactive controls on this page and describe what each does.",
    isWorkflow: false,
  },
  {
    id: "explain-screenshot",
    command: "explain-screenshot",
    title: "Explain screenshot",
    prompt: "Capture a screenshot and explain what is shown.",
    isWorkflow: true,
  },
];

async function getShortcuts() {
  const { shortcuts } = await chrome.storage.local.get(["shortcuts"]).catch(() => ({}));
  if (!Array.isArray(shortcuts)) return DEFAULT_SHORTCUTS;
  const normalized = shortcuts
    .map((entry, index) => ({
      id: typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : `shortcut-${index + 1}`,
      command:
        typeof entry?.command === "string" && entry.command.trim()
          ? entry.command.trim()
          : `custom-${index + 1}`,
      title:
        typeof entry?.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : "Custom shortcut",
      prompt:
        typeof entry?.prompt === "string" && entry.prompt.trim()
          ? entry.prompt.trim()
          : "Help me with this page.",
      isWorkflow: Boolean(entry?.isWorkflow),
    }))
    .filter(entry => entry.prompt);
  return normalized.length > 0 ? normalized : DEFAULT_SHORTCUTS;
}

async function isBrowserBatchEnabled() {
  const { chromeExtBrowserBatchEnabled } = await chrome.storage.local
    .get(["chromeExtBrowserBatchEnabled"])
    .catch(() => ({}));
  if (typeof chromeExtBrowserBatchEnabled === "boolean") {
    return chromeExtBrowserBatchEnabled;
  }
  return true;
}

// --- Tool handlers ---
const toolHandlers = {
  async tabs_context_mcp(args) {
    await ensureTabGroup(args.createIfEmpty);
    if (tabGroupId === null) {
      return {
        content: [{ type: "text", text: "No MCP tab group exists. Use createIfEmpty: true to create one." }],
      };
    }
    const tabs = await chrome.tabs.query({ groupId: tabGroupId });
    return formatTabContext(tabs);
  },

  async tabs_create_mcp(args) {
    await ensureTabGroup(true);
    const tab = await chrome.tabs.create({ active: true });
    await chrome.tabs.group({ tabIds: [tab.id], groupId: tabGroupId });
    tabGroupTabs.add(tab.id);
    const tabs = await chrome.tabs.query({ groupId: tabGroupId });
    const result = formatTabContext(tabs);
    result.content[0].text = `Created new tab. Tab ID: ${tab.id}\n\n` + result.content[0].text;
    return result;
  },

  async tabs_context(args) {
    return toolHandlers.tabs_context_mcp(args);
  },

  async tabs_create(args) {
    return toolHandlers.tabs_create_mcp(args);
  },

  async tabs_close_mcp(args) {
    const tabId = Number(args.tabId);
    if (!Number.isInteger(tabId)) {
      return { content: [{ type: "text", text: "tabId must be an integer" }] };
    }
    if (!(await isInGroup(tabId))) {
      return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    }
    await chrome.tabs.remove(tabId);
    const tabs = tabGroupId === null ? [] : await chrome.tabs.query({ groupId: tabGroupId }).catch(() => []);
    tabGroupTabs = new Set(tabs.map((tab) => tab.id));
    if (tabs.length === 0) {
      tabGroupId = null;
    }
    const result = formatTabContext(tabs);
    result.content[0].text = `Closed tab ${tabId}.\n\n` + result.content[0].text;
    return result;
  },

  async browser_batch(args) {
    if (!(await isBrowserBatchEnabled())) {
      return {
        content: [
          {
            type: "text",
            text: "browser_batch is disabled by policy for this runtime.",
          },
        ],
      };
    }
    if (!Array.isArray(args.actions)) {
      return { content: [{ type: "text", text: "actions must be an array" }] };
    }
    const results = [];
    for (const action of args.actions) {
      const tool = action?.tool || action?.name;
      if (!tool || tool === "browser_batch" || !toolHandlers[tool]) {
        results.push({ tool, error: `Unsupported batch tool: ${tool}` });
        break;
      }
      const result = await toolHandlers[tool](action.input || {});
      results.push({ tool, result });
      if (result?.content?.[0]?.text?.startsWith("Error:")) break;
    }
    return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
  },

  async navigate(args) {
    const { url, tabId } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    if (url === "back") {
      await chrome.tabs.goBack(tabId);
    } else if (url === "forward") {
      await chrome.tabs.goForward(tabId);
    } else {
      let targetUrl = url;
      // Strip any malformed protocol prefix before normalizing
      if (!targetUrl.match(/^https?:\/\//i) && !targetUrl.startsWith("about:") && !targetUrl.startsWith("chrome:") && !targetUrl.startsWith("brave:")) {
        // Remove any partial/broken protocol prefix (e.g., "hps://", "http:/", "ht://")
        targetUrl = targetUrl.replace(/^[a-z]{1,5}:\/+/i, "");
        targetUrl = "https://" + targetUrl;
      }
      if (isUrlBlockedByPatterns(targetUrl, await getBlockedUrlPatterns())) {
        await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("blocked.html") });
        return { content: [{ type: "text", text: `Navigation blocked by OpenClaude policy: ${url}` }] };
      }
      try {
        new URL(targetUrl); // Validate URL before passing to Chrome
      } catch {
        return { content: [{ type: "text", text: `Invalid URL: "${url}". Could not parse as a valid URL.` }] };
      }
      await chrome.tabs.update(tabId, { url: targetUrl });
    }

    // Wait for page load — short timeout to avoid service worker idle kill
    // If the page takes longer, the caller can use screenshot/wait to check
    await new Promise((resolve) => {
      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // 10s max — enough for most pages, avoids service worker timeout
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });

    const tab = await chrome.tabs.get(tabId);
    const tabs = await chrome.tabs.query({ groupId: tabGroupId });
    const loading = tab.status !== "complete" ? " (still loading)" : "";
    const text = `Navigated to ${tab.url}${loading}.\n## Pages\n` +
      tabs.map((t, i) => `${i + 1}: ${t.url}${t.id === tabId ? " [selected]" : ""}`).join("\n");

    await captureGifFrameIfRecording(tabId, "navigate");
    return { content: [{ type: "text", text }] };
  },

  async computer(args) {
    const { action, tabId } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    let coordinate = args.coordinate;
    // Resolve ref to coordinates if provided
    if (args.ref && !coordinate) {
      const coords = await resolveRefToCoordinates(tabId, args.ref);
      if (!coords) return { content: [{ type: "text", text: `Could not resolve ref "${args.ref}" to coordinates.` }] };
      coordinate = coords;
    }

    const modifiers = parseModifierString(args.modifiers);

    switch (action) {
      case "screenshot": {
        const { base64, imageId } = await takeScreenshot(tabId);
        appendGifFrame(tabId, base64, "screenshot");
        // Get viewport dimensions for the response message
        let dims = "";
        try {
          const vp = await cdp(tabId, "Runtime.evaluate", {
            expression: "window.innerWidth + 'x' + window.innerHeight",
          });
          if (vp?.result?.value) dims = vp.result.value;
        } catch {}
        return {
          content: [
            { type: "text", text: `Successfully captured screenshot (${dims}, jpeg) - ID: ${imageId}` },
            { type: "image", data: base64, mimeType: "image/jpeg" },
          ],
        };
      }

      case "left_click": {
        if (!coordinate) return { content: [{ type: "text", text: "coordinate is required for left_click" }] };
        await mouseClick(tabId, coordinate[0], coordinate[1], { modifiers });
        await captureGifFrameIfRecording(tabId, "left_click");
        return { content: [{ type: "text", text: `Clicked at (${coordinate[0]}, ${coordinate[1]})` }] };
      }

      case "right_click": {
        if (!coordinate) return { content: [{ type: "text", text: "coordinate is required for right_click" }] };
        await mouseClick(tabId, coordinate[0], coordinate[1], { button: "right", modifiers });
        await captureGifFrameIfRecording(tabId, "right_click");
        return { content: [{ type: "text", text: `Right-clicked at (${coordinate[0]}, ${coordinate[1]})` }] };
      }

      case "double_click": {
        if (!coordinate) return { content: [{ type: "text", text: "coordinate is required for double_click" }] };
        await mouseClick(tabId, coordinate[0], coordinate[1], { clickCount: 2, modifiers });
        await captureGifFrameIfRecording(tabId, "double_click");
        return { content: [{ type: "text", text: `Double-clicked at (${coordinate[0]}, ${coordinate[1]})` }] };
      }

      case "triple_click": {
        if (!coordinate) return { content: [{ type: "text", text: "coordinate is required for triple_click" }] };
        await mouseClick(tabId, coordinate[0], coordinate[1], { clickCount: 3, modifiers });
        await captureGifFrameIfRecording(tabId, "triple_click");
        return { content: [{ type: "text", text: `Triple-clicked at (${coordinate[0]}, ${coordinate[1]})` }] };
      }

      case "hover": {
        if (!coordinate) return { content: [{ type: "text", text: "coordinate is required for hover" }] };
        await dispatchMouse(tabId, "mouseMoved", coordinate[0], coordinate[1], { modifiers });
        await sleep(200);
        await captureGifFrameIfRecording(tabId, "hover");
        return { content: [{ type: "text", text: `Hovered at (${coordinate[0]}, ${coordinate[1]})` }] };
      }

      case "type": {
        if (!args.text) return { content: [{ type: "text", text: "text is required for type action" }] };
        await ensureAttached(tabId);
        // Type character by character for better compatibility
        for (const char of args.text) {
          await cdp(tabId, "Input.insertText", { text: char });
          await sleep(10);
        }
        await captureGifFrameIfRecording(tabId, "type");
        return { content: [{ type: "text", text: `Typed "${args.text.substring(0, 50)}${args.text.length > 50 ? "..." : ""}"` }] };
      }

      case "key": {
        if (!args.text) return { content: [{ type: "text", text: "text is required for key action" }] };
        await ensureAttached(tabId);
        const repeat = Math.min(args.repeat || 1, 100);
        // Parse space-separated key combos
        const keys = args.text.split(" ").filter(Boolean);
        for (let r = 0; r < repeat; r++) {
          for (const keyStr of keys) {
            const { key, modifiers: keyMod } = parseKeyCombo(keyStr);
            const resolvedKey = key.length === 1 ? key : key;
            await cdp(tabId, "Input.dispatchKeyEvent", {
              type: "keyDown",
              key: resolvedKey,
              code: resolvedKey.length === 1 ? `Key${resolvedKey.toUpperCase()}` : resolvedKey,
              modifiers: keyMod,
              windowsVirtualKeyCode: resolvedKey.charCodeAt ? resolvedKey.charCodeAt(0) : 0,
            });
            await cdp(tabId, "Input.dispatchKeyEvent", {
              type: "keyUp",
              key: resolvedKey,
              code: resolvedKey.length === 1 ? `Key${resolvedKey.toUpperCase()}` : resolvedKey,
              modifiers: keyMod,
            });
            await sleep(30);
          }
        }
        await captureGifFrameIfRecording(tabId, "key");
        return { content: [{ type: "text", text: `Pressed ${repeat} key${repeat > 1 ? "s" : ""}: ${args.text}` }] };
      }

      case "scroll": {
        if (!coordinate) return { content: [{ type: "text", text: "coordinate is required for scroll" }] };
        const dir = args.scroll_direction || "down";
        const amount = Math.min(args.scroll_amount || 3, 10);
        const deltaX = dir === "left" ? -amount * 100 : dir === "right" ? amount * 100 : 0;
        const deltaY = dir === "up" ? -amount * 100 : dir === "down" ? amount * 100 : 0;
        await cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: coordinate[0],
          y: coordinate[1],
          deltaX,
          deltaY,
          modifiers,
        });
        await sleep(300);
        const { base64 } = await takeScreenshot(tabId);
        appendGifFrame(tabId, base64, "scroll");
        return {
          content: [
            { type: "text", text: `Scrolled ${dir} by ${amount} ticks at (${coordinate[0]}, ${coordinate[1]})` },
            { type: "image", data: base64, mimeType: "image/jpeg" },
          ],
        };
      }

      case "scroll_to": {
        if (!coordinate && !args.ref) return { content: [{ type: "text", text: "coordinate or ref is required for scroll_to" }] };
        if (args.ref) {
          await sendContentMessage(tabId, {
            type: "scrollToRef",
            ref: args.ref,
          });
        }
        // Scroll target element into view via JS
        if (coordinate) {
          await cdp(tabId, "Runtime.evaluate", {
            expression: `window.scrollTo(${coordinate[0]}, ${coordinate[1]})`,
          });
        }
        await sleep(300);
        await captureGifFrameIfRecording(tabId, "scroll_to");
        return { content: [{ type: "text", text: `Scrolled to target` }] };
      }

      case "wait": {
        const duration = Math.min(args.duration || 1, 30);
        await sleep(duration * 1000);
        await captureGifFrameIfRecording(tabId, "wait");
        return { content: [{ type: "text", text: `Waited for ${duration} second${duration !== 1 ? "s" : ""}` }] };
      }

      case "left_click_drag": {
        if (!args.start_coordinate || !coordinate) {
          return { content: [{ type: "text", text: "start_coordinate and coordinate are required for left_click_drag" }] };
        }
        const [sx, sy] = args.start_coordinate;
        const [ex, ey] = coordinate;
        await dispatchMouse(tabId, "mouseMoved", sx, sy, { modifiers });
        await sleep(50);
        await dispatchMouse(tabId, "mousePressed", sx, sy, { button: "left", modifiers });
        await sleep(50);
        // Move in steps
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          const mx = sx + ((ex - sx) * i) / steps;
          const my = sy + ((ey - sy) * i) / steps;
          await dispatchMouse(tabId, "mouseMoved", mx, my, { modifiers });
          await sleep(20);
        }
        await dispatchMouse(tabId, "mouseReleased", ex, ey, { button: "left", modifiers });
        await captureGifFrameIfRecording(tabId, "left_click_drag");
        return { content: [{ type: "text", text: `Dragged from (${sx}, ${sy}) to (${ex}, ${ey})` }] };
      }

      case "zoom": {
        if (!args.region || args.region.length !== 4) {
          return { content: [{ type: "text", text: "region [x0, y0, x1, y1] is required for zoom" }] };
        }
        // Capture full screenshot then crop region
        const { base64: fullBase64 } = await takeScreenshot(tabId);
        // Return the full screenshot with region info — client can crop
        return {
          content: [
            { type: "text", text: `Zoom region: [${args.region.join(", ")}]` },
            { type: "image", data: fullBase64, mimeType: "image/jpeg" },
          ],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown computer action: ${action}` }] };
    }
  },

  async read_page(args) {
    const { tabId } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    const resp = await sendContentMessage(tabId, {
      type: "generateAccessibilityTree",
      options: {
        filter: args.filter,
        depth: args.depth,
        max_chars: args.max_chars,
        ref_id: args.ref_id,
      },
    });

    let tree = resp?.result || "Error: Could not generate accessibility tree";
    // Append viewport dimensions so Claude knows the coordinate space
    try {
      await ensureAttached(tabId);
      const vp = await cdp(tabId, "Runtime.evaluate", {
        expression: "window.innerWidth + 'x' + window.innerHeight",
      });
      if (vp?.result?.value) tree += `\n\nViewport: ${vp.result.value}`;
    } catch {}
    return { content: [{ type: "text", text: tree }] };
  },

  async get_page_text(args) {
    const { tabId } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    const resp = await sendContentMessage(tabId, { type: "getPageText" });
    if (!resp?.result) return { content: [{ type: "text", text: "Error: Could not extract page text" }] };

    try {
      const data = JSON.parse(resp.result);
      return {
        content: [
          {
            type: "text",
            text: `Title: ${data.title}\nURL: ${data.url}\nSource: <${data.sourceTag}>\n\n${data.text}`,
          },
        ],
      };
    } catch {
      return { content: [{ type: "text", text: resp.result }] };
    }
  },

  async find(args) {
    const { query, tabId } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    const resp = await sendContentMessage(tabId, { type: "findElements", query });
    const results = resp?.result || [];

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No elements found matching "${query}"` }] };
    }

    let text = `Found ${results.length} element(s) matching "${query}":\n\n`;
    for (const r of results) {
      text += `[${r.ref}] ${r.role} "${r.name}" at (${r.coordinates[0]}, ${r.coordinates[1]})\n`;
    }

    return { content: [{ type: "text", text }] };
  },

  async form_input(args) {
    const { ref, value, tabId } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    const resp = await sendContentMessage(tabId, { type: "setFormValue", ref, value });
    const result = resp?.result;

    if (result?.error) return { content: [{ type: "text", text: `Error: ${result.error}` }] };
    return { content: [{ type: "text", text: `Set ${ref} to "${value}". Result: ${JSON.stringify(result)}` }] };
  },

  async javascript_tool(args) {
    const tabId = Number(args.tabId);
    const text =
      args.text ||
      args.code ||
      args.script ||
      args.expression ||
      args.javascript;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    if (!text || typeof text !== "string") {
      return {
        content: [
          {
            type: "text",
            text: "javascript_tool requires code text in one of: text, code, script, expression, javascript.",
          },
        ],
      };
    }

    await ensureAttached(tabId);
    try {
      const result = await cdp(tabId, "Runtime.evaluate", {
        expression: text,
        returnByValue: true,
        awaitPromise: true,
      });

      if (result.exceptionDetails) {
        return {
          content: [{ type: "text", text: `Error: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}` }],
        };
      }

      const val = result.result;
      if (val.type === "undefined") return { content: [{ type: "text", text: "undefined" }] };
      return {
        content: [{ type: "text", text: val.value !== undefined ? JSON.stringify(val.value) : val.description || String(val) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  },

  async read_console_messages(args) {
    const { tabId, pattern, limit = 100, onlyErrors, clear } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    // Ensure console domain is enabled
    await ensureAttached(tabId);
    await ensureDomain(tabId, "Console");
    await ensureDomain(tabId, "Runtime");

    let msgs = consoleMessages.get(tabId) || [];

    if (onlyErrors) {
      msgs = msgs.filter((m) => ["error", "exception"].includes(m.level));
    }

    if (pattern) {
      try {
        const re = new RegExp(pattern, "i");
        msgs = msgs.filter((m) => re.test(m.text) || re.test(m.level));
      } catch {
        // Invalid regex, use as substring
        msgs = msgs.filter((m) => m.text.includes(pattern));
      }
    }

    msgs = msgs.slice(-limit);

    if (clear) {
      consoleMessages.set(tabId, []);
    }

    if (msgs.length === 0) {
      return { content: [{ type: "text", text: "No console messages matching the pattern." }] };
    }

    const text = msgs
      .map((m) => `[${m.level}] ${m.text}${m.url ? ` (${m.url})` : ""}`)
      .join("\n");

    return { content: [{ type: "text", text: `Console messages (${msgs.length}):\n${text}` }] };
  },

  async read_network_requests(args) {
    const { tabId, urlPattern, limit = 100, clear } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    // Ensure network domain is enabled
    await ensureAttached(tabId);
    await ensureDomain(tabId, "Network");

    let reqs = networkRequests.get(tabId) || [];

    if (urlPattern) {
      reqs = reqs.filter((r) => r.url.includes(urlPattern));
    }

    reqs = reqs.slice(-limit);

    if (clear) {
      networkRequests.set(tabId, []);
    }

    if (reqs.length === 0) {
      return { content: [{ type: "text", text: "No network requests matching the pattern." }] };
    }

    const text = reqs
      .map((r) => `${r.method} ${r.url} ${r.status ? `→ ${r.status}` : "(pending)"}${r.mimeType ? ` [${r.mimeType}]` : ""}`)
      .join("\n");

    return { content: [{ type: "text", text: `Network requests (${reqs.length}):\n${text}` }] };
  },

  async resize_window(args) {
    const width = Number(args.width);
    const height = Number(args.height);
    const tabId = Number(args.tabId);
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { content: [{ type: "text", text: "width and height must be positive numbers." }] };
    }
    if (width > 7680 || height > 4320) {
      return {
        content: [{ type: "text", text: "resize_window dimensions exceed maximum 7680x4320." }],
      };
    }

    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { width, height });
    return { content: [{ type: "text", text: `Resized window to ${width}x${height}` }] };
  },

  async upload_image(args) {
    const { imageId, tabId, ref, coordinate } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };

    if (!screenshotStore.has(imageId)) {
      return { content: [{ type: "text", text: `Image ${imageId} not found. Take a screenshot first.` }] };
    }

    return {
      content: [
        {
          type: "text",
          text: `Image upload is not implemented for browser-extension security reasons (target: ${ref ? `ref=${ref}` : `coordinate=${coordinate || "unspecified"}`}). Use file_upload to prepare the target and ask the user to select a local file.`,
        },
      ],
    };
  },

  async file_upload(args) {
    const { tabId, ref, coordinate, filename = "upload" } = args;
    if (!(await isInGroup(tabId))) return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    if (!ref && !coordinate) {
      return { content: [{ type: "text", text: "ref or coordinate is required for file_upload" }] };
    }
    return {
      content: [
        {
          type: "text",
          text: `Prepared file upload target (${ref ? `ref=${ref}` : `coordinate=${coordinate}`}) for ${filename}. Browser extensions cannot set arbitrary local file paths without a user gesture; ask the user to select the file if the chooser opens.`,
        },
      ],
    };
  },

  async turn_answer_start() {
    return { content: [{ type: "text", text: "Browser answer turn started." }] };
  },

  async gif_creator(args) {
    const action = args.action;
    const tabId = Number(args.tabId);
    if (!Number.isInteger(tabId)) {
      return { content: [{ type: "text", text: "tabId is required for gif_creator" }] };
    }
    if (!(await isInGroup(tabId))) {
      return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    }

    if (action === "start_recording") {
      const { base64 } = await takeScreenshot(tabId);
      gifRecording = {
        tabId,
        frames: [],
        startedAt: Date.now(),
      };
      appendGifFrame(tabId, base64, "start");
      return { content: [{ type: "text", text: "GIF recording started." }] };
    }

    if (action === "stop_recording") {
      if (!gifRecording) {
        return { content: [{ type: "text", text: "No GIF recording is active." }] };
      }
      const { base64 } = await takeScreenshot(tabId);
      appendGifFrame(tabId, base64, "stop");
      gifRecording.stoppedAt = Date.now();
      return { content: [{ type: "text", text: `GIF recording stopped with ${gifRecording.frames.length} frame(s).` }] };
    }

    if (action === "clear") {
      gifRecording = null;
      await chrome.storage.local.remove("exportedGifData");
      return { content: [{ type: "text", text: "GIF recording cleared." }] };
    }

    if (action === "export") {
      if (!gifRecording) {
        return { content: [{ type: "text", text: "No GIF recording is available to export." }] };
      }
      if (!(await ensureOffscreenDocument())) {
        return { content: [{ type: "text", text: "Offscreen documents are not available in this browser." }] };
      }
      const result = await chrome.runtime.sendMessage({
        type: "GENERATE_GIF",
        frames: gifRecording.frames,
        filename: args.filename,
        options: args.options,
      });
      if (!result?.success) {
        return { content: [{ type: "text", text: `Recording export failed: ${result?.error || "unknown error"}` }] };
      }
      await chrome.storage.local.set({
        exportedGifData: {
          dataUrl: result.dataUrl,
          filename: result.filename,
          createdAt: Date.now(),
        },
      });
      if (args.download && result.dataUrl && chrome.downloads) {
        await chrome.downloads.download({
          url: result.dataUrl,
          filename: result.filename,
          saveAs: false,
        });
      }
      return { content: [{ type: "text", text: `Recording exported: ${result.filename}` }] };
    }

    return { content: [{ type: "text", text: `Unknown gif_creator action: ${action}` }] };
  },

  async shortcuts_list(args) {
    const tabId = Number(args.tabId);
    if (!(await isInGroup(tabId))) {
      return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    }
    const shortcuts = await getShortcuts();
    const response = shortcuts.map(shortcut => ({
      id: shortcut.id,
      command: shortcut.command,
      title: shortcut.title,
      isWorkflow: shortcut.isWorkflow,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ shortcuts: response }, null, 2),
        },
      ],
    };
  },

  async shortcuts_execute(args) {
    const tabId = Number(args.tabId);
    if (!(await isInGroup(tabId))) {
      return { content: [{ type: "text", text: `Tab ${tabId} is not in the MCP group.` }] };
    }
    const shortcuts = await getShortcuts();
    const requestedId =
      typeof args.shortcutId === "string" ? args.shortcutId.trim() : "";
    const requestedCommand =
      typeof args.command === "string" ? args.command.trim().replace(/^\//, "") : "";
    const shortcut = shortcuts.find(entry =>
      (requestedId && entry.id === requestedId) ||
      (requestedCommand && entry.command === requestedCommand),
    );
    if (!shortcut) {
      return {
        content: [
          {
            type: "text",
            text: "Shortcut not found. Call shortcuts_list to inspect available ids and commands.",
          },
        ],
      };
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const tabContext = tab
      ? `\n\nActive tab:\n- Title: ${tab.title || "Untitled"}\n- URL: ${tab.url || ""}\n- tabId: ${tab.id}`
      : "";
    const prompt = `${shortcut.prompt}${tabContext}`.trim();
    await chrome.runtime
      .sendMessage({
        type: "POPULATE_INPUT_TEXT",
        prompt,
      })
      .catch(() => {});
    await openProductSurface(tabId).catch(() => {});
    return {
      content: [
        {
          type: "text",
          text: `Executed shortcut ${shortcut.id} (${shortcut.command}).`,
        },
      ],
    };
  },

  async update_plan(args) {
    const domains = Array.isArray(args.domains) ? args.domains : [];
    const approach = Array.isArray(args.approach) ? args.approach : [];
    let text = `Plan:\n\nDomains: ${domains.join(", ") || "unspecified"}\n\nApproach:\n`;
    for (const step of approach) {
      text += `- ${step}\n`;
    }
    if (approach.length === 0) text += "- unspecified\n";
    text += "\nPlan auto-approved (no permission restrictions in this extension).";
    return { content: [{ type: "text", text }] };
  },
};

// --- Tool dispatch ---
async function handleToolRequest(id, tool, args) {
  const handler = toolHandlers[tool];
  if (!handler) {
    sendError(id, `Unknown tool: ${tool}`);
    return;
  }

  try {
    const result = await handler(args);
    sendResponse(id, result);
  } catch (err) {
    sendError(id, `${tool} failed: ${err.message}`);
  }
}

// --- Init ---

// Recover MCP tab group state after service worker restart
async function recoverTabGroupState() {
  try {
    const groups = await chrome.tabGroups.query({ title: "MCP" });
    if (groups.length > 0) {
      tabGroupId = groups[0].id;
      const tabs = await chrome.tabs.query({ groupId: tabGroupId });
      tabGroupTabs = new Set(tabs.map((t) => t.id));
    }
  } catch {
    // Not critical — will be set on first tabs_context_mcp call
  }
}

recoverTabGroupState();
connectNativeHost();
