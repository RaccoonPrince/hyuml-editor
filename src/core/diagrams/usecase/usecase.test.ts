import { describe, expect, it } from 'vitest';
import { applyTextEdits } from '../../text';
import { parseDiagram, toLayoutGraph } from '../registry';
import { editUsecaseEdgeLabel, renameUsecaseNode } from './edits';
import type { UsecaseModel } from './model';
import { parseUsecaseDiagram } from './parser';

const model = (body: string): UsecaseModel => {
  const result = parseUsecaseDiagram(`usecase-beta\n${body}`);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));
  return result.model;
};

describe('usecase parser', () => {
  it('registry 가 usecase-beta 를 유스케이스 플러그인으로 보낸다', () => {
    expect(parseDiagram('usecase-beta\nactor User\nUser --> Login').model?.kind).toBe('usecase');
  });

  it('액터 선언(쉼표·라벨·따옴표)과 유스케이스 도형(타원/사각형)', () => {
    const m = model('actor User(사용자), Admin\nactor "Guest User"\nLogin(로그인)\nReport[보고서]\nSearch');
    expect(m.nodes.map((n) => [n.id, n.label, n.type, n.shape])).toEqual([
      ['User', '사용자', 'actor', 'ellipse'],
      ['Admin', 'Admin', 'actor', 'ellipse'],
      ['Guest User', 'Guest User', 'actor', 'ellipse'],
      ['Login', '로그인', 'usecase', 'ellipse'],
      ['Report', '보고서', 'usecase', 'rect'],
      ['Search', 'Search', 'usecase', 'ellipse'],
    ]);
  });

  it('관계 종류: 연관·양방향 표기·include·extend·일반화', () => {
    const m = model('actor U\nU --> A\nB <-- U\nU -- C\nA ..>:include D\nA ..> : extend E\nF --|> A');
    expect(m.edges.map((e) => [e.source, e.target, e.relationType, e.stereotype ?? '', e.ends.source, e.ends.target, e.line])).toEqual([
      ['U', 'A', 'association', '', 'none', 'arrow', 'solid'],
      ['B', 'U', 'association', '', 'arrow', 'none', 'solid'],
      ['U', 'C', 'association', '', 'none', 'none', 'solid'],
      ['A', 'D', 'dependency', '«include»', 'none', 'arrow', 'dotted'],
      ['A', 'E', 'dependency', '«extend»', 'none', 'arrow', 'dotted'],
      ['F', 'A', 'inheritance', '', 'none', 'triangle', 'solid'],
    ]);
  });

  it('라벨이 있는 관계와 actor 문장 뒤의 관계', () => {
    const m = model('actor Customer -- places --> Order');
    expect(m.nodes.find((n) => n.id === 'Customer')?.type).toBe('actor');
    expect(m.edges[0]).toMatchObject({ source: 'Customer', target: 'Order', label: 'places' });
  });

  it('systemBoundary 안의 선언만 구성원이 된다', () => {
    const m = model('actor U\nsystemBoundary Shop[온라인 쇼핑몰]\n  Browse\n  Pay(결제)\nend\nU --> Browse');
    expect(m.groups).toMatchObject([{ id: 'Shop', label: '온라인 쇼핑몰', members: ['Browse', 'Pay'] }]);
  });

  it('닫히지 않은 경계는 error, 모르는 줄은 warning 이고 throw 하지 않는다', () => {
    expect(parseUsecaseDiagram('usecase-beta\nsystemBoundary S\n  A').diagnostics[0]!.severity).toBe('error');
    for (const input of ['usecase-beta', 'usecase-beta\n-->', 'usecase-beta\nactor', 'usecase-beta\nA -- --> B', 'usecase-beta\nend']) {
      expect(() => parseDiagram(input)).not.toThrow();
    }
  });

  it('레이아웃 그래프: 일반화는 부모가 먼저, 그룹 정보 포함', () => {
    const graph = toLayoutGraph(model('Child --|> Parent\nsystemBoundary S\n  Child\nend'));
    expect(graph.edges[0]).toMatchObject({ from: 'Parent', to: 'Child' });
    expect(graph.groups).toEqual([{ id: 'S', members: ['Child'] }]);
  });
});

describe('usecase edits', () => {
  const run = (source: string, fn: (m: UsecaseModel) => ReturnType<typeof renameUsecaseNode>) => {
    const result = fn(parseUsecaseDiagram(source).model!);
    if (!result.ok) throw new Error(result.reason);
    return applyTextEdits(source, result.edits);
  };

  it('라벨이 있으면 라벨만, 식별자면 모든 참조, 공백 이름이면 (라벨) 추가', () => {
    const s1 = 'usecase-beta\nLogin(로그인)\nactor U\nU --> Login';
    expect(run(s1, (m) => renameUsecaseNode(m, 'Login', '로그인하기'))).toBe('usecase-beta\nLogin(로그인하기)\nactor U\nU --> Login');
    const s2 = 'usecase-beta\nactor U\nU --> Pay\nPay ..>:include Auth';
    expect(run(s2, (m) => renameUsecaseNode(m, 'Pay', 'Checkout'))).toBe('usecase-beta\nactor U\nU --> Checkout\nCheckout ..>:include Auth');
    expect(run(s2, (m) => renameUsecaseNode(m, 'Pay', 'Pay now'))).toBe('usecase-beta\nactor U\nU --> Pay(Pay now)\nPay ..>:include Auth');
  });

  it('관계 라벨 추가·삭제, include 에는 라벨 불가', () => {
    const source = 'usecase-beta\nactor U\nU --> Login';
    const labeled = run(source, (m) => editUsecaseEdgeLabel(m, m.edges[0]!.id, 'uses'));
    expect(labeled).toBe('usecase-beta\nactor U\nU -- uses --> Login');
    expect(run(labeled, (m) => editUsecaseEdgeLabel(m, m.edges[0]!.id, ''))).toBe(source);
    const include = parseUsecaseDiagram('usecase-beta\nA ..>:include B').model!;
    expect(editUsecaseEdgeLabel(include, include.edges[0]!.id, 'x').ok).toBe(false);
  });
});
