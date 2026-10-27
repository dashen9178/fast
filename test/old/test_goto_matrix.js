/* 切换屏幕积木：穷举运行时语义矩阵 */
const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
(async () => {
  const l = await get('/json/list'); const t = l.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false }); const pend = {};
  const errs = [];
  ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result);
    if (o.method === 'Runtime.exceptionThrown') errs.push((o.params.exceptionDetails.exception && o.params.exceptionDetails.exception.description) || o.params.exceptionDetails.text); });
  await new Promise(r => ws.on('open', r));
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  let pass = 0, fail = 0;
  const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, e !== undefined ? JSON.stringify(e) : ''); } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { console.log('  !! EXC', r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return undefined; } return r.result.value; };
  async function loadRt(project, previewStart) {
    errs.length = 0;
    await send('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(250);
    await ev(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(project))});${previewStart ? `localStorage.setItem('__previewStartScreen',${JSON.stringify(previewStart)});` : 'localStorage.removeItem("__previewStartScreen");'}1`);
    await send('Page.navigate', { url: 'http://127.0.0.1:8931/runtime.html?t=' + Date.now() }); await sleep(600);
  }
  const S = (id, comps, code) => ({ id, title: id === 's1' ? '页面1' : id === 's2' ? '页面2' : id, name: id, components: comps || [], code: code || '' });
  const btn = (id, label) => ({ id, type: 'button', text: label });
  const txt = (id, v) => ({ id, type: 'text', value: v });
  const page = () => ev(`(document.querySelector('#screen [data-id=x] .v-text')||{}).textContent||''`);
  const stackLen = () => ev(`window.__rtStack ? window.__rtStack.length : -1`);
  const clickComp = async id => { await ev(`(function(){var w=document.querySelector('[data-id=${id}]');var b=w&&(w.querySelector('button')||w);b&&b.click();})()`); await sleep(250); };
  const toast = () => ev(`(function(){var t=document.getElementById('toast');return t.classList.contains('show')?t.textContent:'';})()`);
  // 暴露导航栈（通过运行时 hook：在工程 code 里包一层不行，直接读 DOM 历史不可得；
  // 改为在加载前注入脚本 hook RT.gotoPage/back）
  const hook = `(function(){
    var iv=setInterval(function(){
      if(window.RT){clearInterval(iv);return;}
    },5);
    window.__stackSnap=[];
  })();`;

  /* M1 未打开页面的启动积木不执行：s2 start 写计数器，只在 s1 操作不进 s2 */
  console.log('— M1 未打开页面不执行 —');
  {
    const p = { appName: 'm1', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('g2', '去2'), txt('x', 'P1')], "RT.onClick('g2',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'P2')], "RT.on('start',async function(){window.__m2=(window.__m2||0)+1;});")
    ] };
    await loadRt(p);
    ok('未进 s2，其启动积木未执行', await ev(`String(window.__m2||0)`) === '0');
    await clickComp('g2');
    ok('进入 s2 后启动积木执行 1 次', await ev(`String(window.__m2||0)`) === '1', await ev(`String(window.__m2)`));
  }

  /* M2 跳转后同页后续积木：goto 之后的 toast 仍会执行（全局），但 setText 旧页组件不影响新页 */
  console.log('— M2 跳转后旧页积木行为 —');
  {
    const p = { appName: 'm2', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('g2', '去2'), txt('x', 'P1')], "RT.onClick('g2',async function(){RT.gotoPage('s2');window.__after=(window.__after||0)+1;});"),
      S('s2', [txt('x', 'P2')], '')
    ] };
    await loadRt(p);
    await clickComp('g2'); await sleep(200);
    ok('已到 P2', await page() === 'P2');
    ok('goto 后同 handler 后续语句执行（JS 语义）', await ev(`String(window.__after||0)`) === '1');
  }

  /* M3 自动跳转（启动链）不应污染返回栈：p1 启动→p2，p2 启动→p3；在 p3 返回应直接回 p1 */
  console.log('— M3 启动链返回栈 —');
  {
    const p = { appName: 'm3', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'P1')], "RT.on('start',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'P2')], "RT.on('start',async function(){RT.gotoPage('s3');});"),
      S('s3', [btn('b', '返回'), txt('x', 'P3')], "RT.onClick('b',async function(){RT.back();});")
    ] };
    await loadRt(p); await sleep(500);
    ok('启动链落到 P3', await page() === 'P3', await page());
    // 起始页 p1 自身就是自动链一环（已被替换出栈），栈里只有 [p3]：返回按钮无操作（真机上系统返回才退出）
    await clickComp('b'); await sleep(400);
    ok('启动链起点为中转页时，返回按钮无操作、留在 P3', await page() === 'P3', await page());
  }

  /* M4 用户跳转到自动链：按钮到 p2，p2 启动自动→p3，p3 返回应回 p1 */
  console.log('— M4 用户跳转+启动链接力 —');
  {
    const p = { appName: 'm4', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('g2', '去2'), txt('x', 'P1')], "RT.onClick('g2',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'P2')], "RT.on('start',async function(){RT.gotoPage('s3');});"),
      S('s3', [btn('b', '返回'), txt('x', 'P3')], "RT.onClick('b',async function(){RT.back();});")
    ] };
    await loadRt(p);
    await clickComp('g2'); await sleep(500);
    ok('落到 P3', await page() === 'P3', await page());
    await clickComp('b'); await sleep(400);
    ok('P3 返回直接回 P1', await page() === 'P1', await page());
  }

  /* M5 开场引导页：p1 启动就跳 p2，p2 按返回应退出预览（栈里没有 p1），而不是被弹回 p2 */
  console.log('— M5 开场引导页返回即退出 —');
  {
    const p = { appName: 'm5', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'P1')], "RT.on('start',async function(){RT.gotoPage('s2');});"),
      S('s2', [btn('b', '返回'), txt('x', 'P2')], "RT.onClick('b',async function(){RT.back();});")
    ] };
    await loadRt(p); await sleep(400);
    ok('开场落在 P2', await page() === 'P2');
    const backRet = await ev(`(function(){return window.__rtSystemBack?window.__rtSystemBack():null;})()`);
    await sleep(300);
    ok('P2 系统返回=true（退出预览）', backRet === true, backRet);
  }

  /* M6 慢循环（等待后互跳）应被检测并停止，不无限来回跳 */
  console.log('— M6 慢循环检测 —');
  {
    const p = { appName: 'm6', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [txt('x', 'P1')], "RT.on('start',async function(){await RT.wait(0.2);RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'P2')], "RT.on('start',async function(){await RT.wait(0.2);RT.gotoPage('s1');});")
    ] };
    await loadRt(p);
    const trace = [];
    for (let k = 0; k < 15; k++) {
      await sleep(200);
      trace.push(await ev(`(document.querySelector('#screen [data-id=x] .v-text')||{}).textContent+':'+(document.getElementById('toast').classList.contains('show')?document.getElementById('toast').textContent.slice(0,4):'')`));
    }
    console.log('  M6 轨迹:', trace.join(' | '));
    const warned = trace.some(x => x.indexOf('检测到') >= 0);
    ok('慢循环给出提示并停止', warned, trace);
    const tail = trace.slice(-3).map(x => x.split(':')[0]);
    ok('停止后页面稳定不再来回跳', tail[0] === tail[1] && tail[1] === tail[2], tail);
  }

  /* M7 按钮触发的"等待后跳转"不算自动循环（用户流程），可反复跳 */
  console.log('— M7 用户等待跳转不拦 —');
  {
    const p = { appName: 'm7', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('g2', '等会去2'), txt('x', 'P1')], "RT.onClick('g2',async function(){await RT.wait(0.2);RT.gotoPage('s2');});"),
      S('s2', [btn('g1', '等会去1'), txt('x', 'P2')], "RT.onClick('g1',async function(){await RT.wait(0.2);RT.gotoPage('s1');});")
    ] };
    await loadRt(p);
    await clickComp('g2'); await sleep(450);
    const p2 = await page();
    await clickComp('g1'); await sleep(450);
    const p1 = await page();
    ok('用户等待跳转正常往返', p2 === 'P2' && p1 === 'P1', { p2, p1 });
    ok('无循环提示', (await toast()) === '');
  }

  /* M8 列表项点击跳转 */
  console.log('— M8 列表项跳转 —');
  {
    const p = { appName: 'm8', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [{ id: 'l1', type: 'list' }, txt('x', 'P1')],
        "RT.onStart2=1;RT.listSet('l1',['去第二页']);RT.onItemClick('l1',async function(){RT.gotoPage('s2');});"),
      S('s2', [txt('x', 'P2')], '')
    ] };
    await loadRt(p); await sleep(200);
    await ev(`(function(){var li=document.querySelector('[data-id=l1] .li');if(li)li.click();return 1;})()`);
    await sleep(400);
    ok('点列表项跳到 P2', await page() === 'P2', await page());
  }

  /* M9 失效页面 id：不崩溃、无残留错误 */
  console.log('— M9 失效目标 —');
  {
    const p = { appName: 'm9', orientation: 'portrait', startScreen: 's1', screens: [
      S('s1', [btn('g', '去火星'), txt('x', 'P1')], "RT.onClick('g',async function(){RT.gotoPage('deleted-page');});")
    ] };
    await loadRt(p);
    await clickComp('g'); await sleep(300);
    ok('目标不存在时留在 P1', await page() === 'P1');
    ok('无未捕获异常', errs.length === 0, errs.slice(0, 2));
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
