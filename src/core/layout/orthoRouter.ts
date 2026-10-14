import type { Point, Rect } from '../types';

/**
 * 장애물(도형)을 피하는 직교 경로 탐색 (순수 함수).
 * 도형 가장자리 좌표로 만든 희소 격자 위에서 A* 를 돌린다.
 * 비용 = 길이 + 꺾임 벌점 + 이미 다른 간선이 쓰는 통로 벌점.
 */

export const OBSTACLE_MARGIN = 12;
const BEND_COST = 40;
const REUSE_COST = 0.8;

export type Axis = 'h' | 'v';

/** 축 정렬 선분이 사각형 "내부"를 지나는가 (경계에 닿는 것은 허용) */
export function segmentHitsRect(p: Point, q: Point, rect: Rect): boolean {
  const eps = 0.5;
  if (Math.abs(p.y - q.y) < 0.01) {
    const y = p.y;
    if (y <= rect.y + eps || y >= rect.y + rect.h - eps) return false;
    return Math.min(p.x, q.x) < rect.x + rect.w - eps && Math.max(p.x, q.x) > rect.x + eps;
  }
  const x = p.x;
  if (x <= rect.x + eps || x >= rect.x + rect.w - eps) return false;
  return Math.min(p.y, q.y) < rect.y + rect.h - eps && Math.max(p.y, q.y) > rect.y + eps;
}

const inside = (p: Point, rect: Rect) => p.x > rect.x + 0.5 && p.x < rect.x + rect.w - 0.5 && p.y > rect.y + 0.5 && p.y < rect.y + rect.h - 0.5;

export function pathHitsObstacles(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const rect of obstacles) if (segmentHitsRect(points[index]!, points[index + 1]!, rect)) return true;
  }
  return false;
}

export const expand = (rect: Rect, margin = OBSTACLE_MARGIN): Rect => ({ x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 });

/** 간선끼리 같은 통로를 덜 쓰도록, 경로가 확정될 때마다 사용 기록을 남긴다 */
export class ChannelUsage {
  private readonly used = new Map<string, number>();
  private static key(p: Point, q: Point) {
    const [a, b] = p.x < q.x || (p.x === q.x && p.y < q.y) ? [p, q] : [q, p];
    return `${Math.round(a.x)},${Math.round(a.y)},${Math.round(b.x)},${Math.round(b.y)}`;
  }
  count(p: Point, q: Point) { return this.used.get(ChannelUsage.key(p, q)) ?? 0; }
  record(points: readonly Point[]) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const p = points[index]!;
      const q = points[index + 1]!;
      // 긴 선분도 격자 단위로 겹침을 잡도록 전체 선분 키 + 양 끝 좌표축 키를 함께 기록
      const key = ChannelUsage.key(p, q);
      this.used.set(key, (this.used.get(key) ?? 0) + 1);
      const lane = Math.abs(p.y - q.y) < 0.01 ? `h:${Math.round(p.y)}` : `v:${Math.round(p.x)}`;
      this.used.set(lane, (this.used.get(lane) ?? 0) + 1);
    }
  }
  lane(p: Point, q: Point) {
    const lane = Math.abs(p.y - q.y) < 0.01 ? `h:${Math.round(p.y)}` : `v:${Math.round(p.x)}`;
    return this.used.get(lane) ?? 0;
  }
}

class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];
  get size() { return this.keys.length; }
  push(value: number, key: number) {
    this.keys.push(key);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.values[0]!;
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.values[a], this.values[b]] = [this.values[b]!, this.values[a]!];
  }
}

function uniqueSorted(values: number[]): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) if (result.length === 0 || value - result[result.length - 1]! > 0.5) result.push(value);
  return result;
}

/**
 * a → b 직교 경로 (a, b 포함). startAxis: a 에서 출발할 때 이어지면 꺾임이 없는 축,
 * endAxis: b 에 도착할 때 꺾임이 없는 축. 실패하면 undefined.
 */
export function findOrthogonalPath(
  a: Point,
  b: Point,
  startAxis: Axis,
  endAxis: Axis,
  allObstacles: readonly Rect[],
  usage?: ChannelUsage,
): Point[] | undefined {
  const obstacles = allObstacles.filter((rect) => !inside(a, rect) && !inside(b, rect));
  // 먼저 주변 영역만으로 시도하고, 실패하면 전체로 넓힌다 (드래그 중 비용 절감)
  const around = 160;
  const region: Rect = {
    x: Math.min(a.x, b.x) - around, y: Math.min(a.y, b.y) - around,
    w: Math.abs(a.x - b.x) + around * 2, h: Math.abs(a.y - b.y) + around * 2,
  };
  const local = obstacles.filter((rect) => rect.x < region.x + region.w && rect.x + rect.w > region.x && rect.y < region.y + region.h && rect.y + rect.h > region.y);
  return search(a, b, startAxis, endAxis, local, usage, around)
    ?? (local.length < obstacles.length ? search(a, b, startAxis, endAxis, obstacles, usage, 400) : undefined);
}

