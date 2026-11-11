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

/** 문서 본문의 들여쓰기 — 헤더 다음 첫 실제 줄의 앞 공백. 본문이 없으면 두 칸 */
function baseIndent(source: string): string {
  let seenHeader = false;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('%%') || trimmed === '---') continue;
    if (!seenHeader) { seenHeader = true; continue; }
    return /^[ \t]*/.exec(line)![0];
  }
  return '  ';
}

function groupsOf(model: DiagramModel) {
  return model.groups;
}

export function createGroup(model: DiagramModel, source: string, memberIds: readonly NodeId[], rawName: string): EditResult {
  const name = rawName.trim();
  const members = [...new Set(memberIds)];
  if (members.length === 0) return { ok: false, reason: '그룹으로 묶을 도형을 먼저 선택하세요. (캔버스에서 Ctrl + 드래그로 여러 개 선택)' };
  if (!name) return { ok: false, reason: '그룹 이름을 입력하세요.' };
  if (/[\n{}"]/.test(name)) return { ok: false, reason: '그룹 이름에 줄바꿈, 중괄호, 따옴표는 쓸 수 없습니다.' };
  const taken = members.filter((id) => groupsOf(model).some((group) => group.members.includes(id)));
  if (taken.length > 0) return { ok: false, reason: `이미 다른 그룹에 속한 도형이 있습니다: ${taken.join(', ')} — 먼저 그룹을 해제하세요.` };

  const ind = baseIndent(source);
  switch (model.kind) {
    case 'class': {
      if (!CLASS_NS_RE.test(name)) return { ok: false, reason: '클래스 다이어그램의 그룹(namespace) 이름은 영문·숫자·_·. 만 쓸 수 있습니다.' };
      if (model.groups.some((group) => group.id === name)) return { ok: false, reason: `'${name}' 그룹이 이미 있습니다.` };
      const ordered = model.nodes.filter((node) => members.includes(node.id)).map((node) => node.id);
      return { ok: true, edits: [appendBlock(source, `${ind}namespace ${name} {\n${ordered.map((id) => `${ind}  class ${classRef(id)}`).join('\n')}\n${ind}}\n`)] };
    }
    case 'usecase': {
      const id = IDENT_RE.test(name) ? name : `Boundary${model.groups.length + 1}`;
      if (model.groups.some((group) => group.id === id)) return { ok: false, reason: `'${id}' 그룹이 이미 있습니다.` };
      const header = id === name ? `${ind}systemBoundary ${id}` : `${ind}systemBoundary ${id}[${name}]`;
      const lines = model.nodes.filter((node) => members.includes(node.id))
        .map((node) => (node.type === 'actor' ? `${ind}  actor ${node.quoted ? `"${node.id}"` : node.id}` : `${ind}  ${node.quoted ? `"${node.id}"` : node.id}`));
      return { ok: true, edits: [appendBlock(source, `${header}\n${lines.join('\n')}\n${ind}end\n`)] };
    }
    case 'sequence': {
      const selected = model.participants.filter((participant) => members.includes(participant.id));
      const edits: TextEdit[] = [];
      const lines: string[] = [];
      for (const participant of selected) {
        if (participant.declLine) {
          edits.push({ ...participant.declLine.range, text: '' });
          lines.push(participant.declLine.text);
        } else {
          lines.push(`${participant.type} ${participant.id}`);
        }
      }
      // 라벨 첫 단어가 색 이름이면 Mermaid 가 색으로 읽으므로 transparent 를 앞에 둔다
      const firstWord = name.split(/\s+/)[0] ?? '';
      const header = `box ${isColorToken(firstWord) ? 'transparent ' : ''}${name}`;
      const headerMatch = /sequenceDiagram[^\n]*\n?/.exec(source);
      const insertAt = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
      const newline = insertAt > 0 && source[insertAt - 1] !== '\n' ? '\n' : '';
      edits.push({ start: insertAt, end: insertAt, text: `${newline}${ind}${header}\n${lines.map((line) => `${ind}  ${line}`).join('\n')}\n${ind}end\n` });
      return { ok: true, edits };
    }
  }
}

export function removeGroup(model: DiagramModel, groupId: string, source?: string): EditResult {
  const group = groupsOf(model).find((candidate) => candidate.id === groupId);
  if (!group) return { ok: false, reason: '해제할 그룹을 찾을 수 없습니다.' };
  if (!group.endLineRange) return { ok: false, reason: '그룹 블록이 닫혀 있지 않아 해제할 수 없습니다.' };
  const edits: TextEdit[] = [{ ...group.headerLineRange, text: '' }, { ...group.endLineRange, text: '' }];
  if (source) {
    // 블록 안쪽 줄은 한 단계(공백 2칸 또는 탭 1개) 내어쓴다 — 해제 후에도 들여쓰기가 깔끔하도록
    let offset = group.headerLineRange.end;
    for (const line of source.slice(group.headerLineRange.end, group.endLineRange.start).split('\n')) {
      const lead = /^(?: {1,2}|\t)/.exec(line);
      if (lead) edits.push({ start: offset, end: offset + lead[0].length, text: '' });
      offset += line.length + 1;
    }
  }
  return { ok: true, edits };
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
