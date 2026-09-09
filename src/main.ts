// src/main.ts

import { ComponentLoader } from './loader/ComponentLoader';
import { CanvasManager } from './renderer/CanvasManager';
import { CircuitRenderer } from './renderer/CircuitRenderer';
import { PanelManager } from './ui/PanelManager';
import { ToolbarManager } from './ui/ToolbarManager';
import { StatusBarManager } from './ui/StatusBarManager';
import { KeyboardManager } from './io/KeyboardManager';
import { InteractionManager } from './interaction/InteractionManager';
import { defaultViewport, screenToLogic } from './utils/coordinates';
import type { Circuit, ComponentInstance, Wire } from './types';

console.log('🚀 Phase 0: 电路仿真系统启动');

// ============================================================
// 1. 加载元件
// ============================================================

const loader = new ComponentLoader();
await loader.loadAll();
loader.debugPrint();

// ============================================================
// 2. Canvas 管理
// ============================================================

const canvasManager = new CanvasManager('#canvas-container', 'circuitCanvas');
const ctx = canvasManager.getContext();
const canvas = canvasManager.getCanvas();
const viewport = defaultViewport();

console.log(`📐 Canvas 尺寸: ${canvasManager.getSize().width} × ${canvasManager.getSize().height}`);

// ============================================================
// 3. 创建交互核心
// ============================================================

const interaction = new InteractionManager();

// ============================================================
// 4. UI 管理器
// ============================================================

/* const _toolbar = */ new ToolbarManager(interaction);      // 自动绑定模式按钮
/* const keyboard = */ new KeyboardManager(interaction);    // 自动绑定快捷键
// const panel = new PanelManager(loader); // phase2新增 创建面板管理器
const statusBar = new StatusBarManager();

// ============================================================
// 5. 创建渲染器
// ============================================================

const renderer = new CircuitRenderer(ctx, loader, viewport);

// ============================================================
// 6. 构造测试电路 （Phase 3 后由 CircuitManager 管理）
// ============================================================

const testComponents: ComponentInstance[] = [
  {
    id: 1,
    type: 'led',
    x: 200,
    y: 200,
    w: 60,
    h: 40,
    params: { forward_voltage: 1.8 },
    state: 'off',
  },
  {
    id: 2,
    type: 'resistor',
    x: 400,
    y: 200,
    w: 60,
    h: 40,
    params: { resistance: 1000 },
    state: 'default',
  },
];

const testWires: Wire[] = [
  {
    id: 1,
    startComponentId: 1,
    startPinId: 'k',
    endComponentId: 2,
    endPinId: 'p1',
  },
];

const testCircuit: Circuit = {
  components: testComponents,
  wires: testWires,
};

// ============================================================
// 7. 渲染
// ============================================================

function render() {
  const { width, height } = canvasManager.getSize();
  renderer.render(testCircuit, width, height);
}

render();

/**
 * ★ 关键修复：注册 resize 回调，窗口变化时自动重绘,不然画布尺寸变化后不会自动重绘，导致显示异常。
 * 监听画布尺寸变化。
 * 注意：直接传入 render 引用（而非箭头函数包裹），
 * 便于在销毁时调用 off(render) 精准清除；
 * 当前 render 无参数且不依赖 this，故安全性等同箭头函数。
 */
canvasManager.onResize(render);

// ============================================================
// 8. 鼠标坐标 → 状态栏
// ============================================================

canvas.addEventListener('mousemove', (event) => {
  const logicPos = screenToLogic(event.clientX, event.clientY, canvas, viewport);
  statusBar.updateCursorPos(logicPos.x, logicPos.y);
});

// ============================================================
// 9. 调试接口
// ============================================================

let ledOn = false;
(window as any).__toggleLED = () => {
  const led = testComponents.find(c => c.type === 'led');
  if (!led) return;
  ledOn = !ledOn;
  led.state = ledOn ? 'on' : 'off';
  console.log(`💡 LED 状态: ${led.state}`);
  render();
};

(window as any).__circuit = testCircuit;
(window as any).__loader = loader;
(window as any).__renderer = renderer;
(window as any).__interaction = interaction;

console.log('✅ phase 2: 系统就绪');
console.log('💡 在控制台执行 __toggleLED() 切换 LED 亮灭');