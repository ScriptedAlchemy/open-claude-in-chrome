const blockedInput = document.getElementById("blocked")
const result = document.getElementById("result")

chrome.storage.local.get(["blockedUrlPatterns"], values => {
  if (Array.isArray(values.blockedUrlPatterns)) {
    blockedInput.value = values.blockedUrlPatterns.join("\n")
  }
})

document.getElementById("save")?.addEventListener("click", async () => {
  const blockedUrlPatterns = blockedInput.value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  await chrome.storage.local.set({ blockedUrlPatterns })
  if (result) {
    result.textContent = "Saved"
    result.className = "saved"
  }
})
