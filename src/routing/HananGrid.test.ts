// src/routing/HananGrid.test.ts

import { describe, it, expect } from 'vitest';
import { buildHananGrid } from './HananGrid';

describe('buildHananGrid', () => {
  it('起终点坐标被加入网格', () => {
    const grid = buildHananGrid(
      { x: 33, y: 77 },
      { x: 219, y: 143 },
      [],
      5
    );
    expect(grid.xs).toContain(33);
    expect(grid.xs).toContain(219);
    expect(grid.ys).toContain(77);
    expect(grid.ys).toContain(143);
  });

  it('障碍物边界（膨胀后）被加入网格', () => {
    const grid = buildHananGrid(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      [{ x: 40, y: 40, w: 20, h: 20 }],
      5
    );
    // 障碍物 x=40, w=20 → 左边界 40-5=35，右边界 60+5=65
    expect(grid.xs).toContain(35);
    expect(grid.xs).toContain(65);
    expect(grid.ys).toContain(35);
    expect(grid.ys).toContain(65);
  });

  it('xs 和 ys 是有序、无重复的', () => {
    const grid = buildHananGrid(
      { x: 50, y: 50 },
      { x: 150, y: 150 },
      [
        { x: 80, y: 80, w: 20, h: 20 },
        { x: 120, y: 120, w: 20, h: 20 },
      ],
      5
    );
    for (let i = 1; i < grid.xs.length; i++) {
      expect(grid.xs[i]).toBeGreaterThan(grid.xs[i - 1]);
    }
    for (let i = 1; i < grid.ys.length; i++) {
      expect(grid.ys[i]).toBeGreaterThan(grid.ys[i - 1]);
    }
  });

  it('xIndex / yIndex 正确映射', () => {
    const grid = buildHananGrid(
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      [],
      5
    );
    for (let i = 0; i < grid.xs.length; i++) {
      expect(grid.xIndex.get(grid.xs[i])).toBe(i);
    }
    for (let i = 0; i < grid.ys.length; i++) {
      expect(grid.yIndex.get(grid.ys[i])).toBe(i);
    }
  });

  it('多障碍物时坐标正确合并', () => {
    const grid = buildHananGrid(
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      [
        { x: 50, y: 0, w: 20, h: 20 },
        { x: 150, y: 0, w: 20, h: 20 },
      ],
      5
    );
    // 两个障碍物膨胀后的左右边界
    expect(grid.xs).toContain(45);
    expect(grid.xs).toContain(75);
    expect(grid.xs).toContain(145);
    expect(grid.xs).toContain(175);
  });
});
