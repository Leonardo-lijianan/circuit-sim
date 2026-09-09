// src/utils/hitTest.ts

import type { ComponentInstance, PinRef } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';

/**
 * 圆形碰撞检测
 * 检测点 (x, y) 是否在以 (cx, cy) 为圆心、radius 为半径的圆内
 * 
 * @param x - 检测点 X 坐标
 * @param y - 检测点 Y 坐标
 * @param cx - 圆心 X 坐标
 * @param cy - 圆心 Y 坐标
 * @param radius - 圆的半径
 * @returns 是否命中
 */
export function hitTestCircle(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return (dx * dx + dy * dy) <= (radius * radius);
}

/**
 * 矩形碰撞检测
 * 检测点 (x, y) 是否在矩形内
 * 
 * @param x - 检测点 X 坐标
 * @param y - 检测点 Y 坐标
 * @param rx - 矩形左上角 X 坐标
 * @param ry - 矩形左上角 Y 坐标
 * @param rw - 矩形宽度
 * @param rh - 矩形高度
 * @returns 是否命中
 */
export function hitTestRect(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
}

/**
 * 磁吸检测（最近引脚）
 * 找到距离检测点最近的引脚，如果距离小于阈值则返回吸附位置
 * 
 * @param x - 检测点 X 坐标
 * @param y - 检测点 Y 坐标
 * @param components - 所有元件实例
 * @param loader - ComponentLoader 实例
 * @param threshold - 磁吸阈值（默认 20px）
 * @returns 吸附结果
 */
export function hitTestSnap(
  x: number,
  y: number,
  components: ComponentInstance[],
  loader: ComponentLoader,
  threshold: number = 20
): { snapped: boolean; x: number; y: number; ref: PinRef | null } {
  let minDist = Infinity;
  let nearest: PinRef | null = null;
  let nearestX = x;
  let nearestY = y;

  for (const comp of components) {
    const def = loader.getDefinition(comp.type);
    if (!def) continue;

    for (const pin of def.pins) {
      const pinWorldX = comp.x + pin.x;
      const pinWorldY = comp.y + pin.y;
      const dx = x - pinWorldX;
      const dy = y - pinWorldY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold && dist < minDist) {
        minDist = dist;
        nearest = { componentId: comp.id, pinId: pin.id };
        nearestX = pinWorldX;
        nearestY = pinWorldY;
      }
    }
  }

  if (nearest) {
    return { snapped: true, x: nearestX, y: nearestY, ref: nearest };
  }

  return { snapped: false, x, y, ref: null };
}

/**
 * 综合碰撞检测（先引脚后元件）
 * 遍历所有元件，先检测引脚（圆形），再检测元件（矩形）
 * 
 * @param x - 检测点 X 坐标
 * @param y - 检测点 Y 坐标
 * @param components - 所有元件实例
 * @param loader - ComponentLoader 实例
 * @returns 检测结果
 */
export function hitTest(
  x: number,
  y: number,
  components: ComponentInstance[],
  loader: ComponentLoader
): { kind: 'pin'; ref: PinRef } | { kind: 'component'; id: number } | { kind: 'none' } {
  // 1. 先检测引脚（圆形）
  for (const comp of components) {
    const def = loader.getDefinition(comp.type);
    if (!def) continue;

    for (const pin of def.pins) {
      const pinWorldX = comp.x + pin.x;
      const pinWorldY = comp.y + pin.y;
      const radius = pin.hitRadius || 15;
      if (hitTestCircle(x, y, pinWorldX, pinWorldY, radius)) {
        return { kind: 'pin', ref: { componentId: comp.id, pinId: pin.id } };
      }
    }
  }

  // 2. 再检测元件（矩形，逆序，上层优先）
  for (let i = components.length - 1; i >= 0; i--) {
    const comp = components[i];
    if (hitTestRect(x, y, comp.x, comp.y, comp.w, comp.h)) {
      return { kind: 'component', id: comp.id };
    }
  }

  return { kind: 'none' };
}