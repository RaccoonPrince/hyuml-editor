import type { Diagnostic, Direction, SourceRange } from '../../types';
import type { DiagramGroup } from '../groups';
import type { ClassMember, ClassModel, ClassNodeModel, Classifier, EndKind, MemberKind, RelationEdge } from './model';
import { genericToDisplay } from './model';
import { classifyRelation, LEFT_END_TOKENS, RIGHT_END_TOKENS } from './notation';

/**
 * Mermaid classDiagram 문법의 자체 파서.
 * - 동기·순수 함수이며 절대 throw 하지 않는다 (오류는 diagnostics 로 반환).
 * - 모든 클래스 참조/멤버/라벨의 소스 범위를 기록해 캔버스 → 코드 편집을 정확한 TextEdit 으로 만든다.
 */

export interface ClassParseResult {
  model: ClassModel | null;
  diagnostics: Diagnostic[];
}

const ID = String.raw`(?:\`[^\`]+\`|[A-Za-z_]\w*(?:-\w+)*)`;
const GENERIC = String.raw`(~[^~]*~)?`;

const HEADER_RE = /^\s*classDiagram(?:-v2)?\s*$/;
const DIRECTION_RE = /^\s*direction\s+(TB|BT|LR|RL|TD)\s*$/;
const NAMESPACE_RE = new RegExp(String.raw`^\s*namespace\s+([\w.]+)\s*\{\s*$`, 'd');
const CLASS_RE = new RegExp(
  String.raw`^\s*class\s+(${ID})${GENERIC}(?:\s*\["([^"]*)"\])?(?::::[\w-]+)?\s*(\{)?(.*)$`,
  'd',
);
const ANNOTATION_RE = new RegExp(String.raw`^\s*<<([^>]+)>>\s+(${ID})\s*$`, 'd');
const RELATION_RE = new RegExp(
  String.raw`^\s*(${ID})${GENERIC}(?::::[\w-]+)?(?:\s+"([^"]*)")?\s*(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?\s*(?:"([^"]*)"\s*)?(${ID})${GENERIC}(?::::[\w-]+)?\s*(?::\s*(.*?))?\s*$`,
  'd',
);
const COLON_MEMBER_RE = new RegExp(String.raw`^\s*(${ID})${GENERIC}\s*:\s*(.*?)\s*$`, 'd');
const REF_KEYWORD_RE = new RegExp(String.raw`^\s*(?:note\s+for|style|click|link|callback)\s+(${ID})`, 'd');
const IGNORED_RE = /^\s*(?:note|classDef|cssClass|accTitle|accDescr|style|click|link|callback)\b/;

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

/** d 플래그 매치의 그룹 범위를 소스 오프셋으로 변환. 백틱 식별자는 내부 텍스트만 가리킨다. */
function groupRange(match: RegExpExecArray, group: number, lineStart: number): SourceRange | undefined {
  const indices = match.indices?.[group];
  if (!indices) return undefined;
  const text = match[group] ?? '';
  const trim = text.startsWith('`') && text.endsWith('`') && text.length >= 2 ? 1 : 0;
  return { start: lineStart + indices[0] + trim, end: lineStart + indices[1] - trim };
}

const unquoteId = (id: string) => (id.startsWith('`') && id.endsWith('`') ? id.slice(1, -1) : id);

function detectClassifier(text: string, kind: MemberKind): { display: string; classifier: Classifier } {
  if (kind === 'method') {
    const close = text.indexOf(')');
    const marker = text[close + 1];
    if (close >= 0 && (marker === '$' || marker === '*')) {
      return { display: text.slice(0, close + 1) + text.slice(close + 2), classifier: marker === '$' ? 'static' : 'abstract' };
    }
  }
  const last = text[text.length - 1];
  if (last === '$' || last === '*') {
    return { display: text.slice(0, -1).trimEnd(), classifier: last === '$' ? 'static' : 'abstract' };
  }
  return { display: text, classifier: undefined };
}

