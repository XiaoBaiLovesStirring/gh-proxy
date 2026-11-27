# gh-proxy

两个独立的 Cloudflare Worker，解决 GitHub 的两件事：

| 目录 | 作用 | Worker 名 |
|---|---|---|
| `web/` | **打开 github.com 网页界面** | `gh-web` |
| `dl/`  | **下载加速**：raw / Release / archive / git clone | `gh-dl` |

每个目录都是独立可部署的 Worker（含 `wrangler.toml` + `worker.js`）。
Cloudflare Dashboard 的「连接 Git 仓库」可以分别指向两个目录部署。

---

## GitHub 网页反代（web/）

部署后：

```
https://你的域名/github.com/octocat/Hello-World
https://你的域名/https://github.com/octocat/Hello-World
```

也可以：

```
https://你的域名/github.com/用户/仓库/issues
https://你的域名/github.com/用户/仓库/pulls
```

**限制（先说清楚）：**
- 只放行 GitHub 域名，不是开放代理。
- **不能登录**：GitHub 的 cookie 域绑定 `github.com`，经反代后登录会崩，这是硬限制。
- 私有仓库看不了。
- 部分 JS 会加载失败（资源跨域），页面功能可能不完整。

> 如果你只是想“不翻墙也能打开 GitHub 网页”，更省事且真正稳的方案是 **Cloudflare WARP**（1.1.1.1 客户端），不是 Worker。Worker 反代网页这条路天生残缺。

## 下载加速（dl/）

```
# raw 文件
https://你的域名/raw.githubusercontent.com/nvm-sh/nvm/master/install.sh

# Release 下载
https://你的域名/github.com/cli/cli/releases/download/v2.40.0/gh_2.40.0_linux_amd64.tar.gz

# 源码包
https://你的域名/github.com/octocat/Hello-World/archive/refs/heads/master.zip

# GitHub API
https://你的域名/api.github.com/repos/octocat/Hello-World

# git clone（公开仓库，只读）
git clone https://你的域名/https://github.com/torvalds/linux.git
```

---

## 部署方式（二选一）

### A. Dashboard 网页部署（手机可用）

对 `web/worker.js` 和 `dl/worker.js` **各新建一个 Worker**，把文件内容粘进编辑器，部署即可。
不需要 wrangler.toml，代码里没有任何依赖。

### B. 连接 Git 仓库（推荐，自动构建）

1. Fork 本仓库
2. Workers & Pages → 创建 → 连接 Git 仓库 → 选 fork 后的仓库
3. **根目录设为 `web`**，部署 → 得到 gh-web
4. 再重复一次，**根目录设为 `dl`** → 得到 gh-dl

### C. 本地 wrangler

```bash
cd web && npx wrangler deploy
cd ../dl && npx wrangler deploy
```

---

## 限制

- 免费版 10 万请求/天。
- 单文件上限 100MB（Cloudflare 侧限制）。
- `git clone` 只读，不支持 push、不支持 Git LFS。
- 网页反代不支持登录。

## 安全

- 不要把 GitHub token 写进任何文件，用 `wrangler secret put`。
- 反代只允许 GitHub 域名，避免被人拿去做开放代理（这也是 Cloudflare 条款的要求）。
