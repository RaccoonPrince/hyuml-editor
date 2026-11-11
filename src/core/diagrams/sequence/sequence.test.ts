import { describe, expect, it } from 'vitest';
import { applyTextEdits } from '../../text';
import { SEQ } from '../../theme';
import { parseDiagram } from '../registry';
import type { EditResult } from '../editResult';
import { editStatementText, renameParticipant } from './edits';
import { layoutSequence } from './layout';
import { measureParticipant } from './measure';
import type { SequenceModel } from './model';
import { messages } from './model';
import { parseSequenceDiagram } from './parser';
import { reconcileSequence } from './reconcile';

const parse = (body: string) => {
  const result = parseSequenceDiagram(`sequenceDiagram\n${body}`);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};
const model = (body: string) => parse(body).model!;
const ctx = { fontSizePt: 12, textStyles: {} };
const place = (m: SequenceModel) => reconcileSequence({ model: m, prevModel: null, nodes: {}, trash: {}, measure: (p) => measureParticipant(p, ctx) }).nodes;

describe('sequence parser', () => {
  it('registry 가 sequenceDiagram 을 시퀀스 플러그인으로 보낸다', () => {
    expect(parseDiagram('sequenceDiagram\nA->>B: hi').model?.kind).toBe('sequence');
  });

  it('모든 화살표 종류를 구분한다', () => {
    const m = model('A->B: a\nA-->B: b\nA->>B: c\nA-->>B: d\nA-xB: e\nA--xB: f\nA-)B: g\nA--)B: h\nA<<->>B: i');
    expect(messages(m).map((msg) => `${msg.line}/${msg.head}${msg.bidirectional ? '/bi' : ''}`)).toEqual([
      'solid/none', 'dotted/none', 'solid/filled', 'dotted/filled', 'solid/cross', 'dotted/cross', 'solid/open', 'dotted/open', 'solid/filled/bi',
    ]);
  });

  it('participant/actor 선언, 별칭, 등장 순서를 지킨다', () => {
    const m = model('actor U as 사용자\nparticipant S as Server\nU->>S: 로그인\nS->>DB: 조회');
    expect(m.participants.map((p) => [p.id, p.label, p.type])).toEqual([['U', '사용자', 'actor'], ['S', 'Server', 'participant'], ['DB', 'DB', 'participant']]);
  });

  it('공백이 들어간 참여자 이름과 한글 이름을 허용한다', () => {
    const m = model('Web Server->>데이터베이스: query');
    expect(messages(m)[0]).toMatchObject({ from: 'Web Server', to: '데이터베이스', text: 'query' });
  });

  it('활성화 단축(+/-)과 activate/deactivate', () => {
    const m = model('A->>+B: req\nB-->>-A: res\nactivate A\ndeactivate A');
    expect(messages(m).map((msg) => [msg.activateTarget, msg.deactivateSource])).toEqual([[true, false], [false, true]]);
    expect(m.statements.slice(2).map((s) => s.type)).toEqual(['activate', 'deactivate']);
  });

  it('노트와 프래그먼트(중첩, else/and)를 순서대로 파싱한다', () => {
    const m = model('Note over A,B: 시작\nloop 매 분\n  alt 성공\n    A->>B: ok\n  else 실패\n    A->>B: fail\n  end\nend\nNote right of B: 끝');
    expect(m.statements.map((s) => s.type)).toEqual([
      'note', 'fragmentStart', 'fragmentStart', 'message', 'fragmentSection', 'message', 'fragmentEnd', 'fragmentEnd', 'note',
    ]);
  });

  it('메시지 텍스트 범위가 소스의 정확한 위치를 가리킨다', () => {
    const source = 'sequenceDiagram\n  Alice ->> Bob : Hello there';
    const msg = messages(parseSequenceDiagram(source).model!)[0]!;
    expect(source.slice(msg.textRange!.start, msg.textRange!.end)).toBe('Hello there');
  });

  it('같은 내용의 메시지에 서로 다른 안정 키를 준다', () => {
    expect(messages(model('A->>B: hi\nA->>B: hi')).map((msg) => msg.key)).toEqual(['msg:A->B:hi', 'msg:A->B:hi#2']);
  });

  it('title/box 라는 이름의 참여자도 메시지로 인식한다', () => {
    expect(messages(model('title->>box: x')).map((msg) => [msg.from, msg.to])).toEqual([['title', 'box']]);
  });

  it('닫히지 않은 블록은 error, 짝 없는 end 도 error', () => {
    expect(parseSequenceDiagram('sequenceDiagram\nloop x\nA->>B: y').diagnostics[0]!.severity).toBe('error');
    expect(parseSequenceDiagram('sequenceDiagram\nend').diagnostics[0]!.severity).toBe('error');
  });

  it('어떤 입력에도 throw 하지 않는다', () => {
    for (const input of ['sequenceDiagram', 'sequenceDiagram\n->>', 'sequenceDiagram\nNote over : x', 'sequenceDiagram\nelse', 'sequenceDiagram\nA->>']) {
      expect(() => parseDiagram(input)).not.toThrow();
    }
  });
});

