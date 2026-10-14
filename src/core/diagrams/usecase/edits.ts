import type { EdgeId, NodeId, SourceRange } from '../../types';
import type { EditResult } from '../editResult';
import { NOOP_EDIT } from '../editResult';
import type { UsecaseModel } from './model';

const ID_RE = /^[A-Za-z_][\w-]*$/;

function dedupe(ranges: SourceRange[]): SourceRange[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 액터/유스케이스 이름 변경 */
export function renameUsecaseNode(model: UsecaseModel, id: NodeId, rawName: string): EditResult {
  const node = model.nodes.find((candidate) => candidate.id === id);
  if (!node) return { ok: false, reason: `'${id}' 를 찾을 수 없습니다.` };
  const name = rawName.trim();
  if (!name || name === node.label) return NOOP_EDIT;
  if (/[\n"()[\]]/.test(name)) return { ok: false, reason: '이름에 줄바꿈, 따옴표, 괄호는 쓸 수 없습니다.' };

  // 1) 라벨 표기가 있으면 라벨만
  if (node.labelRange) return { ok: true, edits: [{ ...node.labelRange, text: name }] };

  // 2) 따옴표 이름 또는 식별자로 쓸 수 있는 이름 → 모든 참조 리네임 (좌표·스타일은 renamedNode 로 이전)
  if (node.quoted || ID_RE.test(name)) {
    if (model.nodes.some((candidate) => candidate.id === name)) return { ok: false, reason: `'${name}' 가 이미 존재합니다.` };
    return { ok: true, edits: dedupe(node.refs).map((range) => ({ ...range, text: name })), renamedNode: { from: id, to: name } };
  }

  // 3) 공백 등이 있는 이름 → 식별자는 두고 `(라벨)` 추가
  if (node.declIdEnd === undefined) return { ok: false, reason: '라벨을 추가할 위치를 찾을 수 없습니다.' };
  return { ok: true, edits: [{ start: node.declIdEnd, end: node.declIdEnd, text: `(${name})` }] };
}

/** 관계 라벨: `A --> B` ↔ `A -- label --> B` */
export function editUsecaseEdgeLabel(model: UsecaseModel, edgeId: EdgeId, rawLabel: string): EditResult {
  const edge = model.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return { ok: false, reason: '편집할 관계를 찾을 수 없습니다.' };
  const label = rawLabel.trim();
  if (label === (edge.label ?? '')) return NOOP_EDIT;
  if (edge.semantic) return { ok: false, reason: 'include / extend / 일반화 관계에는 라벨을 붙일 수 없습니다. (Mermaid 문법)' };
  if (/[\n]/.test(label) || /--|<|>/.test(label)) return { ok: false, reason: "라벨에 줄바꿈이나 화살표 기호('--', '<', '>')는 쓸 수 없습니다." };
  if (edge.leftToken !== '--' && edge.rightToken !== '--') return { ok: false, reason: '양쪽에 화살표가 있는 관계에는 라벨을 붙일 수 없습니다.' };

  const base = `${edge.source}|${edge.relationType}|${edge.target}`;
  const renamedEdge = { from: edge.id, to: label ? `${base}|${label}` : base };
  let arrow: string;
  if (label) arrow = `${edge.leftToken} ${label} ${edge.rightToken}`;
  else if (edge.leftToken === '--') arrow = edge.rightToken;
  else arrow = edge.leftToken;
  return { ok: true, edits: [{ ...edge.arrowRange, text: arrow }], renamedEdge };
}
