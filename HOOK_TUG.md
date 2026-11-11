# Hook & Tug — 开发者参考

> 单文件 2D 物理对战：两辆小卡车被一根弹性绳连在一起，站在会崩塌的浮岛上，下面是岩浆。先把对手拽进岩浆 5 次的一方获胜。

## 1. 概览

| 项 | 值 |
|---|---|
| 前端 | [hook_tug.html](hook_tug.html)（HTML + CSS + JS 内联，Canvas 1280×720，自适应缩放） |
| 物理 | Matter.js 0.19.0（cdnjs），固定步长 `STEP = 1000/60` |
| 联机 | **WebRTC DataChannel 点对点**；PHP 只做大厅 + 信令中继 |
| 后端 | [hook_tug_api.php](hook_tug_api.php) + [hook_tug_db.sql](hook_tug_db.sql)（5 张表：players / invites / matches / relay / history） |
| 模式 | 联机 1v1（host 权威）、本地双人、人机练习；主菜单背景是 bot 对 bot 的演示 |
| 部署 | 按 [DEPLOY.md](DEPLOY.md)：`FILES="hook_tug.html hook_tug_api.php index.html"`，再跑一次 `hook_tug_db.sql` |

## 2. 联机架构

```
 Host 浏览器 (挑战者, 蓝车, cars[0])                       Guest 浏览器 (红车, cars[1])
 ┌──────────────────────────────┐   'fast' 不可靠/无序   ┌──────────────────────────────┐
 │ Matter.js 权威模拟 60Hz        │ ── 快照 30Hz ───────▶ │ 本地预测 + 和解 (replay)       │
 │ HostNet.take(): 每步取一个      │ ◀── 输入 60Hz ─────── │ 输入带 seq，每包冗余最近 10 个  │
 │ guest 输入，ack = 已应用的 seq   │   'ctl' 可靠/有序      │ host 车用 100ms 插值缓冲渲染    │
 └──────────────────────────────┘   hello/ping/rematch/bye └──────────────────────────────┘
            ▲                                                         ▲
            └── PHP 轮询：hello / lobby / invite / respond / signal ──┘   (连上后每 8s 心跳一次)
```

- **大厅 = 在线列表**：没有房间。进入 Online Lobby 时 `hello` 拿到 `{id, token}`（存在 sessionStorage，每个标签页一个身份），之后每 2 秒 `lobby` 一次，返回在线玩家（12 秒内轮询过的人）、收到的挑战、自己发出的挑战状态，以及已经成立的对局。
- **挑战**：点玩家旁的 ⚔️ Challenge → `invite`；对方弹出 Accept / Decline → `respond`。接受后建一条 `hook_tug_matches`，**发起挑战的一方是 host**。接受方从 `respond` 的返回值、挑战方从下一次 `lobby` 的 `match` 字段得知对局开始，双方都调 `Net.beginMatch()`。挑战 30 秒没人理自动过期。
- **信令**：`signal` 既是对局心跳也是信箱，`out` 里带要发给对方的消息（`{t:'sdp'}` / `{t:'ice'}`），返回 `since` 之后发给自己的消息。握手期间 400ms 一次；连上之后改成 8 秒一次心跳，让对局保持 active、玩家在列表里显示"in a match"。45 秒没有心跳的对局自动结束。
- **离开**：退出对局调 `end`；离开大厅或关闭标签页调 `bye`（sendBeacon），会结束对局、撤回挑战并立即从在线列表消失。
- **STUN only**：没有 TURN。双方都在对称 NAT 后面时打不通，20 秒后提示换网络。需要的话在 `Net` 里的 `ICE` 数组加 TURN 服务器即可。
- **断线检测**：`connectionState` 为 failed / disconnected 持续 5s，或 8s 没收到任何消息（ping 每秒一次）。

### 2.1 快照字段（host → guest，每 2 个物理步一次）

