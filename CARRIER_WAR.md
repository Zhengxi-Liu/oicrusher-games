# Carrier 地图（`flight_sim.html` 的第三张地图，旧名 Carrier War）

**不是独立游戏**：Carrier War 是[飞行模拟](FLIGHT_SIM.md)的第三张地图（PEACE / WAR / **CARRIER**）。同一个页面、菜单、HUD、飞行物理、机炮、炸弹、聊天、伤害、其他飞行员的显示和同一个服务器（`/flight`），只有"地图"不同：一片大海 + 两艘航母，没有岛、机场、游乐场、鸟、弹坑。`carrier_war.html` 只剩一个跳转到 `flight_sim.html?map=carrier` 的页面（旧链接可用）。

## 玩法
- 菜单选 **⚓ CARRIER MAP**，再选机型：选哪架就是哪一方（US Navy：`hellcat` / `dauntless`；IJN：`zero` / `val`）。这四架只能在 Carrier 地图飞，Carrier 地图也只能飞这四架（`FSWorld.mapAllows`）。模式只有自由飞行。
- **只有炸弹/鱼雷能击沉航母**（每艘 2800 血：1000 lb 直接命中甲板 600，500 lb 300；**俯冲轰炸加成** `CarrierWorld.diveFactor`：按投弹瞬间飞机速度的俯冲角，25° 以下 ×1，50° 及以上 ×1.6，所以俯冲投下的 1000 lb 命中 960，三颗击沉；落在水里离船体 30 m 以内算近失弹，约 45% 递减）。机炮对航母无效。
- **撞击也算伤害**：飞机撞在航母（甲板/舰岛/舷侧，己方或敌方都算）上坠毁，客户端发 `crashhit {p}`，服务器（`CarrierBattle.onCrash`）按位置报告校验后扣血：`CarrierWorld.CRASH_DMG[机型]`（70 m/s 时 70–160）×速度系数 0.3–1.6，4 秒冷却，广播 `cdmg {hit, dmg, hp, from}`。
- 甲板停机：每艘航母前部两侧各停 4 架**折翼**的真实机模（`CarrierScene.parkedPlane`，合并网格），贴着甲板边缘；出生车道改为 x = -8 / 0 / 7.5 且前后错开 14 m（`spawnPoint`），翼尖不会碰到停放的飞机和舰岛。
- **护盾**（`CarrierWorld.SHIELD`，半径 420 m、高 380 m）：盾内任何人不会被机炮打伤，自己在**己方**盾内也不能开火/投弹；**炸弹可以穿过护盾**。**AA 炮**（`client/CarrierAA.js`，各浏览器自己模拟，只有本机飞机受伤，和炸弹/机炮同一信任模型；服务器不再发 `aa`）：每艘航母有真实的可转动炮位——USN 4 座双联 5"/38（VT 近炸引信，约 20 m 内引爆）+ 6 座四联 40 mm + 8 门 20 mm；IJN 6 座双联 12.7 cm 89 式（只有时间引信，误差大）+ 8 座三联 25 mm。射程 550–900 m，打进该射程内的敌机（不再限于护盾）。炮手像 1940 年代火控：看到目标晚 0.6 s、只会按测得速度直线外推、估距有误差、每个点射带固定瞄准偏差 + 弹着散布，所以蛇形/俯冲/转弯能躲，直线平飞一次穿越约 5 点伤害。大炮每 2–4 s 一发，炸点是闪光 + 黑烟团，30 m 内有破片伤害；小炮点射曳光弹，命中半径几米，时间到自爆小烟团。炮口火焰/烟/炮声、命中火花都有。无友军伤害。
- 回合：一艘航母血量归零（或 20 分钟到点按血量判）→ 回合结束（20 秒结果页，输家下沉），然后全部回到菜单、重新开始。比分 = 各队赢的回合数。
- 两支舰队都以 15 节（7.7 m/s）向北（-z）匀速航行，位置是回合时钟的纯函数 `CarrierWorld.update(t)`（客户端和服务器一致）：USS Resolute x=-2600，IJN Akagiri x=2600，回合开始时 z=3300，甲板 270 × 48 m，高 20 m。甲板上的飞机在航母参考系里飞（`CarrierMap.before/after`）。
- 起飞：甲板尾部出生，满油门（R）→ **弹射**（甲板上 `zloc > -70` 内额外 38 m/s² 直到 68 m/s）。降落：放起落架（U）、襟翼（V）、**尾钩（H）**，在尾钩区（距舰尾 20–105 m，画着四条钢索）接地且速度 > 25 m/s → **拦阻索**（24 m/s² 减速）。错过钢索就是 bolter，复飞。
- 在己方甲板上停稳：补满炸弹、子弹、修好机身（客户端 `rearm()`；服务器也重置这一架的炸弹额度并发 `rearm`）。
- 伤害沿用飞行模拟的"命中数"：12 发击落；各机 `hitScale = 12 / 血量`（Hellcat 16、Avenger 15、Dauntless 13、Val 11、Kate 10、Zero 9），Zero 的炮弹更重（`gun.dmg`）。炸弹爆炸半径内的飞机自己的浏览器判定死亡（和 WAR 地图一样）。

