import type { RelationEdge } from '../diagrams/class/model';
import { markerClearance } from '../diagrams/class/notation';
import { TYPO } from '../theme';
import type { EdgeId, NodeId, Point, Rect } from '../types';
import { lineHeightPx, textWidth } from './measure';
import type { EdgeRoute } from './routing';
import { SIDE_NORMAL } from './routing';

/**
 * 전역 라벨 배치 (순수 함수, 탐욕적).
 * 모든 간선의 다중성(tail/head)·관계(center) 라벨을 한 번에 배치하면서
 * 노드 박스, 이미 배치된 라벨, 간선 선분과의 겹침을 점수화해 가장 좋은 후보를 고른다.
 */

export type LabelRole = 'tail' | 'head' | 'center';

/** 라벨 중심 좌표 + 크기 */
export interface PlacedLabel { x: number; y: number; w: number; h: number }
export type EdgeLabels = Partial<Record<LabelRole, PlacedLabel>>;

export interface LabelFonts {
  /** 관계(center) 라벨 폰트 */
  center: (edgeId: EdgeId) => number;
  /** 다중성(tail/head) 라벨 폰트 */
  endpoint: (edgeId: EdgeId) => number;
}

interface Segment { a: Point; b: Point; edgeId: EdgeId }

const labelSize = (text: string, fontPx: number) => ({
  w: Math.ceil(textWidth(text, fontPx) + TYPO.edgeLabelPadX * 2),
  h: lineHeightPx(fontPx) + TYPO.edgeLabelPadY * 2,
});

const toRect = (label: PlacedLabel): Rect => ({ x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h });

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 축 정렬 선분이 사각형을 지나는 길이 (근사) */
function segmentInside(segment: Segment, rect: Rect): number {
  const minX = Math.max(Math.min(segment.a.x, segment.b.x), rect.x);
  const maxX = Math.min(Math.max(segment.a.x, segment.b.x), rect.x + rect.w);
  const minY = Math.max(Math.min(segment.a.y, segment.b.y), rect.y);
  const maxY = Math.min(Math.max(segment.a.y, segment.b.y), rect.y + rect.h);
  if (minX > maxX || minY > maxY) return 0;
  return Math.max(maxX - minX, maxY - minY, 1);
}

/** 경로 전체 길이의 절반 지점과 그 선분의 방향 */
function pointAtHalfLength(points: readonly Point[]): { point: Point; horizontal: boolean } | undefined {
  const lengths = points.slice(0, -1).map((p, i) => Math.hypot(points[i + 1]!.x - p.x, points[i + 1]!.y - p.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!;
    if (remaining <= length && length > 0) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const t = remaining / length;
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) };
    }
    remaining -= length;
  }
  return undefined;
}

export function placeLabels(
  edges: readonly RelationEdge[],
  routes: Record<EdgeId, EdgeRoute>,
  rects: Record<NodeId, Rect>,
  fonts: LabelFonts,
): Record<EdgeId, EdgeLabels> {
  const nodeRects = Object.values(rects);
  const segments: Segment[] = [];
  for (const route of Object.values(routes)) {
    for (let index = 0; index < route.points.length - 1; index += 1) {
      segments.push({ a: route.points[index]!, b: route.points[index + 1]!, edgeId: route.edgeId });
    }
  }
  const placed: Rect[] = [];
  const result: Record<EdgeId, EdgeLabels> = {};

  const score = (candidate: PlacedLabel, preference: number, ownEdge?: EdgeId) => {
    const rect = toRect(candidate);
    let total = preference;
    for (const node of nodeRects) total += overlapArea(rect, node) * 12;
    for (const other of placed) total += overlapArea(rect, other) * 20;
    for (const segment of segments) {
      if (segment.edgeId === ownEdge) continue;
      total += segmentInside(segment, rect) * 30;
    }
    return total;
  };

  const choose = (candidates: PlacedLabel[], ownEdge?: EdgeId): PlacedLabel => {
    let best = candidates[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate, index) => {
      const value = score(candidate, index * 2, ownEdge);
      if (value < bestScore) {
        best = candidate;
        bestScore = value;
      }
    });
    placed.push(toRect(best));
    return best;
  };

  // 1) 끝점(다중성) 라벨 — 선택지가 적으므로 먼저
  for (const edge of edges) {
    const route = routes[edge.id];
    if (!route || route.points.length < 2) continue;
    const labels: EdgeLabels = (result[edge.id] = {});
    const fontPx = fonts.endpoint(edge.id);
    const ends = [
      { role: 'tail' as const, text: edge.sourceLabel, point: route.points[0]!, side: route.sourceSide, marker: edge.ends.source },
      { role: 'head' as const, text: edge.targetLabel, point: route.points[route.points.length - 1]!, side: route.targetSide, marker: edge.ends.target },
    ];
    for (const end of ends) {
      if (!end.text) continue;
      const { w, h } = labelSize(end.text, fontPx);
      const normal = SIDE_NORMAL[end.side];
      const perp = { x: -normal.y, y: normal.x };
      const vertical = normal.y !== 0;
      const halfAlong = vertical ? h / 2 : w / 2;
      const halfPerp = vertical ? w / 2 : h / 2;
      const clearance = Math.max(8, markerClearance(end.marker) * 0.6);
      const candidates: PlacedLabel[] = [];
      for (const extra of [0, 12, 26]) {
        for (const sign of [1, -1]) {
          const along = clearance + halfAlong + extra;
          const across = halfPerp + 5;
          candidates.push({
            x: end.point.x + normal.x * along + perp.x * across * sign,
            y: end.point.y + normal.y * along + perp.y * across * sign,
            w,
            h,
          });
        }
      }
      labels[end.role] = choose(candidates);
    }
  }

  // 2) 관계(center) 라벨 — 가장 긴 선분 중앙을 우선, 자기 간선 위는 허용(배경으로 선을 가림)
  for (const edge of edges) {
    const route = routes[edge.id];
    // 사용자 라벨이 없으면 «include» 같은 고정 스테레오타입 라벨을 배치한다
    const centerText = edge.label ?? edge.stereotype;
    if (!centerText || !route || route.points.length < 2) continue;
    const { w, h } = labelSize(centerText, fonts.center(edge.id));
    const ordered = route.points.slice(0, -1)
      .map((a, index) => ({ a, b: route.points[index + 1]! }))
      .sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y));
    const candidates: PlacedLabel[] = [];
    const halfway = pointAtHalfLength(route.points);
    if (halfway) {
      candidates.push({ x: halfway.point.x, y: halfway.point.y, w, h });
      for (const sign of [-1, 1]) {
        candidates.push(halfway.horizontal
          ? { x: halfway.point.x, y: halfway.point.y + sign * (h / 2 + 4), w, h }
          : { x: halfway.point.x + sign * (w / 2 + 4), y: halfway.point.y, w, h });
      }
    }
    // 긴 선분부터: 중앙 → 1/3·2/3 지점, 선 위 → 옆(가까이/멀리) 순으로 후보를 만든다
    for (const { a, b } of ordered.slice(0, 4)) {
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      for (const t of [0.5, 0.33, 0.67]) {
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        candidates.push({ ...at, w, h });
        for (const extra of [4, 18]) {
          for (const sign of [-1, 1]) {
            candidates.push(horizontal
              ? { x: at.x, y: at.y + sign * (h / 2 + extra), w, h }
              : { x: at.x + sign * (w / 2 + extra), y: at.y, w, h });
          }
        }
      }
    }
    (result[edge.id] ??= {}).center = choose(candidates, edge.id);
  }

  return result;
}
