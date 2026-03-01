# Branch Topology 算法分析

> 对应源文件：`src/lib/schematic/branchTopology.js`

## 算法说明

### 背景

RMG（Rail Map Generator）项目目前除了特殊判断的环线和带共线段的环线（上海地铁 3&4 号线）以外，支持以下几种线路形态：

- **简单直线**：单一主干，有两个度数为 1 的端点。
- **带端部支线（岔入/岔出）**：主干一端或两端各挂一条盲端支线，在 RMG 里表现为 `linestart` / `lineend` 多出一个子/父节点。
- **带区间支线（closed interval branch）**：主干上某两站 P、Q 之间，有一条绕行的平行路径，在主干上形成一个"闭合区间"。

这三类形态在图拓扑上的共同特征是：**所有节点的无向度数均 ≤ 3**，且分叉/汇合都以度数恰好为 3 的节点（下称"度3节点"）体现。

但是现有的导出方式并没有很好地发挥潜力，其瓶颈点之一是在 DFS 搜索中，度数为 3 的节点的分岔出入关系判定。如果能通过几何手段辅助判定度数为 3 的节点的走向，那么就可以不依赖搜索起点，唯一确定分岔出入关系，这样 RMG 的绘制支线方面的潜力能够充分得到发挥。

### 核心模型

算法将每条地铁线路的连通子图建模为如下的"主干 + 支线"结构：

```
[LeftBranch]
      │
      ▼
  trunk_start ─── ... ─── P ─── ... ─── Q ─── ... ─── trunk_end
                           └─── branchInterval ────────┘
                                                        │
                                                        ▼
                                                  [RightBranch]
```

约束条件（违反任一则输出 `valid: false`）：

| 约束 | 说明 |
|------|------|
| 度数上限 | 所有节点无向度数 ≤ 3 |
| 主干唯一 | 有且仅有一条从某源节点到某汇节点的主干路径 |
| 端部支线 ≤ 2 | 左端（岔入）支线和右端（岔出）支线各至多一条 |
| 区间不重叠嵌套 | 各区间支线的"主干索引区间" $[p_i, q_i]$ 开区间两两不相交 |
| 支线节点独占 | 属于支线的中间节点不得出现在主干或其他支线中 |

---

## 算法流程

整个分析分为七个阶段，对应 `analyzeComponent` 内的调用链：

```
buildDirectedGraph          ← 阶段 2–3
  └── resolveSpurAtDeg3Node   ← 阶段 2（几何消歧）
validateDirectedGraph       ← 阶段 4
walkTrunk                   ← 阶段 5
extractBranches             ← 阶段 6
  ├── walkHangingBranch
  └── walkIntervalBranch
validateIntervalOverlap     ← 阶段 7
(detectSimpleLoop)          ← 特殊路径（若图无源点则尝试环线）
```

---

## 各阶段详解

### 阶段 1 — 无向邻接表构建

入口 `analyzeLineBranchTopology` 仅取该线路（`lineId`）所拥有的边（`edge.sharedByLineIds.includes(lineId)`），构建无向邻接表 `UndirAdjacency`：

```
nodeId → [{ to, edgeId, weight }, ...]
```

`weight` 取 `edge.lengthMeters`（若缺失则退化为 1），为后续可能的加权扩展预留。构建完成后调用 `findAllConnectedComponents`（BFS）拆分连通分量，每个连通分量独立经历后续阶段。

### 阶段 2 — 度 3 节点几何消歧（核心创新）

这是整个算法的关键，解决了"仅凭拓扑无法唯一确定有向边方向"的问题。

**问题描述**

设某站点 $v$ 无向度数为 3，邻接三条边 $e_A, e_B, e_C$。
从拓扑角度，有两种合法的分叉语义：

- **分叉（split）**：$e_A$ 入 → $e_B, e_C$ 出（1 入 2 出）
- **汇合（merge）**：$e_B, e_C$ 入 → $e_A$ 出（2 入 1 出）

但无论哪种，始终有一条边扮演"主干直行方向"的到来与离开（pre-fork 边），另外两条边一条直行、一条转向（spur）——见下图：

