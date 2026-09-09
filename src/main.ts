// src/main.ts

import { ComponentLoader } from './loader/ComponentLoader';
import { CanvasManager } from './renderer/CanvasManager';
import { CircuitRenderer } from './renderer/CircuitRenderer';
import { PanelManager } from './ui/PanelManager';  // ← 新增
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
// 3. 创建渲染器
// ============================================================

const renderer = new CircuitRenderer(ctx, loader, viewport);

// ============================================================
// 3.5 创建面板管理器（新增）
// ============================================================

const panelManager = new PanelManager(loader);

// ============================================================
// 4. 构造测试电路
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
// 5. 渲染
// ============================================================

function render() {
  const { width, height } = canvasManager.getSize();
  renderer.render(testCircuit, width, height);
}

render();

// ★ 关键修复：注册 resize 回调，窗口变化时自动重绘
canvasManager.onResize(() => {
  // render();
});

// ============================================================
// 6. 状态栏坐标更新
// ============================================================

const cursorPosEl = document.getElementById('cursorPos');
canvas.addEventListener('mousemove', (event) => {
  const logicPos = screenToLogic(event.clientX, event.clientY, canvas, viewport);
  if (cursorPosEl) {
    cursorPosEl.textContent = `(${Math.round(logicPos.x)}, ${Math.round(logicPos.y)})`;
  }
});

// 更新元件/连线计数
const compCountEl = document.getElementById('compCount');
const wireCountEl = document.getElementById('wireCount');
if (compCountEl) compCountEl.textContent = String(testComponents.length);
if (wireCountEl) wireCountEl.textContent = String(testWires.length);

// ============================================================
// 7. 调试接口
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

console.log('✅ 系统就绪');
console.log('💡 在控制台执行 __toggleLED() 切换 LED 亮灭');