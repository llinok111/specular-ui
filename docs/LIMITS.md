# 已知限制

这份文档记录的是**实测结论**，不是推测。每一条都指出了问题、证据，以及本库的应对。

---

## 1. `filter` 不处理 `backdrop-filter` 的结果

### 现象

把 SVG `feDisplacementMap` 滤镜挂在带 `backdrop-filter` 的元素上，玻璃背后的内容**完全不动**，元素自身的半透明层也看不出位移。

### 证据

`test/optical.test.mjs` 与下列对照实验（Chrome 152，同时用 `CSS.supports` 与计算样式确认滤镜已挂载）：

| 条件 | 结果 |
|---|---|
| `filter: grayscale(1)` | 像素改变（39,39,38… vs 10,10,10…）→ 滤镜机制本身正常 |
| `filter: url(#feDisplacementMap)` | 像素**完全不变**（95,95,95… 与基线逐字节相同） |
| 位移贴图换成合成 SVG 渐变、`scale` 提到 120 | 仍然完全不变 |

排除项（均已逐一测过，均不影响结果）：

- 贴图编码：PNG data URL 与内联 SVG 结果一致
- 滤镜区域：`x/y/width/height` 从 `-25%` 到 `200%` 都试过
- 合成层：移除 `transform: translateZ(0)`、`will-change`、`isolation`
- 模糊半径：`blur(0.01px)` 与 `blur(18px)` 结果一致

### 原因

`backdrop-filter` 的结果是元素的**背景绘制**，而 `filter` 处理的是元素**自身绘制内容**。两者在同一条渲染管线上但不相接 —— 这是实现选择，不是浏览器 bug，也不是可以绕过的写法问题。

直到 Chrome 152 / Safari 18 为止仍然如此。

### 影响

基于位移贴图的"几何折射"（把背景像素真正弯折）对玻璃类表面**不可用**。上游 `liquid-glass-react` 的 demo 能呈现边缘弯曲，主要来自它同时叠加的色散、内阴影与高光层，而非 `feDisplacementMap` 本身。

### 应对

1. **默认路径改为 CSS 合成。** 液态玻璃用"边缘梯度模糊 + 色散发丝边 + 定向高光"营造厚度：
   - 主体：`backdrop-filter: blur(13px) saturate(165%)`
   - 边缘：第二层 `backdrop-filter: blur(34px)` 加径向遮罩，让靠近边框的部分更失焦
   - 色散：沿光源轴分离的暖/冷内阴影（红折射少、蓝折射多）
2. **SVG 折射层保留但默认关闭**，通过 `setRefraction(true)` 显式启用。它对"自绘内容的元素"仍然有效，也是未来引擎若修复该组合时的现成实现。位移贴图生成器（`src/core/sdf.js`、`src/core/displacement.js`）完整保留，含 33 项单测。

```js
import { setRefraction } from "specular-ui";
setRefraction(true);   // 仅在你确知目标引擎支持时打开
```

---

## 2. `isolation: isolate` 会切断背景取样

### 现象

组件一旦给宿主加 `isolation: isolate`，`backdrop-filter` 完全失效 —— 表面看起来是半透明纯色，背后的条纹清晰可见。

### 证据

同一元素、同一 `backdrop-filter: blur(18px)`：

| 条件 | 元素内 8px 周期条纹的像素 |
|---|---|
| 有 `isolation: isolate` | `10,10,243,244,10,10,…`（锐利，未被模糊） |
| 无 | `95,95,95,95,…`（模糊后均匀） |

### 原因

`isolation: isolate` 创建层叠上下文，`backdrop-filter` 的取样范围被限制在该上下文内。组件内部没有背景，于是"模糊"作用在空气上。

### 应对

本库**不使用** `isolation: isolate`，改用 `position: relative` + `z-index` 管理层序。如果你在包装层上加了隔离（例如为了 `mix-blend-mode`），玻璃会静默失效。

---

