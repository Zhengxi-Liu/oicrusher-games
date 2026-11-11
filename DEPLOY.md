# 游戏部署指南（oicrusher.me/game）

## 1. 服务器速查

| 项 | 值 |
|---|---|
| 登录 | `ssh root@oicrusher.me`（本机 `~/.ssh/id_ed25519` 免密） |
| 网站目录 | `/var/www/html/game/` → https://oicrusher.me/game/ |
| 本地源码 | `zhengxi-liu-site/game/` |
| PHP | **8.0**，不能用 8.1+ 语法（`never`、`readonly`、枚举等），函数名别和内置函数重名（曾因 `touch()` 重名导致空白 500） |
| 数据库 | MySQL，库名 `games`，`root` 无密码，只能在服务器本机连 |
| 备份目录 | `/root/game-backups/<UTC时间>/`（不在网站目录里，公网访问不到） |

## 2. 标准部署流程

在 `zhengxi-liu-site/game/` 目录下执行。下面的 `FILES` 换成这次要传的文件。

```bash
cd zhengxi-liu-site/game
FILES="my_game.html index.html"          # 这次要上传的文件（不要包含 .sql / .md）

# ① 先对比服务器版本，确认线上没有别人改过、而本地没有的内容
mkdir -p /tmp/srv && for f in $FILES; do
  scp -q root@oicrusher.me:/var/www/html/game/$f /tmp/srv/$f 2>/dev/null \
    && diff -q /tmp/srv/$f $f >/dev/null || echo "DIFF/NEW: $f"
done
#    出现 DIFF 时要看一下 `diff /tmp/srv/$f $f`，确认差异全是你自己这次的改动

# ② 在服务器上备份会被覆盖的文件（放网站目录外）
TS=$(date -u +%Y%m%d-%H%M%S)
ssh root@oicrusher.me "mkdir -p /root/game-backups/$TS && cd /var/www/html/game && cp -p $FILES /root/game-backups/$TS/ 2>/dev/null; ls /root/game-backups/$TS"

# ③ 上传
scp $FILES root@oicrusher.me:/var/www/html/game/

# ④ 有数据库改动时建表（脚本都写成 IF NOT EXISTS，可以重复跑），用 stdin 传，不要 scp
ssh root@oicrusher.me 'mysql -u root games' < my_game_db.sql

# ⑤ 有 PHP 时做语法检查
ssh root@oicrusher.me 'php -l /var/www/html/game/my_game_api.php'
```

### 回滚

```bash
ssh root@oicrusher.me 'ls /root/game-backups/'                       # 找到时间戳
ssh root@oicrusher.me 'cp -p /root/game-backups/<TS>/* /var/www/html/game/'
```

## 3. 上线一个新游戏的清单

1. 游戏做成单个 `xxx.html`，文件名只用小写字母、数字和下划线。首页的点赞功能靠 `^[a-z0-9_]+\.html$` 识别游戏。
   `<head>` 最前面必须放 Google Analytics 代码（见第 7 节），否则这个页面不会被统计。
2. 在 [index.html](index.html) 的 `.games-grid` 里加一张卡片（照着已有卡片抄）：
   ```html
   <a href="xxx.html" class="game-card">
     <span class="game-icon">🎮</span>
     <h2 class="game-title">游戏名</h2>
     <p class="game-description">一两句介绍</p>
     <span class="game-badge new-badge">NEW</span>
     <span class="game-badge">类型</span>
     <span class="game-badge">Global Leaderboard</span>   <!-- 有排行榜才加 -->
   </a>
   ```
   点赞按钮会自动出现，不用改后端。
3. 需要排行榜就按第 4 节接入。
   **玩家名字统一用门户身份**（见 [IDENTITY.md](IDENTITY.md)）：页面加 `<script src="identity.js?v=1"></script>`，需要名字时用 `await OIID.require()`，不要再自己做输入名字的框；联机游戏的 `hello` 要带 `OIID.token`，有房间/大厅的调用 `OIID.activity({status, join})` 让门户显示"Playing now"。
4. 按第 2 节部署 `xxx.html index.html`（加排行榜的话还要传 `scores_api.php`）。
5. 按第 5 节验证。

## 4. 给游戏加 Top 20 排行榜（共用接口，推荐）

只要分数是一个**越大越好的正整数**，就不用新建 PHP 和表，直接用共用的排行榜：

| 文件 | 作用 |
|---|---|
| [scores_api.php](scores_api.php) | 共用接口，数据在 `games.game_scores` 表里，用 `game` 列区分是哪个游戏 |
| [leaderboard.js](leaderboard.js) | 排行榜弹窗：Top 20 列表、进榜时输名字（名字记在 localStorage） |
| [scores_db.sql](scores_db.sql) | 建表脚本，已经执行过，新游戏不用再跑 |

**① 在 `scores_api.php` 的 `$GAMES` 白名单里加一行**，值是这个游戏可信的最高分（超过这个分数的提交直接拒绝）：

```php
$GAMES = [
    ...
    'my_game' => 100000,
];
```

如果分数是逐关累加的总分（同一个人会多次提交越来越高的分），还要把游戏名加进 `$ONE_PER_NAME`，这样每个名字只保留一条最高分。

**② 在游戏 html 里接入：**

