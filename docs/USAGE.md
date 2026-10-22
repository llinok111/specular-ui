# 使用文档

## 目录

1. [安装](#1-安装)
2. [初始化](#2-初始化)
3. [组件 API](#3-组件-api)
4. [主题变量](#4-主题变量)
5. [环境与密度](#5-环境与密度)
6. [光照系统](#6-光照系统)
7. [性能与降级](#7-性能与降级)
8. [移动端](#8-移动端)
9. [无障碍](#9-无障碍)
10. [自定义材质](#10-自定义材质)
11. [常见问题](#11-常见问题)

---

## 1. 安装

### 直接引入（推荐）

```html
<link rel="stylesheet" href="specular-ui.css">
<script type="module" src="specular-ui.js"></script>
```

两个文件，无需构建。从 `dist/` 或 release ZIP 中取。

### 从源码构建

```bash
git clone https://github.com/llinok111/specular-ui.git
cd specular-ui
npm install
npm run build      # → dist/ 与 demo/
```

构建产物：

| 文件 | 用途 |
|---|---|
| `dist/specular-ui.js` | ESM 入口，自动初始化 |
| `dist/specular-ui.cjs` | CommonJS 入口（压缩） |
| `dist/specular-ui.css` | 全部样式，含 token |
| `dist/specular-ui.js.map` | 源码映射 |

### npm

```bash
npm i specular-ui
```

```js
import "specular-ui";          // 注册组件并自动初始化
import "specular-ui/css";
```

---

## 2. 初始化

模块导入时会自动探测能力、设置降级档位、接管光照。不需要手动调用任何初始化函数。

### 关闭自动初始化

如果需要在框架挂载完成后再启动：

```html
<html data-sp-auto="false">
```

```js
import { init } from "specular-ui";

const result = init({
  tier: 0,          // 强制档位，跳过探测
  tilt: false,      // 是否尝试启用设备倾斜
  governor: true,   // 是否允许帧率不达标时降一档
});

console.log(result.tier, result.tierLabel, result.reasons);
```

`init()` 返回：

| 字段 | 说明 |
|---|---|
| `tier` | 实际生效的档位（0–3） |
| `tierLabel` | `full` / `balanced` / `lite` / `static` |
| `reasons` | 判定依据，例如 `["coarse pointer", "deviceMemory 4GB"]` |
| `capabilities` | 完整能力探测记录 |

### 诊断

```js
import { diagnostics } from "specular-ui";
console.table(diagnostics());
```

返回当前档位、滤镜缓存命中情况、光源向量、元素数量。

---

## 3. 组件 API

### `<sp-button>`

```html
<sp-button material="liquid" variant="primary" size="lg">开始</sp-button>
```

| 属性 | 值 | 默认 | 说明 |
|---|---|---|---|
| `material` | `liquid` `metal` `frost` `holo` | `liquid` | 表面材质 |
| `variant` | `primary` `outline` `ghost` `danger` | — | 语义变体，覆盖材质底色 |
| `size` | `sm` `md` `lg` `xl` | `md` | 尺寸 |
| `disabled` | 布尔 | — | 转发到内部 `<button disabled>` |
| `loading` | 布尔 | — | 内容淡出、显示旋转指示、`aria-busy="true"` |
| `type` | `button` `submit` `reset` | `button` | 转发到内部按钮 |
| `form` | 表单 id | — | 转发到内部按钮 |
| `label` | 字符串 | — | 纯图标按钮的无障碍名称 |

内部结构是一个真实的 `<button>`，因此在 `<form>` 内会正常触发提交，`Enter` / `Space` / 焦点顺序全部由平台提供。

```html
<form action="/save" method="post">
  <sp-button type="submit" material="metal">保存</sp-button>
</form>
```

> **注意**：不要在已挂载的组件上写 `textContent`，那会替换掉整个内部结构。要改文案，请在插槽里放一个元素再改它：
> ```html
> <sp-button><span id="label">开始</span></sp-button>
> <script>document.getElementById("label").textContent = "提交中";</script>
> ```

### `<sp-card>`

```html
<sp-card material="frost" eyebrow="MATERIAL" heading="磨砂玻璃" interactive>
  <p>正文内容。</p>
  <div data-slot="footer">
    <sp-button size="sm">查看</sp-button>
  </div>
</sp-card>
```

| 属性 | 说明 |
|---|---|
| `material` | 同 button |
| `eyebrow` | 小号全大写标签，为空时整行隐藏 |
| `heading` | 卡片标题 |
| `interactive` | 加 `role="button"` + `tabindex="0"`，`Enter`/`Space` 触发 `click` |

`data-slot="footer"` 的包裹元素会被拆开，其子节点移入底部区域（带分隔线）。

### `<sp-panel>`

```html
<sp-panel material="liquid" heading="折射原理">
  <p>正文。</p>
</sp-panel>
```

| 属性 | 说明 |
|---|---|
| `heading` | 标题 |
| `collapsed` | `true` 时折叠 |
| `collapsible` | `false` 时点击标题不折叠（纯容器） |

标题是真实的 `<button>`，带 `aria-expanded` 与 `aria-controls`。折叠状态变化时派发 `panel-toggle` 事件：

```js
panel.addEventListener("panel-toggle", (e) => {
  console.log(e.detail.collapsed);
});
```

### `<sp-navbar>`

```html
<sp-navbar brand="Specular" material="frost" compact="hide-actions">
  <a class="sp-nav-link" href="#materials" aria-current="page">材质</a>
  <a class="sp-nav-link" href="#components">组件</a>
  <div data-slot="actions">
    <sp-button size="sm">登录</sp-button>
  </div>
</sp-navbar>
```

| 属性 | 说明 |
|---|---|
| `brand` | 品牌文字 |
| `mark` | `false` 时隐藏左侧色标 |
| `compact` | `hide-actions` 时窄屏隐藏右侧操作区 |

滚动超过 8px 时宿主自动加上 `data-scrolled="true"`，可用于加深阴影。这个状态是属性，不是内联样式，所以你可以自己接管：

```css
sp-navbar[data-scrolled="true"] .sp-surface { --sp-frost-blur: 32px; }
```

### `<sp-tabs>`

```html
<sp-tabs material="frost" value="材质">
  <div data-tab="材质">面板一</div>
  <div data-tab="组件">面板二</div>
  <div data-tab="降级">面板三</div>
</sp-tabs>
```

子元素带 `data-tab` 即为一块面板，`data-tab` 的值就是标签文字。组件负责生成 `role="tablist"` / `role="tab"` / `role="tabpanel"` 以及 `aria-selected`、`aria-controls`、`aria-labelledby`。

| 属性 / 成员 | 说明 |
|---|---|
| `value` | 当前标签文字；读写，写会切换面板 |
| `tab-count`（只读 getter） | — |
| 事件 `tab-change` | `detail: { value, index }` |

键盘：`←` / `→` 循环切换，`Home` / `End` 跳到首尾。**roving tabindex**：只有当前标签是 `tabIndex=0`，其余为 `-1`，所以 Tab 键会跳过整组标签而不是逐个走。

选中指示是一块滑动的底板（`.sp-tab-indicator`），不是每个标签各涂一层背景 —— 一个合成层，而且它能带上材质自己的斜向高光。

### `<sp-input>`

```html
<sp-input material="frost" label="邮箱" type="email" placeholder="you@example.com"></sp-input>
```

| 属性 | 说明 |
|---|---|
| `label` | 可见标签文字，同时作为 `<label for>` 的可访问名称 |
| `type` / `placeholder` / `name` | 转发到内部 `<input>` |
| `value` | 读写；写入会标记为已触碰，后续不再被属性覆盖 |
| `readonly` / `disabled` | 转发到内部输入框 |

内部是 `<label class="sp-field">` 包着真正的 `<input>`，所以点击标签文字会聚焦输入框，密码管理器和自动填充也认得它。

> 焦点在这里被表达两次：边框按光源方向发亮（与其它表面同一套语言），外加 `outline` 焦点环（给看不出色相变化的用户）。

### `<sp-switch>`

```html
<sp-switch material="metal" label="自动漂移" checked></sp-switch>
```

| 属性 / 成员 | 说明 |
|---|---|
| `checked` | 布尔，可读写 |
| `label` | 右侧文字 |
| `disabled` | 禁用 |
| 事件 `switch-change` | `detail: { checked }` |

内部是 `<button role="switch" aria-checked>`，不是伪装成开关的复选框。`Space` 和 `Enter` 都能切换 —— 这是原生按钮的契约，不需要额外代码。

### `<sp-dialog>`

```html
<sp-dialog material="liquid" heading="放弃更改？">
  <p>未保存的内容会丢失。</p>
  <div data-slot="actions">
    <sp-button variant="ghost" data-close>取消</sp-button>
    <sp-button variant="danger" data-confirm>放弃</sp-button>
  </div>
</sp-dialog>
```

```js
dialog.show();
dialog.close();
dialog.open;   // 只读
```

| 属性 / 成员 | 说明 |
|---|---|
| `heading` | 标题，同时作为 `aria-labelledby` |
| `open` | 与原生 `dialog.open` 双向同步 |
| `show()` / `close()` | 调用原生 `showModal()` / `close()` |
| `data-close` | 带此属性的子元素点击后关闭 |
| `data-confirm` | 带此属性的子元素点击后派发 `dialog-confirm` 再关闭 |
| 事件 | `dialog-close` / `dialog-confirm` |

用原生 `<dialog>` 而不是自绘遮罩：焦点困在内部、`Esc` 关闭、背景自动 `inert`、进入 top layer，全部由平台提供。材质加在对话框**内部**，因为带滤镜的元素一旦进入 top layer 会自己成为包含块，背景就看不到了。

`::backdrop` 也做了处理：半透明压暗 + `backdrop-filter` 模糊，档位切换时一起降级。

---

## 4. 主题变量

全部变量以 `--sp-` 开头，定义在 `:root`。覆盖任何一个即可。

### 光源

| 变量 | 范围 | 说明 |
|---|---|---|
| `--sp-lx` `--sp-ly` | 0–1 | 光源在视口中的归一化位置（JS 写入） |
| `--sp-lx-signed` `--sp-ly-signed` | -1–1 | 同上，居中化 |
| `--sp-angle` | 角度 | 方位角，`conic-gradient(from ...)` 可直接用 |
| `--sp-mx` `--sp-my` | 0–1 | 指针在单个元素内的位置（JS 写入） |
| `--sp-light-power` | 数值 | 高光强度乘数，hover 时会临时抬高 |

### 几何

```css
--sp-radius-xs: 6px;   --sp-radius-sm: 10px;
--sp-radius-md: 16px;  --sp-radius-lg: 26px;
--sp-radius-xl: 38px;  --sp-radius-pill: 999px;
--sp-hairline: 1px;
```

### 材质旋钮

| 变量 | 默认 | 说明 |
|---|---|---|
| `--sp-frost-blur` | `18px` | 主体模糊半径 |
| `--sp-frost-saturate` | `165%` | 背景饱和度提升 |
| `--sp-aberration` | `0.55` | 色边强度（0 关闭） |
| `--sp-tint-strength` | `0.16` | 环境色浸染强度 |
| `--sp-noise-opacity` | `0.34` | 磨砂颗粒可见度 |
| `--sp-holo-saturation` | `85%` | 全息膜色谱饱和度 |
| `--sp-metal-brush` | `3px` | 拉丝纹理间距 |

### 整体覆盖示例

```css
/* 更冷、更薄、更锐利的玻璃 */
[data-material="liquid"] {
  --sp-frost-blur: 8px;
  --sp-tint-strength: 0.08;
  --sp-aberration: 0.3;
}

/* 单点微调：只让导航条更糊 */
sp-navbar { --sp-frost-blur: 30px; }
```

---

## 5. 环境与密度

```html
<html data-sp-ambience="dusk" data-sp-density="compact">
```

```js
import { setAmbience, AMBIENCES } from "specular-ui";
setAmbience("neon");
console.log(Object.keys(AMBIENCES)); // dusk, studio, neon, paper
```

| 环境 | 主光 | 适用 |
|---|---|---|
| `dusk` | 暖金 `#ffd9a0` | 内容为主、需要温度（默认） |
| `studio` | 冷白 `#dfe9ff` | 工具类界面、需要中性判断 |
| `neon` | 紫 `#c8b6ff` | 娱乐、夜间、强对比 |
| `paper` | 亮色纸本 | 文档、浅色场景 |

`data-sp-density="compact"` 会收紧间距与字号、缩小圆角，适合信息密集的仪表盘。

---

## 6. 光照系统

默认行为：指针移动即光源移动，静止 2.6 秒后开始缓慢漂移，让金属与全息膜保持"活着"。

```js
import { light } from "specular-ui";

light.set(0.2, 0.8);   // 手动定位（归一化视口坐标）
light.lock(true);      // 冻结，忽略指针
light.detach();        // 完全停止
light.attach();        // 恢复

await light.enableTilt(); // 手机倾斜控制（iOS 需用户手势触发）
```

### 局部高光

任何带 `data-sp-lobe` 属性的元素都会获得指针在其内部的位置（`--sp-mx` / `--sp-my`），用来驱动跟随光斑。组件已自动带上这个属性；自定义元素自己加：

```html
<div data-sp-lobe class="my-panel">…</div>
```

```css
.my-panel::after {
  background: radial-gradient(120% 90% at var(--sp-mx) var(--sp-my), #fff3 0%, transparent 60%);
}
```

### 关闭漂移

```css
:root { --sp-tier-anim: 0; }
```

或尊重系统设置 —— `prefers-reduced-motion: reduce` 时库会自动停止漂移。

---

## 7. 性能与降级

### 自动判定

启动时读取：`backdrop-filter` 支持、SVG 滤镜支持、`conic-gradient`、`color-mix`、`deviceMemory`、`hardwareConcurrency`、指针类型、视口宽度、`prefers-reduced-transparency`、`saveData`。

判定结果写在 `<html data-sp-tier="0..3">`，CSS 据此切换整组 token。

### 手动切换

```js
import { setTier, TIER } from "specular-ui";
setTier(TIER.LITE);   // 2
```

### 每一档放弃什么

| 档位 | 背景模糊 | 边缘折射层 | 噪点 | 色相漂移 | 色边 |
|---|---|---|---|---|---|
| 0 full | 100% | 有 | 有 | 有 | 100% |
| 1 balanced | 75% | 有 | 无 | 无 | 50% |
| 2 lite | 100%（更小半径） | 无 | 无 | 无 | 0 |
| 3 static | 无 | 无 | 无 | 无 | 0 |

### 帧率治理

首次运行采样两个 500ms 窗口，中位帧率低于 45fps 时降一档，**只降一次**，不回升。降低意味着初始探测低估了页面其他部分的成本。

```js
init({ governor: false });   // 关闭
```

```html
<html data-sp-governor="off">
```

### 真实成本参考

见 [PERF.md](./PERF.md)。关键数字：42 个表面冷启动约 200ms（仅当启用可选折射时），缓存后每轮 0.4–1.5ms；光源更新 40 次相同请求只写 1 次根变量。

---

## 8. 移动端

无需额外配置，以下规则已内置：

- `@media (pointer: coarse)`：所有交互元素最小 44×44，内边距加大，跟随光斑固定不动。
- `@media (max-width: 720px)`：导航条收起品牌文字，操作区可选隐藏，链接区横向滚动。
- `@media (max-width: 560px)`：卡片与面板内边距收紧，超大按钮降一档字号。
- `prefers-reduced-transparency`：直接跳到 light 档，表面变为高不透明度。

### 倾斜控制

iOS 13+ 需要用户手势才能授权，所以不会自动启用：

```js
button.addEventListener("click", async () => {
  const ok = await light.enableTilt();
  if (!ok) button.textContent = "此设备不支持";
});
```

---

## 9. 无障碍

- 每个组件内部都是语义正确的原生元素（`button` / `nav`），不是 `div` 加 `role`。
- 焦点环用 `outline`，`outline-offset: 3px`，在深色背景上仍然可见。
- `disabled` 同时设置 `aria-disabled`，`loading` 设置 `aria-busy`。
- 面板标题带 `aria-expanded` / `aria-controls`。
- `prefers-contrast: more` 时发丝边加粗到 1.5px、对比度提高。
- `prefers-reduced-motion: reduce` 时所有过渡时长归零、色相停止漂移。

### 检查清单

```js
// 所有可交互元素是否都有可访问名称
[...document.querySelectorAll("button, a[href]")]
  .filter((el) => !(el.getAttribute("aria-label") || el.textContent).trim());
```

---

## 10. 自定义材质

材质是"决策"不是"旋钮"，所以没有开放注册接口 —— 但你可以用公开变量组合出新表面，并把 `material` 设为任意值（未知值会安全回退到 `liquid`）。

```html
<sp-card material="my-satin">
  <div class="swatch"></div>
</sp-card>
```

```css
[data-material="my-satin"] .sp-surface {
  backdrop-filter: blur(6px) saturate(120%);
  background: linear-gradient(
    100deg,
    color-mix(in oklab, var(--sp-ambient-key) 22%, transparent),
    transparent 40%,
    color-mix(in oklab, var(--sp-ambient-fill) 26%, transparent)
  );
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--sp-ambient-key) 40%, transparent);
}

/* 复用共享光源 */
[data-material="my-satin"] .sp-aniso {
  background: conic-gradient(from var(--sp-angle), #fff2, transparent 30%, #0003 60%, #fff1);
  mix-blend-mode: overlay;
}
```

要让新材质跟随降级，把强度乘以对应 token：

```css
opacity: calc(0.8 * var(--sp-tier-blur));
```

---

## 11. 常见问题

**Q：为什么玻璃看起来没有"折射/扭曲"？**
浏览器不会把 `backdrop-filter` 的结果送进 `filter: url(#…)`，所以基于 SVG 位移贴图的几何折射对玻璃表面无效。本库默认用"边缘梯度模糊 + 色散"营造厚度感；可选的 SVG 折射层能正常工作但只对自绘内容的元素有意义。详见 [LIMITS.md](./LIMITS.md)。

**Q：能在 React / Vue 里用吗？**
能。自定义元素与框架无关：

```jsx
export default () => (
  <sp-button material="liquid" onClick={handle}>开始</sp-button>
);
```

React 19 以下对自定义元素属性支持有限，复杂属性可用 `ref` 设置。事件用原生监听：

```js
useEffect(() => {
  const el = ref.current;
  el.addEventListener("click", handler);
  return () => el.removeEventListener("click", handler);
}, []);
```

**Q：SSR 会报错吗？**
不会。所有 DOM 访问都在 `typeof document !== "undefined"` 之后，`RefractionAtlas` 在无 DOM 环境直接返回 `null`。

**Q：为什么我的自定义元素没有被渲染？**
检查顺序：`<script type="module">` 是延迟执行的，元素在注册前已经存在于 DOM 中，注册时会自动升级，不需要手动刷新。

**Q：性能开销主要在哪？**
逐层排序：第二层边缘模糊 > 主体背景模糊 > 噪点 > 全息色相动画。如果只想要玻璃观感不想付费，直接用 `lite` 档。

**Q：可以只引入 CSS，不要 JS 吗？**
可以，但需要自己写组件结构（`.sp-el` / `.sp-surface` / `.sp-sheen` / `.sp-edge` / `.sp-content` 五层），并且光源变量要自己写。
