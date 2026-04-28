export const MAX_NATIVE_MESSAGE_SIZE = 1024 * 1024

export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  if (payload.length > MAX_NATIVE_MESSAGE_SIZE) {
    throw new Error(
      `Native message exceeds maximum size of ${MAX_NATIVE_MESSAGE_SIZE} bytes`,
    )
  }
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

export function decodeNativeMessages(buffer) {
  const messages = []
  const errors = []
  let offset = 0

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    if (length > MAX_NATIVE_MESSAGE_SIZE) {
      errors.push(
        new Error(
          `Native message exceeds maximum size of ${MAX_NATIVE_MESSAGE_SIZE} bytes`,
        ),
      )
      return { messages, errors, remainder: Buffer.alloc(0) }
    }
    const end = offset + 4 + length
    if (end > buffer.length) break

    const raw = buffer.subarray(offset + 4, end).toString("utf8")
    try {
      messages.push(JSON.parse(raw))
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error
          : new Error(`Malformed native message: ${String(error)}`),
      )
    }
    offset = end
  }

  return { messages, errors, remainder: buffer.subarray(offset) }
}

export function encodeJsonLine(message) {
  return Buffer.from(`${JSON.stringify(message)}\n`, "utf8")
}

export function decodeJsonLines(buffer) {
  const messages = []
  let cursor = 0

  while (true) {
    const newline = buffer.indexOf(10, cursor)
    if (newline === -1) break

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

  return { messages, remainder: buffer.subarray(cursor) }
}
