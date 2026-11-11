# TJ Hide and Seek（TJHSST 永续藏物寻宝）— 开发参考

> 3D 多人在线藏物 / 寻宝。地图是 Thomas Jefferson High School（TJHSST）的两层教学楼，**严格按 `tj_hide_side/` 里的两张平面图描出来**，室内外风格参照同目录的照片。游戏内文字全英文。整个学校是一个永不重置的在线世界：藏的东西会一直留在原处，直到有人找到并打开。后端复用统一 Node 游戏服务（[GAME_SERVER.md](GAME_SERVER.md)，路径 `/tjhs`），没有单独进程。

> **准入**：只有门户 admin / super 账号，或输入 access code（默认 `1024`，环境变量 `TJHS_ACCESS_CODE` 可改）的人才能进学校。服务器在 `hello` 里检查：token 里带 `a: 1`（`identity_lib.php` 的 `oi_token()` 给 admin 加上）或 `code` 正确，否则回 `{t:'error', locked:true}`。客户端把 code 存在 `localStorage.tjhsCode`，被拒绝时清掉、退回菜单，下次再问。

> **聊天管理（admin）**：菜单里的 "🛡 Moderate chat" 只有 admin 能看到（`welcome.admin`）。可以删单条、删某人全部发言、清空全部；服务器 `chatMod` / `chatDel {cid | by | all}` 只认 `c.admin`，删除后广播 `chatDel {cids}`，所有人的聊天框同步消失。每条聊天有 `cid`（`world.chat` 里，旧存档加载时自动补）。

## 1. 文件

| 文件 | 作用 |
|---|---|
| [tj_hide_seek.html](tj_hide_seek.html) | 页面：全屏画布、HUD（积分、小地图、楼层导航、实时日志、提示）、菜单、藏物面板、便利贴、全图、排行榜；importmap（three r160 + addons）；Google Fonts `Caveat`（手写字） |
| `tj_hide_seek/shared/SchoolMap.js` | **前后端共用**：两层平面图数据（房间、外轮廓、庭院、中庭、楼梯、外门、走廊名）+ `build()`：门的自动放置、碰撞墙、`ground()`（含楼梯）、`locate()`（"Floor 2 · Library"）、`validSpot()`（服务器校验藏物位置） |
| `tj_hide_seek/shared/Profanity.js` | 脏话过滤（UMD，服务器用）：英文（防 leet `sh1t`、拉长 `fuuuck`、`f.u.c.k`、逐字母空格 `f u c k`；`SUB` 词出现在词里就打码，`EXACT` 词只匹配整词，所以 class / Dickens / grape / Niger 不误伤）+ 中文词表（忽略字之间的空格标点，`傻 逼` 也算）。聊天、黑板、便签三处都用它 |
| `tj_hide_seek/client/SchoolBuilder.js` | 把地图变成 Three.js：墙（每个房间在自己轮廓内画 12 cm 墙，带门洞、门框、开着的门、走廊侧的深红门牌）、地面/天花板/屋顶、楼梯、圆顶门厅、家具（InstancedMesh）、庭院、校园外景；返回可藏物的表面 |
| `tj_hide_seek/client/Textures.js` | 全部程序生成贴图：水磨石、教室地砖、体育馆枫木 + 球场线、地毯、吸音天花板、走廊奶油色瓷砖 + 藏青色点缀、砖墙外立面、储物柜、书架、白板、自动售货机、圆顶地面校徽、门牌/横幅图集 |
| `tj_hide_seek/client/Items.js` | 8 种可藏物品（真实尺寸）：MacBook、TI-84、Hydro Flask、Red Bull、Homework 文件夹、AirPods、魔方、AP 物理课本 |
| `tj_hide_seek/client/Player.js` | 第一/第三人称（V 切换）：Pointer Lock、WASD、Shift 跑、Space 跳、C 蹲；0.3 m 圆对线段碰撞（4 m 网格分桶）；重力、上楼梯、下楼梯贴地 |
| `tj_hide_seek/client/Minimap.js` | 每层预先画一张离屏地图；右上角圆形小地图（北朝上）、M 全图（两层并排） |
| `tj_hide_seek/client/main.js` | 场景、灯光、网络、其他玩家（学生小人 + 名牌，150 ms 插值）、藏物（瞄准射线）、检视特写（镜头拉近 + 聚光灯 + 便利贴）、HUD、音效 |
| `tj_hide_seek/server/HideServer.js` | 永续世界：物品/积分/日志存 `DATA_DIR/tjhs-world.json`（5 秒一存，先写 .tmp 再 rename）；位置 10Hz 转发；所有藏/开操作服务器校验 |
| `tj_hide_side/` | 参考资料（平面图 HEIC、照片）。**不要传到服务器** |

