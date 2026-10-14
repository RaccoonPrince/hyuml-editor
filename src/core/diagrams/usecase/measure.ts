import { styleKeys } from '../../document/keys';
import type { LayoutState } from '../../document/schema';
import { lineHeightPx, ptToPx, textWidth } from '../../layout/measure';
import { TYPO } from '../../theme';
import type { UsecaseNode } from './model';

export interface UsecaseMeasureContext {
  fontSizePt: number;
  textStyles: LayoutState['textStyles'];
}

/** 유스케이스 도형 치수 토큰 — UsecaseNode 컴포넌트와 공유 */
export const UC = {
  actorFigureH: 46,
  actorMinW: 70,
  ellipsePadX: 26,
  ellipsePadY: 14,
  rectPadX: 14,
  rectPadY: 10,
  minW: 110,
  minH: 46,
} as const;

export const usecaseFontPt = (id: string, ctx: UsecaseMeasureContext) =>
  ctx.textStyles[styleKeys.title(id)]?.fontSize ?? ctx.fontSizePt + 1;

export function measureUsecaseNode(node: UsecaseNode, ctx: UsecaseMeasureContext): { w: number; h: number } {
  const fontPx = ptToPx(usecaseFontPt(node.id, ctx));
  const lines = node.label.split(/<br\s*\/?>/i);
  const textW = Math.max(...lines.map((line) => textWidth(line, fontPx, node.type === 'actor')));
  const textH = lines.length * lineHeightPx(fontPx) + (node.stereotype ? lineHeightPx(fontPx * 0.85) : 0);
  if (node.type === 'actor') {
    return { w: Math.ceil(Math.max(UC.actorMinW, textW + 12)), h: Math.ceil(UC.actorFigureH + textH + 6) };
  }
  if (node.shape === 'rect') {
    return {
      w: Math.ceil(Math.max(UC.minW, textW + UC.rectPadX * 2 + TYPO.border * 2)),
      h: Math.ceil(Math.max(UC.minH, textH + UC.rectPadY * 2 + TYPO.border * 2)),
    };
  }
  // 타원은 내접 사각형이 글자를 담아야 하므로 폭·높이를 √2 배 가까이 키운다
  return {
    w: Math.ceil(Math.max(UC.minW, textW * 1.3 + UC.ellipsePadX * 2)),
    h: Math.ceil(Math.max(UC.minH, textH * 1.3 + UC.ellipsePadY * 2)),
  };
}
