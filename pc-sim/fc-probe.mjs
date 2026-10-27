// 穷举 FC 2.0 REST 签名的格式变体，找出服务器接受的那一种
import crypto from 'node:crypto';

const AK = process.env.ALI_AK;
const SK = process.env.ALI_SK;
const REGION = process.env.ALI_REGION || 'cn-hangzhou';
const HOST = `fc.${REGION}.aliyuncs.com`;
const PATH = '/2021-04-06/services';

const EMPTY_SHA = crypto.createHash('sha256').update('', 'utf8').digest('hex');

async function attempt(label, { keyMode, stsBuild }) {
  const date = new Date().toUTCString();
  const nonce = String(Date.now()) + Math.floor(Math.random() * 1000);
  const acs = { 'x-acs-signature-nonce': nonce, 'x-acs-version': '2021-04-06' };
  const names = Object.keys(acs).sort();
  const chTrail = names.map(k => k + ':' + acs[k] + '\n').join('');
  const chNoTrail = names.map(k => k + ':' + acs[k]).join('\n');
  const signedHeaders = names.join(';');
  const accept = 'application/json';

  const sts = stsBuild({ method: 'GET', accept, EMPTY_SHA, date, chTrail, chNoTrail, signedHeaders, path: PATH });
  const key = keyMode === 'plain' ? SK : SK + '&';
  const sig = crypto.createHmac('sha256', key).update(sts).digest('base64');

  const r = await fetch(`https://${HOST}${PATH}`, {
    headers: {
      Accept: accept, Date: date,
      'x-acs-signature-nonce': nonce, 'x-acs-version': '2021-04-06',
      Authorization: `acs ${AK}:${sig}`,
    },
  });
  const t = await r.text();
  const ok = r.status === 200;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} -> HTTP ${r.status} ${ok ? t.slice(0, 300) : ''}`);
  return ok;
}

const variants = [
  ['A emptyHash/chNoTrail/&', { keyMode: 'amp', stsBuild: v => [v.method, v.accept, '', '', v.date, v.chNoTrail, v.path].join('\n') }],
  ['B hexHash/chNoTrail/&', { keyMode: 'amp', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chNoTrail, v.path].join('\n') }],
  ['C hexHash/chTrail+signed/&', { keyMode: 'amp', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chTrail + v.signedHeaders, v.path].join('\n') }],
  ['D hexHash/chTrail/&', { keyMode: 'amp', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chTrail, v.path].join('\n') }],
  ['E emptyHash/chNoTrail/plain', { keyMode: 'plain', stsBuild: v => [v.method, v.accept, '', '', v.date, v.chNoTrail, v.path].join('\n') }],
  ['F hexHash/chNoTrail/plain', { keyMode: 'plain', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chNoTrail, v.path].join('\n') }],
  ['G hexHash/chTrail+signed/plain', { keyMode: 'plain', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chTrail + v.signedHeaders, v.path].join('\n') }],
  ['H hexHash/chTrail/plain', { keyMode: 'plain', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chTrail, v.path].join('\n') }],
  ['I emptyHash/chTrail+signed/&', { keyMode: 'amp', stsBuild: v => [v.method, v.accept, '', '', v.date, v.chTrail + v.signedHeaders, v.path].join('\n') }],
  ['J hexHash/chTrail+signed/gmtNoDate', { keyMode: 'amp', stsBuild: v => [v.method, v.accept, v.EMPTY_SHA, '', v.date, v.chTrail + v.signedHeaders, v.path].join('\n') }],
];

let done = false;
for (const [label, cfg] of variants) {
  if (done) break;
  try { done = await attempt(label, cfg); } catch (e) { console.log('ERR ' + label + ' ' + e.message); }
}
console.log(done ? '找到可用格式' : '全部失败');