/** 화면에서 편집된 텍스트에 원래 classifier 기호를 복원한다 (edits.ts 에서 사용) */
export function restoreClassifier(display: string, kind: MemberKind, classifier: Classifier): string {
  if (!classifier) return display;
  const symbol = classifier === 'static' ? '$' : '*';
  if (kind === 'method') {
    const close = display.indexOf(')');
    if (close >= 0) return display.slice(0, close + 1) + symbol + display.slice(close + 1);
  }
  return `${display}${symbol}`;
}

/** Mermaid 와 동일한 규칙: ')' 가 첫 글자가 아닌 위치에 있으면 메서드 */
export const isMethodText = (text: string) => text.indexOf(')') > 0;

export function parseClassDiagram(source: string): ClassParseResult {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map<string, ClassNodeModel>();
  const edges: RelationEdge[] = [];
  const memberKeyCounts = new Map<string, Map<string, number>>();
  const edgeIdCounts = new Map<string, number>();
  let direction: Direction = 'TB';

  const ensureNode = (rawId: string, ref?: SourceRange): ClassNodeModel => {
    const id = unquoteId(rawId);
    let node = nodes.get(id);
    if (!node) {
      node = { id, label: id, attributes: [], methods: [], refs: [] };
      nodes.set(id, node);
    }
    if (ref) node.refs.push(ref);
    return node;
  };

  const addMember = (node: ClassNodeModel, rawText: string, range: SourceRange, lineRange?: SourceRange) => {
    const text = rawText.trim();
    if (!text) return;
    if (text.startsWith('<<') && text.endsWith('>>')) {
      node.stereotype ??= text.slice(2, -2).trim();
      return;
    }
    const kind: MemberKind = isMethodText(text) ? 'method' : 'attribute';
    const { display, classifier } = detectClassifier(text, kind);
    const baseKey = `${kind === 'method' ? 'm' : 'a'}:${display}`;
    const counts = memberKeyCounts.get(node.id) ?? new Map<string, number>();
    memberKeyCounts.set(node.id, counts);
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    const leading = rawText.length - rawText.trimStart().length;
    const member: ClassMember = {
      key: count === 1 ? baseKey : `${baseKey}#${count}`,
      kind,
      text,
      display: genericToDisplay(display),
      classifier,
      range: { start: range.start + leading, end: range.start + leading + text.length },
      ...(lineRange ? { lineRange } : {}),
    };
    (kind === 'method' ? node.methods : node.attributes).push(member);
  };

  const lines = splitLines(source);
  let index = 0;

  // 1) YAML frontmatter (--- … ---) 건너뛰기
  if (lines[0]?.text.trim() === '---') {
    const close = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.text.trim() === '---');
    index = close < 0 ? lines.length : close + 1;
  }

  // 2) 헤더
  let headerFound = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (HEADER_RE.test(line.text)) {
      headerFound = true;
      index += 1;
    } else {
      diagnostics.push({
        message: `'classDiagram' 헤더가 필요합니다. (현재: '${trimmed.slice(0, 40)}')`,
        range: { start: line.start, end: line.start + line.text.length },
        severity: 'error',
        source: 'parser',
      });
    }
    break;
  }
  if (!headerFound) {
    if (diagnostics.length === 0) {
      diagnostics.push({ message: 'classDiagram 헤더가 없습니다.', range: { start: 0, end: 0 }, severity: 'error', source: 'parser' });
    }
    return { model: null, diagnostics };
  }

  // 3) 본문
  let openClass: { node: ClassNodeModel; line: Line } | null = null;
  const groups: DiagramGroup[] = [];
  const openGroups: DiagramGroup[] = [];
  let skipBlock = false;

  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text.trim();
    const lineRange = { start: line.start, end: Math.min(source.length, line.start + line.text.length + 1) };
    if (!trimmed || trimmed.startsWith('%%')) continue;

    if (skipBlock) {
      if (trimmed.includes('}')) skipBlock = false;
      continue;
    }

    if (openClass) {
      const closeAt = line.text.indexOf('}');
      if (closeAt >= 0) {
        const before = line.text.slice(0, closeAt);
        if (before.trim()) addMember(openClass.node, before, { start: line.start, end: line.start + closeAt });
        openClass = null;
      } else {
        addMember(openClass.node, line.text, { start: line.start, end: line.start + line.text.length }, lineRange);
      }
      continue;
    }

    const directionMatch = DIRECTION_RE.exec(line.text);
    if (directionMatch) {
      direction = directionMatch[1] === 'TD' ? 'TB' : directionMatch[1] as Direction;
      continue;
    }

    const namespaceMatch = NAMESPACE_RE.exec(line.text);
    if (namespaceMatch) {
      const nameIndices = namespaceMatch.indices?.[1];
      const group: DiagramGroup = {
        id: namespaceMatch[1]!,
        label: namespaceMatch[1]!,
        members: [],
        ...(nameIndices ? { labelRange: { start: line.start + nameIndices[0], end: line.start + nameIndices[1] } } : {}),
        headerLineRange: lineRange,
      };
      groups.push(group);
      openGroups.push(group);
      continue;
    }
    if (trimmed === '}') {
      const group = openGroups.pop();
      if (group) group.endLineRange = lineRange;
      else diagnostics.push({ message: "짝이 맞지 않는 '}' 입니다.", range: lineRange, severity: 'error', source: 'parser' });
      continue;
    }

    const classMatch = CLASS_RE.exec(line.text);
    if (classMatch) {
      const idRange = groupRange(classMatch, 1, line.start)!;
      const node = ensureNode(classMatch[1]!, idRange);
      const currentGroup = openGroups[openGroups.length - 1];
      if (currentGroup && !currentGroup.members.includes(node.id)) currentGroup.members.push(node.id);
      node.declIdEnd ??= groupRange(classMatch, 2, line.start)?.end ?? idRange.end;
      const generic = classMatch[2]?.slice(1, -1);
      if (generic) node.generic = generic;
      if (classMatch[3] !== undefined) {
        node.label = classMatch[3];
        node.labelRange = groupRange(classMatch, 3, line.start);
      } else if (generic && node.label === node.id) {
        node.label = `${node.id}${genericToDisplay(`~${generic}~`)}`;
      }
      if (classMatch[4]) {
        const rest = classMatch[5] ?? '';
        const restStart = line.start + (classMatch.indices?.[5]?.[0] ?? line.text.length);
        const closeAt = rest.indexOf('}');
        if (closeAt >= 0) {
          addMember(node, rest.slice(0, closeAt), { start: restStart, end: restStart + closeAt });
        } else {
          addMember(node, rest, { start: restStart, end: restStart + rest.length });
          openClass = { node, line };
        }
      } else if ((classMatch[5] ?? '').trim()) {
        diagnostics.push({ message: `클래스 선언 뒤의 알 수 없는 내용: '${classMatch[5]!.trim()}'`, range: lineRange, severity: 'warning', source: 'parser' });
      }
      continue;
    }

    const annotationMatch = ANNOTATION_RE.exec(line.text);
    if (annotationMatch) {
      const node = ensureNode(annotationMatch[2]!, groupRange(annotationMatch, 2, line.start));
      node.stereotype ??= annotationMatch[1]!.trim();
      continue;
    }

    const relationMatch = RELATION_RE.exec(line.text);
    if (relationMatch) {
      edges.push(buildEdge(relationMatch, line, ensureNode, edgeIdCounts));
      continue;
    }

    const colonMatch = COLON_MEMBER_RE.exec(line.text);
    if (colonMatch) {
      const node = ensureNode(colonMatch[1]!, groupRange(colonMatch, 1, line.start));
      const memberRange = groupRange(colonMatch, 3, line.start)!;
      addMember(node, colonMatch[3] ?? '', memberRange, lineRange);
      continue;
    }

    const refMatch = REF_KEYWORD_RE.exec(line.text);
    if (refMatch) {
      const id = unquoteId(refMatch[1]!);
      // 참조 키워드는 존재하는 클래스만 가리킨다 — 새 노드를 만들지 않는다.
      const range = groupRange(refMatch, 1, line.start);
      if (nodes.has(id) && range) nodes.get(id)!.refs.push(range);
      continue;
    }
    if (IGNORED_RE.test(line.text)) {
      if (/^\s*accDescr\s*\{/.test(line.text) && !trimmed.includes('}')) skipBlock = true;
      continue;
    }

    diagnostics.push({
      message: `인식할 수 없는 구문입니다: '${trimmed.slice(0, 60)}'`,
      range: { start: line.start + (line.text.length - line.text.trimStart().length), end: line.start + line.text.trimEnd().length },
      severity: 'warning',
      source: 'parser',
    });
  }

  for (const group of openGroups) {
    diagnostics.push({ message: `namespace '${group.id}' 가 '}' 로 닫히지 않았습니다.`, range: group.headerLineRange, severity: 'error', source: 'parser' });
  }
  if (openClass) {
    diagnostics.push({
      message: `클래스 '${openClass.node.id}' 의 본문이 '}' 로 닫히지 않았습니다.`,
      range: { start: openClass.line.start, end: openClass.line.start + openClass.line.text.length },
      severity: 'error',
      source: 'parser',
    });
  }

  return {
    model: { kind: 'class', direction, nodes: [...nodes.values()], edges, groups },
    diagnostics,
  };
}

