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

describe('reconcile — 고립 노드 리네임 정책 (확정)', () => {
  // 정책: 사라진 노드 1개 + 새 노드 1개이고 간선 이웃 서명이 같으면 리네임으로 본다.
  // 간선이 없는 고립 노드끼리는 서명이 모두 비어 있어 "교체"도 리네임으로 간주해 좌표를 승계한다.
  // (명세: 이름 하나가 사라지고 새 이름 하나가 생기면 이름 변경 — 오인했을 때의 비용은 새 도형이 옛 자리에 놓이는 것뿐이다)
  const placed = { A: { x: 10, y: 20, w: 160, h: 80 }, B: { x: 300, y: 20, w: 160, h: 80 } };

  it('고립 노드 1개를 지우고 다른 이름 1개를 추가하면 리네임으로 보고 좌표를 승계한다', () => {
    const result = reconcileLayout({ model: model('class A\nclass Z'), prevModel: model('class A\nclass B'), nodes: placed, trash: {}, measure });
    expect(result.renamed).toEqual([{ from: 'B', to: 'Z' }]);
    expect(result.nodes.Z).toMatchObject({ x: 300, y: 20 });
    expect(result.nodes.A).toMatchObject({ x: 10, y: 20 });
    expect(result.added).toEqual([]);
  });

  it('고립 노드가 사라지고 연결된 새 노드가 생기면 리네임이 아니다 (서명이 다름)', () => {
    const result = reconcileLayout({ model: model('class A\nA --> Z'), prevModel: model('class A\nclass B'), nodes: placed, trash: {}, measure });
    expect(result.renamed).toEqual([]);
    expect(result.added).toEqual(['Z']);
    expect(result.trash.B).toBeDefined();
  });

  it('동시에 2개가 바뀌면 리네임으로 추정하지 않는다', () => {
    const result = reconcileLayout({ model: model('class X\nclass Y'), prevModel: model('class A\nclass B'), nodes: placed, trash: {}, measure });
    expect(result.renamed).toEqual([]);
    expect(result.added.sort()).toEqual(['X', 'Y']);
  });

  it('이름을 바꾸면서 관계도 바꾸면 승계하지 않는다', () => {
    const nodes = { A: placed.A, B: placed.B, C: { x: 600, y: 0, w: 160, h: 80 } };
    const result = reconcileLayout({ model: model('A --> Z\nclass C'), prevModel: model('A --> B\nclass C'), nodes, trash: {}, measure });
    expect(result.renamed).toEqual([{ from: 'B', to: 'Z' }]);
    const changed = reconcileLayout({ model: model('C --> Z\nclass A'), prevModel: model('A --> B\nclass C'), nodes, trash: {}, measure });
    expect(changed.renamed).toEqual([]);
  });
});

describe('저장 · 불러오기 왕복', () => {
  it('좌표·크기·스타일·꺾임점·캔버스 설정이 그대로 복원되고 코드 구역에는 좌표가 없다', () => {
    const layout = createEmptyLayout();
    layout.nodes = { A: { x: 12.5, y: -30, w: 200, h: 90, autoSize: false, fill: '#ffcc00' }, B: { x: 400, y: 80, w: 160, h: 80, autoSize: true } };
    layout.textStyles = { [styleKeys.title('A')]: { fontSize: 18, color: '#d32f2f' } };
    layout.edgeStyles = { 'edge:A|association|B': { stroke: '#2e7d32', strokeWidth: 3 } };
    layout.edgeWaypoints = { 'A|association|B': [{ x: 100, y: 5 }, { x: 140, y: 60 }] };
    layout.canvas = { fontSizePt: 14, hideEmptyCompartments: false, engine: 'elk' };
    const source = 'classDiagram\n  class A\n  class B\n  A --> B\n';

    const file = serialize({ source, layout });
    const [codePart] = file.split('%%% layout');
    expect(codePart).toContain(source.trim());
    expect(codePart).not.toMatch(/"x"|12\.5|fontSizePt/);

    const loaded = deserialize(file);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.source).toBe(source);
    expect(loaded.doc.layout).toEqual(layout);
    expect(loaded.warnings).toEqual([]);
    // 한 번 더 왕복해도 같다 (안정성)
    const again = deserialize(serialize(loaded.doc));
    expect(again.ok && again.doc.layout).toEqual(layout);
  });
});
