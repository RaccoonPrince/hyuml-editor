import { memo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { EdgeLabelRenderer, useReactFlow } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { EndKind } from '../../core/diagrams/class/model';
import { markerShape } from '../../core/diagrams/class/notation';
import { styleKeys } from '../../core/document/keys';
import type { PlacedLabel } from '../../core/layout/labels';
import { pointsToPath } from '../../core/layout/routing';
import { hashString } from '../../core/text';
import { TYPO } from '../../core/theme';
import type { Point } from '../../core/types';
import { useDiagramStore } from '../../store/useDiagramStore';
import type { UmlEdge as UmlEdgeType } from '../../view/flowTypes';
import { EditableText } from './EditableText';
import { FormatToolbar } from './FormatToolbar';

function Marker({ id, kind, stroke, background }: { id: string; kind: EndKind; stroke: string; background: string }) {
  const shape = markerShape(kind);
  if (!shape) return null;
  return (
    <marker
      id={id}
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      markerWidth={shape.width}
      markerHeight={shape.height}
      refX={shape.width - 1}
      refY={shape.height / 2}
      markerUnits="userSpaceOnUse"
      // markerStart 로 쓰여도 항상 노드 바깥을 향하도록
      orient="auto-start-reverse"
    >
      <path
        d={shape.path}
        fill={shape.fill === 'stroke' ? stroke : shape.fill === 'background' ? background : 'none'}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </marker>
  );
}

const labelBox = (label: PlacedLabel, background: string): CSSProperties => ({
  position: 'absolute',
  transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`,
  minWidth: label.w,
  height: label.h,
  boxSizing: 'border-box',
  padding: `${TYPO.edgeLabelPadY}px ${TYPO.edgeLabelPadX}px`,
  borderRadius: 3,
  background,
  whiteSpace: 'nowrap',
  textAlign: 'center',
  fontFamily: TYPO.fontFamily,
});

const snap = (value: number) => Math.round(value / 5) * 5;

/** 경로 위 점까지의 누적 거리 — 새 꺾임점을 경유점 목록의 올바른 순서에 끼워 넣는 데 사용 */
function distanceAlong(points: readonly Point[], target: Point): number {
  let best = Number.POSITIVE_INFINITY;
  let bestAt = 0;
  let walked = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / (length * length)));
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const d = Math.hypot(target.x - px, target.y - py);
    if (d < best) { best = d; bestAt = walked + length * t; }
    walked += length;
  }
  return bestAt;
}

function UmlEdgeImpl({ id, data }: EdgeProps<UmlEdgeType>) {
  const editEdgeLabel = useDiagramStore((s) => s.editEdgeLabel);
  const setEdgeWaypoints = useDiagramStore((s) => s.setEdgeWaypoints);
  const beginInteraction = useDiagramStore((s) => s.beginInteraction);
  const endInteraction = useDiagramStore((s) => s.endInteraction);
  const { screenToFlowPosition } = useReactFlow();
  const [focused, setFocused] = useState(false);
  const [adding, setAdding] = useState(false);
  const [hovered, setHovered] = useState(false);
  const dragging = useRef<{ index: number; list: Point[] } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  if (!data) return null;
  const { edge, points, labels, stroke, strokeWidth, labelColor, centerFontPt, centerFontPx, endpointFontPx, background, waypoints, labelEditable } = data;

  // Mermaid 의 곡선 간선처럼 모서리를 크게 둥글린다
  const path = pointsToPath(points, 12);
  const markerBase = `m${hashString(id)}`;
  const startId = markerShape(edge.ends.source) ? `${markerBase}s` : undefined;
  const endId = markerShape(edge.ends.target) ? `${markerBase}e` : undefined;
  const labelKey = styleKeys.edgeLabel(id);
  const longest = points.slice(0, -1)
    .map((a, index) => ({ a, b: points[index + 1]! }))
    .sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y))[0];
  const center = labels.center ?? (longest
    ? { x: (longest.a.x + longest.b.x) / 2, y: (longest.a.y + longest.b.y) / 2, w: 40, h: centerFontPx + 4 }
    : undefined);
  const showCenter = Boolean(edge.label) || adding;
  const isSelfLoop = edge.source === edge.target;

  /* ── 꺾임점 드래그 (명세 FR-12) ──
   * 이동·종료는 window 에서 받는다. 선분 중앙 손잡이로 새 꺾임점을 만들면 그 손잡이(circle)가
   * 곧바로 사라져 포인터 캡처가 풀리므로, 요소 이벤트에 의존하면 드래그가 중간에 끊기고
   * endInteraction 이 호출되지 않아 Undo 스냅샷·isDragging 이 남는다. */
  const moveDrag = (event: PointerEvent) => {
    const state = dragging.current;
    if (!state) return;
    const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const list = state.list.map((point, index) => (index === state.index ? { x: snap(p.x), y: snap(p.y) } : point));
    dragging.current = { ...state, list };
    setEdgeWaypoints(id, list);
  };
  const endDrag = () => {
    window.removeEventListener('pointermove', moveDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    if (!dragging.current) return;
    dragging.current = null;
    setIsDragging(false);
    setHovered(false);
    endInteraction();
  };
  const startDrag = (event: ReactPointerEvent<SVGElement>, list: Point[], index: number) => {
    event.stopPropagation();
    event.preventDefault();
    beginInteraction();
    dragging.current = { index, list };
    setIsDragging(true);
    setEdgeWaypoints(id, list);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };
  /** 선분 중앙 손잡이를 끌면 그 위치에 새 꺾임점을 만든다 */
  const startNewBend = (event: ReactPointerEvent<SVGElement>, at: Point) => {
    const order = [...waypoints.map((point) => ({ point, d: distanceAlong(points, point) })), { point: at, d: distanceAlong(points, at) }]
      .sort((a, b) => a.d - b.d);
    startDrag(event, order.map((entry) => entry.point), order.findIndex((entry) => entry.point === at));
  };
  const segmentHandles = isSelfLoop ? [] : points.slice(1, -2).map((a, index) => {
    const b = points[index + 2]!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }).filter((mid) => !waypoints.some((point) => Math.hypot(point.x - mid.x, point.y - mid.y) < 12));
  const showHandles = (hovered || isDragging) && !isSelfLoop;

  return (
    <>
      <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => { if (!isDragging) setHovered(false); }}>
        <defs>
          {startId && <Marker id={startId} kind={edge.ends.source} stroke={stroke} background={background} />}
          {endId && <Marker id={endId} kind={edge.ends.target} stroke={stroke} background={background} />}
        </defs>
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={edge.line === 'dotted' ? '6 4' : undefined}
          markerStart={startId ? `url(#${startId})` : undefined}
          markerEnd={endId ? `url(#${endId})` : undefined}
          className="react-flow__edge-path"
          style={{ stroke, strokeWidth }}
        />
        {/* 넓은 투명 히트 영역: 호버 시 꺾임 손잡이 표시, 더블클릭으로 라벨 추가 */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          style={{ pointerEvents: 'stroke', cursor: labelEditable ? 'text' : 'default' }}
          onDoubleClick={() => { if (!edge.label && labelEditable) setAdding(true); }}
        />
        {showHandles && (
          <g className="hy-no-export">
            {segmentHandles.map((mid, index) => (
              <circle
                key={`mid-${index}`}
                cx={mid.x}
                cy={mid.y}
                r={5}
                fill={background}
                stroke={stroke}
                strokeWidth={1.5}
                style={{ cursor: 'move', pointerEvents: 'all' }}
                onPointerDown={(event) => startNewBend(event, mid)}
              >
                <title>드래그해서 연결선 꺾기</title>
              </circle>
            ))}
            {waypoints.map((point, index) => (
              <rect
                key={`wp-${index}`}
                x={point.x - 5}
                y={point.y - 5}
                width={10}
                height={10}
                fill={stroke}
                style={{ cursor: 'move', pointerEvents: 'all' }}
                onPointerDown={(event) => startDrag(event, [...waypoints], index)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  beginInteraction();
                  setEdgeWaypoints(id, waypoints.filter((_, i) => i !== index));
                  endInteraction();
                }}
              >
                <title>드래그: 이동 · 더블클릭: 꺾임점 삭제</title>
              </rect>
            ))}
            {waypoints.length > 0 && waypoints[0] && (
              <g
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginInteraction();
                  setEdgeWaypoints(id, null);
                  endInteraction();
                }}
              >
                <circle cx={waypoints[0].x + 14} cy={waypoints[0].y - 14} r={8} fill="#004b87" />
                <text x={waypoints[0].x + 14} y={waypoints[0].y - 10} fontSize={11} fill="#fff" textAnchor="middle">↺</text>
                <title>자동 경로로 되돌리기</title>
              </g>
            )}
          </g>
        )}
      </g>
      <EdgeLabelRenderer>
        {edge.sourceLabel && labels.tail && (
          <div className="nodrag nopan" style={{ ...labelBox(labels.tail, background), color: labelColor, fontSize: endpointFontPx, lineHeight: `${labels.tail.h - TYPO.edgeLabelPadY * 2}px`, pointerEvents: 'none' }}>
            {edge.sourceLabel}
          </div>
        )}
        {edge.targetLabel && labels.head && (
          <div className="nodrag nopan" style={{ ...labelBox(labels.head, background), color: labelColor, fontSize: endpointFontPx, lineHeight: `${labels.head.h - TYPO.edgeLabelPadY * 2}px`, pointerEvents: 'none' }}>
            {edge.targetLabel}
          </div>
        )}
        {edge.stereotype && center && !showCenter && (
          // «include» / «extend» — Mermaid 문법상 고정 표기 (편집 불가)
          <div className="nodrag nopan" style={{ ...labelBox(center, background), color: labelColor, fontSize: centerFontPx, lineHeight: `${center.h - TYPO.edgeLabelPadY * 2}px`, pointerEvents: 'none', fontStyle: 'italic' }}>
            {edge.stereotype}
          </div>
        )}
        {showCenter && center && (
          <div className="nodrag nopan" style={{ ...labelBox(center, background), color: labelColor, fontSize: centerFontPx, lineHeight: `${center.h - TYPO.edgeLabelPadY * 2}px`, pointerEvents: 'all', zIndex: focused ? 10 : undefined }}>
            <EditableText
              ariaLabel={`관계 라벨 ${edge.source} → ${edge.target}`}
              value={edge.label ?? ''}
              placeholder="라벨"
              autoFocus={adding}
              autoWidth={centerFontPx}
              onCommit={(next) => editEdgeLabel(id, next)}
              onFocusChange={(isFocused) => {
                setFocused(isFocused);
                if (!isFocused) setAdding(false);
              }}
              style={{ textAlign: 'center', fontSize: centerFontPx, lineHeight: 'inherit', display: 'inline-block' }}
            />
            {focused && (
              <FormatToolbar
                target={{ kind: 'edge', styleKey: labelKey, edgeId: id }}
                fontSize={centerFontPt}
                color={labelColor}
                stroke={stroke}
                strokeWidth={strokeWidth}
              />
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const UmlEdge = memo(UmlEdgeImpl);
