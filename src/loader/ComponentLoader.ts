import type {
    ComponentDefinition,
    FlexUnitCache,
    SolverComponent,
    ComponentInstance,
} from '../types';

export class ComponentLoader {
    private registry = new Map<string, ComponentDefinition>();
    private imageCache = new Map<string, HTMLImageElement>();
    private flexCache = new Map<string, FlexUnitCache>();
    private loadPromises: Promise<void>[] = [];

    /**
     * 加载所有元件
     * 使用 Vite 的 import.meta.glob 自动扫描 src/assets/comps/./meta.json
     */
    async loadAll(): Promise<void> {
        console.log('📦 Phase 1: 开始加载元件注册表...');

        // 扫描所有 meta.json
        const metaModules = import.meta.glob('/src/assets/comps/*/meta.json', {
            eager: true,
            query: '?raw',
            import: 'default',
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

        // 等待所有图片加载完成
        await Promise.all(this.loadPromises);

        console.log(`✅ 注册表加载完成，共 ${this.registry.size} 种元件`);
    }

    /**
     * 加载单个元件
     */
    private async loadComponent(def: ComponentDefinition): Promise<void> {
        // 校验必填字段
        if (!def.name || !def.label) {
            console.warn(`⚠️ 元件定义缺少 name 或 label，跳过`);
            return;
        }

        const basePath = `/src/assets/comps/${def.name}`;

        // 1. 加载 fix.svg
        const fixPath = `${basePath}/fix.svg`;
        const fixImg = await this.loadImage(fixPath);
        if (!fixImg) {
            console.warn(`⚠️ 加载 fix.svg 失败: ${fixPath}，跳过元件 ${def.name}`);
            return;
        }
        this.imageCache.set(fixPath, fixImg);

        // 2. 加载 flex 单元（如果有）
        if (def.flex) {
            for (const [unitId, unitDef] of Object.entries(def.flex.units)) {
                const flexPath = `${basePath}/${unitDef.file}`;
                await this.loadFlexUnit(flexPath, unitId);
            }
        }

        // 3. 存入注册表
        this.registry.set(def.name, def);
        console.log(`  ✅ 加载元件: ${def.label} (${def.name})`);
    }

    /**
     * 加载 flex 单元，解析 viewBox 提取偏移量
     */
    private async loadFlexUnit(path: string, unitId: string): Promise<void> {
        try {
            // 1. 获取 SVG 文本
            const response = await fetch(path);
            if (!response.ok) {
                console.warn(`⚠️ 加载 flex 单元失败 (HTTP ${response.status}): ${path}`);
                return;
            }
            const svgText = await response.text();

            // 2. 解析 viewBox
            const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']([^"']*)["']/i);
            if (!viewBoxMatch) {
                console.warn(`⚠️ ${path} 缺少 viewBox，跳过`);
                return;
            }

            const parts = viewBoxMatch[1].split(/[\s,]+/).map(Number);
            if (parts.length !== 4) {
                console.warn(`⚠️ ${path} viewBox 格式无效: ${viewBoxMatch[1]}`);
                return;
            }

            const [minX, minY, width, height] = parts;

            // 3. 加载为图片
            const img = await this.loadImage(path);
            if (!img) {
                console.warn(`⚠️ 加载 flex 单元图片失败: ${path}`);
                return;
            }

            // 4. 缓存，附带偏移量
            this.flexCache.set(path, {
                img,
                offsetX: minX,
                offsetY: minY,
                width,
                height,
            });

            console.log(`    └─ flex/${unitId}: viewBox = (${minX}, ${minY}) ${width}×${height}`);
        } catch (err) {
            console.warn(`⚠️ 加载 flex 单元异常: ${path}`, err);
        }
    }

    /**
     * 加载图片（返回 Promise）
     */
    private loadImage(path: string): Promise<HTMLImageElement | null> {
        return new Promise((resolve) => {
            // 检查缓存
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

    /**
     * 获取元件定义
     */
    getDefinition(type: string): ComponentDefinition | undefined {
        return this.registry.get(type);
    }

    /**
     * 获取所有已加载的元件类型列表
     */
    getAllTypes(): string[] {
        return Array.from(this.registry.keys());
    }

    /**
     * 获取所有元件定义
     */
    getAllDefinitions(): ComponentDefinition[] {
        return Array.from(this.registry.values());
    }

    /**
     * 获取 fix.svg 图片
     */
    getFixImage(type: string): HTMLImageElement | undefined {
        const path = `/src/assets/comps/${type}/fix.svg`;
        return this.imageCache.get(path);
    }

    /**
     * 获取 flex 单元
     */
    getFlexUnit(type: string, unitId: string): FlexUnitCache | undefined {
        const def = this.registry.get(type);
        if (!def?.flex?.units?.[unitId]) return undefined;
        const path = `/src/assets/comps/${type}/${def.flex.units[unitId].file}`;
        return this.flexCache.get(path);
    }

    /**
     * 获取元件所有 flex 单元
     */
    getFlexUnits(type: string): Map<string, FlexUnitCache> | undefined {
        const def = this.registry.get(type);
        if (!def?.flex) return undefined;

        const result = new Map<string, FlexUnitCache>();
        for (const [unitId, unitDef] of Object.entries(def.flex.units)) {
            const path = `/src/assets/comps/${type}/${unitDef.file}`;
            const cached = this.flexCache.get(path);
            if (cached) {
                result.set(unitId, cached);
            }
        }
        return result;
    }

    /**
     * 提取 SolverComponent（用于发给 Rust）
     */
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

    /**
     * 调试：打印注册表摘要
     */
    debugPrint(): void {
        console.log('📋 元件注册表摘要:');
        for (const [type, def] of this.registry) {
            const flexCount = def.flex ? Object.keys(def.flex.units).length : 0;
            console.log(`  ${type}: ${def.label} (pins: ${def.pins.length}, flex: ${flexCount})`);
        }
    }
}