## 3. 玻璃的表面必须真的压在有内容的背景上

`backdrop-filter` 采样的是元素**背后已经绘制的内容**。以下情况玻璃会看起来"只是一个半透明色块"：

- 父级有 `opacity < 1`（整组被压平后再采样，结果为空白）
- 背后是纯色（没有可模糊的结构，模糊等于没模糊）
- 元素本身 `background` 不透明（挡住了背后的采样源）

调试方法：把 `--sp-tint-strength` 设为 `0`，如果表面变得几乎看不见，说明背景取样正常；如果仍然是实心块，检查上表。

---

## 4. `feImage` 的几何单位是元素用户空间

写 SVG 滤镜时容易踩：`feImage` 的 `x/y/width/height` 百分比相对**元素用户空间**，不是 `<filter>` 的 `x/y/width/height`。

早期版本按滤镜区域换算（`16.6667%` 与 `66.6667%`），结果位移贴图被缩小到 2/3 并向内偏移四分之一宽 —— 表现是"滤镜生效但什么都看不出来"。

正确写法：

```xml
<filter id="f" x="-25%" y="-25%" width="150%" height="150%">
  <feImage href="…" x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none"/>
</filter>
```

---

## 5. SVG 滤镜内部的 alpha 是预乘的

三通道色散（把 R/G/B 分别按不同 `scale` 位移再 `screen` 混合）会在圆角处把表面压暗到约 0.7 倍：

- 把通道副本的 alpha 强制设为 1 → 由于内部是预乘 alpha，颜色被按原 alpha 乘过一次，无法反算
- 保留原 alpha → `screen` 叠加三次使 alpha 累积，边缘变亮

两种都不对。**本库因此把色散改到 CSS 层实现**（沿光源轴分离的暖/冷内阴影），代价更低且不污染 alpha。

---

## 6. 全息膜的色相动画依赖 `@property`

`@property --sp-holo-hue` 让色相成为可插值的角度，从而连续旋转。不支持的浏览器（旧版 Firefox）会退化为静态色谱 —— 仍然可用，只是不流动。

检测方式：

```js
CSS.registerProperty && CSS.supports("background", "conic-gradient(from 0deg, red, blue)");
```

不满足时自动落到 `balanced` 档，关闭漂移。

---

## 7. 颜色函数依赖 `color-mix` 与 `oklab`

材质层大量使用 `color-mix(in oklab, …)` 从环境色派生阴影、色边、拉丝高光。这保证了一套环境变量能覆盖所有材质，但也意味着：

| 浏览器 | 状态 |
|---|---|
| Chrome 111+ | 完整 |
| Safari 16.2+ | 完整 |
| Firefox 113+ | 完整 |
| 更早版本 | 落到 `balanced` 档，部分派生色失效（退化为透明，不会变黑） |

---

## 8. 光线控制的边界

- `deviceorientation` 在 iOS 需要用户手势授权，因此**永不自动启用**。
- `light.set()` 写的是根元素变量，所有表面共享。要单个元素偏离光源，请覆盖该元素的 `--sp-angle`。
- 指针事件合并到每帧一次，位移小于 `0.0015` 时跳过写入；40 次相同请求只产生 1 次写入（已测）。

---

## 9. 未做的部分

诚实列出，避免误解：

- **没有 WebGL/WebGPU 路径。** 真正的几何折射需要读取背景纹理，那需要 canvas 与 DOM 叠合，会破坏组件的文档流语义。这是有意不做的取舍。
- **没有 React/Vue 封装。** 自定义元素本身可用，封装层会引入版本耦合。
- **没有暗色/亮色自动切换。** 环境由 `data-sp-ambience` 显式指定；跟随系统需要自己监听 `prefers-color-scheme` 并调用 `setAmbience`。
- **没有为 Safari 单独优化。** `-webkit-backdrop-filter` 已加前缀，但 Safari 在多层 backdrop-filter 叠加时的性能未做基准测试。