## 机型补充：F4U Corsair / D4Y Suisei
- `corsair`（美，战斗轰炸机，血量 17）：倒海鸥翼（拐点最低，起落架在拐点上）、超长机鼻 + 巨大整流罩和 4 m 螺旋桨、六挺 .50、**翼下两枚 500 lb 炸弹**（`bombRack` pylon 形式，N 投放；模型里是翼下挂架炸弹，折翼停放时挂在机腹中线）。最快的美机（`topKt` 340）。
- `suisei`（日，俯冲轰炸机，血量 10）：液冷直列发动机（尖鼻 + 下巴散热器，没有圆整流罩）、可收起落架、翼下俯冲刹车（Z）、一枚 1000 lb 炸弹（摆臂）；很快但很脆。
- 阵营名单：USN = hellcat / corsair / dauntless / avenger；IJN = zero / suisei / val / kate。甲板停放每艘 8 架，四种机型轮流。

## 文件
| 文件 | 说明 |
|---|---|
| `flight_sim/shared/World.js` | `MAPS` 加了 `carrier`、`CARRIER_PLANES`、`mapAllows`（前后端共用） |
| `carrier_war/shared/CarrierWorld.js` | 航母几何、位置（回合时钟）、甲板高度 `deckAt`、碰撞 `solidAt`、护盾 `shieldAt`、炸弹环境 `bombEnv`、伤害表（浏览器和服务器共用） |
| `carrier_war/shared/CarrierPlanes.js` | 4 种飞机的玩法数据（血量、枪伤、炸弹、队伍） |
| `carrier_war/client/CarrierPlanes.js` | 飞行模型：从 `FSPhysics.TYPES.warbird` 深拷贝再改质量/功率/翼面积/枪/炸弹，注册进 `TYPE_IDS`（飞机选择界面自动出现）；固定涂装 `PAINT`；`hitScale` |
| `carrier_war/client/CarrierModels.js` | 4 种飞机的 3D 模型：用 `PlaneModel.js` 的零件（翼型机翼 + 可动舵面、旋转体机身、螺旋桨、起落架）搭出真实外形——F6F 圆胖整流罩 + 龟背，SBD 带孔分裂减速板 + 炸弹摆臂，A6M 细长机身 + 黄色识别条，D3A 固定整流罩起落架 + 翼下炸弹；全有尾钩、国徽 |
| `carrier_war/client/CarrierScene.js` | 航母的 3D 模型：放样船体（外飘的舰艏、水线下红漆、带铆钉/舷窗/锈迹贴图的舷侧）、带标线的飞行甲板、甲板边缘走道/安全网/灯、停放的飞机、舰岛、雷达、**可转动的 AA 炮位**（返回 `mounts`）、尾迹 |
| `carrier_war/client/CarrierAA.js` | AA 炮的火控、弹道、炸点/命中特效、曳光弹（见上面的“AA 炮”） |
| `carrier_war/client/CarrierMap.js` | 地图插件：海面、航母随回合时钟移动/冒烟/下沉、移动甲板参考系、弹射/尾钩/拦阻索/甲板人员、边界、护盾判断、回合结果页、DOM 面板 |
| `carrier_war/client/CarrierHud.js` | 继承飞行模拟的 `Hud`，只换小地图（大海 + 两艘航母 + 护盾圈）和地图徽章 |
| `carrier_war/server/CarrierBattle.js` | 服务器端的战斗：航母血量、回合、AA、炸弹重飞校验 + 命中航母；由 `flight_sim/server/SkyServer.js` 持有 |
| `flight_sim/client/main.js` | 在需要的地方 `mapId === 'carrier'`：世界切换 `applyWorld()`、出生在甲板、`gameStep` 里的甲板参考系/弹射/拦阻、护盾、AA、炸弹爆炸、HUD、相机 |
| `flight_sim/server/SkyServer.js` | 第三张地图的天空：聊天/名单/位置转发按地图分开；carrier 地图的 `shielded / inShield / mayFire`、无友军伤害、炸弹额度、`impact` 交给 `CarrierBattle` |

