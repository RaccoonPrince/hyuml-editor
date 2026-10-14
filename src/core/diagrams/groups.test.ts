import { describe, expect, it } from 'vitest';
import { applyTextEdits } from '../text';
import type { EditResult } from './editResult';
import { createGroup, removeGroup, renameGroup } from './groupEdits';
import type { DiagramModel } from './registry';
import { parseDiagram } from './registry';

const parse = (source: string): DiagramModel => {
  const result = parseDiagram(source);
  if (!result.model || result.diagnostics.some((d) => d.severity === 'error')) throw new Error(JSON.stringify(result.diagnostics));
  return result.model;
};
const apply = (source: string, fn: (m: DiagramModel) => EditResult) => {
  const result = fn(parse(source));
  if (!result.ok) throw new Error(result.reason);
  return applyTextEdits(source, result.edits);
};

describe('그룹 생성 → 코드 반영 → 다시 파싱 (명세 FR-14·15)', () => {
  it('class: namespace 로 묶이고 다시 파싱하면 구성원이 된다', () => {
    const source = 'classDiagram\nclass A {\n  +x\n}\nA --> B\nB --> C';
    const grouped = apply(source, (m) => createGroup(m, source, ['A', 'B'], 'Core'));
    expect(grouped).toContain('namespace Core {\n  class A\n  class B\n}');
    const m = parse(grouped);
    expect(m.groups).toMatchObject([{ id: 'Core', members: ['A', 'B'] }]);
    // 멤버 내용과 관계는 그대로
    expect(m.kind === 'class' && m.nodes.find((n) => n.id === 'A')?.attributes.map((a) => a.display)).toEqual(['+x']);
    expect(m.kind === 'class' && m.edges).toHaveLength(2);

    // 해제하면 원래 코드로
    expect(apply(grouped, (next) => removeGroup(next, 'Core')).trim()).toBe(`${source}\n  class A\n  class B`.trim());
  });

  it('sequence: 참여자 선언을 box 안으로 옮기고, 선언 없던 참여자는 새로 선언한다', () => {
    const source = 'sequenceDiagram\nparticipant A as Alice\nA->>B: hi\nB->>C: yo';
    const grouped = apply(source, (m) => createGroup(m, source, ['A', 'B'], 'Front'));
    const m = parse(grouped);
    expect(m.groups).toMatchObject([{ label: 'Front', members: ['A', 'B'] }]);
    expect(m.kind === 'sequence' && m.participants.find((p) => p.id === 'A')?.label).toBe('Alice');
    expect(grouped.match(/participant A as Alice/g)).toHaveLength(1);
  });

  it('sequence: 라벨 첫 단어가 색 이름이면 transparent 를 붙여 라벨로 읽히게 한다', () => {
    const source = 'sequenceDiagram\nA->>B: hi';
    const grouped = apply(source, (m) => createGroup(m, source, ['A'], 'Red team'));
    expect(parse(grouped).groups[0]).toMatchObject({ label: 'Red team' });
  });

  it('usecase: systemBoundary 로 묶는다 (공백 이름은 라벨로)', () => {
    const source = 'usecase-beta\nactor U\nU --> Login\nU --> Pay';
    const grouped = apply(source, (m) => createGroup(m, source, ['Login', 'Pay'], '쇼핑몰 시스템'));
    expect(parse(grouped).groups).toMatchObject([{ label: '쇼핑몰 시스템', members: ['Login', 'Pay'] }]);
  });

  it('이미 그룹에 속한 도형은 다시 묶을 수 없고, 선택이 없으면 거부', () => {
    const source = 'classDiagram\nnamespace N {\n  class A\n}\nA --> B';
    expect(createGroup(parse(source), source, ['A', 'B'], 'M').ok).toBe(false);
    expect(createGroup(parse(source), source, [], 'M').ok).toBe(false);
  });

  it('그룹 이름 변경: class namespace / sequence box', () => {
    const cls = 'classDiagram\nnamespace Old {\n  class A\n}';
    expect(apply(cls, (m) => renameGroup(m, 'Old', 'New'))).toContain('namespace New {');
    const seq = 'sequenceDiagram\nbox Aqua Backend\n  participant A\nend\nA->>A: x';
    const m = parse(seq);
    expect(m.groups[0]).toMatchObject({ label: 'Backend', color: 'Aqua' });
    expect(apply(seq, (model) => renameGroup(model, m.groups[0]!.id, 'Server'))).toContain('box Aqua Server');
  });
});

describe('회귀: 백틱 식별자 클래스 그룹화', () => {
  it('공백이 든 클래스 이름도 namespace 안에서 같은 클래스로 파싱된다', () => {
    const source = 'classDiagram\nclass `My Class`\n`My Class` --> B';
    const grouped = apply(source, (m) => createGroup(m, source, ['My Class', 'B'], 'Core'));
    expect(grouped).toContain('class `My Class`');
    const m = parse(grouped);
    expect(m.kind === 'class' && m.nodes.map((n) => n.id).sort()).toEqual(['B', 'My Class']);
    expect(m.groups[0]?.members.sort()).toEqual(['B', 'My Class']);
  });
});
