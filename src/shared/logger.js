export const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

export function resolveLogger(logger) {
  return logger ?? noopLogger
}
