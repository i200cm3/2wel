import { authFetch } from './auth'
import { DEFAULT_HELLO_TEMPLATE, fillGuestText } from '../content'

/** sha256 hex — работает и без crypto.subtle (HTTP по LAN IP). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const data = new TextEncoder().encode(text)
    const digest = await subtle.digest('SHA-256', data)
    return bytesToHex(new Uint8Array(digest))
  }
  return sha256HexSync(text)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Минимальный SHA-256 для non-secure context (http://192.168.x.x). */
function sha256HexSync(message: string): string {
  const msg = utf8Bytes(message)
  const bitLen = msg.length * 8
  const withOne = new Uint8Array(((msg.length + 9 + 63) & ~63))
  withOne.set(msg)
  withOne[msg.length] = 0x80
  const view = new DataView(withOne.buffer)
  view.setUint32(withOne.length - 4, bitLen >>> 0, false)
  // high 32 bits of length — always 0 for our short TTS strings
  view.setUint32(withOne.length - 8, Math.floor(bitLen / 0x100000000), false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  const w = new Int32Array(64)
  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false)
    for (let j = 16; j < 64; j++) {
      const v1 = w[j - 15]!
      const v2 = w[j - 2]!
      const s0 = rotr(v1, 7) ^ rotr(v1, 18) ^ (v1 >>> 3)
      const s1 = rotr(v2, 17) ^ rotr(v2, 19) ^ (v2 >>> 10)
      w[j] = (w[j - 16]! + s0 + w[j - 7]! + s1) | 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + k[j]! + w[j]!) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, h0 >>> 0, false)
  outView.setUint32(4, h1 >>> 0, false)
  outView.setUint32(8, h2 >>> 0, false)
  outView.setUint32(12, h3 >>> 0, false)
  outView.setUint32(16, h4 >>> 0, false)
  outView.setUint32(20, h5 >>> 0, false)
  outView.setUint32(24, h6 >>> 0, false)
  outView.setUint32(28, h7 >>> 0, false)
  return bytesToHex(out)
}

function rotr(n: number, x: number) {
  return (n >>> x) | (n << (32 - x))
}

function utf8Bytes(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i)
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return Uint8Array.from(out)
}

/** Собрать текст озвучки из заголовка блока и титра (как кнопка «из титра»). */
export function buildTtsTextFromCaption(opts: {
  caption?: string | null
  sequenceTitle?: string | null
  showTitle?: boolean
}): string {
  const caption = (opts.caption ?? '').trim()
  const title = opts.showTitle ? (opts.sequenceTitle ?? '').trim() : ''
  if (title && caption) return `${title}.${caption}`
  return title || caption
}

/** Есть ли в тексте озвучки плейсхолдер имени гостя или {hello}. */
export function ttsTextNeedsGuestName(ttsText: string | undefined | null): boolean {
  return (
    typeof ttsText === 'string' &&
    (/\{\s*name\s*\}|\[\s*name\s*\]/i.test(ttsText) || /\{\s*hello\s*\}/i.test(ttsText))
  )
}

/** Подставить {hello} (дефолт) и имя гостя в шаблон озвучки. */
export function speakTextForTts(ttsText: string, guestName: string): string {
  return fillGuestText(ttsText, guestName, DEFAULT_HELLO_TEMPLATE)
}

export type GenerateTtsResult = {
  src: string
  hash: string
  cached: boolean
  fileName: string
  files?: string[]
  durationSec?: number | null
  voiceId?: string
  modelId?: string
  version?: number
}

export async function generateTts(
  text: string,
  opts?: { force?: boolean; projectCode: string },
): Promise<GenerateTtsResult> {
  const projectCode = opts?.projectCode?.trim()
  if (!projectCode) {
    throw new Error('Нет кода проекта для озвучки')
  }
  const res = await authFetch(`/api/projects/${encodeURIComponent(projectCode)}/tts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, force: Boolean(opts?.force) }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    src?: string
    hash?: string
    cached?: boolean
    fileName?: string
    files?: string[]
    durationSec?: number | null
    voiceId?: string
    modelId?: string
    version?: number
    error?: string
    detail?: string
  }
  if (!res.ok || !data.src || !data.hash) {
    const msg = [data.error, data.detail, data.voiceId ? `voice=${data.voiceId}` : '']
      .filter(Boolean)
      .join(': ') || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return {
    src: data.src,
    hash: data.hash,
    cached: Boolean(data.cached),
    fileName: data.fileName || data.src.split('/').pop() || '',
    files: data.files,
    durationSec:
      typeof data.durationSec === 'number' && Number.isFinite(data.durationSec) && data.durationSec > 0
        ? data.durationSec
        : null,
    voiceId: data.voiceId,
    modelId: data.modelId,
    version: typeof data.version === 'number' ? data.version : Date.now(),
  }
}
