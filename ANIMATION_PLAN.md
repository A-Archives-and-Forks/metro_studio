# 🚀 RailMap 过渡动画实施计划

## 📊 项目概况

### 当前动画现状
- ✅ 已实现：Toast、Dialog、DropdownMenu、Tooltip 的部分动画
- ❌ 缺少：视图切换、右键菜单、选择框、工具栏、Tab、面板等动画

### 技术栈选择
- **动画库**：AutoAnimate (@formkit/auto-animate)
  - 零配置，一行代码实现动画
  - 体积小（~3KB）
  - Vue 3 原生支持
  - 13.7k stars，成熟稳定

### 动画配置
- **速度**：120ms（快速轻量）
- **缓动**：`cubic-bezier(0.16,1,0.3,1)`（iOS/Mac 风格）
- **开关**：支持用户控制动画开关

---

## 📋 实施任务清单

### Phase 0 - 基础设施（5分钟）

#### 任务 1：安装依赖
```bash
npm install @formkit/auto-animate
```

#### 任务 2：创建动画配置文件
**新建** `src/lib/animation/config.js`
```javascript
export const ANIMATION_CONFIG = {
  enabled: true,
  duration: {
    fast: 120,
    normal: 200,
    slow: 300,
  },
  easing: 'cubic-bezier(0.16,1,0.3,1)',
  storageKey: 'railmap_animations_enabled',
}
```

#### 任务 3：创建动画设置 composable
**新建** `src/composables/useAnimationSettings.js`
```javascript
import { ref } from 'vue'
import { ANIMATION_CONFIG } from '../lib/animation/config.js'

export function useAnimationSettings() {
  const enabled = ref(true)

  function loadSettings() {
    try {
      const saved = localStorage.getItem(ANIMATION_CONFIG.storageKey)
      if (saved !== null) enabled.value = saved === 'true'
    } catch { }
  }

  function toggleAnimation(value) {
    enabled.value = value ?? !enabled.value
    try {
      localStorage.setItem(ANIMATION_CONFIG.storageKey, enabled.value)
    } catch { }
  }

  function getAutoAnimateConfig() {
    if (!enabled.value) return { duration: 0 }
    return {
      duration: ANIMATION_CONFIG.duration.fast,
      easing: ANIMATION_CONFIG.easing,
    }
  }

  loadSettings()
  return { enabled, toggleAnimation, getAutoAnimateConfig }
}
```

#### 任务 4：创建进度条组件
**新建** `src/components/ProgressBar.vue`
```vue
<script setup>
defineProps({ visible: Boolean, progress: { type: Number, default: 0 } })
</script>

<template>
  <Transition name="progress-fade">
    <div v-if="visible" class="progress-bar">
      <div class="progress-bar__track">
        <div class="progress-bar__fill" :style="{ width: `${progress}%` }" />
      </div>
    </div>
    <span class="progress-bar__label">{{ progress }}%</span>
  </div>
  </Transition>
</template>

<style scoped>
.progress-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.progress-bar__track { flex: 1; height: 4px; background: var(--toolbar-divider); border-radius: 2px; overflow: hidden; }
.progress-bar__fill { height: 100%; background: var(--toolbar-primary-bg); border-radius: 2px; transition: width 0.3s ease; }
.progress-bar__label { font-size: 11px; color: var(--toolbar-muted); min-width: 36px; text-align: right; }

.progress-fade-enter-active, .progress-fade-leave-active { transition: all 0.12s ease; }
.progress-fade-enter-from, .progress-fade-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
```

---

### Phase 1 - 高优先级动画（20分钟）

#### 任务 5：视图切换动画
**修改** `src/App.vue`

**步骤**：
1. 导入 AutoAnimate 和动画设置
2. 为 canvas 容器添加 `ref="canvasContainer"`
3. 应用 AutoAnimate
4. 添加进度条组件
5. 在视图切换时显示进度条

**代码改动**：
```javascript
import { useAutoAnimate } from '@formkit/auto-animate/vue'
import { useAnimationSettings } from './composables/useAnimationSettings.js'
import ProgressBar from './components/ProgressBar.vue'

const canvasContainer = ref(null)
const { enabled } = useAnimationSettings()
const viewChanging = ref(false)
const viewChangeProgress = ref(0)

const [parent] = useAutoAnimate(canvasContainer, {
  duration: enabled.value ? 120 : 0,
  easing: 'cubic-bezier(0.16,1,0.3,1)',
})

async function handleViewChange(newView) {
  viewChanging.value = true
  viewChangeProgress.value = 0

  const progressInterval = setInterval(() => {
    if (viewChangeProgress.value < 90) {
      viewChangeProgress.value += 30
    }
  }, 50)

  setActiveView(newView)

  await nextTick()

  clearInterval(progressInterval)
  viewChangeProgress.value = 100
  setTimeout(() => {
    viewChanging.value = false
    viewChangeProgress.value = 0
  }, 200)
}
```

