export const MAX_NATIVE_MESSAGE_SIZE = 1024 * 1024
export const MAX_JSON_LINE_SIZE = 8 * 1024 * 1024
const OVERSIZED_NATIVE_MESSAGE_ERROR = `Native message exceeds maximum size of ${MAX_NATIVE_MESSAGE_SIZE} bytes`
const OVERSIZED_JSON_LINE_ERROR = `JSON line exceeds maximum size of ${MAX_JSON_LINE_SIZE} bytes`
const MALFORMED_NATIVE_MESSAGE_ERROR = "Malformed native message"

export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  if (payload.length > MAX_NATIVE_MESSAGE_SIZE) {
    throw new Error(OVERSIZED_NATIVE_MESSAGE_ERROR)
  }
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

export function decodeNativeMessages(buffer) {
  const messages = []
  let offset = 0

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    if (length > MAX_NATIVE_MESSAGE_SIZE) {
      return {
        messages,
        error: new Error(OVERSIZED_NATIVE_MESSAGE_ERROR),
        remainder: Buffer.alloc(0),
      }
    }
    const end = offset + 4 + length
    if (end > buffer.length) break

    const raw = buffer.subarray(offset + 4, end).toString("utf8")
    try {
      messages.push(JSON.parse(raw))
    } catch (error) {
      return {
        messages,
        error: new Error(MALFORMED_NATIVE_MESSAGE_ERROR),
        remainder: Buffer.alloc(0),
      }
    }
    offset = end
  }

  return { messages, error: undefined, remainder: buffer.subarray(offset) }
}

export function encodeJsonLine(message) {
  const payload = Buffer.from(`${JSON.stringify(message)}\n`, "utf8")
  // Match decodeJsonLines(): the cap applies to the JSON payload before the newline.
  if (payload.length - 1 > MAX_JSON_LINE_SIZE) {
    throw new Error(OVERSIZED_JSON_LINE_ERROR)
  }
  return payload
}

export function decodeJsonLines(buffer) {
  const messages = []
  let cursor = 0

  while (true) {
    const newline = buffer.indexOf(10, cursor)
    if (newline === -1) {
      if (buffer.length - cursor > MAX_JSON_LINE_SIZE) {
        return {
          messages,
          error: new Error(OVERSIZED_JSON_LINE_ERROR),
          remainder: Buffer.alloc(0),
        }
      }
      break
    }

    if (newline - cursor > MAX_JSON_LINE_SIZE) {
      return {
        messages,
        error: new Error(OVERSIZED_JSON_LINE_ERROR),
        remainder: Buffer.alloc(0),
      }
    }

    const line = buffer.subarray(cursor, newline).toString("utf8").trim()
    if (line) {
      try {
        messages.push(JSON.parse(line))
      } catch {
        // Ignore malformed lines from the peer.
      }
    }
    cursor = newline + 1
  }

  return { messages, error: undefined, remainder: buffer.subarray(cursor) }
}
