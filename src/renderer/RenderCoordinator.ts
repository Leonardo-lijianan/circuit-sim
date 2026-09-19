// src/renderer/RenderCoordinator.ts

import type { CircuitRenderer } from './CircuitRenderer';
import type { CanvasManager } from './CanvasManager';
import type { CircuitManager } from '../manager/CircuitManager';
import type { InteractionManager } from '../interaction/InteractionManager';
import type { Viewport } from '../utils/coordinates';
import { defaultViewport } from '../utils/coordinates';

/**
 * RenderCoordinator
 * 
 * 职责：
 * - 把「电路数据 + 交互状态 + 鼠标位置」合成为渲染指令
 * - 作为所有渲染触发源的统一出口（数据更新 / 窗口 resize / pending 变化 / 鼠标移动）
 * 
 * 不负责：
 * - 监听 DOM 事件（由 MouseManager / 其他 Manager 负责）
 * - 实际绘制（由 CircuitRenderer 负责）
 */
export class RenderCoordinator {
  private renderer: CircuitRenderer;
  private canvasManager: CanvasManager;
  private circuitManager: CircuitManager;
  private interaction: InteractionManager;
  private lastMousePos: { x: number; y: number } | null = null;
  private viewport: Viewport = defaultViewport();

  private static SCALE_MIN = 0.25;
  private static SCALE_MAX = 4.0;

  constructor(deps: {
    renderer: CircuitRenderer;
    canvasManager: CanvasManager;
    circuitManager: CircuitManager;
    interaction: InteractionManager;
  }) {
    this.renderer = deps.renderer;
    this.canvasManager = deps.canvasManager;
    this.circuitManager = deps.circuitManager;
    this.interaction = deps.interaction;
  }

  /**
   * 由 MouseManager 更新鼠标位置
   */
  setMousePos(pos: { x: number; y: number } | null): void {
    this.lastMousePos = pos;
  }

  /**
   * 获取当前视口（供 MouseManager 做坐标转换）
   */
  getViewport(): Viewport {
    return this.viewport;
  }

  /**
   * 平移视口（中键拖拽）
   */
  setPan(offsetX: number, offsetY: number): void {
    this.viewport.offsetX = offsetX;
    this.viewport.offsetY = offsetY;
    this.render();
  }

  /**
   * 以指定屏幕坐标为中心缩放（滚轮）
   * @param screenX - Canvas 物理坐标 X（screenToCanvas 返回值）
   * @param screenY - Canvas 物理坐标 Y
   * @param factor - 缩放因子（>1 放大，<1 缩小）
   */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const oldScale = this.viewport.scale;
    const newScale = Math.max(
      RenderCoordinator.SCALE_MIN,
      Math.min(RenderCoordinator.SCALE_MAX, oldScale * factor)
    );

    if (newScale === oldScale) return;

    // 保持屏幕点对应的逻辑坐标不变
    const logicX = (screenX - this.viewport.offsetX) / oldScale;
    const logicY = (screenY - this.viewport.offsetY) / oldScale;

    this.viewport.scale = newScale;
    this.viewport.offsetX = screenX - logicX * newScale;
    this.viewport.offsetY = screenY - logicY * newScale;

    this.render();
  }

  /**
   * 统一渲染入口
   * 如果处于 Place 模式且鼠标在画布上，自动带上预览
   */
  render(): void {
    const circuit = this.circuitManager.getCircuit();
    const { width, height } = this.canvasManager.getSize();

    const overlays: {
      place?: { type: string; x: number; y: number };
      wire?: { startX: number; startY: number; endX: number; endY: number; snapped: boolean };
      hoverPin?: { componentId: number; pinId: string };
      marquee?: { x: number; y: number; w: number; h: number };
    } = {};

    // Place 模式预览
    if (this.interaction.isPlacePending() && this.lastMousePos) {
      const type = this.interaction.getPlaceType();
      if (type) {
        const w = 60;
        const h = 40;
        overlays.place = {
          type,
          x: this.lastMousePos.x - w / 2,
          y: this.lastMousePos.y - h / 2,
        };
      }
    }

    // Wire 模式预览
    const wirePreview = this.interaction.getWirePreview();
    if (wirePreview) {
      overlays.wire = wirePreview;
    } else {
      // 非连线中：显示悬停引脚高亮
      const hoverPin = this.interaction.getHoverPin();
      if (hoverPin) {
        overlays.hoverPin = hoverPin;
      }
    }

    // 框选矩形（Task 7.4）
    const marquee = this.interaction.getMarquee();
    if (marquee) {
      overlays.marquee = marquee;
    }

    this.renderer.render(circuit, width, height, this.viewport, overlays);
  }
}