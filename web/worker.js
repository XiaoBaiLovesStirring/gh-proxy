/**
 * GitHub 网页反代 Worker (web.js)
 * 用途：用你的 worker 域名访问 github.com 网页界面
 * 部署后访问：https://你的域名/https://github.com/用户/仓库
 * 或          https://你的域名/github.com/用户/仓库
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-allow-headers': '*',
};

function help(origin) {
  return new Response(
`GitHub Web Proxy

用法：
  ${origin}/github.com/<owner>/<repo>
  ${origin}/https://github.com/<owner>/<repo>

示例：
  ${origin}/github.com/octocat/Hello-World
`,
    { headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } }
  );
}

// 把 html 里指向 github 的绝对地址改写成经过本代理
function rewriteHtml(html, origin) {
  const esc = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html
    .replace(/https?:\/\/([a-z]+\.)?github\.com/g, `${origin}/github.com`)
    .replace(/https?:\/\/([a-z]+\.)?githubusercontent\.com/g, `${origin}/raw.githubusercontent.com`)
    .replace(/https?:\/\/github\.assets\.com/g, `${origin}/github.assets.com`)
    .replace(/https?:\/\/([a-z]+\.)?githubassets\.com/g, `${origin}/githubassets.com`);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // 解析目标
    let targetStr;
    if (url.pathname.startsWith('/https://') || url.pathname.startsWith('/http://')) {
      targetStr = url.pathname.slice(1) + url.search;
    } else {
      const m = url.pathname.match(/^\/([a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i);
      if (!m) return help(url.origin);
      targetStr = `https://${m[1]}${m[2] || '/'}` + url.search;
    }

    let target;
    try {
      target = new URL(targetStr);
    } catch {
      return help(url.origin);
    }

    // 只允许 GitHub 系域名，防止被人拿来当开放代理
    const ALLOWED = /(^|\.)(github\.com|githubusercontent\.com|githubassets\.com|github\.io|github\.blog)$/i;
    if (!ALLOWED.test(target.hostname)) {
      return new Response('仅允许 GitHub 域名', { status: 403, headers: CORS });
    }

    // 构造上游请求
    const headers = new Headers();
    for (const h of ['accept', 'accept-language', 'content-type', 'range', 'cookie', 'if-none-match', 'if-modified-since']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('user-agent', UA);
    headers.set('host', target.host);
    headers.set('referer', `https://${target.host}/`);

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    };

    let resp = await fetch(target.toString(), init);

    // 手动跟随跳转，跳转地址改写回本代理
    let hop = 0;
    while ([301, 302, 303, 307, 308].includes(resp.status) && hop < 5) {
      const loc = resp.headers.get('location');
      if (!loc) break;
      const next = new URL(loc, target).toString();
      resp = await fetch(next, init);
      hop++;
    }

    // 回写响应头
    const out = new Headers();
    for (const [k, v] of resp.headers) {
      const key = k.toLowerCase();
      if (['set-cookie', 'content-security-policy', 'content-security-policy-report-only',
           'x-frame-options', 'strict-transport-security', 'clear-site-data'].includes(key)) continue;
      if (key === 'location') {
        out.set('location', v.replace(/https?:\/\/([a-z]+\.)?github\.com/g, `${url.origin}/github.com`));
        continue;
      }
      out.set(k, v);
    }
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);

    const ct = out.get('content-type') || '';
    if (ct.includes('text/html')) {
      let html = await resp.text();
      html = rewriteHtml(html, url.origin);
      out.delete('content-length');
      out.set('content-length', String(new TextEncoder().encode(html).length));
      return new Response(html, { status: resp.status, headers: out });
    }

    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
