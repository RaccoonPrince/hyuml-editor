import { describe, expect, it } from 'vitest';
import { parseClassDiagram } from '../diagrams/class/parser';
import { toLayoutGraph } from '../diagrams/registry';
import type { Rect } from '../types';
import { layoutWithDagre } from './dagreEngine';
import { placeLabels } from './labels';
import { computeRoutes } from './routing';

const model = (body: string) => parseClassDiagram(`classDiagram\n${body}`).model!;
const box = (x: number, y: number, w = 160, h = 80): Rect => ({ x, y, w, h });
const key = (point: { x: number; y: number }) => `${Math.round(point.x)},${Math.round(point.y)}`;

describe('routing', () => {
  it('같은 변에 들어오고 나가는 간선이 같은 좌표를 공유하지 않는다 (슬롯 풀 버그 회귀)', () => {
    // B 아래쪽 변: B→C (나감), D→B (들어옴, D 가 아래에 있으므로 bottom 에 붙음)
    const m = model('B --> C\nD --> B');
    const rects = { B: box(200, 0), C: box(150, 300), D: box(300, 300) };
    const routes = computeRoutes(m.edges, rects);
    const out = routes['B|association|C']!;
    const inc = routes['D|association|B']!;
    expect(out.sourceSide).toBe('bottom');
    expect(inc.targetSide).toBe('bottom');
    expect(key(out.points[0]!)).not.toBe(key(inc.points[inc.points.length - 1]!));
  });

  it('한 변에 5개 넘는 간선도 모두 다른 끝점을 갖는다 (HANDLE_LIMIT 버그 회귀)', () => {
    const children = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    const m = model(children.map((child) => `P --> ${child}`).join('\n'));
    const rects: Record<string, Rect> = { P: box(400, 0, 400) };
    children.forEach((child, index) => { rects[child] = box(index * 180, 300); });
    const routes = computeRoutes(m.edges, rects);
    const starts = new Set(Object.values(routes).map((route) => key(route.points[0]!)));
    expect(starts.size).toBe(children.length);
  });

  it('모든 경로는 직교 선분으로만 이뤄진다', () => {
    const m = model('A --> B\nA --> C');
    const routes = computeRoutes(m.edges, { A: box(0, 0), B: box(300, 200), C: box(-200, 400) });
    for (const route of Object.values(routes)) {
      for (let i = 0; i < route.points.length - 1; i += 1) {
        const a = route.points[i]!;
        const b = route.points[i + 1]!;
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
      }
    }
  });
});

describe('labels', () => {
  it('다중성 라벨끼리, 그리고 노드와 겹치지 않는다', () => {
    const m = model('A "1" --> "0..*" B\nA "1" --> "1..*" C\nD "*" --> "1" A');
    const rects = { A: box(200, 200), B: box(100, 450), C: box(350, 450), D: box(200, -100) };
    const routes = computeRoutes(m.edges, rects);
    const labels = placeLabels(m.edges, routes, rects, { center: () => 12, endpoint: () => 11 });
    const placed = Object.values(labels).flatMap((entry) => Object.values(entry));
    const toRect = (l: { x: number; y: number; w: number; h: number }) => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
    const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let i = 0; i < placed.length; i += 1) {
      for (const rect of Object.values(rects)) expect(intersects(toRect(placed[i]!), rect)).toBe(false);
      for (let j = i + 1; j < placed.length; j += 1) expect(intersects(toRect(placed[i]!), toRect(placed[j]!))).toBe(false);
    }
  });
});

describe('layout graph', () => {
  it('상속 표기 방향과 무관하게 부모가 위에 배치된다 (상속 역배치 버그 회귀)', () => {
    for (const body of ['Animal <|-- Dog', 'Dog --|> Animal']) {
      const m = model(body);
      const positions = layoutWithDagre(toLayoutGraph(m), { Animal: { w: 160, h: 80 }, Dog: { w: 160, h: 80 } });
      expect(positions.Animal!.y).toBeLessThan(positions.Dog!.y);
    }
  });
});