function buildEdge(
  match: RegExpExecArray,
  line: Line,
  ensureNode: (id: string, ref?: SourceRange) => ClassNodeModel,
  edgeIdCounts: Map<string, number>,
): RelationEdge {
  const source = ensureNode(match[1]!, groupRange(match, 1, line.start)).id;
  const target = ensureNode(match[8]!, groupRange(match, 8, line.start)).id;
  const endKind = (tokens: Record<string, EndKind>, token: string | undefined): EndKind =>
    (token ? tokens[token] : undefined) ?? 'none';
  const ends: RelationEdge['ends'] = {
    source: endKind(LEFT_END_TOKENS, match[4]),
    target: endKind(RIGHT_END_TOKENS, match[6]),
  };
  const lineStyle = match[5] === '..' ? 'dotted' : 'solid';
  const semantics = classifyRelation(ends, lineStyle);
  const label = match[10] ? match[10] : undefined;

  const baseId = `${source}|${semantics.relationType}|${target}${label ? `|${label}` : ''}`;
  const count = (edgeIdCounts.get(baseId) ?? 0) + 1;
  edgeIdCounts.set(baseId, count);

  const contentStart = line.start + (line.text.length - line.text.trimStart().length);
  const contentEnd = line.start + line.text.trimEnd().length;
  const labelRange = groupRange(match, 10, line.start);
  // 라벨 절 = label 앞의 ':' 와 그 앞 공백까지 (삭제 시 `A --> B` 만 남도록)
  let clauseStart = labelRange ? labelRange.start - line.start : 0;
  while (clauseStart > 0 && line.text[clauseStart - 1] !== ':') clauseStart -= 1;
  clauseStart -= 1;
  while (clauseStart > 0 && /\s/.test(line.text[clauseStart - 1] ?? '')) clauseStart -= 1;

  return {
    id: count === 1 ? baseId : `${baseId}#${count}`,
    source,
    target,
    ends,
    line: lineStyle,
    relationType: semantics.relationType,
    ...(semantics.parentEnd ? { parentEnd: semantics.parentEnd } : {}),
    ...(match[3] ? { sourceLabel: match[3] } : {}),
    ...(match[7] ? { targetLabel: match[7] } : {}),
    ...(label ? { label } : {}),
    range: { start: contentStart, end: contentEnd },
    ...(labelRange && label ? { labelRange, labelClauseRange: { start: line.start + clauseStart, end: contentEnd } } : {}),
  };
}
