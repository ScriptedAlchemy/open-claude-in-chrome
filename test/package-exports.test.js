import { describe, expect, test } from "bun:test"

describe("open-claude-in-chrome package exports", () => {
  test("main entrypoint loads", async () => {
    const mod = await import("../src/node/index.js")
    expect(typeof mod.resolveLogger).toBe("function")
  })

  test("logger default is callable", async () => {
    const { noopLogger } = await import("../src/node/index.js")
    expect(() => noopLogger.debug("ok")).not.toThrow()
  })
})
