// Regenerates the raster app icons from the one source of truth, src/app/icon.svg.
//
//   favicon.ico    16/32/48 PNG-in-ICO — the legacy path browsers and crawlers still request
//   apple-icon.png 180x180 — iOS home screen
//
// Run after editing icon.svg:  npm run icons
// Committed output is intentional (Next.js serves these as file-based metadata); this script
// exists so the binaries are reproducible rather than unexplainable.
import sharp from 'sharp'
import { readFileSync, writeFileSync, statSync } from 'node:fs'

const SVG_PATH = 'src/app/icon.svg'
const svg = readFileSync(SVG_PATH)

/** Pack PNG buffers into an ICO container (PNG-in-ICO, supported everywhere we care about). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + 16 * entries.length
  entries.forEach(({ size, data }, i) => {
    const b = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, b)     // width  (0 encodes 256)
    dir.writeUInt8(size >= 256 ? 0 : size, b + 1) // height
    dir.writeUInt8(0, b + 2)                      // palette colours (0 = none)
    dir.writeUInt8(0, b + 3)                      // reserved
    dir.writeUInt16LE(1, b + 4)                   // colour planes
    dir.writeUInt16LE(32, b + 6)                  // bits per pixel
    dir.writeUInt32LE(data.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += data.length
  })

  return Buffer.concat([header, dir, ...entries.map(e => e.data)])
}

const entries = []
for (const size of [16, 32, 48]) {
  entries.push({ size, data: await sharp(svg).resize(size, size).png().toBuffer() })
}
writeFileSync('src/app/favicon.ico', buildIco(entries))
await sharp(svg).resize(180, 180).png().toFile('src/app/apple-icon.png')

console.log(`✅ icons rebuilt from ${SVG_PATH}`)
console.log(`   favicon.ico     ${statSync('src/app/favicon.ico').size} bytes (16/32/48)`)
console.log(`   apple-icon.png  ${statSync('src/app/apple-icon.png').size} bytes (180x180)`)
