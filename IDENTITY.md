# 统一用户名系统（游戏门户）— 开发参考

> 所有游戏共用一个玩家名字：可以注册账号（用户名 + 密码），也可以不注册、只输入一个名字（存在 cookie 里，叫"游客"）。门户首页显示"Playing now"：谁在玩什么，点 Join 直接加入。排行榜、联机游戏里的名字都来自这里，**服务器端强制**，前端改不了。

## 1. 组成

| 文件 | 作用 |
|---|---|
| [identity_lib.php](identity_lib.php) | 共用 PHP 库（自己不输出任何东西）：建表、名字校验、签名 cookie、`oi_identity()`、`oi_token()`、`oi_score_name()` |
| [auth_api.php](auth_api.php) | `GET ?action=me`；`POST {action: register / login / guest / logout}`；`GET ?action=check&name=` |
| [presence_api.php](presence_api.php) | 游戏页每 20 秒心跳 `{sid, game, title, status, join}`，关页面时 `sendBeacon` 离开；`GET` 返回 45 秒内在线的玩家 |
| [identity.js](identity.js) | 前端库 `window.OIID`：登录 / 注册 / 游客弹窗、左下角名字徽章、presence 心跳、给 Node 用的 token |
| [game_server/Identity.js](game_server/Identity.js) | Node 端校验 token；`Lobby.js`、`RoomLobby.js`、`flight_sim/server/SkyServer.js` 的 `hello` 都走 `Identity.resolve()` |
| `/etc/oicrusher/identity.secret` | PHP 和 Node 共用的签名密钥（`root:oiid 0640`，`apache` 和 `oigames` 都在 `oiid` 组里）。**不要进代码库** |

数据表（`games` 库，第一次用时自动建）：`site_users`（`username_lc` 唯一，`password_hash`）、`site_presence`、`site_auth_fail`（每 IP 10 分钟最多 10 次登录失败）。

## 2. 身份怎么判断

- 注册用户：`oi_auth` cookie = base64url(JSON{u, n, e}).HMAC，HttpOnly，30 天；**不用 PHP session**（session 文件 24 分钟就会被回收，而且 blog/chat 也在用 PHPSESSID）。
- 游客：`oi_guest` cookie = 名字.HMAC，1 年。名字不能和注册用户重名（大小写不敏感）；如果某个游客名后来被人注册了，这个游客 cookie 就失效，要重新选名字。
- 名字：2–16 个字符，任何语言的字母、数字、空格、`_ - .`。
- Node：浏览器从 `auth_api.php` 拿 token（12 小时有效，`OIID.fresh()` 会刷新），`hello` 时带上。服务器上有密钥文件时是严格模式：没有有效 token 直接拒绝。本地开发没有密钥文件时，接受手填的名字。

## 3. 每个游戏怎么接

页面里加 `<script src="identity.js?v=1"></script>`（放在游戏脚本前面）。

| 类型 | 游戏 | 做法 |
|---|---|---|
| Node 房间 | voxel_kart、rooftop_tag、hl_deathmatch | 连接前 `await OIID.require()`，`hello` 带 `token`；名字框只读，点击打开账号弹窗；进房间后 `OIID.activity({status, join: 'xxx.html?join=CODE'})`；URL 带 `?join=CODE` 时按钮变成 "JOIN CODE"，连上后自动加入 |
| Node 1v1 大厅 | photonic_fencing、element_core、cannon_duel | 同上；在大厅时 presence 是 "challenge me"，链接 `?challenge=名字`，点进来的人连上大厅后自动向对方发起挑战；比赛中显示 "duelling 对手" |
| Node 共享天空 | flight_sim | 选模式前 `OIID.require()`；排行榜成绩由 Node 用已验证的名字记录 |
| PHP 大厅 | hook_tug | `hook_tug_api.php` 的 `cleanName()` 用身份覆盖名字；前端同 1v1（`?challenge=`） |
| 共用排行榜 | byzantine、descent、flip_sizzle、oxygen_colony、pipeline、rb_tree_defense、skyline_evade | `leaderboard.js?v=2`：进前 20 时不再让人输入名字，直接用身份提交（没有身份就先弹窗） |
| 自带排行榜 | snake、tetris、doodle_jump、geometry_dash、mud_runner、waste_time | 弹出输入名字框的地方改成直接用身份提交；waste_time 保留"提交"按钮但名字框只读。API 地址改成相对路径（这样 www. 访问也会带上 cookie） |
| 没有名字的游戏 | 2048、soduku、crash_it、hotelling、logic_gate、power_wash、wordle | 只加 identity.js：徽章 + presence（"在玩"） |

