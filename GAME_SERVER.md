# 实时游戏后台（统一 Node.js 服务）

> 服务器内存只有 ~760MB，所以**所有需要 Node.js 的实时游戏共用一个进程**。静态页面仍然由 Apache 提供，Node 只处理 WebSocket。新游戏请加到这个服务里，不要再单开 systemd 服务。

## 1. 结构

| 本地 | 服务器 | 说明 |
|---|---|---|
| [game_server/server.js](game_server/server.js) | `/opt/oicrusher-games/game_server/` | 入口：按 URL 路径把 WebSocket 分给各游戏，所有房间共用一个 60Hz 时钟，`/health` 健康检查 |
| [game_server/Lobby.js](game_server/Lobby.js) | 同上 | 1v1 通用大厅：在线列表、挑战/接受、服务器端 Bot 练习房、再来一局、最近战绩 |
| [game_server/RoomLobby.js](game_server/RoomLobby.js) | 同上 | 多人房间大厅：房间列表、建房（4 字母码；`create` 带的 `bots / level / map` 原样传给房间类的 opts）、按码加入，房间无真人 20 秒后关闭。`hello` 里的 `skin`（0–15）存在 client 上给房间用 |
| `photonic_fencing/Server/room.js` + `Shared/sim.js` | `/opt/oicrusher-games/photonic_fencing/` | Photonic Fencing 的房间（见 [PHOTONIC_FENCING.md](PHOTONIC_FENCING.md)） |
| `element_core/server/*` + `shared/*` | `/opt/oicrusher-games/element_core/` | Element Core 的房间（见 [ELEMENT_CORE.md](ELEMENT_CORE.md)） |
| `cannon_duel/Server/room.js` | `/opt/oicrusher-games/cannon_duel/Server/` | Cannon Duel 的事件中继房间（见 [CANNON_DUEL.md](CANNON_DUEL.md) §9） |
| `hl_deathmatch/server/*` + `shared/*` | `/opt/oicrusher-games/hl_deathmatch/` | Half-Life Web Deathmatch 的房间（见 [HL_DEATHMATCH.md](HL_DEATHMATCH.md)） |
| `rooftop_tag/server/*` + `shared/*` | `/opt/oicrusher-games/rooftop_tag/` | Rooftop Tag 的房间（见 [ROOFTOP_TAG.md](ROOFTOP_TAG.md)） |
| `bomb_arena/server/*` + `shared/*` | `/opt/oicrusher-games/bomb_arena/` | Bomb Arena 3D 的竞技场房间（见 [BOMB_ARENA.md](BOMB_ARENA.md)） |
| `voxel_kart/server/*` + `shared/*` | `/opt/oicrusher-games/voxel_kart/` | Voxel Kart Racing 的比赛房间（见 [VOXEL_KART.md](VOXEL_KART.md)） |
| `flight_sim/server/SkyServer.js` + `shared/World.js` | `/opt/oicrusher-games/flight_sim/` | Skyward Dynamics 的共享天空 + 排行榜（见 [FLIGHT_SIM.md](FLIGHT_SIM.md)）；`data/flight-board.json` |
| `tj_hide_seek/server/HideServer.js` + `shared/SchoolMap.js` | `/opt/oicrusher-games/tj_hide_seek/` | TJ Hide and Seek 的永续学校（见 [TJ_HIDE_SEEK.md](TJ_HIDE_SEEK.md)）；`data/tjhs-world.json` |
| — | `/opt/oicrusher-games/data/` | `<游戏>-recent.json` 最近 12 场战绩（Bot 练习不记录） |

服务器上的目录结构和本地 `game/` 下一致，所以 `require('../element_core/server/GameRoom.js')` 这类相对路径两边都能用。**`Server/`、`server/` 目录绝不能传进网站目录**，网站目录里只放 `*.html`、`Client|client/`、`Shared|shared/`。

| 项 | 值 |
|---|---|
| systemd | `oicrusher-games`（用户 `oigames`，`127.0.0.1:8090`，`MemoryMax=200M`，开机自启，崩溃 2 秒后重启） |
| Node | `/usr/bin/node`，Node 24 LTS（`dnf module` 安装） |
| Apache | `/etc/httpd/conf.d/oicrusher-games.conf`：`/game/fencing-ws → :8090/fencing`，`/game/element-ws → :8090/element`，`/game/cannon-ws → :8090/cannon`，`/game/hldm-ws → :8090/hldm`，`/game/rooftop-ws → :8090/rooftop`，`/game/flight-ws → :8090/flight`，`/game/kart-ws → :8090/kart`，`/game/bomb-ws → :8090/bomb`，`/game/tjhs-ws → :8090/tjhs` |
| 内存 / CPU | 空闲约 20–60MB；死斗满房（10 人）约 78MB、单核 6~7% |

