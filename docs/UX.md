好，我把你这次对 `index.html` 的所有修改逐条列出来，并标注需要联动改的代码。

---

## 你的 index.html 改动清单

### 1. 删除了标题

```diff
- <span class="title">⚡ 电路仿真</span>
- <div class="sep"></div>
```

### 2. 「导入/导出」改为「打开/保存」

```diff
- <button id="btnImport" style="opacity:0.4;" disabled>📂 导入</button>
- <button id="btnExport" style="opacity:0.4;" disabled>💾 导出</button>
+ <button id="btnOpen" style="opacity:0.4;" disabled>📂 打开</button>
+ <button id="btnSave" style="opacity:0.4;" disabled>💾 保存</button>
```

### 3. 删除「放置」按钮（保留注释形式）

```diff
  <div class="mode-group">
    <button id="modeSelect" class="active" data-mode="select">选择</button>
    <button id="modeWire" data-mode="wire">连线</button>
-   <button id="modePlace" data-mode="place">放置</button>
+   <!-- <button id="modePlace" data-mode="place">放置</button> -->
  </div>
```

### 4. 工具栏右侧的 `modeDisplay` 删除，移到状态栏最左侧

```diff
- <span id="modeDisplay" style="font-size:12px;color:#6c7086;margin-left:4px;">模式: 选择</span>
```

### 5. 状态栏重构

```diff
  <div id="statusbar">
-   <span class="item">元件: <span class="value" id="compCount">0</span></span>
-   <span class="item">连线: <span class="value" id="wireCount">0</span></span>
-   <span class="item">
-     <span class="status-dot idle" id="statusDot"></span>
-     仿真: <span class="value" id="simStatus">停止</span>
-   </span>
-   <div class="spacer"></div>
-   <span class="item" id="cursorPos">(0, 0)</span>
+   <span class="item">模式: <span class="value" id="modeDisplay">选择</span></span>
+   <span class="item">
+     <span class="status-dot idle" id="statusDot"></span>
+     仿真: <span class="value" id="simStatus">停止</span>
+   </span>
+   <div class="spacer"></div>
+   <span class="item">元件: <span class="value" id="compCount">0</span></span>
+   <span class="item">连线: <span class="value" id="wireCount">0</span></span>
+   <span class="value" id="cursorPos">(0, 0)</span>
  </div>
```

**变化说明**：
- 左侧：模式、仿真状态
- 中间：spacer 撑开
- 右侧：元件数、连线数、光标坐标


## ⚠️ 需要联动修改的代码

### 修改 1：`src/io/KeyboardManager.ts`

删除 `case '3'` 分支（因为没有 Place 按钮了，快捷键也同步移除）：

```diff
  switch (event.key) {
    case '1':
      this.interaction.setMode('select');
      break;
    case '2':
      this.interaction.setMode('wire');
      break;
-   case '3':
-     this.interaction.setMode('place');
-     break;
    case 'Escape':
      // ...
      break;
  }
```

### 修改 2：`src/ui/ToolbarManager.ts`

`modeDisplay` 的内容变了，之前代码是：

```typescript
modeDisplay.textContent = `模式: ${modeNames[mode]}`;
```

现在 `modeDisplay` 只承载“选择”、“放置”、“连线”这几个词，`模式: ` 前缀已经在 HTML 里了，所以要改成：

```diff
  const modeDisplay = document.getElementById('modeDisplay');
  if (modeDisplay) {
    const modeNames: Record<Mode, string> = {
      select: '选择',
      place: '放置',
      wire: '连线',
      pan: '平移',
    };
-   modeDisplay.textContent = `模式: ${modeNames[mode]}`;
+   modeDisplay.textContent = modeNames[mode];
  }
```

---

## 不需要修改但要注意的

| 项目 | 说明 |
|------|------|
| Place 模式仍然保留 | `InteractionManager` 里 `'place'` 模式不删，由 `PanelManager` 点击元件触发 |
| `modeDisplay` 显示"放置" | 用户从元件库点元件后，状态栏会显示"模式: 放置"，这是正确的状态反馈 |
| `btnClear` | 仍然是清空按钮，Phase 9 会实现 |
| `btnOpen` / `btnSave` | 改名了，但功能还是 Phase 9 实现 |

---

## 验收

改完后重新运行，验证：

| 测试 | 预期 |
|------|------|
| 工具栏 | 只有 [选择] [连线]，无 [放置] 按钮 |
| 状态栏 | 左侧显示"模式: 选择"，右侧显示元件/连线/光标 |
| 按 `3` | 无反应（快捷键已移除） |
| 从元件库点击元件 | 状态栏显示"模式: 放置"，光标变十字准星 |
| 点击画布 | 元件正确放置在光标处，模式回到"选择" |