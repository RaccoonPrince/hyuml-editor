import type { LayoutGraph } from '../diagrams/registry';
import type { LayoutEngineName } from '../document/schema';
import type { NodeId, Point } from '../types';

export type NodeSizes = Record<NodeId, { w: number; h: number }>;

/**
 * 레이아웃 엔진 교체 지점. 구현체는 노드의 좌상단 좌표만 돌려준다.
 * 간선 경로·라벨은 routing.ts / labels.ts 가 현재 좌표로부터 계산하므로
 * 사용자가 노드를 움직여도 엔진과 무관하게 일관된 결과가 나온다.
 */
export interface LayoutEngine {
  name: LayoutEngineName;
  layout(graph: LayoutGraph, sizes: NodeSizes): Promise<Record<NodeId, Point>>;
}

const cache = new Map<LayoutEngineName, Promise<LayoutEngine>>();

/** 엔진은 필요할 때 지연 로드한다 (ELK 는 ~1MB, Web Worker 에서 실행). */
export function getLayoutEngine(name: LayoutEngineName): Promise<LayoutEngine> {
  let engine = cache.get(name);
  if (!engine) {
    engine = name === 'elk'
      ? import('./elkEngine').then((module) => module.elkEngine)
      : import('./dagreEngine').then((module) => module.dagreEngine);
    // 로드 실패(네트워크 등) 시 다음 호출에서 재시도할 수 있게 캐시에서 제거
    engine.catch(() => cache.delete(name));
    cache.set(name, engine);
  }
  return engine;
}