```
        e_A  (pre-fork trunk, "直行来向")
         │
         v ────── e_B  (trunk continuation, "直行去向")
         │
         └─────── e_C  (spur, "支线偏转方向")
```

**几何判别方法**（`resolveSpurAtDeg3Node`）

对三条边，分别计算各自在节点 $v$ 处的**出向切线**（函数 `edgeTangentAt`），得到向量 $\vec{t}_A, \vec{t}_B, \vec{t}_C$。

计算三对夹角：

$$\theta_{AB} = \angle(\vec{t}_A, \vec{t}_B), \quad \theta_{AC} = \angle(\vec{t}_A, \vec{t}_C), \quad \theta_{BC} = \angle(\vec{t}_B, \vec{t}_C)$$

按降序排列，取最大的两个夹角 $\theta^{(1)} \geq \theta^{(2)} \geq \theta^{(3)}$。

**判定条件**：若 $\theta^{(1)} > \tau$ **且** $\theta^{(2)} > \tau$（当前阈值 $\tau = 115°$），则：

- 同时出现在 $\theta^{(1)}$ 和 $\theta^{(2)}$ 对中的那条边，即**与另外两条边夹角均大于阈值**的边，判定为 **pre-fork 边**（`spurEdgeId`，命名源自历史遗留，实为"主干来向"）。
- 其余两条边判定为 **trunk continuation 边**（`trunkEdgeIds`，实为"分叉后的主线 + 支线"）。

**直觉理解**：在真实线路中，站台内包括主支线在内的正线从本项目的尺度来看几乎为直线。因此"与另外两条边夹角都大"的那条边，必然是直行方向中的一端，另外那对（直行去向 + 支线方向）之间的夹角最小。**算法不区分"直行去向"与"支线方向"**，两者都归入 `trunkEdgeIds`，由后续阶段根据 BFS 传播方向随意确定哪条是主干，主支线关系稍后可在 RMG 内交换。

若不满足双阈值条件（如三条边近乎均匀分布为 120° 夹角），则返回 `null`，外层报错终止——这类线路几何上无法确定走向。

**切线估计细节**（`edgeTangentAt`）

边的几何形状由 `waypoints` 数组（经纬度坐标序列）描述。在端点 $v$ 处的切线近似取前两个 `waypoint` 的连线方向（虽然边的实际形状是两点间的曲线，但因为目前使用的样条曲线类型，不会差太多）：

- 若 $v$ 是 `fromStationId`：切线为 `waypoints[0] → waypoints[1]` 的方向。
- 若 $v$ 是 `toStationId`：切线为 `waypoints[n-1] → waypoints[n-2]` 的方向（反向）。

考虑到部分 OSM 导入数据中 waypoints 数组可能与 from/to 标注方向相反，算法通过比较 `waypoints[0]` 与两端站点的距离来检测并修正这一情况。若 `waypoints` 缺失，则退化为两站点间直线方向。

### 阶段 3 — BFS 有向图构建

`buildDirectedGraph` 以一个度数为 1 的节点（端点站）作为 BFS 起点，将无向图定向：

- **度 1 节点**：单边，BFS 到达即可，无需进一步传播。
- **度 2 节点（过路站）**：来边决定方向，出边随之确定，继续传播。
- **度 3 节点**：利用阶段 2 的结果判断当前到达的是 pre-fork 边还是 trunk-edge，据此确定剩余边的方向：

  | 到达方式 | 行为 |
  |----------|------|
  | 经 pre-fork 边到达 | → 向两条 trunk-edge 出射（split 形态：1 入 2 出） |
  | 经某条 trunk-edge 到达 | → pre-fork 边出射，另一条 trunk-edge 逆向传播（merge 形态：2 入 1 出） |

若图存在**无度 1 节点的连通分量**（典型情形：纯环线，所有节点度数为 2，首次 BFS 无可用起点，全部边均未定向），则由兜底循环补充传播，确保所有边都被定向。

### 阶段 4 — 有向图约束验证

`validateDirectedGraph` 检查：

