export function normalizeBlockedPattern(pattern) {
  let normalized = String(pattern)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")

  if (!normalized.includes("/")) {
    normalized += "/*"
  }

  return normalized
}

export function isUrlBlockedByPatterns(url, patterns = []) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const target = `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname || "/"}`
  return patterns.some(pattern => {
    const escaped = normalizeBlockedPattern(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
    return new RegExp(`^${escaped}$`, "i").test(target)
  })
}

export async function getBlockedUrlPatterns() {
  const [local, managed] = await Promise.all([
    chrome.storage.local.get("blockedUrlPatterns").catch(() => ({})),
    chrome.storage.managed?.get("blockedUrlPatterns").catch(() => ({})) ??
      Promise.resolve({}),
  ])

  return [
    ...(Array.isArray(local.blockedUrlPatterns) ? local.blockedUrlPatterns : []),
    ...(Array.isArray(managed.blockedUrlPatterns) ? managed.blockedUrlPatterns : []),
  ]
}
