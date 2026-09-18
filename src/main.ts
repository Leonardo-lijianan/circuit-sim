// src/main.ts
/*
1. 先创建所有实例（loader → canvas → 核心模块 → UI → mouse）
2. 再注册回调（因为回调需要引用所有实例）
3. 最后初始化数据（数据变化会自动触发回调 → 重绘）
4. 手动首次渲染（兜底，防止回调没触发时画布空白）
*/

import { ComponentLoader } from './loader/ComponentLoader';
import { CanvasManager } from './renderer/CanvasManager';
import { CircuitRenderer } from './renderer/CircuitRenderer';
import { RenderCoordinator } from './renderer/RenderCoordinator';
import { CircuitManager } from './manager/CircuitManager';
import { PanelManager } from './ui/PanelManager';
import { ToolbarManager } from './ui/ToolbarManager';
import { StatusBarManager } from './ui/StatusBarManager';
import { KeyboardManager } from './io/KeyboardManager';
import { MouseManager } from './io/MouseManager';
import { InteractionManager } from './interaction/InteractionManager';
import { hitTestCircle, hitTestRect, hitTestSnap, hitTest } from './utils/hitTest';
import { Channel, invoke } from '@tauri-apps/api/core';
import { SimulationClient } from './sim/SimulationClient';
import type { Circuit } from './types';

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

console.log(`📐 Canvas 尺寸: ${canvasManager.getSize().width} × ${canvasManager.getSize().height}`);

// ============================================================
// 3. 核心模块
// ============================================================

// 3.1 交互核心
const interaction = new InteractionManager();

// 3.2 数据管理 (Phase 3 新增)
const circuitManager = new CircuitManager(loader);

// 3.3 渲染器
const renderer = new CircuitRenderer(ctx, loader);

// 3.4 渲染协调器
const coordinator = new RenderCoordinator({
  renderer,
  canvasManager,
  circuitManager,
  interaction,
});

// ============================================================
// 4. UI 管理器 (实例化即自动绑定)
// ============================================================

new ToolbarManager(interaction);
const panel = new PanelManager(loader);
const statusBar = new StatusBarManager();
new KeyboardManager({
  interaction,
  circuitManager,
  statusBar,
});

// ============================================================
// 5. 鼠标事件管理
// ============================================================

/* const mouseManager = */ new MouseManager({
  canvas,
  interaction,
  statusBar,
  coordinator,
});

// 注入 hitTest 上下文
interaction.setContext(
  loader,
  () => circuitManager.getComponents(),
  () => circuitManager.getWires()
);

// ============================================================
// 6. 注册回调（数据 / 模式 / 窗口变化 → 触发重绘）
// ============================================================

// 6.1 数据更新 → 更新状态栏 / 面板 / 重绘
circuitManager.onUpdate((circuit: Circuit) => {
  statusBar.updateCircuitStats(circuit);
  panel.update(circuit.selection, circuit.components);
  coordinator.render();
});

// 6.1.1 数据层消息 → 状态栏提示
circuitManager.onMessage((msg) => {
  statusBar.showWarning(msg);
});

// 6.2 pending 变化 → 重绘（清除预览或显示新预览）
interaction.onPendingChange(() => {
  coordinator.render();
});

// 6.3 窗口尺寸变化 → 更新状态栏 + 重绘
canvasManager.onResize(() => {
  statusBar.updateCircuitStats(circuitManager.getCircuit());
  coordinator.render();
});

// 6.4 Place 模式回调：放置元件
interaction.onPlace((type: string, x: number, y: number) => {
  const comp = circuitManager.addComponent(type, x, y);
  if (comp) {
    console.log(`✅ 放置元件: ${type} at (${x}, ${y})`);
    circuitManager.selectComponent(comp.id);
  }
});

// Select 模式：选中元件
interaction.onSelectComponent((id) => {
  circuitManager.selectComponent(id);
});

// Select 模式：选中电线
interaction.onSelectWire((id) => {
  circuitManager.selectWire(id);
});

// Select 模式：拖拽移动
interaction.onMove((id, x, y) => {
  circuitManager.moveComponent(id, x, y);
});

// Wire 模式：完成连线
interaction.onWireComplete((start, end) => {
  const wire = circuitManager.addWire(start, end);
  if (wire) {
    console.log(`✅ 连线: ${start.componentId}:${start.pinId} → ${end.componentId}:${end.pinId}`);
  }
});

// 6.5 注入 InteractionManager 到 PanelManager
panel.setInteraction(interaction);

// ============================================================
// 7. 构造测试电路
// ============================================================

// LED
const led = circuitManager.addComponent('led', 200, 200);
if (led) {
  led.params.forward_voltage = 1.8;
  led.state = 'off';
}

