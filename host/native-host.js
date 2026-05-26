#!/usr/bin/env node

// Native Messaging Host for Open Claude in Chrome extension.
// Launched by Chrome when the extension calls connectNative().
// Bridges between Chrome native messaging (stdin/stdout, 4-byte LE length prefix + JSON)
// and the MCP server (TCP on localhost).

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  decodeJsonLines,
  decodeNativeMessages,
  encodeJsonLine,
  encodeNativeMessage,
} from "../src/shared/protocol.js";

const DEFAULT_PORT = 18765;

function getPort() {
  const configPath = path.join(
    os.homedir(),
    ".config",
    "open-claude-in-chrome",
    "config.json"
  );
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.port || DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

// --- TCP connection to MCP server ---

let tcpSocket = null;
let tcpBuffer = Buffer.alloc(0);
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 60; // 30 seconds at 500ms intervals
const TCP_PORT = getPort();

function connectTcp() {
  if (tcpSocket) return;

  tcpSocket = new net.Socket();

  tcpSocket.connect(TCP_PORT, "127.0.0.1", () => {
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  });

  tcpSocket.on("data", (chunk) => {
    // newline-delimited JSON from MCP server
    tcpBuffer = Buffer.concat([tcpBuffer, chunk]);
    const { messages, error, remainder } = decodeJsonLines(tcpBuffer);
    tcpBuffer = remainder;
    if (error) {
      tcpSocket.destroy(error);
      return;
    }
    for (const msg of messages) {
      try {
        process.stdout.write(encodeNativeMessage(msg));
      } catch {
        // Skip oversized messages from the peer.
      }
    }
  });

  tcpSocket.on("error", () => {
    tcpSocket = null;
  });

  tcpSocket.on("close", () => {
    tcpSocket = null;
    if (!reconnectTimer) {
      reconnectTimer = setInterval(() => {
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          // MCP server is gone — exit cleanly so we don't linger as a zombie
          clearInterval(reconnectTimer);
          process.exit(0);
        }
        if (!tcpSocket) connectTcp();
      }, 500);
    }
  });
}

// --- Main: bridge stdin (from extension) <-> TCP (to MCP server) ---

let stdinBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  const { messages, error, remainder } = decodeNativeMessages(stdinBuffer);
  stdinBuffer = remainder;
  if (error) {
    process.exit(1);
  }

  for (const msg of messages) {
    // Forward to MCP server via TCP
    if (tcpSocket && !tcpSocket.destroyed) {
      try {
        tcpSocket.write(encodeJsonLine(msg));
      } catch {
        tcpSocket.destroy();
      }
    }
  }
});

process.stdin.on("end", () => {
  // Extension disconnected
  if (tcpSocket) tcpSocket.destroy();
  process.exit(0);
});

// Start TCP connection
connectTcp();
