import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"

export function getUsername(env = process.env) {
  try {
    return userInfo().username || "default"
  } catch {
    return env.USER || env.USERNAME || "default"
  }
}

export function getSocketName(username = getUsername()) {
  return `claude-mcp-browser-bridge-${username}`
}

export function getSocketDir({ username = getUsername() } = {}) {
  return `/tmp/${getSocketName(username)}`
}

export function getSecureSocketPath({
  platform = process.platform,
  username = getUsername(),
  pid = process.pid,
} = {}) {
  const socketName = getSocketName(username)
  if (platform === "win32") {
    return `\\\\.\\pipe\\${socketName}`
  }
  return join(getSocketDir({ username }), `${pid}.sock`)
}

export function getLegacySocketPaths({
  platform = process.platform,
  username = getUsername(),
} = {}) {
  if (platform === "win32") {
    return [`\\\\.\\pipe\\${getSocketName(username)}`]
  }

  const legacyName = getSocketName(username)
  const legacyTmpdir = join(tmpdir(), legacyName)
  const legacyTmp = `/tmp/${legacyName}`
  return legacyTmpdir === legacyTmp ? [legacyTmp] : [legacyTmpdir, legacyTmp]
}
