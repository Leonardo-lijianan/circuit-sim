// src/renderer/CircuitRenderer.ts

import type { ComponentLoader } from '../loader/ComponentLoader';
import type { Circuit, ComponentInstance, FlexUnitCache, PinRef } from '../types';
//import type { Viewport } from '../utils/coordinates';
import type { SVGCommand } from '../loader/SVGParser';

export class CircuitRenderer {
  private ctx: CanvasRenderingContext2D;
  private loader: ComponentLoader;
  //private viewport: Viewport;

  constructor(
    ctx: CanvasRenderingContext2D,
    loader: ComponentLoader,
    // viewport: Viewport
  ) {
    this.ctx = ctx;
    this.loader = loader;
    // this.viewport = viewport;
  }

  render(
    circuit: Circuit,
    width: number,
    height: number,
    overlays?: {
      place?: { type: string; x: number; y: number };
      wire?: { startX: number; startY: number; endX: number; endY: number; snapped: boolean };
      hoverPin?: PinRef;
    }
  ): void {
    this.drawBackground(width, height);
    this.drawWires(circuit);
    this.drawFixLayers(circuit);
    this.drawFlexLayers(circuit);
    if (overlays?.place) this.drawPreview(overlays.place);
    if (overlays?.wire) this.drawTempWire(overlays.wire);
    else if (overlays?.hoverPin) this.drawHoverPin(overlays.hoverPin, circuit);
    this.drawOverlay(circuit);
  }

