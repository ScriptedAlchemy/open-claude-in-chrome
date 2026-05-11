import { describe, expect, test } from "vitest"
import {
  isUrlBlockedByPatterns,
  normalizeBlockedPattern,
} from "../extension/managed-policy.js"

describe("managed and local blocked URL policy", () => {
  test("normalizes bare domains to wildcard paths", () => {
    expect(normalizeBlockedPattern("https://www.example.com")).toBe(
      "example.com/*",
    )
  })

  test("matches URL paths with wildcards", () => {
    expect(
      isUrlBlockedByPatterns("https://example.com/admin/settings", [
        "example.com/admin/*",
      ]),
    ).toBe(true)
    expect(
      isUrlBlockedByPatterns("https://example.com/docs", [
        "example.com/admin/*",
      ]),
    ).toBe(false)
  })
})
