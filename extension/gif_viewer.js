chrome.storage.local.get("exportedGifData", ({ exportedGifData }) => {
  const content = document.getElementById("content")
  if (!content) return
  if (!exportedGifData?.dataUrl) {
    content.textContent = "No GIF export data found."
    return
  }
  content.innerHTML = ""
  const image = document.createElement("img")
  image.src = exportedGifData.dataUrl
  image.alt = "Generated browser recording"
  const link = document.createElement("a")
  link.href = exportedGifData.dataUrl
  link.download = exportedGifData.filename || "open-claude.gif"
  link.textContent = "Download GIF"
  content.append(image, link)
})
