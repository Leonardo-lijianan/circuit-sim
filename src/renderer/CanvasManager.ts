// src/renderer/CanvasManager.ts

/**
 * CanvasManager
 * 职责：
 * 1. 管理 Canvas 元素的尺寸（自适应容器）
 * 2. 处理 devicePixelRatio 保证清晰度
 * 3. 提供 Context 和尺寸查询接口
 * 4. 监听容器尺寸变化自动 resize
 */
export class CanvasManager {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private resizeObserver: ResizeObserver | null = null;
  private resizeCallbacks: (() => void)[] = [];

  // 逻辑尺寸（CSS 像素）
  private width: number = 0;
  private height: number = 0;

  // 物理尺寸（实际像素）
  private physicalWidth: number = 0;
  private physicalHeight: number = 0;

  constructor(containerId: string, canvasId?: string) {
    // 查找容器
    const container = document.querySelector(containerId);
    if (!container) {
      throw new Error(`CanvasManager: 找不到容器元素 "${containerId}"`);
    }
    this.container = container as HTMLElement;

    // 查找或创建 Canvas
    let canvas: HTMLCanvasElement | null = null;
    if (canvasId) {
      canvas = this.container.querySelector(`#${canvasId}`) as HTMLCanvasElement;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      if (canvasId) canvas.id = canvasId;
      this.container.appendChild(canvas);
    }
    this.canvas = canvas;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('CanvasManager: 无法获取 2D 上下文');
    }
    this.ctx = ctx;

    // DPI
    this.dpr = window.devicePixelRatio || 1;

    // 初始 resize
    this.resize();

    // 监听 resize
    this.setupResizeObserver();

    // 窗口 resize 兜底
    window.addEventListener('resize', this.handleWindowResize);
  }

  // ============================================================
  // 尺寸管理
  // ============================================================

  /**
   * 重新计算 Canvas 尺寸
   * 调用时机：容器尺寸变化、DPI 变化
   */
  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;

    // 逻辑尺寸 = CSS 尺寸（绘制时使用）
    this.width = cssWidth;
    this.height = cssHeight;

    // 物理尺寸 = CSS 尺寸 × DPI（实际像素）
    this.physicalWidth = Math.floor(cssWidth * this.dpr);
    this.physicalHeight = Math.floor(cssHeight * this.dpr);

    // 设置 Canvas 物理像素尺寸
    if (this.canvas.width !== this.physicalWidth) {
      this.canvas.width = this.physicalWidth;
    }
    if (this.canvas.height !== this.physicalHeight) {
      this.canvas.height = this.physicalHeight;
    }

    // 设置 CSS 尺寸
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // 缩放上下文，使绘制使用逻辑像素
    // 注意：scale 会累积，所以每次 resize 都需要重置
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 触发回调
    for (const cb of this.resizeCallbacks) {
      cb();
    }
  }

  /**
   * 获取当前逻辑尺寸（CSS 像素）
   */
  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * 获取 Canvas 2D 上下文（已做好 DPI 缩放）
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * 获取 Canvas 元素（用于事件绑定）
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * 获取容器元素
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * 获取当前 DPI
   */
  getDpr(): number {
    return this.dpr;
  }

  // ============================================================
  // 事件监听
  // ============================================================

  /**
   * 注册 resize 回调
   */
  onResize(callback: () => void): void {
    this.resizeCallbacks.push(callback);
  }

  /**
   * 移除所有 resize 回调
   */
  clearResizeCallbacks(): void {
    this.resizeCallbacks = [];
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private setupResizeObserver(): void {
    // 使用 ResizeObserver 监听容器尺寸变化
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  private handleWindowResize = (): void => {
    // 兜底：窗口 resize 时也触发
    this.resize();
  };

  // ============================================================
  // 清理
  // ============================================================

  /**
   * 销毁，释放资源
   */
  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.handleWindowResize);
    this.resizeCallbacks = [];
  }
}