// 외부 의존성 없이 작은 RGBA PNG 를 만든다(Parse 그림 요소의 `base64_encoding` 용).
// IHDR·IDAT·IEND 세 chunk 만 쓰고 CRC32 는 직접 계산한다.
import { deflateSync } from "node:zlib";

import { createRng } from "./prng.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * `width`×`height` RGBA PNG 의 base64(raw base64, data URL 아님). 8×8 색 블록에 약한 잡음을
 * 섞어 32×32 에서 약 2 KB 가 되게 한다. 같은 seed 면 같은 그림.
 */
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
  const raw = Buffer.alloc(stride * height);
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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