## 2. 常用命令

```bash
ssh root@oicrusher.me 'systemctl status oicrusher-games --no-pager'
ssh root@oicrusher.me 'journalctl -u oicrusher-games -n 50 --no-pager -o cat'   # 每场对局和结果一行，带 [游戏名]
ssh root@oicrusher.me 'curl -s 127.0.0.1:8090/health'                           # 内存和各游戏在线人数/房间数
ssh root@oicrusher.me 'systemctl restart oicrusher-games'                       # 会断开所有游戏的进行中对局，先看 /health
```

## 3. 更新服务端

```bash
cd zhengxi-liu-site/game
scp game_server/{server,Lobby}.js game_server/package*.json root@oicrusher.me:/opt/oicrusher-games/game_server/
scp photonic_fencing/Server/room.js root@oicrusher.me:/opt/oicrusher-games/photonic_fencing/Server/
scp photonic_fencing/Shared/sim.js  root@oicrusher.me:/opt/oicrusher-games/photonic_fencing/Shared/
scp element_core/server/*.js        root@oicrusher.me:/opt/oicrusher-games/element_core/server/
scp element_core/shared/*.js        root@oicrusher.me:/opt/oicrusher-games/element_core/shared/
scp cannon_duel/Server/room.js      root@oicrusher.me:/opt/oicrusher-games/cannon_duel/Server/
scp game_server/RoomLobby.js        root@oicrusher.me:/opt/oicrusher-games/game_server/
scp hl_deathmatch/server/*.js       root@oicrusher.me:/opt/oicrusher-games/hl_deathmatch/server/
scp hl_deathmatch/shared/*.js       root@oicrusher.me:/opt/oicrusher-games/hl_deathmatch/shared/
scp rooftop_tag/server/*.js         root@oicrusher.me:/opt/oicrusher-games/rooftop_tag/server/
scp rooftop_tag/shared/*.js         root@oicrusher.me:/opt/oicrusher-games/rooftop_tag/shared/
scp flight_sim/server/SkyServer.js  root@oicrusher.me:/opt/oicrusher-games/flight_sim/server/
scp flight_sim/shared/World.js      root@oicrusher.me:/opt/oicrusher-games/flight_sim/shared/
scp voxel_kart/server/*.js          root@oicrusher.me:/opt/oicrusher-games/voxel_kart/server/
scp voxel_kart/shared/*.js          root@oicrusher.me:/opt/oicrusher-games/voxel_kart/shared/
scp bomb_arena/server/*.js          root@oicrusher.me:/opt/oicrusher-games/bomb_arena/server/
scp bomb_arena/shared/*.js          root@oicrusher.me:/opt/oicrusher-games/bomb_arena/shared/
scp tj_hide_seek/server/*.js        root@oicrusher.me:/opt/oicrusher-games/tj_hide_seek/server/
scp tj_hide_seek/shared/*.js        root@oicrusher.me:/opt/oicrusher-games/tj_hide_seek/shared/
ssh root@oicrusher.me 'curl -s 127.0.0.1:8090/health; cd /opt/oicrusher-games/game_server && npm ci --omit=dev && systemctl restart oicrusher-games'
```

`Shared/` 或 `shared/` 里的文件是前后端共用的，改了要**同时**传到网站目录和 `/opt/oicrusher-games/`，并把 html 里 `?v=N` 加一。

本地联调：`cd game_server && npm install && node server.js`，另开 `python3 -m http.server 8765`（在 `game/` 目录），然后打开
`http://127.0.0.1:8765/element_core.html?ws=ws://127.0.0.1:8090/element` 或 `photonic_fencing.html?ws=ws://127.0.0.1:8090/fencing`。

## 4. 加一个新游戏

1. 写一个房间类。1v1 游戏实现 [Lobby.js](game_server/Lobby.js) 顶部注释里的接口（`startInfo / onMessage / update / isOver / forfeit` 和 `tick`）；多人房间游戏实现 [RoomLobby.js](game_server/RoomLobby.js) 的接口（`addClient / removeClient / onMessage / update / info` 和 `humanCount`、`tick`）。
2. 在 `server.js` 的 `games` 里加一行 `name: new Lobby({ name, RoomClass, dataDir, log, bots })`。
3. 在 `oicrusher-games.conf` 里加一个 `<Location /game/<name>-ws>`，然后 `apachectl configtest && systemctl reload httpd`。
4. 前端连接 `wss://oicrusher.me/game/<name>-ws`，大厅协议（hello / lobby / challenge / respond / practice / leave / rematch）可以照抄现有游戏。
