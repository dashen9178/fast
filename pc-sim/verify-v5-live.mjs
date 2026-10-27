// 线上 v5 中转 端到端实测：完全按 editor.js 的真实请求形状发。
// 覆盖：读行(中文列名) → 取令牌 → 取上传地址 → 二进制上传 → 写行(发布) → 读回校验 → 删行 → 附件下载
const BASE = 'https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run';
const TOK = process.env.FAST_APP_TOKEN;   // 公开仓库不写明文口令，运行前先 set FAST_APP_TOKEN
const UUID_ACC = '712bc4e0-a7b0-48ff-b5ea-098ce7eb3252';
const COMM = '\u793e\u533a';        // 社区
const ACC = '\u8d26\u53f7';          // 账号
const C = {
  user: '\u7528\u6237\u540d',        // 用户名
  file: '\u4f5c\u54c1',              // 作品
  image: '\u4f5c\u54c1\u56fe',       // 作品图
  open: '\u662f\u5426\u5f00\u6e90',  // 是否开源
  name: '\u4f5c\u54c1\u540d',        // 作品名
  sid: '\u4f5c\u54c1iD',             // 作品iD
  email: '\u7528\u6237\u90ae\u7bb1', // 用户邮箱
  acc_name: '\u8d26\u53f7\u540d',    // 账号名
};

const H = { 'X-App-Token': TOK };
const out = [];
const log = s => { out.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; log(`  [OK]   ${n}${extra ? ' :: ' + extra : ''}`); } else { fail++; log(`  [FAIL] ${n}${extra ? ' :: ' + extra : ''}`); } };

// ---- 中转 GET（整条路径+查询塞进 p，不编码 —— 与 editor.js 一致）
async function relayGet(rel, headers) {
  const r = await fetch(BASE + '/api?p=' + rel, { headers: { ...H, ...(headers || {}) } });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { status: r.status, json: j, text: t };
}
// ---- 中转 写（POST 到 /api，body = {p,m,q,b,ct}）
// 注意两种 b 的形状，和 editor.js 完全一致：
//   · 写行/改行/删行 → b 是**对象**（editorCloudHttp 第 519 行打包的就是对象）
//   · 附件上传       → b 是**字符串**（bytesLatin1，一字符=一字节的二进制）
// 传错形状会怎样：字符串走 latin-1 通道，中文会被 "ignore" 掉 → "table_id or table_name invalid"。
async function relayWrite(rel, method, b, ct) {
  const r = await fetch(BASE + '/api', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: rel, m: method, q: '', b: b, ct: ct || 'application/json' }),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { status: r.status, json: j, text: t };
}
function bytesLatin1(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }
function u8cat(list) { let n = 0; for (const a of list) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of list) { o.set(a, p); p += a.length; } return o; }

