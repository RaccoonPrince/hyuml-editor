import type { EdgeId, NodeId } from '../../types';
import type { EditResult } from '../editResult';
import { NOOP_EDIT } from '../editResult';
import type { ClassModel, RelationEdge } from './model';
import { findMember, genericToDisplay, genericToSource } from './model';
import { isMethodText, restoreClassifier } from './parser';

/**
 * 캔버스 → 코드 편집. 파서가 기록한 소스 범위만 교체하므로
 * 같은 이름이 다른 곳(주석, 타입, 라벨)에 있어도 절대 건드리지 않는다.
 */

const IDENTIFIER_RE = /^[A-Za-z_]\w*(?:-\w+)*$/;
const noop = NOOP_EDIT;

export function editClassTitle(model: ClassModel, source: string, nodeId: NodeId, rawTitle: string): EditResult {
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { ok: false, reason: `클래스 '${nodeId}' 를 찾을 수 없습니다.` };
  let title = rawTitle.trim();
  if (!title || title === node.label) return noop;
  if (title.includes('"') || title.includes('\n')) return { ok: false, reason: '클래스 이름에 " 또는 줄바꿈은 쓸 수 없습니다.' };

  // 1) 명시 라벨이 있으면 라벨만 바꾼다.
  if (node.labelRange) {
    return { ok: true, edits: [{ ...node.labelRange, text: title }] };
  }

  // 2) 자동 생성된 제네릭 표기(Box<T>)는 떼고 식별자만 비교한다.
  if (node.generic) {
    const suffix = genericToDisplay(`~${node.generic}~`);
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    if (title === node.id) return noop;
  }

  // 3) 유효한 식별자 → 모든 참조 위치를 리네임
  if (IDENTIFIER_RE.test(title)) {
    if (model.nodes.some((candidate) => candidate.id === title)) {
      return { ok: false, reason: `'${title}' 클래스가 이미 존재합니다.` };
    }
    const edits = dedupeRanges(node.refs).map((range) => ({ ...range, text: title }));
    return { ok: true, edits, renamedNode: { from: node.id, to: title } };
  }

  // 4) 공백 등이 들어간 이름 → 식별자는 유지하고 표시 라벨을 추가한다.
  if (node.declIdEnd !== undefined) {
    return { ok: true, edits: [{ start: node.declIdEnd, end: node.declIdEnd, text: `["${title}"]` }] };
  }
  const prefix = source.length === 0 || source.endsWith('\n') ? '' : '\n';
  return { ok: true, edits: [{ start: source.length, end: source.length, text: `${prefix}  class ${node.id}["${title}"]\n` }] };
}

export function editMember(model: ClassModel, nodeId: NodeId, memberKey: string, rawDisplay: string): EditResult {
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  const member = node && findMember(node, memberKey);
  if (!node || !member) return { ok: false, reason: '편집할 멤버를 찾을 수 없습니다.' };
  const display = rawDisplay.trim();
  if (display === member.display) return noop;
  if (display.includes('\n') || display.includes('}')) return { ok: false, reason: "멤버에 줄바꿈이나 '}' 는 쓸 수 없습니다." };

  if (!display) {
    return { ok: true, edits: [{ ...(member.lineRange ?? member.range), text: '' }] };
  }
  const nextText = restoreClassifier(genericToSource(display), member.kind, member.classifier);
  const nextKey = `${isMethodText(nextText) ? 'm' : 'a'}:${genericToSource(display)}`;
  return {
    ok: true,
    edits: [{ ...member.range, text: nextText }],
    renamedMember: { nodeId, from: member.key, to: nextKey },
  };
}

export function editEdgeLabel(model: ClassModel, edgeId: EdgeId, rawLabel: string): EditResult {
  const edge = model.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return { ok: false, reason: '편집할 관계를 찾을 수 없습니다.' };
  const label = rawLabel.trim();
  if (label === (edge.label ?? '')) return noop;
  if (label.includes('\n')) return { ok: false, reason: '관계 라벨에 줄바꿈은 쓸 수 없습니다.' };

  const renamedEdge = { from: edge.id, to: edgeBaseId(edge, label || undefined) };
  if (edge.labelRange && edge.labelClauseRange) {
    return label
      ? { ok: true, edits: [{ ...edge.labelRange, text: label }], renamedEdge }
      : { ok: true, edits: [{ ...edge.labelClauseRange, text: '' }], renamedEdge };
  }
  if (!label) return noop;
  return { ok: true, edits: [{ start: edge.range.end, end: edge.range.end, text: ` : ${label}` }], renamedEdge };
}

/** parser.ts 의 edge id 규칙과 동일 (중복 접미사 제외) */
export function edgeBaseId(edge: Pick<RelationEdge, 'source' | 'target' | 'relationType'>, label?: string): EdgeId {
  return `${edge.source}|${edge.relationType}|${edge.target}${label ? `|${label}` : ''}`;
}

function dedupeRanges<T extends { start: number; end: number }>(ranges: T[]): T[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