和需求原文的差异：
- **没用 Firebase**。站内所有联机游戏都走统一 Node 服务 + 门户身份系统（[IDENTITY.md](IDENTITY.md)），所以持久化放在 Node 服务的 JSON 文件里，名字用门户身份（服务器校验 token，前端改不了）。数据字段和需求一致：`{id, type, x, y, z, floor, creator, message, createdAt, isFound}`（另有 `rot`、`foundBy`、`foundAt`）。
- 留言只在**打开那一刻**由服务器发给打开的人（其他人只拿到物品类型和坐标），防止从网络数据里偷看。
- 物品 8 种（需求 5 种 + AirPods、魔方、课本）。

## 2. 地图怎么来的

- 平面图照片缩到 2000×1500 后加网格（20 px 细线、100 px 粗线）逐块读坐标，所有房间按**各自平面图的像素坐标**写在 `SchoolMap.js` 里。1 像素 = `SCALE` = 0.14 m（教室约 9 m、走廊 3–5 m，整栋楼约 240 × 180 m）。
- 二层照片和一层照片角度、比例都不同，用 9 个楼梯间 + 圆顶做最小二乘仿射配准：`T2(x, y) = [0.88061x + 0.0511y + 244.4, −0.00894x + 0.90389y + 82.2]`（残差 2–4 m）。二层矩形房间按中线映射，保持轴对齐。配准后：二层图书馆正好在一层 60 号教室区上方，Internet Cafe 的楼梯和一层东庭院的楼梯对上，"Open to Nobel below" 正好在一层 Nobel 上方。
- 一层：圆顶门厅（Main entrance #1）、Nobel Commons（两层通高中庭，二层玻璃栏杆）、两个庭院（主庭院有阶梯剧场和圆形广场、东庭院有温室）、DaVinci 研究实验室、CS Lab、Cafeteria、两个体育馆、礼堂、天文馆、Einstein、Turing 等全部按图。二层：Franklin、Curie、Library、Newton、Carver、Carson、Tesla、Hopper、241 Lecture Hall 等。
- 门：每个房间自动在朝走廊的墙上开门（大房间最多 3 个），条件是门外 0.7 m 和 1.6 m 处都是走廊（避免开进两墙之间的窄缝）；只和别的房间相邻的房间开门到邻屋，对面那堵墙也一起开洞。外门按图上编号（Door 2–15、Door D，新加 Door 5 给 D&T 楼梯）。
- 楼梯：9 部。8 部双跑楼梯（两跑并排、中间开敞楼梯井 + 玻璃栏板和扶手、远端平台，进出口在同一端，和图上的 SW 楼梯间一致），统一约 5.4–5.9 m 宽（每跑 2.6–2.9 m）、8.7 m 长，**梯段必须沿楼梯间长边**（否则太陡）；加 Nobel 的直跑大楼梯，4.2 m 宽（图上是旋转楼梯，照片里是宽直梯）。
- 庭院：两个庭院共 9 扇玻璃双开门（主庭院 5、东庭院 4），只开在朝走廊的玻璃墙上，门上挂 "Courtyard" / "East Courtyard" 牌子；售货机、沙发、储物柜都避开门口。
- 白板：16 块不同的课（物理 / 数学 / 英语，部分带简图），一张图集，每间教室随机一块。

**改地图后必须跑的检查**（脚本思路见第 5 节）：楼梯盒子必须完全在两层轮廓内、不压任何房间、两端出口都是走廊；每扇庭院门一边是庭院、一边是走廊；从出生点泛洪，220 个房间必须全部走得到；模拟走每部楼梯上下、穿过每扇庭院门。

### 按 tj.docx 修的问题（2026-10-27）

