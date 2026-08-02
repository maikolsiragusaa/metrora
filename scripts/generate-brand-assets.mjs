import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COLORS = {
  graphite: [15, 17, 21, 255],
  paper: [250, 247, 242, 255],
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function insideRoundedSquare(x, y, size, radius) {
  const left = radius
  const right = size - radius - 1
  const top = radius
  const bottom = size - radius - 1
  if (x >= left && x <= right) return true
  if (y >= top && y <= bottom) return true
  const cx = x < left ? left : right
  const cy = y < top ? top : bottom
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function fillRect(pixels, size, x, y, width, height, color) {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(size, Math.ceil(x + width))
  const y1 = Math.min(size, Math.ceil(y + height))
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const offset = (py * size + px) * 4
      pixels.set(color, offset)
    }
  }
}

function createIcon(size = 1024) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = Math.round(size * 0.2266)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRoundedSquare(x, y, size, radius)) continue
      pixels.set(COLORS.graphite, (y * size + x) * 4)
    }
  }

  const scale = size / 256
  const bars = [
    [57, 68, 12, 94],
    [83, 94, 12, 80],
    [109, 118, 12, 68],
    [135, 118, 12, 68],
    [161, 94, 12, 80],
    [187, 68, 12, 94],
  ]
  for (const [x, y, width, height] of bars) {
    fillRect(pixels, size, x * scale, y * scale, width * scale, height * scale, COLORS.paper)
  }

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1)
    raw[rowOffset] = 0
    pixels.copy(raw, rowOffset + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const icon = createIcon(1024)
const outputs = [
  resolve(ROOT, 'app/build/icon.png'),
  resolve(ROOT, 'assets/menubar-logo.png'),
]

for (const output of outputs) {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, icon)
  console.log(`Generated ${output.replace(`${ROOT}/`, '')}`)
}
