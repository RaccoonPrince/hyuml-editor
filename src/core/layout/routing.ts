import type { RelationEdge } from '../diagrams/class/model';
import type { Direction, EdgeId, NodeId, Point, Rect, Side } from '../types';
import type { Axis } from './orthoRouter';
import { ChannelUsage, expand, findOrthogonalPath, pathHitsObstacles, throughWaypoints } from './orthoRouter';

/**
 * 간선 라우팅 (순수 함수).
 * 1) 두 노드의 상대 위치로 나가는/들어오는 변(side)을 정한다.
 * 2) 노드의 한 변에 붙는 모든 끝점(source·target 구분 없이)을 하나의 슬롯 풀로 모아
 *    상대편 위치 순으로 균등 배치한다 → 끝점 좌표가 겹치지 않고, 개수 제한도 없다.
 * 3) 직교(orthogonal) 경로를 만든다.
 */

export interface EdgeRoute {
  edgeId: EdgeId;
  points: Point[];
  sourceSide: Side;
  targetSide: Side;
}

const STUB = 20;
const SELF_LOOP = 30;

export const SIDE_NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const center = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
const isVertical = (side: Side) => side === 'top' || side === 'bottom';

/**
 * 나가는/들어오는 변 선택 — Mermaid 처럼 레이아웃 흐름 방향을 따른다.
 * TB/BT: 상대가 위·아래 다른 줄에 있으면 무조건 아래→위(또는 위→아래) 변으로 연결하고,
 *        같은 줄(세로로 겹침)일 때만 좌우 변을 쓴다. LR/RL 은 축을 바꿔 같은 규칙.
 */
export function chooseSides(a: Rect, b: Rect, direction: Direction = 'TB'): [Side, Side] {
  const gap = 8;
  const ac = center(a);
  const bc = center(b);
  if (direction === 'TB' || direction === 'BT') {
    if (b.y >= a.y + a.h + gap) return ['bottom', 'top'];
    if (b.y + b.h + gap <= a.y) return ['top', 'bottom'];
    return bc.x >= ac.x ? ['right', 'left'] : ['left', 'right'];
  }
  if (b.x >= a.x + a.w + gap) return ['right', 'left'];
  if (b.x + b.w + gap <= a.x) return ['left', 'right'];
  return bc.y >= ac.y ? ['bottom', 'top'] : ['top', 'bottom'];
}

function slotPoint(rect: Rect, side: Side, index: number, count: number): Point {
  const length = isVertical(side) ? rect.w : rect.h;
  const margin = Math.min(14, length / 4);
  const t = margin + ((length - margin * 2) * (index + 1)) / (count + 1);
  switch (side) {
    case 'top': return { x: rect.x + t, y: rect.y };
    case 'bottom': return { x: rect.x + t, y: rect.y + rect.h };
    case 'left': return { x: rect.x, y: rect.y + t };
    default: return { x: rect.x + rect.w, y: rect.y + t };
  }
}

interface Endpoint { edgeIndex: number; end: 'source' | 'target'; node: NodeId; side: Side; toward: Point }

export interface RouteOptions {
  /** 사용자가 꺾은 연결선의 경유점 */
  waypoints?: Record<EdgeId, readonly Point[]>;
  /** 다이어그램 흐름 방향 (나가는 변 선택 기준) */
  direction?: Direction;
  /** 지정하면 이 간선들만 경로를 계산한다 (끝점 슬롯 배정은 전체 기준 그대로). 드래그 중 갱신 비용을 줄이는 근사 모드 */
  only?: ReadonlySet<EdgeId>;
}

