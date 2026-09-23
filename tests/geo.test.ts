import { describe, expect, it } from 'vitest';
import { distanceToLineMeters, pointsNearLine } from '../shared/geo';

// Отрезок вдоль параллели 55° с.ш.
const line: [number, number][] = [
  [82.9, 55.03],
  [82.92, 55.03],
];
// 1° широты ≈ 111 195 м
const metersNorth = (m: number) => 55.03 + m / 111_195;

describe('distanceToLineMeters', () => {
  it('точка на линии — 0 м', () => {
    expect(distanceToLineMeters({ lat: 55.03, lon: 82.91 }, line)).toBeCloseTo(0, 3);
  });
  it('точка в 25 м к северу', () => {
    expect(distanceToLineMeters({ lat: metersNorth(25), lon: 82.91 }, line)).toBeCloseTo(25, 0);
  });
  it('за концом отрезка считается до конца', () => {
    const d = distanceToLineMeters({ lat: 55.03, lon: 82.9205 }, line);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(33);
  });
});

describe('pointsNearLine', () => {
  it('оставляет точки в пределах 30 м и сортирует по расстоянию', () => {
    const pts = [
      { id: 'far', lat: metersNorth(45), lon: 82.91 },
      { id: 'near', lat: metersNorth(10), lon: 82.905 },
      { id: 'edge', lat: metersNorth(29), lon: 82.915 },
    ];
    expect(pointsNearLine(pts, line, 30).map((p) => p.item.id)).toEqual(['near', 'edge']);
  });
});
