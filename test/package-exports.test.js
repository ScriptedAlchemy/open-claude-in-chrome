import { describe, expect, test } from "bun:test"

describe("open-claude-in-chrome package exports", () => {
  test("workspace package entrypoint loads", async () => {
    const mod = await import("open-claude-in-chrome")
    expect(typeof mod.resolveLogger).toBe("function")
  })

  test("declared package subpaths load", async () => {
    await expect(import("open-claude-in-chrome/protocol")).resolves.toMatchObject({
      encodeNativeMessage: expect.any(Function),
    })
    await expect(import("open-claude-in-chrome/tools")).resolves.toMatchObject({
      CHROME_BROWSER_TOOLS: expect.any(Array),
    })
  })

  test("source entrypoint loads", async () => {
    const mod = await import("../src/node/index.js")
    expect(typeof mod.resolveLogger).toBe("function")
  })

  test("logger default is callable", async () => {
    const { noopLogger } = await import("../src/node/index.js")
    expect(() => noopLogger.debug("ok")).not.toThrow()
  })

  test("main entrypoint exports browser tool manifest", async () => {
    const mod = await import("open-claude-in-chrome")
    expect(mod.CHROME_TOOL_NAMES).toContain("javascript_tool")
    expect(mod.CHROME_BROWSER_TOOLS.length).toBeGreaterThan(10)
  })
})