## 协议（都在 `/flight`，`hello {map: 'carrier', plane}`）
- 沿用飞行模拟的 `st`（多一个 `s` 速度）、`sky`、`hit`、`bomb`、`impact`、`bump`、`chat`。
- 服务器 → 客户端（carrier 专有）：`welcome.round`、`round {phase, winner, hp, wins, t0, now, max, left}`（回合变化时）、`boom {w, p, kind, hit, dmg, hp}`（炸弹命中/落水，带航母血量）、`rearm`。
- 炸弹：服务器用 `shared/Bombs.js` 在**当时航母的位置**上重飞一遍验证 `impact`（`tRel` = 投弹时的回合时间），然后才广播 `boom`。

## 测试
- 服务器逻辑：jsc + `require` 垫片加载 `SkyServer.js`（见 memory 的 testing-flight-sim-locally），测过：选 carrier 机型自动进 carrier 地图和分队、炸弹命中甲板扣 450、无友军伤害、己方盾内不能开火、敌方盾内收到 AA、血量归零回合结束、停稳甲板重置炸弹额度。
- 客户端：`?map=carrier` 打开 `flight_sim.html`（本地测试页要 `<base href="/game/">` 和 `OIID` 桩，含 `me()`/`open()`），headless Chrome（真 GPU）+ `window.FS`：`FS.setPlane('dauntless'); FS.start('free'); FS.tick(秒)`，`FS.carrier` 是地图插件。

## 鱼雷机（TBF Avenger / B5N Kate）
- `flight_sim/shared/Bombs.js` 新增武器 `tp`（航空鱼雷，900 kg）：像炸弹一样下落；入水时合速度 ≤ 115 m/s 且水平速度 ≥ 20 m/s 才会"潜航"（否则散架，`ev.broke`），之后在水下 3 m 以 22 m/s 直线前进（`stepRun`），碰到 `env.hull(x, z)`（航母吃水线轮廓，`CarrierWorld.hullAt`）就以 `kind: 'hull'` 爆炸，最远跑 1400 m。
- 服务器（CarrierBattle）重放鱼雷，只有 `hull` 才算数：伤害 `BOMB_DMG.tp = 1100`（航母 2800，3 条沉）；散架/跑空/砸在甲板上都不爆炸。炸弹仍然是"甲板直接命中"。
- 飞机：`avenger`（美，血量 15，腹下 1 条）、`kate`（日，血量 10，腹下 1 条），用 `bombRack` 的 `pylon` 形式（按 N 直接投放，需离海面 ≥ 15 m）。客户端 `BombFleet.wake()` 画白色尾迹带。

## 机模外形 / 鱼雷外观（2026-11-03）
- `CarrierModels.js` 机身不再是旋转体：`body` 站位 `[z, 半宽, 顶 y, 底 y]` 放样超椭圆截面（上半机身色，下半 `under` 腹部色），每种飞机自己的侧面轮廓（Avenger 深弹舱 + 腹部射手台阶 + 球形炮塔，Hellcat 驼背 + 整流罩下巴进气口，Corsair 长机鼻，Suisei 尖鼻 + 排气管，Val 背鳍延伸条）。座舱盖是 `greenhouse`（`hood` 站位，每个站位一道框）。垂尾/平尾多站位做出各机型的圆顶/方顶。舵面用机身同色（IJN 的 Kate/Val/Suisei 方向舵是色带 `rudderBand`）。美军 1943 星条徽、日之丸都贴在弯曲蒙皮上（`onSkin`）；日机螺旋桨棕色红尖，美机无整流锥只有桨毂。
- 鱼雷模型 `Bombing.js` 的 `torpedoMesh('mk13' | 'type91')`：细长钢体、钝圆战斗部、十字尾翼、铜色对转螺旋桨；Mk 13 带胶合板头部减阻环和尾部护环，Type 91 带木制尾部稳定箱。挂在飞机上和投下后用同一个模型（`BombFleet.launch` 的 `look` = 投弹者机型）。Avenger 的鱼雷半埋在弹舱里，弹舱门在挂弹时打开。