```html
<script src="leaderboard.js"></script>
<script>
  const leaderboard = GameLeaderboard({
    game: 'my_game',                       // 必须和 $GAMES 里的 key 一致
    title: '🏆 Top 20 Players',
    format: s => s.toLocaleString() + ' pts',
    onOpen: () => pause(),                 // 可选：实时游戏打开榜单时暂停
    onClose: () => resume(),               // 可选
  });

  // 一局结束时调用：进了前 20 会弹窗让玩家输名字，没进就什么都不做
  leaderboard.gameOver(score);

  // 在开始页 / 结束页放一个按钮，随时查看榜单
  document.getElementById('lbBtn').onclick = () => leaderboard.open();
</script>
```

弹窗会吞掉键盘事件，玩家输名字时不会触发游戏快捷键（空格、R 等）。

**③ 部署时**把 `scores_api.php` 和游戏 html 一起传上去（`leaderboard.js` 只有改动时才需要传）。

### 什么时候不能用共用接口

- 分数越小越好（比如用时最短）、需要多维排序、需要按天重置，或者需要服务器端防作弊：参照 `mud_runner_api.php` + `mud_runner_db.sql` 单独写一个 `xxx_api.php` 和一张 `xxx_scores` 表。
- 对战类、纯解谜（只有过关或星级）、每天只能玩一次的游戏，一般不适合做排行榜。

### 管理员删除一条成绩

```bash
# 直接操作数据库最简单
ssh root@oicrusher.me 'mysql -u root -e "USE games; SELECT id,player_name,score FROM game_scores WHERE game=\"my_game\" ORDER BY score DESC LIMIT 20"'
ssh root@oicrusher.me 'mysql -u root -e "USE games; DELETE FROM game_scores WHERE id=123"'
```

## 5. 部署后验证

```bash
# 页面能访问，并且是新版本
curl -s -o /dev/null -w '%{http_code}\n' https://oicrusher.me/game/my_game.html
curl -s https://oicrusher.me/game/my_game.html | grep -c leaderboard.js
curl -s https://oicrusher.me/game/my_game.html | grep -c G-L8GMZRR0GY   # 应为 2（gtag 已加上）

# 排行榜接口（新游戏应返回 {"leaderboard":[]}；返回 Unknown game 说明白名单没加或 PHP 没传）
curl -s 'https://oicrusher.me/game/scores_api.php?game=my_game'

# 想测提交：提交一条测试数据，然后马上删掉
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"game":"my_game","score":1,"name":"__deploy_test__"}' https://oicrusher.me/game/scores_api.php
ssh root@oicrusher.me "mysql -u root -e \"USE games; DELETE FROM game_scores WHERE player_name='__deploy_test__'\""
```

最后在浏览器里打开游戏，强制刷新（Cmd+Shift+R）后玩一局，确认能弹出输名字、提交后能看到自己的名次。

## 6. 注意事项

- **`.sql`、`.md` 以及含密码或测试用的文件不要 scp 到网站目录**，传上去会被公网直接下载。
- 不要在网站目录里留 `*.bak` 备份，备份统一放 `/root/game-backups/`。
- 本地预览：`cd zhengxi-liu-site/game && python3 -m http.server 8000`。注意排行榜和点赞接口写的是 `https://oicrusher.me/...` 绝对地址，本地预览会读写**线上**数据。
- 本机终端是 zsh，`$FILES` 不会按空格拆开，`scp $FILES ...` 会把整串当成一个文件名报错。用 `scp ${=FILES} ...`，或者直接把文件名写出来。

## 7. Google Analytics（gtag）

全站统一用一个衡量 ID：`G-L8GMZRR0GY`。**每个会输出 HTML 的页面都要加**（游戏、博客、题解、聊天、后台和登录页、PHP 页面都算），紧跟在 `<head>` 后面：

```html
<head>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-L8GMZRR0GY"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-L8GMZRR0GY');
  </script>
  <meta charset="UTF-8">
  ...
```

- 一个页面只能有一份。PHP 里如果有两个分支各自输出完整页面（比如登录页和主页面，见 `webproxy/index.php`），每个 `<head>` 都要加。
- 被别的 PHP `require` 进来、不能直接访问的片段（比如 `chat/rooms.php`），只要它自己输出完整的 `<head>` 就要加；外层页面 `require` 之后会 `exit`，不会重复。
- 以下文件**故意不加**：
  - `proxy/proxy.php`：转发第三方网页的代理，加了会把我们的统计代码注入到别人的页面里。
  - `webproxy/toolbar.php`、`webproxy/start.php`：嵌在 `webproxy/index.php` 里的 iframe，加了会让一次访问被重复计数。
- 纯接口（`*_api.php`、`config.php`、`logout.php` 等不输出 HTML 的文件）不用加。

### 全站检查：找出漏加的页面

```bash
ssh root@oicrusher.me 'cd /var/www/html && for f in $(find . -type f \( -name "*.html" -o -name "*.php" \) \
    -not -name "*.bak*" -not -path "*/uploads/*" -not -path "*_old_backup*" -not -path "./zhengxi-liu-site/*"); do
  grep -qi "<head[ >]" $f || continue
  grep -q G-L8GMZRR0GY $f || echo "MISSING $f"
done'
```

正常情况下只会列出上面三个故意不加的文件。2026-10-15 全站补过一次（60 个页面），改动前的原文件在 `/root/game-backups/gtag-20261015-234256/originals.tgz`。
