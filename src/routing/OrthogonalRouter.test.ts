// src/routing/OrthogonalRouter.test.ts

import { describe, it, expect } from 'vitest';
import { routeOrthogonal, type Dir } from './OrthogonalRouter';
import type { Point } from '../utils/geometry';
import type { RectWithId } from './HananGrid';

// ============================================================
// 断言工具
// ============================================================

/** 路径的每一段必须是水平或垂直 */
function assertOrthogonal(path: Point[]): void {
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    if (dx !== 0 && dy !== 0) {
      throw new Error(
        `非正交段: (${path[i - 1].x},${path[i - 1].y}) → (${path[i].x},${path[i].y})`
      );
    }
  }
}

/** 统计拐弯次数 */
function countBends(path: Point[]): number {
  // 去重
  const cleaned: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (path[i].x !== path[i - 1].x || path[i].y !== path[i - 1].y) {
      cleaned.push(path[i]);
    }
  }
  if (cleaned.length < 3) return 0;

  let bends = 0;
  for (let i = 1; i < cleaned.length - 1; i++) {
    const dx1 = Math.sign(cleaned[i].x - cleaned[i - 1].x);
    const dy1 = Math.sign(cleaned[i].y - cleaned[i - 1].y);
    const dx2 = Math.sign(cleaned[i + 1].x - cleaned[i].x);
    const dy2 = Math.sign(cleaned[i + 1].y - cleaned[i].y);
    if (dx1 !== dx2 || dy1 !== dy2) bends++;
  }
  return bends;
}

