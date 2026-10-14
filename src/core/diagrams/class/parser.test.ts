import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../registry';
import { parseClassDiagram } from './parser';

const parse = (body: string) => {
  const result = parseClassDiagram(`classDiagram\n${body}`);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};
const node = (body: string, id: string) => parse(body).model!.nodes.find((candidate) => candidate.id === id)!;

describe('members', () => {
  it('반환 타입이 있는 메서드를 중복·잘림 없이 한 번만 추출한다 (기존 버그 회귀)', () => {
    const order = node('class Order {\n  +pay(amount) bool\n  +id: string\n}', 'Order');
    expect(order.methods.map((m) => m.display)).toEqual(['+pay(amount) bool']);
    expect(order.attributes.map((m) => m.display)).toEqual(['+id: string']);
  });

  it('제네릭 클래스 선언의 본문과 제네릭 반환 타입을 처리한다', () => {
    const box = node('class Box~T~ {\n  +get() List~T~\n}', 'Box');
    expect(box.label).toBe('Box<T>');
    expect(box.methods[0]!.display).toBe('+get() List<T>');
    expect(box.methods[0]!.text).toBe('+get() List~T~');
  });

  it('콜론 문법 멤버와 본문 멤버를 함께 모은다', () => {
    const a = node('class A {\n  +x\n}\nA : +run() void\nA : +y int', 'A');
    expect(a.attributes.map((m) => m.display)).toEqual(['+x', '+y int']);
    expect(a.methods.map((m) => m.display)).toEqual(['+run() void']);
  });

  it('static($)·abstract(*) classifier 를 분리한다', () => {
    const a = node('class A {\n  +count$\n  +area()* double\n}', 'A');
    expect(a.attributes[0]).toMatchObject({ display: '+count', classifier: 'static' });
    expect(a.methods[0]).toMatchObject({ display: '+area() double', classifier: 'abstract' });
  });

  it('멤버 범위가 소스의 정확한 위치를 가리킨다', () => {
    const source = 'classDiagram\nclass A {\n    +pay(x) bool\n}';
    const member = parseClassDiagram(source).model!.nodes[0]!.methods[0]!;
    expect(source.slice(member.range.start, member.range.end)).toBe('+pay(x) bool');
  });

  it('중복 멤버에도 서로 다른 안정 키를 준다', () => {
    const a = node('class A {\n  +x\n  +x\n}', 'A');
    expect(a.attributes.map((m) => m.key)).toEqual(['a:+x', 'a:+x#2']);
  });

  it('본문 안 <<stereotype>> 을 인식한다', () => {
    expect(node('class Shape {\n  <<interface>>\n  +draw()\n}', 'Shape').stereotype).toBe('interface');
    expect(node('<<abstract>> Shape', 'Shape').stereotype).toBe('abstract');
  });
});

describe('relations', () => {
  it('`-->` 는 dependency 가 아니라 association 이다 (기존 버그 회귀)', () => {
    const edge = parse('A --> B').model!.edges[0]!;
    expect(edge).toMatchObject({ relationType: 'association', line: 'solid', ends: { source: 'none', target: 'arrow' } });
  });

  it('`..>` 는 dependency', () => {
    expect(parse('A ..> B').model!.edges[0]!.relationType).toBe('dependency');
  });

  it('`Animal <|-- Dog` 의 부모는 source 쪽이다 (상속 역배치 버그 회귀)', () => {
    const edge = parse('Animal <|-- Dog').model!.edges[0]!;
    expect(edge).toMatchObject({ relationType: 'inheritance', parentEnd: 'source', source: 'Animal', target: 'Dog' });
  });

  it('`Dog --|> Animal` 의 부모는 target 쪽이다', () => {
    expect(parse('Dog --|> Animal').model!.edges[0]!).toMatchObject({ relationType: 'inheritance', parentEnd: 'target' });
  });

  it('`..|>` 는 implementation, `*--`/`o--` 는 composition/aggregation', () => {
    const edges = parse('C ..|> I\nW *-- P\nG o-- M').model!.edges;
    expect(edges.map((e) => e.relationType)).toEqual(['implementation', 'composition', 'aggregation']);
    expect(edges[1]!.ends.source).toBe('diamondFilled');
    expect(edges[2]!.ends.source).toBe('diamondHollow');
  });

  it('다중성과 라벨, 라벨 범위를 추출한다', () => {
    const source = 'classDiagram\nOrder "1" --> "0..*" Item : contains';
    const edge = parseClassDiagram(source).model!.edges[0]!;
    expect(edge).toMatchObject({ sourceLabel: '1', targetLabel: '0..*', label: 'contains' });
    expect(source.slice(edge.labelRange!.start, edge.labelRange!.end)).toBe('contains');
    expect(source.slice(edge.labelClauseRange!.start, edge.labelClauseRange!.end)).toBe(' : contains');
  });

  it('간선에만 등장하는 클래스도 노드로 만든다', () => {
    expect(parse('A --> B').model!.nodes.map((n) => n.id)).toEqual(['A', 'B']);
  });

  it('같은 관계가 반복되면 id 에 접미사를 붙인다', () => {
    expect(parse('A --> B\nA --> B').model!.edges.map((e) => e.id)).toEqual(['A|association|B', 'A|association|B#2']);
  });

  it('direction 을 읽는다', () => {
    expect(parse('direction LR\nA --> B').model!.direction).toBe('LR');
  });
});

describe('diagnostics', () => {
  it('닫히지 않은 클래스 본문은 error', () => {
    const result = parseClassDiagram('classDiagram\nclass A {\n  +x');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('인식할 수 없는 줄은 warning 으로 알리고 나머지는 파싱한다', () => {
    const result = parseClassDiagram('classDiagram\nA --> B\n???\n');
    expect(result.model!.edges).toHaveLength(1);
    expect(result.diagnostics).toMatchObject([{ severity: 'warning' }]);
  });

  it('frontmatter 와 주석을 건너뛴다', () => {
    const result = parseClassDiagram('---\ntitle: x\n---\n%% comment\nclassDiagram\nA --> B');
    expect(result.diagnostics).toEqual([]);
    expect(result.model!.nodes).toHaveLength(2);
  });

  it('지원하지 않는 다이어그램(flowchart)은 가짜 노드 대신 진단을 반환한다 (기존 버그 회귀)', () => {
    const result = parseDiagram('flowchart TD\nA --> B');
    expect(result.model).toBeNull();
    expect(result.diagnostics[0]!.message).toContain('flowchart');
  });

  it('어떤 입력에도 throw 하지 않는다', () => {
    for (const input of ['', '\n\n', 'classDiagram\n}', 'classDiagram\nclass', 'classDiagram\n"a" --> "b"', 'classDiagram\nclass A["x']) {
      expect(() => parseDiagram(input)).not.toThrow();
    }
  });
});
