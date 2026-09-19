// src/interaction/InteractionManager.ts

import type { Mode, PendingAction, ComponentInstance, PinRef } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';
import { hitTest, hitTestSnap, hitTestPin, hitTestWires } from '../utils/hitTest';
import { getPinWorldPos, getRotatedAABB } from '../utils/geometry';
import { snapToGrid } from '../utils/grid';

export class InteractionManager {
  private mode: Mode = 'select';
  private pending: PendingAction = null;
  private onModeChangeCallbacks: ((mode: Mode) => void)[] = []; // 支持多订阅者！！！
  private onPendingChangeCallbacks: ((pending: PendingAction) => void)[] = [];
  private onPlaceCallback?: (type: string, x: number, y: number) => void;  // ← Task 3.4 新增

  // 拖拽状态（支持多选整体拖拽）
  private dragState: {
    components: { id: number; startX: number; startY: number }[];
    mouseStartX: number;
    mouseStartY: number;
    isDragging: boolean;
  } | null = null;

  // 框选状态（Task 7.4）
  private marqueeState: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    isDragging: boolean;
  } | null = null;

  // 依赖注入（用于 hitTest）
  private loader: ComponentLoader | null = null;
  private getComponents: (() => ComponentInstance[]) | null = null;
  private getWires: (() => import('../types').Wire[]) | null = null;
  private getSelection: (() => import('../types').Selection | null) | null = null;

  // Select 模式回调
  private onSelectComponentCallback?: (id: number | null) => void;
  private onSelectWireCallback?: (id: number | null) => void;
  private onSelectManyCallback?: (componentIds: number[], wireIds: number[]) => void;
  private onMoveCallback?: (moves: { id: number; x: number; y: number }[]) => void;

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
      this.marqueeState = null;
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

    // 情况2：命中优先级 = 引脚 > 电线 > 元件

    // 2.1 引脚检测（点击引脚 → 开始连线）
    const pinRef = hitTestPin(x, y, components, this.loader);
    if (pinRef) {
      this.setPending({ kind: 'wire', start: pinRef });
      this.wireMousePos = { x, y };
      this.updateCursor();
      return;
    }

    // 2.2 电线检测（点击电线 → 选中电线）
    const wires = this.getWires ? this.getWires() : [];
    const wireId = hitTestWires(x, y, wires, components, this.loader);
    if (wireId !== null) {
      this.onSelectWireCallback?.(wireId);
      return;
    }

    // 2.3 元件检测（点击元件 → 选中/拖拽）
    const result = hitTest(x, y, components, this.loader);
    if (result.kind === 'component') {
      const comp = components.find(c => c.id === result.id);
      if (!comp) return;

      const sel = this.getSelection ? this.getSelection() : null;
      const isAlreadySelected = !!sel && sel.componentIds.includes(result.id);

      // 未选中 → 单选它；已选中 → 保持多选不变
      if (!isAlreadySelected) {
        this.onSelectComponentCallback?.(result.id);
      }

      // 拖拽列表：已选中的全部 / 单个
      const idsToDrag = isAlreadySelected && sel
        ? [...sel.componentIds]
        : [result.id];

      const dragComponents = idsToDrag
        .map(id => components.find(c => c.id === id))
        .filter((c): c is ComponentInstance => !!c)
        .map(c => ({ id: c.id, startX: c.x, startY: c.y }));

      this.dragState = {
        components: dragComponents,
        mouseStartX: x,
        mouseStartY: y,
        isDragging: false,
      };
      return;
    }

    // 2.3.5 多选 AABB 内点击（即使不是元件本身）→ 拖拽全部选中
    const selNow = this.getSelection ? this.getSelection() : null;
    if (selNow && selNow.componentIds.length > 1) {
      if (this.isPointInSelectionAABB(x, y, selNow, components)) {
        const dragComponents = selNow.componentIds
          .map(id => components.find(c => c.id === id))
          .filter((c): c is ComponentInstance => !!c)
          .map(c => ({ id: c.id, startX: c.x, startY: c.y }));

        this.dragState = {
          components: dragComponents,
          mouseStartX: x,
          mouseStartY: y,
          isDragging: false,
        };
        return;
      }
    }

    // 2.4 点击空白 → 启动框选（未拖动时视为普通点击取消选中）
    this.marqueeState = {
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      isDragging: false,
    };
  }

  /**
   * 判断点是否在多选的最小 AABB 内
   */
  private isPointInSelectionAABB(
    x: number,
    y: number,
    sel: import('../types').Selection,
    components: ComponentInstance[]
  ): boolean {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    let found = false;

    for (const id of sel.componentIds) {
      const comp = components.find(c => c.id === id);
      if (!comp) continue;
      const aabb = getRotatedAABB(comp);
      minX = Math.min(minX, aabb.x);
      minY = Math.min(minY, aabb.y);
      maxX = Math.max(maxX, aabb.x + aabb.w);
      maxY = Math.max(maxY, aabb.y + aabb.h);
      found = true;
    }

    if (!found) return false;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  private handleSelectMouseMove(x: number, y: number): void {
    // 框选（优先于拖拽）
    if (this.marqueeState) {
      const dx = x - this.marqueeState.startX;
      const dy = y - this.marqueeState.startY;
      if (!this.marqueeState.isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
        this.marqueeState.isDragging = true;
      }
      if (this.marqueeState.isDragging) {
        this.marqueeState.endX = x;
        this.marqueeState.endY = y;
      }
      return;
    }

    // 拖拽元件（可多选整体拖拽）
    if (!this.dragState) return;

    const dx = x - this.dragState.mouseStartX;
    const dy = y - this.dragState.mouseStartY;

    // 移动超过 5px 才算真正拖拽
    if (!this.dragState.isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
      this.dragState.isDragging = true;
      this.updateCursor();
    }

    if (this.dragState.isDragging) {
      const moves = this.dragState.components.map(c => ({
        id: c.id,
        x: c.startX + dx,
        y: c.startY + dy,
      }));
      this.onMoveCallback?.(moves);
    }
  }

  private handleSelectMouseUp(): void {
    // 框选
    if (this.marqueeState) {
      if (this.marqueeState.isDragging) {
        const box = this.normalizeMarquee();
        const result = this.computeMarqueeSelection(box.x, box.y, box.w, box.h);
        this.onSelectManyCallback?.(result.componentIds, result.wireIds);
      } else {
        // 普通点击空白 → 取消选中
        this.onSelectComponentCallback?.(null);
      }
      this.marqueeState = null;
      return;
    }

    // 拖拽
    if (this.dragState) {
      this.dragState = null;
      this.updateCursor();
    }
  }

  /**
   * 获取当前框选矩形（供渲染器绘制）
   */
  getMarquee(): { x: number; y: number; w: number; h: number } | null {
    if (!this.marqueeState || !this.marqueeState.isDragging) return null;
    return this.normalizeMarquee();
  }

  private normalizeMarquee(): { x: number; y: number; w: number; h: number } {
    const s = this.marqueeState!;
    return {
      x: Math.min(s.startX, s.endX),
      y: Math.min(s.startY, s.endY),
      w: Math.abs(s.endX - s.startX),
      h: Math.abs(s.endY - s.startY),
    };
  }

  /**
   * 计算框选结果（元件完全包含在选框内）
   */
  private computeMarqueeSelection(
    x: number,
    y: number,
    w: number,
    h: number
  ): { componentIds: number[]; wireIds: number[] } {
    const componentIds: number[] = [];
    if (!this.getComponents) return { componentIds, wireIds: [] };

    const components = this.getComponents();
    for (const comp of components) {
      const aabb = getRotatedAABB(comp);
      if (
        aabb.x >= x &&
        aabb.y >= y &&
        aabb.x + aabb.w <= x + w &&
        aabb.y + aabb.h <= y + h
      ) {
        componentIds.push(comp.id);
      }
    }
    return { componentIds, wireIds: [] };
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
      // 计算元件左上角位置（居中放置）并吸附到网格
      const w = 60;
      const h = 40;
      this.onPlaceCallback(type, snapToGrid(x - w / 2), snapToGrid(y - h / 2));
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

    const startPos = getPinWorldPos(startComp, startPin);
    const startX = startPos.x;
    const startY = startPos.y;

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
  setContext(
    loader: ComponentLoader,
    getComponents: () => ComponentInstance[],
    getWires: () => import('../types').Wire[],
    getSelection: () => import('../types').Selection | null
  ): void {
    this.loader = loader;
    this.getComponents = getComponents;
    this.getWires = getWires;
    this.getSelection = getSelection;
  }

  onSelectComponent(callback: (id: number | null) => void): void {
    this.onSelectComponentCallback = callback;
  }

  onSelectWire(callback: (id: number | null) => void): void {
    this.onSelectWireCallback = callback;
  }

  /**
   * 框选完成回调（Task 7.4）
   */
  onSelectMany(callback: (componentIds: number[], wireIds: number[]) => void): void {
    this.onSelectManyCallback = callback;
  }

  onMove(callback: (moves: { id: number; x: number; y: number }[]) => void): void {
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