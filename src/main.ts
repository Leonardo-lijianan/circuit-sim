import { ComponentLoader } from './loader/ComponentLoader';

console.log('🚀 Phase 0: 电路仿真系统启动');

// 创建加载器实例
const loader = new ComponentLoader();

// 执行加载
await loader.loadAll();

// 调试输出
loader.debugPrint();

// 挂载到全局，方便调试
(window as any).__loader = loader;
(window as any).__registry = loader.getAllDefinitions();

console.log('✅ 系统就绪，可通过 __loader 或 __registry 调试');