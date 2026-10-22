# Specular UI

**一盏灯，四种材质。** 零依赖的 Web Components 材质组件库 —— 液态玻璃、拉丝金属、磨砂玻璃、全息膜，全部由同一个光源变量推导。

**One light, four materials.** A dependency-free Web Components library where every surface — liquid glass, brushed metal, ground glass, holographic film — derives its highlights from a single shared light vector.

<p align="center">
  <a href="https://llinok111.github.io/specular-ui/">在线演示</a> ·
  <a href="./docs/USAGE.md">使用文档</a> ·
  <a href="./docs/LIMITS.md">已知限制</a> ·
  <a href="./docs/PERF.md">实测数据</a>
</p>

---

## 为什么不是又一个玻璃拟态库

大多数材质库把每种效果当作独立配方：玻璃一套 `backdrop-filter`，金属一套渐变，磨砂一套噪点。把它们放在同一个页面里，每块表面的高光都指向不同方向 —— 页面读起来像拼贴，而不是一个场景。

Specular 只定义**一盏灯**：

```
--sp-lx / --sp-ly     光源在视口中的位置（0..1）
--sp-angle            由上面两项推导的方位角，CSS 直接可用
```

金属的各向异性带用 `conic-gradient(from var(--sp-angle))` 旋转；玻璃的色边沿光源轴向分离暖冷；磨砂的边缘亮线按 `--sp-lx-signed` 偏移；全息的色相绕 `--sp-angle` 旋转。**移动光源，整页作为一个物理场景一起响应**，而不是每块玻璃各自发光。

这套约定带来三个实际好处：

1. **一致性免费。** 新组件只要读同一组变量，就自动和现有界面同一个光源，不需要逐个调参。
2. **交互有物理动机。** 指针即光源，hover 时高光"扫过"表面是必然结果，不是额外写的动画。
3. **降级只需改 token。** 四档保真度是四组变量，组件不做分支判断。

## 四种材质

| 材质 | `material` | 光学构成 | 代价 |
|---|---|---|---|
| 液态玻璃 | `liquid` | 背景模糊 + 边缘梯度折射（第二层更重的模糊 + 径向遮罩）+ 色散发丝边 | 2 层 backdrop-filter |
| 拉丝金属 | `metal` | 各向异性锥形高光（随光源旋转）+ 拉丝纹理 + 双面亮边 | 0 层（不采样背景） |
| 磨砂玻璃 | `frost` | 重度模糊 + 分形噪声颗粒 + 浅色叠加 | 1 层 backdrop-filter |
| 全息膜 | `holo` | 深色基底 + 干涉色谱（`@property` 驱动的连续色相）+ 指针遮罩 | 1 层 backdrop-filter |

## 快速开始

```html
<link rel="stylesheet" href="dist/specular-ui.css">
<script type="module" src="dist/specular-ui.js"></script>

<sp-button material="liquid" variant="primary" size="lg">开始</sp-button>

<sp-card material="metal" eyebrow="CARD" heading="拉丝金属">
  <p>卡片正文</p>
  <div data-slot="footer">
    <sp-button size="sm">查看</sp-button>
  </div>
</sp-card>
```

四行 HTML 就能跑。没有构建步骤、没有 peer dependency、没有 CSS-in-JS 运行时。

## 组件

| 标签 | 内部真实元素 | 说明 |
|---|---|---|
| `<sp-button>` | `<button>` | `variant` / `size` / `disabled` / `loading` / `type` / `form` |
| `<sp-card>` | `<div role="group">` | `eyebrow` / `heading` / `interactive`（Enter、Space 可触发） |
| `<sp-panel>` | `<button aria-expanded>` + 区域 | `heading` / `collapsed` / `collapsible` |
| `<sp-navbar>` | `<nav>` | `brand` / `mark` / 滚动时自动提升 `data-scrolled` |

组件用 light DOM 而不是 Shadow DOM：主题变量正常继承，全局覆盖依然有效，`::part` 那套仪式完全不需要。

## 环境（ambience）

`data-sp-ambience` 不是换配色，是换**环境** —— 决定光由什么构成，因此决定反射长什么样。

| 值 | 描述 |
|---|---|
| `dusk` | 黄昏，暖金主光（默认） |
| `studio` | 冷调影棚，中性高光 |
| `neon` | 霓虹夜，紫青补光 |
| `paper` | 纸本亮色环境 |

```js
import { setAmbience } from "specular-ui";
setAmbience("studio");
```

## 降级

启动时探测一次能力，之后最多降一档（帧率采样），不会来回跳。

| 档位 | `data-sp-tier` | 保留 |
|---|---|---|
| full | `0` | 全部 |
| balanced | `1` | 半强度模糊、弱色边，关闭噪点与色相漂移 |
| lite | `2` | 仅背景模糊 |
| static | `3` | 纯色板 + 发丝边，零合成开销 |

`prefers-reduced-transparency`、`prefers-reduced-motion`、`prefers-contrast`、粗指针设备、低内存设备各自映射到一个档位。

## 体积

| 文件 | 原始 | gzip |
|---|---|---|
| `specular-ui.js` | 43.8 KB | 12.2 KB |
| `specular-ui.css` | 24.6 KB | 5.1 KB |

## 测试

```bash
npm test                # 33 项纯函数单测，不需要浏览器
npm run test:browser    # 35 项浏览器实测（Chrome / Playwright）
```

浏览器测试覆盖渲染完整性、键盘可达性、ARIA 同步、光源传播、四档降级、375px 视口无横向溢出、44px 触控目标、滤镜缓存命中率。断言的都是"用户会注意到"的东西，不测实现细节。

## 许可

MIT。基于 [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)（MIT, © 2025 Max Rovensky）的 SDF 折射算法研究扩展 —— 该算法在本库中的定位、以及为什么默认关闭，见 [docs/LIMITS.md](./docs/LIMITS.md)。完整归属见 [NOTICE](./NOTICE)。
