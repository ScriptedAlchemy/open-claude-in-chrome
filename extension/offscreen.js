setInterval(() => {
  chrome.runtime.sendMessage({ type: "SW_KEEPALIVE" }).catch(() => {})
}, 20_000)

let audioContext = null

function getFrameDataUrl(frame) {
  if (!frame || typeof frame !== "object") return null
  if (typeof frame.dataUrl === "string" && frame.dataUrl.startsWith("data:image/")) {
    return frame.dataUrl
  }
  if (typeof frame.base64 === "string" && frame.base64.trim()) {
    return `data:image/jpeg;base64,${frame.base64}`
  }
  return null
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Unable to decode frame image"))
    image.src = dataUrl
  })
}

function toPngFilename(filename) {
  if (typeof filename !== "string" || !filename.trim()) {
    return `open-claude-${Date.now()}.png`
  }
  if (filename.toLowerCase().endsWith(".gif")) {
    return filename.slice(0, -4) + ".png"
  }
  if (filename.includes(".")) return filename
  return `${filename}.png`
}

async function buildContactSheetDataUrl(frames) {
  const limitedDataUrls = frames
    .map(getFrameDataUrl)
    .filter(Boolean)
    .slice(0, 16)
  if (limitedDataUrls.length === 0) {
    throw new Error("No frame images were available for export.")
  }
  const images = await Promise.all(limitedDataUrls.map(loadImage))
  const width = Math.max(1, images[0].naturalWidth || images[0].width || 1)
  const height = Math.max(1, images[0].naturalHeight || images[0].height || 1)
  const columns = Math.ceil(Math.sqrt(images.length))
  const rows = Math.ceil(images.length / columns)
  const canvas = document.createElement("canvas")
  canvas.width = width * columns
  canvas.height = height * rows
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("Canvas context is unavailable for export.")
  }
  context.fillStyle = "#111"
  context.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    const x = (index % columns) * width
    const y = Math.floor(index / columns) * height
    context.drawImage(image, x, y, width, height)
  })
  return canvas.toDataURL("image/png")
}

async function playNotificationSound() {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!AudioCtx) throw new Error("Web Audio API is unavailable in this browser.")
  if (!audioContext) audioContext = new AudioCtx()
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => {})
  }
  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.type = "sine"
  oscillator.frequency.setValueAtTime(1046.5, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.2)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GENERATE_GIF") {
    ;(async () => {
      const frames = Array.isArray(message.frames) ? message.frames : []
      const dataUrl = await buildContactSheetDataUrl(frames)
      const filename = toPngFilename(message.filename)
      sendResponse({
        success: true,
        filename,
        frameCount: frames.length,
        format: "png_contact_sheet",
        dataUrl,
      })
    })().catch(error => {
      sendResponse({ success: false, error: String(error) })
    })
    return true
  }
  if (message.type === "OFFSCREEN_PLAY_SOUND") {
    playNotificationSound()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: String(error) }))
    return true
  }
  return false
})
