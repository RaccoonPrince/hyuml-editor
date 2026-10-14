import { editClassTitle, editEdgeLabel, editMember } from '../core/diagrams/class/edits';
import type { EditResult } from '../core/diagrams/editResult';
import { createGroup, removeGroup, renameGroup } from '../core/diagrams/groupEdits';
import type { DiagramModel } from '../core/diagrams/registry';
import { connectorIds, isGraphModel, parseDiagram, shapeIds, toLayoutGraph } from '../core/diagrams/registry';
import { editStatementText, renameParticipant } from '../core/diagrams/sequence/edits';
import { arrangeSequence } from '../core/diagrams/sequence/reconcile';
import { editUsecaseEdgeLabel, renameUsecaseNode } from '../core/diagrams/usecase/edits';
import {
  migrateEdgeRename, migrateMemberRename, migrateNodeRename, migrateStatementKeys, styleKeys,
} from '../core/document/keys';
import type { NodeSizes } from '../core/layout/engine';
import {
  createEmptyLayout, DEFAULT_SOURCE, LIMITS, normalizeColor, normalizeFontSize, normalizeStrokeWidth,
} from '../core/document/schema';
import { applyTextEdits } from '../core/text';
import type { NodeId } from '../core/types';
import { measurerOf, runLayoutEngine } from './derivedSlice';
import { getEditorBridge } from './editorBridge';
import type { DocumentSlice, SliceCreator, Store } from './types';

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

