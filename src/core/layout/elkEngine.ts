import ELK from 'elkjs/lib/elk-api.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { Direction, NodeId, Point } from '../types';
import type { LayoutEngine } from './engine';

const ELK_DIRECTION: Record<Direction, string> = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

let elk: InstanceType<typeof ELK> | null = null;
const getElk = () => (elk ??= new ELK({ workerUrl }));

/** ELK layered 알고리즘 — Web Worker 에서 실행되어 메인 스레드를 막지 않는다. */
export const elkEngine: LayoutEngine = {
  name: 'elk',
  async layout(graph, sizes) {
    const root: ElkNode = {
      id: '__root__',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': ELK_DIRECTION[graph.direction],
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.padding': '[top=40,left=40,bottom=40,right=40]',
        // 그룹을 가로지르는 간선도 한 번에 배치
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      },
      children: buildChildren(graph, sizes),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.from],
        targets: [edge.to],
        layoutOptions: { 'elk.layered.priority.direction': String(Math.round(edge.weight * 2)) },
      })),
    };
    const result = await getElk().layout(root);
    const positions: Record<NodeId, Point> = {};
    // 그룹 안 자식 좌표는 부모 기준 상대좌표 → 절대좌표로 누적
    const visit = (children: ElkNode[] | undefined, dx: number, dy: number) => {
      for (const child of children ?? []) {
        if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) continue;
        const x = child.x! + dx;
        const y = child.y! + dy;
        if (child.id.startsWith(GROUP_PREFIX)) visit(child.children, x, y);
        else positions[child.id] = { x, y };
      }
    };
    visit(result.children, 0, 0);
    return positions;
  },
};

const GROUP_PREFIX = '__group__';

function buildChildren(graph: Parameters<LayoutEngine['layout']>[0], sizes: Parameters<LayoutEngine['layout']>[1]): ElkNode[] {
  const leaf = (id: NodeId): ElkNode => ({ id, width: sizes[id]?.w ?? 160, height: sizes[id]?.h ?? 80 });
  const grouped = new Set<NodeId>();
  const groups: ElkNode[] = graph.groups.filter((group) => group.members.length > 0).map((group) => ({
    id: `${GROUP_PREFIX}${group.id}`,
    layoutOptions: { 'elk.padding': '[top=40,left=24,bottom=20,right=24]' },
    children: group.members.filter((member) => !grouped.has(member) && grouped.add(member)).map(leaf),
  }));
  return [...groups, ...graph.nodes.filter((node) => !grouped.has(node.id)).map((node) => leaf(node.id))];
}
