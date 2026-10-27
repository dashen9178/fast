// verify-v7-live.mjs —— 线上中转 v7 端到端实测（真实表）
//
// 关键：PUT / DELETE 要用**真实 HTTP 方法**发，不能像上次那样用 POST + body 里写 m=PUT。
// 上次就是这么测的，所以「App 发真 PUT → 函数没实现 do_PUT → 501」这个 bug 一直没被发现，
// 用户截图「发布到社区 请求失败 HTTP 501」就是这么来的。
const BASE = 'https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run';
const TOK = process.env.FAST_APP_TOKEN;   // 公开仓库不写明文口令，运行前先 set FAST_APP_TOKEN
const UUID = '712bc4e0-a7b0-48ff-b5ea-098ce7eb3252';
const COMM = '\u793e\u533a';
const ACC = '\u8d26\u53f7';
const C = {
  user: '\u7528\u6237\u540d', file: '\u4f5c\u54c1', image: '\u4f5c\u54c1\u56fe',
  open: '\u662f\u5426\u5f00\u6e90', name: '\u4f5c\u54c1\u540d', sid: '\u4f5c\u54c1iD',
  email: '\u7528\u6237\u90ae\u7bb1',
};
const H = { 'X-App-Token': TOK, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log(`  [OK]   ${n}${extra ? ' :: ' + extra : ''}`); } else { fail++; console.log(`  [FAIL] ${n}${extra ? ' :: ' + extra : ''}`); } };

// 中转请求：URL 用 ?p= 带整条相对路径，业务体包成 {p,m,q,b}，HTTP 方法用**真实的那个**
async function relay(method, rel, bodyObj, query) {
  const url = BASE + '/api?p=' + rel + (query || '');
  const init = { method, headers: H };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify({ p: rel, m: method, q: '', b: bodyObj === undefined ? null : bodyObj });
  }
  const r = await fetch(url, init);
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { status: r.status, json: j, text: t };
}
// 直达路径形式（不打 ?p= 包）
async function direct(method, rel, bodyObj) {
  const init = { method, headers: H };
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(bodyObj);
  const r = await fetch(BASE + rel, init);
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { status: r.status, json: j, text: t };
}

(async () => {
  console.log('===== 线上 v7 中转 真实 HTTP 方法实测 =====');
  const hz = await (await fetch(BASE + '/healthz')).json();
  ok('函数为 v7 及以上', /^v[7-9]\d*$/.test(String(hz.func_version || '')), 'func_version=' + hz.func_version);

  const rowsPath = `/api/v2/dtables/${UUID}/rows/`;
  const before = await relay('GET', rowsPath, undefined, `?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
  const n0 = ((before.json && before.json.rows) || []).length;
  ok('读社区表 200（中文列名）', before.status === 200 && Object.keys(((before.json || {}).rows || [{}])[0] || {}).includes(C.name),
    n0 + ' 行');

  console.log('\n--- 1) 真实 POST：新增一行 ---');
  const sid = 'v7verify-' + Date.now();
  const name0 = '\u3010\u81ea\u68c0v7\u3011\u4e34\u65f6\u884c';
  const row = {};
  row[C.user] = '\u81ea\u68c0\u673a\u5668\u4eba'; row[C.open] = '\u5426';
  row[C.name] = name0; row[C.sid] = sid; row[C.email] = 'v7@local';
  row[C.file] = []; row[C.image] = [];
  const ins = await relay('POST', rowsPath, { table_name: COMM, rows: [row] });
  const insN = ins.json && (ins.json.inserted_row_count || 0);
  ok('真实 POST 写行成功', ins.status === 200 && insN > 0, 'HTTP ' + ins.status + ' ' + ins.text.slice(0, 120));
  const rid = (ins.json && ins.json.first_row && (ins.json.first_row._id || ins.json.first_row.id)) || '';

  console.log('\n--- 2) 真实 PUT：改行（上次 501 就是这里）---');
  ok('拿到新行行号', !!rid, rid);
  const upd = await relay('PUT', rowsPath, { table_name: COMM, updates: [{ row_id: rid, row: { [C.name]: name0 + '-\u5df2\u6539' } }] });
  ok('真实 PUT 改行 200（不再是 501）', upd.status === 200, 'HTTP ' + upd.status + ' ' + upd.text.slice(0, 140));
  const chk = await relay('GET', rowsPath, undefined, `?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
  const got = (((chk.json || {}).rows) || []).filter(r => String(r[C.sid] || '') === sid)[0];
  ok('改完读回确实变了', got && String(got[C.name]) === name0 + '-\u5df2\u6539', got ? String(got[C.name]) : '\u4e0d\u89c1\u4e86');

  console.log('\n--- 3) 真实 PUT：直达路径形式也要能改 ---');
  const upd2 = await direct('PUT', rowsPath, { table_name: COMM, updates: [{ row_id: rid, row: { [C.name]: name0 + '-\u76f4\u8fbe' } }] });
  ok('直达路径 PUT 200', upd2.status === 200, 'HTTP ' + upd2.status + ' ' + upd2.text.slice(0, 140));

  console.log('\n--- 4) 真实 DELETE：删行 ---');
  const del = await relay('DELETE', rowsPath, { table_name: COMM, row_ids: [rid] });
  ok('真实 DELETE 删行 200（不再是 501）', del.status === 200, 'HTTP ' + del.status + ' ' + del.text.slice(0, 140));
  const after = await relay('GET', rowsPath, undefined, `?table_name=${encodeURIComponent(COMM)}&limit=1000&convert_keys=true`);
  const left = (((after.json || {}).rows) || []).filter(r => String(r[C.sid] || '') === sid).length;
  const n1 = (((after.json || {}).rows) || []).length;
  ok('删干净了（行数回到原样）', left === 0 && n1 === n0, '残留 ' + left + ' 行，社区 ' + n0 + ' -> ' + n1 + ' 行');

  console.log('\n--- 5) 未授权时必须拦住 ---');
  const bad = await fetch(BASE + '/api?p=' + rowsPath, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-App-Token': 'wrong' }, body: '{}' });
  ok('错误口令被拒', bad.status === 401, 'HTTP ' + bad.status);

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\u811a\u672c\u5f02\u5e38: ' + e.stack); process.exit(2); });
