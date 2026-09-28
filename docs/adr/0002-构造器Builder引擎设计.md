# ADR 0002: 构造器 (Builder) 引擎设计

## 状态

已提议 (Proposed)

## 背景

构造器 (Builder) 是本插件的核心功能之一，负责将列表项同步转换为独立的文档或标题块。它基于思源的块属性系统实现双向同步，支持三种构建类型：
- **文档树 (Doc Tree)**: 将列表项同步到独立文档
- **标题树 (Heading Tree)**: 将列表项同步到同一文档下的标题
- **组合树 (Composite Tree)**: 同时执行上述两种操作

## 决策

### 1. 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Builder Engine                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │  Menu    │───▶│ ListProcessor│───▶│ IBlockProcessor │   │
│  │ (menu.ts)│    │ (builder.ts) │    │ (processor.ts)  │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│        │                  │                    │            │
│        ▼                  ▼                    ▼            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Auto-Update (auto-update.ts)            │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Transformation (transformation.ts)           │  │
│  │    旧属性 → 新属性转换 (index/create → tree/create)   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 块属性设计

| 属性名 | 说明 | 示例 |
|--------|------|------|
| `custom-tree-create` | Builder 配置 JSON | `{"treeType":"doc-tree","builderAutoUpdate":true}` |
| `custom-index-subdoc-id` | 关联的文档 ID | `20210817220122-abcdef` |
| `custom-index-heading-id` | 关联的标题块 ID | `20210817220123-abcdef` |
| `custom-item-id` | 关联的属性视图行 ID | `av-row-xxx` |

### 3. 列表项 Markdown 格式规范

Builder 采用严格的双链格式确保可靠解析：

```
[icon](siyuan://blocks/{docId}) ➖ {text}
```

- **icon**: 文档图标 (Emoji 或图片别名)
- **docId**: 目标文档块 ID
- **➖**: 分隔符 (避免与文本内容混淆)
- **text**: 列表项文本内容

### 4. 数据同步策略

#### 4.1 增量更新

```typescript
// 判断是否需要更新的条件
const needsUpdate = !docTarget  // 无目标文档
    || docTarget.content !== core.syncText  // 内容不一致
    || currentDocIcon !== desiredIcon  // 图标不一致
    || currentDocImg !== desiredImg  // 封面图不一致
```

#### 4.2 属性继承

数据库属性可继承到生成的文档：

```typescript
// 支持继承的字段
const systemNames = ["icon", "title-img", "template"];
```

- **icon**: 文档图标
- **title-img**: 文档封面图
- **template**: 文档模板路径

#### 4.3 防抖机制

复合树模式使用 100ms 延迟避免竞态条件：

```typescript
if (treeType === "composite-tree") {
    await processor.processRecursive(blockId, typeStr, "PUSH_TO_BOTTOM");
    await new Promise(resolve => setTimeout(resolve, 100));
    await processor.processRecursive(block.id, typeStr, "PUSH_TO_DOC");
}
```

### 5. 错误处理

- 错误收集在 `IBlockProcessor.errors` 数组中
- 同步完成后显示部分成功/完全成功消息
- 详细错误信息输出到控制台

## 后果

### 正面

- 支持三种构建类型满足不同场景
- 增量更新减少不必要的 API 调用
- 属性继承实现数据库驱动的内容管理
- 与属性视图 (AV) 深度集成

### 需注意

- 列表项格式必须严格遵守规范
- 属性视图关联依赖 `custom-item-id` 字段
- 大量项目同步时需考虑性能

### 6. 使用方法

#### 6.1 基本使用流程

Builder 构造器通过块菜单触发，支持两种构建模式：

**方式一：通过块菜单**

1. 在思源笔记中创建一个列表块 (List)
2. 选中列表（确保是顶层列表，不是嵌入在文档中的列表）
3. 右键点击，弹出块菜单
4. 选择以下选项之一：
   - **📄 构建文档树**: 将列表项同步到独立文档
   - **⬇️ 构建标题树**: 将列表项同步到标题块
   - **🔄 组合构建**: 同时执行上述两种操作（可选）

**方式二：通过属性视图 (AV)**（高级用法）

如果你使用属性视图来管理数据，可以：
1. 在属性视图中添加 `template` 列指定模板
2. 使用 `icon` 列指定文档图标
3. 使用 `title-img` 列指定文档封面
4. 配置自动同步后，列表项会自动保持与文档的同步

#### 6.2 配置自动更新

在列表块属性中添加 `custom-tree-create`:

```json
{
  "treeType": "doc-tree",
  "builderAutoUpdate": true
}
```

- `treeType`: 构建类型 (`doc-tree`, `heading-tree`, `composite-tree`)
- `builderAutoUpdate`: 是否启用自动更新

#### 6.3 代码调用

```typescript
import { ListProcessor, ACTION_PUSH_TO_DOC } from "./features/builder/processor";

// 创建处理器
const processor = new ListProcessor();

// 执行构建
await processor.processRecursive(blockId, "NodeList", ACTION_PUSH_TO_DOC);

// 检查错误
if (processor.errors.length > 0) {
    console.error("构建失败:", processor.errors);
}
```

## 相关文件

- `src/features/builder/builder.ts` - 主处理器
- `src/features/builder/processor.ts` - 块处理器
- `src/features/builder/menu.ts` - 菜单入口
- `src/features/builder/auto-update.ts` - 自动更新
- `src/features/builder/transformation.ts` - 属性转换
- `src/shared/render/reverse-build.ts` - Markdown 生成