#### 任务 6：右键菜单动画
**修改** `src/components/MapEditor.vue`

**步骤**：
1. 导入 AutoAnimate
2. 为三个菜单 ref 添加 AutoAnimate
3. 配置动画参数

**代码改动**：
```javascript
import { useAutoAnimate } from '@formkit/auto-animate/vue'

const contextMenuRef = ref(null)
const aiStationMenuRef = ref(null)
const lineSelectionMenuRef = ref(null)

useAutoAnimate(contextMenuRef, { duration: 120, easing: 'cubic-bezier(0.16,1,0.3,1)' })
useAutoAnimate(aiStationMenuRef, { duration: 120, easing: 'cubic-bezier(0.16,1,0.3,1)' })
useAutoAnimate(lineSelectionMenuRef, { duration: 120, easing: 'cubic-bezier(0.16,1,0.3,1)' })
```

#### 任务 7：选择框动画
**修改** `src/components/MapEditor.vue` 的样式部分

**CSS 改动**：
```css
.map-editor__selection-box {
  border: 1px solid #0ea5e9;
  background: rgba(14, 165, 233, 0.14);
  pointer-events: none;
  z-index: 10;
  animation: selection-appear 120ms cubic-bezier(0.16,1,0.3,1) forwards;
}

@keyframes selection-appear {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

---

### Phase 2 - 中优先级动画（20分钟）

#### 任务 8：工具栏折叠动画
**修改** `src/components/ToolbarControls.vue`

**步骤**：
1. 导入 AutoAnimate
2. 为内容区域添加 ref
3. 应用 AutoAnimate

**代码改动**：
```javascript
import { useAutoAnimate } from '@formkit/auto-animate/vue'

const toolbarContent = ref(null)
const { enabled } = useAnimationSettings()

useAutoAnimate(toolbarContent, {
  duration: enabled.value ? 120 : 0,
  easing: 'cubic-bezier(0.16,1,0.3,1)',
})
```

**模板改动**：
```vue
<div ref="toolbarContent" class="toolbar__content">
  <component :is="activeTabComponent" />
</div>
```

#### 任务 9：Tab 切换动画
**修改** `src/components/ToolbarControls.vue` 的样式部分

**CSS 改动**：
```css
.toolbar__tab {
  position: relative;
  transition: all 120ms cubic-bezier(0.16,1,0.3,1);
}

.toolbar__tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--indicator-color, var(--toolbar-primary-bg));
  transform: scaleX(0);
  transition: transform 120ms cubic-bezier(0.16,1,0.3,1);
}

.toolbar__tab--active::after {
  transform: scaleX(1);
}
```

#### 任务 10：面板切换动画
**修改** `src/components/PropertiesPanel.vue`

**步骤**：
1. 导入 AutoAnimate 和动画设置
2. 为面板 body 添加 ref
3. 应用 AutoAnimate

**代码改动**：
```javascript
import { useAutoAnimate } from '@formkit/auto-animate/vue'
import { useAnimationSettings } from '../composables/useAnimationSettings.js'

const panelBody = ref(null)
const { enabled } = useAnimationSettings()

useAutoAnimate(panelBody, {
  duration: enabled.value ? 120 : 0,
  easing: 'cubic-bezier(0.16,1,0.3,1)',
})
```

**模板改动**：
```vue
<div ref="panelBody" class="properties-panel__body">
  <component :is="activePanelComponent" />
</div>
```

---

### Phase 3 - 设置菜单集成（10分钟）

#### 任务 11：添加设置菜单项
**修改** `src/composables/useMenuBarActions.js`

**步骤**：
1. 创建 `settingsMenuItems` computed
2. 添加到 `menus` 数组
3. 在 `handleAction` 中处理 `toggleAnimations`

**代码改动**：
```javascript
const settingsMenuItems = computed(() => [
  { type: 'toggle', label: '启用动画', checked: store.animationsEnabled, action: 'toggleAnimations' },
])

const menus = computed(() => [
  { key: 'file', label: '文件', items: fileMenuItems.value },
  { key: 'edit', label: '编辑', items: editMenuItems.value },
  { key: 'view', label: '视图', items: viewMenuItems.value },
  { key: 'ai', label: 'AI', items: aiMenuItems.value },
  { key: 'export', label: '导出', items: exportMenuItems.value },
  { key: 'settings', label: '设置', items: settingsMenuItems.value },
])
```

#### 任务 12：Store 中添加动画状态
**修改** `src/stores/projectStore.js`

**步骤**：
1. 在 state 中添加 `animationsEnabled`
2. 添加 `toggleAnimations` mutation
3. 添加持久化逻辑

**代码改动**：
```javascript
state: {
  // ... 现有 state ...
  animationsEnabled: true,
},

mutations: {
  // ... 现有 mutations ...
  toggleAnimations(state) {
    state.animationsEnabled = !state.animationsEnabled
    try {
      localStorage.setItem('railmap_animations_enabled', state.animationsEnabled)
    } catch {
      // 忽略存储错误
    }
  },
},

