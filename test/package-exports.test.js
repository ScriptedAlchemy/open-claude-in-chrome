import { describe, expect, test } from "bun:test"

describe("open-claude-in-chrome package exports", () => {
  test("workspace package entrypoint loads", async () => {
    const mod = await import("open-claude-in-chrome")
    expect(typeof mod.resolveLogger).toBe("function")
  })

  test("source entrypoint loads", async () => {
    const mod = await import("../src/node/index.js")
    expect(typeof mod.resolveLogger).toBe("function")
  })

  test("logger default is callable", async () => {
    const { noopLogger } = await import("../src/node/index.js")
    expect(() => noopLogger.debug("ok")).not.toThrow()
  })
})
