/**
 * GitHub 下载加速 Worker (dl.js)
 * 支持：raw 文件、Release 下载、archive 源码包、git clone（只读）
 *
 * 用法（Path 风格，直接拼在前面）：
 *   /github.com/<owner>/<repo>/releases/download/<tag>/<file>
 *   /github.com/<owner>/<repo>/archive/<ref>.zip
 *   /raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
 *   /objects.githubusercontent.com/<path>
 *   /codeload.github.com/<owner>/<repo>/zip/<ref>
 *   /api.github.com/<endpoint>
 *
 * git clone：
 *   git clone https://你的域名/https://github.com/owner/repo.git
 */

const UA = 'Mozilla/5.0 (compatible; gh-dl-proxy)';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-length,content-range,content-disposition,etag',
}; 

const ALLOWED = /(^|\.)(github\.com|githubusercontent\.com|codeload\.github\.com|objects\.githubusercontent\.com|api\.github\.com|gist\.github\.com|gist\.githubusercontent\.com)$/i;

function help(origin) {
  return new Response(
`GitHub Download Proxy

${origin}/github.com/<owner>/<repo>/releases/download/<tag>/<file>
${origin}/github.com/<owner>/<repo>/archive/<ref>.zip
${origin}/raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
${origin}/codeload.github.com/<owner>/<repo>/zip/<ref>
${origin}/api.github.com/<endpoint>

git clone ${origin}/https://github.com/<owner>/<repo>.git
`,
    { headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // 解析目标
    let targetStr;
    if (url.pathname.startsWith('/https://') || url.pathname.startsWith('/http://')) {
      targetStr = decodeURIComponent(url.pathname.slice(1)) + url.search;
    } else {
      const m = url.pathname.match(/^\/([a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i);
      if (!m) return help(url.origin);
      targetStr = `https://${m[1]}${m[2] || '/'}` + url.search;
    }

    let target;
    try { target = new URL(targetStr); } catch { return help(url.origin); }
    if (!ALLOWED.test(target.hostname)) return new Response('仅允许 GitHub 域名', { status: 403, headers: CORS });

    const headers = new Headers();
    for (const h of ['accept', 'accept-encoding', 'content-type', 'range', 'authorization', 'if-none-match', 'if-modified-since', 'git-protocol']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('user-agent', UA);

    // git clone 的 smart http 协议标记（重要）
    const isGit = /git-upload-pack|info\/refs/.test(target.pathname) || request.headers.get('git-protocol');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    };

    let resp = await fetch(target.toString(), init);
    let hop = 0;
    while ([301, 302, 303, 307, 308].includes(resp.status) && hop < 8) {
      const loc = resp.headers.get('location');
      if (!loc) break;
      resp = await fetch(new URL(loc, target).toString(), init);
      hop++;
    }

    const out = new Headers();
    for (const [k, v] of resp.headers) {
      const key = k.toLowerCase();
      if (['set-cookie', 'content-security-policy', 'x-frame-options'].includes(key)) continue;
      out.set(k, v);
    }
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);

    // git 协议响应不能被改写，直接透传
    if (isGit) return new Response(resp.body, { status: resp.status, headers: out });

    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