export function computeRoutes(
  edges: readonly RelationEdge[],
  rects: Record<NodeId, Rect>,
  options: RouteOptions = {},
): Record<EdgeId, EdgeRoute> {
  const endpoints: Endpoint[] = [];
  const sidesByEdge = new Map<number, [Side, Side]>();

  edges.forEach((edge, edgeIndex) => {
    const a = rects[edge.source];
    const b = rects[edge.target];
    if (!a || !b) return;
    const sides: [Side, Side] = edge.source === edge.target ? ['right', 'top'] : chooseSides(a, b, options.direction);
    sidesByEdge.set(edgeIndex, sides);
    const selfTarget = { x: a.x + a.w, y: a.y };
    endpoints.push(
      { edgeIndex, end: 'source', node: edge.source, side: sides[0], toward: edge.source === edge.target ? selfTarget : center(b) },
      { edgeIndex, end: 'target', node: edge.target, side: sides[1], toward: edge.source === edge.target ? selfTarget : center(a) },
    );
  });

  // 통합 슬롯 풀: (노드, 변) 단위로 source/target 을 함께 정렬
  const pools = new Map<string, Endpoint[]>();
  for (const endpoint of endpoints) {
    const key = `${endpoint.node}\u0000${endpoint.side}`;
    const pool = pools.get(key) ?? [];
    pool.push(endpoint);
    pools.set(key, pool);
  }
  const pointOf = new Map<string, Point>();
  for (const pool of pools.values()) {
    const side = pool[0]!.side;
    pool.sort((p, q) => (isVertical(side) ? p.toward.x - q.toward.x : p.toward.y - q.toward.y)
      || p.edgeIndex - q.edgeIndex || (p.end === 'source' ? -1 : 1));
    pool.forEach((endpoint, index) => {
      pointOf.set(`${endpoint.edgeIndex}:${endpoint.end}`, slotPoint(rects[endpoint.node]!, side, index, pool.length));
    });
  }

  const routes: Record<EdgeId, EdgeRoute> = {};
  const obstacles = Object.values(rects).map((rect) => expand(rect));
  const usage = new ChannelUsage();
  // 짧은 간선부터 확정 → 긴 간선이 남은 통로로 우회 (전체 교차가 줄어든다)
  const order = edges.map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .sort((p, q) => spanOf(p.edgeIndex) - spanOf(q.edgeIndex));
  function spanOf(edgeIndex: number) {
    const s = pointOf.get(`${edgeIndex}:source`);
    const t = pointOf.get(`${edgeIndex}:target`);
    return s && t ? Math.abs(s.x - t.x) + Math.abs(s.y - t.y) : 0;
  }

  const channelOf = channelFractions(edges, sidesByEdge, pointOf);

  for (const { edge, edgeIndex } of order) {
    const sides = sidesByEdge.get(edgeIndex);
    const start = pointOf.get(`${edgeIndex}:source`);
    const end = pointOf.get(`${edgeIndex}:target`);
    if (!sides || !start || !end) continue;
    if (options.only && !options.only.has(edge.id)) continue;
    let points: Point[];
    const waypoints = options.waypoints?.[edge.id];
    if (edge.source === edge.target) {
      points = selfLoopPoints(start, end);
    } else if (waypoints && waypoints.length > 0) {
      const a = offset(start, sides[0], STUB);
      const b = offset(end, sides[1], STUB);
      points = simplify([start, ...throughWaypoints(a, b, axisOf(sides[0]), waypoints), end]);
    } else {
      points = routeAvoiding(start, sides[0], end, sides[1], obstacles, usage, channelOf.get(edgeIndex) ?? 0.5);
    }
    usage.record(points);
    routes[edge.id] = { edgeId: edge.id, points, sourceSide: sides[0], targetSide: sides[1] };
  }
  return routes;
}

const axisOf = (side: Side): Axis => (isVertical(side) ? 'v' : 'h');

/**
 * 같은 도형의 같은 변에서 같은 쪽으로 퍼져 나가는 간선들의 "꺾이는 높이"를 서로 다르게 한다.
 * 먼 목적지로 가는 간선일수록 먼저(도형 가까이서) 꺾으면 퍼져 나가는 선끼리 교차·겹침이 없다.
 * 값은 두 돌출부 사이 구간에서의 비율(0~1).
 */
function channelFractions(
  edges: readonly RelationEdge[],
  sidesByEdge: Map<number, [Side, Side]>,
  pointOf: Map<string, Point>,
): Map<number, number> {
  const groups = new Map<string, { edgeIndex: number; spread: number }[]>();
  edges.forEach((edge, edgeIndex) => {
    const sides = sidesByEdge.get(edgeIndex);
    const start = pointOf.get(`${edgeIndex}:source`);
    const end = pointOf.get(`${edgeIndex}:target`);
    if (!sides || !start || !end || edge.source === edge.target) return;
    if (isVertical(sides[0]) !== isVertical(sides[1])) return; // ㄱ자 경로는 꺾임이 하나라 해당 없음
    const spread = isVertical(sides[0]) ? end.x - start.x : end.y - start.y;
    if (Math.abs(spread) < 1) return;
    const key = `${edge.source}|${sides[0]}|${spread > 0 ? '+' : '-'}`;
    groups.set(key, [...(groups.get(key) ?? []), { edgeIndex, spread: Math.abs(spread) }]);
  });
  const fractions = new Map<number, number>();
  for (const group of groups.values()) {
    group.sort((p, q) => q.spread - p.spread);
    group.forEach(({ edgeIndex }, index) => fractions.set(edgeIndex, (index + 1) / (group.length + 1)));
  }
  return fractions;
}