getters: {
  // ... 现有 getters ...
}
```

#### 任务 13：初始化动画状态
**修改** `src/stores/projectStore.js`

**步骤**：
在 store 初始化时从 localStorage 读取动画设置

**代码改动**：
```javascript
state: {
  animationsEnabled: (() => {
    try {
      const saved = localStorage.getItem('railmap_animations_enabled')
      return saved === 'false' ? false : true
    } catch {
      return true
    }
  })(),
  // ... 其他 state ...
}
```

---

### Phase 4 - 测试与优化（5分钟）

#### 任务 14：功能测试
- [ ] AutoAnimate 安装成功
- [ ] 设置菜单显示「启用动画」选项
- [ ] 动画开关正常工作
- [ ] 视图切换有动画效果
- [ ] 进度条在视图切换时显示
- [ ] 右键菜单有淡入动画
- [ ] 选择框有出现动画
- [ ] 工具栏折叠有动画
- [ ] Tab 切换有动画
- [ ] 面板切换有动画
- [ ] 禁用动画后立即生效

#### 任务 15：性能测试
- [ ] 动画流畅（60fps）
- [ ] 无内存泄漏
- [ ] 快速切换视图无卡顿
- [ ] CSS transition 性能优化（will-change）

#### 任务 16：边界测试
- [ ] localStorage 读写正常
- [ ] 错误处理正常
- [ ] 动画关闭时立即切换
- [ ] 所有浏览器兼容性

---

## 📊 时间分配

| 阶段 | 任务数 | 预计时间 |
|-------|--------|----------|
| Phase 0 - 基础设施 | 4 | 5分钟 |
| Phase 1 - 高优先级动画 | 3 | 20分钟 |
| Phase 2 - 中优先级动画 | 3 | 20分钟 |
| Phase 3 - 设置菜单集成 | 3 | 10分钟 |
| Phase 4 - 测试与优化 | 3 | 5分钟 |
| **总计** | **16** | **60分钟** |

---

## 🎯 技术要点

### AutoAnimate 使用
```javascript
import { useAutoAnimate } from '@formkit/auto-animate/vue'

const containerRef = ref(null)

// 基础用法
const [parent] = useAutoAnimate(containerRef)

// 带配置
const [parent] = useAutoAnimate(containerRef, {
  duration: 120,
  easing: 'cubic-bezier(0.16,1,0.3,1)',
})
```

### 动画配置参数
- `duration`：动画时长（ms）
- `easing`：缓动函数
- `disrespectUserMotion`：是否忽略用户无障碍设置

### 禁用动画
```javascript
const [parent] = useAutoAnimate(containerRef, {
  duration: 0, // 设置为 0 禁用
})
```

### CSS 关键帧
```css
@keyframes selection-appear {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

---

## 📝 实施检查清单

### 开始前
- [ ] 确认 Node.js 版本
- [ ] 确认网络连接（npm 安装）
- [ ] 备份当前代码（可选）

### 实施中
- [ ] 按顺序执行各阶段任务
- [ ] 每个阶段完成后测试
- [ ] 遇到问题立即记录

### 完成后
- [ ] 运行所有测试用例
- [ ] 性能测试（Lighthouse）
- [ ] 跨浏览器测试
- [ ] 文档更新（README.md）

---

## 🔄 回滚方案

如果出现问题，按以下步骤回滚：

1. **依赖问题**：
   ```bash
   npm uninstall @formkit/auto-animate
   ```

2. **代码问题**：
   - 删除新建的文件
   - 恢复修改的文件（使用 git）
   - `git checkout -- <file>`

3. **Store 问题**：
   ```bash
   localStorage.removeItem('railmap_animations_enabled')
   ```

---

## 📚 参考资料

### AutoAnimate 文档
- 官网：https://auto-animate.formkit.com
- GitHub：https://github.com/formkit/auto-animate
- NPM：https://www.npmjs.com/package/@formkit/auto-animate

### Vue 3 动画
- Vue 官方文档：https://vuejs.org/guide/built-ins/transition.html
- VueUse：https://vueuse.org/

### CSS 缓动函数
- cubic-bezier 可视化：https://cubic-bezier.com/
- iOS 缓动：`cubic-bezier(0.16,1,0.3,1)`
- Material 缓动：`cubic-bezier(0.4,0,0.2,1)`

---

## ✅ 验收标准

### 功能性
- [ ] 所有动画按预期工作
- [ ] 动画开关正常
- [ ] 进度条正确显示
- [ ] 无控制台错误

### 性能
- [ ] 动画流畅（≥30fps）
- [ ] 无明显性能下降
- [ ] 内存使用正常

### 用户体验
- [ ] 动画速度适中
- [ ] 视觉效果一致
- [ ] 无动画时响应迅速

---

**计划版本**：v1.0
**创建日期**：2026-02-16
**预计完成时间**：1小时
**负责人**：AI Assistant
