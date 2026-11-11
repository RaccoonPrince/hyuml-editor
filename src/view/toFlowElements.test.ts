import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../core/diagrams/registry';
import type { GraphDiagramModel } from '../core/diagrams/registry';
import { createEmptyLayout } from '../core/document/schema';
import { themeOf } from '../core/theme';
import { toFlowElements } from './toFlowElements';

const model = parseDiagram('classDiagram\n  A --> B\n  B --> C\n  C --> D\n  E --> F\n').model as GraphDiagramModel;
const base = createEmptyLayout();
['A', 'B', 'C', 'D', 'E', 'F'].forEach((id, i) => { base.nodes[id] = { x: (i % 3) * 260, y: Math.floor(i / 3) * 220, w: 160, h: 80 }; });
const theme = themeOf(false);
const move = (layout: typeof base, id: string, x: number, y: number) => ({ ...layout, nodes: { ...layout.nodes, [id]: { ...layout.nodes[id]!, x, y } } });

describe('드래그 중 간선 재계산', () => {
  it('움직이는 도형과 무관한 간선은 직전 결과를 그대로 재사용하고, 놓으면 전체 재계산과 같아진다', () => {
    const start = toFlowElements({ model, layout: base, selection: [], theme });
    const moved = move(base, 'A', 40, 300);
    const dragging = toFlowElements({ model, layout: moved, selection: ['A'], theme, dragIds: new Set(['A']) });
    const byId = (edges: typeof start.edges) => Object.fromEntries(edges.map((edge) => [edge.id, edge]));
    const before = byId(start.edges);
    const during = byId(dragging.edges);
    expect(Object.keys(during).sort()).toEqual(Object.keys(before).sort());
    const touching = model.edges.filter((edge) => edge.source === 'A' || edge.target === 'A').map((edge) => edge.id);
    for (const id of Object.keys(before)) {
      if (touching.includes(id)) expect(during[id]!.data!.points).not.toEqual(before[id]!.data!.points);
      else expect(during[id]).toBe(before[id]); // 동일 객체 (재계산 없음)
    }
    // 도형 좌표는 항상 최신
    expect(dragging.nodes.find((node) => node.id === 'A')!.position).toEqual({ x: 40, y: 300 });

    const dropped = toFlowElements({ model, layout: moved, selection: ['A'], theme, dragIds: null });
    const fresh = toFlowElements({ model, layout: moved, selection: ['A'], theme });
    expect(dropped.edges.map((edge) => edge.data)).toEqual(fresh.edges.map((edge) => edge.data));
  });

  it('스타일이 바뀌었으면 드래그 중이어도 재사용하지 않는다', () => {
    toFlowElements({ model, layout: base, selection: [], theme });
    const styled = { ...base, edgeStyles: { 'x': { stroke: '#f00' } } };
    const result = toFlowElements({ model, layout: move(styled, 'A', 10, 10), selection: [], theme, dragIds: new Set(['A']) });
    expect(result.edges).toHaveLength(model.edges.length);
  });
});
