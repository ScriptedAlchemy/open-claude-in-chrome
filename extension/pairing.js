const params = new URLSearchParams(location.search)
const requestId = params.get("request_id") || ""
const clientType = params.get("client_type") || "desktop"
const currentName = params.get("current_name") || "OpenClaude Browser"

const copy = document.getElementById("pairing-copy")
const nameInput = document.getElementById("pairing-name")
const confirmButton = document.getElementById("pairing-confirm")
const dismissButton = document.getElementById("pairing-dismiss")

if (copy) {
  copy.textContent = `Approve pairing request from ${clientType} client.`
}
if (nameInput) {
  nameInput.value = currentName
  nameInput.focus()
  nameInput.select()
}

async function sendAndClose(message) {
  await chrome.runtime.sendMessage(message).catch(() => {})
  window.close()
}

confirmButton?.addEventListener("click", async () => {
  if (!requestId) return
  const name = nameInput?.value?.trim() || currentName
  await sendAndClose({
    type: "pairing_confirmed",
    request_id: requestId,
    name,
  })
})

dismissButton?.addEventListener("click", async () => {
  if (!requestId) return
  await sendAndClose({
    type: "pairing_dismissed",
    request_id: requestId,
  })
})
