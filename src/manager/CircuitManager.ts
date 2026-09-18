// src/manager/CircuitManager.ts

import type { ComponentInstance, Wire, Circuit, PinRef } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';

export class CircuitManager {
  private components: ComponentInstance[] = [];
  private wires: Wire[] = [];
  private selectedId: number | null = null;
  private nextId: number = 1;
  private nextWireId: number = 1;
  private loader: ComponentLoader;
  private onUpdateCallback?: (circuit: Circuit) => void;

  constructor(loader: ComponentLoader) {
    this.loader = loader;
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
      selectedId: this.selectedId,
    };
  }

  getComponent(id: number): ComponentInstance | undefined {
    return this.components.find(c => c.id === id);
  }

  getWire(id: number): Wire | undefined {
    return this.wires.find(w => w.id === id);
  }

  getSelected(): ComponentInstance | null {
    if (this.selectedId === null) return null;
    return this.getComponent(this.selectedId) || null;
  }

  getSelectedId(): number | null {
    return this.selectedId;
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
      console.warn(`⚠️ 未知元件类型: ${type}`);
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
      console.log(`🗑️ 删除元件 ${id}，同时删除 ${relatedWires.length} 条关联连线`);
    }

    this.components = this.components.filter(c => c.id !== id);

    if (this.selectedId === id) {
      this.selectedId = null;
    }

    this.triggerUpdate();
  }

  selectComponent(id: number | null): void {
    this.selectedId = id;
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
      console.warn('⚠️ 不能连接到同一个引脚');
      return null;
    }

    const exists = this.wires.some(
      w =>
        (w.startComponentId === start.componentId && w.startPinId === start.pinId &&
         w.endComponentId === end.componentId && w.endPinId === end.pinId) ||
        (w.startComponentId === end.componentId && w.startPinId === end.pinId &&
         w.endComponentId === start.componentId && w.endPinId === start.pinId)
    );
    if (exists) {
      console.warn('⚠️ 连线已存在');
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