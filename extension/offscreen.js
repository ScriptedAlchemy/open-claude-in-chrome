setInterval(() => {
  chrome.runtime.sendMessage({ type: "SW_KEEPALIVE" }).catch(() => {})
}, 20_000)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GENERATE_GIF") {
    const frameCount = Array.isArray(message.frames) ? message.frames.length : 0
    const filename = message.filename || `open-claude-${Date.now()}.gif`
    sendResponse({
      success: true,
      filename,
      frames: frameCount,
      dataUrl:
        "data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
    })
    return true
  }
  if (message.type === "OFFSCREEN_PLAY_SOUND") {
    sendResponse({ success: false, error: "Notification sound is not bundled yet." })
    return true
  }
  return false
})
