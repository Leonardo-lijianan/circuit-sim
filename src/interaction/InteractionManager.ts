// src/interaction/InteractionManager.ts

import type { Mode, PendingAction, ComponentInstance, PinRef } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';
import { hitTest, hitTestSnap, hitTestPin } from '../utils/hitTest';

export class InteractionManager {
  private mode: Mode = 'select';
  private pending: PendingAction = null;
  private onModeChangeCallbacks: ((mode: Mode) => void)[] = []; // 支持多订阅者！！！
  private onPendingChangeCallbacks: ((pending: PendingAction) => void)[] = [];
  private onPlaceCallback?: (type: string, x: number, y: number) => void;  // ← Task 3.4 新增

  // 拖拽状态
  private dragState: {
    compId: number;
    mouseStartX: number;
    mouseStartY: number;
    compStartX: number;
    compStartY: number;
    isDragging: boolean;
  } | null = null;

  // 依赖注入（用于 hitTest）
  private loader: ComponentLoader | null = null;
  private getComponents: (() => ComponentInstance[]) | null = null;

  // Select 模式回调
  private onSelectCallback?: (id: number | null) => void;
  private onMoveCallback?: (id: number, x: number, y: number) => void;

  // Wire 模式状态
  private wireMousePos: { x: number; y: number } | null = null;
  private wireSnap: { snapped: boolean; x: number; y: number; ref: PinRef | null } | null = null;

  // Wire 模式回调
  private onWireCompleteCallback?: (start: PinRef, end: PinRef) => void;

  // 悬停的引脚（所有模式通用）
  private hoverPin: PinRef | null = null;

  constructor() {
    // 初始化光标为当前模式对应的样式（默认 Select → default）
    this.updateCursor();
  }

  // ============================================================
  // 模式管理
  // ============================================================

  getMode(): Mode {
    return this.mode;
  }

  setMode(newMode: Mode): void {
    // 模式未变，直接返回（避免误清 pending 和误改光标）
    if (newMode === this.mode) return;

    // 如果切换到 Select，清理所有待完成操作
    if (newMode === 'select') {
      this.clearPending();
    }

    // 如果从 Place 切换到其他模式，取消待放置状态
    if (this.mode === 'place' && this.pending?.kind === 'place') {
      this.clearPending();
    }

    this.mode = newMode;
    this.updateCursor();
    for (const cb of this.onModeChangeCallbacks) cb(newMode);
  }

  // ============================================================
  // Pending 操作管理
  // ============================================================

  getPending(): PendingAction {
    return this.pending;
  }

  setPending(action: PendingAction): void {
    this.pending = action;
    this.updateCursor();
    for (const cb of this.onPendingChangeCallbacks) cb(action);
  }

  clearPending(): void {
    this.pending = null;
    this.wireMousePos = null;
    this.wireSnap = null;
    this.updateCursor();
    for (const cb of this.onPendingChangeCallbacks) cb(null);
  }

  // ============================================================
  // 快捷状态查询
  // ============================================================

  isSelectMode(): boolean {
    return this.mode === 'select';
  }

  isPlaceMode(): boolean {
    return this.mode === 'place';
  }

  isPanMode(): boolean {
    return this.mode === 'pan';
  }

  /**
   * 获取当前状态的显示标签（供状态栏使用）
   */
  getDisplayLabel(): string {
    if (this.pending?.kind === 'place') return '放置';
    if (this.pending?.kind === 'wire') return '连线';
    if (this.mode === 'pan') return '平移';
    return '选择';
  }

  isPending(): boolean {
    return this.pending !== null;
  }

  isPlacePending(): boolean {
    return this.pending?.kind === 'place';
  }

  isWirePending(): boolean {
    return this.pending?.kind === 'wire';
  }

  getPlaceType(): string | null {
    return this.pending?.kind === 'place' ? this.pending.type : null;
  }

  getWireStart(): { componentId: number; pinId: string } | null {
    return this.pending?.kind === 'wire' ? this.pending.start : null;
  }

  getHoverPin(): PinRef | null {
    return this.hoverPin;
  }

  clearHoverPin(): void {
    this.hoverPin = null;
  }

