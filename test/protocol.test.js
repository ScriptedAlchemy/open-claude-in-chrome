import { describe, expect, test } from "bun:test"
import {
  decodeJsonLines,
  decodeNativeMessages,
  encodeJsonLine,
  encodeNativeMessage,
  MAX_NATIVE_MESSAGE_SIZE,
} from "../src/shared/protocol.js"

describe("native messaging protocol", () => {
  test("encodes and decodes one length-prefixed message", () => {
    const encoded = encodeNativeMessage({ type: "ping" })
    const { messages, remainder } = decodeNativeMessages(encoded)

    expect(messages).toEqual([{ type: "ping" }])
    expect(remainder.length).toBe(0)
  })

  test("decodes multiple length-prefixed messages", () => {
    const encoded = Buffer.concat([
      encodeNativeMessage({ type: "ping" }),
      encodeNativeMessage({ type: "status", connected: true }),
    ])
    const { messages, remainder } = decodeNativeMessages(encoded)

    expect(messages).toEqual([
      { type: "ping" },
      { type: "status", connected: true },
    ])
    expect(remainder.length).toBe(0)
  })

  test("leaves partial native message as remainder", () => {
    const encoded = encodeNativeMessage({ type: "ping" })
    const partial = encoded.subarray(0, encoded.length - 2)
    const { messages, remainder } = decodeNativeMessages(partial)

    expect(messages).toEqual([])
    expect(remainder).toEqual(partial)
  })

  test("reports malformed native JSON deterministically", () => {
    const payload = Buffer.from("{", "utf8")
    const header = Buffer.alloc(4)
    header.writeUInt32LE(payload.length, 0)
    const { errors, messages, remainder } = decodeNativeMessages(
      Buffer.concat([header, payload]),
    )

    expect(messages).toEqual([])
    expect(errors.length).toBe(1)
    expect(remainder.length).toBe(0)
  })

  test("rejects oversized native frames", () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(MAX_NATIVE_MESSAGE_SIZE + 1, 0)
    const { errors, messages, remainder } = decodeNativeMessages(header)

    expect(messages).toEqual([])
    expect(errors[0].message).toContain("exceeds maximum size")
    expect(remainder.length).toBe(0)
  })
})

describe("newline-delimited JSON protocol", () => {
  test("encodes and decodes complete JSON lines", () => {
    const encoded = Buffer.concat([
      encodeJsonLine({ id: "1", type: "tool_request" }),
      Buffer.from("{"),
    ])
    const { messages, remainder } = decodeJsonLines(encoded)

    expect(messages).toEqual([{ id: "1", type: "tool_request" }])
    expect(remainder.toString("utf8")).toBe("{")
  })

  test("decodes multiple JSON lines", () => {
    const encoded = Buffer.concat([
      encodeJsonLine({ id: "1", ok: true }),
      encodeJsonLine({ id: "2", ok: false }),
    ])
    const { messages, remainder } = decodeJsonLines(encoded)

    expect(messages).toEqual([
      { id: "1", ok: true },
      { id: "2", ok: false },
    ])
    expect(remainder.length).toBe(0)
  })
})
