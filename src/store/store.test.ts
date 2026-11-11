import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mermaid(DOM 필요)와 ELK(Worker 필요)는 Node 테스트에서 제외
vi.mock('../core/diagrams/mermaidValidate', () => ({ validateWithMermaid: async () => [] }));

const { useDiagramStore } = await import('./useDiagramStore');
const { createEmptyLayout } = await import('../core/document/schema');
const { styleKeys } = await import('../core/document/keys');

const store = () => useDiagramStore.getState();
const classIds = () => {
  const model = store().model;
  return model?.kind === 'class' ? model.nodes.map((node) => node.id) : [];
};

beforeEach(async () => {
  useDiagramStore.setState({
    doc: { source: 'classDiagram\nA --> B', layout: createEmptyLayout() },
    past: [], future: [], historyKey: null, historyAt: 0,
    model: null, modelSource: null, diagnostics: [], trash: {}, parseSeq: 0, kindStash: {}, layoutKind: null,
  });
  await store().commitNow();
});

describe('commit', () => {
  it('신규 노드를 배치한다', () => {
    expect(Object.keys(store().doc.layout.nodes).sort()).toEqual(['A', 'B']);
    expect(store().model).toMatchObject({ kind: 'class', edges: [{}] });
  });

  it('파싱 중 이동한 좌표가 커밋 결과로 덮어써지지 않는다 (Lost update 회귀)', async () => {
    useDiagramStore.setState((s) => ({ doc: { ...s.doc, source: 'classDiagram\nA --> B\nB --> C' } }));
    const pending = store().commitNow(); // C 배치를 위해 await 하는 동안
    store().moveNodes([{ id: 'A', x: 999, y: 777 }]);
    await pending;
    expect(store().doc.layout.nodes.A).toMatchObject({ x: 999, y: 777 });
    expect(store().doc.layout.nodes.C).toBeDefined();
  });

  it('늦게 끝난 오래된 커밋은 버려진다 (순서 뒤바뀜 회귀)', async () => {
    useDiagramStore.setState((s) => ({ doc: { ...s.doc, source: 'classDiagram\nA --> B\nB --> Old' } }));
    const stale = store().commitNow();
    useDiagramStore.setState((s) => ({ doc: { ...s.doc, source: 'classDiagram\nA --> B\nB --> New' } }));
    const fresh = store().commitNow();
    await Promise.all([stale, fresh]);
    expect(classIds()).toEqual(['A', 'B', 'New']);
  });

  it('코드 오류가 있으면 마지막 정상 모델을 유지한다', async () => {
    store().setSource('classDiagram\nA --> B\nclass C {');
    await store().commitNow();
    expect(classIds()).toEqual(['A', 'B']);
    expect(store().diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});

describe('canvas edits + history', () => {
  it('캔버스 리네임은 코드·좌표·스타일을 함께 옮기고 Undo 로 모두 되돌린다', async () => {
    store().updateTextStyle(styleKeys.title('A'), { fontSize: 20 });
    const before = store().doc.layout.nodes.A;
    store().renameShape('A', 'Order');
    await store().commitNow();
    expect(store().doc.source).toBe('classDiagram\nOrder --> B');
    expect(store().doc.layout.nodes.Order).toMatchObject({ x: before!.x, y: before!.y });
    expect(store().doc.layout.textStyles[styleKeys.title('Order')]?.fontSize).toBe(20);

    store().undo();
    await store().commitNow();
    expect(store().doc.source).toBe('classDiagram\nA --> B');
    expect(store().doc.layout.textStyles[styleKeys.title('A')]?.fontSize).toBe(20);

    store().redo();
    expect(store().doc.source).toBe('classDiagram\nOrder --> B');
  });

  it('연속 타이핑은 하나의 Undo 단위로 묶인다', () => {
    store().setSource('classDiagram\nA --> B\n');
    store().setSource('classDiagram\nA --> B\nB');
    store().setSource('classDiagram\nA --> B\nB --> C');
    expect(store().past).toHaveLength(1);
  });

  it('움직이지 않은 드래그는 빈 Undo 항목을 남기지 않는다', () => {
    store().beginInteraction();
    store().endInteraction();
    expect(store().past).toHaveLength(0);
  });
});

describe('sequence diagram in store', () => {
  const toSequence = async (source: string) => {
    store().setSource(source);
    await store().commitNow();
  };

  it('class → sequence 전환 시 참여자를 배치하고, 스타일이 메시지 편집을 따라간다', async () => {
    await toSequence('sequenceDiagram\nA->>B: hi\nB-->>A: ok');
    expect(store().model?.kind).toBe('sequence');
    expect(Object.keys(store().doc.layout.nodes).sort()).toEqual(['A', 'B']);

    store().updateTextStyle(styleKeys.seqText('msg:A->B:hi'), { fontSize: 20, color: '#d32f2f' });
    store().updateEdgeStyle('msg:A->B:hi', { stroke: '#005eb8', strokeWidth: 3 });
    store().editSequenceText('msg:A->B:hi', 'hello');
    await store().commitNow();

    expect(store().doc.source).toBe('sequenceDiagram\nA->>B: hello\nB-->>A: ok');
    expect(store().doc.layout.textStyles[styleKeys.seqText('msg:A->B:hello')]).toMatchObject({ fontSize: 20, color: '#d32f2f' });
    expect(store().doc.layout.edgeStyles['msg:A->B:hello']).toMatchObject({ stroke: '#005eb8', strokeWidth: 3 });
  });

  it('참여자는 가로로만 움직이고, 리네임 시 좌표·배경색·메시지 스타일이 따라간다', async () => {
    await toSequence('sequenceDiagram\nA->>B: hi');
    store().moveNodes([{ id: 'A', x: 300, y: 999 }]);
    expect(store().doc.layout.nodes.A).toMatchObject({ x: 300, y: 40 });

    store().updateNodeFill('A', '#dbeafe');
    store().updateEdgeStyle('msg:A->B:hi', { stroke: '#2e7d32' });
    store().renameShape('A', 'Client');
    await store().commitNow();

    expect(store().doc.source).toBe('sequenceDiagram\nClient->>B: hi');
    expect(store().doc.layout.nodes.Client).toMatchObject({ x: 300, fill: '#dbeafe' });
    expect(store().doc.layout.edgeStyles['msg:Client->B:hi']).toMatchObject({ stroke: '#2e7d32' });

    store().undo();
    await store().commitNow();
    expect(store().doc.source).toBe('sequenceDiagram\nA->>B: hi');
    expect(store().doc.layout.nodes.A?.fill).toBe('#dbeafe');
  });

  it('전체 간선 스타일은 메시지에, 전체 제목 스타일은 참여자에 적용된다', async () => {
    await toSequence('sequenceDiagram\nA->>B: hi\nB->>A: yo');
    store().updateAllEdgeStyles({ stroke: '#d32f2f' });
    store().updateAllClassTitleStyles({ fontSize: 18 });
    expect(Object.keys(store().doc.layout.edgeStyles).sort()).toEqual(['msg:A->B:hi', 'msg:B->A:yo']);
    expect(store().doc.layout.textStyles[styleKeys.title('B')]?.fontSize).toBe(18);
  });

  it('참여자 글자를 키우면 머리 상자만 커지고, 어떤 참여자의 좌표도 바뀌지 않는다 (명세 NFR-04)', async () => {
    await toSequence('sequenceDiagram\nA->>B: hi');
    const before = { ...store().doc.layout.nodes };
    store().updateTextStyle(styleKeys.title('A'), { fontSize: 24 });
    const after = store().doc.layout.nodes;
    expect(after.A!.h).toBeGreaterThan(before.A!.h);
    expect(after.A).toMatchObject({ x: before.A!.x, y: before.A!.y });
    expect(after.B).toMatchObject({ x: before.B!.x, y: before.B!.y });
  });

  it('노트 배경색을 지정/해제한다', async () => {
    await toSequence('sequenceDiagram\nA->>B: hi\nNote over A: memo');
    const key = styleKeys.seqText('note:over:A:memo');
    store().updateTextStyle(key, { fill: '#dcfce7' });
    expect(store().doc.layout.textStyles[key]?.fill).toBe('#dcfce7');
    store().updateTextStyle(key, { fill: null });
    expect(store().doc.layout.textStyles[key]?.fill).toBeUndefined();
  });
});

describe('groups · waypoints · usecase in store', () => {
  it('선택한 클래스를 그룹으로 묶고(코드에 namespace), 해제하면 되돌아간다', async () => {
    store().setSource('classDiagram\nA --> B\nB --> C');
    await store().commitNow();
    const before = { ...store().doc.layout.nodes };
    expect(store().createGroup(['A', 'B'], 'Core')).toBe(true);
    await store().commitNow();
    expect(store().doc.source).toContain('namespace Core {');
    expect(store().model?.groups).toMatchObject([{ id: 'Core', members: ['A', 'B'] }]);
    // 그룹을 만들어도 기존 도형 좌표는 그대로 (명세 FR-05)
    expect(store().doc.layout.nodes.A).toMatchObject({ x: before.A!.x, y: before.A!.y });

    store().removeGroup('Core');
    await store().commitNow();
    expect(store().model?.groups).toEqual([]);
  });

  it('연결선 꺾임점은 저장되고, 클래스 이름을 바꾸면 따라가며, 자동 정렬하면 초기화된다', async () => {
    store().setSource('classDiagram\nA --> B');
    await store().commitNow();
    store().setEdgeWaypoints('A|association|B', [{ x: 500, y: 200 }]);
    store().renameShape('A', 'Order');
    await store().commitNow();
    expect(store().doc.layout.edgeWaypoints).toEqual({ 'Order|association|B': [{ x: 500, y: 200 }] });

    await store().autoArrange();
    expect(store().doc.layout.edgeWaypoints).toEqual({});
  });

  it('유스케이스: 배치·이름 변경(renameShape)·관계 라벨 편집', async () => {
    store().setSource('usecase-beta\nactor U\nU --> Login\nLogin ..>:include Auth');
    await store().commitNow();
    expect(store().model?.kind).toBe('usecase');
    expect(Object.keys(store().doc.layout.nodes).sort()).toEqual(['Auth', 'Login', 'U']);

    store().renameShape('U', 'Customer');
    await store().commitNow();
    expect(store().doc.source).toBe('usecase-beta\nactor Customer\nCustomer --> Login\nLogin ..>:include Auth');
    expect(store().doc.layout.nodes.Customer).toBeDefined();

    store().editEdgeLabel('Customer|association|Login', 'uses');
    await store().commitNow();
    expect(store().doc.source).toContain('Customer -- uses --> Login');
  });

  it('전체 글꼴(pt)은 8~24pt 로 제한되고 도형 크기에 반영된다 (명세 FR-08)', async () => {
    store().setSource('classDiagram\nclass A');
    await store().commitNow();
    const small = store().doc.layout.nodes.A!.h;
    store().setFontSize(24);
    expect(store().doc.layout.canvas.fontSizePt).toBe(24);
    expect(store().doc.layout.nodes.A!.h).toBeGreaterThan(small);
    store().setFontSize(40);
    expect(store().doc.layout.canvas.fontSizePt).toBe(24);
    store().setFontSize(2);
    expect(store().doc.layout.canvas.fontSizePt).toBe(8);
  });
});

describe('다이어그램 종류 전환', () => {
  it('다른 종류의 같은 이름 도형 좌표를 물려받지 않고, 되돌아오면 원래 좌표를 복원한다', async () => {
    store().setSource('classDiagram\nA --> Order');
    await store().commitNow();
    store().moveNodes([{ id: 'Order', x: 3000, y: 3000 }]);
    const classOrder = { ...store().doc.layout.nodes.Order! };

    store().setSource('usecase-beta\nactor U\nU --> Order');
    await store().commitNow();
    // 유스케이스 Order 는 새로 배치됨 (클래스 좌표 3000,3000 을 물려받지 않음)
    expect(store().doc.layout.nodes.Order!.x).toBeLessThan(1000);

    store().setSource('classDiagram\nA --> Order');
    await store().commitNow();
    expect(store().doc.layout.nodes.Order).toMatchObject({ x: classOrder.x, y: classOrder.y });
  });
});

describe('Undo/Redo × 종류 전환', () => {
  it('되돌리기/다시 실행이 종류 전환을 가로질러도 다른 종류의 좌표가 섞이지 않는다 (회귀)', async () => {
    store().setSource('classDiagram\nA --> B'); await store().commitNow();
    store().beginInteraction(); store().moveNodes([{ id: 'A', x: 777, y: 555 }]); store().endInteraction();
    store().setSource('sequenceDiagram\nA->>B: hi'); await store().commitNow();
    const seqBefore = store().doc.layout.nodes.A!.x;
    store().beginInteraction(); store().moveNodes([{ id: 'A', x: 1234, y: 0 }]); store().endInteraction();
    store().undo(); await store().commitNow();
    store().undo(); await store().commitNow();
    expect(store().doc.layout.nodes.A).toMatchObject({ x: 777, y: 555 });
    store().redo(); await store().commitNow();
    expect(store().model?.kind).toBe('sequence');
    expect(store().doc.layout.nodes.A!.x).toBe(seqBefore);
  });
});

describe('종류 전환 시 스타일 분리', () => {
  it('class 의 스타일·꺾임점이 sequence 로 넘어가지 않고, 돌아오면 복원된다', async () => {
    store().updateTextStyle(styleKeys.title('A'), { fontSize: 20 });
    store().updateEdgeStyle('A|association|B', { stroke: '#d32f2f', strokeWidth: 3 });
    store().setEdgeWaypoints('A|association|B', [{ x: 5, y: 5 }]);
    const classNodes = store().doc.layout.nodes;

    store().setSource('sequenceDiagram\nA->>B: hi');
    await store().commitNow();
    expect(store().model?.kind).toBe('sequence');
    expect(store().doc.layout.textStyles).toEqual({});
    expect(store().doc.layout.edgeStyles).toEqual({});
    expect(store().doc.layout.edgeWaypoints).toEqual({});

    store().setSource('classDiagram\nA --> B');
    await store().commitNow();
    expect(store().model?.kind).toBe('class');
    expect(store().doc.layout.textStyles[styleKeys.title('A')]?.fontSize).toBe(20);
    expect(store().doc.layout.edgeStyles['A|association|B']?.strokeWidth).toBe(3);
    expect(store().doc.layout.edgeWaypoints['A|association|B']).toEqual([{ x: 5, y: 5 }]);
    expect(store().doc.layout.nodes).toEqual(classNodes);
  });
});

describe('핵심 요구 — 코드 편집과 좌표 (명세 FR-05·06)', () => {
  it('코드에 줄을 추가해도 기존 도형 좌표는 0px 도 변하지 않는다', async () => {
    store().moveNodes([{ id: 'A', x: 333.5, y: 41 }, { id: 'B', x: -80, y: 905 }]);
    const before = JSON.stringify([store().doc.layout.nodes.A, store().doc.layout.nodes.B]);
    store().setSource('classDiagram\nA --> B\nB --> C\nC --> D');
    await store().commitNow();
    expect(classIds()).toEqual(['A', 'B', 'C', 'D']);
    expect(JSON.stringify([store().doc.layout.nodes.A, store().doc.layout.nodes.B])).toBe(before);
    expect(store().doc.layout.nodes.C).toBeDefined();
  });

  it('코드 창에서 이름을 바꾸면 좌표와 스타일이 승계된다', async () => {
    store().moveNodes([{ id: 'B', x: 700, y: 300 }]);
    store().updateTextStyle(styleKeys.title('B'), { fontSize: 16 });
    store().setSource('classDiagram\nA --> Bee');
    await store().commitNow();
    expect(store().doc.layout.nodes.Bee).toMatchObject({ x: 700, y: 300 });
    expect(store().doc.layout.nodes.B).toBeUndefined();
    expect(store().doc.layout.textStyles[styleKeys.title('Bee')]?.fontSize).toBe(16);
  });

  it('문법 오류 후에도 모델·좌표가 그대로이고, 오류가 고쳐지면 이어서 동기화된다', async () => {
    store().moveNodes([{ id: 'A', x: 50, y: 60 }]);
    const nodesBefore = JSON.stringify(store().doc.layout.nodes);
    for (const bad of ['classDiagram\nA --> B\nclass C {', 'not a diagram']) {
      store().setSource(bad);
      await store().commitNow();
      expect(classIds()).toEqual(['A', 'B']);
      expect(JSON.stringify(store().doc.layout.nodes)).toBe(nodesBefore);
      expect(store().diagnostics.some((d) => d.severity === 'error')).toBe(true);
    }
    store().setSource('classDiagram\nA --> B\nclass C');
    await store().commitNow();
    expect(classIds()).toEqual(['A', 'B', 'C']);
    expect(store().doc.layout.nodes.A).toMatchObject({ x: 50, y: 60 });
    expect(store().diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('저장 직렬화 → 불러오기 후에도 같은 문서가 된다', async () => {
    const { serialize, deserialize } = await import('../core/document/serializer');
    store().moveNodes([{ id: 'A', x: 11, y: 22 }]);
    store().updateTextStyle(styleKeys.title('A'), { fontSize: 14, color: '#d32f2f' });
    const saved = store().doc;
    const loaded = deserialize(serialize(saved));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    store().setSource('classDiagram\nZ');
    await store().commitNow();
    store().loadDocument(loaded.doc);
    await store().commitNow();
    expect(store().doc.source).toBe(saved.source);
    expect(store().doc.layout).toEqual(saved.layout);
    expect(store().doc.layout.nodes.A).toMatchObject({ x: 11, y: 22 });
  });
});
