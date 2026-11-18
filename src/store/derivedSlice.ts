import { measureShapes } from '../core/diagrams/measureShapes';
import { validateWithMermaid } from '../core/diagrams/mermaidValidate';
import type { DiagramModel, GraphDiagramModel } from '../core/diagrams/registry';
import { isGraphModel, parseDiagram, toLayoutGraph } from '../core/diagrams/registry';
import type { SequenceModel } from '../core/diagrams/sequence/model';
import { reconcileSequence } from '../core/diagrams/sequence/reconcile';
import { migrateNodeRename } from '../core/document/keys';
import type { ReconcileResult } from '../core/document/reconcile';
import { fitSize, placeAddedNodes, reconcileLayout } from '../core/document/reconcile';
import type { LayoutState, NodeLayout } from '../core/document/schema';
import { getLayoutEngine } from '../core/layout/engine';
import type { NodeSizes } from '../core/layout/engine';
import type { Diagnostic, NodeId, Point } from '../core/types';
import type { DerivedSlice, KindStash, SliceCreator, Store } from './types';

export const COMMIT_DEBOUNCE_MS = 300;
let commitTimer: ReturnType<typeof setTimeout> | undefined;

/** 종류 전환 시 보관할 layout 조각 */
export const stashOf = (layout: LayoutState): KindStash => ({
  nodes: layout.nodes, textStyles: layout.textStyles, edgeStyles: layout.edgeStyles, edgeWaypoints: layout.edgeWaypoints,
});

/** 모델 종류와 무관한 "도형 id → 최소 크기" 측정기 */
export const measurerOf = (model: DiagramModel, layout: LayoutState) => {
  const sizes = measureShapes(model, layout);
  return (shape: { id: NodeId }) => sizes[shape.id] ?? { w: 160, h: 80 };
};

/** 선택한 엔진으로 배치. 실패하면 dagre 로 폴백하고, 그것도 실패하면 빈 결과(호출부가 폴백 배치). */
export async function runLayoutEngine(
  get: () => Store,
  graph: ReturnType<typeof toLayoutGraph>,
  sizes: NodeSizes,
): Promise<Record<NodeId, Point>> {
  const name = get().doc.layout.canvas.engine;
  try {
    return await (await getLayoutEngine(name)).layout(graph, sizes);
  } catch (error) {
    console.error(`[layout] ${name} 엔진 실패`, error);
    get().notify(`${name.toUpperCase()} 레이아웃 실패 — 기본 엔진으로 배치합니다.`, 'warning');
    if (name === 'dagre') return {};
    try {
      return await (await getLayoutEngine('dagre')).layout(graph, sizes);
    } catch {
      return {};
    }
  }
}

