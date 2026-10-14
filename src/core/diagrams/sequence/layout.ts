import type { NodeLayout } from '../../document/schema';
import { normalizeColor } from '../../document/schema';
import { SEQ, TYPO } from '../../theme';
import type { NodeId, Rect } from '../../types';
import type { SeqMeasureContext, TextBlock } from './measure';
import { measureTextBlock, statementFontPt } from './measure';
import type { DiagramGroup } from '../groups';
import type { FragmentKind, Message, Note, SectionKind, SequenceModel } from './model';

/**
 * 시퀀스 다이어그램 세로 배치 (순수 함수).
 * 참여자의 가로 위치/크기는 layout.nodes(사용자 편집 가능)에서 오고,
 * 메시지·노트·프래그먼트·활성화는 문장 순서대로 위에서 아래로 쌓는다.
 * 모든 좌표는 flow 좌표계, 상자는 좌상단 기준.
 */

export interface SeqMessageLayout {
  key: string;
  message: Message;
  x1: number;
  x2: number;
  y: number;
  self: boolean;
  label: Rect;
  text: TextBlock;
  number?: number;
}

export interface SeqNoteLayout extends Rect { key: string; note: Note; text: TextBlock }

export interface SeqFragmentLayout extends Rect {
  key: string;
  kind: FragmentKind;
  label: string;
  labelText: TextBlock;
  /** rect 블록의 배경색 */
  fill?: string;
  sections: { key: string; kind: SectionKind; label: string; y: number; labelText: TextBlock }[];
}

export interface SeqLayout {
  lifelines: { id: NodeId; x: number; y1: number; y2: number; destroyed: boolean }[];
  footers: { id: NodeId; rect: Rect }[];
  messages: SeqMessageLayout[];
  activations: (Rect & { id: NodeId })[];
  notes: SeqNoteLayout[];
  fragments: SeqFragmentLayout[];
  /** box 그룹 상자 (머리 위 ~ 꼬리 아래) */
  boxes: { group: DiagramGroup; rect: Rect }[];
  bounds: Rect;
}

export interface SeqLayoutInput extends SeqMeasureContext {
  model: SequenceModel;
  nodes: Record<NodeId, NodeLayout>;
}

const LABEL_PAD = 4;

