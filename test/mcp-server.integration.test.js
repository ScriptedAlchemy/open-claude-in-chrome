import { afterEach, describe, expect, test } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { CHROME_TOOL_NAMES } from "../src/tools/manifest.js"

const clients = []
const tempHomes = []
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close().catch(() => {})))
  await Promise.all(
    tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })),
  )
})

describe("open-claude-in-chrome MCP server", () => {
  test("advertises package parity tools through tools/list", async () => {
    const home = await mkdtemp(join(tmpdir(), "open-claude-in-chrome-test-"))
    tempHomes.push(home)
    const configDir = join(home, ".config", "open-claude-in-chrome")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({ port: 24000 + Math.floor(Math.random() * 10000) }),
    )
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(packageRoot, "host", "mcp-server.js")],
      env: {
        ...process.env,
        HOME: home,
        OPENCLAUDE_CHROME_MCP_DEBUG: "0",
      },
    })
    const client = new Client(
      { name: "open-claude-in-chrome-test", version: "0.0.0" },
      { capabilities: {} },
    )
    clients.push(client)

    await client.connect(transport)
    const result = await client.listTools()
    const toolNames = result.tools.map(tool => tool.name)

    expect(new Set(toolNames)).toEqual(new Set(CHROME_TOOL_NAMES))
  })

  test("serves compatibility no-op tools without a browser extension connection", async () => {
    const home = await mkdtemp(join(tmpdir(), "open-claude-in-chrome-test-"))
    tempHomes.push(home)
    const configDir = join(home, ".config", "open-claude-in-chrome")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({ port: 24000 + Math.floor(Math.random() * 10000) }),
    )
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(packageRoot, "host", "mcp-server.js")],
      env: {
        ...process.env,
        HOME: home,
        OPENCLAUDE_CHROME_MCP_DEBUG: "0",
      },
    })
    const client = new Client(
      { name: "open-claude-in-chrome-test", version: "0.0.0" },
      { capabilities: {} },
    )
    clients.push(client)

    await client.connect(transport)
    const switchResult = await client.callTool({ name: "switch_browser", arguments: {} })
    const turnResult = await client.callTool({ name: "turn_answer_start", arguments: {} })

    expect(switchResult.content[0].text).toContain("already connected")
    expect(turnResult.content[0].text).toContain("Browser answer turn started")
  })
})