describe('sequence edits', () => {
  const run = (source: string, fn: (m: SequenceModel) => EditResult) => {
    const result = fn(parseSequenceDiagram(source).model!);
    if (!result.ok) throw new Error(result.reason);
    return { text: applyTextEdits(source, result.edits), result };
  };

  it('참여자 리네임은 선언·메시지·노트·activate 를 모두 바꾸고 문장 키를 이전한다', () => {
    const source = 'sequenceDiagram\nparticipant A\nA->>B: hi\nNote over A: memo\nactivate A';
    const { text, result } = run(source, (m) => renameParticipant(m, source, 'A', 'Client'));
    expect(text).toBe('sequenceDiagram\nparticipant Client\nClient->>B: hi\nNote over Client: memo\nactivate Client');
    expect(result).toMatchObject({
      renamedNode: { from: 'A', to: 'Client' },
      keyMigration: { 'msg:A->B:hi': 'msg:Client->B:hi', 'note:over:A:memo': 'note:over:Client:memo' },
    });
  });

  it('별칭이 있으면 별칭만, 공백 이름이면 as 별칭을 추가한다', () => {
    const aliased = 'sequenceDiagram\nparticipant A as Alice\nA->>B: hi';
    expect(run(aliased, (m) => renameParticipant(m, aliased, 'A', 'Alicia')).text).toContain('participant A as Alicia');
    const plain = 'sequenceDiagram\nparticipant A\nA->>B: hi';
    expect(run(plain, (m) => renameParticipant(m, plain, 'A', 'Web Client')).text).toContain('participant A as Web Client');
    const implicit = 'sequenceDiagram\nA->>B: hi';
    expect(run(implicit, (m) => renameParticipant(m, implicit, 'A', 'Web Client')).text).toBe('sequenceDiagram\n  participant A as Web Client\nA->>B: hi');
  });

  it('메시지 텍스트 편집은 해당 범위만 바꾸고 중복 키가 뒤바뀌는 것도 추적한다', () => {
    const source = 'sequenceDiagram\nA->>B: hi\nA->>B: hi';
    const m = parseSequenceDiagram(source).model!;
    const { text, result } = run(source, () => editStatementText(m, messages(m)[0]!.key, 'hello'));
    expect(text).toBe('sequenceDiagram\nA->>B: hello\nA->>B: hi');
    // 두 번째 메시지는 '#2' 가 떨어져 원래 첫 번째 키를 물려받는다
    expect(result).toMatchObject({ keyMigration: { 'msg:A->B:hi': 'msg:A->B:hello', 'msg:A->B:hi#2': 'msg:A->B:hi' } });
  });

  it("':' 가 없는 메시지에 텍스트를 추가한다", () => {
    const source = 'sequenceDiagram\nA->>B';
    const m = parseSequenceDiagram(source).model!;
    expect(run(source, () => editStatementText(m, messages(m)[0]!.key, 'ping')).text).toBe('sequenceDiagram\nA->>B: ping');
  });

  it('노트·프래그먼트·빈 라벨 섹션 편집', () => {
    const source = 'sequenceDiagram\nloop every sec\nA->>B: x\nend\nNote left of A: n';
    const m = parseSequenceDiagram(source).model!;
    const fragKey = m.statements.find((s) => s.type === 'fragmentStart')!;
    expect(fragKey.type === 'fragmentStart' && run(source, () => editStatementText(m, fragKey.fragment.key, 'forever')).text).toContain('loop forever');
    const noteKey = m.statements.find((s) => s.type === 'note')!;
    expect(noteKey.type === 'note' && run(source, () => editStatementText(m, noteKey.note.key, 'memo')).text).toContain('Note left of A: memo');

    const alt = 'sequenceDiagram\nalt ok\nA->>B: x\nelse\nA->>B: y\nend';
    const altModel = parseSequenceDiagram(alt).model!;
    const section = altModel.statements.find((s) => s.type === 'fragmentSection')!;
    expect(section.type === 'fragmentSection' && run(alt, () => editStatementText(altModel, section.section.key, 'fail')).text).toContain('else fail');
  });
});

