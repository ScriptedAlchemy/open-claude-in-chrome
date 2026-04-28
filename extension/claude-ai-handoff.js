document.addEventListener("click", event => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest("#claude-onboarding-button")
  if (!button) return
  chrome.runtime.sendMessage({
    type: "open_side_panel",
    prompt: button.getAttribute("data-prompt") || "",
  })
})
