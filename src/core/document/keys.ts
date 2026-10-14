import type { EdgeId, NodeId } from '../types';
import type { LayoutState } from './schema';

/**
 * 스타일 키 규칙 — 순서(index)가 아닌 의미 기반 키를 사용한다.
 *   node:<nodeId>/title
 *   node:<nodeId>/member:<memberKey>
 *   edge:<edgeId>/label
 *   <시퀀스 문장 키>/text        (msg:… / note:… / frag:… / sec:…)
 * edgeStyles 는 edgeId(클래스) 또는 메시지·프래그먼트 키(시퀀스)를 그대로 키로 쓴다.
 * 참여자(시퀀스)는 클래스 노드와 같은 node:<id>/title 키를 쓴다 → 전체 제목 스타일이 그대로 적용된다.
 */
export const styleKeys = {
  title: (nodeId: NodeId) => `node:${nodeId}/title`,
  member: (nodeId: NodeId, memberKey: string) => `node:${nodeId}/member:${memberKey}`,
  edgeLabel: (edgeId: EdgeId) => `edge:${edgeId}/label`,
  seqText: (statementKey: string) => `${statementKey}/text`,
  /** 그룹(namespace·box·systemBoundary) 라벨 — fill 은 그룹 상자 배경 */
  group: (groupId: string) => `group:${groupId}/text`,
};

export const isEdgeLabelKey = (key: string) => key.startsWith('edge:') && key.endsWith('/label');
export const edgeIdFromLabelKey = (key: string) => key.slice('edge:'.length, -'/label'.length);

function moveKey<T>(record: Record<string, T>, from: string, to: string) {
  if (from === to || !(from in record)) return;
  record[to] = record[from]!;
  delete record[from];
}

/** edge id(`src|type|tgt[|label][#n]`) 의 끝점 이름을 바꾼다 */
export function renameEdgeIdEndpoint(edgeId: EdgeId, from: NodeId, to: NodeId): EdgeId {
  const parts = edgeId.split('|');
  if (parts.length < 3) return edgeId;
  if (parts[0] === from) parts[0] = to;
  if (parts[2] === from) parts[2] = to;
  return parts.join('|');
}

/** 클래스 리네임 시 좌표·스타일 키를 함께 옮긴다. immer draft 에 직접 적용 가능. */
export function migrateNodeRename(layout: LayoutState, from: NodeId, to: NodeId) {
  moveKey(layout.nodes, from, to);
  const nodePrefix = `node:${from}/`;
  for (const key of Object.keys(layout.textStyles)) {
    if (key.startsWith(nodePrefix)) moveKey(layout.textStyles, key, `node:${to}/${key.slice(nodePrefix.length)}`);
    else if (isEdgeLabelKey(key)) {
      const edgeId = edgeIdFromLabelKey(key);
      moveKey(layout.textStyles, key, styleKeys.edgeLabel(renameEdgeIdEndpoint(edgeId, from, to)));
    }
  }
  for (const key of Object.keys(layout.edgeStyles)) {
    moveKey(layout.edgeStyles, key, renameEdgeIdEndpoint(key, from, to));
  }
  for (const key of Object.keys(layout.edgeWaypoints)) {
    moveKey(layout.edgeWaypoints, key, renameEdgeIdEndpoint(key, from, to));
  }
}

export function migrateMemberRename(layout: LayoutState, nodeId: NodeId, from: string, to: string) {
  moveKey(layout.textStyles, styleKeys.member(nodeId, from), styleKeys.member(nodeId, to));
}

export function migrateEdgeRename(layout: LayoutState, from: EdgeId, to: EdgeId) {
  moveKey(layout.edgeStyles, from, to);
  moveKey(layout.edgeWaypoints, from, to);
  moveKey(layout.textStyles, styleKeys.edgeLabel(from), styleKeys.edgeLabel(to));
}

/**
 * 문장 키 일괄 이전 (old → new). 서로 맞바뀌는 경우도 안전하도록 한 번에 재구성한다.
 * 대상: textStyles 의 `<key>/text`, edgeStyles 의 `<key>`
 */
export function migrateStatementKeys(layout: LayoutState, mapping: Record<string, string>) {
  const entries = Object.entries(mapping);
  if (entries.length === 0) return;
  const remap = <T>(record: Record<string, T>, toKey: (key: string) => string) => {
    const moved: Record<string, T> = {};
    for (const [from, to] of entries) {
      const oldKey = toKey(from);
      if (oldKey in record) {
        moved[toKey(to)] = record[oldKey]!;
        delete record[oldKey];
      }
    }
    Object.assign(record, moved);
  };
  remap(layout.textStyles, styleKeys.seqText);
  remap(layout.edgeStyles, (key) => key);
}
