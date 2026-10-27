/**
 * FAST 中转服务（Cloudflare Worker）
 *
 * 为什么要它：以前编辑器把 SeaTable 的 API Token 硬编码在 editor.js 里，
 * 打包成 APK 发出去 = 谁都能从包里抠出这个 token，直接读写整张「账号」表和「社区」表。
 * 现在所有云请求都先打到这里，token 只作为 Cloudflare 的加密环境变量存在（SEATABLE_TOKEN），
 * APK 里一个凭据都没有。
 *
 * 环境变量（已通过 API 写入你账号的 Worker，见 README）：
 *   SEATABLE_TOKEN  SeaTable 的 API Token
 *   SEATABLE_UUID   基础表 UUID（可选，有默认值）
 *   SEATABLE_SRV    服务器地址（可选，默认 https://cloud.seatable.cn）
 *
 * 路由：
 *   GET  /health                       自检，返回 {"ok":true}
 *   GET  /api?p=<路径>&q=<查询串>&m=GET
 *   POST /api   body = { p, m, q, b, ct }
 *        · b 是普通对象 → JSON 转发
 *        · b 是字符串   → 附件上传的 multipart 体（JS 侧按"一字符=一字节"传过来），
 *                        按 latin1 还原成二进制原样转发，Content-Type 用 ct
 *   GET  /api/download?path=<相对路径>  附件下载：自动补 token 后流回给客户端
 *
 * 只有白名单里的接口能穿过去（见 ALLOW），别的一律 403 —— 不会变成开放代理。
 */

const DEFAULT_UUID = '712bc4e0-a7b0-48ff-b5ea-098ce7eb3252';
const DEFAULT_SRV = 'https://cloud.seatable.cn';
// 允许客户端指定的基础表（只放行这两张，客户端传别的会被拒）：
//   账号/社区 = 712bc4e0…，「更新」表 = 5ded0202…
const OK_UUIDS = [
  '712bc4e0-a7b0-48ff-b5ea-098ce7eb3252',
  '5ded0202-5402-4176-bde2-69a5f7c14af6'
];

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
    'Access-Control-Allow-Headers': 'Content-Type,Accept,X-Fast-Client,X-Fast-Ct',
    'Access-Control-Max-Age': '86400'
  };
}
const j = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors() }
});
function allowed(p) { for (const a of ALLOW) if (p.indexOf(a) === 0) return true; return false; }

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (u.pathname === '/' || u.pathname === '/health') return j({ ok: true, service: 'fast-cloud' });
    if (u.pathname !== '/api' && u.pathname !== '/api/download') return j({ error: 'not found' }, 404);

    const TOKEN = env.SEATABLE_TOKEN;
    const UUID = env.SEATABLE_UUID || DEFAULT_UUID;
    const SRV = (env.SEATABLE_SRV || DEFAULT_SRV).replace(/\/+$/, '');
    if (!TOKEN) return j({ error: '服务端还没配置 SEATABLE_TOKEN' }, 500);

    // ---- 附件下载：/api/download?path=files/2026-09/x.fast ----
    // 下载接口给的是 seafhttp 的临时地址，中转可以直接把文件流回客户端，
    // 这样作品文件/图标/头像都不用再单独申请直链。
    if (u.pathname === '/api/download') {
      const path = u.searchParams.get('path') || '';
      if (!path || path.indexOf('//') >= 0 || path.indexOf('..') >= 0) return j({ error: 'bad path' }, 400);
      const linkRes = await fetch(SRV + '/api/v2.1/dtable/app-download-link/?path=' + encodeURIComponent(path),
        { headers: { Authorization: 'Token ' + TOKEN } });
      if (!linkRes.ok) return new Response(await linkRes.text(), { status: linkRes.status, headers: { 'Content-Type': 'application/json', ...cors() } });
      const data = await linkRes.json();
      let url = String(data.download_link || '');
      if (!url) return j({ error: '没拿到下载地址' }, 502);
      if (url[0] === '/') url = SRV + url;
      if (!/[?&]token=/.test(url)) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
      const fr = await fetch(url);
      if (!fr.ok) return j({ error: '下载失败 HTTP ' + fr.status }, 502);
      const h = new Headers(cors());
      h.set('Content-Type', fr.headers.get('Content-Type') || 'application/octet-stream');
      const len = fr.headers.get('Content-Length');
      if (len) h.set('Content-Length', len);
      return new Response(fr.body, { status: 200, headers: h });
    }

    let p = '', m = 'GET', q = '', body = null, ct = '', uu = '';
    if (req.method === 'GET') {
      p = u.searchParams.get('p') || '';
      q = u.searchParams.get('q') || '';
      m = (u.searchParams.get('m') || 'GET').toUpperCase();
      uu = u.searchParams.get('u') || '';
    } else {
      let body0 = null;
      try { body0 = await req.json(); } catch (e) { body0 = null; }
      if (!body0) return j({ error: 'bad json' }, 400);
      p = body0.p || ''; q = body0.q || ''; body = body0.b; ct = body0.ct || ''; uu = body0.u || '';
      m = String(body0.m || 'POST').toUpperCase();
    }
    if (p.indexOf('/') !== 0) p = '/' + p;
    if (!allowed(p)) return j({ error: 'path not allowed' }, 403);
    // 表 UUID 一律以服务端白名单为准：客户端就算传了别的库也会被拒/被换回来
    const USE_UUID = uu && OK_UUIDS.indexOf(uu) >= 0 ? uu : UUID;
    p = p.replace(/\/api\/v2\/dtables\/[^/]+\//, '/api/v2/dtables/' + USE_UUID + '/');

    const target = SRV + p + (q ? (q[0] === '?' ? q : '?' + q) : '');
    const headers = { Authorization: 'Token ' + TOKEN, Accept: 'application/json' };
    const isUpload = /\/seafhttp\/|\/files\/|\/upload/.test(p);
    let sendBody;
    if (body !== undefined && body !== null && m !== 'GET' && m !== 'HEAD') {
      if (isUpload && typeof body === 'string') {
        // multipart：JS 侧一字符=一字节，这里用 latin1 原样还原成二进制
        const bin = new Uint8Array(body.length);
        for (let i = 0; i < body.length; i++) bin[i] = body.charCodeAt(i) & 0xff;
        sendBody = bin;
        headers['Content-Type'] = ct || req.headers.get('X-Fast-Ct') || 'multipart/form-data';
      } else if (typeof body === 'string') {
        headers['Content-Type'] = ct || 'application/json';
        sendBody = body;
      } else {
        headers['Content-Type'] = 'application/json';
        sendBody = JSON.stringify(body);
      }
    }

    let r;
    try { r = await fetch(target, { method: m, headers, body: sendBody }); }
    catch (e) { return j({ error: '上游连不上：' + (e && e.message || e) }, 502); }

    const buf = await r.arrayBuffer();
    const hdr = new Headers(cors());
    hdr.set('Content-Type', r.headers.get('Content-Type') || 'application/json; charset=utf-8');
    return new Response(buf, { status: r.status, headers: hdr });
  }
};