| 反馈 | 原因 | 修法 |
|---|---|---|
| Nobel 楼梯只有中间一条 | `buildStair` 的 `boxUV` 把台阶的长、宽传反了（`Batch.box` 的 hx 沿 u、hz 沿 v），每级 4.2 m 宽的台阶变成 0.42 m 的一条；所有楼梯都受影响 | 交换参数，台阶按真实宽度画 |
| 很多教室是"透视"的 / 二楼某个教室没有墙 | 房间墙只在"边的中点朝走廊"时才画外侧面，朝邻屋、外墙的边只有内侧面，从走廊看过去是背面剔除（看穿，只剩墙头的细柱） | 每面房间墙都画内外两面，房间从任何方向看都是封闭的 |
| Gym Office 两边是通道，能进体育馆；体育馆只有一层高 | Gym Office 和 Gym 1 之间有 0.5 m 缝、北侧还有个小凹口，Gym 1 东墙因此开了门 | Gym Office 占满 Gym 1 和 PTSA 那一列之间的整条（562–601 × 593–838），只朝北、朝南开门，体育馆东侧不再有门；两个体育馆（`tall`）墙一直砌到屋顶，一层天花板/屋面在体育馆上方开洞，另加 8.7 m 高的天花板和屋面 |
| Gym 2 的门被看台堵住 | 看台固定放在东侧长墙，正对东门 | 看台放在门少的那面长墙，门前 ±(4.2 + 半门宽 + 0.6) m 内不放 |
| 二楼教室和楼梯之间很多小缝能进去 | 平面图描出来的房间之间留了 0.1–1.2 m 的缝，算成了走廊 | `build()` 自动找"两面墙相对、间距 < 1.25 m"的缝（房间/房间、房间/楼梯间侧面、房间/庭院、房间/外墙），变成实心块 `fills[]`（碰撞 + 画朝走廊的墙面 + 小地图深色）；楼梯入口面不封；有门正好穿过缝时在门的位置留出通道。两层共 236 块 |
| 楼梯间不是砖墙，有门 | 楼梯间墙用了走廊的砖墙贴图，入口是整条车道宽的开口 | 楼梯间墙改成刷漆的平墙（`MAT.plain`）；两层入口都改成 1.4 m 的门（门框 + 开着靠在走廊侧墙上的门扇），碰撞墙同步加门两边的墙垛 |

修后检查：从出生点泛洪（含新墙垛、实心块），220/220 个房间仍然走得到；线上世界里的 10 个未找到的物品位置全部仍然合法、可达；逐个截图对照 tj.docx 里的 8 张图。

### 按一楼东北角标注图修的问题（2026-10-27）

| 标注 | 原因 | 修法 |
|---|---|---|
| Door 3 "这里是门" | `3 Chem` 描宽了（东墙描到 1684，图上是 ~1662），从 Door 3 往南的走廊只剩 0.84 m，又被封缝封成实心，门外是墙 | `3 Chem` 东墙改到 1662、`2 Ocean` 东墙改到 1685，走廊恢复 3–4 m 宽 |
| Door 3 楼梯"朝向不对" | 原来是南北向的 38×62 盒子，入口朝南 | 改成东西向（1691–1748 × 190–226），入口在西侧走廊，二楼入口同样在西侧 |
| "这里是后厨" | 那一块描成了 Staff Lounge / Mechanical / Faculty Offices | 换成后厨：Kitchen Storage、Walk-in Coolers（图上的 X 框）、Cafeteria Kitchen、Kitchen Office、Servery（打饭线） |
| "不是走廊！！" | Cafeteria 上沿描在 500，和后厨之间空出一条假走廊，Door 4 开进这条走廊 | Cafeteria 上沿改到打饭台（466），紧贴 Servery；Door 4 直接开进餐厅 |

顺带：房间可以写 `{ door: 'ws' }` 指定开门的方向（Servery 朝西走廊 + 朝南餐厅，Kitchen 朝南开进 Servery，Kitchen Office 朝南开进 Kitchen）；外门正好落在房间墙上时，房间墙也开洞（Cafeteria 的 Door 4、Admin Wing 的 Door 15；落在两间屋墙角的不开）。检查：222/222 个房间可达，线上未找到的物品位置全部仍然合法。

## 3. 玩法和规则

