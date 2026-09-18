// src/renderer/RenderCoordinator.ts

import type { CircuitRenderer } from './CircuitRenderer';
import type { CanvasManager } from './CanvasManager';
import type { CircuitManager } from '../manager/CircuitManager';
import type { InteractionManager } from '../interaction/InteractionManager';

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

    this.renderer.render(circuit, width, height, overlays);
  }
}