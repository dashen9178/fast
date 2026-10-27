// audit.mjs —— 机械扫描：只报**能确定是问题**的几类，不猜。
// 用法：node pc-sim/audit.mjs
import fs from 'node:fs';

const R = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const 行 = p => R(p).split(/\r?\n/);
const 找行 = (p, re) => 行(p).map((l, i) => [i + 1, l]).filter(x => re.test(x[1]));

const js = 'assets/www/editor.js';
const html = 'assets/www/editor.html';
const rt = 'assets/www/runtime.js';
const rth = 'assets/www/runtime.html';

let 问题 = 0;
const 报 = (级别, 标题, 明细) => {
  问题++;
  console.log(`\n【${级别}】${标题}`);
  (明细 || []).slice(0, 40).forEach(d => console.log('   ' + d));
  if ((明细 || []).length > 40) console.log(`   …还有 ${明细.length - 40} 条`);
};

// ── 1) editor.html 里重复的 id（重复 id 是无效 HTML，getElementById 只会拿到第一个）
{
  const ids = [];
  const re = /\sid="([^"]+)"/g;
  let m; const src = R(html);
  while ((m = re.exec(src))) ids.push(m[1]);
  const 重 = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (重.length) 报('高', 'editor.html 里有重复的 id（后面的会被忽略）', [...new Set(重)]);
  else console.log('\n[OK] editor.html 没有重复 id');
}

// ── 2) JS 里引用了 editor.html 中不存在的 id
{
  const src = R(html);
  const 有 = new Set();
  { const re = /\sid="([^"]+)"/g; let m; while ((m = re.exec(src))) 有.add(m[1]); }
  // 动态创建的 id（JS 里 setAttribute('id',...) 或 el('..','..') 时给的）也算存在
  const 动态 = new Set();
  { const re = /(?:\.id\s*=\s*|setAttribute\(\s*['"]id['"]\s*,\s*)['"]([A-Za-z0-9_\-]+)['"]/g; let m; while ((m = re.exec(R(js)))) 动态.add(m[1]); }
  const 引用 = new Map();
  { const re = /\$\('([A-Za-z0-9_\-]+)'\)|getElementById\('([A-Za-z0-9_\-]+)'\)/g; let m;
    // 先去掉注释再找引用：不然注释里提到的 id 会被当成真引用（`aiThinkHint` 就是这么误报的）
    const src2 = R(js).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    while ((m = re.exec(src2))) { const id = m[1] || m[2]; if (!引用.has(id)) 引用.set(id, src2.slice(0, m.index).split('\n').length); } }
  const 缺 = [];
  for (const [id, ln] of 引用) if (!有.has(id) && !动态.has(id)) 缺.push(`editor.js:${ln}  $('${id}')  —— editor.html 里没有这个 id，也没见 JS 动态创建`);
  if (缺.length) 报('高', `JS 引用了不存在的 id（这几处功能会静默失效；共 ${缺.length} 个）`, 缺);
  else console.log('[OK] JS 引用的 id 都能在 editor.html 或动态创建里找到');
}

// ── 3) editor.js 里重复声明的函数（后者覆盖前者，容易是复制粘贴事故）
{
  const names = new Map();
  行(js).forEach((l, i) => {
    const m = /^\s*function\s+([A-Za-z0-9_$\u4e00-\u9fa5]+)\s*\(/.exec(l);
    if (m) { if (!names.has(m[1])) names.set(m[1], []); names.get(m[1]).push(i + 1); }
  });
  const 重 = [...names.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `function ${k}()  出现在行 ${v.join(', ')}`);
  if (重.length) 报('中', '同名函数被声明了多次（后面的会覆盖前面的）', 重);
  else console.log('[OK] editor.js 没有重复声明的函数');
}

// ── 4) 会被 new Function / eval 执行的路径（产品红线：不能让网络/别人的作品喂进来）
{
  const 处 = [];
  for (const f of [js, rt, rth, 'assets/www/blocks.js']) {
    找行(f, /\bnew Function\s*\(|\beval\s*\(/).forEach(([n, l]) => 处.push(`${f}:${n}  ${l.trim().slice(0, 120)}`));
  }
  if (处.length) 报('需人工确认', '动态执行代码的位置（确认输入只能来自用户自己在编辑器里拖出来的代码）', 处);
  else console.log('[OK] 没有 new Function / eval');
}

// ── 5) 把变量拼进 innerHTML（云端数据带标签就是 XSS）
{
  const 处 = [];
  行(js).forEach((l, i) => {
    if (/innerHTML\s*=/.test(l) && /\+\s*[A-Za-z_$\u4e00-\u9fa5]/.test(l) && !/^\s*\/\//.test(l)) 处.push(`editor.js:${i + 1}  ${l.trim().slice(0, 130)}`);
  });
  if (处.length) 报('需人工确认', `innerHTML 里拼了变量（共 ${处.length} 处，逐条看是不是云端来的值）`, 处);
  else console.log('[OK] 没有把变量拼进 innerHTML');
}

// ── 6) 硬编码的疑似凭据（40 位 hex / Authorization 头 / 密钥字样）
{
  const 处 = [];
  for (const f of [js, rt, 'assets/www/blocks.js', 'assets/www/editor.html', 'assets/www/runtime.html']) {
    找行(f, /[0-9a-f]{40}|(?:TOKEN|Token|SECRET|api[_-]?key)\s*[:=]\s*['"][^'"]{12,}/).forEach(([n, l]) => {
      if (/https?:\/\//.test(l) && !/\bTOKEN\b/.test(l)) return;
      处.push(`${f}:${n}  ${l.trim().slice(0, 130)}`);
    });
  }
  if (处.length) 报('高', '疑似硬编码凭据（会被打进 APK）', 处);
  else console.log('[OK] assets/www 下没有疑似硬编码凭据');
}

// ── 7) 挂在 document / window 上的监听（重复渲染时会不会一直累加，需人工确认）
{
  const n = 找行(js, /document\.addEventListener|window\.addEventListener/).length;
  console.log(`\n[参考] editor.js 里挂在 document/window 上的监听共 ${n} 处（脚本启动时执行一次的没关系，在会被反复调用的函数里的才有泄漏风险）`);
}

// ── 8) 没有 try 包住的 JSON.parse（云端 / localStorage 数据一变就抛）
{
  const 行s = 行(js);
  const 危险 = [];
  let 总 = 0;
  行s.forEach((l, i) => {
    if (!/JSON\.parse\(/.test(l)) return;
    总++;
    // 往上 6 行内有 try { 或 catch ( → 认为有保护（否则会有大量假阳性）
    const 上下文 = 行s.slice(Math.max(0, i - 6), i + 1).join('\n');
    if (/try\s*\{/.test(上下文) || /catch\s*\(/.test(上下文)) return;
    if (!/localStorage|Native|resp|txt|body|\.json|getItem/.test(l)) return;
    危险.push(`editor.js:${i + 1}  ${l.trim().slice(0, 130)}`);
  });
  console.log(`\n[参考] editor.js 里 JSON.parse 共 ${总} 处`);
  if (危险.length) 报('中', '解析外来数据但附近没有 try 的 JSON.parse（it 被写坏就会抛）', 危险);
  else console.log('[OK] 解析外来数据的 JSON.parse 都在 try 里');
}

console.log(`\n===== 需要处理的确定项：${问题} 类 =====`);
