// src/manager/CircuitManager.ts

import type { ComponentInstance, Wire, Circuit, PinRef, Selection } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';

export class CircuitManager {
  private components: ComponentInstance[] = [];
  private wires: Wire[] = [];
  private selection: Selection | null = null;
  private nextId: number = 1;
  private nextWireId: number = 1;
  private loader: ComponentLoader;
  private onUpdateCallback?: (circuit: Circuit) => void;
  private onMessageCallback?: (msg: string) => void;

  constructor(loader: ComponentLoader) {
    this.loader = loader;
  }

  /**
   * 注册消息通知回调（供 UI 层展示提示）
   */
  onMessage(callback: (msg: string) => void): void {
    this.onMessageCallback = callback;
  }

  private notify(msg: string): void {
    this.onMessageCallback?.(msg);
  }

  // ============================================================
  // 数据查询
  // ============================================================

  getComponents(): ComponentInstance[] {
    return this.components;
  }

  getWires(): Wire[] {
    return this.wires;
  }

  getCircuit(): Circuit {
    return {
      components: this.components,
      wires: this.wires,
      selection: this.selection,
    };
  }

  getComponent(id: number): ComponentInstance | undefined {
    return this.components.find(c => c.id === id);
  }

  getWire(id: number): Wire | undefined {
    return this.wires.find(w => w.id === id);
  }

  // ---- 选择：统一 API ----
  select(sel: Selection | null): void {
    this.selection = sel;
    this.triggerUpdate();
  }

  getSelection(): Selection | null {
    return this.selection;
  }

  isSelected(kind: Selection['kind'], id: number): boolean {
    return this.selection?.kind === kind && this.selection.id === id;
  }

  /**
   * 删除当前选择（内部分发到 removeComponent / removeWire）
   */
  deleteSelection(): void {
    const sel = this.selection;
    if (!sel) return;

    if (sel.kind === 'component') {
      this.removeComponent(sel.id);
    } else if (sel.kind === 'wire') {
      this.removeWire(sel.id);
    }
  }

  // ---- 选择：语法糖 ----
  selectComponent(id: number | null): void {
    this.select(id === null ? null : { kind: 'component', id });
  }

  selectWire(id: number | null): void {
    this.select(id === null ? null : { kind: 'wire', id });
  }

  /**
   * 获取选中元件的实例（如果选中的是元件）
   */
  getSelected(): ComponentInstance | null {
    if (this.selection?.kind !== 'component') return null;
    return this.getComponent(this.selection.id) || null;
  }

  getWiresForComponent(compId: number): Wire[] {
    return this.wires.filter(
      w => w.startComponentId === compId || w.endComponentId === compId
    );
  }

  // ============================================================
  // 元件操作
  // ============================================================

  addComponent(type: string, x: number, y: number): ComponentInstance | null {
    const def = this.loader.getDefinition(type);
    if (!def) {
      this.notify(`未知元件类型: ${type}`);
      return null;
    }

    const w = 60;
    const h = 40;

    const comp: ComponentInstance = {
      id: this.nextId++,
      type,
      x,
      y,
      w,
      h,
      params: this.getDefaultParams(def),
      state: def.visual.default_state || 'default',
    };

    this.components.push(comp);
    this.selectComponent(comp.id);
    this.triggerUpdate();
    return comp;
  }

  removeComponent(id: number): void {
    const relatedWires = this.getWiresForComponent(id);
    if (relatedWires.length > 0) {
      const wireIds = relatedWires.map(w => w.id);
      this.wires = this.wires.filter(w => !wireIds.includes(w.id));
      this.notify(`已删除 ${relatedWires.length} 条关联连线`);
    }

    this.components = this.components.filter(c => c.id !== id);

    // 如果选中的是被删除的元件，清除选择
    if (this.selection?.kind === 'component' && this.selection.id === id) {
      this.selection = null;
    }

    this.triggerUpdate();
  }

  moveComponent(id: number, x: number, y: number): void {
    const comp = this.getComponent(id);
    if (!comp) return;
    comp.x = x;
    comp.y = y;
    this.triggerUpdate();
  }

  // ============================================================
  // 连线操作
  // ============================================================

  addWire(start: PinRef, end: PinRef): Wire | null {
    if (start.componentId === end.componentId && start.pinId === end.pinId) {
      this.notify('不能连接到同一个引脚');
      return null;
    }

    // 同一元件的两个不同引脚被短接 → 允许但警告
    if (start.componentId === end.componentId) {
      this.notify('警告：同一元件的两引脚被短接');
    }

    const exists = this.wires.some(
      w =>
        (w.startComponentId === start.componentId && w.startPinId === start.pinId &&
         w.endComponentId === end.componentId && w.endPinId === end.pinId) ||
        (w.startComponentId === end.componentId && w.startPinId === end.pinId &&
         w.endComponentId === start.componentId && w.endPinId === start.pinId)
    );
    if (exists) {
      this.notify('该连线已存在');
      return null;
    }

    const wire: Wire = {
      id: this.nextWireId++,
      startComponentId: start.componentId,
      startPinId: start.pinId,
      endComponentId: end.componentId,
      endPinId: end.pinId,
    };

    this.wires.push(wire);
    this.triggerUpdate();
    return wire;
  }

  removeWire(id: number): void {
    this.wires = this.wires.filter(w => w.id !== id);

    // 如果选中的是被删除的电线，清除选择
    if (this.selection?.kind === 'wire' && this.selection.id === id) {
      this.selection = null;
    }

    this.triggerUpdate();
  }

  // ============================================================
  // 参数操作
  // ============================================================

  updateParam(compId: number, paramId: string, value: any): void {
    const comp = this.getComponent(compId);
    if (!comp) return;
    comp.params[paramId] = value;
    this.triggerUpdate();
  }

  // ============================================================
  // 事件通知
  // ============================================================

  onUpdate(callback: (circuit: Circuit) => void): void {
    this.onUpdateCallback = callback;
  }

  forceUpdate(): void {
    this.triggerUpdate();
  }

  private triggerUpdate(): void {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.getCircuit());
    }
  }

  // ============================================================
  // 私有工具
  // ============================================================

  private getDefaultParams(def: any): Record<string, any> {
    const params: Record<string, any> = {};
    for (const p of def.params) {
      params[p.id] = p.default;
    }
    return params;
  }
}