| 字段 | 含义 |
|---|---|
| `k` | host 的全局步数（guest 用来估算时钟、丢弃乱序的旧快照） |
| `rn` / `ph` / `pt` / `rt` | 回合号 / 阶段（0 count, 1 play, 2 end, 3 over）/ 阶段计时 / 回合内步数 |
| `a` / `hb` | 最后应用的 guest 输入 seq / host 当前输入（guest 回放时用它预测 host） |
| `w` / `lo` `hi` `wn` | 两边绞盘长度 / 岛屿剩余砖块区间和正在抖动的一侧 |
| `sc` / `ls` | 比分 / 本回合落岩浆的一方（2 = 同时） |
| `b` | 6 个刚体 × (x, y, angle, vx, vy, ω)，顺序 `[车0底盘, 车0轮×2, 车1底盘, 车1轮×2]` |

### 2.2 Guest 和解

`Guest.onSnapshot`：记下自己车的渲染位置 → `readBodies` 覆盖整个世界 → 删掉 `seq <= a` 的输入历史 → 用 `[hb, 历史输入]` 重新 `stepWorld` → 新旧位置差记进 `offset`，每帧乘 0.82 衰减，避免画面跳动。实测把快照恢复进一个全新的 engine，1 秒后偏差约 0.1px，所以和解几乎看不出来。

**`stepWorld` 必须保持为"世界状态 + 输入"的纯函数**，guest 会回放它。不要在里面用 `Math.random`、`Date.now` 或渲染状态；只有 host 运行的 `hostTick` 才能做判定（掉岩浆、计分、崩塌）。

## 3. 物理与玩法常数

| 常数 | 值 | 说明 |
|---|---|---|
| `ROPE_K` / `ROPE_MAX` | 1.5e-4 / 0.03 | 单向弹簧（只拉不推），力上限约 5 倍车重 |
| `ROPE_DAMP` | 5e-4 | **只在两车分离时阻尼**，回弹不阻尼，这样才有弹弓效果 |
| `REEL_IN_SPEED` / `REEL_OUT_SPEED` | 6.5 / 6 px/步 | 收绳速度随张力下降（绞盘堵转），最低 15% |
| `WINCH_MIN` / `WINCH_MAX` | 20 / 260 | 每人各管自己那一半绳长，总长 = 两者之和 |
| `DRIVE_ACC` / `WHEEL_MAX` | 0.03 / 0.36 | 车速约 300 px/s；松开油门时轮子每步 ×0.98（几乎自由滚动） |
| `LEAN_ACC` / `LEAN_MAX` | 0.01 / 0.06 | 空中/地面都能调姿；翻车后按住能翻回来 |
| `CRUMBLE_START` / `CRUMBLE_EVERY` | 15s / 130 步 | 从两端交替掉砖，剩 `MIN_TILES = 4` 块为止 |
| `WOBBLE_*` | 约 43s 起 | 加时：岛像跷跷板一样越晃越大，保证僵局也能结束 |

- 两车**互相不碰撞**（`CAT_CAR` 的 mask 只有 `CAT_WORLD`），绳子是唯一的相互作用：被猛拽的车会从你身边冲过去，冲到你身后的边缘。
- bot 对 bot 模拟：每回合 29–58 秒，中位数约 51 秒，基本都是加时晃岛分出胜负（bot 比较保守，真人会快很多）。

## 4. 测试方法（无需 PHP）

1. 物理：把 `// ==== CORE BEGIN` 到 `// ==== CORE END` 之间的代码连同 `// ---------- bot` 一节拿到 Node 里 `require('matter-js')` 跑，可以无界面模拟对局、扫参数。
2. 联机：用 Playwright 开两个浏览器上下文，`context.route('**/hook_tug_api.php')` 用内存实现替代 PHP，就能端到端测 WebRTC 握手、预测和断线；给 `RTCDataChannel.prototype.send` 包一层 `setTimeout` 可以模拟延迟和乱序。
3. `window.HookTug.state` 暴露了只读的调试状态（模式、阶段、比分、车辆位置、RTT）。
