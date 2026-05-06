/**
 * Generate raster + ICNS-friendly icon variants from resources/icon.svg.
 *
 * Outputs:
 *   resources/icon.png         1024×1024 (used by electron-builder + dock)
 *   resources/icon@512.png     512×512   (used by BrowserWindow.icon in dev)
 *
 * Usage:  pnpm icons   (or: node scripts/generate-icons.cjs)
 *
 * Re-run after editing resources/icon.svg. Generated files are committed —
 * end users running `pnpm install` should not need to invoke this.
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'resources', 'icon.svg')

async function main() {
  const svg = await fs.readFile(SRC)
  for (const size of [1024, 512, 256]) {
    const out = path.join(ROOT, 'resources', size === 1024 ? 'icon.png' : `icon@${size}.png`)
    await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out)
    console.log(`wrote ${path.relative(ROOT, out)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
