import { describe, expect, test } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const extensionRoot = join(packageRoot, "extension")
const manifest = JSON.parse(
  readFileSync(join(extensionRoot, "manifest.json"), "utf8"),
)

describe("extension product surface", () => {
  test("declares official-equivalent UI and extension capabilities", () => {
    expect(manifest.action.default_title).toBe("Open Claude")
    expect(manifest.options_page).toBe("options.html")
    expect(manifest.background).toEqual({
      service_worker: "background.js",
      type: "module",
    })
    expect(manifest.storage.managed_schema).toBe("managed_schema.json")
    expect(manifest.permissions).toEqual([
      "sidePanel",
      "tabs",
      "debugger",
      "activeTab",
      "scripting",
      "nativeMessaging",
      "tabGroups",
      "windows",
      "storage",
      "alarms",
      "notifications",
      "webNavigation",
      "offscreen",
      "unlimitedStorage",
      "downloads",
    ])
    expect(manifest.host_permissions).toEqual(["<all_urls>"])
    expect(manifest.permissions).not.toContain("identity")
    expect(manifest.permissions).not.toContain("declarativeNetRequestWithHostAccess")
    expect(manifest.commands["toggle-side-panel"]).toBeTruthy()
    expect(manifest.content_security_policy.extension_pages).toContain(
      "script-src 'self'",
    )
    expect(manifest.content_security_policy.extension_pages).not.toContain("unsafe-inline")
    expect(manifest.externally_connectable.matches).toContain("https://claude.ai/*")
  })

  test("ships manifest-referenced pages and content scripts", () => {
    const referencedFiles = new Set([
      manifest.background.service_worker,
      manifest.options_page,
      manifest.storage.managed_schema,
      "sidepanel.html",
      "sidepanel.js",
      "pairing.html",
      "pairing.js",
      "blocked.html",
      "offscreen.html",
      "offscreen.js",
      "gif_viewer.html",
      "gif_viewer.js",
      "managed-policy.js",
      "theme.js",
      "ui.css",
    ])

    for (const script of manifest.content_scripts) {
      for (const file of script.js) referencedFiles.add(file)
    }
    for (const resource of manifest.web_accessible_resources) {
      for (const file of resource.resources) referencedFiles.add(file)
    }

    for (const file of referencedFiles) {
      expect(existsSync(join(extensionRoot, file))).toBe(true)
    }
  })

  test("keeps managed policy OpenClaude-owned", () => {
    const managedSchema = JSON.parse(
      readFileSync(join(extensionRoot, manifest.storage.managed_schema), "utf8"),
    )
    expect(Object.keys(managedSchema.properties)).toEqual(["blockedUrlPatterns"])
  })

  test("uses only the OpenClaude native host runtime identity", () => {
    const background = readFileSync(join(extensionRoot, "background.js"), "utf8")
    expect(background).toContain('"com.openclaude.chrome"')
    expect(background).not.toContain("com.anthropic")
  })

  test("runs accessibility tree in all frames at document_start", () => {
    const contentScript = manifest.content_scripts.find(script =>
      script.js.includes("content.js"),
    )
    expect(contentScript.run_at).toBe("document_start")
    expect(contentScript.all_frames).toBe(true)
  })

  test("exposes native JavaScript dialog tools backed by CDP Page events", () => {
    const background = readFileSync(join(extensionRoot, "background.js"), "utf8")
    const tools = readFileSync(join(packageRoot, "src", "tools", "manifest.js"), "utf8")
    const mcpServer = readFileSync(join(packageRoot, "host", "mcp-server.js"), "utf8")

    for (const token of ["browser_dialogs", "browser_dialog"]) {
      expect(tools).toContain(`name: "${token}"`)
      expect(mcpServer).toContain(`"${token}"`)
    }

    for (const token of [
      "Page.javascriptDialogOpening",
      "Page.javascriptDialogClosed",
      "Page.handleJavaScriptDialog",
      "pendingDialogs",
    ]) {
      expect(background).toContain(token)
    }
  })

  test("ships Claude-style shared UI chrome", () => {
    const uiCss = readFileSync(join(extensionRoot, "ui.css"), "utf8")
    expect(uiCss).toContain("--bg-100: hsl(48 33.3% 97.1%)")
    expect(uiCss).toContain("--brand-100: hsl(15 54.2% 51.2%)")
    for (const page of ["sidepanel.html", "options.html", "pairing.html", "blocked.html"]) {
      const html = readFileSync(join(extensionRoot, page), "utf8")
      expect(html).toContain('data-theme="claude"')
      expect(html).toContain('href="ui.css"')
      expect(html).toContain('src="theme.js"')
    }
  })

  test("side panel exposes the browser companion product surface", () => {
    const html = readFileSync(join(extensionRoot, "sidepanel.html"), "utf8")
    const background = readFileSync(join(extensionRoot, "background.js"), "utf8")
    const script = readFileSync(join(extensionRoot, "sidepanel.js"), "utf8")
    const uiCss = readFileSync(join(extensionRoot, "ui.css"), "utf8")

    for (const token of [
      "Claude in Chrome",
      "Hi, I’m Claude. How can I help you today?",
      "Runtime connection",
      "Current tab",
      "Browser tools",
      "Diagnostics",
      "Summarize page",
      "Explain screenshot",
      "Message Claude about this page",
      'id="status-pill"',
      'id="copy-tab"',
      'id="copy-prompt"',
      'id="open-claude"',
    ]) {
      expect(html).toContain(token)
    }

    for (const selector of [
      ".capability-grid",
      ".status-pill",
      ".tab-card",
      ".conversation-card",
      ".assistant-greeting",
      ".permission-banner",
    ]) {
      expect(uiCss).toContain(selector)
    }

    for (const token of [
      "sidepanel.html?tabId=",
      "onMessageExternal",
      '"POPULATE_INPUT_TEXT"',
      '"SW_KEEPALIVE"',
      '"show_pairing_prompt"',
      '"pairing_response"',
      '"oauth_redirect"',
    ]) {
      expect(background).toContain(token)
    }

    for (const token of [
      "new URLSearchParams(location.search).get(\"tabId\")",
      '"POPULATE_INPUT_TEXT"',
      '"show_pairing_prompt"',
    ]) {
      expect(script).toContain(token)
    }
  })
})