/** 路径是否避开了所有膨胀后的障碍物 */
function assertAvoidsObstacles(
  path: Point[],
  obstacles: RectWithId[],
  inflate: number
): void {
  for (let i = 1; i < path.length; i++) {
    const p0 = path[i - 1];
    const p1 = path[i];
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const steps = Math.max(2, Math.ceil(len / 5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      for (const r of obstacles) {
        const x1 = r.x - inflate;
        const y1 = r.y - inflate;
        const x2 = r.x + r.w + inflate;
        const y2 = r.y + r.h + inflate;
        if (x > x1 && x < x2 && y > y1 && y < y2) {
          throw new Error(
            `路径穿过障碍物 #${r.id}（点 ${x.toFixed(1)},${y.toFixed(1)}）`
          );
        }
      }
    }
  }
}

/** 路径中没有 180° 调头（相邻两段不反向） */
function assertNoUTurn(path: Point[]): void {
  for (let i = 2; i < path.length; i++) {
    const dx1 = Math.sign(path[i - 1].x - path[i - 2].x);
    const dy1 = Math.sign(path[i - 1].y - path[i - 2].y);
    const dx2 = Math.sign(path[i].x - path[i - 1].x);
    const dy2 = Math.sign(path[i].y - path[i - 1].y);
    if (dx1 === -dx2 && dy1 === -dy2 && (dx1 !== 0 || dy1 !== 0)) {
      throw new Error(
        `第 ${i - 1} 段发生了 180° 调头`
      );
    }
  }
}

// ============================================================
// 测试用例
// ============================================================

describe('routeOrthogonal - 基础', () => {
  it('无障碍、水平对齐 → 一条直线，0 拐弯', () => {
    const path = routeOrthogonal({
      start: { x: 0, y: 0 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 200, y: 0 },
      endPinDir: 'W',
      endCompId: 2,
      obstacles: [],
    });
    expect(path).not.toBeNull();
    assertOrthogonal(path!);
    expect(countBends(path!)).toBe(0);
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it('无障碍、垂直对齐 → 一条直线，0 拐弯', () => {
    const path = routeOrthogonal({
      start: { x: 50, y: 0 },
      startPinDir: 'S',
      startCompId: 1,
      end: { x: 50, y: 200 },
      endPinDir: 'N',
      endCompId: 2,
      obstacles: [],
    });
    expect(path).not.toBeNull();
    assertOrthogonal(path!);
    expect(countBends(path!)).toBe(0);
  });

  it('无障碍、对角 → 1 拐弯（L 形）', () => {
    const path = routeOrthogonal({
      start: { x: 0, y: 0 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 200, y: 200 },
      endPinDir: 'N',
      endCompId: 2,
      obstacles: [],
    });
    expect(path).not.toBeNull();
    assertOrthogonal(path!);
    // E 到 (200,0)，S 到 (200,200)。1 拐弯
    expect(countBends(path!)).toBe(1);
    assertNoUTurn(path!);
  });

  it('起始方向约束：第一段必须背离元件', () => {
    const path = routeOrthogonal({
      start: { x: 0, y: 0 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 100, y: 50 },
      endPinDir: 'W',
      endCompId: 2,
      obstacles: [],
    });
    expect(path).not.toBeNull();
    // 第一段必须是 E（x 增加）
    expect(path![1].x).toBeGreaterThan(path![0].x);
    expect(path![1].y).toBe(path![0].y);
  });
});

describe('routeOrthogonal - 避障', () => {
  it('中间有障碍物 → 绕开，不穿过', () => {
    const obstacles: RectWithId[] = [
      { id: 99, x: 80, y: 0, w: 40, h: 100 },
    ];
    const path = routeOrthogonal({
      start: { x: 0, y: 50 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 200, y: 50 },
      endPinDir: 'W',
      endCompId: 2,
      obstacles,
      inflate: 5,
    });
    expect(path).not.toBeNull();
    assertOrthogonal(path!);
    assertAvoidsObstacles(path!, obstacles, 5);
    assertNoUTurn(path!);
    // 至少 1 拐弯（必须绕）
    expect(countBends(path!)).toBeGreaterThanOrEqual(1);
  });

  it('终点被四面围栏包裹 → 返回 null', () => {
    // 终点 (150, 50) 被四面墙包裹，膨胀后无缝隙可入
    const cx = 150, cy = 50;
    const obstacles: RectWithId[] = [
      { id: 99, x: cx - 40, y: cy - 40, w: 80, h: 10 },  // 上方墙
      { id: 98, x: cx - 40, y: cy + 30, w: 80, h: 10 },  // 下方墙
      { id: 97, x: cx - 40, y: cy - 40, w: 10, h: 80 },  // 左方墙
      { id: 96, x: cx + 30, y: cy - 40, w: 10, h: 80 },  // 右方墙
    ];
    const path = routeOrthogonal({
      start: { x: 50, y: 50 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 150, y: 50 },
      endPinDir: 'W',
      endCompId: 2,
      obstacles,
      inflate: 5,
    });
    expect(path).toBeNull();
  });

  it('起终点所在元件不作为障碍物', () => {
    // 起点元件 AABB 覆盖起点位置，终点元件 AABB 覆盖终点位置
    const obstacles: RectWithId[] = [
      { id: 1, x: -30, y: -20, w: 60, h: 40 },   // 起点元件
      { id: 2, x: 170, y: -20, w: 60, h: 40 },   // 终点元件
    ];
    const path = routeOrthogonal({
      start: { x: 0, y: 0 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 200, y: 0 },
      endPinDir: 'W',
      endCompId: 2,
      obstacles,
      inflate: 5,
    });
    expect(path).not.toBeNull();
    assertOrthogonal(path!);
  });
});

describe('routeOrthogonal - 拐弯惩罚', () => {
  it('两个 L 形选择，选更短的那个', () => {
    // 起点 E 出发 → 只能先 E；终点 N 进入 → 最后一段 S
    // 两种可能：E,S 或 E,?,S... A* 应该选 E→S（1 拐弯，更短）
    const path = routeOrthogonal({
      start: { x: 0, y: 0 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 100, y: 100 },
      endPinDir: 'N',
      endCompId: 2,
      obstacles: [],
    });
    expect(path).not.toBeNull();
    expect(countBends(path!)).toBe(1);
  });

  it('绕远但少拐弯 vs 走近但多拐弯 → 倾向少拐弯', () => {
    // 场景：起点 (0,0) E 出发，终点 (200,0) W 进入
    // 障碍物在 y=0 附近，需要上下绕
    // 简单的绕行 = 3 拐弯（E,N,E,S,E），复杂绕行更多
    const obstacles: RectWithId[] = [
      { id: 99, x: 90, y: -20, w: 20, h: 40 },
    ];
    const path = routeOrthogonal({
      start: { x: 0, y: 0 },
      startPinDir: 'E',
      startCompId: 1,
      end: { x: 200, y: 0 },
      endPinDir: 'W',
      endCompId: 2,
      obstacles,
      inflate: 5,
    });
    expect(path).not.toBeNull();
    assertOrthogonal(path!);
    assertAvoidsObstacles(path!, obstacles, 5);
    // 最优解应该 ≤ 4 拐弯
    expect(countBends(path!)).toBeLessThanOrEqual(4);
  });
});
