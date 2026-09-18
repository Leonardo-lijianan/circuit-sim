// src/io/MouseManager.ts

import type { InteractionManager } from '../interaction/InteractionManager';
import type { RenderCoordinator } from '../renderer/RenderCoordinator';
import type { StatusBarManager } from '../ui/StatusBarManager';
import type { Viewport } from '../utils/coordinates';
import { screenToLogic } from '../utils/coordinates';

export class MouseManager {
  private canvas: HTMLCanvasElement;
  private viewport: Viewport;
  private interaction: InteractionManager;
  private coordinator: RenderCoordinator;
  private statusBar: StatusBarManager;

  constructor(deps: {
    canvas: HTMLCanvasElement;
    viewport: Viewport;
    interaction: InteractionManager;
    statusBar: StatusBarManager;
    coordinator: RenderCoordinator;
  }) {
    this.canvas = deps.canvas;
    this.viewport = deps.viewport;
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
  }

  private handleMouseDown = (event: MouseEvent): void => {
    const pos = screenToLogic(event.clientX, event.clientY, this.canvas, this.viewport);
    this.interaction.handleMouseDown(pos.x, pos.y);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    const pos = screenToLogic(event.clientX, event.clientY, this.canvas, this.viewport);
    this.statusBar.updateCursorPos(pos.x, pos.y);
    this.coordinator.setMousePos(pos);


    // 分发到 interaction
    this.interaction.handleMouseMove(pos.x, pos.y);

    // 鼠标移动始终重绘（含 hover 引脚高亮，性能开销可接受）
    this.coordinator.render();
  };

  private handleMouseUp = (event: MouseEvent): void => {
    const pos = screenToLogic(event.clientX, event.clientY, this.canvas, this.viewport);
    this.interaction.handleMouseUp(pos.x, pos.y);
  };


  private handleMouseLeave = (): void => {
    this.coordinator.setMousePos(null);
    this.interaction.clearHoverPin();
    this.coordinator.render();
  };
}