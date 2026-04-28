import { describe, expect, test } from "bun:test"

import {
  BROWSER_DETECTION_ORDER,
  CHROMIUM_BROWSERS,
  getBrowserDataPaths,
  getNativeMessagingHostDirs,
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
