### 命名原则（后续写新代码时参考）

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| **通用算法** | 用**算法本质**命名 | `hitTestCircle`, `hitTestRect`, `clamp`, `lerp` |
| **业务封装** | 用**业务含义**命名 | `hitTest`, `snapToNearestPin`, `addComponent` |
| **UI 管理器** | 用**UI 区域**命名 | `ToolbarManager`, `StatusBarManager` |
| **I/O 管理器** | 用**输入类型**命名 | `KeyboardManager`, `FileManager` |