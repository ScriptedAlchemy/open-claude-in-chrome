chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "OPEN_CLAUDE_AGENT_INDICATOR") return false
  let indicator = document.getElementById("open-claude-agent-indicator")
  if (!indicator) {
    indicator = document.createElement("div")
    indicator.id = "open-claude-agent-indicator"
    indicator.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#fff;padding:8px 10px;border-radius:8px;font:12px system-ui,sans-serif;box-shadow:0 4px 16px #0004"
    document.documentElement.appendChild(indicator)
  }
  indicator.textContent = message.text || "OpenClaude is using this page"
  sendResponse({ success: true })
  return true
})
