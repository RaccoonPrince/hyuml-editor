import type { NodeId, TextEdit } from '../types';
import type { EditResult } from './editResult';
import { NOOP_EDIT } from './editResult';
import type { DiagramModel } from './registry';
import { isColorToken } from './sequence/boxes';

/**
 * 그룹 생성·해제·이름 변경 → 코드 편집 (명세 FR-14·15).
 *   class    → namespace Name { class A … }
 *   sequence → box Label … end (참여자 선언을 box 안으로 옮김)
 *   usecase  → systemBoundary Id[Label] … end
 */

const CLASS_NS_RE = /^[A-Za-z_][\w.]*$/;
const IDENT_RE = /^[A-Za-z_][\w-]*$/;
/** 파서의 클래스 식별자 규칙과 같아야 한다 (class/parser.ts 의 ID) — 아니면 백틱으로 감싼다 */
const CLASS_ID_RE = /^[A-Za-z_]\w*(?:-\w+)*$/;
const classRef = (id: string) => (CLASS_ID_RE.test(id) ? id : `\`${id}\``);

function appendBlock(source: string, block: string): TextEdit {
  const prefix = source.length === 0 || source.endsWith('\n') ? '' : '\n';
  return { start: source.length, end: source.length, text: `${prefix}${block}` };
}

function groupsOf(model: DiagramModel) {
  return model.groups;
}

export function createGroup(model: DiagramModel, source: string, memberIds: readonly NodeId[], rawName: string): EditResult {
  const name = rawName.trim();
  const members = [...new Set(memberIds)];
  if (members.length === 0) return { ok: false, reason: '그룹으로 묶을 도형을 먼저 선택하세요. (캔버스에서 드래그로 여러 개 선택)' };
  if (!name) return { ok: false, reason: '그룹 이름을 입력하세요.' };
  if (/[\n{}"]/.test(name)) return { ok: false, reason: '그룹 이름에 줄바꿈, 중괄호, 따옴표는 쓸 수 없습니다.' };
  const taken = members.filter((id) => groupsOf(model).some((group) => group.members.includes(id)));
  if (taken.length > 0) return { ok: false, reason: `이미 다른 그룹에 속한 도형이 있습니다: ${taken.join(', ')} — 먼저 그룹을 해제하세요.` };

  switch (model.kind) {
    case 'class': {
      if (!CLASS_NS_RE.test(name)) return { ok: false, reason: '클래스 다이어그램의 그룹(namespace) 이름은 영문·숫자·_·. 만 쓸 수 있습니다.' };
      if (model.groups.some((group) => group.id === name)) return { ok: false, reason: `'${name}' 그룹이 이미 있습니다.` };
      const ordered = model.nodes.filter((node) => members.includes(node.id)).map((node) => node.id);
      return { ok: true, edits: [appendBlock(source, `namespace ${name} {\n${ordered.map((id) => `  class ${classRef(id)}`).join('\n')}\n}\n`)] };
    }
    case 'usecase': {
      const id = IDENT_RE.test(name) ? name : `Boundary${model.groups.length + 1}`;
      if (model.groups.some((group) => group.id === id)) return { ok: false, reason: `'${id}' 그룹이 이미 있습니다.` };
      const header = id === name ? `systemBoundary ${id}` : `systemBoundary ${id}[${name}]`;
      const lines = model.nodes.filter((node) => members.includes(node.id))
        .map((node) => (node.type === 'actor' ? `  actor ${node.quoted ? `"${node.id}"` : node.id}` : `  ${node.quoted ? `"${node.id}"` : node.id}`));
      return { ok: true, edits: [appendBlock(source, `${header}\n${lines.join('\n')}\nend\n`)] };
    }
    case 'sequence': {
      const selected = model.participants.filter((participant) => members.includes(participant.id));
      const edits: TextEdit[] = [];
      const lines: string[] = [];
      for (const participant of selected) {
        if (participant.declLine) {
          edits.push({ ...participant.declLine.range, text: '' });
          lines.push(`  ${participant.declLine.text}`);
        } else {
          lines.push(`  ${participant.type} ${participant.id}`);
        }
      }
      // 라벨 첫 단어가 색 이름이면 Mermaid 가 색으로 읽으므로 transparent 를 앞에 둔다
      const firstWord = name.split(/\s+/)[0] ?? '';
      const header = `box ${isColorToken(firstWord) ? 'transparent ' : ''}${name}`;
      const headerMatch = /sequenceDiagram[^\n]*\n?/.exec(source);
      const insertAt = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
      const newline = insertAt > 0 && source[insertAt - 1] !== '\n' ? '\n' : '';
      edits.push({ start: insertAt, end: insertAt, text: `${newline}  ${header}\n${lines.map((line) => `  ${line}`).join('\n')}\n  end\n` });
      return { ok: true, edits };
    }
  }
}

export function removeGroup(model: DiagramModel, groupId: string): EditResult {
  const group = groupsOf(model).find((candidate) => candidate.id === groupId);
  if (!group) return { ok: false, reason: '해제할 그룹을 찾을 수 없습니다.' };
  if (!group.endLineRange) return { ok: false, reason: '그룹 블록이 닫혀 있지 않아 해제할 수 없습니다.' };
  return { ok: true, edits: [{ ...group.headerLineRange, text: '' }, { ...group.endLineRange, text: '' }] };
}

export function renameGroup(model: DiagramModel, groupId: string, rawName: string): EditResult {
  const group = groupsOf(model).find((candidate) => candidate.id === groupId);
  if (!group?.labelRange) return { ok: false, reason: '이름을 바꿀 그룹을 찾을 수 없습니다.' };
  const name = rawName.trim();
  if (!name || name === group.label) return NOOP_EDIT;
  if (/[\n{}"[\]()]/.test(name)) return { ok: false, reason: '그룹 이름에 줄바꿈, 괄호, 따옴표는 쓸 수 없습니다.' };
  if (model.kind === 'class' && !CLASS_NS_RE.test(name)) return { ok: false, reason: 'namespace 이름은 영문·숫자·_·. 만 쓸 수 있습니다.' };
  if (model.kind === 'usecase' && group.labelRange.start === group.labelRange.end) return NOOP_EDIT;
  // usecase: 라벨이 없고 식별자만 있는데 공백 이름이면 [라벨] 추가
  if (model.kind === 'usecase' && group.label === group.id && !IDENT_RE.test(name)) {
    return { ok: true, edits: [{ start: group.labelRange.end, end: group.labelRange.end, text: `[${name}]` }] };
  }
  const empty = group.labelRange.start === group.labelRange.end;
  return { ok: true, edits: [{ ...group.labelRange, text: empty ? ` ${name}` : name }] };
}