- 出生在圆顶正门外（参照 front_door 照片）。所有人在同一个学校里走动，看得到彼此（名牌、衬衫颜色可选）。
- **藏（H）**：瞄准 3.4 m 内的桌面、柜子/储物柜顶（够得着就能放，≤ 2.3 m）、书架、地面（蹲下可以塞到课桌下面），选物品、写 1–140 字便签。每人同时最多 5 个、15 秒冷却、全校最多 800 个、两个物品不能放在 0.3 m 内。可以走到自己的物品旁按 X 收回（不计分）。
- **找（E）**：2.5 m 内、面前、没被墙挡住就出现 "E Inspect"。打开 = 镜头拉近 + 聚光灯 + 黄色 3M 便利贴（藏的人、多久以前、楼层位置、留言）。第一个打开的人得到它。
- 计分：找到者 `10 + min(20, 藏了几小时)`；藏的人也得 `3 + min(12, 小时/4)`（藏得越久越值钱）。排行榜前 10（Tab / 菜单）。
- 实时日志（左下）："Bob just found Alice's MacBook on Floor 1 (Room 69)!"；有人藏东西只说楼层（"hid something somewhere on Floor 2…"）；进入学校。
- **聊天（Enter）**：全校公共聊天，再按 Enter 发送、Esc 取消（输入时人停下，鼠标还能转视角；兼容中文输入法：选字时的 Enter 不会发出去）。消息显示在左下日志下面，15 秒后淡出（打开聊天框时显示最近 10 条），说话的人头上冒 7 秒气泡。服务器：≤ 120 字、每人 10 秒内最多 5 条且间隔 ≥ 0.7 s、5 秒内不能重复同一句；最近 30 条存进世界文件，新进来的人能看到最近 12 条。
- **改写白板（I）**：教室 / 实验室 / 机房 / 音乐教室的白板（每间一块，共 125 块，key = `楼层:房间名`），站在房间里、3.5 m 内正面看着白板按 I，写最多 6 行 160 字，Ctrl+Enter 写上去；"Erase the board" 擦掉恢复原来的课。写上去的字用 Caveat 手写体，按白板大小自动选字号，轮流用蓝/黑/红/绿笔，右下角署名。永久保存（`world.boards`），所有人实时看到，日志里说 "Alice wrote on the whiteboard in Room 135"。服务器校验：房间存在且有白板、玩家最近的位置就在这个房间里（同一层）、每人 8 秒冷却。
- 右上：小地图 + 楼层导航（当前楼层高亮，每层还有几个未找到的物品）、当前位置名。

## 4. 协议（`/tjhs`）

| 方向 | 消息 |
|---|---|
| C→S | `hello {token, name, look, play}`（`play` 为真时才在日志里说 "walked into TJ"）· `st {p:[x,y,z], yaw, c}`（≤16Hz）· `hide {type, p, rot, msg}` · `open {id}` · `take {id}` · `chat {text}` · `wb {key, text}`（`text` 为空 = 擦掉）· `hist {k: 'log'|'chat', before}`（往上翻：要 `before` 之前的 50 条） |
| S→C | `welcome {id, me, items[], board, log, chat[], boards{key: {text, by, at}}}` · `chat {e: {id, by, text, at}}` · `chatErr` · `wb {key, b}`（`b` 为 null = 擦掉）· `wbResult` · `players {list}` · `pl {p:[id,x,y,z,yaw,crouch,...]}`（10Hz）· `item+ {item}` · `item- {id, by}` · `hideResult` · `opened {ok, item(含留言), gain, me}` · `me` · `log {e}` · `board` · `hist {k, list, more}` |

聊天窗（左下）和事件窗（右边，地图下面）分开、一直显示。服务器各存最近 300 条，进来时各发 50 条；滚到顶自动要更早的一页。游戏中（鼠标被锁）滚轮翻聊天，Shift+滚轮翻事件；PgUp/PgDn 同理。不在最底下时新消息不会把你拽下去，右下角出现 “↓ new”。

服务器校验：物品类型白名单；`validSpot()`（在楼内或庭院、离所在楼层地面 0–2.6 m）；离玩家最近一次上报位置 ≤ 4 m；打开时同样要求在 4 m 内；留言 / 聊天 / 白板都去控制字符、截长度，再过 `Profanity.mask()` 打码（服务器做，前端改不了）。