export const createDerivedSlice: SliceCreator<DerivedSlice> = (set, get) => {
  /**
   * 종류 전환(class ↔ sequence ↔ usecase): 현재 좌표를 그 종류 보관함에 넣고 새 종류의 보관 좌표로 시작.
   * reconcile 은 전환 후 좌표 기준으로 동작하므로 다른 종류의 같은 이름 도형 좌표를 물려받지 않는다.
   */
  const switchKindIfNeeded = (next: DiagramModel['kind']) => {
    const { layoutKind, doc, kindStash } = get();
    if (!layoutKind || layoutKind === next) return;
    set((s) => {
      s.kindStash[layoutKind] = stashOf(doc.layout);
      const incoming = kindStash[next];
      s.doc.layout.nodes = incoming?.nodes ?? {};
      s.doc.layout.textStyles = incoming?.textStyles ?? {};
      s.doc.layout.edgeStyles = incoming?.edgeStyles ?? {};
      s.doc.layout.edgeWaypoints = incoming?.edgeWaypoints ?? {};
      s.trash = {};
    });
  };

  const apply = (model: DiagramModel, source: string, diagnostics: Diagnostic[], result: ReconcileResult, placed: Record<NodeId, NodeLayout> = {}) => {
    set((s) => {
      s.doc.layout.nodes = { ...result.nodes, ...placed };
      for (const { from, to } of result.renamed) migrateNodeRename(s.doc.layout, from, to);
      s.trash = result.trash;
      s.model = model;
      s.layoutKind = model.kind;
      s.modelSource = source;
      s.diagnostics = diagnostics;
      s.isLayouting = false;
    });
  };

  /** 시퀀스: 배치가 동기 계산이라 엔진 대기 없이 바로 적용 */
  const commitSequence = (model: SequenceModel, source: string, diagnostics: Diagnostic[]) => {
    const now = get();
    apply(model, source, diagnostics, reconcileSequence({
      model,
      prevModel: now.model,
      nodes: now.doc.layout.nodes,
      trash: now.trash,
      measure: measurerOf(model, now.doc.layout),
    }));
  };

  /** class·usecase: 신규 도형은 레이아웃 엔진(비동기)으로 배치. 대기 중 변경이 유실되지 않도록 적용 시점에 다시 reconcile */
  const commitGraph = async (model: GraphDiagramModel, source: string, diagnostics: Diagnostic[], seq: number) => {
    const before = get();
    const prevGraph = (current: DiagramModel | null) => (isGraphModel(current) ? current : null);
    const measure = measurerOf(model, before.doc.layout);
    const pre = reconcileLayout({ model, prevModel: prevGraph(before.model), nodes: before.doc.layout.nodes, trash: before.trash, measure });
    const sizes: NodeSizes = {};
    for (const node of model.nodes) sizes[node.id] = pre.nodes[node.id] ?? measure(node);
    let positions: Record<NodeId, Point> = {};
    if (pre.added.length > 0) {
      set((s) => { s.isLayouting = true; });
      positions = await runLayoutEngine(get, toLayoutGraph(model), sizes);
    }
    // 그사이 더 새로운 커밋이 시작됐다면 이 결과는 버린다 (순서 뒤바뀜 방지)
    if (seq !== get().parseSeq) return false;

    const now = get();
    const result = reconcileLayout({ model, prevModel: prevGraph(now.model), nodes: now.doc.layout.nodes, trash: now.trash, measure: measurerOf(model, now.doc.layout) });
    apply(model, source, diagnostics, result, placeAddedNodes(model, result.nodes, result.added, sizes, positions));
    return true;
  };

  return {
    model: null,
    modelSource: null,
    diagnostics: [],
    trash: {},
    kindStash: {},
    layoutKind: null,
    parseSeq: 0,
    layoutSeq: 0,
    arrangedSeq: 0,
    isLayouting: false,

    scheduleCommit: () => {
      clearTimeout(commitTimer);
      commitTimer = setTimeout(() => { void get().commitNow(); }, COMMIT_DEBOUNCE_MS);
    },

    commitNow: async () => {
      clearTimeout(commitTimer);
      const seq = get().parseSeq + 1;
      set((s) => { s.parseSeq = seq; });
      const source = get().doc.source;
      const parsed = parseDiagram(source);
      const hasErrors = parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error');

      // 오류가 있으면 마지막 정상 모델을 유지한다 (타이핑 중 `class A {` 만 쳐도 그래프가 무너지지 않게)
      if (!parsed.model || hasErrors) {
        set((s) => {
          s.diagnostics = parsed.diagnostics;
          s.isLayouting = false;
        });
        return;
      }

      switchKindIfNeeded(parsed.model.kind);
      if (parsed.model.kind === 'sequence') commitSequence(parsed.model, source, parsed.diagnostics);
      else if (!(await commitGraph(parsed.model, source, parsed.diagnostics, seq))) return;

      // Mermaid 호환성 검증 (자체 파서가 깨끗할 때만, 비동기·비차단)
      if (parsed.diagnostics.length === 0) {
        void validateWithMermaid(source).then((extra) => {
          if (extra.length > 0 && seq === get().parseSeq) set((s) => { s.diagnostics.push(...extra); });
        }).catch(() => undefined);
      }
    },

    /** 내용에 맞게 autoSize 도형 크기만 다시 맞춘다 — 좌표(x, y)는 절대 바꾸지 않는다 (명세 NFR-04) */
    refitNodes: () => {
      const { model, doc } = get();
      if (!model) return;
      const sizes = measureShapes(model, doc.layout);
      const next: Record<NodeId, NodeLayout> = {};
      for (const [id, required] of Object.entries(sizes)) {
        const current = doc.layout.nodes[id];
        if (!current) continue;
        const fitted = fitSize(current, required);
        if (fitted !== current) next[id] = fitted;
      }
      if (Object.keys(next).length > 0) set((s) => { Object.assign(s.doc.layout.nodes, next); });
    },
  };
};