  // ============================================================
  // 回调注册
  // ============================================================

  onModeChange(callback: (mode: Mode) => void): void {
    this.onModeChangeCallbacks.push(callback);
  }

  onPendingChange(callback: (pending: PendingAction) => void): void {
    this.onPendingChangeCallbacks.push(callback);
  }

  // ============================================================
  // Place 模式事件处理（由 Canvas 事件调用）
  // ============================================================

  /**
   * 处理鼠标按下事件（由 Canvas 事件监听调用）
   * 根据当前模式分发到不同的处理逻辑
   */
  handleMouseDown(x: number, y: number): void {
    switch (this.mode) {
      case 'place':
        this.handlePlaceClick(x, y);
        break;
      case 'select':
        this.handleSelectMouseDown(x, y);
        break;
      default:
        break;
    }
  }


  /**
   * 处理鼠标移动事件（由 MouseManager 调用）
   */
  handleMouseMove(x: number, y: number): void {
    // 更新悬停引脚（所有模式通用）
    this.updateHoverPin(x, y);

    if (this.mode !== 'select') return;

    // 连线中 → 更新磁吸预览
    if (this.isWirePending()) {
      this.handleWireMouseMove(x, y);
      return;
    }

    // 否则处理拖拽
    this.handleSelectMouseMove(x, y);
  }

  /**
   * 更新悬停引脚（用于视觉反馈）
   */
  private updateHoverPin(x: number, y: number): void {
    if (!this.loader || !this.getComponents) {
      this.hoverPin = null;
      return;
    }
    const components = this.getComponents();
    this.hoverPin = hitTestPin(x, y, components, this.loader);
  }

  /**
   * 处理鼠标松开事件（由 MouseManager 调用）
   */
  handleMouseUp(_x: number, _y: number): void {
    if (this.mode === 'select') {
      this.handleSelectMouseUp();
    }
  }

  // ============================================================
  // Select 模式：选中  拖拽
  // ============================================================

  private handleSelectMouseDown(x: number, y: number): void {
    if (!this.loader || !this.getComponents) {
      console.warn('⚠️ InteractionManager 未注入 context');
      return;
    }

    const components = this.getComponents();

    // 情况1：正在连线中 → 优先处理连线逻辑
    if (this.isWirePending()) {
      this.handleWireMouseDown(x, y);
      return;
    }

    // 情况2：检测点击目标
    const result = hitTest(x, y, components, this.loader);

    // 点击引脚 → 开始连线
    if (result.kind === 'pin') {
      this.setPending({ kind: 'wire', start: result.ref });
      this.wireMousePos = { x, y };
      this.updateCursor();
      return;
    }

    // 点击元件 → 选中/拖拽
    if (result.kind === 'component') {
      const comp = components.find(c => c.id === result.id);
      if (!comp) return;

      this.onSelectCallback?.(comp.id);

      this.dragState = {
        compId: comp.id,
        mouseStartX: x,
        mouseStartY: y,
        compStartX: comp.x,
        compStartY: comp.y,
        isDragging: false,
      };
      return;
    }

    // 点击空白 → 取消选中
    this.onSelectCallback?.(null);
  }

  private handleSelectMouseMove(x: number, y: number): void {
    if (!this.dragState) return;

    const dx = x - this.dragState.mouseStartX;
    const dy = y - this.dragState.mouseStartY;

    // 移动超过 5px 才算真正拖拽
    if (!this.dragState.isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
      this.dragState.isDragging = true;
      this.updateCursor();
    }

    if (this.dragState.isDragging) {
      this.onMoveCallback?.(
        this.dragState.compId,
        this.dragState.compStartX + dx,
        this.dragState.compStartY + dy
      );
    }
  }

  private handleSelectMouseUp(): void {
    if (!this.dragState) return;

    this.dragState = null;
    this.updateCursor();
  }

