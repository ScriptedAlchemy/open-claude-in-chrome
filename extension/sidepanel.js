async function refreshStatus() {
  const status = document.getElementById("status")
  const response = await chrome.runtime.sendMessage({ type: "get_status" }).catch(() => null)
  if (!status) return
  if (response?.connected) {
    status.textContent = `Connected to native host ${response.hostName || ""}`.trim()
    status.className = "ok"
    return
  }
  status.textContent = "Native host not connected. Start OpenClaude and reload the extension if needed."
  status.className = "warn"
}

document.getElementById("options")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage()
})

void refreshStatus()
