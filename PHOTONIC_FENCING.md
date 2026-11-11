# Photonic Fencing — 开发与运维参考

> 霓虹风 1v1 击剑：突刺 / 闪避 / 招架。**权威服务器**是 Node.js + WebSocket（60Hz），静态页面仍由 Apache 提供。

## 1. 部署结构

服务端已经并入统一的游戏后台（一个 Node 进程跑所有实时游戏），部署、更新和运维命令都看 [GAME_SERVER.md](GAME_SERVER.md)。

| 内容 | 本地 | 服务器 |
|---|---|---|
| 页面 | [photonic_fencing.html](photonic_fencing.html) | `/var/www/html/game/photonic_fencing.html` |
| 浏览器代码 | `photonic_fencing/Client/*.js` | `/var/www/html/game/photonic_fencing/Client/` |
| 共享模拟 | `photonic_fencing/Shared/sim.js` | **两处都要放**：网站目录和 `/opt/oicrusher-games/photonic_fencing/Shared/` |
| 房间逻辑 | `photonic_fencing/Server/room.js` | `/opt/oicrusher-games/photonic_fencing/Server/`（**不要**传进网站目录） |
| WebSocket | — | `wss://oicrusher.me/game/fencing-ws` → `127.0.0.1:8090/fencing` |

大厅、挑战、战绩由通用的 [game_server/Lobby.js](game_server/Lobby.js) 处理，`room.js` 只负责对局本身。

## 2. 网络同步

- **Shared/sim.js 是唯一的游戏规则**：整数运算、无随机数，`step(state, [bits0, bits1])` 是纯函数。服务器和浏览器跑同一份代码，所以预测和权威结果逐帧一致。
- **客户端预测**：本地时间线比服务器**提前**约 RTT/2 + 1~3 帧，每帧带帧号（即 input sequence number）发送输入，自己的动作立即生效。服务器在快照里回报 `adv`（输入提前到达多少帧），客户端据此把 tick 速度微调 ±6%，让 `adv` 保持在 1~3。
- **对账**：每个快照（60Hz）到达时，从快照状态出发，用自己尚未被确认的输入和对手的输入重放到"现在"。服务器会把已收到的对手**未来帧输入**一并发来（字段 `of`），所以对手动作通常能精确地放在正确的帧上，而不是靠猜；位置修正量在画面上按每帧 ×0.72 衰减，不会瞬移。
- **服务器延迟补偿（回滚）**：输入晚到、但没超过 `MAX_REWIND = 8` 帧（约 133ms）时，服务器回滚到那一帧重算。单元测试里招架包晚到 2~8 帧仍然算成功（哪怕服务器已经先判了击中），晚到 9 帧以上则按到达时刻生效。比赛结果要等超过回滚窗口后才最终记录。
- 可见延迟参考：本地 0 延迟时对手出刺第 1 帧可见，实测线上（RTT 约 70ms）约第 4~5 帧可见，突刺前摇 13 帧。

## 3. 玩法参数（Shared/sim.js 的 `C`）

| 动作 | 帧数（60fps） |
|---|---|
| 突刺 Lunge | 前摇 13（剑尖蓄光预警）· 判定 6 · 收招 22 |
| 闪避 Dodge | 共 20，前 10 帧无敌，向后滑步 |
| 招架 Parry | 前 12 帧（200ms）为完美窗口，之后 18 帧硬直 |
| 练习 Bot | 每隔一段时间主动压进并突刺（简单 2.5~4.3 秒一次，普通 1.3~2.7 秒，困难 0.75~1.8 秒），射程边缘还会随机试探 |
| 招架成功 | 全局定格 18 帧（0.3s），攻击方 Stagger 52 帧 |
| 对刺 Clash | 同一帧互相命中：双方后弹，不得分 |
| 回合 | 30 秒；20 秒后两端激光墙向中间收拢；超时本回合作废重打；先赢 3 回合获胜 |
