// src/sim/SimulationClient.ts

import { Channel, invoke } from '@tauri-apps/api/core';
import type { SolverInput, SolverOutput } from '../types';

// ============================================================
// 与 Rust WorkerMessage 对齐（serde tag="type"）
// ============================================================

export type WorkerMessage =
  | { type: 'Output'; batch: SolverOutput[] }
  | { type: 'Error'; message: string }
  | { type: 'StateChanged'; state: WorkerState };

export type WorkerState = 'idle' | 'running' | 'paused' | 'stopped';

// ============================================================
// 回调类型
// ============================================================

type OutputCallback = (batch: SolverOutput[]) => void;
type StateCallback = (state: WorkerState) => void;
type ErrorCallback = (message: string) => void;

// ============================================================
// SimulationClient
// ============================================================

/**
 * 前端与 Rust 常驻 Worker 的通信封装
 *
 * 用法：
 *   const client = new SimulationClient();
 *   client.onOutput((batch) => console.log(batch));
 *   client.onStateChange((state) => console.log(state));
 *   client.onError((msg) => console.error(msg));
 *   await client.init();
 *   client.updateInput(solverInput);
 *   await client.start();
 */
export class SimulationClient {
  private channel: Channel<WorkerMessage>;
  private initialized: boolean = false;

  private outputCallbacks: OutputCallback[] = [];
  private stateCallbacks: StateCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  private currentState: WorkerState = 'idle';

  constructor() {
    this.channel = new Channel<WorkerMessage>();
    this.channel.onmessage = (msg) => this.handleMessage(msg);
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 把 Channel 注册到 Rust Worker
   * 只需要调用一次
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await invoke('init_worker', { channel: this.channel });
    this.initialized = true;
  }

  // ============================================================
  // 控制指令
  // ============================================================

  /** 更新电路数据（不启动仿真，但会立即触发一次求解） */
  async updateInput(input: SolverInput): Promise<void> {
    await invoke('send_command', { cmd: 'UpdateInput', payload: input });
  }

  /** 开始仿真 */
  async start(): Promise<void> {
    await invoke('send_command', { cmd: 'Start' });
  }

  /** 暂停仿真 */
  async pause(): Promise<void> {
    await invoke('send_command', { cmd: 'Pause' });
  }

  /** 停止仿真 */
  async stop(): Promise<void> {
    await invoke('send_command', { cmd: 'Stop' });
  }

  /** 关闭 Worker（App 关闭时调用） */
  async shutdown(): Promise<void> {
    await invoke('send_command', { cmd: 'Shutdown' });
  }

  // ============================================================
  // 状态查询
  // ============================================================

  getState(): WorkerState {
    return this.currentState;
  }

  // ============================================================
  // 回调注册
  // ============================================================

  onOutput(cb: OutputCallback): void {
    this.outputCallbacks.push(cb);
  }

  onStateChange(cb: StateCallback): void {
    this.stateCallbacks.push(cb);
  }

  onError(cb: ErrorCallback): void {
    this.errorCallbacks.push(cb);
  }

  // ============================================================
  // 消息分发
  // ============================================================

  private handleMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'Output':
        for (const cb of this.outputCallbacks) cb(msg.batch);
        break;
      case 'StateChanged':
        this.currentState = msg.state;
        for (const cb of this.stateCallbacks) cb(msg.state);
        break;
      case 'Error':
        for (const cb of this.errorCallbacks) cb(msg.message);
        break;
    }
  }
}
