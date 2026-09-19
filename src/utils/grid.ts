// src/utils/grid.ts

/**
 * 元件吸附网格（元件左上角坐标吸附到此倍数）
 * 20px 对应元件尺寸 60x40 的 1/3 和 1/2，手感好
 */
export const GRID_SIZE = 20;

/**
 * 路由网格（正交走线的坐标网格）
 *
 * 为什么是 10px 而不是 20px：
 *   元件 w=60, h=40，吸附到 20px 后中心在 (20k+30, 20m+20)
 *   引脚相对中心 ±30，旋转 90° 后依然在 10px 的倍数上
 *   但不在 20px 的倍数上 —— 所以路由网格必须是 10px
 */
export const ROUTING_GRID = 10;

/**
 * 吸附到元件网格（20px）
 */
export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

/**
 * 吸附到路由网格（10px）
 */
export function snapToRoutingGrid(v: number): number {
  return Math.round(v / ROUTING_GRID) * ROUTING_GRID;
}
