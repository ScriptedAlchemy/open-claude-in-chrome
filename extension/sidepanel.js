const activity = document.getElementById("activity")

function addActivity(message) {
  if (!activity) return
  const item = document.createElement("li")
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  item.textContent = `${time} · ${message}`
  activity.prepend(item)
  while (activity.children.length > 5) {
    activity.lastElementChild?.remove()
  }
}

function setText(id, text) {
  const node = document.getElementById(id)
  if (node) node.textContent = text
}

async function getActiveTab() {
  const requestedTabId = Number(new URLSearchParams(location.search).get("tabId"))
  if (Number.isFinite(requestedTabId) && requestedTabId > 0) {
    const requested = await chrome.tabs.get(requestedTabId).catch(() => null)
    if (requested) return requested
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [])
  return tab || null
}

function renderTab(tab) {
  setText("tab-title", tab?.title || "No active tab detected")
  setText("tab-url", tab?.url || "Open a page to expose it to OpenClaude.")
}

async function buildPromptText() {
  const tab = await getActiveTab()
  const prompt = document.getElementById("prompt")?.value?.trim() || ""
  const tabContext = tab
    ? `\n\nActive tab:\n- Title: ${tab.title || "Untitled"}\n- URL: ${tab.url || ""}\n- tabId: ${tab.id ?? "unknown"}`
    : ""
  return `${prompt}${tabContext}`.trim()
}

async function refreshStatus() {
  const status = document.getElementById("status")
  const pill = document.getElementById("status-pill")
  const response = await chrome.runtime.sendMessage({ type: "get_status" }).catch(() => null)
  const tab = await getActiveTab()
  renderTab(tab)
  if (!status || !pill) return
  if (response?.connected) {
    status.textContent = `Connected to native host ${response.hostName || ""}`.trim()
    status.className = "ok"
    pill.textContent = "Connected"
    pill.className = "status-pill ok"
    setText("host-name", response.hostName || "com.openclaude.chrome")
    addActivity("Connected to native host")
    return
  }
  status.textContent = "Native host not connected. Start OpenClaude and reload the extension if needed."
  status.className = "warn"
  pill.textContent = "Disconnected"
  pill.className = "status-pill warn"
  setText("host-name", response?.hostName || "com.openclaude.chrome")
  addActivity("Native host is not connected")
}

document.getElementById("options")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage()
})

document.getElementById("refresh")?.addEventListener("click", () => {
  void refreshStatus()
})

document.getElementById("open-claude")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://claude.ai/new" }).catch(() => {})
})

document.getElementById("copy-tab")?.addEventListener("click", async () => {
  const tab = await getActiveTab()
  if (!tab) {
    addActivity("No active tab to copy")
    return
  }
  const text = JSON.stringify(
    {
      title: tab.title || "",
      url: tab.url || "",
      tabId: tab.id,
    },
    null,
    2,
  )
  await navigator.clipboard.writeText(text).catch(() => {})
  addActivity("Copied active tab context")
})

document.getElementById("copy-prompt")?.addEventListener("click", async () => {
  const text = await buildPromptText()
  if (!text) {
    addActivity("Write a prompt first")
    return
  }
  await navigator.clipboard.writeText(text).catch(() => {})
  addActivity("Copied prompt with tab context")
})

document.getElementById("dismiss-permission")?.addEventListener("click", () => {
  document.getElementById("permission-banner")?.remove()
})

for (const button of document.querySelectorAll(".chip")) {
  button.addEventListener("click", () => {
    const prompt = document.getElementById("prompt")
    if (prompt) {
      prompt.value = button.getAttribute("data-prompt") || ""
      prompt.focus()
    }
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "POPULATE_INPUT_TEXT") {
    const prompt = document.getElementById("prompt")
    if (prompt) {
      prompt.value = message.prompt || ""
      prompt.focus()
      addActivity("Loaded prompt from Claude")
    }
    return false
  }
  if (message.type === "show_pairing_prompt") {
    const requestId = typeof message.request_id === "string" ? message.request_id : ""
    if (!requestId) {
      sendResponse?.({ handled: false, error: "missing request_id" })
      return false
    }
    const clientType =
      typeof message.client_type === "string" && message.client_type.trim()
        ? message.client_type.trim()
        : "desktop"
    const currentName =
      typeof message.current_name === "string" && message.current_name.trim()
        ? message.current_name.trim()
        : "OpenClaude Browser"
    const providedName = window.prompt(
      `Allow ${clientType} client to pair with this browser bridge?\n\nDisplay name:`,
      currentName,
    )
    if (providedName === null) {
      chrome.runtime
        .sendMessage({
          type: "pairing_dismissed",
          request_id: requestId,
        })
        .catch(() => {})
      addActivity("Dismissed pairing request")
    } else {
      chrome.runtime
        .sendMessage({
          type: "pairing_confirmed",
          request_id: requestId,
          name: providedName.trim() || currentName,
        })
        .catch(() => {})
      addActivity("Approved pairing request")
    }
    sendResponse?.({ handled: true })
    return true
  }
  return false
})

void refreshStatus()