- **源点（inDeg=0）≤ 2**：超过 2 则无法对应"最多两个端部起点"。
- **汇点（outDeg=0）≤ 2**：同理。
- **无节点** $\text{inDeg} > 2$ **或** $\text{outDeg} > 2$。

同时在 `buildDirectedGraph` 末尾会校验每个度 3 节点的入出边组合是否严格匹配 split 或 merge 模式，否则报告"病态拓扑"。

### 阶段 5 — 主干追踪

`walkTrunk` 从阶段 4 得到的首个源点出发，沿有向边贪心地选取第一条未访问的出边，产生主干路径 `trunkStationIds / trunkEdgeIds`。

> 由于算法不保证主干与支线的"正确"归属，实际只保证拓扑合法。若导出结果中主干与支线被互换，用户可在 RMG 工具内手动调整。

### 阶段 6 — 支线提取

`extractBranches` 遍历已知主干，分两步提取支线：

**6a. 端部支线（hanging branch）**

在源点/汇点集合中找到**不属于主干**的节点，将其作为支线尖端，分别以"前向追踪"（源点→主干）或"反向追踪"（汇点→主干，沿有向边逆行）走到主干节点，收集中间站点。

**6b. 区间支线（interval branch）**

遍历主干节点 $P_i$，若其有两条出边（`outDeg=2`），则除了主干出边以外的那条即为区间支线起点。`walkIntervalBranch` 沿出边追踪，直到抵达主干节点 $Q_j$（$j > i$）为止。追踪过程中验证每个中间节点的无向度数恰为 2，且未被其他结构占用。若末端为度 1 节点（死胡同），则该路径归类为 **MidHangingBranch**（主干中段盲端支线）。

### 阶段 7 — 区间不重叠验证

`validateIntervalOverlap` 对所有闭合区间支线 $[p_i, q_i]$（主干索引）按 $p_i$ 升序排序后，逐对检查：

$$\text{相邻两区间合法} \iff q_i \leq p_{i+1}$$

即区间的开区间部分 $(p_i, q_i)$ 与 $(p_{i+1}, q_{i+1})$ 不得相交或嵌套。

---

## 特殊路径：简单环线检测

若阶段 3 产生的有向图**无任何源点**（所有节点 inDeg ≥ 1），则尝试 `detectSimpleLoop`：

- 所有节点无向度数恰好为 2。
- 边数 = 节点数（单一简单回路）。

满足条件则直接输出 `{ isLoop: true, trunkStationIds, trunkEdgeIds }`，跳过支线提取流程。

---

## 数据结构速查

```
BranchTopologyResult
├── valid: boolean
├── reason?: string          // 失败原因
├── isLoop?: boolean
├── trunkStationIds: string[]
├── trunkEdgeIds: string[]
├── intervals: BranchInterval[]
│   ├── fromStationId / toStationId   // 主干端点（null 表示开放端）
│   ├── fromIndex / toIndex           // 主干中的索引（-1 / Infinity 表示开放端）
│   ├── stationIds[]                  // 支线中间站（不含主干端点）
│   └── edgeIds[]
└── midBranches: MidHangingBranch[]
    ├── attachToStationId             // 挂靠的主干站
    ├── stationIds[]
    └── edgeIds[]
```

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 度数上限为 3 | 不支持同一站点连接 4 条或以上线段（三叉之外的多叉站）。这也是 RMG 的限制。 |
| 区间支线不能嵌套 | 例如 `[1,5]` 与 `[2,4]` 嵌套不被允许。这也是 RMG 的限制。 |
| 几何判决依赖路由形状 | 若 waypoints 数据质量差或边长极短，切线估计可能失准，导致 `resolveSpurAtDeg3Node` 返回 null。 |
| 主干/支线非唯一归属 | 在某些对称形态下，分配到"主干"的路径可能不符合用户预期；RMG 工具内可手动调换。 |
| 不支持带分叉的环线 | 含度 3 节点的环线结构（如上海地铁 3&4 号线）目前在 RMG 中特殊处理，不经过本算法。 |
