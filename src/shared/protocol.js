export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

export function decodeNativeMessages(buffer) {
  const messages = []
  let offset = 0

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const end = offset + 4 + length
    if (end > buffer.length) break

    const raw = buffer.subarray(offset + 4, end).toString("utf8")
    try {
      messages.push(JSON.parse(raw))
    } catch {
      // Ignore malformed messages and keep parsing the stream.
    }
    offset = end
  }

  return { messages, remainder: buffer.subarray(offset) }
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