## 驱逐舰护航（IJN Yukikaze，2026-11-04）
- 一艘阳炎型驱逐舰（`CarrierWorld.ESCORTS`，1944 年状态）在 IJN 航母**左舷（西侧）** 800 m、稍靠前 180 m，与舰队同速向北航行。尺寸照实舰：长 118.5 m、宽 10.8 m、吃水 3.8 m；艏楼甲板约 7 m，后甲板 5.6 m（`DD`、`ddHalfWidth`、`ddDeckY`）。不在护盾内，不决定回合胜负。
- **血量** `DD_HP = 1200`（服务器 `CarrierBattle.dd`，`round.dd` / `boom.dd` 下发）。只有美方能伤害它：炸弹直接命中甲板 = 全额 × 俯冲加成（俯冲 1000 lb 960），25 m 内近失弹 60% 递减（薄船壳）；鱼雷命中船体 1100（一条就沉）；撞击同航母的 `CRASH_DMG`；**机枪扫射**：客户端数自己打中驱逐舰的子弹（`Guns` 的 `onStrike` → `CarrierMap.strafed`），每 0.5 s 发 `ddhit {i, n}`，服务器限速（≤ 90 发/秒）、距离 ≤ 1500 m，每发 0.3 × `gun` 血，**扫射最多打到 40%**（打不沉驱逐舰）。扫射还会让命中点附近的炮位人员隐蔽 2–4 秒（`CarrierAA.suppress`，所有浏览器都算）。
- 沉没：`ESCORTS[i].sunk = true` 后从碰撞、炸弹地面、鱼雷船体里消失；客户端在被击沉的位置舰艏下沉 + 横倾，约 25 秒后消失；新回合满血复活。消息 `ddmg {i, dmg, dd, from, by}`（撞击/扫射）。
- **AA**（`CarrierAA` 的 `GUN.ijnDD`）：2 座双联 12.7 cm 三年式炮塔（平射炮，仰角只有 55°，`maxPitch`，装填慢，只有时间引信）、5 座三联 25 mm 九六式、6 门单装 25 mm。射手模型同航母。
- 模型 `carrier_war/client/DestroyerScene.js`：放样船体（外飘舰艏、前倾艏柱、艏楼台阶、巡洋舰艉、水线下红漆 + 黑色水线带）、亚麻油毡甲板、舰桥 + 测距仪 + 指挥仪、三脚前桅 + 22 号雷达、两根后倾烟囱（冒淡烟）、两座四联装鱼雷发射管、小艇、深水炸弹架、主桅军旗、艉部平假名舰名「ゆきかぜ」。小地图上是一个窄条 + “DD”。

## 平衡（2026-11-04）
之前 IJN 几乎每局都输。用 Monte Carlo 测（headless Chrome 跑 `CarrierAA`，从随机方位做同一条 60° 俯冲 / 低空鱼雷航线，各 150–300 次）：同一条航线上 USN 舰队的 AA 打出的伤害约是 IJN 的 4.5 倍（直线俯冲 29.8 vs 6.8 发，主要来自 VT 近炸引信的 5"/38 和四联 Bofors），而 IJN 飞机血量又只有美机约 70%。三层修正：
1. **AA 等效**：`CarrierAA.js` 的 `LETHAL = { usn: 0.32, ijn: 1.43, ijnDD: 1 }` 乘在每发弹的伤害上（火控、弹道、外观不变，仍是 USN 弹幕更密）。校准后两支舰队对同一航线的伤害相同：直线俯冲约 9.5 发，蛇形俯冲约 1 发，直线鱼雷航线约 5 发。
2. **抗高炮能力 `flak`**（`shared/CarrierPlanes.js`）：AA 伤害按 `flakScale = 12 / flak` 结算（`main.js` 的 `onAA`），不再用机炮血量 `hitScale`。各机 12–14 之间（Hellcat/Corsair/Avenger 14，Dauntless/Val/Kate 13，Zero/Suisei 12）；机炮对战仍按真实血量（Zero 9 发）。
3. **载弹**：Zero 改为 1944 年"爆战"，机腹 1 枚 250 kg（`b500`，N 投放），对应 Corsair 的战斗轰炸机角色。Val 两枚 250 kg 可以在一次俯冲里连按两次 N 全投。
4. **Rally（自动纠偏，服务器 `CarrierBattle.rally`）**：连续输掉的回合每局 +15%（最多 3 局），人数少的一方再 × √(敌方人数/己方人数)（最多 1.3），合计最多 ×1.5，乘在该队炸弹/鱼雷/撞击对**敌舰**的伤害上；该队赢一局就清零。`round.rally`、`boom.rally` 下发，结果页和新回合开始时显示"IJN rallies: bombs & torpedoes +15%"。

测试工具：scratchpad 里的 `aa.html`（加载 CarrierScene/DestroyerScene/CarrierAA，脚本化航线，统计每次攻击吃到的 AA 发数，按炮种分）。

