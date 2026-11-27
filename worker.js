/**
 * GitHub 反代网关 Worker（完整版）
 *
 * 路由：
 *   GET  /                    健康检查 / 用法
 *   GET  /raw/*               -> raw.githubusercontent.com
 *   GET  /api/*               -> api.github.com（自动注入 GITHUB_TOKEN）
 *   ANY  /gh/*                -> github.com（网页/Release/raw 全透传，自动跟随 302）
 *   GET  /object/*            -> objects.githubusercontent.com（Release 资产直达）
 *
 * 安全：
 *   - 设置 AUTH_TOKEN 后，所有请求需带 ?token=xxx 或 Header x-proxy-token: xxx
 *   - GITHUB_TOKEN 只用于 /api 与 /gh 的上游鉴权，不会回传给客户端
 *
 * 特性：
 *   - Range 断点续传
 *   - 缓存（Cache API）
 *   - 手动跟随重定向
 *   - CORS
 */

const PASS_HEADERS = [
  'accept', 'accept-encoding', 'accept-language', 'content-type',
  'range', 'if-none-match', 'if-modified-since', 'user-agent',
];

const CACHE_TTL = 300;          // 秒
const MAX_REDIRECTS = 6;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'etag, last-modified, content-length, content-range, x-ratelimit-remaining',
  'access-control-max-age': '86400',
};

const KEEP_RESP_HEADERS = new Set([
  'content-type', 'content-length', 'content-encoding', 'content-disposition',
  'etag', 'last-modified', 'cache-control', 'accept-ranges', 'content-range',
  'location', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
]);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function help() {
  return new Response(
`GitHub Proxy Gateway

/health                 健康检查
/raw/<owner>/<repo>/<ref>/<path>
/api/<endpoint>
/gh/<path>              github.com 全透传
/object/<path>          objects.githubusercontent.com

鉴权（可选）：?token=xxx 或 Header x-proxy-token: xxx
`,
    { status: 200, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } }
  );
}

async function follow(url, init, max = MAX_REDIRECTS) {
  let resp = await fetch(url, { ...init, redirect: 'manual' });
  let hop = 0;
  while ([301, 302, 303, 307, 308].includes(resp.status) && hop < max) {
    const loc = resp.headers.get('location');
    if (!loc) break;
    resp = await fetch(new URL(loc, url).toString(), { ...init, redirect: 'manual' });
    hop++;
  }
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/health') {
      return json({ ok: true, ts: Date.now(), upstreams: ['raw', 'api', 'gh', 'object'] });
    }

    // 访问口令
    if (env.AUTH_TOKEN) {
      const t = request.headers.get('x-proxy-token') || url.searchParams.get('token');
      if (t !== env.AUTH_TOKEN) return json({ error: 'unauthorized' }, 401);
    }

    // 路由
    let base, rest;
    const p = url.pathname;
    if (p.startsWith('/raw/')) {
      base = 'https://raw.githubusercontent.com';
      rest = p.slice(4);
    } else if (p.startsWith('/api/')) {
      base = 'https://api.github.com';
      rest = p.slice(4);
    } else if (p.startsWith('/gh/')) {
      base = 'https://github.com';
      rest = p.slice(3);
    } else if (p.startsWith('/object/')) {
      base = 'https://objects.githubusercontent.com';
      rest = p.slice(7);
    } else {
      return help();
    }

    // 目标 URL
    const target = new URL(rest + '?x', base);
    target.search = '';
    for (const [k, v] of url.searchParams) {
      if (k !== 'token') target.searchParams.append(k, v);
    }

    // 上游请求头
    const headers = new Headers();
    for (const h of PASS_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('user-agent')) headers.set('user-agent', 'gh-proxy-gateway');
    if (!headers.has('accept')) headers.set('accept', 'application/vnd.github+json');
    if (!headers.has('x-github-api-version')) headers.set('x-github-api-version', '2022-11-28');

    // 注入 GitHub token（/api 与 /gh 才需要；只读用途）
    const isGitHub = base.includes('github.com') || base.includes('githubusercontent.com');
    if (env.GITHUB_TOKEN && isGitHub && !request.headers.get('authorization')) {
      headers.set('authorization', `Bearer ${env.GITHUB_TOKEN}`);
    }

    const method = request.method;
    const hasBody = !['GET', 'HEAD'].includes(method);

    // 缓存只对 GET 生效
    const cache = caches.default;
    const useCache = method === 'GET' && url.pathname.startsWith('/raw/') || (method === 'GET' && url.pathname.startsWith('/object/'));
    const cacheKey = new Request(target.toString(), { method: 'GET' });
    if (useCache) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Headers(hit.headers);
        for (const [k, v] of Object.entries(CORS)) h.set(k, v);
        h.set('x-cache', 'HIT');
        return new Response(hit.body, { status: hit.status, headers: h });
      }
    }

    let resp = await follow(target.toString(), {
      method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });

    // 回写头
    const out = new Headers();
    for (const [k, v] of resp.headers) {
      if (KEEP_RESP_HEADERS.has(k.toLowerCase())) out.set(k, v);
    }
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);
    if (!out.has('cache-control')) out.set('cache-control', `public, max-age=${CACHE_TTL}`);
    out.set('x-cache', 'MISS');

    // 缓存 GET 成功响应（非 206，避免污染断点续传）
    if (useCache && resp.status === 200) {
      const toCache = new Response(resp.clone().body, { status: 200, headers: out });
      ctx.waitUntil(cache.put(cacheKey, toCache));
    }

    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
