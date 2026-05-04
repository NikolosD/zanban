/**
 * Sanity-check that the sqlite-vec native extension is reachable for the
 * current platform. Runs as part of postinstall — fails loudly so a broken
 * release doesn't ship silently.
 *
 * Why this exists: sqlite-vec uses optionalDependencies for per-platform
 * binaries (sqlite-vec-windows-x64 / -darwin-arm64 / etc). Package managers
 * sometimes skip these (network flakes, --no-optional, mismatched cpu/os
 * filters in pnpm). Better to find out at install time than at runtime.
 */
// Resolve through sqlite-vec's own loader so we follow the same lookup
// chain Electron will use at runtime (which traverses pnpm's nested
// node_modules/.pnpm symlink farm).
let getLoadablePath
try {
  ;({ getLoadablePath } = require('sqlite-vec'))
} catch (e) {
  console.error('[ensure-sqlite-vec] sqlite-vec module not installed:', e.message)
  process.exit(1)
}

try {
  const p = getLoadablePath()
  console.log(`[ensure-sqlite-vec] OK ${process.platform}-${process.arch} -> ${p}`)
} catch (e) {
  console.error(`[ensure-sqlite-vec] failed for ${process.platform}-${process.arch}:`, e.message)
  console.error('[ensure-sqlite-vec] make sure the platform-specific sqlite-vec package is installed (it ships as an optionalDependency)')
  process.exit(1)
}
