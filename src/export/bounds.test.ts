import { describe, expect, it } from 'vitest';
import { exportBounds } from './bounds';

const nodes = { x: 0, y: 0, width: 400, height: 200 };

describe('exportBounds', () => {
  it('연결선이 도형 경계 안이면 도형 경계 그대로', () => {
    expect(exportBounds(nodes, [[{ x: 10, y: 10 }, { x: 390, y: 190 }]])).toEqual(nodes);
    expect(exportBounds(nodes, [])).toEqual(nodes);
  });

  it('꺾임이 도형 바깥에 있으면 그만큼 영역이 넓어진다', () => {
    expect(exportBounds(nodes, [[{ x: 100, y: 0 }, { x: 100, y: -80 }, { x: 520, y: -80 }, { x: 520, y: 100 }]]))
      .toEqual({ x: 0, y: -80, width: 520, height: 280 });
    expect(exportBounds(nodes, [[{ x: -50, y: 300 }]])).toEqual({ x: -50, y: 0, width: 450, height: 300 });
  });

  it('도형이 없으면 경로만으로, 둘 다 없으면 null', () => {
    expect(exportBounds(null, [[{ x: 1, y: 2 }, { x: 5, y: 9 }]])).toEqual({ x: 1, y: 2, width: 4, height: 7 });
    expect(exportBounds(null, [])).toBeNull();
  });
});
