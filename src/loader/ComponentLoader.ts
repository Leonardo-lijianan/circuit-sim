// src/loader/ComponentLoader.ts

import type {
  ComponentDefinition,
  FlexUnitCache,
  SolverComponent,
  ComponentInstance,
} from '../types';

import { parseSVG, type SVGCommand } from './SVGParser';

export class ComponentLoader {
  private registry = new Map<string, ComponentDefinition>();
  private imageCache = new Map<string, HTMLImageElement>(); // 仅用于 fix.svg
  private flexCache = new Map<string, {
    commands: SVGCommand[];
    viewBox: { vx: number; vy: number; vw: number; vh: number };
    offsetX: number;
    offsetY: number;
  }>();

  async loadAll(): Promise<void> {
    console.log('📦 Phase 1: 开始加载元件注册表...');

    const metaModules = import.meta.glob('/src/assets/comps/*/meta.json', {
      eager: true,
      query: '?raw',
      import: 'default'
    });

    const paths = Object.keys(metaModules);
    console.log(`📁 发现 ${paths.length} 个元件定义文件`);

    for (const path of paths) {
      try {
        const content = metaModules[path] as string;
        const def: ComponentDefinition = JSON.parse(content);
        await this.loadComponent(def);
      } catch (err) {
        console.error(`❌ 加载 ${path} 失败:`, err);
      }
    }

    console.log(`✅ 注册表加载完成，共 ${this.registry.size} 种元件`);
  }

  private async loadComponent(def: ComponentDefinition): Promise<void> {
    if (!def.name || !def.label) {
      console.warn(`⚠️ 元件定义缺少 name 或 label，跳过`);
      return;
    }

    const basePath = `/src/assets/comps/${def.name}`;

    const fixPath = `${basePath}/fix.svg`;
    const fixImg = await this.loadImage(fixPath);
    if (!fixImg) {
      console.warn(`⚠️ 加载 fix.svg 失败: ${fixPath}，跳过元件 ${def.name}`);
      return;
    }
    this.imageCache.set(fixPath, fixImg);

    if (def.flex) {
      for (const [unitId, unitDef] of Object.entries(def.flex.units)) {
        const flexPath = `${basePath}/${unitDef.file}`;
        await this.loadFlexUnit(flexPath, unitId);
      }
    }

    this.registry.set(def.name, def);
    console.log(`  ✅ 加载元件: ${def.label} (${def.name})`);
  }

  private async loadFlexUnit(path: string, unitId: string): Promise<void> {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.warn(`⚠️ 加载 flex 单元失败 (HTTP ${response.status}): ${path}`);
        return;
      }
      const svgText = await response.text();

      const parsed = parseSVG(svgText);
      const { commands, viewBox } = parsed;

      const offsetX = viewBox.vx;
      const offsetY = viewBox.vy;

      this.flexCache.set(path, {
        commands,
        viewBox,
        offsetX,
        offsetY,
      });

      console.log(`    └─ flex/${unitId}: viewBox = (${viewBox.vx}, ${viewBox.vy}) ${viewBox.vw}×${viewBox.vh}, ${commands.length} 个图元`);
    } catch (err) {
      console.warn(`⚠️ 加载 flex 单元异常: ${path}`, err);
    }
  }

  private loadImage(path: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      if (this.imageCache.has(path)) {
        resolve(this.imageCache.get(path)!);
        return;
      }
      const img = new Image();
      img.onload = () => {
        this.imageCache.set(path, img);
        resolve(img);
      };
      img.onerror = () => {
        console.warn(`⚠️ 图片加载失败: ${path}`);
        resolve(null);
      };
      img.src = path;
    });
  }

  // ============================================================
  // 对外查询接口
  // ============================================================

  getDefinition(type: string): ComponentDefinition | undefined {
    return this.registry.get(type);
  }

  getAllTypes(): string[] {
    return Array.from(this.registry.keys());
  }

  getAllDefinitions(): ComponentDefinition[] {
    return Array.from(this.registry.values());
  }

  getFixImage(type: string): HTMLImageElement | undefined {
    const path = `/src/assets/comps/${type}/fix.svg`;
    return this.imageCache.get(path);
  }

  getFlexUnit(type: string, unitId: string): FlexUnitCache | undefined {
    const def = this.registry.get(type);
    if (!def?.flex?.units?.[unitId]) return undefined;
    const path = `/src/assets/comps/${type}/${def.flex.units[unitId].file}`;
    const cached = this.flexCache.get(path);
    if (!cached) return undefined;
    return {
      commands: cached.commands,
      viewBox: cached.viewBox,
      offsetX: cached.offsetX,
      offsetY: cached.offsetY,
    };
  }

  getFlexUnits(type: string): Map<string, FlexUnitCache> | undefined {
    const def = this.registry.get(type);
    if (!def?.flex) return undefined;
    const result = new Map<string, FlexUnitCache>();
    for (const [unitId, unitDef] of Object.entries(def.flex.units)) {
      const path = `/src/assets/comps/${type}/${unitDef.file}`;
      const cached = this.flexCache.get(path);
      if (cached) {
        result.set(unitId, {
          commands: cached.commands,
          viewBox: cached.viewBox,
          offsetX: cached.offsetX,
          offsetY: cached.offsetY,
        });
      }
    }
    return result;
  }

  extractSolverComponent(instance: ComponentInstance): SolverComponent {
    const def = this.registry.get(instance.type)!;
    const params: Record<string, number | boolean> = {};
    for (const [rustKey, uiKey] of Object.entries(def.model.paramMap)) {
      const value = instance.params[uiKey];
      if (value !== undefined) {
        params[rustKey] = typeof value === 'number' ? value : Boolean(value);
      }
    }
    return {
      id: instance.id,
      func: def.model.func,
      params,
      pins: def.pins.map(p => ({ id: p.id })),
    };
  }

  debugPrint(): void {
    console.log('📋 元件注册表摘要:');
    for (const [type, def] of this.registry) {
      const flexCount = def.flex ? Object.keys(def.flex.units).length : 0;
      console.log(`  ${type}: ${def.label} (pins: ${def.pins.length}, flex: ${flexCount})`);
    }
  }
}