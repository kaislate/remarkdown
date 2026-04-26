import { describe, it, expect } from 'vitest';
import {
  pathLength,
  chordLength,
  straightness,
  closure,
  bbox,
  cornerAngles,
} from '../../src/lib/drawing-geometry';

describe('drawing-geometry', () => {
  describe('pathLength', () => {
    it('returns 0 for a single point or empty path', () => {
      expect(pathLength([])).toBe(0);
      expect(pathLength([[0, 0]])).toBe(0);
    });
    it('sums segment lengths along the path', () => {
      // (0,0)->(3,0)->(3,4) = 3 + 4 = 7
      expect(pathLength([[0, 0], [3, 0], [3, 4]])).toBe(7);
    });
  });

  describe('chordLength', () => {
    it('returns the start-to-end distance', () => {
      // (0,0) to (3,4) = 5
      expect(chordLength([[0, 0], [1, 1], [3, 4]])).toBe(5);
    });
    it('returns 0 if start equals end', () => {
      expect(chordLength([[5, 5], [10, 10], [5, 5]])).toBe(0);
    });
  });

  describe('straightness', () => {
    it('returns 1 for a perfectly straight path', () => {
      expect(straightness([[0, 0], [5, 0], [10, 0]])).toBeCloseTo(1.0);
    });
    it('returns ~0 for a closed-back-to-start path', () => {
      expect(straightness([[0, 0], [10, 0], [0, 0]])).toBe(0);
    });
    it('returns intermediate value for curved paths', () => {
      const v = straightness([[0, 0], [5, 5], [10, 0]]);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    });
  });

  describe('closure', () => {
    it('is small for a closed loop (start ~ end)', () => {
      const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0.1]];
      expect(closure(square)).toBeLessThan(0.05);
    });
    it('is large for an open path', () => {
      const line = [[0, 0], [50, 0]];
      expect(closure(line)).toBe(1);
    });
  });

  describe('bbox', () => {
    it('returns min/max x and y across all points', () => {
      const b = bbox([[1, 5], [10, 2], [4, 8]]);
      expect(b).toEqual({ minX: 1, maxX: 10, minY: 2, maxY: 8, width: 9, height: 6 });
    });
    it('returns zero-area bbox for a single point', () => {
      const b = bbox([[3, 7]]);
      expect(b).toEqual({ minX: 3, maxX: 3, minY: 7, maxY: 7, width: 0, height: 0 });
    });
  });

  describe('cornerAngles', () => {
    it('returns ~90° for each corner of a rectangle', () => {
      const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
      const angles = cornerAngles(square);
      expect(angles.length).toBe(3);
      angles.forEach((a) => expect(Math.abs(a - 90)).toBeLessThan(15));
    });
    it('returns smooth angles (~180°) for a circle approximation', () => {
      const circle: Array<[number, number]> = [];
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * 2 * Math.PI;
        circle.push([Math.cos(t) * 10, Math.sin(t) * 10]);
      }
      const angles = cornerAngles(circle);
      angles.forEach((a) => expect(a).toBeGreaterThan(120));
    });
  });
});
