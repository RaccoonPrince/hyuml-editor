import type { ClassNodeModel } from '../diagrams/class/model';
import { styleKeys } from '../document/keys';
import type { LayoutState } from '../document/schema';
import { TYPO } from '../theme';

let context: CanvasRenderingContext2D | null | undefined;

function measureContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  try {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  return context;
}

/** 브라우저에서는 canvas 로 정확히, 테스트(Node)에서는 근사치로 측정 */
export function textWidth(text: string, fontPx: number, bold = false): number {
  const ctx = measureContext();
  if (!ctx) return text.length * fontPx * (bold ? 0.62 : 0.56);
  ctx.font = `${bold ? '700 ' : ''}${fontPx}px ${TYPO.fontFamily}`;
  return ctx.measureText(text).width;
}

export const lineHeightPx = (fontPx: number) => Math.ceil(fontPx * TYPO.lineHeight);

/** 저장값은 pt(명세 FR-08: 8~24pt), 화면은 CSS px (1pt = 96/72 px) */
export const ptToPx = (pt: number) => (pt * 96) / 72;

export interface MeasureContext {
  fontSizePt: number;
  hideEmpty: boolean;
  textStyles: LayoutState['textStyles'];
}

export const titleFontPt = (nodeId: string, ctx: MeasureContext) =>
  ctx.textStyles[styleKeys.title(nodeId)]?.fontSize ?? ctx.fontSizePt + TYPO.titleDeltaPt;
export const titleFontPx = (nodeId: string, ctx: MeasureContext) => ptToPx(titleFontPt(nodeId, ctx));

export const memberFontPt = (nodeId: string, memberKey: string, ctx: MeasureContext) =>
  ctx.textStyles[styleKeys.member(nodeId, memberKey)]?.fontSize ?? ctx.fontSizePt;
export const memberFontPx = (nodeId: string, memberKey: string, ctx: MeasureContext) => ptToPx(memberFontPt(nodeId, memberKey, ctx));

/**
 * UmlClassNode 의 실제 박스 모델과 1:1 대응하는 크기 계산.
 * 렌더러도 같은 TYPO 토큰을 쓰므로 측정값과 DOM 높이가 일치한다.
 */
export function measureClassNode(node: ClassNodeModel, ctx: MeasureContext): { w: number; h: number } {
  const titlePx = titleFontPx(node.id, ctx);
  let maxWidth = textWidth(node.label, titlePx, true) + TYPO.titlePadX * 2;
  let height = TYPO.border * 2;

  const stereotypePx = Math.max(8, titlePx - 3);
  height += TYPO.titlePadY * 2 + lineHeightPx(titlePx);
  if (node.stereotype) {
    height += lineHeightPx(stereotypePx);
    maxWidth = Math.max(maxWidth, textWidth(`«${node.stereotype}»`, stereotypePx) + TYPO.titlePadX * 2);
  }

  for (const members of [node.attributes, node.methods]) {
    if (members.length === 0 && ctx.hideEmpty) continue;
    height += TYPO.divider + TYPO.compartmentPadY * 2;
    if (members.length === 0) {
      height += TYPO.emptyCompartment;
      continue;
    }
    members.forEach((member, index) => {
      const px = memberFontPx(node.id, member.key, ctx);
      height += lineHeightPx(px) + (index > 0 ? TYPO.memberGap : 0);
      maxWidth = Math.max(maxWidth, textWidth(member.display, px) + TYPO.compartmentPadX * 2 + 4);
    });
  }

  return {
    w: Math.ceil(Math.min(TYPO.maxAutoWidth, Math.max(TYPO.minWidth, maxWidth + TYPO.border * 2))),
    h: Math.ceil(height),
  };
}
