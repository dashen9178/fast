/**
 * FAST 中转服务（Cloudflare Worker）
 *
 * 为什么要它：以前编辑器把 SeaTable 的 API Token 硬编码在 editor.js 里，
 * 打包成 APK 发出去 = 谁都能从包里抠出这个 token，直接读写整张「账号」表和「社区」表。
 * 现在所有云请求都先打到这里，token 只作为 Cloudflare 的加密环境变量存在（SEATABLE_TOKEN），
 * APK 里一个凭据都没有。
 *
 * 环境变量（在 Cloudflare 控制台里配，不要写进代码）：
 *   SEATABLE_TOKEN  SeaTable 的 API Token
 *   SEATABLE_UUID   基础表 UUID（可选，缺省用下面这个）
 *   SEATABLE_SRV    服务器地址（可选，缺省 https://cloud.seatable.cn）
 *
 * 路由：
 *   POST /api   body = { p: 路径, m: 方法, q: 查询串, b: 请求体 }
 *   GET  /api?p=路径&q=查询串
 *   允许的路径白名单见 ALLOW：只有账号/社区用得到的几个接口能穿过去，
 *   万一 Worker 地址被外人知道，也做不了别的事（读不了别的表、也不能当开放代理）。
 */

const DEFAULT_UUID = '712bc4e0-a7b0-48ff-b5ea-098ce7eb3252';
const DEFAULT_SRV = 'https://cloud.seatable.cn';

// 只放行这几个接口（前缀匹配）：
//   app-access-token    换访问令牌
//   app-upload-link     取上传地址
//   app-download-link   取附件下载地址
//   dtables/<uuid>/     读/写行、读表结构
//   seafhttp/           附件上传（上传链接指向这里）
//   files/              附件上传的另一种形式
const ALLOW = [
  '/api/v2.1/dtable/app-access-token/',
  '/api/v2.1/dtable/app-upload-link/',
  '/api/v2.1/dtable/app-download-link/',
  '/api/v2/dtables/',
  '/seafhttp/',
  '/files/'
];

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept,X-Fast-Client',
    'Access-Control-Max-Age': '86400'
  };
}

function 允许(p) {
  for (const a of ALLOW) if (p.indexOf(a) === 0) return true;
  return false;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    if (u.pathname === '/' || u.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'fast-cloud' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors() } });
    }
    if (u.pathname !== '/api') {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors() } });
    }

    const TOKEN = env.SEATABLE_TOKEN;
    const UUID = env.SEATABLE_UUID || DEFAULT_UUID;
    const SRV = (env.SEATABLE_SRV || DEFAULT_SRV).replace(/\/+$/, '');
    if (!TOKEN) {
      return new Response(JSON.stringify({ error: '服务端还没配置 SEATABLE_TOKEN' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors() } });
    }

    let p = '', m = 'GET', q = '', body = null;
    if (req.method === 'GET') {
      p = u.searchParams.get('p') || '';
      q = u.searchParams.get('q') || '';
      m = (u.searchParams.get('m') || 'GET').toUpperCase();
    } else {
      let j = null;
      try { j = await req.json(); } catch (e) { j = null; }
      if (!j) return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors() } });
      p = j.p || ''; q = j.q || ''; body = j.b;
      m = String(j.m || 'POST').toUpperCase();
    }
    if (p.indexOf('/') !== 0) p = '/' + p;

    // 只有我们自己这几个接口能过，别的一律拒 —— 免得变成开放代理被人拿去干别的
    if (!允许(p)) {
      return new Response(JSON.stringify({ error: 'path not allowed' }), { status: 403, headers: { 'Content-Type': 'application/json', ...cors() } });
    }
    // 表 UUID 一律以环境变量为准：客户端就算传了别的库，也会被换回来
    p = p.replace(/\/api\/v2\/dtables\/[^/]+\//, '/api/v2/dtables/' + UUID + '/');

    const target = SRV + p + (q ? (q[0] === '?' ? q : '?' + q) : '');
    const headers = { Authorization: 'Token ' + TOKEN, Accept: 'application/json' };
    const isUpload = /\/seafhttp\/|\/files\/|\/upload/.test(p);
    let sendBody;
    if (body !== undefined && body !== null && m !== 'GET' && m !== 'HEAD') {
      if (isUpload) {
        // 附件上传：客户端把 multipart 体当字符串放在 b.s（一字符=一字节），这里原样转发二进制
        if (typeof body === 'string') { sendBody = body; }
        else if (body && typeof body.s === 'string') {
          const bin = new Uint8Array(body.s.length);
          for (let i = 0; i < body.s.length; i++) bin[i] = body.s.charCodeAt(i) & 0xff;
          sendBody = bin;
          if (body.ct) headers['Content-Type'] = body.ct;
        } else { sendBody = JSON.stringify(body); }
      } else {
        headers['Content-Type'] = 'application/json';
        sendBody = JSON.stringify(body);
      }
    }

    let r;
    try {
      r = await fetch(target, { method: m, headers, body: sendBody });
    } catch (e) {
      return new Response(JSON.stringify({ error: '上游连不上：' + (e && e.message || e) }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...cors() } });
    }
    const buf = await r.arrayBuffer();
    // 原样把上游响应带回去（含状态码和类型），客户端不用改解析逻辑
    const hdr = new Headers(cors());
    const ct = r.headers.get('content-type');
    if (ct) hdr.set('Content-Type', ct);
    return new Response(buf, { status: r.status, headers: hdr });
  }
};
