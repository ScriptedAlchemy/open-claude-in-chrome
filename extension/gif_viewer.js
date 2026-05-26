chrome.storage.local.get("exportedGifData", ({ exportedGifData }) => {
  const content = document.getElementById("content")
  if (!content) return
  if (!exportedGifData?.dataUrl) {
    content.textContent = "No recording export data found."
    return
  }
  content.innerHTML = ""
  const image = document.createElement("img")
  image.src = exportedGifData.dataUrl
  image.alt = "Generated browser recording"
  image.className = "gif-export-image"
  const link = document.createElement("a")
  link.href = exportedGifData.dataUrl
  link.download = exportedGifData.filename || "open-claude.png"
  const extension = (exportedGifData.filename || "").split(".").pop()?.toUpperCase() || "IMAGE"
  link.textContent = `Download ${extension}`
  content.append(image, link)
})
