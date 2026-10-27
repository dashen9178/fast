// 阿里云 FC OpenAPI —— RPC 风格签名（待签串格式取自服务器返回的提示）
// 用法：node fc3.mjs <Action> [k=v ...]   例：node fc3.mjs GetService k=svc
import crypto from 'node:crypto';

const AK = process.env.ALI_AK;
const SK = process.env.ALI_SK;
const REGION = process.env.ALI_REGION || 'cn-hangzhou';
const HOST = `fc.${REGION}.aliyuncs.com`;
const VERSION = process.env.ALI_VER || '2016-08-15';

const pct = s => encodeURIComponent(String(s)).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');

export function rpcCall(action, params, opts = {}) {
  const P = {
    Action: action,
    Version: VERSION,
    Format: 'JSON',
    AccessKeyId: AK,
    SignatureMethod: 'HMAC-SHA256',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...params,
  };
  const qs = Object.keys(P).sort().map(k => pct(k) + '=' + pct(P[k])).join('&');
  const sts = 'POST' + '&' + pct('/') + '&' + pct(qs);
  const sig = crypto.createHmac('sha256', SK + '&').update(sts).digest('base64');
  const url = `https://${HOST}/?Signature=${pct(sig)}`;
  const { method = 'POST', headers = {}, body } = opts;
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: method === 'GET' ? undefined : Object.keys(P).sort().map(k => pct(k) + '=' + pct(P[k])).join('&'),
  });
}

if (process.argv[1] && process.argv[1].endsWith('fc3.mjs')) {
  const [action, ...kvs] = process.argv.slice(2);
  const params = {};
  for (const kv of kvs) { const i = kv.indexOf('='); params[kv.slice(0, i)] = kv.slice(i + 1); }
  const r = await rpcCall(action, params, { method: process.env.ALI_METHOD || 'POST' });
  const t = await r.text();
  console.log('HTTP ' + r.status);
  console.log(t.slice(0, Number(process.env.SHOW || 3000)));
}
