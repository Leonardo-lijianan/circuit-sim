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
