import { describe, expect, test } from "vitest"

import {
  BROWSER_DETECTION_ORDER,
  CHROMIUM_BROWSERS,
  getBrowserDataPaths,
  getNativeMessagingHostDirs,
  getWindowsRegistryKeys,
} from "../src/shared/browsers.js"
import { getSecureSocketPath } from "../src/shared/socket-paths.js"

describe("browser matrices", () => {
  test("keeps official-supported browser order", () => {
    expect(BROWSER_DETECTION_ORDER).toEqual([
      "chrome",
      "brave",
      "arc",
      "edge",
      "chromium",
      "vivaldi",
      "opera",
    ])
  })

  test("has macOS native host paths for all supported browsers", () => {
    for (const browser of BROWSER_DETECTION_ORDER) {
      expect(CHROMIUM_BROWSERS[browser].macos.nativeMessagingPath.length).toBeGreaterThan(0)
    }
  })

  test("returns macOS native messaging host paths", () => {
    expect(getNativeMessagingHostDirs({ platform: "darwin", home: "/Users/example" })).toContainEqual({
      browser: "chrome",
      path: "/Users/example/Library/Application Support/Google/Chrome/NativeMessagingHosts",
    })
    expect(getNativeMessagingHostDirs({ platform: "darwin", home: "/Users/example" })).toContainEqual({
      browser: "brave",
      path: "/Users/example/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    })
  })

  test("returns Chrome and Brave browser data paths", () => {
    expect(getBrowserDataPaths({ platform: "darwin", home: "/Users/example" })).toEqual(
      expect.arrayContaining([
        {
          browser: "chrome",
          path: "/Users/example/Library/Application Support/Google/Chrome",
        },
        {
          browser: "brave",
          path: "/Users/example/Library/Application Support/BraveSoftware/Brave-Browser",
        },
      ]),
    )
  })

  test("returns Linux native host and data paths", () => {
    expect(getNativeMessagingHostDirs({ platform: "linux", home: "/home/example" })).toContainEqual({
      browser: "edge",
      path: "/home/example/.config/microsoft-edge/NativeMessagingHosts",
    })
    expect(getBrowserDataPaths({ platform: "linux", home: "/home/example" })).not.toContainEqual(
      expect.objectContaining({ browser: "arc" }),
    )
  })

  test("returns Windows data paths and registry keys", () => {
    expect(getBrowserDataPaths({ platform: "win32", home: "C:\\Users\\example" })).toContainEqual({
      browser: "chrome",
      path: "C:\\Users\\example/AppData/Local/Google/Chrome/User Data",
    })
    expect(getWindowsRegistryKeys().map(({ browser }) => browser)).toEqual(BROWSER_DETECTION_ORDER)
  })

  test("uses a per-user secure socket path", () => {
    expect(
      getSecureSocketPath({
        platform: "darwin",
        username: "alice",
        pid: 123,
      }),
    ).toBe("/tmp/claude-mcp-browser-bridge-alice/123.sock")
  })
})
