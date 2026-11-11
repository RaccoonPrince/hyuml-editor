import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react';
import type { NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { themeOf } from '../../core/theme';
import { useDiagramStore } from '../../store/useDiagramStore';
import type { AppNode } from '../../view/flowTypes';
import { GROUP_NODE_PREFIX, SEQ_BODY_ID } from '../../view/flowTypes';
import { GroupNode } from './GroupNode';
import { UsecaseNode } from './UsecaseNode';
import { useShallow } from 'zustand/react/shallow';
import { toFlowElements } from '../../view/toFlowElements';
import { UmlClassNode } from './UmlClassNode';
import { UmlEdge } from './UmlEdge';
import { SeqBody } from './sequence/SeqBody';
import { SeqParticipantNode } from './sequence/SeqParticipantNode';

const nodeTypes = { umlClass: UmlClassNode, usecase: UsecaseNode, umlGroup: GroupNode, seqParticipant: SeqParticipantNode, seqBody: SeqBody };
const edgeTypes = { uml: UmlEdge };
const SELECTION_KEYS = ['Control', 'Meta', 'Shift'];

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && (target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor') !== null);

export function FlowCanvas() {
  const { model, layout, selection, isDarkMode } = useDiagramStore(useShallow((s) => ({
    model: s.model, layout: s.doc.layout, selection: s.selection, isDarkMode: s.isDarkMode,
  })));
  // 드래그 중인 도형 id — 있으면 그 도형에 붙은 간선만 다시 계산하고, 놓으면 전체를 정확히 다시 계산한다
  const [dragIds, setDragIds] = useState<ReadonlySet<string> | null>(null);
  const { nodes, edges } = useMemo(
    () => toFlowElements({ model, layout, selection, theme: themeOf(isDarkMode), dragIds }),
    [model, layout, selection, isDarkMode, dragIds],
  );
  const kind = useDiagramStore((s) => s.model?.kind);
  const arrangedSeq = useDiagramStore((s) => s.arrangedSeq);
  const { setViewport, getViewport, fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const fittedKind = useRef<string | undefined>(undefined);
  const theme = themeOf(isDarkMode);

  // Store 가 유일한 노드 상태. React Flow 변경 이벤트를 Store 명령으로 번역만 한다.
  const onNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
    const store = useDiagramStore.getState();
    const moves: { id: string; x: number; y: number }[] = [];
    let selectionChanged = false;
    const selected = new Set(store.selection);
    const groupNodes = new Map(nodes.filter((node) => node.type === 'umlGroup').map((node) => [node.id, node]));
    for (const change of changes) {
      if ('id' in change && change.id === SEQ_BODY_ID) continue; // 시퀀스 본문은 파생 도형
      if (change.type === 'position' && change.position) {
        const group = groupNodes.get(change.id);
        if (group && group.type === 'umlGroup') {
          // 그룹 상자 드래그 = 구성원 전체 이동 (상자 위치는 구성원에서 다시 계산된다)
          const dx = change.position.x - group.position.x;
          const dy = change.position.y - group.position.y;
          if (dx === 0 && dy === 0) continue;
          for (const member of group.data.group.members) {
            const node = store.doc.layout.nodes[member];
            if (node) moves.push({ id: member, x: node.x + dx, y: node.y + dy });
          }
          continue;
        }
        if (change.id.startsWith(GROUP_NODE_PREFIX)) continue;
        moves.push({ id: change.id, x: change.position.x, y: change.position.y });
      } else if (change.type === 'dimensions' && change.dimensions && change.resizing) {
        store.resizeNode(change.id, { w: change.dimensions.width, h: change.dimensions.height });
      } else if (change.type === 'select') {
        selectionChanged = true;
        if (change.selected) selected.add(change.id);
        else selected.delete(change.id);
      }
    }
    if (moves.length > 0) store.moveNodes(moves);
    if (selectionChanged) store.setSelection([...selected]);
  }, [nodes]);

  // 첫 렌더와 다이어그램 종류가 바뀔 때(클래스 ↔ 시퀀스) 전체 보기
  useEffect(() => {
    if (nodes.length === 0 || fittedKind.current === kind) return;
    fittedKind.current = kind;
    requestAnimationFrame(() => { void fitView({ padding: 0.15, maxZoom: 1.2 }); });
  }, [nodes.length, kind, fitView]);

  // 자동 정렬이 끝나면 전체가 보이도록 화면 맞춤
  useEffect(() => {
    if (arrangedSeq === 0) return;
    requestAnimationFrame(() => { void fitView({ padding: 0.12, maxZoom: 1.2, duration: 250 }); });
  }, [arrangedSeq, fitView]);

  // 휠 = 확대/축소
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || isTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = getViewport();
      const nextZoom = Math.min(4, Math.max(0.2, viewport.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      // 커서 위치를 기준으로 확대
      const scale = nextZoom / viewport.zoom;
      void setViewport({ x: px - (px - viewport.x) * scale, y: py - (py - viewport.y) * scale, zoom: nextZoom }, { duration: 0 });
    };
    element.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => element.removeEventListener('wheel', handleWheel, true);
  }, [getViewport, setViewport]);

  // 캔버스용 Undo/Redo 단축키 (코드 창에 포커스가 있으면 Monaco 자체 Undo 가 동작)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const store = useDiagramStore.getState();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); store.undo(); }
      else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); store.redo(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: theme.canvasBg }}>
      <ReactFlow<AppNode>
        nodes={nodes}
        edges={edges}
        colorMode={isDarkMode ? 'dark' : 'light'}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_event, _node, dragged) => {
          useDiagramStore.getState().beginInteraction();
          const ids = new Set<string>();
          for (const node of dragged) {
            if (node.type === 'umlGroup') for (const member of (node as Extract<AppNode, { type: 'umlGroup' }>).data.group.members) ids.add(member);
            else ids.add(node.id);
          }
          setDragIds(ids);
        }}
        onNodeDragStop={() => {
          setDragIds(null);
          useDiagramStore.getState().endInteraction();
        }}
        onPaneClick={() => useDiagramStore.getState().setSelection([])}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        // 그냥 드래그 = 화면 이동, Ctrl(맥 Cmd)·Shift + 드래그 = 범위 선택 (누르는 동안 화면 이동은 꺼진다)
        selectionKeyCode={SELECTION_KEYS}
        minZoom={0.2}
        maxZoom={4}
      >
        <Background color={theme.gridDots} style={{ background: theme.canvasBg }} />
        <Controls className="hy-no-export" />
        <MiniMap
          className="hy-no-export"
          nodeColor={(node) => (node.type === 'seqBody' || node.type === 'umlGroup' ? 'transparent' : isDarkMode ? '#4b5563' : '#cbd5e1')}
          nodeStrokeColor={(node) => (node.type === 'seqBody' || node.type === 'umlGroup' ? (isDarkMode ? '#4b5563' : '#cbd5e1') : 'transparent')}
          pannable
          zoomable
          style={{ background: isDarkMode ? '#1f2937' : '#f8fafc', border: `1px solid ${isDarkMode ? '#4b5563' : '#cbd5e1'}` }}
        />
      </ReactFlow>
    </div>
  );
}