export const createDocumentSlice: SliceCreator<DocumentSlice> = (set, get) => {
  /**
   * 변경 "직전" 문서를 past 에 쌓는다. 같은 key 가 짧은 간격으로 반복되면(연속 타이핑 등) 한 단위로 묶는다.
   * doc 은 immer 로 관리되는 불변 객체라 참조만 저장해도 안전하다.
   */
  const pushHistory = (key?: string) => {
    const now = Date.now();
    const { historyKey, historyAt, doc } = get();
    if (key && historyKey === key && now - historyAt < COALESCE_MS) {
      set((s) => { s.historyAt = now; });
      return;
    }
    set((s) => {
      s.past.push(doc);
      if (s.past.length > HISTORY_LIMIT) s.past.shift();
      s.future = [];
      s.historyKey = key ?? null;
      s.historyAt = now;
    });
  };

  /** 편집 계산은 반드시 현재 소스로 파싱된 모델 위에서 한다 (디바운스 대기 중이면 즉시 재파싱) */
  const modelForEdit = (): DiagramModel | null => {
    const { model, modelSource, doc } = get();
    if (model && modelSource === doc.source) return model;
    const fresh = parseDiagram(doc.source);
    if (!fresh.model || fresh.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      get().notify('코드에 오류가 있어 캔버스에서 편집할 수 없습니다. 먼저 코드 오류를 고쳐 주세요.', 'error');
      return null;
    }
    return fresh.model;
  };

  const restore = (from: 'past' | 'future') => {
    const state: Store = get();
    const stack = state[from];
    const target = stack[stack.length - (from === 'past' ? 1 : stack.length)];
    if (!target) return;
    const edits = state.doc.source !== target.source ? [{ start: 0, end: state.doc.source.length, text: target.source }] : [];
    set((s) => {
      if (from === 'past') {
        s.past.pop();
        s.future.unshift(state.doc);
      } else {
        s.future.shift();
        s.past.push(state.doc);
      }
      // 되돌린 문서의 layout 은 그 문서 source 에 맞는 좌표 → 종류 전환 스왑을 하지 않는다
      if (state.layoutKind) s.kindStash[state.layoutKind] = state.doc.layout.nodes;
      s.layoutKind = null;
      s.doc = target;
      s.historyKey = null;
    });
    if (edits.length > 0) getEditorBridge()?.applyEdits(edits);
    void get().commitNow();
  };

  return {
    doc: { source: DEFAULT_SOURCE, layout: createEmptyLayout() },
    past: [],
    future: [],
    historyKey: null,
    historyAt: 0,

    setSource: (source) => {
      if (source === get().doc.source) return;
      pushHistory('typing');
      set((s) => { s.doc.source = source; });
      get().scheduleCommit();
    },

    loadDocument: (doc, warnings = []) => {
      pushHistory();
      const previous = get().doc.source;
      set((s) => {
        s.doc = doc;
        s.trash = {};
        s.kindStash = {};
        s.layoutKind = null;
        s.selection = [];
      });
      getEditorBridge()?.applyEdits([{ start: 0, end: previous.length, text: doc.source }]);
      void get().commitNow();
      if (warnings.length > 0) {
        get().notify(`프로젝트를 열었습니다. 경고 ${warnings.length}건: ${warnings[0]}${warnings.length > 1 ? ' …' : ''}`, 'warning');
      }
    },

    applyEdit: (result, historyLabel) => {
      if (!result.ok) {
        get().notify(result.reason, 'error');
        return false;
      }
      if (result.edits.length === 0) return true;
      const current = get().doc.source;
      let next: string;
      try {
        next = applyTextEdits(current, result.edits);
      } catch (error) {
        get().notify(`코드 편집 실패: ${error instanceof Error ? error.message : String(error)}`, 'error');
        return false;
      }
      pushHistory(historyLabel);
      set((s) => {
        s.doc.source = next;
        if (result.renamedNode) migrateNodeRename(s.doc.layout, result.renamedNode.from, result.renamedNode.to);
        if (result.renamedMember) {
          migrateMemberRename(s.doc.layout, result.renamedMember.nodeId, result.renamedMember.from, result.renamedMember.to);
        }
        if (result.renamedEdge) migrateEdgeRename(s.doc.layout, result.renamedEdge.from, result.renamedEdge.to);
        if (result.keyMigration) migrateStatementKeys(s.doc.layout, result.keyMigration);
      });
      // Store 를 먼저 갱신한 뒤 Monaco 에 최소 편집 적용 → 에디터 onChange 는 "이미 반영됨"으로 무시된다
      getEditorBridge()?.applyEdits(result.edits);
      void get().commitNow();
      return true;
    },

    editMember: (nodeId, memberKey, text) => {
      const model = modelForEdit();
      if (model?.kind === 'class') get().applyEdit(editMember(model, nodeId, memberKey, text), `member:${nodeId}:${memberKey}`);
    },
    editEdgeLabel: (edgeId, label) => {
      const model = modelForEdit();
      if (model?.kind === 'class') get().applyEdit(editEdgeLabel(model, edgeId, label), `edge:${edgeId}`);
      else if (model?.kind === 'usecase') get().applyEdit(editUsecaseEdgeLabel(model, edgeId, label), `edge:${edgeId}`);
    },
    renameShape: (id, name) => {
      const model = modelForEdit();
      if (!model) return;
      const source = get().doc.source;
      const result: EditResult = model.kind === 'class' ? editClassTitle(model, source, id, name)
        : model.kind === 'sequence' ? renameParticipant(model, source, id, name)
          : renameUsecaseNode(model, id, name);
      get().applyEdit(result, `rename:${id}`);
    },
    createGroup: (memberIds, name) => {
      const model = modelForEdit();
      return model ? get().applyEdit(createGroup(model, get().doc.source, memberIds, name), 'group:create') : false;
    },
    removeGroup: (groupId) => {
      const model = modelForEdit();
      if (model) get().applyEdit(removeGroup(model, groupId), 'group:remove');
    },
    renameGroup: (groupId, name) => {
      const model = modelForEdit();
      if (!model) return;
      const result = renameGroup(model, groupId, name);
      // 그룹 id 가 이름인 경우(class namespace, usecase 식별자) 그룹 스타일 키도 함께 옮긴다
      if (result.ok && result.edits.length > 0 && model.kind !== 'sequence' && model.groups.some((group) => group.id === groupId && group.label === group.id)) {
        const nextId = name.trim();
        get().applyEdit({ ...result, keyMigration: { [`group:${groupId}`]: `group:${nextId}` } }, `group:rename:${groupId}`);
        return;
      }
      get().applyEdit(result, `group:rename:${groupId}`);
    },
    editSequenceText: (statementKey, text) => {
      const model = modelForEdit();
      if (model?.kind === 'sequence') get().applyEdit(editStatementText(model, statementKey, text), `seq-text:${statementKey}`);
    },

    beginInteraction: () => pushHistory(),
    endInteraction: () => {
      // 클릭만 하고 움직이지 않았다면 immer 가 doc 참조를 유지하므로 빈 Undo 항목을 제거한다
      // (사용자가 직접 옮긴 위치는 그대로 둔다 — 자동으로 밀어내지 않음, 명세 NFR-04)
      const { past, doc } = get();
      if (past[past.length - 1] === doc) set((s) => { s.past.pop(); });
    },

    moveNodes: (moves) => set((s) => {
      // 시퀀스 참여자는 머리 줄에 고정 → 가로로만 이동
      const lockY = s.model?.kind === 'sequence';
      for (const { id, x, y } of moves) {
        const node = s.doc.layout.nodes[id];
        if (!node || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        node.x = x;
        if (!lockY) node.y = y;
      }
    }),

    resizeNode: (id, rect) => set((s) => {
      const node = s.doc.layout.nodes[id];
      if (!node) return;
      const clampSize = (value: number) => Math.min(LIMITS.nodeSize.max, Math.max(LIMITS.nodeSize.min, value));
      if (rect.x !== undefined && Number.isFinite(rect.x)) node.x = rect.x;
      if (rect.y !== undefined && Number.isFinite(rect.y) && s.model?.kind !== 'sequence') node.y = rect.y;
      if (rect.w !== undefined && Number.isFinite(rect.w)) node.w = clampSize(rect.w);
      if (rect.h !== undefined && Number.isFinite(rect.h)) node.h = clampSize(rect.h);
      node.autoSize = false;
    }),

    resetNodeSize: (id) => {
      if (!get().doc.layout.nodes[id]) return;
      pushHistory();
      set((s) => { s.doc.layout.nodes[id]!.autoSize = true; });
      get().refitNodes();
    },

    updateTextStyle: (key, style) => {
      const fontSize = normalizeFontSize(style.fontSize);
      const color = normalizeColor(style.color);
      const fill = style.fill === null ? null : normalizeColor(style.fill);
      if (!key || (fontSize === undefined && color === undefined && fill === undefined)) return;
      pushHistory(`style:${key}`);
      set((s) => {
        const next = {
          ...s.doc.layout.textStyles[key],
          ...(fontSize !== undefined ? { fontSize } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(fill ? { fill } : {}),
          isCustomized: true,
        };
        if (fill === null) delete next.fill;
        s.doc.layout.textStyles[key] = next;
      });
      if (fontSize !== undefined) get().refitNodes();
    },

    setEdgeWaypoints: (edgeId, points) => set((s) => {
      if (!points || points.length === 0) delete s.doc.layout.edgeWaypoints[edgeId];
      else s.doc.layout.edgeWaypoints[edgeId] = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).slice(0, 20);
    }),

    updateNodeFill: (id, fill) => {
      const node = get().doc.layout.nodes[id];
      const color = fill === null ? null : normalizeColor(fill);
      if (!node || color === undefined || (node.fill ?? null) === color) return;
      pushHistory(`fill:${id}`);
      set((s) => {
        const target = s.doc.layout.nodes[id]!;
        if (color === null) delete target.fill;
        else target.fill = color;
      });
    },

    updateEdgeStyle: (edgeId, style) => {
      const stroke = normalizeColor(style.stroke);
      const strokeWidth = normalizeStrokeWidth(style.strokeWidth);
      if (!edgeId || (stroke === undefined && strokeWidth === undefined)) return;
      pushHistory(`edge-style:${edgeId}`);
      set((s) => {
        s.doc.layout.edgeStyles[edgeId] = {
          ...s.doc.layout.edgeStyles[edgeId],
          ...(stroke !== undefined ? { stroke } : {}),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
          isCustomized: true,
        };
      });
    },

    updateAllEdgeStyles: (style) => {
      const model = get().model;
      const stroke = normalizeColor(style.stroke);
      const strokeWidth = normalizeStrokeWidth(style.strokeWidth);
      const ids = model ? connectorIds(model) : [];
      if (ids.length === 0 || (stroke === undefined && strokeWidth === undefined)) return;
      pushHistory();
      set((s) => {
        for (const id of ids) {
          // 개별 지정한 간선은 전체 변경에서 제외 (제목 일괄 변경과 동일한 규칙)
          if (s.doc.layout.edgeStyles[id]?.isCustomized) continue;
          s.doc.layout.edgeStyles[id] = {
            ...s.doc.layout.edgeStyles[id],
            ...(stroke !== undefined ? { stroke } : {}),
            ...(strokeWidth !== undefined ? { strokeWidth } : {}),
          };
        }
      });
    },

    updateAllClassTitleStyles: (style) => {
      const model = get().model;
      const fontSize = normalizeFontSize(style.fontSize);
      const color = normalizeColor(style.color);
      const ids = model ? shapeIds(model) : [];
      if (ids.length === 0 || (fontSize === undefined && color === undefined)) return;
      pushHistory();
      set((s) => {
        for (const id of ids) {
          const key = styleKeys.title(id);
          if (s.doc.layout.textStyles[key]?.isCustomized) continue;
          s.doc.layout.textStyles[key] = {
            ...s.doc.layout.textStyles[key],
            ...(fontSize !== undefined ? { fontSize } : {}),
            ...(color !== undefined ? { color } : {}),
          };
        }
      });
      if (fontSize !== undefined) get().refitNodes();
    },

    setFontSize: (pt) => {
      if (!Number.isFinite(pt)) return;
      pushHistory('canvas-font');
      set((s) => {
        s.doc.layout.canvas.fontSizePt = Math.min(LIMITS.canvasFont.max, Math.max(LIMITS.canvasFont.min, pt));
      });
      get().refitNodes();
    },

    toggleHideEmptyCompartments: () => {
      pushHistory();
      set((s) => { s.doc.layout.canvas.hideEmptyCompartments = !s.doc.layout.canvas.hideEmptyCompartments; });
      get().refitNodes();
    },

    setEngine: (engine) => {
      if (get().doc.layout.canvas.engine === engine) return;
      pushHistory();
      set((s) => { s.doc.layout.canvas.engine = engine; });
    },

    autoArrange: async () => {
      const { model, doc } = get();
      if (!model) return;
      if (model.kind === 'sequence') {
        if (model.participants.length === 0) return;
        const arranged = arrangeSequence(model, doc.layout.nodes, measurerOf(model, doc.layout));
        pushHistory();
        set((s) => {
          Object.assign(s.doc.layout.nodes, arranged);
          s.arrangedSeq += 1;
        });
        return;
      }
      if (!isGraphModel(model) || model.nodes.length === 0) return;
      const seq = get().layoutSeq + 1;
      set((s) => {
        s.layoutSeq = seq;
        s.isLayouting = true;
      });
      const measure = measurerOf(model, doc.layout);
      const sizes: NodeSizes = {};
      for (const node of model.nodes) {
        const current = doc.layout.nodes[node.id];
        sizes[node.id] = current && current.autoSize === false ? { w: current.w, h: current.h } : measure(node);
      }
      const positions = await runLayoutEngine(get, toLayoutGraph(model), sizes);
      if (seq !== get().layoutSeq) return;
      const placedIds = Object.keys(positions);
      if (placedIds.length === 0) {
        set((s) => { s.isLayouting = false; });
        return;
      }
      const minX = Math.min(...placedIds.map((id) => positions[id]!.x));
      const minY = Math.min(...placedIds.map((id) => positions[id]!.y));
      pushHistory();
      set((s) => {
        for (const id of placedIds) {
          const node = s.doc.layout.nodes[id as NodeId];
          const size = sizes[id];
          if (!node || !size) continue;
          node.x = positions[id]!.x - minX + 40;
          node.y = positions[id]!.y - minY + 40;
          node.w = size.w;
          node.h = size.h;
        }
        // 자동 정렬 후에는 예전 꺾임점이 의미가 없으므로 자동 경로로 되돌린다
        s.doc.layout.edgeWaypoints = {};
        s.isLayouting = false;
        s.arrangedSeq += 1;
      });
    },

    undo: () => restore('past'),
    redo: () => restore('future'),
  };
};
