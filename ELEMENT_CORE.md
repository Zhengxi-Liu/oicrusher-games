# Element Core（元素熔炉：肉鸽法师决斗）— 开发参考

> 俯视角 1v1 法师对决，三局两胜。服务器权威（统一 Node 服务，见 [GAME_SERVER.md](GAME_SERVER.md)），HTML5 Canvas 前端。

## 1. 文件

| 文件 | 作用 |
|---|---|
| [element_core.html](element_core.html) | 页面：大厅、抽卡弹窗、样式 |
| `element_core/shared/Constants.js` | 常量、掩体布局、15 张卡牌定义、`deriveStats(卡组) → 数值`（前后端共用） |
| `element_core/shared/Movement.js` | 移动、冲刺、施法冷却、圆与矩形碰撞、弹道生成（前后端共用，客户端预测靠它） |
| `element_core/server/GameRoom.js` | 一场比赛：60Hz 主循环、输入队列、伤害、抽卡、回合、30Hz 快照 |
| `element_core/server/PhysicsEngine.js` | 自写的轻量物理：弹道分步移动、追踪、反弹、穿透、射线检测 |
| `element_core/server/DraftPool.js` | 服务器端卡池：每房间独立随机种子，按稀有度加权抽 3 张不重复的牌 |
| `element_core/server/Bot.js` | 服务器端练习 Bot（简单/普通/困难），和真人走同一套输入接口 |
| `element_core/client/main.js` | 连接与大厅、60Hz 输入循环、快照处理、插值、抽卡 UI |
| `element_core/client/Predictor.js` | 自己的法师：预测 + 对账（含预测弹道） |
| `element_core/client/InputHandler.js` | WASD、鼠标瞄准、左键施法、空格冲刺 |
| `element_core/client/Renderer.js` | 霓虹渲染、粒子、掩体碎裂、顿帧、HUD；弹幕过多时自动降到 1x 分辨率 |
| `element_core/client/Audio.js` | Web Audio 合成音效 |

和需求原文的差异：物理用自写的轻量实现，没用 matter-js（单核小服务器，圆和轴对齐矩形足够）。静态文件由 Apache 提供，没用 Express。大厅按全站习惯做成"在线列表 + 挑战"，没做"建房间/房间码"。

## 2. 网络同步

- **服务器**：60Hz。每个输入**只执行一次、按顺序执行**：队列空了，这一帧法师就原地等；有积压时一帧最多执行 2 个来追。这样客户端重放未确认输入时，结果和服务器完全一致。快照 30Hz，包含 `a`（这个客户端最后被执行的输入序号）。
- **换对局**：输入序号跨对局持续递增，每条输入还带对局编号 `r`，服务器只收本局的。否则上一局还在路上的输入会让新房间记住更大的序号，把新局的输入全当成过期丢掉（曾导致再来一局后双方都动不了）。
- **客户端预测**：每 1/60 秒采一次输入，打上序号，用 `Movement.stepPlayer` 立即移动自己的法师；施法时立即生成"预测弹道"，等服务器的同一次施法（按序号匹配）出现后就换成服务器版本。
- **对账**：快照到达时用服务器状态覆盖自己，丢掉已确认的输入，重放剩下的；预测误差记成显示偏移，按每帧 ×0.8 衰减，不会瞬移。实测：本地 0 修正，约 110ms 往返延迟下 3 秒内只有 1–2 次修正（发生在倒计时转战斗的那一刻）。
- **插值**：对手、敌方弹道、火焰按 100ms（6 帧）延迟在两个快照之间插值；自己的服务器弹道向前外推 `100ms + RTT/2`，和自己的预测时间线对齐。命中、碎裂等事件也按插值时间播放，和画面同步。

## 3. 玩法

| 项 | 值 |
|---|---|
| 生命 / 移速 | 100 HP，4.2 px/帧 |
| 法弹 | 9 伤害，冷却 14 帧，速度 9.5 |
| 冲刺 | 空格，10 帧全程无敌，冷却 90 帧 |
| 掩体 | 9 块，对称布局，90~160 HP，挡弹后掉血、裂纹变色、碎裂 |
| 抽卡 | 开局先选一张；之后战斗满 45 秒、或每回合结束后各选一张；15 秒内选，超时随机 |
| 胜负 | 三局两胜；卡牌跨回合保留 |

卡牌（可叠加，`max` 是上限）：Split Shot（分裂射击）、Ice Slowdown（寒冰减速）、Homing Missiles（追踪飞弹）、Flame Dash Trail（烈焰冲刺）、Vampiric Touch（吸血）、Chain Lightning（连锁闪电：打到墙或掩体时对附近敌人放电，克制躲掩体）、Bounce off Walls（墙壁反弹）、Rapid Cast（急速施法）、Overcharge（过载）、Heavy Orb（重型法球）、Velocity（疾速弹道）、Phase Bolts（相位穿透）、Swift Step（疾步）、Arcane Shield（奥术护盾）、Vitality（生命强化）。数值全部在 `deriveStats()` 里。

Bot 平衡（各 16 局模拟）：困难对简单 14:2，困难对普通 11:5，普通对简单 14:2。单场每帧服务器开销约 3–6µs。
