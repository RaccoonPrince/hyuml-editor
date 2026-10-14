import type { ReconcileResult } from '../../document/reconcile';
import { fitSize } from '../../document/reconcile';
import type { NodeLayout } from '../../document/schema';
import { SEQ } from '../../theme';
import type { NodeId } from '../../types';
import type { DiagramModel } from '../registry';
import type { Participant, SequenceModel } from './model';

const TRASH_LIMIT = 200;

export interface SeqReconcileInput {
  model: SequenceModel;
  prevModel: DiagramModel | null;
  nodes: Record<NodeId, NodeLayout>;
  trash: Record<NodeId, NodeLayout>;
  measure: (participant: Participant) => { w: number; h: number };
}

/**
 * 코드 변경 → 참여자 가로 배치 조정 (순수 함수).
 * 명세 FR-05·NFR-04: 기존 참여자의 좌표는 절대 바꾸지 않는다 (0px).
 * - 기존 참여자: x·y 그대로 (내용에 맞춰 크기만 조정)
 * - 신규 참여자: 선언 순서상 앞 참여자 바로 오른쪽이 비어 있으면 그 자리, 아니면 줄 맨 오른쪽 빈 곳
 * - 겹침 정리는 사용자가 "자동 정렬"을 눌렀을 때만 (arrangeSequence)
 */
export function reconcileSequence({ model, prevModel, nodes, trash, measure }: SeqReconcileInput): ReconcileResult {
  const next: Record<NodeId, NodeLayout> = {};
  const nextTrash: Record<NodeId, NodeLayout> = { ...trash };
  const added: NodeId[] = [];
  const renamed: ReconcileResult['renamed'] = [];
  const liveIds = new Set(model.participants.map((participant) => participant.id));

  for (const participant of model.participants) {
    const kept = nodes[participant.id] ?? nextTrash[participant.id];
    if (kept) {
      next[participant.id] = kept;
      delete nextTrash[participant.id];
    } else {
      added.push(participant.id);
    }
  }
  const removed = Object.keys(nodes).filter((id) => !liveIds.has(id));
  for (const id of removed) nextTrash[id] = nodes[id]!;

  // 1:1 리네임: 이전에도 시퀀스였고 참여자 하나가 바뀌었으면 자리 승계
  if (removed.length === 1 && added.length === 1 && prevModel?.kind === 'sequence'
    && prevModel.participants.some((participant) => participant.id === removed[0])) {
    next[added[0]!] = nextTrash[removed[0]!]!;
    delete nextTrash[removed[0]!];
    renamed.push({ from: removed[0]!, to: added[0]! });
    added.length = 0;
  }

  for (const participant of model.participants) {
    const current = next[participant.id];
    if (current) next[participant.id] = fitSize(current, measure(participant));
  }

  const overlapsAny = (x: number, w: number) => Object.values(next)
    .some((node) => x < node.x + node.w + SEQ.minGap && node.x < x + w + SEQ.minGap);
  const addedSet = new Set(added);
  model.participants.forEach((participant, index) => {
    if (!addedSet.has(participant.id)) return;
    const size = measure(participant);
    const before = model.participants.slice(0, index).reverse().find((candidate) => next[candidate.id]);
    const placed = Object.values(next);
    const rightEnd = placed.length > 0 ? Math.max(...placed.map((node) => node.x + node.w)) + SEQ.gap : 40;
    let x = rightEnd;
    if (before) {
      const candidate = next[before.id]!.x + next[before.id]!.w + SEQ.gap;
      if (!overlapsAny(candidate, size.w)) x = candidate;
    }
    // 이전 다이어그램(클래스 등)에서 가져온 좌표가 아닌, 머리 줄에 놓는다
    next[participant.id] = { x, y: SEQ.top, w: size.w, h: size.h, autoSize: true };
  });

  // 다른 다이어그램에서 복원된 좌표만 머리 줄로 맞춘다 (원래 시퀀스 참여자는 이미 SEQ.top)
  for (const [id, node] of Object.entries(next)) {
    if (node.y !== SEQ.top) next[id] = { ...node, y: SEQ.top };
  }

  const trashIds = Object.keys(nextTrash);
  for (const id of trashIds.slice(0, Math.max(0, trashIds.length - TRASH_LIMIT))) delete nextTrash[id];

  return { nodes: next, trash: nextTrash, added: [], renamed };
}

/** 자동 정렬: 선언 순서대로 같은 간격으로 다시 배치 */
export function arrangeSequence(model: SequenceModel, nodes: Record<NodeId, NodeLayout>, measure: (participant: Participant) => { w: number; h: number }) {
  const result: Record<NodeId, NodeLayout> = {};
  let x = 40;
  for (const participant of model.participants) {
    const current = nodes[participant.id];
    const size = current && current.autoSize === false ? { w: current.w, h: current.h } : measure(participant);
    result[participant.id] = { ...current, x, y: SEQ.top, w: size.w, h: size.h, autoSize: current?.autoSize ?? true };
    x += size.w + SEQ.gap;
  }
  return result;
}
