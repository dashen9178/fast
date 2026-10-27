// unit-pack.mjs -- test the REAL 打包中转请求() out of editor.js, not a copy.
// Why this exists: the browser regression harness installs its fake network at the authHttp
// layer, which is BEFORE editorCloudHttp's packing runs — so no page-level test can ever see
// what the packing did. That blind spot let a bug ship where the mail-code request got
// wrapped into {p:'',m:'POST',b:{action:'send'}} and the function answered
// 「未知 action（send / verify）」. Extracting the function and unit-testing it closes that hole.
import fs from 'node:fs';

const src = fs.readFileSync(process.argv[2], 'utf8');

// Pull the function body out by brace matching so it is the shipping code, verbatim.
function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数 ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('括号不配对: ' + name);
}

const CLOUD_BASE = 'https://relay.example.fcapp.run';
const MAIL_BASE = CLOUD_BASE;                      // 发码接口和云中转是同一个函数（同址）
const 用中转 = () => true;
const fn = new Function('CLOUD_BASE', '用中转', 'return ' + extract('打包中转请求') + ';')(CLOUD_BASE, 用中转);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [OK]   ' + name + (extra ? ' :: ' + extra : '')); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' :: ' + extra : '')); }
};

console.log('===== 中转打包规则（直接跑 editor.js 里的真代码）=====');
ok('发码接口与云中转同址（用例前提）', MAIL_BASE === CLOUD_BASE);

// ① 发码请求：body 顶层必须还是 {action:...}
const mail = fn('POST', MAIL_BASE, { action: 'send', email: 'a@b.c' });
let mp = {}; try { mp = JSON.parse(mail.bodyText); } catch (e) {}
ok('发码请求不被打包（action 留在顶层）', mp.action === 'send', 'bodyText=' + mail.bodyText);
ok('发码请求没被包成 {p,m,q,b}', !('p' in mp) && !('b' in mp) && !('m' in mp));
ok('发码请求 URL 不变', mail.url === MAIL_BASE);

// ② 写行：必须包成 {p,m,q,b}，业务 body 原样进 b
const ins = fn('POST', CLOUD_BASE + '/api?p=/api/v2/dtables/U/rows/', { table_name: '账号', rows: [{ '用户邮箱': 'a@b.c' }] });
let ip = {}; try { ip = JSON.parse(ins.bodyText); } catch (e) {}
ok('写行包成 {p,m,q,b}', ip.p === '/api/v2/dtables/U/rows/' && ip.m === 'POST' && typeof ip.b === 'object',
  'p=' + ip.p + ' m=' + ip.m + ' b=' + typeof ip.b);
ok('写行业务 body 原样进 b', ip.b && ip.b.table_name === '账号');
ok('写行不带 ct 时函数按 application/json 处理（b 是对象）', typeof ip.b === 'object');

// ③ 读行：GET 原样，整条路径+查询串留在 ?p= 里，不能有请求体
const rd = fn('GET', CLOUD_BASE + '/api?p=/api/v2/dtables/U/rows/?table_name=%E7%A4%BE%E5%8C%BA&limit=1000&convert_keys=true', null);
ok('GET 无请求体', rd.bodyText === null, 'bodyText=' + rd.bodyText);
ok('GET 的 convert_keys 没丢', rd.url.indexOf('convert_keys=true') >= 0);
ok('GET 的 table_name 没丢', rd.url.indexOf('table_name=') >= 0);
ok('GET 未被打包成 {p,m,q,b}', rd.url.indexOf('/api?p=') >= 0);

// ④ 边界：非中转域名（例如 DeepSeek）绝不能被动
const other = fn('POST', 'https://api.deepseek.com/chat/completions', { model: 'x', messages: [] });
let op = {}; try { op = JSON.parse(other.bodyText); } catch (e) {}
ok('非中转域名原样透传', op.model === 'x' && !('p' in op));
const cloudNoApi = fn('POST', CLOUD_BASE, { action: 'verify', code: '1' });
let vp = {}; try { vp = JSON.parse(cloudNoApi.bodyText); } catch (e) {}
ok('云端根路径（发码）原样透传', vp.action === 'verify');

console.log('\n===== 结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项 =====');
process.exit(fail ? 1 : 0);
