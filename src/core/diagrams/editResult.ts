import type { EdgeId, NodeId, TextEdit } from '../types';

/** 모든 다이어그램의 캔버스 → 코드 편집 결과 */
export type EditResult =
  | {
    ok: true;
    edits: TextEdit[];
    /** 스타일/레이아웃 키 이전에 필요한 정보 */
    renamedNode?: { from: NodeId; to: NodeId };
    renamedMember?: { nodeId: NodeId; from: string; to: string };
    renamedEdge?: { from: EdgeId; to: EdgeId };
    /** 문장 키(old → new) 일괄 이전 — 시퀀스 메시지/노트/프래그먼트 */
    keyMigration?: Record<string, string>;
  }
  | { ok: false; reason: string };

export const NOOP_EDIT: EditResult = { ok: true, edits: [] };
