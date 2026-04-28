import { describe, expect, test } from "bun:test"
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
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        "sidePanel",
        "offscreen",
        "notifications",
        "webNavigation",
        "nativeMessaging",
        "unlimitedStorage",
        "downloads",
      ]),
    )
    expect(manifest.permissions).not.toContain("identity")
    expect(manifest.permissions).not.toContain("declarativeNetRequestWithHostAccess")
    expect(manifest.commands["toggle-side-panel"]).toBeTruthy()
    expect(manifest.content_security_policy.extension_pages).toContain(
      "script-src 'self'",
    )
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
      "blocked.html",
      "offscreen.html",
      "offscreen.js",
      "gif_viewer.html",
      "gif_viewer.js",
      "managed-policy.js",
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

  test("uses OpenClaude native host as the primary runtime identity", () => {
    const background = readFileSync(join(extensionRoot, "background.js"), "utf8")
    expect(background).toContain('"com.openclaude.chrome"')
    expect(background.indexOf('"com.openclaude.chrome"')).toBeLessThan(
      background.indexOf('"com.anthropic.open_claude_in_chrome"'),
    )
  })

  test("runs accessibility tree in all frames at document_start", () => {
    const contentScript = manifest.content_scripts.find(script =>
      script.js.includes("content.js"),
    )
    expect(contentScript.run_at).toBe("document_start")
    expect(contentScript.all_frames).toBe(true)
  })
})