## 浏览器标签图标
`flight_sim/favicon.svg`（翼型 + 绕流流线 + 升力箭头，原创矢量图）+ `flight_sim/favicon-180.png`（PNG / apple-touch-icon），`flight_sim.html` 和 `carrier_war.html` 都引用。

## 远处海面（2026-11-04）
`flight_sim/client/Ocean.js`（岛图和航母图共用）：每列波浪原来只按距离淡出，低空掠射角下一个像素沿视线方向能覆盖几百米海面，长涌浪也会混叠成条纹（"晕"）。现在用屏幕空间导数 `dFdx/dFdy(vWorld.xz)` 算像素足迹 `foot`，波长 < 约 2–5 倍足迹的那列波淡出（细涟漪、白浪、泡沫条纹同理），淡出的坡度方差记为 `rough`：远处变成模糊的天空反射 + 更宽的太阳光带，而不是摩尔纹。

## 舰船机动规避（2026-11-05）
- 舰船不再是"回合时钟的纯函数"直线航行：每艘船（两艘航母 + 驱逐舰）都有舵（`st.cmd`，-1..1）、航向 `yaw`（0 = 北，+ = 左转）、横倾 `heel`。模型（`CarrierWorld.stepShip`，固定 0.1 s 积分）：航速恒定 `SPEED`（**驱逐舰与航母同速 15 节**），转向角速度按时间常数跟随舵令（航母满舵约 390 m 回转半径，驱逐舰约 230 m），转弯时**向外横倾**（航母满舵 5°，驱逐舰 8°）。
- **服务器权威**：`CarrierBattle.update` 每 250 ms 调 `CarrierWorld.steer()`，舵令变化时立即、平时每秒广播 `fleet {T, s: [[x, z, yaw, r, heel, cmd], ...]}`（`round.fleet` 也带）；服务器自己也采用取整后的状态，浏览器 `applySnap` 后用同一个模型积分，所以两边的甲板位置一致。航迹记录 150 s（`FLEET.hist`），服务器重放炸弹/鱼雷时按当时的位置（`update(t)` 对过去的时间插值）。
- **规避 AI**（`steer`，小型模型预测控制）：威胁 = 已投下的炸弹（服务器按种子重飞，求到达甲板高度的时间和落点）和在水中航行的鱼雷（起点、方向、时间），外加**预判**：俯冲中的敌方轰炸机（"现在投弹"的落点）、低空高速的鱼雷机（"现在投雷"的航迹）。对每艘船试 5×5 种舵令组合（前 10 s 一个舵、之后另一个），用船的模型前推最多 75 s，按威胁离船体/甲板的距离打分（命中最重；鱼雷命中按离船头/船尾的距离给梯度，引导"让它从船头或船尾过去"或对准鱼雷"梳过去"），加上偏离基准航向、与本舰队其他船太近（< 400 m）、舵令变化的代价，取最优的第一个舵令。没有威胁时用 PD 舵回到基准航向（航母回到原来的航道，驱逐舰回到护航阵位）。离线练习时浏览器自己跑 AI（`CarrierMap.offlineRelease/offlineHelm`）。
- 测试（jsc）：750 m 以外从斜向投的鱼雷基本都能躲开；1.1 km 正横的鱼雷暴力枚举所有舵令也躲不开（物理极限，靠预判提前转向）；投弹后几秒才落地的俯冲轰炸躲不开（但预判会在对方俯冲时提前转向）。
- **几何**全部改为舰体坐标：`loc(ship, x, z, h)`（世界 → 舰体，含横倾造成的侧移）、`toWorld`、`deckY`（横倾甲板高度）、`deckNormal/deckNormalAt`。`FlightPhysics` 新增 `opts.deckNormal`：轮子的法向力沿倾斜甲板的法线。
- 甲板参考系（`CarrierMap.before/after`）：按航母这一帧的真实位姿变化**连同转向**搬运飞机（位置、航向四元数、速度），减去机下甲板点的速度（含 ω×r）。停在甲板上、油门低时有**轮挡**（保持相对甲板的航向，消掉横向滑动，否则尾轮式飞机会在倾斜甲板上风标式偏转）；**弹射**时弹射梭把机头对准甲板轴线并消掉侧滑。拦阻索、弹射位置、触地都用舰体坐标。
- 画面：船体按 `yaw` 转向、按 `heel` 横倾（group `rotation.order = 'YXZ'`）；AA 炮位、烟囱烟、受损烟火都用 `toWorld`；新增**弯曲尾迹**（`CarrierMap` 的 `Wake`：沿舰尾实际航迹的泡沫带，随时间变宽变淡）；小地图/雷达上的舰船按航向旋转；导航栏显示 "enemy evading"。
