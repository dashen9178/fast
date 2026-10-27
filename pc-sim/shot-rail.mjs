// shot-rail.mjs —— 专门给「代码栏（分类栏）」拍照 + 把计算样式打出来。
// 为什么单独写一个：用户报的两个问题都是**视觉**的（选中颜色、取消选中），
// 光看代码判断不了，得把真实渲染出来的颜色/尺寸量出来。
//
// 跑法：powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-shot.ps1
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || process.env.TEMP || '.';
const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9222}`;
mkdirSync(OUT, { recursive: true });

let ws = null, closed = true, seq = 0;
const pending = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pickTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(CDP + '/json/list')).json();
      const t = list.find(x => x.type === 'page' && x.url.includes('editor.html'));
      if (t) return t;
    } catch { }
    await sleep(300);
  }
  throw new Error('找不到 editor.html 页面目标');
}
async function open(url) {
  await new Promise((res, rej) => {
    const s = new WebSocket(url);
    const to = setTimeout(() => rej(new Error('WebSocket 连接超时')), 10000);
    s.onopen = () => { clearTimeout(to); ws = s; closed = false; res(); };
    s.onerror = () => { clearTimeout(to); rej(new Error('WebSocket 连接失败')); };
    s.onclose = () => { closed = true; for (const p of pending.values()) p.rej(new Error('CDP 断开')); pending.clear(); };
    s.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    };
  });
}
function send(method, params = {}, timeoutMs = 20000) {
  if (closed || !ws) return Promise.reject(new Error('CDP 未连接'));
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP 超时: ' + method)); }, timeoutMs);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0]);
  return r.result?.value;
}
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await js(expr)) return true; } catch { } await sleep(200); }
  return false;
}
async function shot(name) {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = join(OUT, name + '.png');
    writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('  截图 ' + f);
  } catch (e) { console.log('  截图失败 ' + name + ': ' + e.message); }
}
// 只拍分类栏那一条，并放大 4 倍 —— 颜色/对齐问题在整屏图里太小看不出来
async function shotRail(name) {
  try {
    const b = await js(`(function(){ var r = document.getElementById('bbCats');
      if (!r) return null; var x = r.getBoundingClientRect();
      return { x: x.x, y: x.y, width: x.width, height: x.height }; })()`);
    if (!b) { console.log('  拍不到分类栏'); return; }
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.max(8, b.width), height: Math.max(8, Math.min(b.height, 400)), scale: 4 },
    });
    const f = join(OUT, name + '.png');
    writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('  分类栏放大图 ' + f + '  (' + Math.round(b.width) + 'x' + Math.round(b.height) + ')');
  } catch (e) { console.log('  分类栏截图失败 ' + name + ': ' + e.message); }
}
// 把「选中项长什么样」量出来：标签颜色/字重、图标底色/字色、滑块的位置与颜色
const 量 = `(function(){
  function st(el, props) { if (!el) return null; var c = getComputedStyle(el); var o = {};
    props.forEach(function (p) { o[p] = String(c[p]); }); return o; }
  var rail = document.getElementById('bbCats');
  var panel = rail ? rail.querySelector('.bb-panel-general, .bb-panel') : null;
  var cats = rail ? Array.prototype.slice.call(rail.querySelectorAll('.bb-cat')) : [];
  var on = cats.filter(function (b) { return b.classList.contains('on'); });
  var pill = rail ? rail.querySelector('.bb-cat-pill') : null;
  function box(el) { if (!el) return null; var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
  return {
    分类数: cats.length,
    选中数: on.length,
    面板有hasPill: !!(panel && panel.classList.contains('has-pill')),
    选中项: on.map(function (b) {
      var lb = b.querySelector('.bb-cat-lb'), ico = b.querySelector('.bb-cat-ico');
      return { 名字: (lb||{}).textContent,
        按钮: st(b, ['backgroundColor','color','borderRadius']),
        标签: st(lb, ['color','fontWeight','fontSize']),
        图标: st(ico, ['backgroundColor','color']),
        图标行内: ico ? ico.getAttribute('style') : null,
        盒子: box(b) };
    }),
    未选中项_第一个: (function () { var b = cats.filter(function (x) { return !x.classList.contains('on'); })[0];
      if (!b) return null; var lb = b.querySelector('.bb-cat-lb'), ico = b.querySelector('.bb-cat-ico');
      return { 名字: (lb||{}).textContent, 标签: st(lb, ['color','fontWeight']), 图标: st(ico, ['backgroundColor','color']) }; })(),
    滑块: pill ? { 样式: st(pill, ['backgroundColor','transform','width','height','borderRadius','opacity']),
                   行内: pill.getAttribute('style'), 盒子: box(pill), 脏: !!pill.__脏 } : null,
    面板: panel ? { 样式: st(panel, ['position','overflowY','transform']), 盒子: box(panel) } : null
  };
})()`;

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  console.log('=== 准备：新建一个 App 并切到代码页 ===');
  if (!await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000)) throw new Error('编辑器没就绪');
  await js(`(function(){ try { localStorage.clear(); } catch(e){} return 1; })()`);
  await js(`location.href = 'editor.html?v=' + Date.now(); 1`);
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await sleep(600);
  await js(`document.getElementById('btnNewApp').click(); 1`);
  await sleep(400);
  await js(`(function(){ var i = document.getElementById('newAppName'); i.value = '栏位自检'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(200);
  await js(`document.getElementById('createGo').click(); 1`);
  if (!await waitFor(`document.getElementById('viewEditor') && !document.getElementById('viewEditor').classList.contains('hidden')`, 20000)) throw new Error('没进编辑器');
  await sleep(900);
  await js(`(function(){ var b = document.getElementById('tabBlocks'); if (b) b.click(); return 1; })()`);
  await sleep(1200);
  if (!await waitFor(`document.querySelectorAll('#bbCats .bb-cat').length > 0`, 12000)) throw new Error('分类栏没出来');

  console.log('\n=== 1) 一个都没选 ===');
  console.log(JSON.stringify(await js(量), null, 2));
  await shotRail('rail-1-none');

  console.log('\n=== 2) 选中第 2 个分类 ===');
  await js(`(function(){ var c = document.querySelectorAll('#bbCats .bb-cat'); if (c[1]) c[1].click(); return 1; })()`);
  await sleep(700);
  console.log(JSON.stringify(await js(量), null, 2));
  await shotRail('rail-2-selected');

  console.log('\n=== 3) 再点一次 = 取消选中 ===');
  await js(`(function(){ var c = document.querySelectorAll('#bbCats .bb-cat'); if (c[1]) c[1].click(); return 1; })()`);
  await sleep(700);
  console.log(JSON.stringify(await js(量), null, 2));
  await shotRail('rail-3-deselected');

  console.log('\n=== 4) 换成选第 4 个（看滑块滑过去）===');
  await js(`(function(){ var c = document.querySelectorAll('#bbCats .bb-cat'); if (c[3]) c[3].click(); return 1; })()`);
  await sleep(700);
  console.log(JSON.stringify(await js(量), null, 2));
  await shotRail('rail-4-other');

  console.log('\n=== 5) 选中后「点空白取消」（走的是 Blockly 自己关浮层那条路）===');
  await js(`(function(){ var c = document.querySelectorAll('#bbCats .bb-cat'); if (c[1]) c[1].click(); return 1; })()`);
  await sleep(700);
  console.log('  选中后滑块 opacity = ' + await js(`(function(){ var p=document.querySelector('.bb-cat-pill'); return p?getComputedStyle(p).opacity:'(无滑块)'; })()`));
  // 忠实模拟"点空白"：Blockly 自己清掉选中 → document 上的 pointerup 监听负责收尾高亮。
  // 不用 CDP 的鼠标事件注入 —— 那会真的往画布上点，容易触发 Blockly 的其它交互把脚本卡住。
  await js(`(function(){
    try { var tb = Blockly.getMainWorkspace().getToolbox(); tb.clearSelection(); } catch (e) {}
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 800, clientY: 420 }));
    return 1;
  })()`);
  await sleep(600);                       // 监听里有个 60ms 的 setTimeout
  console.log(JSON.stringify(await js(量), null, 2));
  await shotRail('rail-5-blankcancel');

  console.log('\n=== 6) 再等一会，滑块必须一直保持不可见（以前会一直留在那）===');
  await sleep(900);
  console.log('  滑块 opacity = ' + await js(`(function(){ var p=document.querySelector('.bb-cat-pill'); return p?getComputedStyle(p).opacity:'(无滑块)'; })()`));
  console.log('  选中数 = ' + await js(`document.querySelectorAll('#bbCats .bb-cat.on').length`));

  // ── 7) 滚动对齐：把分类栏拉到下面，滑块必须还钉在那一条上
  // （用户报的"把分类栏拉到下面就看不到选中提示了"就是这里）
  console.log('\n=== 7) 分类栏滚动后，滑块还对不对得上 ===');
  const 对齐 = `(function(){
    var rail = document.getElementById('bbCats');
    var panel = rail ? rail.querySelector('.bb-panel-general') : null;
    var pill = rail ? rail.querySelector('.bb-cat-pill') : null;
    var on = rail ? rail.querySelector('.bb-panel-general .bb-cat.on') : null;
    function box(el) { if (!el) return null; var r = el.getBoundingClientRect();
      return { x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10 }; }
    var a = box(on), p = box(pill);
    return { 滚动量: panel ? Math.round(panel.scrollTop) : -1,
             可见区: box(panel),
             选中条: a, 滑块: p, 滑块透明度: pill ? getComputedStyle(pill).opacity : '',
             位置差: (a && p) ? { x: Math.round((p.x-a.x)*10)/10, y: Math.round((p.y-a.y)*10)/10 } : null,
             尺寸差: (a && p) ? { w: Math.round((p.w-a.w)*10)/10, h: Math.round((p.h-a.h)*10)/10 } : null,
             滑块在可见区内: !!(a && p && p.y >= (box(panel).y - 2) && p.y + p.h <= (box(panel).y + box(panel).h + 2)) };
  })()`;
  // 先选一个分类
  await js(`(function(){ var c=document.querySelectorAll('#bbCats .bb-panel-general .bb-cat'); if(c[1]) c[1].click(); return 1; })()`);
  await sleep(600);
  // 把视口改矮，逼出真正的溢出 —— 否则 1280x720 下 13 个分类放得下、scrollTop 永远是 0，
  // 这条用例就成了"空跑"（第一次写就是这么假过的）。
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 430, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  // 确保"真的有选中项"再量 —— 之前这里连着点了两次同一个分类，
  // 第二次把选中取消了，于是选中条=null、位置差=null，用例自己把自己骗过去了。
  await js(`(function(){
    var panel = document.querySelector('#bbCats .bb-panel-general');
    if (!panel) return 0;
    if (panel.querySelector('.bb-cat.on')) return 1;          // 已经选中就别再点（会取消）
    var c = panel.querySelectorAll('.bb-cat');
    if (c[1]) c[1].click();
    return 1;
  })()`);
  await sleep(400);
  const 选中了 = await js(`!!document.querySelector('#bbCats .bb-panel-general .bb-cat.on')`);
  console.log('  确认有选中项 = ' + 选中了);
  const 有溢出 = await js(`(function(){ var p=document.querySelector('#bbCats .bb-panel-general'); return p ? p.scrollHeight - p.clientHeight : -1; })()`);
  console.log('  可滚动距离 = ' + 有溢出 + 'px' + (有溢出 > 30 ? '（够用）' : '  ← 没有溢出，这条用例会空跑！'));
  let 判失败 = 0;
  if (!选中了) { 判失败++; console.log('  [FAIL] 没有选中项，后面全部无意义'); }
  if (!(有溢出 > 30)) { 判失败++; console.log('  [FAIL] 视口改矮了也没溢出，用例前提不成立'); }
  for (const [名, act] of [
    ['滚到顶', `p.scrollTop = 0`],
    ['滚到中间', `p.scrollTop = Math.round((p.scrollHeight - p.clientHeight) / 2)`],
    ['滚到底', `p.scrollTop = p.scrollHeight`],
  ]) {
    await js(`(function(){ var p=document.querySelector('#bbCats .bb-panel-general'); ${act}; return 1; })()`);
    await sleep(350);
    const r = await js(对齐);
    const ok = r.位置差 && Math.abs(r.位置差.x) <= 1.5 && Math.abs(r.位置差.y) <= 1.5 && r.滑块透明度 === '1';
    if (!ok) 判失败++;
    console.log(`  [${ok ? 'OK  ' : 'FAIL'}] ${名}  滚动量=${r.滚动量}  选中条y=${r.选中条 && r.选中条.y}  滑块y=${r.滑块 && r.滑块.y}  位置差=${JSON.stringify(r.位置差)}  透明度=${r.滑块透明度}  滑块在可见区内=${r.滑块在可见区内}`);
    if (!ok) console.log('        完整：' + JSON.stringify(r));
  }
  console.log(判失败 ? `  ⇒ 有 ${判失败} 种滚动位置对不上` : '  ⇒ 三种滚动位置都对齐 ✓');

  // ── 7b) 最贴近用户操作的两种：滚下去之后再点一个分类 / 滚到选中项刚好看得见
  console.log('\n=== 7b) 滚动后再点分类、以及选中项可见时的对齐 ===');
  // (甲) 滚到底，然后点当前可见的最后一个分类 —— 用户就是这么点的
  await js(`(function(){ var p=document.querySelector('#bbCats .bb-panel-general'); p.scrollTop = p.scrollHeight; return 1; })()`);
  await sleep(350);
  const 点了 = await js(`(function(){
    var p = document.querySelector('#bbCats .bb-panel-general');
    var 可见 = Array.prototype.filter.call(p.querySelectorAll('.bb-cat'), function (b) {
      var r = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1; });
    if (!可见.length) return '';
    var t = 可见[可见.length - 1];
    可见.forEach(function (b) { b.classList.add('__probe'); });
    t.click();
    return t.title || t.textContent;
  })()`);
  await sleep(600);
  const r甲 = await js(对齐);
  const 甲ok = r甲.位置差 && Math.abs(r甲.位置差.y) <= 1.5 && r甲.滑块透明度 === '1' && r甲.滑块在可见区内;
  if (!甲ok) 判失败++;
  console.log(`  [${甲ok ? 'OK  ' : 'FAIL'}] 滚到底再点分类「${点了}」  滚动量=${r甲.滚动量}  选中条y=${r甲.选中条 && r甲.选中条.y}  滑块y=${r甲.滑块 && r甲.滑块.y}  位置差=${JSON.stringify(r甲.位置差)}  滑块在可见区内=${r甲.滑块在可见区内}`);
  if (!甲ok) console.log('        完整：' + JSON.stringify(r甲));

  // (乙) 滚到"选中项刚好看得见"的位置 —— 旧代码就是在这一档把滑块甩出屏幕的
  await js(`(function(){
    var p = document.querySelector('#bbCats .bb-panel-general');
    var on = p.querySelector('.bb-cat.on');
    if (on) p.scrollTop = Math.max(0, on.offsetTop - 60);
    return 1;
  })()`);
  await sleep(400);
  const r乙 = await js(对齐);
  const 乙ok = r乙.位置差 && Math.abs(r乙.位置差.y) <= 1.5 && r乙.滑块透明度 === '1' && r乙.滑块在可见区内;
  if (!乙ok) 判失败++;
  console.log(`  [${乙ok ? 'OK  ' : 'FAIL'}] 选中项可见时  滚动量=${r乙.滚动量}  选中条y=${r乙.选中条 && r乙.选中条.y}  滑块y=${r乙.滑块 && r乙.滑块.y}  位置差=${JSON.stringify(r乙.位置差)}  滑块在可见区内=${r乙.滑块在可见区内}`);
  if (!乙ok) console.log('        完整：' + JSON.stringify(r乙));
  console.log(判失败 ? '\n  ⇒ 仍有对不上的情况' : '\n  ⇒ 全部对齐 ✓');

  // ── 8) 动画自然度：**没有落点**时点分类，滑块必须"原地淡入"，不许从别处划过来
  //    判别方法：在点击的**同一个 tick** 里量滑块位置（此时过渡刚起步，还没走）。
  //      · 没落点 → 滑块应该已经落在目标条目上（说明是淡入，不是滑动）
  //      · 有落点 → 滑块应该还在上一条上（说明确实在滑，这是好看的那一下）
  console.log('\n=== 8) 动画自然度 ===');
  const 一次点击 = `(function(){
    var p = document.querySelector('#bbCats .bb-panel-general');
    var pill = document.querySelector('.bb-cat-pill');
    var cats = p.querySelectorAll('.bb-cat');
    function box(el){ if(!el) return null; var r=el.getBoundingClientRect();
      return { y: Math.round(r.y), x: Math.round(r.x), w: Math.round(r.width) }; }
    var 目标 = cats[__I__];
    var 点前滑块 = box(pill);
    var 点前选中 = p.querySelector('.bb-cat.on');
    var 点前选中盒 = box(点前选中);
    目标.click();
    return { 点前滑块: 点前滑块, 点前选中: 点前选中盒,
             点后立刻滑块: box(pill), 目标: box(目标),
             点后透明度: String(getComputedStyle(pill).opacity) };
  })()`;

  // (甲) 先确保"没有落点"（取消选中），再点一个分类
  await js(`(function(){ var p=document.querySelector('#bbCats .bb-panel-general');
    var on=p.querySelector('.bb-cat.on'); if (on) on.click(); return 1; })()`);
  await sleep(500);
  const 甲 = await js(一次点击.replace('__I__', '3'));
  const 甲对齐 = 甲.点后立刻滑块 && Math.abs(甲.点后立刻滑块.y - 甲.目标.y) <= 2 && Math.abs(甲.点后立刻滑块.x - 甲.目标.x) <= 2;
  if (!甲对齐) 判失败++;
  console.log(`  [${甲对齐 ? 'OK  ' : 'FAIL'}] 没落点时点分类：滑块应**已经在目标位置**（原地淡入）`);
  console.log(`         点前滑块y=${甲.点前滑块 && 甲.点前滑块.y}  点后立刻滑块y=${甲.点后立刻滑块 && 甲.点后立刻滑块.y}  目标y=${甲.目标.y}  立刻透明度=${甲.点后透明度}`);

  // (乙) 已经有落点，再点另一个 → 立刻量应该还在旧位置（说明在滑过去）
  await sleep(500);
  const 乙 = await js(一次点击.replace('__I__', '5'));
  const 乙在滑 = 乙.点后立刻滑块 && 乙.点前选中 && Math.abs(乙.点后立刻滑块.y - 乙.点前选中.y) <= 3
    && Math.abs(乙.点后立刻滑块.y - 乙.目标.y) > 4;
  if (!乙在滑) 判失败++;
  console.log(`  [${乙在滑 ? 'OK  ' : 'FAIL'}] 换分类：滑块应**还在旧位置**（正在滑过去）`);
  console.log(`         点前选中y=${乙.点前选中 && 乙.点前选中.y}  点后立刻滑块y=${乙.点后立刻滑块 && 乙.点后立刻滑块.y}  目标y=${乙.目标.y}`);

  // (丙) 滑完之后准确落点：步骤 7 已经在三种滚动位置断言过"位置差=0"，
  // 这里不再重复点一次（无头浏览器偶发卡在这一步，会把整轮拖到超时）。
  console.log(判失败 ? `\n  ⇒ 共 ${判失败} 项不合格` : '\n  ⇒ 动画合格：没落点=原地淡入、换分类=滑过去 ✓');

  console.log('\n完成，截图在 ' + OUT);
  process.exit(判失败 ? 1 : 0);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
