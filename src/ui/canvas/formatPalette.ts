import { contrastRatio } from '../../core/theme';

export const COLORS = [
  { name: '검정', value: '#000000' },
  { name: 'DKU 블루', value: '#005eb8' },
  { name: '빨강', value: '#d32f2f' },
  { name: '초록', value: '#2e7d32' },
  { name: '주황', value: '#ef6c00' },
];

/** 어두운 배경(상자 머리) 위 제목에서만 쓰는 밝은 색 */
const LIGHT_COLORS = [
  { name: '흰색', value: '#ffffff' },
  { name: '노랑', value: '#ffd54f' },
];

/** 제목 글자색은 머리 배경과 대비가 이 값 미만이면 팔레트에서 뺀다 (제목이 사라지는 것 방지) */
export const MIN_TITLE_CONTRAST = 3;

/** 글자가 놓이는 배경(`textOn`)과 대비가 충분한 색만 남긴다. 배경을 모르면(멤버 글자 등) 기존 팔레트 그대로 */
export function colorsOn(textOn?: string) {
  if (!textOn) return COLORS;
  return [...COLORS, ...LIGHT_COLORS].filter((swatch) => (contrastRatio(swatch.value, textOn) ?? Infinity) >= MIN_TITLE_CONTRAST);
}