  private drawBackground(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#313244';
    ctx.lineWidth = 0.5;
    const gridSize = 20;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  private drawWires(circuit: Circuit): void {
    const ctx = this.ctx;
    for (const wire of circuit.wires) {
      const start = this.getPinWorldPos(wire.startComponentId, wire.startPinId, circuit.components);
      const end = this.getPinWorldPos(wire.endComponentId, wire.endPinId, circuit.components);
      if (!start || !end) continue;

      ctx.strokeStyle = '#a6adc8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.fillStyle = '#a6adc8';
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawOneFix(comp: ComponentInstance): void {
    const fixImg = this.loader.getFixImage(comp.type);
    if (fixImg) {
      this.ctx.drawImage(fixImg, comp.x, comp.y, comp.w, comp.h);
    }
  }

  private drawFixLayers(circuit: Circuit): void {
    for (const comp of circuit.components) {
      this.drawOneFix(comp);
    }
  }

  private drawOneFlex(comp: ComponentInstance): void {
    const def = this.loader.getDefinition(comp.type);
    if (!def?.flex) return;
    const stateKey = comp.state || def.visual.default_state || 'default';
    const state = def.visual.states[stateKey];
    if (!state) return;
    for (const [unitId] of Object.entries(def.flex.units)) {
      const flexUnit = this.loader.getFlexUnit(comp.type, unitId);
      if (!flexUnit) continue;
      const partParams = state.parts?.[unitId] || {};
      this.drawFlexUnit(this.ctx, comp, flexUnit, partParams);
    }
  }

  private drawFlexLayers(circuit: Circuit): void {
    for (const comp of circuit.components) {
      this.drawOneFlex(comp);
    }
  }

  private drawFlexUnit(
    ctx: CanvasRenderingContext2D,
    comp: ComponentInstance,
    flexUnit: FlexUnitCache,
    partParams: { opacity?: number; color?: string; rotation?: number; offsetX?: number; offsetY?: number }
  ): void {
    const { commands, viewBox } = flexUnit;
    const { vw, vh } = viewBox;
    const scaleX = comp.w / vw;
    const scaleY = comp.h / vh;

    // 处理旋转（整体变换）
    const rotation = partParams.rotation || 0;
    if (rotation !== 0) {
      ctx.save();
      const cx = comp.x + comp.w / 2;
      const cy = comp.y + comp.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
      this.executeCommands(ctx, comp, commands, scaleX, scaleY, partParams);
      ctx.restore();
    } else {
      this.executeCommands(ctx, comp, commands, scaleX, scaleY, partParams);
    }
  }

  private drawPreview(preview: { type: string; x: number; y: number }): void {
    const ctx = this.ctx;
    const def = this.loader.getDefinition(preview.type);
    if (!def) return;

    const w = 60;
    const h = 40;

    // 构造一个临时的 ComponentInstance
    const fakeComp: ComponentInstance = {
      id: -1,
      type: preview.type,
      x: preview.x,
      y: preview.y,
      w,
      h,
      params: {},
      state: def.visual.default_state || 'default',
    };

    // 半透明绘制
    ctx.save();
    ctx.globalAlpha = 0.5;
    this.drawOneFix(fakeComp);
    this.drawOneFlex(fakeComp);
    ctx.restore();

    // 蓝色虚线边框
    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(preview.x - 2, preview.y - 2, w + 4, h + 4);
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * 绘制临时连线（Wire 模式）
   */
  private drawTempWire(wire: { startX: number; startY: number; endX: number; endY: number; snapped: boolean }): void {
    const ctx = this.ctx;

    ctx.save();

    // 虚线
    ctx.strokeStyle = '#a6adc8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(wire.startX, wire.startY);
    ctx.lineTo(wire.endX, wire.endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 起点圆点
    ctx.fillStyle = '#a6adc8';
    ctx.beginPath();
    ctx.arc(wire.startX, wire.startY, 4, 0, Math.PI * 2);
    ctx.fill();

    // 磁吸目标：放大高亮圈
    if (wire.snapped) {
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(wire.endX, wire.endY, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制悬停引脚高亮（小圈）
   */
  private drawHoverPin(pinRef: PinRef, circuit: Circuit): void {
    const comp = circuit.components.find(c => c.id === pinRef.componentId);
    if (!comp) return;
    const def = this.loader.getDefinition(comp.type);
    if (!def) return;
    const pin = def.pins.find(p => p.id === pinRef.pinId);
    if (!pin) return;

    const ctx = this.ctx;
    const pinX = comp.x + pin.x;
    const pinY = comp.y + pin.y;

    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pinX, pinY, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 层 5：覆盖层（选中高亮 + 未来引脚热区）
   */
  private drawOverlay(circuit: Circuit): void {
    if (circuit.selectedId === null) return;

    const comp = circuit.components.find(c => c.id === circuit.selectedId);
    if (!comp) return;

    this.drawSelection(comp);
  }

  /**
   * 绘制选中高亮：蓝色虚线框 + 四角锚点
   */
  private drawSelection(comp: ComponentInstance): void {
    const ctx = this.ctx;
    const pad = 4;
    const s = 6;

    ctx.save();

    // 1. 蓝色虚线框
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      comp.x - pad,
      comp.y - pad,
      comp.w + pad * 2,
      comp.h + pad * 2
    );
    ctx.setLineDash([]);

    // 2. 四角锚点
    ctx.fillStyle = '#89b4fa';
    const corners = [
      [comp.x, comp.y],
      [comp.x + comp.w, comp.y],
      [comp.x, comp.y + comp.h],
      [comp.x + comp.w, comp.y + comp.h],
    ];
    for (const [x, y] of corners) {
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    ctx.restore();
  }

  private executeCommands(
    ctx: CanvasRenderingContext2D,
    comp: ComponentInstance,
    commands: SVGCommand[],
    scaleX: number,
    scaleY: number,
    partParams: { opacity?: number; color?: string; offsetX?: number; offsetY?: number }
  ): void {
    const offsetX = partParams.offsetX || 0;
    const offsetY = partParams.offsetY || 0;

    for (const cmd of commands) {
      const color = partParams.color || cmd.fill;
      const opacity = partParams.opacity !== undefined ? partParams.opacity : cmd.opacity;

      ctx.save();
      ctx.globalAlpha = opacity;

      switch (cmd.type) {
        case 'circle': {
          const cx = comp.x + (cmd.cx ?? 0) * scaleX + offsetX;
          const cy = comp.y + (cmd.cy ?? 0) * scaleY + offsetY;
          const r = (cmd.r ?? 0) * Math.min(scaleX, scaleY);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fill();
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.stroke();
          }
          break;
        }
        case 'rect': {
          const x = comp.x + (cmd.x ?? 0) * scaleX + offsetX;
          const y = comp.y + (cmd.y ?? 0) * scaleY + offsetY;
          const w = (cmd.w ?? 0) * scaleX;
          const h = (cmd.h ?? 0) * scaleY;
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, w, h);
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.strokeRect(x, y, w, h);
          }
          break;
        }
        case 'path': {
          // 路径需要缩放和偏移，用 transform
          ctx.save();
          ctx.translate(comp.x + offsetX, comp.y + offsetY);
          ctx.scale(scaleX, scaleY);
          const path = new Path2D(cmd.d ?? '');
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fill(path);
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1);
            ctx.stroke(path);
          }
          ctx.restore();
          break;
        }
        case 'polygon': {
          const pts = cmd.points ?? [];
          if (pts.length < 6) break;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) {
            const px = comp.x + pts[i] * scaleX + offsetX;
            const py = comp.y + pts[i + 1] * scaleY + offsetY;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fill();
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.stroke();
          }
          break;
        }
      }
      ctx.restore();
    }
  }

  private getPinWorldPos(
    compId: number,
    pinId: string,
    components: ComponentInstance[]
  ): { x: number; y: number } | null {
    const comp = components.find(c => c.id === compId);
    if (!comp) return null;
    const def = this.loader.getDefinition(comp.type);
    if (!def) return null;
    const pin = def.pins.find(p => p.id === pinId);
    if (!pin) return null;
    return { x: comp.x + pin.x, y: comp.y + pin.y };
  }
}