export function layoutSequence({ model, nodes, fontSizePt, textStyles }: SeqLayoutInput): SeqLayout {
  const ctx = { fontSizePt, textStyles };
  const heads = model.participants.filter((participant) => nodes[participant.id]);
  const center = (id: NodeId) => {
    const node = nodes[id];
    return node ? node.x + node.w / 2 : undefined;
  };
  const headBottom = Math.max(SEQ.top, ...heads.map((participant) => nodes[participant.id]!.y + nodes[participant.id]!.h));

  const messages: SeqMessageLayout[] = [];
  const notes: SeqNoteLayout[] = [];
  const fragments: SeqFragmentLayout[] = [];
  const activations: SeqLayout['activations'] = [];
  const activeStarts = new Map<NodeId, number[]>();
  const destroyedAt = new Map<NodeId, number>();
  const openFragments: (SeqFragmentLayout & { minX: number; maxX: number })[] = [];
  let cursor = headBottom + SEQ.firstRowGap;
  let lastMessageY: number | undefined;
  let number = 0;

  const involve = (left: number, right: number) => {
    for (const fragment of openFragments) {
      fragment.minX = Math.min(fragment.minX, left);
      fragment.maxX = Math.max(fragment.maxX, right);
    }
  };
  const depthOf = (id: NodeId) => activeStarts.get(id)?.length ?? 0;
  /** 활성화 상자가 있으면 화살표는 상자 가장자리에서 시작/끝난다 */
  const edgeX = (id: NodeId, towardRight: boolean) => {
    const cx = center(id)!;
    const depth = depthOf(id);
    if (depth === 0) return cx;
    const boxCenter = cx + ((depth - 1) * SEQ.activationW) / 2;
    return towardRight ? boxCenter + SEQ.activationW / 2 : boxCenter - SEQ.activationW / 2;
  };
  const startActivation = (id: NodeId, y: number) => {
    const stack = activeStarts.get(id) ?? [];
    stack.push(y);
    activeStarts.set(id, stack);
  };
  const endActivation = (id: NodeId, y: number) => {
    const stack = activeStarts.get(id);
    const start = stack?.pop();
    const cx = center(id);
    if (start === undefined || cx === undefined) return;
    const level = stack!.length;
    activations.push({ id, x: cx - SEQ.activationW / 2 + (level * SEQ.activationW) / 2, y: start, w: SEQ.activationW, h: Math.max(10, y - start) });
  };

  for (const statement of model.statements) {
    switch (statement.type) {
      case 'message': {
        const { message } = statement;
        if (center(message.from) === undefined || center(message.to) === undefined) break;
        const text = measureTextBlock(message.text, statementFontPt(message.key, ctx));
        const textH = Math.max(text.h, text.fontPx * TYPO.lineHeight);
        const y = cursor + textH + SEQ.textGap;
        const self = message.from === message.to;
        const towardRight = self || center(message.to)! >= center(message.from)!;
        const x1 = edgeX(message.from, towardRight);
        if (message.activateTarget) startActivation(message.to, y);
        const x2 = self ? x1 : edgeX(message.to, !towardRight);
        if (message.deactivateSource) endActivation(message.from, y);

        const labelW = Math.max(24, text.w + LABEL_PAD * 2);
        const labelX = self ? x1 + SEQ.selfLoopW + 6 : (x1 + x2) / 2 - labelW / 2;
        const labelY = self ? y - textH / 2 + SEQ.selfLoopH / 2 : cursor;
        const label = { x: labelX, y: labelY, w: labelW, h: textH };
        messages.push({ key: message.key, message, x1, x2, y, self, label, text, ...(model.autonumber ? { number: (number += 1) } : {}) });
        involve(Math.min(x1, x2, label.x), Math.max(x1, x2, label.x + label.w, self ? x1 + SEQ.selfLoopW : x1));
        lastMessageY = y;
        cursor = y + SEQ.rowGap + (self ? SEQ.selfLoopH : 0);
        break;
      }
      case 'note': {
        const { note } = statement;
        const centers = note.actors.map(center).filter((value): value is number => value !== undefined);
        if (centers.length === 0) break;
        const text = measureTextBlock(note.text, statementFontPt(note.key, ctx));
        let w = Math.max(SEQ.noteMinW, text.w + SEQ.notePad * 2);
        const h = text.h + SEQ.notePad * 2;
        let x: number;
        if (note.placement === 'left') x = centers[0]! - SEQ.noteSideGap - w;
        else if (note.placement === 'right') x = centers[0]! + SEQ.noteSideGap;
        else {
          const left = Math.min(...centers);
          const right = Math.max(...centers);
          w = Math.max(w, right - left + 40);
          x = (left + right) / 2 - w / 2;
        }
        notes.push({ key: note.key, note, x, y: cursor, w, h, text });
        involve(x, x + w);
        cursor += h + SEQ.rowGap;
        break;
      }
      case 'activate': {
        if (center(statement.actor) !== undefined) startActivation(statement.actor, lastMessageY ?? cursor);
        break;
      }
      case 'deactivate': {
        endActivation(statement.actor, lastMessageY ?? cursor);
        break;
      }
      case 'destroy': {
        destroyedAt.set(statement.actor, lastMessageY ?? cursor);
        break;
      }
      case 'fragmentStart': {
        const { fragment } = statement;
        const labelText = measureTextBlock(fragment.kind === 'rect' ? '' : `[${fragment.label}]`, statementFontPt(fragment.key, ctx, Math.max(8, fontSizePt - 1)));
        const fill = fragment.kind === 'rect' ? normalizeColor(fragment.label) : undefined;
        openFragments.push({
          key: fragment.key, kind: fragment.kind, label: fragment.label, labelText, sections: [],
          x: 0, y: cursor, w: 0, h: 0, minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY,
          ...(fill ? { fill } : {}),
        });
        cursor += fragment.kind === 'rect' ? 8 : SEQ.fragHeader;
        break;
      }
      case 'fragmentSection': {
        const current = openFragments[openFragments.length - 1];
        if (!current) break;
        const { section } = statement;
        const labelText = measureTextBlock(section.label ? `[${section.label}]` : '', statementFontPt(section.key, ctx, Math.max(8, fontSizePt - 1)));
        current.sections.push({ key: section.key, kind: section.kind, label: section.label, y: cursor, labelText });
        cursor += SEQ.fragHeader;
        break;
      }
      case 'fragmentEnd': {
        const fragment = openFragments.pop();
        if (!fragment) break;
        if (!Number.isFinite(fragment.minX)) {
          const centers = heads.map((participant) => center(participant.id)!);
          fragment.minX = Math.min(...centers, 0);
          fragment.maxX = Math.max(...centers, 0);
        }
        const tagW = fragment.kind === 'rect' ? 0 : fragment.kind.length * 8 + 22;
        const x = fragment.minX - SEQ.fragPad;
        const w = Math.max(fragment.maxX - fragment.minX + SEQ.fragPad * 2, tagW + fragment.labelText.w + 24);
        const bottom = cursor + 6;
        const { minX: _minX, maxX: _maxX, ...rest } = fragment;
        fragments.push({ ...rest, x, w, h: bottom - fragment.y });
        involve(x, x + w);
        cursor = bottom + SEQ.rowGap;
        break;
      }
    }
  }

  for (const [id, stack] of activeStarts) {
    while (stack.length > 0) endActivation(id, cursor);
  }

  const footerTop = cursor + SEQ.footerGap - SEQ.rowGap;
  const lifelines: SeqLayout['lifelines'] = [];
  const footers: SeqLayout['footers'] = [];
  for (const participant of heads) {
    const node = nodes[participant.id]!;
    const destroyed = destroyedAt.get(participant.id);
    lifelines.push({ id: participant.id, x: node.x + node.w / 2, y1: node.y + node.h, y2: destroyed ?? footerTop, destroyed: destroyed !== undefined });
    if (destroyed === undefined) footers.push({ id: participant.id, rect: { x: node.x, y: footerTop, w: node.w, h: node.h } });
  }

  const boxes: SeqLayout['boxes'] = [];
  for (const group of model.groups) {
    const members = group.members.map((id) => nodes[id]).filter((node): node is NodeLayout => node !== undefined);
    if (members.length === 0) continue;
    const left = Math.min(...members.map((node) => node.x)) - 14;
    const right = Math.max(...members.map((node) => node.x + node.w)) + 14;
    const top = Math.min(...members.map((node) => node.y)) - 30;
    const bottom = footerTop + Math.max(...members.map((node) => node.h)) + 12;
    boxes.push({ group, rect: { x: left, y: top, w: right - left, h: bottom - top } });
  }

  const rects: Rect[] = [
    ...boxes.map((box) => box.rect),
    ...heads.map((participant) => nodes[participant.id]!),
    ...footers.map((footer) => footer.rect),
    ...notes, ...fragments, ...activations,
    ...messages.map((message) => message.label),
    ...messages.filter((message) => message.self).map((message) => ({ x: message.x1, y: message.y, w: SEQ.selfLoopW, h: SEQ.selfLoopH })),
  ];
  const minX = rects.length ? Math.min(...rects.map((rect) => rect.x)) : 0;
  const minY = rects.length ? Math.min(...rects.map((rect) => rect.y)) : 0;
  const maxX = rects.length ? Math.max(...rects.map((rect) => rect.x + rect.w)) : 0;
  const maxY = rects.length ? Math.max(...rects.map((rect) => rect.y + rect.h)) : 0;

  // 바깥 프래그먼트가 먼저 그려지도록 (넓은 것부터)
  fragments.sort((a, b) => b.w * b.h - a.w * a.h);

  return { lifelines, footers, messages, activations, notes, fragments, boxes, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