所有排行榜 API（scores / snake / tetris / doodle / geometry_dash / mud_runner / waste_time / hook_tug）都调用 `oi_score_name()`：有身份就用身份的名字（无视前端传来的名字）；没有身份（比如浏览器缓存的旧页面）时用传来的名字，但如果这个名字属于注册用户，就返回 403。

**新游戏上线时**：加 identity.js；需要名字的地方用 `OIID.require()` / `OIID.name`；联机的 `hello` 带 `OIID.token`；有房间或大厅的话调用 `OIID.activity({status, join})`，`join` 只能是本站的 `xxx.html?...`（presence_api 会校验）。

## 4. 测试

- 在服务器上做的隔离预发布（PHP 8.0 + 真 MySQL）：`/root/oi_stage` + `games_stage` 库 + `php -S 127.0.0.1:8098` + 一个独立的 Node 实例（8097），通过 ssh 隧道访问，测完删掉。
- API：注册 / 重名（大小写不敏感）/ 短密码 / 非法名字 / 游客用注册名被拒 / 中文名 / 密码错误 / 登录；排行榜带 cookie 时用身份名、不带 cookie 冒用注册名被拒；presence 拒绝 `javascript:` 链接。
- 浏览器：门户注册 → Voxel Kart 建房 → 另一个浏览器以游客身份在门户看到并点 Join 进入同一房间；不带 token 的 hello 被拒；leaderboard.js 自动用身份提交；28 个游戏页面全部加载无错误，徽章名字正确。
- 上线后在正式环境又跑了一遍，测试账号和数据已删除。

## 5. 回滚

备份在 `/root/game-backups/identity-<时间>/`（`web/files.tar` 解到 `/var/www/html/game/`，`node/files.tar` 解到 `/opt/oicrusher-games/`，然后重启 `oicrusher-games`）。新增的 `identity*.php / auth_api.php / presence_api.php / identity.js / game_server/Identity.js` 删掉即可。

## 6. 游戏时间统计和管理后台（`report/`）

- **记录**：每个游戏页面（identity.js）可见时每 20 秒发一次心跳；`presence_api.php` 把同一标签页两次心跳之间的时间（最多 25 秒，所以关掉或隐藏的页面不算）累加到 `site_playtime`（日期 × 玩家 × 游戏，含会话数）。还没选名字的访客记成 `(anonymous)`，不会出现在公开的"Playing now"里。
- **权限**：`site_users.role` = `user` / `admin` / `super`。`zxliu` 永远是 super（`identity_lib.php` 每次连接都会校正）。`report/` 里每个 PHP 文件自己检查角色（Apache `AllowOverride None`，没有 .htaccess），目录里没有静态文件，公开页面上没有任何链接。
  - `report/index.php` + `report/api.php`：游戏时间报表，admin 和 super 可看。
  - `report/users.php` + `report/users_api.php`：用户管理，只有 super。写操作需要页面里的 CSRF token（`X-CSRF` 头）。
- **登录 cookie 现在会查库**：cookie 里带 `auth_ver`，`oi_identity()` 每次核对账号是否还在、版本是否一致。所以删除账号或重置密码会让这个用户在所有设备上立刻退出。
- **报表功能**：时间范围（今天 / 7 / 30 / 90 天 / 全部 / 自定义）、玩家类型（全部 / 注册 / 游客 / 不含匿名）、按 玩家 / 游戏 / 玩家×游戏 / 天 聚合；汇总卡片、每日趋势图、Top 15 排行、可排序表格、点玩家看他玩了哪些游戏、点游戏看谁在玩，CSV 导出。
- **用户管理**：添加用户（可留空密码自动生成，可设为 admin）、重置密码（留空自动生成，只显示一次）、设为/取消 admin、删除。不能改自己、不能改 super。
- **测试**：服务器上的隔离预发布（PHP 8.0 + MySQL，`games_stage`）：权限矩阵（匿名 / 普通 / admin / super 对每个页面和接口）、CSRF、重置密码后旧 cookie 失效、心跳累计（20 秒 + 断开后封顶 25 秒）、匿名不出现在公开列表、30 天模拟数据下的报表截图（浅色 / 深色）。
