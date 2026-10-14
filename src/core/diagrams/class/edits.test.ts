import { describe, expect, it } from 'vitest';
import { applyTextEdits } from '../../text';
import type { EditResult } from '../editResult';
import { editClassTitle, editEdgeLabel, editMember } from './edits';
import { parseClassDiagram } from './parser';

function apply(source: string, run: (model: NonNullable<ReturnType<typeof parseClassDiagram>['model']>) => EditResult) {
  const model = parseClassDiagram(source).model!;
  const result = run(model);
  if (!result.ok) throw new Error(result.reason);
  return { text: applyTextEdits(source, result.edits), result };
}

describe('editClassTitle', () => {
  it('클래스 참조만 바꾸고 주석·타입·라벨의 같은 단어는 건드리지 않는다 (전역 치환 버그 회귀)', () => {
    const source = [
      'classDiagram',
      '%% Order is important',
      'class Order {',
      '  +items: OrderItem',
      '}',
      'Customer --> Order : Order placed',
      'Order : +total() int',
    ].join('\n');
    const { text, result } = apply(source, (model) => editClassTitle(model, source, 'Order', 'Purchase'));
    expect(text).toBe([
      'classDiagram',
      '%% Order is important',
      'class Purchase {',
      '  +items: OrderItem',
      '}',
      'Customer --> Purchase : Order placed',
      'Purchase : +total() int',
    ].join('\n'));
    expect(result).toMatchObject({ renamedNode: { from: 'Order', to: 'Purchase' } });
  });

  it('선언 없이 관계에만 등장하는 클래스도 모든 줄에서 바꾼다', () => {
    const source = 'classDiagram\nA --> B\nB --> C';
    expect(apply(source, (model) => editClassTitle(model, source, 'B', 'X')).text).toBe('classDiagram\nA --> X\nX --> C');
  });

  it('공백이 있는 이름은 식별자를 유지하고 표시 라벨을 추가한다', () => {
    const source = 'classDiagram\nclass A\nA --> B';
    expect(apply(source, (model) => editClassTitle(model, source, 'A', 'My Class')).text).toBe('classDiagram\nclass A["My Class"]\nA --> B');
  });

  it('이미 있는 이름으로는 바꾸지 않는다', () => {
    const source = 'classDiagram\nA --> B';
    const model = parseClassDiagram(source).model!;
    expect(editClassTitle(model, source, 'A', 'B').ok).toBe(false);
  });
});

describe('editMember', () => {
  it('해당 멤버 범위만 바꾸고 classifier 를 보존한다', () => {
    const source = 'classDiagram\nclass A {\n  +count$\n  +run() void\n}';
    const model = parseClassDiagram(source).model!;
    const key = model.nodes[0]!.attributes[0]!.key;
    expect(apply(source, (m) => editMember(m, 'A', key, '+total')).text).toBe('classDiagram\nclass A {\n  +total$\n  +run() void\n}');
  });

  it('콜론 문법 멤버도 편집한다 (기존: 조용히 실패)', () => {
    const source = 'classDiagram\nA : +run() void';
    const key = parseClassDiagram(source).model!.nodes[0]!.methods[0]!.key;
    expect(apply(source, (m) => editMember(m, 'A', key, '+go() int')).text).toBe('classDiagram\nA : +go() int');
  });

  it('빈 문자열이면 줄을 삭제한다', () => {
    const source = 'classDiagram\nclass A {\n  +x\n  +y\n}';
    const key = parseClassDiagram(source).model!.nodes[0]!.attributes[0]!.key;
    expect(apply(source, (m) => editMember(m, 'A', key, '')).text).toBe('classDiagram\nclass A {\n  +y\n}');
  });

  it('화면의 <T> 제네릭을 소스의 ~T~ 로 되돌린다', () => {
    const source = 'classDiagram\nclass A {\n  +items List~int~\n}';
    const key = parseClassDiagram(source).model!.nodes[0]!.attributes[0]!.key;
    expect(apply(source, (m) => editMember(m, 'A', key, '+items Set<int>')).text).toContain('+items Set~int~');
  });
});

describe('editEdgeLabel', () => {
  it('라벨이 클래스 이름과 같아도 해당 관계 줄만 바꾼다 (기존 버그 회귀)', () => {
    const source = 'classDiagram\nUser --> Order\nOrder --> Item : User';
    const edgeId = parseClassDiagram(source).model!.edges[1]!.id;
    expect(apply(source, (m) => editEdgeLabel(m, edgeId, 'owner')).text).toBe('classDiagram\nUser --> Order\nOrder --> Item : owner');
  });

  it('라벨 추가와 삭제', () => {
    const source = 'classDiagram\nA "1" --> "*" B';
    const added = apply(source, (m) => editEdgeLabel(m, m.edges[0]!.id, 'has')).text;
    expect(added).toBe('classDiagram\nA "1" --> "*" B : has');
    expect(apply(added, (m) => editEdgeLabel(m, m.edges[0]!.id, '')).text).toBe(source);
  });
});
