// src/utils/hitTest.ts

import type { ComponentInstance, PinRef, Wire } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';
import { getPinWorldPos, getRotatedAABB, getWirePath } from './geometry';
import type { Point } from './geometry';

/**
 * 点到线段的距离
 */
function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * 点到折线（多点线段串）的距离
 * 取所有线段距离的最小值
 */
function pointToPolylineDistance(
  px: number, py: number,
  points: Point[]
): number {
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(
      px, py,
      points[i].x, points[i].y,
      points[i + 1].x, points[i + 1].y
    );
    if (d < minDist) minDist = d;
  }
  return minDist;
}

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
      const pos = getPinWorldPos(comp, pin);
      const dx = x - pos.x;
      const dy = y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold && dist < minDist) {
        minDist = dist;
        nearest = { componentId: comp.id, pinId: pin.id };
        nearestX = pos.x;
        nearestY = pos.y;
      }
    }
  }

  if (nearest) {
    return { snapped: true, x: nearestX, y: nearestY, ref: nearest };
  }

  return { snapped: false, x, y, ref: null };
}

/**
 * 引脚检测（只检测引脚，不检测元件）
 * 
 * @param x - 检测点 X 坐标
 * @param y - 检测点 Y 坐标
 * @param components - 所有元件实例
 * @param loader - ComponentLoader 实例
 * @returns 命中的引脚引用，或 null
 */
export function hitTestPin(
  x: number,
  y: number,
  components: ComponentInstance[],
  loader: ComponentLoader
): PinRef | null {
  for (const comp of components) {
    const def = loader.getDefinition(comp.type);
    if (!def) continue;

    for (const pin of def.pins) {
      const pos = getPinWorldPos(comp, pin);
      const radius = pin.hitRadius || 15;
      if (hitTestCircle(x, y, pos.x, pos.y, radius)) {
        return { componentId: comp.id, pinId: pin.id };
      }
    }
  }
  return null;
}

/**
 * 电线碰撞检测（点到线段的距离）
 * 
 * @param x - 检测点 X 坐标
 * @param y - 检测点 Y 坐标
 * @param wires - 所有电线
 * @param components - 所有元件实例（用于查引脚世界坐标）
 * @param loader - ComponentLoader 实例
 * @param threshold - 命中阈值（逻辑像素）
 * @returns 命中的电线 id，或 null
 */
export function hitTestWires(
  x: number,
  y: number,
  wires: Wire[],
  components: ComponentInstance[],
  loader: ComponentLoader,
  threshold: number = 6
): number | null {
  // 逆序遍历，上层优先
  for (let i = wires.length - 1; i >= 0; i--) {
    const wire = wires[i];

    // 关键：优先使用渲染时算好的路径缓存（wire.path），
    // 保证命中判定与视觉呈现完全一致。
    //
    // 当 wire.path 缺失（未渲染过、或刚 triggerUpdate 清空）时，
    // 回退到 getWirePath —— 这与 CircuitRenderer 的路由失败兜底策略一致。
    let path: Point[];

    if (wire.path && wire.path.length >= 2) {
      path = wire.path;
    } else {
      const start = getPinWorldPosByRef(wire.startComponentId, wire.startPinId, components, loader);
      const end = getPinWorldPosByRef(wire.endComponentId, wire.endPinId, components, loader);
      if (!start || !end) continue;
      path = getWirePath(start, end);
    }

    const dist = pointToPolylineDistance(x, y, path);
    if (dist <= threshold) return wire.id;
  }
  return null;
}

/**
 * 获取引脚的世界坐标（内部工具）
 */
function getPinWorldPosByRef(
  compId: number,
  pinId: string,
  components: ComponentInstance[],
  loader: ComponentLoader
): { x: number; y: number } | null {
  const comp = components.find(c => c.id === compId);
  if (!comp) return null;
  const def = loader.getDefinition(comp.type);
  if (!def) return null;
  const pin = def.pins.find(p => p.id === pinId);
  if (!pin) return null;
  return getPinWorldPos(comp, pin);
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
      const pos = getPinWorldPos(comp, pin);
      const radius = pin.hitRadius || 15;
      if (hitTestCircle(x, y, pos.x, pos.y, radius)) {
        return { kind: 'pin', ref: { componentId: comp.id, pinId: pin.id } };
      }
    }
  }

  // 2. 再检测元件（矩形，逆序，上层优先）
  for (let i = components.length - 1; i >= 0; i--) {
    const comp = components[i];
    const aabb = getRotatedAABB(comp);
    if (hitTestRect(x, y, aabb.x, aabb.y, aabb.w, aabb.h)) {
      return { kind: 'component', id: comp.id };
    }
  }

  return { kind: 'none' };
}