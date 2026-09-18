// src/io/MouseManager.ts

import type { InteractionManager } from '../interaction/InteractionManager';
import type { RenderCoordinator } from '../renderer/RenderCoordinator';
import type { StatusBarManager } from '../ui/StatusBarManager';
import { screenToLogic, screenToCanvas } from '../utils/coordinates';

export class MouseManager {
  private canvas: HTMLCanvasElement;
  private interaction: InteractionManager;
  private coordinator: RenderCoordinator;
  private statusBar: StatusBarManager;

  // 中键平移状态
  private isPanning: boolean = false;
  private panStartX: number = 0;
  private panStartY: number = 0;
  private panStartOffsetX: number = 0;
  private panStartOffsetY: number = 0;

  constructor(deps: {
    canvas: HTMLCanvasElement;
    interaction: InteractionManager;
    statusBar: StatusBarManager;
    coordinator: RenderCoordinator;
  }) {
    this.canvas = deps.canvas;
    this.interaction = deps.interaction;
    this.statusBar = deps.statusBar;
    this.coordinator = deps.coordinator;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private handleMouseDown = (event: MouseEvent): void => {
    // 中键 → 开始平移
    if (event.button === 1) {
      event.preventDefault();
      const viewport = this.coordinator.getViewport();
      this.isPanning = true;
      this.panStartX = event.clientX;
      this.panStartY = event.clientY;
      this.panStartOffsetX = viewport.offsetX;
      this.panStartOffsetY = viewport.offsetY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // 只响应左键
    if (event.button !== 0) return;

    const pos = screenToLogic(
      event.clientX,
      event.clientY,
      this.canvas,
      this.coordinator.getViewport()
    );
    this.interaction.handleMouseDown(pos.x, pos.y);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    // 平移中
    if (this.isPanning) {
      const dx = event.clientX - this.panStartX;
      const dy = event.clientY - this.panStartY;
      this.coordinator.setPan(
        this.panStartOffsetX + dx,
        this.panStartOffsetY + dy
      );
      return;
    }

    const pos = screenToLogic(
      event.clientX,
      event.clientY,
      this.canvas,
      this.coordinator.getViewport()
    );
    this.statusBar.updateCursorPos(pos.x, pos.y);
    this.coordinator.setMousePos(pos);

    // 分发到 interaction
    this.interaction.handleMouseMove(pos.x, pos.y);

    // 鼠标移动始终重绘（含 hover 引脚高亮，性能开销可接受）
    this.coordinator.render();
  };

  private handleMouseUp = (event: MouseEvent): void => {
    // 结束平移
    if (event.button === 1 && this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
      return;
    }

    if (event.button !== 0) return;

    const pos = screenToLogic(
      event.clientX,
      event.clientY,
      this.canvas,
      this.coordinator.getViewport()
    );
    this.interaction.handleMouseUp(pos.x, pos.y);
  };

  private handleMouseLeave = (): void => {
    this.coordinator.setMousePos(null);
    this.interaction.clearHoverPin();
    this.coordinator.render();
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    // deltaY < 0 向上滚 → 放大；> 0 向下滚 → 缩小
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;

    // 以鼠标在 Canvas 上的物理位置为中心缩放
    const canvasPos = screenToCanvas(event.clientX, event.clientY, this.canvas);
    this.coordinator.zoomAt(canvasPos.x, canvasPos.y, factor);

    // 更新状态栏缩放显示
    this.statusBar.updateZoom(this.coordinator.getViewport().scale);
  };
}
