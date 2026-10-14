import dagre from '@dagrejs/dagre';
import type { LayoutGraph } from '../diagrams/registry';
import type { Direction, NodeId, Point } from '../types';
import type { LayoutEngine, NodeSizes } from './engine';
import { lineHeightPx, ptToPx, textWidth } from './measure';

/** 라벨 폭 계산용 기본 글꼴 (캔버스 기본 10pt) */
const LABEL_FONT_PX = ptToPx(10);

export function layoutWithDagre(graph: LayoutGraph, sizes: NodeSizes): Record<NodeId, Point> {
  const grouped = graph.groups.some((group) => group.members.length > 0);
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: grouped });
  // Mermaid classDiagram 과 같은 설정 (nodeSpacing 50 · rankSpacing 50, 기본 cycle 처리)
  g.setGraph({
    rankdir: graph.direction,
    nodesep: 50,
    ranksep: 50,
    edgesep: 20,
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const size = sizes[node.id] ?? { w: 160, h: 80 };
    g.setNode(node.id, { width: size.w, height: size.h });
  }
  // 그룹 = dagre cluster. 구성원이 한데 모이고 그룹 상자 여백만큼 떨어진다.
  if (grouped) {
    for (const group of graph.groups) {
      const clusterId = `__group__${group.id}`;
      g.setNode(clusterId, { paddingTop: 40, paddingBottom: 20, paddingLeft: 24, paddingRight: 24 });
      for (const member of group.members) if (g.hasNode(member)) g.setParent(member, clusterId);
    }
  }
  for (const edge of graph.edges) {
    if (!g.hasNode(edge.from) || !g.hasNode(edge.to)) continue;
    // 가중치는 Mermaid 처럼 모두 1. 라벨이 있으면 크기를 알려 dagre 가 계층 사이에 라벨 자리를 만든다
    const label = edge.label
      ? { width: Math.ceil(textWidth(edge.label, LABEL_FONT_PX) + 16), height: lineHeightPx(LABEL_FONT_PX) + 8, labelpos: 'c' }
      : {};
    g.setEdge(edge.from, edge.to, { weight: 1, minlen: 1, ...label }, edge.id);
  }

  dagre.layout(g);

  const positions: Record<NodeId, Point> = {};
  for (const node of graph.nodes) {
    const placed = g.node(node.id) as { x?: number; y?: number } | undefined;
    const size = sizes[node.id] ?? { w: 160, h: 80 };
    if (!placed || !Number.isFinite(placed.x) || !Number.isFinite(placed.y)) continue;
    positions[node.id] = { x: placed.x! - size.w / 2, y: placed.y! - size.h / 2 };
  }
  return alignRanks(positions, sizes, graph.direction);
}

/**
 * 같은 계층(rank)의 도형을 흐름 시작 쪽 변에 맞춘다 (TB 면 윗변).
 * dagre 는 중심을 맞추므로 높이가 다른 상자들이 들쭉날쭉해 보인다 — Mermaid 는 윗변을 맞춘다.
 */
export function alignRanks(positions: Record<NodeId, Point>, sizes: NodeSizes, direction: Direction): Record<NodeId, Point> {
  const vertical = direction === 'TB' || direction === 'BT';
  const size = (id: NodeId) => sizes[id] ?? { w: 160, h: 80 };
  // dagre 는 같은 rank 의 중심 좌표를 정확히 같게 둔다 → 중심값으로 묶는다
  const ranks = new Map<number, NodeId[]>();
  for (const [id, point] of Object.entries(positions)) {
    const center = vertical ? point.y + size(id).h / 2 : point.x + size(id).w / 2;
    const key = Math.round(center);
    ranks.set(key, [...(ranks.get(key) ?? []), id]);
  }
  const aligned: Record<NodeId, Point> = { ...positions };
  for (const ids of ranks.values()) {
    if (ids.length < 2) continue;
    if (direction === 'TB') {
      const top = Math.min(...ids.map((id) => positions[id]!.y));
      for (const id of ids) aligned[id] = { ...positions[id]!, y: top };
    } else if (direction === 'BT') {
      const bottom = Math.max(...ids.map((id) => positions[id]!.y + size(id).h));
      for (const id of ids) aligned[id] = { ...positions[id]!, y: bottom - size(id).h };
    } else if (direction === 'LR') {
      const left = Math.min(...ids.map((id) => positions[id]!.x));
      for (const id of ids) aligned[id] = { ...positions[id]!, x: left };
    } else {
      const right = Math.max(...ids.map((id) => positions[id]!.x + size(id).w));
      for (const id of ids) aligned[id] = { ...positions[id]!, x: right - size(id).w };
    }
  }
  return aligned;
}

export const dagreEngine: LayoutEngine = {
  name: 'dagre',
  layout: async (graph, sizes) => layoutWithDagre(graph, sizes),
};
