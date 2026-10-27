// verify-v9-live.mjs —— 验证 v8/v9 的两项安全加固真的生效。
// 注意：这里故意用一定投递失败的地址（@example.invalid），只为了打满限流计数器，
// 不会真的把邮件发到别人手上（SMTP 服务器在 RCPT 阶段就会拒收这个域名）。
const BASE = 'https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run';
const TOK = process.env.FAST_APP_TOKEN;   // 公开仓库不写明文口令，运行前先 set FAST_APP_TOKEN
const UID = '712bc4e0-a7b0-48ff-b5ea-098ce7eb3252';
const H = { 'X-App-Token': TOK, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log(`  [OK]   ${n}${extra ? ' :: ' + extra : ''}`); } else { fail++; console.log(`  [FAIL] ${n}${extra ? ' :: ' + extra : ''}`); } };

(async () => {
  console.log('===== v9 安全加固实测 =====');
  const hz = await (await fetch(BASE + '/healthz')).json();
  ok('函数为 v8 及以上', /^v[89]\d*$/.test(String(hz.func_version || '')), 'func_version=' + hz.func_version);

  console.log('\n--- 1) 「账号」表不能再下发「用户密码」列 ---');
  const rel = `/api/v2/dtables/${UID}/rows/?table_name=${encodeURIComponent('账号')}&limit=1000&convert_keys=true`;
  const r = await fetch(BASE + '/api?p=' + rel, { headers: { 'X-App-Token': TOK } });
  const j = await r.json();
  const rows = j.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  ok('账号表能正常读到', r.status === 200 && rows.length > 0, rows.length + ' 行');
  ok('返回里没有「用户密码」', !cols.includes('用户密码'), '列=' + cols.filter(c => c[0] !== '_').join(','));
  ok('登录要用的「用户邮箱」还在', cols.includes('用户邮箱'));
  ok('「账号名」还在', cols.includes('账号名'));

  console.log('\n--- 2) 发码有全局上限（防止有人拿 APK 里的口令刷爆发信额度）---');
  const seen = [];
  for (let i = 1; i <= 14; i++) {
    const r2 = await fetch(BASE, {
      method: 'POST', headers: H,
      body: JSON.stringify({ action: 'send', email: 'probe' + i + '@example.invalid' }),
    });
    let t = ''; try { t = await r2.text(); } catch (e) { }
    seen.push(r2.status + (r2.status === 429 ? '(限流)' : ''));
    if (r2.status === 429) { console.log('  第 ' + i + ' 次被限流：' + t.slice(0, 120)); break; }
  }
  console.log('  状态序列：' + seen.join(' '));
  // 关键：绝不可能是 14 次都放过去
  ok('连续发码会被全局限流拦住', seen.some(s => s.indexOf('429') >= 0), seen.join(' '));
  ok('限流不是第一次就拦（前面的正常请求能过）', seen.length > 1 && seen[0].indexOf('429') < 0);

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常: ' + e.stack); process.exit(2); });
