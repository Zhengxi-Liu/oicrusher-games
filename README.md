# oicrusher.me 游戏

https://oicrusher.me/game/ 上的全部游戏：网页游戏（每个一个 `xxx.html`）、PHP 排行榜接口，以及一个跑所有实时联机游戏的 Node.js 服务（`game_server/`）。

## 目录

| 位置 | 内容 |
|---|---|
| `index.html` | 游戏门户：游戏卡片、点赞、"Playing now" |
| `*.html` | 单页游戏（Snake、Tetris、2048、Doodle Jump、Geometry Dash……） |
| `*_api.php`、`*_db.sql` | 排行榜接口和建表脚本（MySQL `games` 库） |
| `identity.js`、`identity_lib.php`、`auth_api.php`、`presence_api.php` | 统一用户名 / 账号系统，见 [IDENTITY.md](IDENTITY.md) |
| `game_server/` | 统一的 Node.js WebSocket 服务，见 [GAME_SERVER.md](GAME_SERVER.md) |
| `flight_sim/`、`carrier_war/` | 飞行模拟、航母战，见 [FLIGHT_SIM.md](FLIGHT_SIM.md)、[CARRIER_WAR.md](CARRIER_WAR.md) |
| `tj_hide_seek/` | TJHSST 3D 藏物寻宝（象棋社、投篮、Gemini 审核），见 [TJ_HIDE_SEEK.md](TJ_HIDE_SEEK.md) |
| `photonic_fencing/`、`element_core/`、`cannon_duel/` | 1v1 联机游戏 |
| `voxel_kart/`、`rooftop_tag/`、`hl_deathmatch/`、`bomb_arena/` | 多人房间游戏 |
| `report/` | 管理员报表（游戏时长、用户管理） |

## 本地运行

```bash
cd game_server && npm install && node server.js      # 实时游戏服务，监听 127.0.0.1:8090
python3 -m http.server 8765                          # 另开一个终端，在本目录运行
```

然后打开 `http://127.0.0.1:8765/<游戏>.html?ws=ws://127.0.0.1:8090/<路径>`。PHP 接口需要 PHP 和 MySQL。

部署见 [DEPLOY.md](DEPLOY.md)，密码和密钥的处理见 [SECRETS.md](SECRETS.md)。
