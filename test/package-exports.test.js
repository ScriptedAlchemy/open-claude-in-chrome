import { describe, expect, test } from "vitest"

describe("open-claude-in-chrome package exports", () => {
  test("package entrypoint resolves provided and default loggers", async () => {
    const mod = await import("open-claude-in-chrome")
    const logger = { debug() {}, info() {}, warn() {}, error() {} }

    expect(mod.resolveLogger(logger)).toBe(logger)
    expect(() => mod.resolveLogger().debug("ok")).not.toThrow()
  })

  test("declared package subpaths expose protocol and tool behavior", async () => {
    const { encodeNativeMessage } = await import("open-claude-in-chrome/protocol")
    const { CHROME_BROWSER_TOOLS, CHROME_TOOL_NAMES } = await import(
      "open-claude-in-chrome/tools"
    )
    const payload = Buffer.from(JSON.stringify({ type: "ping" }), "utf8")
    const encoded = encodeNativeMessage({ type: "ping" })

    expect(encoded.readUInt32LE(0)).toBe(payload.length)
    expect(encoded.subarray(4)).toEqual(payload)
    expect(CHROME_TOOL_NAMES).toEqual(CHROME_BROWSER_TOOLS.map(tool => tool.name))
    expect(CHROME_TOOL_NAMES).toContain("javascript_tool")
  })

  test("source entrypoint resolves provided logger", async () => {
    const mod = await import("../src/node/index.js")
    const logger = { debug() {}, info() {}, warn() {}, error() {} }

    expect(mod.resolveLogger(logger)).toBe(logger)
  })

  test("logger default is callable", async () => {
    const { noopLogger } = await import("../src/node/index.js")
    expect(() => noopLogger.debug("ok")).not.toThrow()
  })

  test("main entrypoint exports browser tool manifest", async () => {
    const mod = await import("open-claude-in-chrome")
    expect(mod.CHROME_TOOL_NAMES).toContain("javascript_tool")
    expect(mod.CHROME_TOOL_NAMES).toContain("browser_batch")
    expect(mod.CHROME_TOOL_NAMES).toContain("tabs_close_mcp")
    expect(mod.CHROME_TOOL_NAMES).toContain("file_upload")
    expect(mod.CHROME_TOOL_NAMES).toContain("turn_answer_start")
    expect(mod.CHROME_BROWSER_TOOLS.length).toBeGreaterThan(10)
  })
})
