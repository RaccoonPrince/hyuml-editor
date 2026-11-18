import { describe, expect, it } from 'vitest';
import { parseDiagram, toLayoutGraph } from '../core/diagrams/registry';
import type { GraphDiagramModel } from '../core/diagrams/registry';
import { measureShapes } from '../core/diagrams/measureShapes';
import { createEmptyLayout } from '../core/document/schema';
import type { LayoutState } from '../core/document/schema';
import { placeAddedNodes, reconcileLayout } from '../core/document/reconcile';
import { getLayoutEngine } from '../core/layout/engine';
import { themeOf } from '../core/theme';
import { toFlowElements } from './toFlowElements';

/** 명세 NFR: 객체 30개 기준 1초 이내 갱신. 측정 환경 편차를 감안해 상한만 단언하고 실제 수치는 출력한다. */
function makeSource(count: number): string {
  const lines = ['classDiagram', '  direction TB'];
  for (let i = 0; i < count; i += 1) {
    lines.push(`  class C${i} {`, '    +id: string', '    +name: string', `    +run${i}(x: int) bool`, '  }');
  }
  for (let i = 1; i < count; i += 1) {
    lines.push(`  C${Math.floor((i - 1) / 2)} <|-- C${i}`);
    if (i % 3 === 0) lines.push(`  C${i} --> C${(i * 7) % count} : uses`);
  }
  return `${lines.join('\n')}\n`;
}

const ms = (start: number) => Math.round((performance.now() - start) * 10) / 10;

export async function measure(count: number) {
  const source = makeSource(count);
  let t = performance.now();
  const parsed = parseDiagram(source);
  const parse = ms(t);
  const model = parsed.model as GraphDiagramModel;
  const layout: LayoutState = createEmptyLayout();
  const sizes = measureShapes(model, layout);
  const measureOf = (n: { id: string }) => sizes[n.id] ?? { w: 160, h: 80 };

  t = performance.now();
  const pre = reconcileLayout({ model, prevModel: null, nodes: {}, trash: {}, measure: measureOf });
  const positions = await (await getLayoutEngine('dagre')).layout(toLayoutGraph(model), sizes);
  layout.nodes = { ...pre.nodes, ...placeAddedNodes(model, pre.nodes, pre.added, sizes, positions) };
  const reconcile = ms(t);

  const theme = themeOf(false);
  t = performance.now();
  toFlowElements({ model, layout, selection: [], theme });
  const flow = ms(t);

  // 드래그 한 프레임: 노드 하나만 옮기고 다시 변환 — 전체 재계산(이전 방식) vs 영향 받는 간선만(현재 방식)
  const run = (partial: boolean) => {
    const frames: number[] = [];
    let current = layout;
    toFlowElements({ model, layout: current, selection: [], theme }); // 직전 전체 결과 준비
    for (let i = 0; i < 20; i += 1) {
      const id = model.nodes[i % model.nodes.length]!.id;
      const node = current.nodes[id]!;
      current = { ...current, nodes: { ...current.nodes, [id]: { ...node, x: node.x + 7, y: node.y + 3 } } };
      t = performance.now();
      toFlowElements({ model, layout: current, selection: [id], theme, dragIds: partial ? new Set([id]) : null });
      frames.push(ms(t));
    }
    return { avg: Math.round((frames.reduce((a, b) => a + b, 0) / frames.length) * 10) / 10, max: Math.max(...frames) };
  };
  const full = run(false);
  const drag = run(true);
  return { count, edges: model.edges.length, parse, reconcile, flow, total: Math.round((parse + reconcile + flow) * 10) / 10, dragFrameFullAvg: full.avg, dragFrameFullMax: full.max, dragFramePartialAvg: drag.avg, dragFramePartialMax: drag.max };
}

describe('성능 (30·40개 클래스)', () => {
  it.each([30, 40])('클래스 %i개: 파싱 → reconcile(+배치) → toFlowElements 가 1초 이내', async (count) => {
    const result = await measure(count);
    console.log(`[perf] ${JSON.stringify(result)}`);
    expect(result.total).toBeLessThan(1000);
  }, 30000);
});

describe('성능 — 최악 입력(무작위로 겹친 40노드)', () => {
  it('전체 재계산과 드래그 프레임을 측정한다', () => {
    const model = parseDiagram(makeSource(40)).model as GraphDiagramModel;
    const layout: LayoutState = createEmptyLayout();
    let seed = 7;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (const node of model.nodes) layout.nodes[node.id] = { x: rand() * 900, y: rand() * 700, w: 160, h: 90 };
    const theme = themeOf(false);
    let t = performance.now();
    toFlowElements({ model, layout, selection: [], theme });
    const full = ms(t);
    const id = model.nodes[0]!.id;
    const moved = { ...layout, nodes: { ...layout.nodes, [id]: { ...layout.nodes[id]!, x: 5, y: 5 } } };
    t = performance.now();
    toFlowElements({ model, layout: moved, selection: [id], theme, dragIds: new Set([id]) });
    const drag = ms(t);
    console.log(`[perf] ${JSON.stringify({ stress: '40노드 무작위 겹침', fullMs: full, dragFramePartialMs: drag })}`);
    expect(full).toBeLessThan(5000);
  }, 30000);
});