describe('sequence layout', () => {
  it('메시지는 위에서 아래로 순서대로 쌓이고 참여자 중심선을 잇는다', () => {
    const m = model('A->>B: one\nB->>C: two\nC-->>A: three');
    const nodes = place(m);
    const seq = layoutSequence({ model: m, nodes, ...ctx });
    const ys = seq.messages.map((msg) => msg.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    const cx = (id: string) => nodes[id]!.x + nodes[id]!.w / 2;
    expect(seq.messages[0]).toMatchObject({ x1: cx('A'), x2: cx('B') });
    expect(seq.lifelines).toHaveLength(3);
    expect(seq.footers).toHaveLength(3);
  });

  it('글자 크기를 키우면 해당 행이 높아진다', () => {
    const m = model('A->>B: one\nA->>B: two');
    const nodes = place(m);
    const small = layoutSequence({ model: m, nodes, ...ctx });
    const big = layoutSequence({ model: m, nodes, fontSizePt: 12, textStyles: { 'msg:A->B:one/text': { fontSize: 28 } } });
    expect(big.messages[1]!.y - big.messages[0]!.y).toBeGreaterThan(0);
    expect(big.messages[0]!.y).toBeGreaterThan(small.messages[0]!.y);
  });

  it('활성화 구간과 화살표 끝이 활성화 상자 가장자리에 붙는다', () => {
    const m = model('A->>+B: req\nB-->>-A: res');
    const nodes = place(m);
    const seq = layoutSequence({ model: m, nodes, ...ctx });
    expect(seq.activations).toHaveLength(1);
    const cxB = nodes.B!.x + nodes.B!.w / 2;
    expect(seq.messages[0]!.x2).toBe(cxB - SEQ.activationW / 2);
    expect(seq.activations[0]!.h).toBe(seq.messages[1]!.y - seq.messages[0]!.y);
  });

  it('중첩 프래그먼트는 바깥이 안쪽을 감싼다', () => {
    const m = model('loop outer\n  opt inner\n    A->>B: x\n  end\nend');
    const seq = layoutSequence({ model: m, nodes: place(m), ...ctx });
    const outer = seq.fragments.find((f) => f.kind === 'loop')!;
    const inner = seq.fragments.find((f) => f.kind === 'opt')!;
    expect(outer.x).toBeLessThan(inner.x);
    expect(outer.x + outer.w).toBeGreaterThan(inner.x + inner.w);
    expect(outer.y).toBeLessThan(inner.y);
    expect(outer.y + outer.h).toBeGreaterThan(inner.y + inner.h);
  });

  it('노트 위치: left/right/over 여러 참여자', () => {
    const m = model('A->>B: x\nNote left of A: l\nNote right of B: r\nNote over A,B: both');
    const nodes = place(m);
    const seq = layoutSequence({ model: m, nodes, ...ctx });
    const cxA = nodes.A!.x + nodes.A!.w / 2;
    const cxB = nodes.B!.x + nodes.B!.w / 2;
    const [left, right, over] = seq.notes;
    expect(left!.x + left!.w).toBeLessThanOrEqual(cxA);
    expect(right!.x).toBeGreaterThanOrEqual(cxB);
    expect(over!.x).toBeLessThan(cxA);
    expect(over!.x + over!.w).toBeGreaterThan(cxB);
  });
});

describe('sequence reconcile', () => {
  it('신규 참여자는 선언 순서대로 겹치지 않게 한 줄에 놓인다', () => {
    const nodes = place(model('A->>B: x\nB->>C: y'));
    const [a, b, c] = [nodes.A!, nodes.B!, nodes.C!];
    expect(new Set([a.y, b.y, c.y])).toEqual(new Set([SEQ.top]));
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(b.x + b.w).toBeLessThan(c.x);
  });

  it('중간에 새 참여자가 끼어들어도 기존 참여자는 0px 도 움직이지 않는다 (명세 NFR-04)', () => {
    const first = place(model('A->>C: x'));
    const next = reconcileSequence({
      model: model('participant A\nparticipant B\nparticipant C\nA->>C: x'), prevModel: null, nodes: first, trash: {}, measure: (p) => measureParticipant(p, ctx),
    }).nodes;
    expect(next.A).toMatchObject({ x: first.A!.x, y: first.A!.y });
    expect(next.C).toMatchObject({ x: first.C!.x, y: first.C!.y });
    // A–C 사이에 자리가 없으므로 줄 맨 오른쪽 빈 곳에 놓인다
    expect(next.B!.x).toBeGreaterThan(next.C!.x + next.C!.w);
  });

  it('사용자가 옮긴 x 는 유지하고 y 는 머리 줄로 맞춘다', () => {
    const m = model('A->>B: x');
    const nodes = { A: { x: 500, y: 300, w: 100, h: 40 }, B: { x: 800, y: 10, w: 100, h: 40 } };
    const result = reconcileSequence({ model: m, prevModel: null, nodes, trash: {}, measure: (p) => measureParticipant(p, ctx) }).nodes;
    expect(result.A).toMatchObject({ x: 500, y: SEQ.top });
    expect(result.B).toMatchObject({ x: 800, y: SEQ.top });
  });
});

describe('contrastTextOn', () => {
  it('밝은 배경에는 어두운 글자, 어두운 배경에는 밝은 글자 (다크 모드 가독성 회귀)', async () => {
    const { contrastTextOn } = await import('../../theme');
    expect(contrastTextOn('#fff8c4')).toBe('#1f2937');
    expect(contrastTextOn('#1e3a5f')).toBe('#f9fafb');
    expect(contrastTextOn(undefined)).toBeUndefined();
    expect(contrastTextOn('rgb(1,2,3)')).toBeUndefined();
  });
});

describe('빈 메시지 편집', () => {
  it('텍스트를 비우면 콜론까지 지운다 (A->>B: 로 남지 않는다)', () => {
    const source = 'sequenceDiagram\nA->>B: hi\nB-->>A:   ok';
    const m = parseSequenceDiagram(source).model!;
    const first = editStatementText(m, messages(m)[0]!.key, '', source);
    expect(first.ok && applyTextEdits(source, first.edits)).toBe('sequenceDiagram\nA->>B\nB-->>A:   ok');
    const second = editStatementText(m, messages(m)[1]!.key, '  ', source);
    expect(second.ok && applyTextEdits(source, second.edits)).toBe('sequenceDiagram\nA->>B: hi\nB-->>A');
    // 비운 결과도 다시 파싱된다
    const reparsed = parseSequenceDiagram('sequenceDiagram\nA->>B\nB-->>A');
    expect(reparsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
