// 阿里云 FC 2.0（2021-04-06）REST 签名 —— 公式按服务器返回的 server string to sign 反推：
//   METHOD\nAccept\nbodyHash\ncontentMd5\nDate\n<canonicalHeaders>\n<signedHeaders>\nPATH
// 其中 canonicalHeaders = 每个小写头名:去空格值 各带一个 \n 拼接
// 用法：node fc2.mjs <METHOD> <PATH> [jsonBodyFile]
import crypto from 'node:crypto';
import fs from 'node:fs';

const AK = process.env.ALI_AK;
const SK = process.env.ALI_SK;
const REGION = process.env.ALI_REGION || 'cn-hangzhou';
const HOST = `fc.${REGION}.aliyuncs.com`;

function signRest(method, path, queries, headers, body) {
  const qs = Object.keys(queries).sort().map(k => encodeURIComponent(k) + '=' + encodeURIComponent(queries[k])).join('&');
  const date = new Date().toUTCString();
  const bodyHash = crypto.createHash('sha256').update(body || '', 'utf8').digest('hex');
  const md5 = body ? crypto.createHash('md5').update(body, 'utf8').digest('base64') : '';
  const acsHeaders = {};
  for (const k of Object.keys(headers)) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-acs-') || lk === 'content-type' || lk === 'content-md5') acsHeaders[lk] = String(headers[k]).trim();
  }
  const names = Object.keys(acsHeaders).sort();
  const canonicalHeaders = names.map(k => k + ':' + acsHeaders[k] + '\n').join('');
  const signedHeaders = names.join(';');
  const accept = acsHeaders['content-type'] || headers.Accept || 'application/json';
  const stringToSign = [method, accept, bodyHash, md5, date, canonicalHeaders + signedHeaders, path].join('\n');
  if (process.env.DBG_STS) console.log('---MY-STS---\n' + JSON.stringify(stringToSign) + '\n---END---');
  const key = process.env.ALI_KEYMODE === 'plain' ? SK : SK + '&';
  const sig = crypto.createHmac('sha256', key).update(stringToSign).digest('base64');
  const url = `https://${HOST}${path}${qs ? '?' + qs : ''}`;
  const finalHeaders = { ...headers, Date: date, 'x-acs-signature-nonce': String(Date.now()), Authorization: `acs ${AK}:${sig}` };
  return { url, headers: finalHeaders, stringToSign };
}

const [method, path, bodyFile] = process.argv.slice(2);
const body = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : '';
const headers = { 'x-acs-version': '2021-04-06', Accept: 'application/json' };
if (body) headers['Content-Type'] = 'application/json';
const { url, headers: h, stringToSign } = signRest(method.toUpperCase(), path, {}, headers, body);
const r = await fetch(url, { method: method.toUpperCase(), headers: h, body: body || undefined });
const text = await r.text();
console.log('HTTP ' + r.status);
console.log(text.slice(0, Number(process.env.SHOW || 2500)));
