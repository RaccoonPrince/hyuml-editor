import { describe, expect, it } from 'vitest';
import { parseClassDiagram } from '../diagrams/class/parser';
import { toLayoutGraph } from '../diagrams/registry';
import type { Point, Rect } from '../types';
import { layoutWithDagre } from './dagreEngine';
import { pathHitsObstacles } from './orthoRouter';
import { computeRoutes } from './routing';

const model = (body: string) => parseClassDiagram(`classDiagram\n${body}`).model!;
const box = (x: number, y: number, w = 160, h = 80): Rect => ({ x, y, w, h });
const orthogonal = (points: Point[]) => points.every((p, i) => i === 0 || Math.abs(p.x - points[i - 1]!.x) < 0.01 || Math.abs(p.y - points[i - 1]!.y) < 0.01);

describe('장애물 회피 라우팅 (정렬 후 간선–객체 겹침 방지)', () => {
  it('두 도형 사이를 가로막는 도형을 뚫지 않고 돌아간다', () => {
    // A(위) → C(아래), 그 사이 정중앙에 B
    const m = model('A --> C\nclass B');
    const rects = { A: box(200, 0), B: box(180, 200, 200, 80), C: box(200, 400) };
    const route = computeRoutes(m.edges, rects)['A|association|C']!;
    expect(orthogonal(route.points)).toBe(true);
    expect(pathHitsObstacles(route.points, [rects.B])).toBe(false);
  });

  it('자동 정렬(dagre) 결과의 모든 간선이 끝점이 아닌 도형을 지나지 않는다', () => {
    const lines: string[] = [];
    for (let i = 1; i < 16; i += 1) lines.push(`C${Math.floor((i - 1) / 3)} --> C${i}`);
    lines.push('C0 --> C15', 'C1 --> C14', 'C2 --> C12', 'C3 <|-- C13');
    const m = model(lines.join('\n'));
    const sizes = Object.fromEntries(m.nodes.map((n) => [n.id, { w: 160, h: 90 }]));
    const positions = layoutWithDagre(toLayoutGraph(m), sizes);
    const rects: Record<string, Rect> = Object.fromEntries(m.nodes.map((n) => [n.id, { ...positions[n.id]!, ...sizes[n.id]! }]));
    const routes = computeRoutes(m.edges, rects);
    for (const edge of m.edges) {
      const others = Object.entries(rects).filter(([id]) => id !== edge.source && id !== edge.target).map(([, r]) => r);
      expect(pathHitsObstacles(routes[edge.id]!.points, others), `${edge.id} 가 도형을 관통`).toBe(false);
      expect(orthogonal(routes[edge.id]!.points)).toBe(true);
    }
  });

  it('사용자 꺾임점을 반드시 지난다 (명세 FR-12)', () => {
    const m = model('A --> B');
    const rects = { A: box(0, 0), B: box(0, 300) };
    const waypoint = { x: 400, y: 150 };
    const route = computeRoutes(m.edges, rects, { waypoints: { 'A|association|B': [waypoint] } })['A|association|B']!;
    expect(route.points.some((p) => Math.abs(p.x - waypoint.x) < 0.01 && Math.abs(p.y - waypoint.y) < 0.01)).toBe(true);
    expect(orthogonal(route.points)).toBe(true);
  });
});

describe('그룹 인식 자동 배치', () => {
  it('dagre cluster: 같은 그룹 구성원 상자 안에 다른 도형이 끼지 않는다', () => {
    const m = model('namespace G {\n  class A\n  class B\n}\nX --> A\nX --> Y\nX --> B\nY --> Z');
    const sizes = Object.fromEntries(m.nodes.map((n) => [n.id, { w: 140, h: 70 }]));
    const positions = layoutWithDagre(toLayoutGraph(m), sizes);
    const members = ['A', 'B'].map((id) => ({ ...positions[id]!, ...sizes[id]! }));
    const minX = Math.min(...members.map((r) => r.x));
    const maxX = Math.max(...members.map((r) => r.x + r.w));
    const minY = Math.min(...members.map((r) => r.y));
    const maxY = Math.max(...members.map((r) => r.y + r.h));
    for (const id of ['X', 'Y', 'Z']) {
      const r = { ...positions[id]!, ...sizes[id]! };
      const inside = r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY;
      expect(inside, `${id} 가 그룹 G 영역에 겹침`).toBe(false);
    }
  });
});

describe('Mermaid 식 배치 규칙', () => {
  it('같은 줄(rank)의 도형은 윗변이 맞춰진다', async () => {
    const { alignRanks } = await import('./dagreEngine');
    const m = model('A --> B\nA --> C');
    const sizes = { A: { w: 160, h: 80 }, B: { w: 160, h: 200 }, C: { w: 160, h: 60 } };
    const positions = alignRanks(layoutWithDagre(toLayoutGraph(m), sizes), sizes, 'TB');
    expect(positions.B!.y).toBe(positions.C!.y);
    expect(positions.A!.y + sizes.A.h).toBeLessThan(positions.B!.y);
  });

  it('위→아래 흐름에서 아래 줄 도형으로 가는 간선은 옆으로 멀어도 아래 변 → 위 변으로 연결된다', () => {
    const m = model('A --> B');
    const route = computeRoutes(m.edges, { A: box(0, 0), B: box(900, 200) }, { direction: 'TB' })['A|association|B']!;
    expect([route.sourceSide, route.targetSide]).toEqual(['bottom', 'top']);
  });

  it('한 도형에서 퍼져 나가는 간선들의 가로 구간이 같은 높이에서 겹치지 않는다', () => {
    const m = model('S --> A\nS --> B\nS --> C');
    const rects = { S: box(0, 0, 200, 80), A: box(300, 300), B: box(550, 300), C: box(800, 300) };
    const routes = computeRoutes(m.edges, rects, { direction: 'TB' });
    const horizontalYs = Object.values(routes).map((route) => {
      const segment = route.points.slice(0, -1).map((p, i) => [p, route.points[i + 1]!] as const)
        .find(([p, q]) => Math.abs(p.y - q.y) < 0.01 && Math.abs(p.x - q.x) > 50);
      return segment ? Math.round(segment[0].y) : undefined;
    });
    expect(new Set(horizontalYs).size).toBe(3);
  });
});
