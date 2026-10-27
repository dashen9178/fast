/* v1.9.13 页面跳转 / 启动事件专项 */
const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
function conn(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u, { perMessageDeflate: false }); const pend = {}, hand = [];
    ws.on('open', () => res({
      send: (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      on: (m, f) => hand.push({ m, f })
    }));
    ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result); hand.forEach(h => h.m === o.m && h.f(o.params)); });
    ws.on('error', rej);
  });
}
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
function S(id, comps, code) { return { id: id, title: id, name: id, components: comps || [], code: code || '' }; }
function txt(id, v) { return { id: id, type: 'text', value: v }; }
function btn(id, label) { return { id: id, type: 'button', text: label }; }
(async () => {
  const l = await get('/json/list'); let t = l.find(x => x.type === 'page'); const c = await conn(t.webSocketDebuggerUrl); const send = c.send;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const errs = [];
  c.on('Runtime.exceptionThrown', p => errs.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { console.log('EXC', r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return undefined; } return r.result.value; };
  async function loadRt(project, previewStart, settle) {
    await send('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(350);
    await ev(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(project))});${previewStart ? `localStorage.setItem('__previewStartScreen',${JSON.stringify(previewStart)});` : 'localStorage.removeItem("__previewStartScreen");'}1`);
    await send('Page.navigate', { url: 'http://127.0.0.1:8931/runtime.html?t=' + Date.now() }); await sleep(settle || 700);
    errs.length = 0;
  }
  const page = () => ev(`(document.querySelector('#screen [data-id=x] .v-text')||{}).textContent||''`);
  const toast = () => ev(`(function(){var t=document.getElementById('toast');return t.classList.contains('show')?t.textContent:'';})()`);
  const clickComp = async id => { await ev(`(function(){var w=document.querySelector('[data-id=${id}]');var b=w&&(w.querySelector('button')||w);b&&b.click();return 1;})()`); await sleep(300); };

  /* T1 首次启动只执行一次；每次启动照常执行；返回本页不重复首次 */
  console.log('— T1 首次/每次启动 —');
  {
    const p = { appName: 't1', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('go2', '去2'), txt('x', 'P1')],
        "RT.on('firstStart',async function(){window.__f=(window.__f||0)+1;});" +
        "RT.on('start',async function(){window.__s=(window.__s||0)+1;});" +
        "RT.onClick('go2',async function(){RT.gotoPage('s2');});"),
      S('s2', [btn('back', '回1'), txt('x', 'P2')],
        "RT.onClick('back',async function(){RT.back();});")
    ] };
    await loadRt(p);
    await sleep(100);
    ok('首次进入 f=1 s=1', await ev(`window.__f+'/'+window.__s`) === '1/1', await ev(`window.__f+'/'+window.__s`));
    await clickComp('go2');
    ok('跳到 s2', await page() === 'P2');
    await clickComp('back');
    ok('返回 s1', await page() === 'P1');
    ok('返回后首次不重跑(f=1)、每次启动重跑(s=2)', await ev(`window.__f+'/'+window.__s`) === '1/2', await ev(`window.__f+'/'+window.__s`));
  }

  /* T2 用户目标模式：p1 首次启动跳 p2；p2 每次启动等 0.3 秒回 p1；应稳定停在 p1 */
  console.log('— T2 首次跳转+延时返回（用户场景） —');
  {
    const p = { appName: 't2', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'PAGE1')], "RT.on('firstStart',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'PAGE2')], "RT.on('start',async function(){await RT.wait(0.3);RT.gotoPage('s1');});")
    ] };
    await loadRt(p, null, 120);
    ok('开场短暂在 PAGE2', await page() === 'PAGE2', await page());
    await sleep(450);
    ok('0.3秒后回到 PAGE1 并停住', await page() === 'PAGE1', await page());
    await sleep(700);
    ok('再等 0.7 秒仍在 PAGE1（不循环）', await page() === 'PAGE1', await page());
    ok('无循环提示', (await toast()) === '', await toast());
  }

  /* T3 用户按钮连跳不触发循环保护 */
  console.log('— T3 按钮连跳 —');
  {
    const p = { appName: 't3', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('go2', '去2'), txt('x', 'PAGE1')], "RT.onClick('go2',async function(){RT.gotoPage('s2');});"),
      S('s2', [btn('go1', '去1'), txt('x', 'PAGE2')], "RT.onClick('go1',async function(){RT.gotoPage('s1');});")
    ] };
    await loadRt(p);
    const seq = [];
    for (let i = 0; i < 4; i++) { await clickComp(i % 2 === 0 ? 'go2' : 'go1'); seq.push(await page()); }
    ok('按钮连跳 4 次全部成功', seq.join(',') === 'PAGE2,PAGE1,PAGE2,PAGE1', seq.join(','));
    ok('无循环提示', (await toast()) === '', await toast());
  }

  /* T4 启动时跳自己：无操作，不报错不刷不停 */
  console.log('— T4 自跳转无操作 —');
  {
    const p = { appName: 't4', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'PAGE1')], "RT.on('start',async function(){window.__self=(window.__self||0)+1;RT.gotoPage('s1');});")
    ] };
    await loadRt(p);
    await sleep(400);
    ok('仍在 PAGE1', await page() === 'PAGE1');
    ok('启动只计 1 次（未自激）', await ev(`String(window.__self)`) === '1', await ev(`String(window.__self)`));
    ok('无任何提示', (await toast()) === '');
  }

  /* T5 互跳死循环：爆栈消失、给友好提示并停在某页 */
  console.log('— T5 互跳保护 —');
  {
    const p = { appName: 't5', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'PAGE1')], "RT.on('start',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'PAGE2')], "RT.on('start',async function(){RT.gotoPage('s1');});")
    ] };
    await loadRt(p);
    await sleep(500);
    const pg = await page();
    ok('停在某个页面(PAGE1/PAGE2)', pg === 'PAGE1' || pg === 'PAGE2', pg);
    const ts = await toast();
    ok('友好循环提示（非 Maximum call stack）', ts.indexOf('循环跳转') >= 0 && ts.indexOf('call stack') < 0, ts);
    ok('无未捕获异常', errs.length === 0, errs.slice(0, 2));
  }

  /* T6 返回栈：s1→s2→s3，back 依次回退 */
  console.log('— T6 返回栈 —');
  {
    function sc(id, v, next) {
      return { id, title: id, name: id, components: [{ id: 'g', type: 'button', text: next ? '去' + next : '无' }, { id: 'b', type: 'button', text: '返回' }, { id: 'x', type: 'text', value: v }],
        code: (next ? "RT.onClick('g',async function(){RT.gotoPage('" + next + "');});" : '') + "RT.onClick('b',async function(){RT.back();});" };
    }
    const p = { appName: 't6', orientation: 'portrait', startScreen: 's1', screens: [sc('s1', 'PAGE1', 's2'), sc('s2', 'PAGE2', 's3'), sc('s3', 'PAGE3', null)] };
    await loadRt(p);
    await clickComp('g'); ok('到 s2', await page() === 'PAGE2');
    await clickComp('g'); ok('到 s3', await page() === 'PAGE3');
    await clickComp('b'); ok('back 到 s2', await page() === 'PAGE2');
    await clickComp('b'); ok('back 到 s1', await page() === 'PAGE1');
  }

  /* T7 当前页面运行：工程起始页 s1，预览指定从 s2 启动 */
  console.log('— T7 当前页面运行 —');
  {
    const p = { appName: 't7', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'PAGE1')], ''),
      S('s2', [txt('x', 'PAGE2')], '')
    ] };
    await loadRt(p, 's2');
    ok('预览直接打开 s2', await page() === 'PAGE2', await page());
    // 一次性：再进运行（不带标记）仍从 s1
    await loadRt(p);
    ok('标记一次性，下次仍从 s1', await page() === 'PAGE1', await page());
  }

  /* T8 长线性启动链（20 个互不重复页面依次自动跳转）不得误报循环，最终停在末页 */
  console.log('— T8 长线性启动链不误报 —');
  {
    const screens = [];
    for (let i = 1; i <= 20; i++) {
      const id = 's' + i, next = i < 20 ? 's' + (i + 1) : null;
      screens.push(S(id, [txt('x', 'PAGE' + i)], next ? "RT.on('start',async function(){RT.gotoPage('" + next + "');});" : ''));
    }
    const p = { appName: 't8', orientation: 'portrait', startScreen: 's1', screens: screens };
    await loadRt(p, null, 1500);
    ok('20 页线性链走到末页 s20', await page() === 'PAGE20', await page());
    const ts = await toast();
    ok('无循环提示', ts.indexOf('循环') < 0, ts);
    ok('无未捕获异常', errs.length === 0, errs.slice(0, 2));
  }

  /* T9 用户原例：p1 每次启动跳 p2，p2 首次启动跳 p1 → 最终稳定停 p2 */
  console.log('— T9 用户原例（首次启动破循环） —');
  {
    const p = { appName: 't9', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'PAGE1')], "RT.on('start',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'PAGE2')], "RT.on('firstStart',async function(){RT.gotoPage('s1');});")
    ] };
    await loadRt(p, null, 1200);
    ok('最终稳定停在 PAGE2', await page() === 'PAGE2', await page());
    ok('无循环提示（非死循环）', (await toast()).indexOf('循环') < 0, await toast());
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
