const tabIdProperty = {
  type: "number",
  description:
    "Tab ID to operate on. Use tabs_context_mcp first if you do not have one.",
}

const coordinateProperty = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
}

export const CHROME_BROWSER_TOOLS = [
  {
    name: "javascript_tool",
    description: "Execute JavaScript in the current page context.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["javascript_exec"],
          description: "Must be javascript_exec.",
        },
        text: {
          type: "string",
          description: "JavaScript code to execute in the page context.",
        },
        code: {
          type: "string",
          description: "Alias for text; JavaScript code to execute.",
        },
        script: { type: "string", description: "Alias for text." },
        expression: { type: "string", description: "Alias for text." },
        javascript: { type: "string", description: "Alias for text." },
        tabId: tabIdProperty,
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "read_page",
    description: "Read accessible page structure from the current tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        filter: { type: "string", enum: ["interactive", "all"] },
        depth: { type: "number" },
        ref_id: { type: "string" },
        max_chars: { type: "number" },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "find",
    description: "Find page elements by natural-language query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        tabId: tabIdProperty,
      },
      required: ["query", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "form_input",
    description: "Fill form elements using browser element references.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }, { type: "number" }],
        },
        tabId: tabIdProperty,
      },
      required: ["ref", "value", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "computer",
    description: "Perform mouse, keyboard, scroll, and screenshot actions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "left_click",
            "right_click",
            "double_click",
            "triple_click",
            "type",
            "screenshot",
            "wait",
            "scroll",
            "key",
            "left_click_drag",
            "zoom",
            "scroll_to",
            "hover",
          ],
        },
        tabId: tabIdProperty,
        coordinate: coordinateProperty,
        start_coordinate: coordinateProperty,
        region: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
        },
        duration: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description:
            'Wait duration in seconds for action "wait" only. Use seconds, not milliseconds; maximum 30.',
        },
        modifiers: { type: "string" },
        ref: { type: "string" },
        repeat: { type: "number" },
        scroll_direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
        },
        scroll_amount: { type: "number" },
        text: { type: "string" },
      },
      required: ["action", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "navigate",
    description: "Navigate a browser tab to a URL or history target.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        tabId: tabIdProperty,
      },
      required: ["url", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "resize_window",
    description: "Resize the current browser window.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
        tabId: tabIdProperty,
      },
      required: ["width", "height", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "gif_creator",
    description: "Manage GIF recording and export for browser sessions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start_recording", "stop_recording", "export", "clear"],
        },
        tabId: tabIdProperty,
        download: { type: "boolean" },
        filename: { type: "string" },
        options: { type: "object", additionalProperties: true },
      },
      required: ["action", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "upload_image",
    description: "Upload a captured or provided image into the current page.",
    inputSchema: {
      type: "object",
      properties: {
        imageId: { type: "string" },
        tabId: tabIdProperty,
        ref: { type: "string" },
        coordinate: coordinateProperty,
        filename: { type: "string" },
      },
      required: ["imageId", "tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "get_page_text",
    description: "Extract raw text content from the current page.",
    inputSchema: {
      type: "object",
      properties: { tabId: tabIdProperty },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "tabs_context_mcp",
    description: "List tabs available in the current Claude in Chrome group.",
    inputSchema: {
      type: "object",
      properties: { createIfEmpty: { type: "boolean" } },
      additionalProperties: true,
    },
  },
  {
    name: "tabs_context",
    description: "Alias for tabs_context_mcp.",
    inputSchema: {
      type: "object",
      properties: { createIfEmpty: { type: "boolean" } },
      additionalProperties: true,
    },
  },
  {
    name: "tabs_create_mcp",
    description: "Create a new tab in the Claude in Chrome group.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
  {
    name: "tabs_create",
    description: "Alias for tabs_create_mcp.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
  {
    name: "tabs_close_mcp",
    description:
      "Close a tab in the current Claude in Chrome group by tab ID.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "The ID of the tab to close. Use tabs_context_mcp first to get valid tab IDs.",
        },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "browser_batch",
    description:
      "Execute multiple browser tool actions in order. Use this for predictable multi-step browser sequences.",
    inputSchema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              name: { type: "string" },
              input: { type: "object", additionalProperties: true },
            },
            required: ["input"],
            additionalProperties: true,
          },
        },
      },
      required: ["actions"],
      additionalProperties: true,
    },
  },
  {
    name: "file_upload",
    description:
      "Prepare a file upload target in the current page.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        ref: { type: "string" },
        coordinate: coordinateProperty,
        filename: { type: "string" },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "turn_answer_start",
    description:
      "Signal that a browser-answer turn has started. This is a compatibility no-op for OpenClaude.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
  {
    name: "switch_browser",
    description: "Switch which Chrome browser is used for browser automation.",
  },
  {
    name: "update_plan",
    description: "Present or update a browser-execution plan.",
    inputSchema: {
      type: "object",
      properties: {
        domains: { type: "array", items: { type: "string" } },
        approach: { type: "array", items: { type: "string" } },
      },
      required: ["domains", "approach"],
      additionalProperties: true,
    },
  },
  {
    name: "read_console_messages",
    description: "Read browser console output from a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        pattern: { type: "string" },
        limit: { type: "number" },
        onlyErrors: { type: "boolean" },
        clear: { type: "boolean" },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "read_network_requests",
    description: "Read HTTP network activity from a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        urlPattern: { type: "string" },
        limit: { type: "number" },
        clear: { type: "boolean" },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "browser_dialogs",
    description: "List native JavaScript dialogs (alert, confirm, prompt, beforeunload) currently blocking a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        clearClosed: { type: "boolean" },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "browser_dialog",
    description: "Accept or dismiss a native JavaScript dialog currently blocking a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        action: { type: "string", enum: ["accept", "dismiss"] },
        promptText: { type: "string" },
        dialogId: { type: "string" },
      },
      required: ["tabId", "action"],
      additionalProperties: true,
    },
  },
  {
    name: "shortcuts_list",
    description: "List available browser shortcuts and workflows.",
    inputSchema: {
      type: "object",
      properties: { tabId: tabIdProperty },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
  {
    name: "shortcuts_execute",
    description: "Execute a saved browser shortcut or workflow.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdProperty,
        shortcutId: { type: "string" },
        command: { type: "string" },
      },
      required: ["tabId"],
      additionalProperties: true,
    },
  },
]

export const CHROME_TOOL_NAMES = CHROME_BROWSER_TOOLS.map(tool => tool.name)
