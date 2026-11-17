// `mock/lib/png.mjs` 의 브라우저판(Parse 그림 요소의 `base64_encoding` 용). 원본은 Node 의 `Buffer`·`zlib`
// 을 쓰므로 서비스 워커 번들에서는 이 파일로 바꿔 끼운다. 픽셀은 원본과 같고(같은 seed → 같은 그림),
// IDAT 만 압축하지 않은 deflate(stored block)로 담아 바이트가 조금 더 크다.
import { createRng } from "../../mock/lib/prng.mjs";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const STORED_BLOCK_MAX = 0xffff;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const uint32 = value => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

function chunk(type, data) {
  const body = [...type].map(char => char.charCodeAt(0)).concat([...data]);
  return [...uint32(data.length), ...body, ...uint32(crc32(body))];
}

/** zlib 스트림(압축 없음): 헤더 + stored block 들 + Adler-32. */
function zlibStored(raw) {
  const out = [0x78, 0x01];
  for (let offset = 0; offset < raw.length; offset += STORED_BLOCK_MAX) {
    const block = raw.subarray(offset, offset + STORED_BLOCK_MAX);
    const last = offset + STORED_BLOCK_MAX >= raw.length;
    const length = block.length;
    out.push(
      last ? 1 : 0,
      length & 0xff,
      length >>> 8,
      ~length & 0xff,
      (~length >>> 8) & 0xff,
      ...block,
    );
  }
  out.push(...uint32(adler32(raw)));
  return out;
}

/** `mock/lib/png.mjs` 의 `makePngBase64` 와 같은 그림. */
export function makePngBase64({ width = 32, height = 32, seed = 1 } = {}) {
  const rng = createRng(seed);
  const block = 8;
  const blocksX = Math.ceil(width / block);
  const blocksY = Math.ceil(height / block);
  const palette = [];
  for (let i = 0; i < blocksX * blocksY; i += 1) {
    palette.push([rng.int(40, 220), rng.int(40, 220), rng.int(40, 220)]);
  }
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const color =
        palette[Math.floor(y / block) * blocksX + Math.floor(x / block)];
      const offset = y * stride + 1 + x * 4;
      raw[offset] = color[0] + rng.int(0, 7);
      raw[offset + 1] = color[1] + rng.int(0, 7);
      raw[offset + 2] = color[2] + rng.int(0, 7);
      raw[offset + 3] = 255;
    }
  }
  const ihdr = [...uint32(width), ...uint32(height), 8, 6, 0, 0, 0];
  const bytes = [
    ...SIGNATURE,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", zlibStored(raw)),
    ...chunk("IEND", []),
  ];
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
