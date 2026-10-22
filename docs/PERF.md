# 实测数据

测量环境：Windows 11 · Chrome 152 · headless（SwiftShader 关闭，`--enable-gpu-rasterization`）· 1440×900 · 42 个已挂载组件。脚本 `test/bench.mjs`，可复现。

> **读法说明**：headless 的帧率上限被合成器钳在 143fps，所以"平均帧率"不能代表真实刷屏体验。有信息量的是 **p95 帧时间** —— 它反映每帧的合成开销是否偶发超预算（14ms = 掉到 71fps 档）。

## 帧时间（光源每帧移动，最坏情况）

| 档位 | 中位帧 | p95 帧 | 说明 |
|---|---|---|---|
| 0 full | 7.0ms | **14.0ms** | 每帧重绘模糊层与色散，偶发双帧 |
| 1 balanced | 7.0ms | **13.9ms** | 与 full 接近：省下的噪点不是瓶颈 |
| 2 lite | 7.0ms | **13.9ms** | 单层模糊已足够重 |
| 3 static | 7.0ms | **7.1ms** | 无合成，完全平稳 |

结论：**真正的成本是 `backdrop-filter` 本身，不是噪点或色相动画。** 这也解释了为什么降级表里"balanced"关闭噪点收益有限 —— 如果你的设备在 full 档吃力，直接跳 `lite` 或 `static` 才有意义。

## 首屏

| 指标 | 值 |
|---|---|
| `DOMContentLoaded` | 185ms（本地 file://，含 42 个组件的结构构建） |
| `load` | 185ms |
| `data-sp-ready` 置位 | < 600ms（含一次能力探测与光源接管） |

## 可选折射层（`setRefraction(true)`）

| 指标 | 值 |
|---|---|
| 42 个表面冷构建 | 173–246ms（含 28 张位移贴图的 PNG 编码） |
| 缓存后每轮重建 | 0.4–1.5ms |
| 缓存命中 | 4 轮 × 42 表面 → 144 次命中，0 次重算 |
| 缓存条数上限 | 24，超出按 LRU 淘汰并移除对应 SVG 定义 |

这层默认关闭，原因见 [LIMITS.md](./LIMITS.md)。数字保留是因为它证明了生成器本身可用：**贴图能算出来，只是浏览器不把它喂给背景。**

## 光源更新

| 操作 | 写入根变量次数 |
|---|---|
| 40 次相同的 `light.set(0.5, 0.5)` | **1** |
| 40 次递增的 `light.set()` | 40（每帧合并为 1 次） |

实现对每次写入做三级削减：`requestAnimationFrame` 合并、变化量小于 `0.0015` 跳过、只在值真的变了才写。

## 体积

| 文件 | 原始 | gzip | 说明 |
|---|---|---|---|
| `specular-ui.js` | 43.8 KB | 12.2 KB | 含四个组件 + 核心 + 材质表 |
| `specular-ui.css` | 24.6 KB | 5.1 KB | 含四套环境变量 |
| `specular-ui.cjs` | 25.7 KB | 8.8 KB | 压缩后 |

## 渲染层数

每个组件的结构是固定的五层：

| 层 | 是否合成 | 说明 |
|---|---|---|
| `.sp-surface` | 是（backdrop-filter） | 材质主体 |
| `.sp-surface::after` | 是（backdrop-filter，仅 liquid） | 边缘梯度折射 |
| `.sp-sheen` | 否（普通渐变） | 跟随光斑 |
| `.sp-edge` | 否（inset shadow） | 发丝边 |
| `.sp-content` | 否 | 内容 |

液态玻璃是唯一用两层 `backdrop-filter` 的材质 —— 这是它比 `frost` 贵一倍的原因，也是 `lite` 档只保留一层的原因。

## 复现

```bash
npm run build
node test/bench.mjs
node --test --test-concurrency=1 test/optical.test.mjs
```

`test/optical.test.mjs` 会额外打印冷构建与缓存命中的实时数字。
