// src/utils/coordinates.ts

/**
 * 视口状态
 * 描述当前画布的平移和缩放
 * Phase 2 简化：scale=1, offsetX=0, offsetY=0
 * Phase 3+ 支持缩放和平移
 */
export interface Viewport {
  offsetX: number;
  offsetY: number;
  scale: number;  // 1.0 = 100%
}

/**
 * 创建一个默认视口（无偏移，无缩放）
 */
export function defaultViewport(): Viewport {
  return { offsetX: 0, offsetY: 0, scale: 1.0 };
}

/**
 * 屏幕坐标 → Canvas 物理坐标
 * 
 * 说明：
 * - 屏幕坐标：相对于浏览器视口左上角（event.clientX, event.clientY）
 * - Canvas 物理坐标：相对于 Canvas 元素左上角的实际像素位置
 * 
 * 用途：鼠标事件 → Canvas 绘制坐标
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  canvas: HTMLCanvasElement
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  // canvas.width / rect.width 是 CSS 缩放比（处理 Retina 屏等）
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (screenX - rect.left) * scaleX,
    y: (screenY - rect.top) * scaleY,
  };
}

/**
 * Canvas 物理坐标 → 电路逻辑坐标
 * 
 * 说明：
 * - Canvas 物理坐标：相对于 Canvas 元素左上角的实际像素位置
 * - 电路逻辑坐标：电路图自身的坐标空间（元件位置、引脚位置等）
 * 
 * 公式：logic = (canvas - offset) / scale
 * 
 * 用途：Canvas 绘制坐标 → 元件/引脚碰撞检测
 */
export function canvasToLogic(
  canvasX: number,
  canvasY: number,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: (canvasX - viewport.offsetX) / viewport.scale,
    y: (canvasY - viewport.offsetY) / viewport.scale,
  };
}

/**
 * 电路逻辑坐标 → Canvas 物理坐标
 * 
 * 说明：
 * - 电路逻辑坐标：电路图自身的坐标空间
 * - Canvas 物理坐标：相对于 Canvas 元素左上角的实际像素位置
 * 
 * 公式：canvas = logic * scale + offset
 * 
 * 用途：元件位置 → Canvas 绘制
 */
export function logicToCanvas(
  logicX: number,
  logicY: number,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: logicX * viewport.scale + viewport.offsetX,
    y: logicY * viewport.scale + viewport.offsetY,
  };
}

/**
 * 屏幕坐标 → 电路逻辑坐标（一步转换）
 * 
 * 用途：鼠标事件 → 元件/引脚碰撞检测
 */
export function screenToLogic(
  screenX: number,
  screenY: number,
  canvas: HTMLCanvasElement,
  viewport: Viewport
): { x: number; y: number } {
  const canvasPos = screenToCanvas(screenX, screenY, canvas);
  return canvasToLogic(canvasPos.x, canvasPos.y, viewport);
}

/**
 * 电路逻辑坐标 → 屏幕坐标（一步转换）
 * 
 * 用途：绘制调试信息、显示工具提示
 */
export function logicToScreen(
  logicX: number,
  logicY: number,
  canvas: HTMLCanvasElement,
  viewport: Viewport
): { x: number; y: number } {
  const canvasPos = logicToCanvas(logicX, logicY, viewport);
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: canvasPos.x / scaleX + rect.left,
    y: canvasPos.y / scaleY + rect.top,
  };
}