// 电阻
const resistor = circuitManager.addComponent('resistor', 400, 200);
if (resistor) {
  resistor.params.resistance = 1000;
  resistor.state = 'default';
}

// 连线
if (led && resistor) {
  circuitManager.addWire(
    { componentId: led.id, pinId: 'k' },
    { componentId: resistor.id, pinId: 'p1' }
  );
}

// ============================================================
// 8. 首次渲染
// ============================================================

statusBar.updateCircuitStats(circuitManager.getCircuit());
coordinator.render();

// ============================================================
// 9. 调试接口
// ============================================================

let ledOn = false;
(window as any).__toggleLED = () => {
  const comps = circuitManager.getComponents();
  const led = comps.find(c => c.type === 'led');
  if (!led) return;
  ledOn = !ledOn;
  led.state = ledOn ? 'on' : 'off';
  console.log(`💡 LED 状态: ${led.state}`);
  circuitManager.forceUpdate();
};

(window as any).__circuit = circuitManager.getCircuit();
(window as any).__loader = loader;
(window as any).__renderer = renderer;
(window as any).__interaction = interaction;
(window as any).__manager = circuitManager;
(window as any).__hitTestCircle = hitTestCircle;
(window as any).__hitTestRect = hitTestRect;
(window as any).__hitTestSnap = hitTestSnap;
(window as any).__hitTest = hitTest;

console.log('✅ 系统就绪：当前进度： Phase 5 Task 5.1（Tauri command）');
console.log('💡 在控制台执行 __toggleLED() 切换 LED 亮灭');

// ============================================================
// Phase 5 调试：测试 invoke solve_circuit
// ============================================================

(window as any).__solveCircuit = async () => {
  const input = {
    analysis: { type: 'dc' },
    components: [
      { id: 1, func: 'voltage_source', params: { V: 1.5 }, pins: [{ id: 'neg' }, { id: 'pos' }] },
      { id: 2, func: 'ohm', params: { R: 1000 }, pins: [{ id: 'p1' }, { id: 'p2' }] },
    ],
    wires: [
      { start: { componentId: 1, pinId: 'pos' }, end: { componentId: 2, pinId: 'p1' } },
      { start: { componentId: 1, pinId: 'neg' }, end: { componentId: 2, pinId: 'p2' } },
    ],
  };
  try {
    const result = await invoke('solve_circuit', { input });
    console.log('🔬 solve_circuit 结果:', result);
    return result;
  } catch (err) {
    console.error('❌ solve_circuit 失败:', err);
    throw err;
  }
};

console.log('🔬 在控制台执行 __solveCircuit() 测试 Tauri command');

// ============================================================
// Phase 5 调试：测试常驻 Worker
// ============================================================

(window as any).__testWorker = async () => {
  const channel = new Channel<unknown>();
  channel.onmessage = (msg) => {
    console.log('📨 收到 Worker 消息:', msg);
  };

  await invoke('init_worker', { channel });

  const input = {
    analysis: { type: 'dc' },
    components: [
      { id: 1, func: 'voltage_source', params: { V: 1.5 }, pins: [{ id: 'neg' }, { id: 'pos' }] },
      { id: 2, func: 'ohm', params: { R: 1000 }, pins: [{ id: 'p1' }, { id: 'p2' }] },
    ],
    wires: [
      { start: { componentId: 1, pinId: 'pos' }, end: { componentId: 2, pinId: 'p1' } },
      { start: { componentId: 1, pinId: 'neg' }, end: { componentId: 2, pinId: 'p2' } },
    ],
  };
  await invoke('send_command', { cmd: 'UpdateInput', payload: input });

  await invoke('send_command', { cmd: 'Start' });
  console.log('▶️ 已发送 Start');

  setTimeout(() => {
    invoke('send_command', { cmd: 'Pause' });
    console.log('⏸️ 已发送 Pause');
  }, 500);

  setTimeout(() => {
    invoke('send_command', { cmd: 'Stop' });
    console.log('⏹️ 已发送 Stop');
  }, 1000);
};

console.log('🔬 在控制台执行 __testWorker() 测试常驻 Worker');

// ============================================================
// Phase 5：SimulationClient 实例（Task 5.5）
// ============================================================

const simClient = new SimulationClient();

(window as any).__simClient = simClient;

// ★ 启动时自动初始化 + 停止（应对 F5 刷新导致的旧 Channel 失效）
(async () => {
  try {
    await simClient.init();
    await simClient.stop();
    console.log('🔬 SimulationClient 已就绪（Worker 已复位）');
  } catch (err) {
    console.error('❌ SimulationClient 初始化失败:', err);
  }
})();
