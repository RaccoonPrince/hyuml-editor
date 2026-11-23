import { describe, expect, it } from 'vitest';
import { contrastRatio, themeOf } from '../../core/theme';
import { colorsOn, COLORS, MIN_TITLE_CONTRAST } from './formatPalette';

describe('제목 글자색 팔레트 (D5)', () => {
  it.each([false, true])('머리 배경과 대비가 낮은 색(DKU 블루 등)은 제목 팔레트에서 빠진다 (다크=%s)', (dark) => {
    const bg = themeOf(dark).headerBg;
    const colors = colorsOn(bg);
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.find((c) => c.value.toLowerCase() === bg.toLowerCase())).toBeUndefined();
    for (const c of colors) expect(contrastRatio(c.value, bg)!).toBeGreaterThanOrEqual(MIN_TITLE_CONTRAST);
  });
  it('라이트 테마에서 DKU 블루는 빠지고, 배경을 모르면(멤버 글자) 기존 팔레트 그대로', () => {
    expect(colorsOn(themeOf(false).headerBg).map((c) => c.name)).not.toContain('DKU 블루');
    expect(colorsOn(undefined)).toEqual(COLORS);
  });
});
