import type { NodeId, SourceRange, TextEdit } from '../../types';
import type { EditResult } from '../editResult';
import { NOOP_EDIT } from '../editResult';
import { assignKeys, keyMapping } from './keys';
import type { SeqStatement, SequenceModel } from './model';

/** 이름을 바꿀 때 식별자로 그대로 쓸 수 있는 형태 (한글 포함). 공백 등이 있으면 별칭(as)을 쓴다. */
const ACTOR_ID_RE = /^[\p{L}\p{N}_]+$/u;
const FORBIDDEN_TEXT_RE = /[\n;#]/;

function dedupe(ranges: SourceRange[]): SourceRange[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function renameParticipant(model: SequenceModel, source: string, id: NodeId, rawName: string): EditResult {
  const participant = model.participants.find((candidate) => candidate.id === id);
  if (!participant) return { ok: false, reason: `참여자 '${id}' 를 찾을 수 없습니다.` };
  const name = rawName.trim();
  if (!name || name === participant.label) return NOOP_EDIT;
  if (FORBIDDEN_TEXT_RE.test(name) || /[:,]/.test(name)) return { ok: false, reason: "참여자 이름에 줄바꿈, ':', ',', ';', '#' 은 쓸 수 없습니다." };

  // 1) 별칭이 있으면 별칭만 바꾼다
  if (participant.aliasRange) return { ok: true, edits: [{ ...participant.aliasRange, text: name }] };

  // 2) 식별자로 쓸 수 있는 이름 → 모든 참조를 리네임 (+ 문장 키 이전)
  if (ACTOR_ID_RE.test(name)) {
    if (model.participants.some((candidate) => candidate.id === name)) return { ok: false, reason: `'${name}' 참여자가 이미 존재합니다.` };
    const renamed = assignKeys(model.statements.map((statement) => renameInStatement(statement, id, name)));
    return {
      ok: true,
      edits: dedupe(participant.refs).map((range) => ({ ...range, text: name })),
      renamedNode: { from: id, to: name },
      keyMigration: keyMapping(model.statements, renamed),
    };
  }

  // 3) 공백 등이 있는 이름 → 식별자는 유지하고 `as 별칭` 추가
  if (participant.declIdEnd !== undefined) {
    return { ok: true, edits: [{ start: participant.declIdEnd, end: participant.declIdEnd, text: ` as ${name}` }] };
  }
  // 선언 없이 메시지로만 등장 → 헤더 바로 다음 줄에 선언을 추가
  const headerEnd = source.search(/sequenceDiagram[^\n]*\n?/);
  const insertAt = headerEnd < 0 ? 0 : headerEnd + (/sequenceDiagram[^\n]*\n?/.exec(source)?.[0].length ?? 0);
  const newline = source[insertAt - 1] === '\n' ? '' : '\n';
  const keyword = participant.type === 'actor' ? 'actor' : 'participant';
  return { ok: true, edits: [{ start: insertAt, end: insertAt, text: `${newline}  ${keyword} ${id} as ${name}\n` }] };
}

function renameInStatement(statement: SeqStatement, from: NodeId, to: NodeId): SeqStatement {
  const swap = (value: NodeId) => (value === from ? to : value);
  switch (statement.type) {
    case 'message':
      return { ...statement, message: { ...statement.message, from: swap(statement.message.from), to: swap(statement.message.to) } };
    case 'note':
      return { ...statement, note: { ...statement.note, actors: statement.note.actors.map(swap) } };
    case 'activate':
    case 'deactivate':
    case 'destroy':
      return { ...statement, actor: swap(statement.actor) };
    default:
      return statement;
  }
}

/** 메시지·노트·프래그먼트·섹션 라벨 편집. key 로 대상을 찾는다. */
export function editStatementText(model: SequenceModel, key: string, rawText: string): EditResult {
  const text = rawText.trim();
  if (FORBIDDEN_TEXT_RE.test(text)) return { ok: false, reason: "텍스트에 줄바꿈, ';', '#' 은 쓸 수 없습니다. 줄바꿈은 <br> 로 입력하세요." };

  const index = model.statements.findIndex((statement) =>
    (statement.type === 'message' && statement.message.key === key)
    || (statement.type === 'note' && statement.note.key === key)
    || (statement.type === 'fragmentStart' && statement.fragment.key === key)
    || (statement.type === 'fragmentSection' && statement.section.key === key));
  const target = model.statements[index];
  if (!target) return { ok: false, reason: '편집할 항목을 찾을 수 없습니다.' };

  let edit: TextEdit;
  let updated: SeqStatement;
  switch (target.type) {
    case 'message': {
      const { message } = target;
      if (text === message.text) return NOOP_EDIT;
      edit = message.textRange
        ? { ...message.textRange, text }
        : { start: message.textInsertAt!, end: message.textInsertAt!, text: `: ${text}` };
      updated = { ...target, message: { ...message, text } };
      break;
    }
    case 'note':
      if (text === target.note.text) return NOOP_EDIT;
      edit = { ...target.note.textRange, text };
      updated = { ...target, note: { ...target.note, text } };
      break;
    case 'fragmentStart': {
      const { fragment } = target;
      if (text === fragment.label) return NOOP_EDIT;
      const empty = fragment.labelRange.start === fragment.labelRange.end;
      edit = { ...fragment.labelRange, text: empty && text ? ` ${text}` : text };
      updated = { ...target, fragment: { ...fragment, label: text } };
      break;
    }
    case 'fragmentSection': {
      const { section } = target;
      if (text === section.label) return NOOP_EDIT;
      const empty = section.labelRange.start === section.labelRange.end;
      edit = { ...section.labelRange, text: empty && text ? ` ${text}` : text };
      updated = { ...target, section: { ...section, label: text } };
      break;
    }
    default:
      return { ok: false, reason: '편집할 수 없는 항목입니다.' };
  }

  const next = model.statements.map((statement, statementIndex) => (statementIndex === index ? updated : statement));
  return { ok: true, edits: [edit], keyMigration: keyMapping(model.statements, assignKeys(next)) };
}
