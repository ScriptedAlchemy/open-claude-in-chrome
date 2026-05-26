#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoMcpServer = path.join(packageDir, "host", "mcp-server.js");
const defaultConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
const usingDefaultUserConfig = !process.env.OPENCODE_CONFIG;
const configPath = path.resolve(
  process.env.OPENCODE_CONFIG
    ? process.env.OPENCODE_CONFIG.replace(/^~(?=$|\/)/, os.homedir())
    : defaultConfigPath,
);

const serverName = process.env.OPENCODE_OPENCLAUDE_CHROME_MCP_NAME || "open-claude-in-chrome";

if (!fs.existsSync(repoMcpServer)) {
  throw new Error(`Open Claude in Chrome MCP server not found: ${repoMcpServer}`);
}

let config = {
  $schema: "https://opencode.ai/config.json",
};

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse existing OpenCode config at ${configPath}: ${error.message}. ` +
        "Fix or move the file, then rerun this installer.",
    );
  }
}

config.$schema ??= "https://opencode.ai/config.json";
config.mcp ??= {};

config.mcp[serverName] = {
  type: "local",
  command: ["node", repoMcpServer],
  enabled: true,
  timeout: 60000,
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const configScope = usingDefaultUserConfig ? "user-level OpenCode config" : "custom OpenCode config";
console.log(`Installed Open Claude in Chrome MCP '${serverName}' in ${configScope}: ${configPath}`);
console.log(`Command: node ${repoMcpServer}`);
