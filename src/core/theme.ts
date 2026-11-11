/**
 * 디자인 토큰. 노드 크기 측정(measure.ts)과 렌더러(UmlClassNode)가 반드시 같은 값을 쓴다.
 * 여기 값을 바꾸면 측정과 렌더가 함께 바뀌므로 "추정 높이 ≠ 실제 높이" 문제가 생기지 않는다.
 */
export const TYPO = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
  /** canvas.fontSizePt(pt) 가 멤버 기본 글꼴, 제목은 +2pt */
  titleDeltaPt: 2,
  lineHeight: 1.3,
  titlePadY: 8,
  titlePadX: 10,
  compartmentPadY: 6,
  compartmentPadX: 8,
  memberGap: 4,
  border: 2,
  divider: 1,
  minWidth: 150,
  maxAutoWidth: 360,
  /** 빈 칸 표시 모드에서 빈 구획의 최소 높이 */
  emptyCompartment: 12,
  /** 간선 라벨 기본 글꼴은 canvas.fontSizePt 를 따른다. 다중성 라벨은 1pt 작게 */
  endpointDeltaPt: -1,
  edgeLabelPadX: 5,
  edgeLabelPadY: 1,
  /** 마우스를 올렸을 때 테두리·간선을 이만큼(px) 더 굵게 — 레이아웃 크기는 바꾸지 않는다 */
  hoverExtra: 1.5,
} as const;

/** 마우스 오버 강조: 테두리 바깥에 링을 그려 굵어 보이게 한다 (border 를 바꾸면 내용이 밀린다) */
export const hoverRing = (color: string) => `0 0 0 ${TYPO.hoverExtra}px ${color}`;

/** 시퀀스 다이어그램 전용 토큰 — sequence/layout.ts 와 렌더러가 함께 쓴다 */
export const SEQ = {
  top: 40,
  headPadX: 14,
  headPadY: 8,
  minHeadW: 90,
  minHeadH: 38,
  /** actor 막대 인형 높이 */
  actorFigure: 34,
  /** 새 참여자 사이 기본 간격 */
  gap: 50,
  /** 참여자 사이 최소 간격 (겹침 해소 기준) */
  minGap: 20,
  firstRowGap: 24,
  rowGap: 16,
  textGap: 4,
  selfLoopW: 36,
  selfLoopH: 24,
  noteMinW: 90,
  notePad: 8,
  noteSideGap: 12,
  fragHeader: 24,
  fragPad: 14,
  activationW: 12,
  footerGap: 28,
  arrowSize: 9,
} as const;

export interface ThemeColors {
  canvasBg: string;
  gridDots: string;
  nodeBg: string;
  nodeBorder: string;
  headerBg: string;
  headerText: string;
  memberText: string;
  divider: string;
  edgeStroke: string;
  edgeLabelText: string;
  labelBg: string;
  watermark: string;
  participantBg: string;
  participantText: string;
  lifeline: string;
  activationBg: string;
  noteBg: string;
  noteBorder: string;
  noteText: string;
  fragmentStroke: string;
  fragmentLabelBg: string;
  fragmentText: string;
}

export const THEMES: Record<'light' | 'dark', ThemeColors> = {
  light: {
    canvasBg: '#ffffff',
    gridDots: '#d1d5db',
    nodeBg: '#ffffff',
    nodeBorder: '#333333',
    headerBg: '#005eb8',
    headerText: '#ffffff',
    memberText: '#333333',
    divider: '#cccccc',
    edgeStroke: '#374151',
    edgeLabelText: '#374151',
    labelBg: '#ffffff',
    watermark: '#004b87',
    participantBg: '#e8f1fb',
    participantText: '#0f2a44',
    lifeline: '#9ca3af',
    activationBg: '#f3f4f6',
    noteBg: '#fff8c4',
    noteBorder: '#c9b458',
    noteText: '#333333',
    fragmentStroke: '#6b7280',
    fragmentLabelBg: '#e5e7eb',
    fragmentText: '#1f2937',
  },
  dark: {
    canvasBg: '#121212',
    gridDots: '#2d333b',
    nodeBg: '#1e1e1e',
    nodeBorder: '#66b3e8',
    headerBg: '#174a78',
    headerText: '#ffffff',
    memberText: '#f3f4f6',
    divider: '#4b5563',
    edgeStroke: '#cbd5e1',
    edgeLabelText: '#e5e7eb',
    labelBg: '#121212',
    watermark: '#66b3e8',
    participantBg: '#1e3a5f',
    participantText: '#f3f4f6',
    lifeline: '#6b7280',
    activationBg: '#374151',
    noteBg: '#4a4420',
    noteBorder: '#a89a4a',
    noteText: '#f5f0d0',
    fragmentStroke: '#9ca3af',
    fragmentLabelBg: '#374151',
    fragmentText: '#e5e7eb',
  },
};

export const themeOf = (isDark: boolean): ThemeColors => (isDark ? THEMES.dark : THEMES.light);

/**
 * 사용자가 지정한 배경색 위에서 읽기 쉬운 글자색.
 * 글자색을 따로 지정하지 않았을 때만 쓴다 (다크 모드 + 밝은 배경 → 밝은 글자가 묻히는 문제 방지).
 */
export function contrastTextOn(fill: string | undefined): string | undefined {
  const hex = fill?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return luminance > 0.4 ? '#1f2937' : '#f9fafb';
}