## 5. 测试（本地）

- 起服务：`cd game_server && PORT=8099 DATA_DIR=/tmp/tjhs node server.js`；静态页面用任意静态服务器（门户身份接口本地没有 PHP，测试时用一个返回假身份的小服务器；Node 端没有密钥文件时接受手填名字）。打开 `tj_hide_seek.html?ws=ws://127.0.0.1:8099/tjhs`。
- 调试参数：`?at=x,z,floor&look=yaw,pitch&nomenu=1` 直接站到某处；`window.__tjhs` 暴露 `map / player / placement` 等。
- 已做（headless Chrome + puppeteer）：
  - 双人流程：Alice 在 69 教室桌上藏 MacBook → Bob 的画面里出现 → Bob 走近出现 "E Inspect MacBook" → 打开看到便利贴和留言、+10 → Alice +3、日志 "Bob just found Alice's MacBook on Floor 1 (Room 69)!"、排行榜更新、物品从两边场景移除。
  - 9 部楼梯逐一模拟走上去（y = 4.5）再走下来（y = 0）。
  - 泛洪可达性（含家具碰撞）：220/220 个房间、2 个庭院可达，18 条楼梯连接都用到。
  - 藏物瞄准：桌面、蹲下塞课桌下、储物柜顶、走廊地面都能放；平视空处返回不可放。
  - 截图检查：正门圆顶、Nobel 中庭（一层 / 二层俯视）、走廊储物柜、教室、图书馆、庭院、餐厅、体育馆、礼堂、天文馆、Tesla、Hopper、全图、第三人称。
- 渲染量：约 115 次 draw call、67 万三角形（3000+ 套课桌椅、1800+ 个储物柜都是 InstancedMesh）。软件渲染（SwiftShader）约 20 fps，普通显卡会高很多；菜单里有 "faster graphics"（降分辨率）。

## 6. 部署

1. 服务器：`ssh root@oicrusher.me 'mkdir -p /opt/oicrusher-games/tj_hide_seek/server /opt/oicrusher-games/tj_hide_seek/shared'`，按 [GAME_SERVER.md](GAME_SERVER.md) 第 3 节传 `game_server/server.js`、`tj_hide_seek/server/*.js`、`tj_hide_seek/shared/*.js`（含 `Profanity.js`，只有服务器用），重启 `oicrusher-games`。
2. Apache `/etc/httpd/conf.d/oicrusher-games.conf` 加（照抄已有的 `<Location /game/flight-ws>`）：`/game/tjhs-ws → ws://127.0.0.1:8090/tjhs`，然后 `apachectl configtest && systemctl reload httpd`。
3. 网站：按 [DEPLOY.md](DEPLOY.md) 传 `tj_hide_seek.html index.html` 和 `tj_hide_seek/client/*.js`、`tj_hide_seek/shared/*.js`（**不要传** `tj_hide_seek/server/`、`tj_hide_side/`、`*.md`）。
4. `SchoolMap.js` 前后端共用，改了要两边都传，并把 html 里 `?v=N` 加一。

## Gemini 二次审核（AiModerator.js）

关键词过滤（Moderation.js）放行之后，聊天、白板、藏物便签、用户名都会再交给 Gemini 在后台判断（包括隐含的侮辱）。判定违规时：聊天 / 白板 / 便签改成 **"I love TJ"**（广播 `chatEdit` / `wb`），用户名改成 **"i'm 67"**（分数、藏物、聊天和日志里的名字都并过去，广播 `rename`；admin 不改名）。结果写进 Keyword filter 面板的 Blocked log（action = replaced / renamed）。

- 密钥：`/etc/oicrusher/gemini.key`（root:oigames 0640），或环境变量 `GEMINI_API_KEY`。**不要进代码库。** 模型：`GEMINI_MODEL`，默认 `gemini-3.1-flash-lite`（这个 key 能用的最便宜的；2.5-flash-lite 已下线）。
- 每 3 秒最多一个请求，每批最多 25 条，结果按文本缓存。Gemini 不可用（没额度 / 限流 / 网络）时留在队列里退避重试（最长 10 分钟一次）。
- 检查过的东西打 `ai: 1` 标记，用户名记在 `world.names`；重启时没检查过的会重新排队。

