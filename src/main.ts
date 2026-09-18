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
import { SimulationClient } from './sim/SimulationClient';
import { evaluateTransition } from './sim/stateTransition';
import type { Circuit, SolverInput } from './types';

console.log('🚀 电路仿真系统启动');

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

const interaction = new InteractionManager();
const circuitManager = new CircuitManager(loader);
const renderer = new CircuitRenderer(ctx, loader);
const coordinator = new RenderCoordinator({
  renderer,
  canvasManager,
  circuitManager,
  interaction,
});

// ============================================================
// 4. UI 管理器
// ============================================================

const toolbar = new ToolbarManager(interaction);
const panel = new PanelManager(loader);
const statusBar = new StatusBarManager();
new KeyboardManager({ interaction, circuitManager, statusBar });

// ============================================================
// 5. 鼠标事件管理
// ============================================================

new MouseManager({ canvas, interaction, statusBar, coordinator });

interaction.setContext(
  loader,
  () => circuitManager.getComponents(),
  () => circuitManager.getWires()
);

// ============================================================
// 6. SimulationClient（Phase 5）
// ============================================================

const simClient = new SimulationClient();
(window as any).__simClient = simClient;

/**
 * 从画布电路提取 SolverInput
 */
function buildSolverInput(): SolverInput {
  return {
    analysis: { type: 'dc' },
    components: circuitManager.getComponents().map(c =>
      loader.extractSolverComponent(c)
    ),
    wires: circuitManager.getWires().map(w => ({
      start: { componentId: w.startComponentId, pinId: w.startPinId },
      end: { componentId: w.endComponentId, pinId: w.endPinId },
    })),
  };
}

// 收到求解结果 → 更新元件 electrical + state → 重绘
simClient.onOutput((batch) => {
  for (const res of batch) {
    const comp = circuitManager.getComponent(res.componentId);
    if (!comp) continue;

    comp.electrical = {
      voltage: res.voltage,
      current: res.current,
      power: res.power,
    };

    // 评估状态转换规则
    const def = loader.getDefinition(comp.type);
    if (def?.state_transition) {
      const newState = evaluateTransition(def.state_transition, comp.electrical);
      if (typeof newState === 'string') {
        comp.state = newState;
      }
    }
  }

  // 更新参数面板的电气数据显示（Task 6.3）
  const sel = circuitManager.getSelection();
  if (sel?.kind === 'component') {
    const selComp = circuitManager.getComponent(sel.id);
    if (selComp) panel.updateElectrical(selComp);
  }

  // 直接重绘（不走 circuitManager.forceUpdate，避免触发 updateInput 死循环）
  coordinator.render();
});

// 状态变化 → 更新状态栏 / 按钮 / 清空结果（仅 stopped）
simClient.onStateChange((state) => {
  console.log(`🎯 Worker 状态: ${state}`);

  statusBar.updateSimState(state);
  toolbar.setSimState(state);

  // stopped：清空所有元件的电气数据，恢复到 default_state
  if (state === 'stopped') {
    for (const comp of circuitManager.getComponents()) {
      comp.electrical = undefined;
      const def = loader.getDefinition(comp.type);
      comp.state = def?.visual.default_state || 'default';
    }
    coordinator.render();
  }
});

// 错误 → 状态栏提示
simClient.onError((msg) => {
  console.error('❌ Worker 错误:', msg);
  statusBar.showWarning(msg);
});

// 初始化 SimulationClient
(async () => {
  try {
    await simClient.init();
    await simClient.stop();  // 复位（应对 F5）
    console.log('🔬 SimulationClient 已就绪');
  } catch (err) {
    console.error('❌ SimulationClient 初始化失败:', err);
  }
})();

// ============================================================
// 7. 注册回调（数据 / 模式 / 窗口变化 → 触发重绘）
// ============================================================

