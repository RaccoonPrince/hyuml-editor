import type { Point } from '../core/types';

export interface Bounds { x: number; y: number; width: number; height: number }

/**
 * 내보낼 영역 = 도형 경계 ∪ 연결선 경로(꺾임점 포함).
 * 연결선을 도형 바깥으로 꺾어도 이미지 가장자리에서 잘리지 않게 한다. 연결선이 모두 도형 경계 안이면 도형 경계를 그대로 돌려준다.
 */
export function exportBounds(nodeBounds: Bounds | null, paths: readonly (readonly Point[])[]): Bounds | null {
  let minX = nodeBounds ? nodeBounds.x : Number.POSITIVE_INFINITY;
  let minY = nodeBounds ? nodeBounds.y : Number.POSITIVE_INFINITY;
  let maxX = nodeBounds ? nodeBounds.x + nodeBounds.width : Number.NEGATIVE_INFINITY;
  let maxY = nodeBounds ? nodeBounds.y + nodeBounds.height : Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    for (const point of path) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
