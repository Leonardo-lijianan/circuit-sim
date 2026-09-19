// src/utils/geometry.ts

import type { ComponentInstance, PinDefinition } from '../types';

/**
 * 计算引脚的世界坐标（考虑元件旋转）
 *
 * 旋转中心 = 元件几何中心 (x + w/2, y + h/2)
 */
export function getPinWorldPos(
  comp: ComponentInstance,
  pin: PinDefinition
): { x: number; y: number } {
  const rotation = comp.rotation || 0;
  const cx = comp.x + comp.w / 2;
  const cy = comp.y + comp.h / 2;

  if (rotation === 0) {
    return { x: comp.x + pin.x, y: comp.y + pin.y };
  }

  // 引脚相对元件中心的偏移
  const dx = pin.x - comp.w / 2;
  const dy = pin.y - comp.h / 2;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  return { x: cx + rx, y: cy + ry };
}

/**
 * 计算元件旋转后的轴对齐包围盒（AABB）
 *
 * 用于碰撞检测、选中框绘制。
 * 只支持 0/90/180/270（90 的倍数）。
 */
export function getRotatedAABB(
  comp: ComponentInstance
): { x: number; y: number; w: number; h: number } {
  const rotation = ((comp.rotation || 0) % 360 + 360) % 360;

  if (rotation === 0 || rotation === 180) {
    return { x: comp.x, y: comp.y, w: comp.w, h: comp.h };
  }

  // 90° / 270°：宽高互换
  const cx = comp.x + comp.w / 2;
  const cy = comp.y + comp.h / 2;
  return {
    x: cx - comp.h / 2,
    y: cy - comp.w / 2,
    w: comp.h,
    h: comp.w,
  };
}

/**
 * 把旋转角度规范化到 0/90/180/270
 */
export function normalizeRotation(rotation: number): number {
  const r = ((rotation % 360) + 360) % 360;
  return Math.round(r / 90) * 90 % 360;
}

// ============================================================
// 电线路径
// ============================================================

export interface Point {
  x: number;
  y: number;
}

/**
 * 计算电线的正交路径（Z 字走线）
 *
 * 默认策略：横向优先，中点分折
 *   A → (mx, ay) → (mx, by) → B
 *   其中 mx = (ax + bx) / 2
 *
 * 特殊情况降级为直线：
 *   - |ay - by| < 2：水平对齐
 *   - |ax - bx| < 2：垂直对齐
 *
 * @returns 折点数组（含首尾）
 */
export function getWirePath(a: Point, b: Point): Point[] {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);

  // 水平或垂直对齐 → 直线
  if (dy < 2) return [a, b];
  if (dx < 2) return [a, b];

  // Z 字：横向优先，中点分折
  const mx = (a.x + b.x) / 2;
  return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
}

// ============================================================
// 引脚方向（Task 8.3）
// ============================================================

/**
 * 正交方向（canvas 坐标系，y 向下）
 *   E: 向右 (x+)
 *   W: 向左 (x-)
 *   N: 向上 (y-)
 *   S: 向下 (y+)
 */
export type PinDir = 'E' | 'W' | 'N' | 'S';

/**
 * 顺时针旋转 90° 的方向映射
 */
const CLOCKWISE: Record<PinDir, PinDir> = {
  E: 'S',
  S: 'W',
  W: 'N',
  N: 'E',
};

/**
 * 把方向按顺时针旋转 rotation 度
 */
function rotateDir(dir: PinDir, rotation: number): PinDir {
  const steps = (((rotation % 360) + 360) % 360) / 90;
  let result = dir;
  for (let i = 0; i < steps; i++) {
    result = CLOCKWISE[result];
  }
  return result;
}

/**
 * 求引脚背离元件本体的世界方向
 *
 * 步骤：
 *   1. 本地判定：引脚贴近元件的哪条边 → 本地出线方向
 *   2. 叠加元件自身的旋转 → 世界出线方向
 *
 * 例：
 *   - 引脚在元件右边缘，rotation=0   → 'E'
 *   - 引脚在元件右边缘，rotation=90  → 'S'（整块绕中心顺时针转 90°）
 */
export function getPinDirection(
  comp: ComponentInstance,
  pin: PinDefinition
): PinDir {
  // 1. 本地方向：找离引脚最近的四条边
  const distLeft = pin.x;
  const distRight = comp.w - pin.x;
  const distTop = pin.y;
  const distBottom = comp.h - pin.y;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  let localDir: PinDir;
  if (min === distLeft) localDir = 'W';
  else if (min === distRight) localDir = 'E';
  else if (min === distTop) localDir = 'N';
  else localDir = 'S';

  // 2. 叠加元件旋转
  return rotateDir(localDir, comp.rotation || 0);
}
