import type { Diagnostic, Direction, SourceRange } from '../../types';
import type { EndKind, LineStyle } from '../class/model';
import { classifyRelation } from '../class/notation';
import type { DiagramGroup } from '../groups';
import type { ParseResult } from '../registry';
import type { UsecaseEdge, UsecaseModel, UsecaseNode } from './model';

/**
 * Mermaid 12 `usecase-beta` 문법의 자체 파서 (동기·순수, throw 없음).
 *   actor A, B            actor User(사용자)         "Quoted name"
 *   Login(로그인)          Report[보고서]              systemBoundary Shop[쇼핑몰] … end
 *   A --> B   A <-- B   A -- B   A --o B   A --x B   A -- label --> B
 *   A ..>:include B       A ..>:extend B            A --|> B
 */

const ID = String.raw`[A-Za-z_][\w-]*`;
/** 그룹 5개: 따옴표 이름 | 식별자 | (라벨) | [라벨] | <<스테레오타입>> */
const ENTITY = String.raw`(?:"([^"]*)"|(${ID})(?:\(([^)]*)\)|\[([^\]]*)\])?)(?:\s*@\{[^}]*\})?(?:\s*<<([^>]*)>>)?(?::::[\w-]+)?`;
const UNLABELED = String.raw`(--\|>|\.\.>\s*:\s*(?:include|extend)|--+>|<--+|--o(?=\s)|(?<=\s)o--|--x(?=\s)|(?<=\s)x--|--+)`;

const HEADER_RE = /^\s*usecase(?:-beta)?\s*$/;
const DIRECTION_RE = /^\s*direction\s+(TB|TD|BT|LR|RL)\s*$/;
const LABELED_RE = new RegExp(String.raw`^\s*${ENTITY}\s*(<--|(?<=\s)o--|(?<=\s)x--|--)\s+(.+?)\s+(--+>|--o|--x|--+)\s*${ENTITY}\s*$`, 'd');
const RELATION_RE = new RegExp(String.raw`^\s*${ENTITY}\s*${UNLABELED}\s*${ENTITY}\s*$`, 'd');
const ENTITY_LINE_RE = new RegExp(String.raw`^\s*${ENTITY}\s*$`, 'd');
const ACTOR_RE = /^(\s*actor\s+)(.+)$/;
const BOUNDARY_RE = new RegExp(String.raw`^\s*systemBoundary\s+${ENTITY}\s*$`, 'd');
const END_RE = /^\s*end\s*$/;
const IGNORED_RE = /^\s*(?:note|json|classDef|class|style|accTitle|accDescr|click)\b|^\s*[\w"]+\s*@\{/;

interface Line { text: string; start: number }

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of source.split('\n')) {
    lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start });
    start += raw.length + 1;
  }
  return lines;
}

function range(match: RegExpExecArray, group: number, offset: number): SourceRange | undefined {
  const indices = match.indices?.[group];
  return indices ? { start: offset + indices[0], end: offset + indices[1] } : undefined;
}

interface EntityRef { id: string; label?: string; labelRange?: SourceRange; idRange: SourceRange; shape: UsecaseNode['shape']; stereotype?: string; quoted: boolean }

/** ENTITY 그룹(시작 번호 base)에서 이름·라벨 추출 */
function entityAt(match: RegExpExecArray, base: number, offset: number): EntityRef | undefined {
  const quoted = match[base];
  const id = match[base + 1];
  const paren = match[base + 2];
  const bracket = match[base + 3];
  const stereotype = match[base + 4]?.trim();
  if (quoted !== undefined) {
    return { id: quoted.trim(), idRange: range(match, base, offset)!, shape: 'ellipse', quoted: true, ...(stereotype ? { stereotype } : {}) };
  }
  if (!id) return undefined;
  const labelGroup = paren !== undefined ? base + 2 : bracket !== undefined ? base + 3 : -1;
  return {
    id,
    idRange: range(match, base + 1, offset)!,
    shape: bracket !== undefined ? 'rect' : 'ellipse',
    quoted: false,
    ...(labelGroup > 0 ? { label: (paren ?? bracket)!.trim(), labelRange: range(match, labelGroup, offset)! } : {}),
    ...(stereotype ? { stereotype } : {}),
  };
}

/** 쉼표로 나누되 따옴표/괄호 안의 쉼표는 무시 */
function splitTopLevel(text: string): { part: string; offset: number }[] {
  const parts: { part: string; offset: number }[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') quote = !quote;
    else if (!quote && (char === '(' || char === '[' || char === '{')) depth += 1;
    else if (!quote && (char === ')' || char === ']' || char === '}')) depth -= 1;
    else if (!quote && depth === 0 && char === ',') {
      parts.push({ part: text.slice(start, index), offset: start });
      start = index + 1;
    }
  }
  parts.push({ part: text.slice(start), offset: start });
  return parts;
}

