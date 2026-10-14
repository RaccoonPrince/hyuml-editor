import type { RelationEdge } from '../diagrams/class/model';
import type { NodeId, Point, Rect } from '../types';
import type { NodeLayout } from './schema';

/** reconcile 이 필요로 하는 그래프형 다이어그램(class·usecase)의 최소 형태 */
export interface GraphModelLike<N extends { id: NodeId } = { id: NodeId }> {
  nodes: readonly N[];
  edges: readonly Pick<RelationEdge, 'source' | 'target' | 'relationType'>[];
}

/**
 * 코드(위상) 변경 → 레이아웃 조정. 순수 함수.
 * - 기존 노드: 좌표 그대로 (0px 변동). autoSize 노드는 내용에 맞춰 크기만 갱신
 * - 사라졌다 다시 나타난 노드: 휴지통에서 좌표 복원 (타이핑 중 이름이 잠깐 깨져도 위치 유지)
 * - 1:1 리네임(간선 이웃 동일): 좌표 승계
 * - 신규 노드: added 로 반환 → 호출부가 레이아웃 엔진으로 배치
 */

export interface ReconcileInput<N extends { id: NodeId }> {
  model: GraphModelLike<N>;
  prevModel: GraphModelLike | null;
  nodes: Record<NodeId, NodeLayout>;
  trash: Record<NodeId, NodeLayout>;
  measure: (node: N) => { w: number; h: number };
}

export interface ReconcileResult {
  nodes: Record<NodeId, NodeLayout>;
  trash: Record<NodeId, NodeLayout>;
  added: NodeId[];
  renamed: { from: NodeId; to: NodeId }[];
}

const TRASH_LIMIT = 200;

function edgeSignature(model: GraphModelLike, id: NodeId, alias: NodeId = id): string {
  return model.edges
    .filter((edge) => edge.source === id || edge.target === id)
    .map((edge) => {
      const outgoing = edge.source === id;
      const other = outgoing ? edge.target : edge.source;
      return `${edge.relationType}:${outgoing ? '>' : '<'}${other === id ? alias : other}`;
    })
    .sort()
    .join(',');
}

export function fitSize(layout: NodeLayout, required: { w: number; h: number }): NodeLayout {
  if (layout.autoSize !== false) {
    return layout.w === required.w && layout.h === required.h ? layout : { ...layout, w: required.w, h: required.h };
  }
  // 수동 크기 노드: 내용이 잘리지 않을 만큼만 늘린다 (줄이지는 않음)
  const w = Math.max(layout.w, Math.min(required.w, 150));
  const h = Math.max(layout.h, required.h);
  return w === layout.w && h === layout.h ? layout : { ...layout, w, h };
}

export function reconcileLayout<N extends { id: NodeId }>({ model, prevModel, nodes, trash, measure }: ReconcileInput<N>): ReconcileResult {
  const nextNodes: Record<NodeId, NodeLayout> = {};
  const nextTrash: Record<NodeId, NodeLayout> = { ...trash };
  const added: NodeId[] = [];
  const renamed: ReconcileResult['renamed'] = [];
  const liveIds = new Set(model.nodes.map((node) => node.id));
  const byId = new Map(model.nodes.map((node) => [node.id, node]));

  for (const node of model.nodes) {
    const kept = nodes[node.id] ?? nextTrash[node.id];
    if (kept) {
      nextNodes[node.id] = kept;
      delete nextTrash[node.id];
    } else {
      added.push(node.id);
    }
  }

  const removed = Object.keys(nodes).filter((id) => !liveIds.has(id));
  for (const id of removed) nextTrash[id] = nodes[id]!;

  if (removed.length === 1 && added.length === 1 && prevModel) {
    const from = removed[0]!;
    const to = added[0]!;
    if (edgeSignature(prevModel, from, '@') === edgeSignature(model, to, '@')) {
      nextNodes[to] = nextTrash[from]!;
      delete nextTrash[from];
      added.length = 0;
      renamed.push({ from, to });
    }
  }

  for (const [id, layout] of Object.entries(nextNodes)) {
    const node = byId.get(id);
    if (node) nextNodes[id] = fitSize(layout, measure(node));
  }

  const trashIds = Object.keys(nextTrash);
  for (const id of trashIds.slice(0, Math.max(0, trashIds.length - TRASH_LIMIT))) delete nextTrash[id];

  return { nodes: nextNodes, trash: nextTrash, added, renamed };
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * 엔진이 계산한 전체 배치에서 신규 노드 좌표만 가져와 기존 좌표계에 맞춘다.
 * 기준점(anchor) = 신규 노드와 연결된 기존 노드 → 엔진 좌표와 실제 좌표의 차이만큼 평행이동.
 * 이동 후에도 기존 노드와 겹치면 빈 곳을 찾을 때까지 밀어낸다.
 */
export function placeAddedNodes(
  model: Pick<GraphModelLike, 'edges'>,
  existing: Record<NodeId, NodeLayout>,
  added: NodeId[],
  sizes: Record<NodeId, { w: number; h: number }>,
  enginePositions: Record<NodeId, Point>,
): Record<NodeId, NodeLayout> {
  const addedSet = new Set(added);
  const anchorId = model.edges
    .map((edge) => (addedSet.has(edge.source) && existing[edge.target] ? edge.target
      : addedSet.has(edge.target) && existing[edge.source] ? edge.source : undefined))
    .find((id): id is NodeId => id !== undefined && enginePositions[id] !== undefined)
    ?? Object.keys(existing).find((id) => enginePositions[id] !== undefined);

  let dx = 0;
  let dy = 0;
  if (anchorId) {
    dx = existing[anchorId]!.x - enginePositions[anchorId]!.x;
    dy = existing[anchorId]!.y - enginePositions[anchorId]!.y;
  } else {
    const placed = added.map((id) => enginePositions[id]).filter((point): point is Point => point !== undefined);
    if (placed.length > 0) {
      dx = 40 - Math.min(...placed.map((point) => point.x));
      dy = 40 - Math.min(...placed.map((point) => point.y));
    }
  }

  const occupied: Rect[] = Object.values(existing);
  const result: Record<NodeId, NodeLayout> = {};
  const fallbackX = occupied.length > 0 ? Math.max(...occupied.map((rect) => rect.x + rect.w)) + 60 : 40;
  let fallbackY = 40;

  for (const id of added) {
    const size = sizes[id] ?? { w: 160, h: 80 };
    const base = enginePositions[id];
    const rect: Rect = base
      ? { x: base.x + dx, y: base.y + dy, ...size }
      : { x: fallbackX, y: (fallbackY += size.h + 40) - size.h - 40, ...size };
    for (let attempt = 0; attempt < 50 && occupied.some((other) => overlaps(rect, other, 20)); attempt += 1) {
      rect.x += size.w / 2 + 20;
    }
    occupied.push(rect);
    result[id] = { ...rect, autoSize: true };
  }
  return result;
}