/** 단순 직교 경로가 도형을 뚫으면 A* 로 우회한다 */
function routeAvoiding(start: Point, startSide: Side, end: Point, endSide: Side, obstacles: readonly Rect[], usage: ChannelUsage, channel = 0.5): Point[] {
  const a = offset(start, startSide, STUB);
  const b = offset(end, endSide, STUB);
  // 검사는 단순화 전 "돌출부(stub) 사이" 구간으로 한다. (stub 은 자기 도형 여백 안이라 제외,
  // 단순화하면 일직선 경로가 [start, end] 만 남아 검사할 선분이 사라지는 문제 방지)
  const core = [a, ...elbowPoints(a, startSide, b, endSide, channel), b];
  if (!pathHitsObstacles(core, obstacles)) return simplify([start, ...core, end]);
  const path = findOrthogonalPath(a, b, axisOf(startSide), axisOf(endSide), obstacles, usage);
  return simplify([start, ...(path ?? core), end]);
}

function selfLoopPoints(start: Point, end: Point): Point[] {
  const x = Math.max(start.x, end.x) + SELF_LOOP;
  const y = Math.min(start.y, end.y) - SELF_LOOP;
  return [start, { x, y: start.y }, { x, y }, { x: end.x, y }, end];
}

const offset = (point: Point, side: Side, distance: number): Point => ({
  x: point.x + SIDE_NORMAL[side].x * distance,
  y: point.y + SIDE_NORMAL[side].y * distance,
});

/** 두 돌출부 끝(a, b)을 잇는 꺾임점 (단순 ㄱ/ㄹ 자) */
function elbowPoints(a: Point, startSide: Side, b: Point, endSide: Side, channel = 0.5): Point[] {
  if (isVertical(startSide) && !isVertical(endSide)) return [{ x: a.x, y: b.y }];
  if (!isVertical(startSide) && isVertical(endSide)) return [{ x: b.x, y: a.y }];
  if (isVertical(startSide)) {
    const middle = a.y + (b.y - a.y) * channel;
    return [{ x: a.x, y: middle }, { x: b.x, y: middle }];
  }
  const middle = a.x + (b.x - a.x) * channel;
  return [{ x: middle, y: a.y }, { x: middle, y: b.y }];
}

/** 중복점·일직선 중간점 제거 */
export function simplify(points: Point[]): Point[] {
  const unique = points.filter((point, index) => index === 0
    || Math.abs(point.x - points[index - 1]!.x) > 0.01 || Math.abs(point.y - points[index - 1]!.y) > 0.01);
  if (unique.length < 3) return unique;
  const result: Point[] = [unique[0]!];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const prev = result[result.length - 1]!;
    const current = unique[index]!;
    const next = unique[index + 1]!;
    const collinear = (Math.abs(prev.x - current.x) < 0.01 && Math.abs(current.x - next.x) < 0.01)
      || (Math.abs(prev.y - current.y) < 0.01 && Math.abs(current.y - next.y) < 0.01);
    if (!collinear) result.push(current);
  }
  result.push(unique[unique.length - 1]!);
  return result;
}

/** 모서리를 둥글린 SVG path */
export function pointsToPath(points: readonly Point[], radius = 6): string {
  if (points.length < 2) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const r1 = Math.min(radius, Math.hypot(prev.x - current.x, prev.y - current.y) / 2);
    const r2 = Math.min(radius, Math.hypot(next.x - current.x, next.y - current.y) / 2);
    const inX = current.x + Math.sign(prev.x - current.x) * r1;
    const inY = current.y + Math.sign(prev.y - current.y) * r1;
    const outX = current.x + Math.sign(next.x - current.x) * r2;
    const outY = current.y + Math.sign(next.y - current.y) * r2;
    path += ` L ${inX} ${inY} Q ${current.x} ${current.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1]!;
  return `${path} L ${last.x} ${last.y}`;
}