const END_BY_TOKEN: Record<string, EndKind> = { '<': 'arrow', '>': 'arrow', o: 'lollipop', x: 'cross' };

export function parseUsecaseDiagram(source: string): ParseResult<UsecaseModel> {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map<string, UsecaseNode>();
  const edges: UsecaseEdge[] = [];
  const groups: DiagramGroup[] = [];
  const edgeIds = new Map<string, number>();
  let direction: Direction = 'LR';
  let openGroup: DiagramGroup | null = null;

  const ensure = (entity: EntityRef, asActor: boolean): UsecaseNode => {
    let node = nodes.get(entity.id);
    if (!node) {
      node = { id: entity.id, label: entity.id, type: asActor ? 'actor' : 'usecase', shape: entity.shape, refs: [], quoted: entity.quoted, declIdEnd: entity.idRange.end };
      nodes.set(entity.id, node);
    }
    if (asActor) node.type = 'actor';
    node.refs.push(entity.idRange);
    if (entity.label !== undefined && !node.labelRange) {
      node.label = entity.label;
      node.labelRange = entity.labelRange;
      node.shape = entity.shape;
    }
    if (entity.stereotype) node.stereotype ??= entity.stereotype;
    if (openGroup && !openGroup.members.includes(node.id)) openGroup.members.push(node.id);
    return node;
  };

  const addEdge = (from: EntityRef, to: EntityRef, leftToken: string, rightToken: string, semantic: string | undefined, arrowRange: SourceRange, lineRange: SourceRange, label?: { text: string; range: SourceRange }, fromIsActor = false) => {
    // 관계 안의 참조는 그룹 구성원으로 치지 않는다 (systemBoundary 안에는 선언만 온다)
    const group = openGroup;
    openGroup = null;
    const source = ensure(from, fromIsActor).id;
    const target = ensure(to, false).id;
    openGroup = group;

    let ends: UsecaseEdge['ends'];
    let line: LineStyle = 'solid';
    let stereotype: string | undefined;
    if (semantic === 'generalization') ends = { source: 'none', target: 'triangle' };
    else if (semantic) {
      ends = { source: 'none', target: 'arrow' };
      line = 'dotted';
      stereotype = `«${semantic}»`;
    } else {
      ends = { source: END_BY_TOKEN[leftToken[0] ?? ''] ?? 'none', target: END_BY_TOKEN[rightToken[rightToken.length - 1] ?? ''] ?? 'none' };
    }
    const semantics = classifyRelation(ends, line);
    const relationType = stereotype ? 'dependency' : semantics.relationType;
    const base = `${source}|${stereotype ?? relationType}|${target}${label ? `|${label.text}` : ''}`;
    const count = (edgeIds.get(base) ?? 0) + 1;
    edgeIds.set(base, count);
    edges.push({
      id: count === 1 ? base : `${base}#${count}`,
      source, target, ends, line, relationType,
      ...(stereotype ? { stereotype, parentEnd: 'source' as const } : semantics.parentEnd ? { parentEnd: semantics.parentEnd } : {}),
      ...(label ? { label: label.text, labelRange: label.range } : {}),
      range: lineRange,
      arrowRange,
      leftToken,
      rightToken,
      semantic: semantic !== undefined,
    });
  };

  /** 한 줄에서 관계를 찾아 추가. 성공하면 true */
  const tryRelation = (text: string, offset: number, lineRange: SourceRange, fromIsActor: boolean): boolean => {
    const labeled = LABELED_RE.exec(text);
    if (labeled) {
      const from = entityAt(labeled, 1, offset);
      const to = entityAt(labeled, 9, offset);
      if (from && to) {
        const arrowStart = offset + labeled.indices![6]![0];
        const arrowEnd = offset + labeled.indices![8]![1];
        addEdge(from, to, labeled[6]!, labeled[8]!, undefined, { start: arrowStart, end: arrowEnd }, lineRange, { text: labeled[7]!.trim(), range: range(labeled, 7, offset)! }, fromIsActor);
        return true;
      }
    }
    const relation = RELATION_RE.exec(text);
    if (!relation) return false;
    const from = entityAt(relation, 1, offset);
    const to = entityAt(relation, 7, offset);
    if (!from || !to) return false;
    const token = relation[6]!.replace(/\s+/g, '');
    const arrowRange = range(relation, 6, offset)!;
    if (token === '--|>') addEdge(from, to, '--', '--|>', 'generalization', arrowRange, lineRange, undefined, fromIsActor);
    else if (token.startsWith('..>')) addEdge(from, to, '..>', token, token.endsWith('include') ? 'include' : 'extend', arrowRange, lineRange, undefined, fromIsActor);
    else if (token.startsWith('<')) addEdge(from, to, '<--', '--', undefined, arrowRange, lineRange, undefined, fromIsActor);
    else if (token === 'o--' || token === 'x--') addEdge(from, to, token, '--', undefined, arrowRange, lineRange, undefined, fromIsActor);
    else addEdge(from, to, '--', token.endsWith('>') ? '-->' : token === '--o' || token === '--x' ? token : '--', undefined, arrowRange, lineRange, undefined, fromIsActor);
    return true;
  };

  const lines = splitLines(source);
  let index = 0;
  if (lines[0]?.text.trim() === '---') {
    const close = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.text.trim() === '---');
    index = close < 0 ? lines.length : close + 1;
  }
  let headerFound = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (HEADER_RE.test(line.text)) { headerFound = true; index += 1; }
    else diagnostics.push({ message: `'usecase-beta' 헤더가 필요합니다. (현재: '${trimmed.slice(0, 40)}')`, range: { start: line.start, end: line.start + line.text.length }, severity: 'error', source: 'parser' });
    break;
  }
  if (!headerFound) {
    if (diagnostics.length === 0) diagnostics.push({ message: 'usecase-beta 헤더가 없습니다.', range: { start: 0, end: 0 }, severity: 'error', source: 'parser' });
    return { model: null, diagnostics };
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text.trim();
    const lineRange = { start: line.start, end: Math.min(source.length, line.start + line.text.length + 1) };
    if (!trimmed || trimmed.startsWith('%%')) continue;

    const directionMatch = DIRECTION_RE.exec(line.text);
    if (directionMatch) { direction = directionMatch[1] === 'TD' ? 'TB' : directionMatch[1] as Direction; continue; }

    if (END_RE.test(line.text)) {
      if (openGroup) { openGroup.endLineRange = lineRange; openGroup = null; }
      else diagnostics.push({ message: "짝이 맞지 않는 'end' 입니다.", range: lineRange, severity: 'error', source: 'parser' });
      continue;
    }

    const boundary = BOUNDARY_RE.exec(line.text);
    if (boundary) {
      const entity = entityAt(boundary, 1, line.start);
      if (entity) {
        if (openGroup) diagnostics.push({ message: 'systemBoundary 는 중첩할 수 없습니다.', range: lineRange, severity: 'warning', source: 'parser' });
        const group: DiagramGroup = {
          id: entity.id,
          label: entity.label ?? entity.id,
          members: [],
          labelRange: entity.labelRange ?? entity.idRange,
          headerLineRange: lineRange,
        };
        groups.push(group);
        openGroup = group;
      }
      continue;
    }

    const actor = ACTOR_RE.exec(line.text);
    if (actor) {
      const restOffset = line.start + actor[1]!.length;
      if (tryRelation(actor[2]!, restOffset, lineRange, true)) continue;
      for (const { part, offset } of splitTopLevel(actor[2]!)) {
        const match = ENTITY_LINE_RE.exec(part);
        const entity = match && entityAt(match, 1, restOffset + offset);
        if (entity) ensure(entity, true);
        else if (part.trim()) diagnostics.push({ message: `actor 이름을 읽을 수 없습니다: '${part.trim()}'`, range: lineRange, severity: 'warning', source: 'parser' });
      }
      continue;
    }

    if (IGNORED_RE.test(line.text)) continue;
    if (tryRelation(line.text, line.start, lineRange, false)) continue;

    const entityLine = ENTITY_LINE_RE.exec(line.text);
    if (entityLine) {
      const entity = entityAt(entityLine, 1, line.start);
      if (entity) { ensure(entity, false); continue; }
    }

    diagnostics.push({
      message: `인식할 수 없는 구문입니다: '${trimmed.slice(0, 60)}'`,
      range: { start: line.start + (line.text.length - line.text.trimStart().length), end: line.start + line.text.trimEnd().length },
      severity: 'warning',
      source: 'parser',
    });
  }

  if (openGroup) {
    diagnostics.push({ message: `systemBoundary '${openGroup.id}' 가 'end' 로 닫히지 않았습니다.`, range: openGroup.headerLineRange, severity: 'error', source: 'parser' });
  }

  return { model: { kind: 'usecase', direction, nodes: [...nodes.values()], edges, groups }, diagnostics };
}