circuitManager.onUpdate((circuit: Circuit) => {
  statusBar.updateCircuitStats(circuit);
  panel.update(circuit.selection, circuit.components);

  // 同步选中元件的参数面板显示（如 switch 通过空格切换后）
  if (circuit.selection?.kind === 'component') {
    const comp = circuit.components.find(c => c.id === circuit.selection!.id);
    if (comp) panel.refreshParams(comp);
  }

  coordinator.render();

  // 只在 Worker Running 时推送（Idle/Stopped 时推了也没用）
  if (simClient.getState() === 'running') {
    simClient.updateInput(buildSolverInput());
  }
});

circuitManager.onMessage((msg) => {
  statusBar.showWarning(msg);
});

interaction.onPendingChange(() => {
  coordinator.render();
});

canvasManager.onResize(() => {
  statusBar.updateCircuitStats(circuitManager.getCircuit());
  coordinator.render();
});

// Place 模式回调
interaction.onPlace((type: string, x: number, y: number) => {
  const comp = circuitManager.addComponent(type, x, y);
  if (comp) {
    console.log(`✅ 放置元件: ${type} at (${x}, ${y})`);
    circuitManager.selectComponent(comp.id);
  }
});

interaction.onSelectComponent((id) => {
  circuitManager.selectComponent(id);
});

interaction.onSelectWire((id) => {
  circuitManager.selectWire(id);
});

interaction.onMove((id, x, y) => {
  circuitManager.moveComponent(id, x, y);
});

interaction.onWireComplete((start, end) => {
  const wire = circuitManager.addWire(start, end);
  if (wire) {
    console.log(`✅ 连线: ${start.componentId}:${start.pinId} → ${end.componentId}:${end.pinId}`);
  }
});

panel.setInteraction(interaction);
panel.setParamChangeHandler((compId, paramId, value) => {
  circuitManager.updateParam(compId, paramId, value);
});

// ============================================================
// 8. 工具栏按钮接线
// ============================================================

document.getElementById('btnStart')?.addEventListener('click', async () => {
  // 每次开始/恢复前先同步电路数据（Rust 侧 Stop 会清空缓存）
  await simClient.updateInput(buildSolverInput());
  await simClient.start();
});
document.getElementById('btnPause')?.addEventListener('click', () => {
  simClient.pause();
});
document.getElementById('btnStop')?.addEventListener('click', () => {
  simClient.stop();
});

// ============================================================
// 9. 构造测试电路：5V 电池 + LED + 1000Ω 电阻（闭合回路）
// ============================================================

// 电池
const battery = circuitManager.addComponent('battery', 100, 200);
if (battery) {
  battery.params.voltage = 5.0;
}

// LED
const led = circuitManager.addComponent('led', 250, 200);

// 电阻
const resistor = circuitManager.addComponent('resistor', 400, 200);
if (resistor) {
  resistor.params.resistance = 1000;
}

// 连线：battery.pos → led.a
if (battery && led) {
  circuitManager.addWire(
    { componentId: battery.id, pinId: 'pos' },
    { componentId: led.id, pinId: 'a' }
  );
}

// 连线：led.k → resistor.p1
if (led && resistor) {
  circuitManager.addWire(
    { componentId: led.id, pinId: 'k' },
    { componentId: resistor.id, pinId: 'p1' }
  );
}

// 连线：resistor.p2 → battery.neg
if (resistor && battery) {
  circuitManager.addWire(
    { componentId: resistor.id, pinId: 'p2' },
    { componentId: battery.id, pinId: 'neg' }
  );
}

// ============================================================
// 10. 首次渲染
// ============================================================

statusBar.updateCircuitStats(circuitManager.getCircuit());
coordinator.render();

// ============================================================
// 11. 调试接口
// ============================================================

(window as any).__circuit = circuitManager.getCircuit;
(window as any).__loader = loader;
(window as any).__renderer = renderer;
(window as any).__interaction = interaction;
(window as any).__manager = circuitManager;
(window as any).__hitTestCircle = hitTestCircle;
(window as any).__hitTestRect = hitTestRect;
(window as any).__hitTestSnap = hitTestSnap;
(window as any).__hitTest = hitTest;

console.log('✅ 系统就绪：Phase 5 Task 5.6a（核心联调）');