  /**
   * Place 模式：点击画布放置元件
   */
  private handlePlaceClick(x: number, y: number): void {
    if (!this.isPlacePending()) {
      console.warn('⚠️ Place 模式下没有待放置的元件类型');
      return;
    }

    const type = this.getPlaceType();
    if (!type) return;

    // 通过回调通知外部创建元件
    if (this.onPlaceCallback) {
      // 计算元件左上角位置（居中放置）
      const w = 60;
      const h = 40;
      this.onPlaceCallback(type, x - w / 2, y - h / 2);
    }

    // 放置后清理 pending 并回到 Select 模式
    this.clearPending();
    this.setMode('select');
  }

  // ============================================================
  // Wire 模式：连线
  // ============================================================

  private handleWireMouseDown(x: number, y: number): void {
    if (!this.loader || !this.getComponents) return;

    const components = this.getComponents();
    const result = hitTest(x, y, components, this.loader);

    // 点击空白 → 取消连线
    if (result.kind !== 'pin') {
      this.clearPending();
      this.updateCursor();
      return;
    }

    const start = this.getWireStart();
    if (!start) return;

    // 同引脚 → 取消
    if (start.componentId === result.ref.componentId && start.pinId === result.ref.pinId) {
      this.clearPending();
      this.updateCursor();
      return;
    }

    // 完成连线
    this.onWireCompleteCallback?.(start, result.ref);
    this.clearPending();
    this.updateCursor();
  }

  private handleWireMouseMove(x: number, y: number): void {
    if (!this.isWirePending()) return;
    if (!this.loader || !this.getComponents) return;

    this.wireMousePos = { x, y };

    // 磁吸检测
    const components = this.getComponents();
    this.wireSnap = hitTestSnap(x, y, components, this.loader);
  }

  /**
   * 获取当前 Wire 模式的预览数据（供 RenderCoordinator 使用）
   */
  getWirePreview(): { startX: number; startY: number; endX: number; endY: number; snapped: boolean } | null {
    if (!this.isWirePending()) return null;
    if (!this.wireMousePos) return null;
    if (!this.loader || !this.getComponents) return null;

    const start = this.getWireStart();
    if (!start) return null;

    // 获取起点引脚的世界坐标
    const components = this.getComponents();
    const startComp = components.find(c => c.id === start.componentId);
    if (!startComp) return null;
    const def = this.loader.getDefinition(startComp.type);
    if (!def) return null;
    const startPin = def.pins.find(p => p.id === start.pinId);
    if (!startPin) return null;

    const startX = startComp.x + startPin.x;
    const startY = startComp.y + startPin.y;

    // 终点：磁吸则用吸附位置，否则用鼠标位置
    const snap = this.wireSnap;
    const endX = snap?.snapped ? snap.x : this.wireMousePos.x;
    const endY = snap?.snapped ? snap.y : this.wireMousePos.y;

    return { startX, startY, endX, endY, snapped: snap?.snapped ?? false };
  }

  // ============================================================
  // Place 模式回调注册
  // ============================================================

  onPlace(callback: (type: string, x: number, y: number) => void): void {
    this.onPlaceCallback = callback;
  }


  /**
   * 注入 hitTest 所需的上下文
   */
  setContext(loader: ComponentLoader, getComponents: () => ComponentInstance[]): void {
    this.loader = loader;
    this.getComponents = getComponents;
  }

  onSelect(callback: (id: number | null) => void): void {
    this.onSelectCallback = callback;
  }

  onMove(callback: (id: number, x: number, y: number) => void): void {
    this.onMoveCallback = callback;
  }

  /**
   * 注册 Wire 模式回调
   */
  onWireComplete(callback: (start: PinRef, end: PinRef) => void): void {
    this.onWireCompleteCallback = callback;
  }


  // ============================================================
  // 私有方法
  // ============================================================

  private updateCursor(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    // 拖拽优先级最高
    if (this.dragState?.isDragging) {
      canvas.style.cursor = 'grabbing';
      return;
    }

    // 连线中
    if (this.isWirePending()) {
      canvas.style.cursor = 'pointer';
      return;
    }

    // 放置中
    if (this.isPlacePending()) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    switch (this.mode) {
      case 'select':
        canvas.style.cursor = 'default';
        break;
      case 'place':
        canvas.style.cursor = 'crosshair';
        break;
      case 'pan':
        canvas.style.cursor = 'grab';
        break;
    }
  }
}