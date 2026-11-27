# gh-proxy

Cloudflare Worker 实现的 **GitHub 只读反代网关**。免费 `*.workers.dev` 域名即可，无需买域名。

> ⚠️ 这是 HTTP 反向代理，**不是 VPN / 代理节点**。Cloudflare 服务条款禁止把 Workers 当作网络代理使用，本项目仅中转 GitHub 的 HTTP 流量。

## 路由

| 路径 | 转发到 | 说明 |
|---|---|---|
| `/health` | — | 健康检查，返回 JSON |
| `/raw/<owner>/<repo>/<ref>/<path>` | `raw.githubusercontent.com` | 带缓存 |
| `/api/<endpoint>` | `api.github.com` | 自动注入 GITHUB_TOKEN |
| `/gh/<path>` | `github.com` | 全透传，自动跟随 302 |
| `/object/<path>` | `objects.githubusercontent.com` | Release 资产直达 |

## 用法

```bash
# raw
curl "https://gh-proxy.xxx.workers.dev/raw/octocat/Hello-World/master/README"

# API（服务端自动带 token）
curl "https://gh-proxy.xxx.workers.dev/api/repos/octocat/Hello-World"

# 网页透传
curl -L "https://gh-proxy.xxx.workers.dev/gh/octocat/Hello-World"

# Release 资产
curl -L "https://gh-proxy.xxx.workers.dev/gh/cli/cli/releases/latest"
```

## 部署

```bash
cd gh-proxy
npm install
npx wrangler login
npx wrangler deploy
```

## 注入密钥（务必做，别写进文件）

```bash
# 1. GitHub PAT：只勾 public_repo（或只读权限）
npx wrangler secret put GITHUB_TOKEN

# 2. 访问口令：随机串
npx wrangler secret put AUTH_TOKEN
```

之后所有请求需带：

```
?token=<AUTH_TOKEN>
```

或 Header：

```
x-proxy-token: <AUTH_TOKEN>
```

## 测试

```bash
chmod +x test.sh
./test.sh https://gh-proxy.xxx.workers.dev <AUTH_TOKEN>
```

## 限制

- 免费版每天 10 万次请求。
- 超大 Release 资产（数十 MB 以上）可能因 Worker 内存/时长限制失败。
- `/api` 匿名限额 60 次/小时；配了 `GITHUB_TOKEN` 提升到 5000 次/小时。
- 仅中转 HTTP 请求，不做隧道/VPN。

## 安全提醒

**任何贴到聊天、截图、公开地方的 GitHub token 都视为已泄露，请立即 Revoke 并重新生成。**