// 最小合法 PNG（1x1 红点）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  log('===== 线上 v5 中转 端到端实测 =====');
  const hz = await (await fetch(BASE + '/healthz')).json();
  ok('\u51fd\u6570\u5728\u7ebf\u4e14\u4e3a v5 \u53ca\u4ee5\u4e0a', /^v[5-9]\d*$/.test(String(hz.func_version || '')), 'func_version=' + hz.func_version);
  ok('SEATABLE_TOKEN \u5df2\u914d\u7f6e', hz.has_token === true);
  ok('SeaTable \u53ef\u8fbe', String(hz.seatable || '').indexOf('200') >= 0, String(hz.seatable));

  log('\n--- 1) \u8bfb\u884c\uff08\u5fc5\u987b\u56de\u4e2d\u6587\u5217\u540d\uff09---');
  const accTok = await relayGet('/api/v2.1/dtable/app-access-token/');
  ok('\u6362\u8bbf\u95ee\u4ee4\u724c 200', accTok.status === 200 && accTok.json && accTok.json.access_token, 'HTTP ' + accTok.status);
  const uid = (accTok.json && accTok.json.dtable_uuid) || UUID_ACC;

  const rComm = await relayGet(`/api/v2/dtables/${uid}/rows/?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
  ok('\u8bfb\u300c\u793e\u533a\u300d200', rComm.status === 200, 'HTTP ' + rComm.status);
  const commRows = (rComm.json && rComm.json.rows) || [];
  ok('\u793e\u533a\u884c\u6570\u53ef\u8bfb', Array.isArray(commRows), commRows.length + ' \u884c');
  if (commRows.length) {
    const keys = Object.keys(commRows[0]);
    const cn = [C.name, C.user, C.open, C.sid].filter(k => keys.indexOf(k) >= 0);
    ok('\u5217\u540d\u662f\u4e2d\u6587\uff08\u4e0d\u662f 0000/020Y \u4e71\u7801\uff09', cn.length >= 3,
      '\u547d\u4e2d ' + cn.length + '/4\uff1b\u5b9e\u9645\u5217=' + keys.join(','));
  } else {
    log('  (\u793e\u533a\u8868\u76ee\u524d\u65e0\u884c\uff0c\u8df3\u8fc7\u5217\u540d\u6821\u9a8c)');
  }

  const rAcc = await relayGet(`/api/v2/dtables/${uid}/rows/?table_name=${encodeURIComponent(ACC)}&limit=1000&convert_keys=true`);
  ok('\u8bfb\u300c\u8d26\u53f7\u300d200', rAcc.status === 200, 'HTTP ' + rAcc.status);
  const accRows = (rAcc.json && rAcc.json.rows) || [];

  log('\n--- 2) \u53d6\u4e0a\u4f20\u5730\u5740 + \u4e8c\u8fdb\u5236\u4e0a\u4f20\uff08\u53d1\u5e03\u7684\u7b2c\u4e00\u6b65\uff09---');
  const lk0 = await relayGet('/api/v2.1/dtable/app-upload-link/');
  ok('\u53d6\u4e0a\u4f20\u5730\u5740 200', lk0.status === 200 && lk0.json && lk0.json.upload_link, 'HTTP ' + lk0.status);
  const lk = lk0.json || {};
  const relDir = lk.img_relative_path || lk.relative_path || 'images/2026-09';
  let up = String(lk.upload_link || '');
  if (!/[?&]ret-json=1/.test(up)) up += (up.indexOf('?') >= 0 ? '&' : '?') + 'ret-json=1';
  const fname = 'v5verify_' + Date.now() + '.png';
  const B = '----fastup' + Math.random().toString(36).slice(2, 12);
  const head = '--' + B + '\r\nContent-Disposition: form-data; name="parent_dir"\r\n\r\n' + (lk.parent_path || '') + '\r\n' +
    '--' + B + '\r\nContent-Disposition: form-data; name="relative_path"\r\n\r\n' + relDir + '\r\n' +
    '--' + B + '\r\nContent-Disposition: form-data; name="file"; filename="' + fname + '"\r\n' +
    'Content-Type: image/png\r\n\r\n';
  const ct = 'multipart/form-data; boundary=' + B;
  const bodyU8 = u8cat([new TextEncoder().encode(head), new Uint8Array(PNG), new TextEncoder().encode('\r\n--' + B + '--\r\n')]);
  // 走中转：把完整绝对地址剥成相对路径，再按 latin-1 打包
  const upRel = up.replace(/^https?:\/\/[^/]+/i, '');
  const upRes = await relayWrite(upRel, 'POST', bytesLatin1(bodyU8), ct);
  ok('\u4e0a\u4f20 200', upRes.status === 200 || upRes.status === 201, 'HTTP ' + upRes.status + ' ' + upRes.text.slice(0, 160));
  const upArr = Array.isArray(upRes.json) ? upRes.json : (upRes.json ? [upRes.json] : []);
  const f = upArr[0] || {};
  const upName = f.name || f.filename || fname;
  ok('\u4e0a\u4f20\u8fd4\u56de\u6587\u4ef6\u540d', !!upName, JSON.stringify(f).slice(0, 160));
  const wsid = lk.workspace_id || '';
  const parent = String(lk.parent_path || ('/asset/' + uid)).replace(/\/+$/, '');
  const fileUrl = (wsid ? '/workspace/' + wsid : '') + parent + '/' + String(relDir).replace(/^\/+/, '') + '/' + upName;
  const fileRel = fileUrl.replace(/^\/workspace\/[^/]+/i, '').replace(/^\/asset\/[^/]+/i, '').replace(/^\/+/, '');

  log('\n--- 3) \u5199\u884c\uff08\u53d1\u5e03\u5230\u793e\u533a\uff09---');
  const sid = 'v5verify-' + Date.now();
  const testName = '\u3010\u81ea\u68c0\u3011\u6280\u672f\u9a8c\u8bc1\u4e34\u65f6\u884c';
  const row = {};
  row[C.user] = '\u81ea\u68c0\u673a\u5668\u4eba';
  row[C.file] = [{ url: fileUrl, name: upName, size: PNG.length, type: 'file' }];
  row[C.image] = [fileUrl];
  row[C.open] = '\u662f';
  row[C.name] = testName;
  row[C.sid] = sid;
  row[C.email] = 'v5verify@local';
  const ins = await relayWrite(`/api/v2/dtables/${uid}/rows/`, 'POST',
    { table_name: COMM, rows: [row] }, 'application/json');
  const insN = ins.json && (ins.json.inserted_row_count || (ins.json.rows && ins.json.rows.length) || 0);
  ok('\u5199\u884c\u6210\u529f\uff08\u53d1\u5e03\u80fd\u843d\u5e93\uff09', ins.status === 200 && insN > 0,
    'HTTP ' + ins.status + ' inserted=' + insN + ' ' + ins.text.slice(0, 200));
  const newId = (ins.json && ((ins.json.first_row && (ins.json.first_row._id || ins.json.first_row.id)) || (ins.json.rows && ins.json.rows[0] && ins.json.rows[0]._id))) || '';

  log('\n--- 4) \u8bfb\u56de\u6821\u9a8c\uff08\u8bfb+\u5199\u6574\u6761\u94fe\uff09---');
  const rComm2 = await relayGet(`/api/v2/dtables/${uid}/rows/?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
  const rows2 = (rComm2.json && rComm2.json.rows) || [];
  const mine = rows2.filter(r => String(r[C.sid] || '') === sid);
  ok('\u80fd\u8bfb\u56de\u521a\u5199\u7684\u884c', mine.length === 1, '\u547d\u4e2d ' + mine.length + ' \u884c');
  if (mine.length) {
    ok('\u4f5c\u54c1\u540d\u6b63\u786e', String(mine[0][C.name] || '') === testName, String(mine[0][C.name]));
    ok('\u7528\u6237\u540d\u6b63\u786e', String(mine[0][C.user] || '') === '\u81ea\u68c0\u673a\u5668\u4eba', String(mine[0][C.user]));
    ok('\u662f\u5426\u5f00\u6e90\u6b63\u786e', String(mine[0][C.open] || '') === '\u662f', String(mine[0][C.open]));
  }

  log('\n--- 5) \u6539\u884c + \u5220\u884c ---');
  if (newId) {
    const upd = await relayWrite(`/api/v2/dtables/${uid}/rows/`, 'PUT',
      { table_name: COMM, updates: [{ row_id: newId, row: { [C.name]: testName + '-\u5df2\u6539' } }] }, 'application/json');
    ok('\u6539\u884c 200', upd.status === 200, 'HTTP ' + upd.status + ' ' + upd.text.slice(0, 120));
    const rComm3 = await relayGet(`/api/v2/dtables/${uid}/rows/?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
    const m3 = ((rComm3.json && rComm3.json.rows) || []).filter(r => String(r[C.sid] || '') === sid);
    ok('\u6539\u5b8c\u8bfb\u56de\u786e\u5b9e\u53d8\u4e86', m3.length === 1 && String(m3[0][C.name]) === testName + '-\u5df2\u6539', m3.length ? String(m3[0][C.name]) : '\u4e0d\u89c1\u4e86');
    const del = await relayWrite(`/api/v2/dtables/${uid}/rows/`, 'DELETE',
      { table_name: COMM, row_ids: [newId] }, 'application/json');
    ok('\u5220\u884c 200', del.status === 200, 'HTTP ' + del.status + ' ' + del.text.slice(0, 120));
    const rComm4 = await relayGet(`/api/v2/dtables/${uid}/rows/?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
    const left = ((rComm4.json && rComm4.json.rows) || []).filter(r => String(r[C.sid] || '') === sid);
    ok('\u5220\u5e72\u51c0\u4e86\uff08\u793e\u533a\u8868\u6062\u590d\u539f\u6837\uff09', left.length === 0, '\u6b8b\u7559 ' + left.length + ' \u884c');
  } else {
    ok('\u62ff\u5230\u65b0\u884c\u884c\u53f7', false, '\u6ca1\u6709 first_row._id\uff0c\u65e0\u6cd5\u7ee7\u7eed\u6539/\u5220');
  }

  log('\n--- 6) \u9644\u4ef6\u4e0b\u8f7d\uff08\u5361\u7247\u56fe\u80fd\u4e0d\u80fd\u663e\u793a\uff09---');
  const dl = await fetch(BASE + '/api/download?path=' + encodeURIComponent(fileRel) + '&t=' + TOK);
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  ok('\u56fe\u7247\u4e0b\u8f7d 200', dl.status === 200, 'HTTP ' + dl.status + ' ' + dlBuf.length + ' bytes ' + dl.headers.get('content-type'));
  ok('\u4e0b\u56de\u6765\u7684\u786e\u5b9e\u662f PNG \u56fe\u7247', dlBuf.length > 60 && dlBuf[0] === 0x89 && dlBuf[1] === 0x50, dlBuf.length + ' bytes');

  // 说明：上传的临时图只有 70 字节，留在 workspace 的 images/2026-09 下，无副作用（没有删附件的接口）。

  log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`);
  log(`\u793e\u533a\u8868\u539f\u6709 ${commRows.length} \u884c\uff0c\u8d26\u53f7\u8868 ${accRows.length} \u884c`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\u811a\u672c\u5f02\u5e38: ' + e.stack); process.exit(2); });
