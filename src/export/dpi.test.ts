import { describe, expect, it } from 'vitest';
import { withJpegDpi, withPngDpi } from './dpi';

/** 최소 PNG: 시그니처 + IHDR(13) + IEND */
function tinyPng(): Uint8Array {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => {
    const length = data.length;
    bytes.push((length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
  };
  chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  chunk('IEND', []);
  return new Uint8Array(bytes);
}

describe('내보내기 DPI 메타데이터 (명세 NFR-06: 300dpi)', () => {
  it('PNG: IHDR 뒤에 pHYs(11811 px/m, 단위=미터) 청크와 올바른 CRC 를 넣는다', () => {
    const out = withPngDpi(tinyPng(), 300);
    const at = 8 + 25; // 시그니처 + IHDR 청크
    expect(String.fromCharCode(...out.subarray(at + 4, at + 8))).toBe('pHYs');
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint32(at)).toBe(9);
    expect(view.getUint32(at + 8)).toBe(11811);
    expect(view.getUint32(at + 12)).toBe(11811);
    expect(out[at + 16]).toBe(1);
    // CRC32("pHYs" + data) — zlib 과 같은 알고리즘으로 계산한 기대값
    expect(view.getUint32(at + 17)).toBe(0x78a53f76);
    // 두 번 적용해도 pHYs 는 하나
    const twice = withPngDpi(out, 300);
    expect(twice.length).toBe(out.length);
  });

  it('JPEG: JFIF 밀도 단위를 인치(1)로, 밀도를 300 으로 설정한다', () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
    const out = withJpegDpi(jfif, 300);
    expect([out[13], (out[14]! << 8) | out[15]!, (out[16]! << 8) | out[17]!]).toEqual([1, 300, 300]);
    // JFIF 가 없으면 APP0 세그먼트를 새로 넣는다
    const bare = withJpegDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 300);
    expect(String.fromCharCode(...bare.subarray(6, 10))).toBe('JFIF');
  });
});