## 国际象棋社（Room 23，一楼）

Room 23 的课桌换成了三张棋桌，每张桌后坐一个学生 NPC。走到桌前按 **E** 开始下棋，玩家永远执白。赢了全校广播（事件栏 + 所有人的 toast），并加分：每个 NPC 每人每天只加一次分，防止刷分。

| NPC | 难度 | js-chess-engine 等级 | 分数 |
|---|---|---|---|
| Riley | Easy | 1（randomness 60） | 5 |
| Priya | Medium | 3（randomness 15） | 15 |
| Marcus | Hard | 4（endgame 加深最多 1 层） | 40 |

- [shared/ChessClub.js](tj_hide_seek/shared/ChessClub.js)：NPC 名单、难度、桌子位置（前后端共用；改了要两边都传，并把 html 里的 `?v=` 加一）。
- [server/Chess.js](tj_hide_seek/server/Chess.js)：服务器管整盘棋。chess.js（BSD-2）判断走法和结局，所以"X 赢了 Marcus"一定是真赢的。每人一盘，按名字存在内存里，2 小时不动就清掉；关掉棋盘或断线重连会接着下。
- [server/ChessWorker.js](tj_hide_seek/server/ChessWorker.js)：js-chess-engine（MIT）在 worker 线程里算 NPC 的走法，不卡 60 Hz 主循环（服务器只有 1 核）。worker 堆上限 64 MB。等级 5 和不限加深的等级 4 在残局能一下吃掉 50 MB 以上，所以没用。引擎出错时 NPC 随机走一步，不会卡住。
- 依赖：`game_server/package.json` 里的 `chess.js`、`js-chess-engine`（固定版本）。部署后要在服务器 `game_server/` 里跑 `npm ci --omit=dev`。
- 消息：`chessStart {bot}` → `chess {fen, legal, last, check, thinking, over}`；`chessMove {uci}`；`chessResign {}`；出错回 `chessErr {msg}`。赢棋写日志 `{k: 'chess', by, bot, label, moves}`。

## 投篮（Shoot Around，Gym 1 / Gym 2）

每个篮筐下放着一个篮球，走过去按 **E** 拿起来，只能投三分：
- **站位**：WASD 自由选位置（弧顶、45 度、底角都行），但会被自动推回三分线外（6.75 m 弧线和底角直线），也不能离篮筐超过 9.5 m。
- **弧度**：抬头 / 低头选出手角度 40–70°。屏幕上的虚线是完美出手的弧线，只显示弧形，不提示力度。
- **力度**：按住鼠标，力度条 1 秒涨满再回落，松手出手。绿色区是完美出手，离篮筐越远越靠上；弧度越好（约 52°）绿区越宽。绿区内必进，稍偏会在篮筐上弹，偏多就不进。
- **难度**（模拟结果）：出手时机误差约 ±40 ms 的玩家，好弧度命中约 60%，平弧度 25–40%。
- **排行榜**：连中最高记录，前 5 名显示在投篮面板里。连中 3 个以上并打破全校记录时全校广播：破纪录时一次，同一轮之后每多 5 个再报一次。
- **放回**：再按 E 放回篮球；走出球场会自动放回。

实现：
- [shared/Hoops.js](tj_hide_seek/shared/Hoops.js)：前后端共用的篮筐位置和物理（重力、篮筐圆环、篮板、地板，固定 1/240 s 步长）。
- 服务器用同一个 `simulate()` 重放每一投，所以连中纪录都是真的。服务器同时检查：
  - 出手点是不是玩家真实所在的位置
  - 出手点是不是在三分线外
  - 两投间隔至少 1 秒
- 当前连中数只存在内存里，服务器重启就清零；最高纪录存在 `world.hoops`。
- 篮筐离端墙从 1.4 m 改成 2.4 m，篮圈中心正好在地板画的篮筐位置（2.8 m）。篮圈换成真正的圆环，加了网，地板补画了底角的三分直线。
- 消息：
  - `hoopShoot {id, hoop, x, z, ang, pow}` → `hoopShot {made, swish, streak, best, pb}`，出错时回 `{err}`
  - `hoopBoard` → `{list, me}`
  - 破纪录写日志 `{k: 'hoops', by, streak, where}`

