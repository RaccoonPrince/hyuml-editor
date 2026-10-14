/**
 * 이미지 파일에 해상도(DPI) 정보를 기록한다 (명세 NFR-06: 300dpi).
 * 캔버스가 만든 PNG/JPEG 에는 DPI 정보가 없어 Word·LaTeX 가 96dpi 로 간주 → 3배 크게 들어간다.
 */

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const readU32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const writeU32 = (bytes: Uint8Array, at: number, value: number) => {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
};

/** PNG: IHDR 바로 뒤에 pHYs 청크(미터당 픽셀 수)를 넣는다. 기존 pHYs 는 교체 */
export function withPngDpi(input: Uint8Array, dpi: number): Uint8Array {
  if (!PNG_SIGNATURE.every((byte, index) => input[index] === byte)) return input;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  writeU32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  writeU32(chunk, 8, ppm);
  writeU32(chunk, 12, ppm);
  chunk[16] = 1; // 단위: 미터
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)));

  const parts: Uint8Array[] = [input.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= input.length) {
    const length = readU32(input, offset);
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (type !== 'pHYs') parts.push(input.subarray(offset, end));
    if (type === 'IHDR' && !inserted) {
      parts.push(chunk);
      inserted = true;
    }
    offset = end;
    if (type === 'IEND') break;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

/** JPEG: JFIF APP0 의 밀도 단위를 DPI 로 설정 (없으면 JFIF 세그먼트를 추가) */
export function withJpegDpi(input: Uint8Array, dpi: number): Uint8Array {
  if (input[0] !== 0xff || input[1] !== 0xd8) return input;
  const isJfif = input[2] === 0xff && input[3] === 0xe0 && String.fromCharCode(...input.subarray(6, 11)) === 'JFIF\0';
  if (isJfif) {
    const output = input.slice();
    output[13] = 1; // 단위: 인치당 점
    output[14] = (dpi >> 8) & 0xff;
    output[15] = dpi & 0xff;
    output[16] = (dpi >> 8) & 0xff;
    output[17] = dpi & 0xff;
    return output;
  }
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    (dpi >> 8) & 0xff, dpi & 0xff, (dpi >> 8) & 0xff, dpi & 0xff, 0x00, 0x00,
  ]);
  const output = new Uint8Array(input.length + app0.length);
  output.set(input.subarray(0, 2), 0);
  output.set(app0, 2);
  output.set(input.subarray(2), 2 + app0.length);
  return output;
}

export const dataUrlToBytes = async (dataUrl: string) => new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
