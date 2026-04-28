const colorScheme = window.matchMedia("(prefers-color-scheme: dark)")

function applyTheme(event = colorScheme) {
  document.documentElement.setAttribute("data-theme", "claude")
  document.documentElement.setAttribute("data-mode", event.matches ? "dark" : "light")
}

applyTheme()
colorScheme.addEventListener("change", applyTheme)
