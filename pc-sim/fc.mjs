// 用阿里云 FC OpenAPI 查询/更新函数（RPC 风格签名）
// 用法：node fc.mjs <Action> [k=v ...]
import crypto from 'node:crypto';
import fs from 'node:fs';

const AK = process.env.ALI_AK;
const SK = process.env.ALI_SK;
const REGION = process.env.ALI_REGION || 'cn-hangzhou';
const HOST = `fc.${REGION}.aliyuncs.com`;

function pct(s) {
  return encodeURIComponent(String(s)).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}
function sign(params) {
  const p = {
    Format: 'JSON', Version: '2016-08-15', AccessKeyId: AK,
    SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0',
    SignatureNonce: String(Date.now()) + Math.random().toString(36).slice(2),
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    ...params
  };
  const qs = Object.keys(p).sort().map(k => pct(k) + '=' + pct(p[k])).join('&');
  const sts = 'GET&' + pct('/') + '&' + pct(qs);
  const sig = crypto.createHmac('sha1', SK + '&').update(sts).digest('base64');
  return qs + '&Signature=' + pct(sig);
}

const [action, ...kv] = process.argv.slice(2);
const params = { Action: action };
for (const item of kv) {
  const i = item.indexOf('=');
  params[item.slice(0, i)] = item.slice(i + 1);
}
const url = `https://${HOST}/?` + sign(params);
const r = await fetch(url, { method: 'GET' });
const text = await r.text();
console.log('HTTP ' + r.status);
console.log(text.slice(0, Number(process.env.SHOW || 3000)));
