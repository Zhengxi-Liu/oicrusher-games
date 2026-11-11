# 密码和密钥

这个仓库里**没有**任何密码或密钥。

## 在仓库里被替换掉的值

`.gitattributes` 给代码文件（php / html / js / sql / md / txt / json）挂了一个叫 `secrets` 的 git 过滤器：

| 占位符 | 是什么 |
|---|---|
| `__ADMIN_PASSWORD_HASH__` | 排行榜管理员密码的 SHA-256（Snake、Tetris、Doodle Jump、Geometry Dash、Mud Runner 的删分 / 公告） |
| `__OLD_ADMIN_PASSWORD__` | 旧的明文管理员密码（`announcement_update.php` 和几个旧版 snake 文件） |

- 提交时（clean），真实值换成占位符。
- 检出时（smudge），占位符换回真实值。
- 工作目录里的文件一直是真实值，所以照常部署就行。

过滤器命令（含真实值）只在本机的 `.git/config` 里，不会被推送。

在新机器上克隆后要恢复真实值：

```bash
git config filter.secrets.clean  "sed -e 's/<真实hash>/__ADMIN_PASSWORD_HASH__/g' -e 's/<旧密码>/__OLD_ADMIN_PASSWORD__/g'"
git config filter.secrets.smudge "sed -e 's/__ADMIN_PASSWORD_HASH__/<真实hash>/g' -e 's/__OLD_ADMIN_PASSWORD__/<旧密码>/g'"
git config filter.secrets.required true
git checkout -- . && git rm --cached -r -q . && git reset -q    # 重新检出，让 smudge 生效
```

没配过滤器时，文件里就是占位符：游戏能玩，只是管理员删分 / 公告功能用不了。

## 从来不在代码里的密钥

它们只在服务器上，不在仓库里：

| 文件 | 用途 |
|---|---|
| `/etc/oicrusher/identity.secret` | PHP 和 Node 共用的身份签名密钥，见 [IDENTITY.md](IDENTITY.md) |
| `/etc/oicrusher/gemini.key` | TJ Hide and Seek 的 Gemini 审核，见 [TJ_HIDE_SEEK.md](TJ_HIDE_SEEK.md) |

数据库用本机 MySQL 的 `root`，没有密码，只能在服务器本机连。

## 提交前自查

```bash
git grep -I -n -E "AIza[0-9A-Za-z_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY" $(git rev-list --all)
```

这条命令应该没有任何输出。
