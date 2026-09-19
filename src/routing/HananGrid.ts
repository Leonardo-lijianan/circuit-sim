// src/routing/HananGrid.ts

import type { Point } from '../utils/geometry';

/**
 * 矩形（元件 AABB）
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 带 id 的矩形（用于排除起终点元件）
 */
export interface RectWithId extends Rect {
  id: number;
}

/**
 * Hanan Grid：由关键坐标交叉点构成的稀疏网格
 *
 * 关键坐标来源：
 *   - 起点 / 终点的 x, y
 *   - 每个障碍物的左 / 右 / 上 / 下边界（膨胀后）
 *
 * 性质：
 *   - 障碍物边界一定是网格坐标
 *   - 相邻网格坐标之间的线段不会穿过任何障碍物的内部
 */
export interface HananGrid {
  xs: number[];
  ys: number[];
  xIndex: Map<number, number>;
  yIndex: Map<number, number>;
}

/**
 * 构造 Hanan Grid
 *
 * @param start 起点
 * @param end 终点
 * @param obstacles 障碍物（已排除起终点元件）
 * @param inflate 膨胀量（安全间距）
 */
export function buildHananGrid(
  start: Point,
  end: Point,
  obstacles: Rect[],
  inflate: number = 5,
  routingGrid: number = 10
): HananGrid {
  const xSet = new Set<number>();
  const ySet = new Set<number>();

  // 起终点坐标（强制加入）
  xSet.add(start.x);
  ySet.add(start.y);
  xSet.add(end.x);
  ySet.add(end.y);

  // 障碍物边界（膨胀后）
  for (const r of obstacles) {
    xSet.add(r.x - inflate);
    xSet.add(r.x + r.w + inflate);
    ySet.add(r.y - inflate);
    ySet.add(r.y + r.h + inflate);
  }

  // 起终点连线的外包矩形区域加密
  //
  // 原因：只有起终点 + 障碍物边界作为坐标时，格点太稀疏。
  // 比如起 (0,0) 终 (100,50)，xs={0,100} ys={0,50}，
  // 唯一可能的 L 形路径最后一段方向是 S —— 若终点要求最后一段为 E
  // （引脚朝西、从西侧进入），就找不到合法路径。
  //
  // 加密后，xs 包含 10/20/.../90，提供充足的中间拐点。
  const bboxMinX = Math.min(start.x, end.x);
  const bboxMaxX = Math.max(start.x, end.x);
  const bboxMinY = Math.min(start.y, end.y);
  const bboxMaxY = Math.max(start.y, end.y);

  for (
    let x = Math.ceil(bboxMinX / routingGrid) * routingGrid;
    x <= bboxMaxX;
    x += routingGrid
  ) {
    xSet.add(x);
  }
  for (
    let y = Math.ceil(bboxMinY / routingGrid) * routingGrid;
    y <= bboxMaxY;
    y += routingGrid
  ) {
    ySet.add(y);
  }

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);

  const xIndex = new Map<number, number>();
  const yIndex = new Map<number, number>();
  xs.forEach((v, i) => xIndex.set(v, i));
  ys.forEach((v, i) => yIndex.set(v, i));

  return { xs, ys, xIndex, yIndex };
}
