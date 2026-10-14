import { styleKeys } from '../../document/keys';
import type { LayoutState } from '../../document/schema';
import { lineHeightPx, ptToPx, textWidth } from '../../layout/measure';
import { SEQ, TYPO } from '../../theme';
import type { Participant } from './model';
import { splitLines } from './model';

export interface SeqMeasureContext {
  fontSizePt: number;
  textStyles: LayoutState['textStyles'];
}

export interface TextBlock { lines: string[]; w: number; h: number; fontPt: number; fontPx: number }

/** fontPt: 저장 단위(pt). 측정·렌더는 px */
export function measureTextBlock(text: string, fontPt: number, bold = false): TextBlock {
  const lines = splitLines(text);
  const fontPx = ptToPx(fontPt);
  return {
    lines,
    w: Math.ceil(Math.max(0, ...lines.map((line) => textWidth(line, fontPx, bold)))),
    h: lines.length * lineHeightPx(fontPx),
    fontPt,
    fontPx,
  };
}

export const participantFontPt = (id: string, ctx: SeqMeasureContext) =>
  ctx.textStyles[styleKeys.title(id)]?.fontSize ?? ctx.fontSizePt + 1;
export const participantFontPx = (id: string, ctx: SeqMeasureContext) => ptToPx(participantFontPt(id, ctx));

/** 문장(메시지/노트/프래그먼트) 라벨 글꼴 (pt) */
export const statementFontPt = (key: string, ctx: SeqMeasureContext, fallback = ctx.fontSizePt) =>
  ctx.textStyles[styleKeys.seqText(key)]?.fontSize ?? fallback;

/** 참여자 머리 상자 크기 — SeqParticipantNode 의 박스 모델과 동일 */
export function measureParticipant(participant: Participant, ctx: SeqMeasureContext): { w: number; h: number } {
  const block = measureTextBlock(participant.label, participantFontPt(participant.id, ctx), true);
  const actor = participant.type === 'actor';
  // 일반 참여자는 테두리(TYPO.border)가 있다 — ParticipantShape 와 같은 박스 모델
  const border = actor ? 0 : TYPO.border * 2;
  return {
    w: Math.ceil(Math.max(SEQ.minHeadW, block.w + SEQ.headPadX * 2 + border)),
    h: Math.ceil(actor ? SEQ.actorFigure + Math.max(block.h + 6, 22) : Math.max(SEQ.minHeadH, block.h + SEQ.headPadY * 2 + border)),
  };
}
