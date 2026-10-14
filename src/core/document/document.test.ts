import { describe, expect, it } from 'vitest';
import { parseClassDiagram } from '../diagrams/class/parser';
import { migrateNodeRename, styleKeys } from './keys';
import { placeAddedNodes, reconcileLayout } from './reconcile';
import { createEmptyLayout, parseLayout } from './schema';
import { deserialize, serialize } from './serializer';

const model = (body: string) => parseClassDiagram(`classDiagram\n${body}`).model!;
const measure = () => ({ w: 160, h: 80 });

describe('schema / serializer', () => {
  it('저장 → 열기 왕복이 동일하다', () => {
    const layout = createEmptyLayout();
    layout.nodes.A = { x: 10, y: 20, w: 160, h: 80, autoSize: true };
    const result = deserialize(serialize({ source: 'classDiagram\nclass A', layout }));
    expect(result).toMatchObject({ ok: true, doc: { source: 'classDiagram\nclass A', layout } });
  });

  it('손상된 좌표(NaN·문자열)는 버리고 경고한다 — NaN 좌표로 렌더되지 않게', () => {
    const { layout, warnings } = parseLayout({ version: 2, nodes: { A: { x: 'a', y: 0, w: 1, h: 1 }, B: { x: 1, y: 2, w: 100, h: 50 } }, canvas: {} });
    expect(Object.keys(layout.nodes)).toEqual(['B']);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('v1 파일을 v3 로 마이그레이션한다 (글꼴 px → pt)', () => {
    const { layout } = parseLayout({
      version: 1,
      nodes: { A: { x: 0, y: 0, w: 200, h: 100 } },
      groups: {},
      canvas: { fontSizePt: 14 },
      textStyles: { 'A:label': { fontSize: 18 }, 'A:attribute:0': { color: '#f00' } },
    });
    expect(layout.version).toBe(3);
    // 18px = 13.5pt, 캔버스 14px = 10.5pt
    expect(layout.textStyles).toEqual({ [styleKeys.title('A')]: { fontSize: 13.5 } });
    expect(layout.canvas.fontSizePt).toBe(10.5);
    expect(layout.edgeWaypoints).toEqual({});
    expect(layout.nodes.A!.autoSize).toBe(false);
  });

  it('JSON 이 아니어도 throw 하지 않는다', () => {
    expect(deserialize('not json').ok).toBe(false);
    expect(deserialize('%%% graph\nclassDiagram\n%%% layout\n{broken').ok).toBe(false);
  });
});

describe('reconcile', () => {
  it('사라졌다 다시 나타난 노드는 휴지통에서 좌표를 복원한다', () => {
    const nodes = { A: { x: 500, y: 500, w: 160, h: 80, autoSize: false } };
    const removed = reconcileLayout({ model: model('class B'), prevModel: null, nodes, trash: {}, measure });
    expect(removed.trash.A).toBeDefined();
    const restored = reconcileLayout({ model: model('class A\nclass B'), prevModel: null, nodes: removed.nodes, trash: removed.trash, measure });
    expect(restored.nodes.A).toMatchObject({ x: 500, y: 500 });
    expect(restored.added).toEqual(['B']);
  });

  it('1:1 리네임은 좌표를 승계한다', () => {
    const prev = model('A --> B');
    const nodes = { A: { x: 1, y: 2, w: 160, h: 80 }, B: { x: 3, y: 4, w: 160, h: 80 } };
    const result = reconcileLayout({ model: model('X --> B'), prevModel: prev, nodes, trash: {}, measure });
    expect(result.renamed).toEqual([{ from: 'A', to: 'X' }]);
    expect(result.nodes.X).toMatchObject({ x: 1, y: 2 });
  });

  it('autoSize 노드는 내용에 맞춰 크기를 바꾸고, 수동 노드는 늘리기만 한다', () => {
    const nodes = { A: { x: 0, y: 0, w: 300, h: 300, autoSize: true }, B: { x: 0, y: 0, w: 300, h: 40, autoSize: false } };
    const result = reconcileLayout({ model: model('class A\nclass B'), prevModel: null, nodes, trash: {}, measure });
    expect(result.nodes.A).toMatchObject({ w: 160, h: 80 });
    expect(result.nodes.B).toMatchObject({ w: 300, h: 80 });
  });

  it('신규 노드는 기존 노드와 겹치지 않게 배치된다', () => {
    const m = model('A --> B');
    const existing = { A: { x: 0, y: 0, w: 160, h: 80 } };
    const placed = placeAddedNodes(m, existing, ['B'], { B: { w: 160, h: 80 } }, { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } });
    const b = placed.B!;
    expect(b.x >= 180 || b.y >= 100).toBe(true);
  });
});

describe('keys', () => {
  it('리네임 시 스타일 키와 간선 키를 함께 옮긴다', () => {
    const layout = createEmptyLayout();
    layout.nodes.A = { x: 0, y: 0, w: 1, h: 1 };
    layout.textStyles[styleKeys.title('A')] = { fontSize: 20 };
    layout.textStyles[styleKeys.edgeLabel('A|association|B')] = { color: '#000' };
    layout.edgeStyles['A|association|B'] = { stroke: '#f00' };
    migrateNodeRename(layout, 'A', 'Z');
    expect(Object.keys(layout.nodes)).toEqual(['Z']);
    expect(layout.textStyles).toEqual({ [styleKeys.title('Z')]: { fontSize: 20 }, [styleKeys.edgeLabel('Z|association|B')]: { color: '#000' } });
    expect(layout.edgeStyles).toEqual({ 'Z|association|B': { stroke: '#f00' } });
  });
});