function search(a: Point, b: Point, startAxis: Axis, endAxis: Axis, obstacles: readonly Rect[], usage: ChannelUsage | undefined, border: number): Point[] | undefined {
  const edgesX = obstacles.flatMap((rect) => [rect.x, rect.x + rect.w]);
  const edgesY = obstacles.flatMap((rect) => [rect.y, rect.y + rect.h]);
  const baseX = uniqueSorted([a.x, b.x, ...edgesX, Math.min(a.x, b.x, ...edgesX) - border / 2, Math.max(a.x, b.x, ...edgesX) + border / 2]);
  const baseY = uniqueSorted([a.y, b.y, ...edgesY, Math.min(a.y, b.y, ...edgesY) - border / 2, Math.max(a.y, b.y, ...edgesY) + border / 2]);
  // 인접 좌표 사이 중앙선 = 도형 사이 통로
  const xs = uniqueSorted([...baseX, ...baseX.slice(1).map((x, i) => (x + baseX[i]!) / 2)]);
  const ys = uniqueSorted([...baseY, ...baseY.slice(1).map((y, i) => (y + baseY[i]!) / 2)]);
  const nx = xs.length;
  const ny = ys.length;
  const ia = xs.findIndex((x) => Math.abs(x - a.x) < 0.51);
  const ja = ys.findIndex((y) => Math.abs(y - a.y) < 0.51);
  const ib = xs.findIndex((x) => Math.abs(x - b.x) < 0.51);
  const jb = ys.findIndex((y) => Math.abs(y - b.y) < 0.51);
  if (ia < 0 || ja < 0 || ib < 0 || jb < 0) return undefined;

  const blockedPoint = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const p = { x: xs[i]!, y: ys[j]! };
      if (obstacles.some((rect) => inside(p, rect))) blockedPoint[i * ny + j] = 1;
    }
  }

  // 상태 = (점, 도착 축) → 꺾임 비용 계산
  const stateCount = nx * ny * 2;
  const cost = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(stateCount).fill(-1);
  const heap = new MinHeap();
  const axisIndex = (axis: Axis) => (axis === 'h' ? 0 : 1);
  const start = (ia * ny + ja) * 2 + axisIndex(startAxis);
  cost[start] = 0;
  heap.push(start, 0);
  const heuristic = (i: number, j: number) => Math.abs(xs[i]! - b.x) + Math.abs(ys[j]! - b.y);
  const goalPoint = ib * ny + jb;
  let goal = -1;
  let expanded = 0;

  while (heap.size > 0 && expanded < 60_000) {
    const state = heap.pop();
    expanded += 1;
    const point = state >> 1;
    const axis = state & 1;
    if (point === goalPoint) {
      // 도착 축이 다르면 꺾임 1회 추가 비용 — 더 나은 후보가 큐에 남아 있을 수 있으니 한 번 더 비교
      goal = state;
      if (axis === axisIndex(endAxis)) break;
      continue;
    }
    const i = Math.floor(point / ny);
    const j = point % ny;
    const here = { x: xs[i]!, y: ys[j]! };
    const neighbors: [number, number, number][] = [[i + 1, j, 0], [i - 1, j, 0], [i, j + 1, 1], [i, j - 1, 1]];
    for (const [ni, nj, nAxis] of neighbors) {
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const nPoint = ni * ny + nj;
      if (blockedPoint[nPoint] && nPoint !== goalPoint) continue;
      const there = { x: xs[ni]!, y: ys[nj]! };
      if (obstacles.some((rect) => segmentHitsRect(here, there, rect))) continue;
      const length = Math.abs(there.x - here.x) + Math.abs(there.y - here.y);
      let step = length + (nAxis !== axis ? BEND_COST : 0);
      if (usage) step += (usage.count(here, there) + usage.lane(here, there) * 0.5) * REUSE_COST * Math.min(length, 60);
      if (nPoint === goalPoint && nAxis !== axisIndex(endAxis)) step += BEND_COST;
      const nState = nPoint * 2 + nAxis;
      const next = cost[state]! + step;
      if (next < cost[nState]!) {
        cost[nState] = next;
        prev[nState] = state;
        heap.push(nState, next + heuristic(ni, nj));
      }
    }
  }
  if (goal < 0) return undefined;
  const alternative = goalPoint * 2 + (1 - (goal & 1));
  if (cost[alternative]! < cost[goal]!) goal = alternative;

  const path: Point[] = [];
  for (let state = goal; state >= 0; state = prev[state]!) {
    const point = state >> 1;
    path.push({ x: xs[Math.floor(point / ny)]!, y: ys[point % ny]! });
    if (state === start) break;
  }
  return path.reverse();
}

/** 경유점을 차례로 지나는 직교 경로 (사용자가 꺾은 연결선) */
export function throughWaypoints(a: Point, b: Point, startAxis: Axis, waypoints: readonly Point[]): Point[] {
  const points: Point[] = [a];
  let axis = startAxis;
  /** 직전 진행 방향 부호 (되돌아가는 꺾임을 피하기 위해) */
  let heading = 0;
  for (const target of [...waypoints, b]) {
    const current = points[points.length - 1]!;
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5) {
      points.push(target);
      axis = Math.abs(dx) < 0.5 ? 'v' : 'h';
      heading = Math.sign(axis === 'h' ? dx : dy);
      continue;
    }
    // 진행 중인 축을 이어가되, 그러면 뒤로 되돌아가게 되는 경우엔 다른 축으로 먼저 꺾는다
    const continueDelta = axis === 'h' ? dx : dy;
    const reverses = heading !== 0 && Math.sign(continueDelta) === -heading;
    const firstAxis: Axis = reverses ? (axis === 'h' ? 'v' : 'h') : axis;
    const corner = firstAxis === 'h' ? { x: target.x, y: current.y } : { x: current.x, y: target.y };
    points.push(corner, target);
    axis = firstAxis === 'h' ? 'v' : 'h';
    heading = Math.sign(axis === 'h' ? dx : dy);
  }
  return points;
}
