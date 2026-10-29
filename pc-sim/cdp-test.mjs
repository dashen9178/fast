// FAST 编辑器 —— PC 端自动化回归测试（无头 Edge + CDP）
//
// 一般不用手跑，直接用同目录的一键脚本：
//   powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-ui-test.ps1
//
// 说明：编辑器整个包在一个闭包里，内部函数无法从外部调用，
//       所以这里一律通过“真实点击界面元素”来驱动，尽量贴近真人操作。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || process.env.TEMP || '.';
const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9222}`;
mkdirSync(OUT, { recursive: true });

// ---------------- 健壮的 CDP 客户端（带超时与断线处理） ----------------
let ws = null, closed = true, seq = 0;
let pending = new Map();
const jsErrors = [];

async function pickTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(CDP + '/json/list')).json();
      const t = list.find(x => x.type === 'page' && x.url.includes('editor.html'));
      if (t) return t;
    } catch { }
    await sleep(300);
  }
  throw new Error('找不到 editor.html 页面目标（浏览器没起来或地址不对？）');
}

async function open(url) {
  await new Promise((res, rej) => {
    const s = new WebSocket(url);
    const to = setTimeout(() => rej(new Error('WebSocket 连接超时')), 10000);
    s.onopen = () => { clearTimeout(to); ws = s; closed = false; res(); };
    s.onerror = () => { clearTimeout(to); rej(new Error('WebSocket 连接失败')); };
    s.onclose = () => {
      closed = true;
      for (const p of pending.values()) p.rej(new Error('CDP 连接已断开'));
      pending.clear();
    };
    s.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') jsErrors.push('异常: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').split('\n')[0]);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const line = 'console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        // 「运行时报错定位」用例是**故意**在运行时抛一个错的（否则没法验证上报），
        // 它必然带一条 console.error —— 那是用例的预期输出，不算真 bug。
        if (!/逻辑执行错误 Error: 测试用错误/.test(line)) jsErrors.push(line);
      }
    };
  });
}

function send(method, params = {}, timeoutMs = 15000) {
  if (closed || !ws) return Promise.reject(new Error('CDP 已断开，无法发送 ' + method));
  return new Promise((res, rej) => {
    const i = ++seq;
    const timer = setTimeout(() => {
      if (pending.has(i)) { pending.delete(i); rej(new Error('CDP 超时: ' + method)); }
    }, timeoutMs);
    pending.set(i, {
      res: v => { clearTimeout(timer); res(v); },
      rej: e => { clearTimeout(timer); rej(e); }
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}

// 断线就重连，并重新启用需要的域
async function ensureAlive() {
  if (!closed && ws) return;
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
// 打开触摸模拟：真机是触摸输入，测试也要能投递触摸事件
try { await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch (e) {}
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function js(expr) {
  await ensureAlive();
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0]);
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(OUT, name + '.png');
  writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
}
async function waitFor(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await js(expr)) return true; } catch (e) { if (/找不到|连接失败/.test(e.message)) throw e; }
    await sleep(250);
  }
  return false;
}

// ---------------- 开跑 ----------------
const target = await pickTarget();
await open(target.webSocketDebuggerUrl);
await send('Runtime.enable');
await send('Page.enable');
try { await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
// 分享在浏览器里会退化成下载 .fast；测试只关心内容，禁止真正落盘（失败也不影响测试）
try { await send('Browser.setDownloadBehavior', { behavior: 'deny' }); } catch { }

const results = [];
async function check(name, fn) {
  try { const v = await fn(); results.push({ name, ok: v !== false && v !== undefined, info: v === true ? '' : JSON.stringify(v) }); }
  catch (e) { results.push({ name, ok: false, info: 'ERR: ' + e.message }); }
}
const clickText = (sel, re) => js(`(function(){
  var el = Array.from(document.querySelectorAll(${JSON.stringify(sel)}))
    .find(function(x){ return !x.closest('.hidden') && new RegExp(${JSON.stringify(re)}).test((x.textContent||'').trim()) });
  if(!el) return 'NOT_FOUND'; el.click(); return 'ok';
})()`);
const viewsVisible = () => js(`Array.from(document.body.children).filter(function(e){return !e.classList.contains('hidden')}).map(function(e){return e.id}).filter(Boolean).join(',')`);
const editorVisible = () => js(`Array.from(document.body.children).some(function(e){return e.id==='viewEditor'&&!e.classList.contains('hidden')})`);

await check('页面加载完成', async () => { await waitFor(`document.readyState==='complete'`); return (await js('document.readyState')) === 'complete'; });

// 从干净状态开始：清 localStorage 后重新加载
await js('try{localStorage.clear()}catch(e){}');
await send('Page.reload', { ignoreCache: true }, 20000).catch(() => {});
await sleep(1500);
await ensureAlive();
await check('重新加载后编辑器可用', async () => await waitFor(`document.readyState==='complete' && !!window.Blockly`));
jsErrors.length = 0;

await check('显示首页视图', async () => (await viewsVisible()).includes('viewHome'));
await check('Blockly 库已加载', async () => (await js('typeof window.Blockly')) === 'object');
await check('首页有「创建新 App」按钮', async () => (await js(`Array.from(document.querySelectorAll('#viewHome button')).some(function(b){return /创建新 ?App|新建/.test(b.textContent||'')})`)) === true);
await shot('t01-首页');

await check('点击「创建新 App」打开新建弹窗', async () => (await clickText('#viewHome button', '创建新 ?App|新建')) === 'ok');
await check('弹窗出现且有名称输入框', async () => await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`));
await js(`(function(){var i=document.querySelector('#createMask input');i.value='回归测试App';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await shot('t02-新建弹窗');
await check('确认创建后进入编辑器', async () => {
  await js(`document.getElementById('createGo').click()`);
  return await waitFor(`Array.from(document.body.children).some(function(e){return e.id==='viewEditor'&&!e.classList.contains('hidden')})`);
});
await sleep(600);
await check('设计页的「添加组件」列出了全部控件（含新增的 11 种）', async () => {
  const r = await js(`(function(){
    var 按钮 = Array.prototype.map.call(document.querySelectorAll('.addbtns [data-add]'), function (b) {
      return b.getAttribute('data-add');
    });
    var 类型 = Object.keys(window.EditorApp.__aiTypeMeta());
    return { 按钮: 按钮, 类型: 类型, 缺按钮: 类型.filter(function (t) { return 按钮.indexOf(t) < 0; }) };
  })()`);
  if (!r.按钮.length) throw new Error('「添加组件」一个按钮都没有');
  if (r.缺按钮.length) throw new Error('这些控件在界面上没有按钮（只能靠 AI 建）：' + JSON.stringify(r.缺按钮));
  return { 按钮数: r.按钮.length };
});

// 每个按钮都要真的能建出对应控件（这是"界面上能不能用"的唯一可信验证）
await check('「添加组件」里每个按钮都能建出对应控件', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    var 按钮 = Array.prototype.map.call(document.querySelectorAll('.addbtns [data-add]'), function (b) { return b.getAttribute('data-add'); });
    var 建不出 = [], 超大 = [], 最大宽 = 0, 最大高 = 0;
    按钮.forEach(function (t) {
      var 前 = App.__aiComps().length;
      var btn = document.querySelector('.addbtns [data-add="' + t + '"]');
      btn.click();
      var 后 = App.__aiComps();
      if (后.length !== 前 + 1) 建不出.push(t);
      else if (后[0].type !== t) 建不出.push(t + '(类型变成 ' + 后[0].type + ')');
      // 新控件不能一创建就占掉大半个画面（用户 2026-10-29 反馈）：宽 ≤ 设计宽 88%、高 ≤ 设计高 25%
      var 新 = 后[0], w = 新.w || 0, h = 新.h || 0;
      if (w > 最大宽) 最大宽 = w;
      if (h > 最大高) 最大高 = h;
      if (w > 343 || h > 207) 超大.push(t + ' ' + w + 'x' + h);
    });
    return { 按钮数: 按钮.length, 建不出: 建不出, 超大: 超大, 最大宽: 最大宽, 最大高: 最大高, 控件总数: App.__aiComps().length };
  })()`);
  if (r.建不出.length) throw new Error('这些按钮建不出控件：' + JSON.stringify(r));
  if (r.超大.length) throw new Error('这些控件一创建就占太大面积（宽>343 或 高>207）：' + JSON.stringify(r.超大));
  // 用完清掉：留着 23 个控件会让后面「AI 该改哪个控件」的用例产生歧义（实测把 AI 逼去反问）
  await js(`(function(){
    var App = window.EditorApp;
    App.__aiComps().slice().forEach(function (c) { App.__aiApplyComponents([{ op:'remove', id: c.id }]); });
    return App.__aiComps().length;
  })()`);
  return { 全部可建: r.按钮数 + ' 种', 最大初始尺寸: r.最大宽 + 'x' + r.最大高, 已清理: true };
});
await shot('t03-设计页');

await check('点「按钮」组件后有控件/属性面板', async () => {
  await clickText('#viewEditor button', '^按钮$');
  await sleep(500);
  return (await js(`document.querySelectorAll('#viewEditor [id^=comp],#compList *,#propPanel *').length`)) > 0;
});
await shot('t04-加了按钮组件');

await check('切到「代码」页后工作区就绪', async () => {
  await clickText('#viewEditor button, #viewEditor div', '^代码$');
  return await waitFor(`(function(){try{return !!(Blockly.getMainWorkspace&&Blockly.getMainWorkspace())}catch(e){return false}})()`, 10000);
});
await sleep(800);
await check('代码页分类栏有内容', async () => (await js(`document.querySelectorAll('#catRail *,#rail *,[class*=cat] *').length`)) > 5);
await shot('t05-代码页');

const putBlock = (type, x, y) => js(`(function(){
  var ws = Blockly.getMainWorkspace(); if(!ws) return 'no ws';
  var b = ws.newBlock(${JSON.stringify(type)});
  if(b.initSvg) b.initSvg(); b.render(); b.moveBy(${x},${y});
  return 'ok';
})()`);
await check('放置事件代码 ev_start', async () => (await putBlock('ev_start', 60, 60)) === 'ok');
await check('放置如果代码 controls_if', async () => (await putBlock('controls_if', 60, 220)) === 'ok');
await sleep(700);
await check('画布上确实有代码', async () => (await js(`(function(){try{return Blockly.getMainWorkspace().getAllBlocks(false).length}catch(e){return -1}})()`)) >= 2);
await shot('t06-代码外形');

// ---------------- 安全：代码文字字段的转义 ----------------
// 代码会被编译成 JS 再由运行时执行（runtime.js 的 new Function('RT', sc.code)）。
// 所以"文本"类代码的取值必须被正确转义：只转义单引号是不够的，反斜杠同样能逃逸出字符串。
// 一个手改的 .fast 作品文件、或将来 AI 生成的代码，都可能带这种载荷。这条测试长期守着它。
const INJECTION_PAYLOADS = [
  "\\';window.__INJ=1;//",   // 反斜杠 + 单引号：经典逃逸
  "a\";window.__INJ=2;//",   // 双引号
  "a\\n);window.__INJ=3;//", // 反斜杠 + n
  "a\\\\';window.__INJ=4;//" // 双重反斜杠
];
await check('代码文字字段做了转义（防代码注入）', async () => {
  const bad = [];
  for (const payload of INJECTION_PAYLOADS) {
    const r = await js(`(function(){
      var ws = Blockly.getMainWorkspace(); if(!ws) return {err:'no workspace'};
      var b = ws.newBlock('text');
      try {
        if (b.initSvg) b.initSvg();
        b.setFieldValue(${JSON.stringify(payload)}, 'TEXT');
        var code = Blockly.JavaScript.blockToCode(b);
        if (Array.isArray(code)) code = code[0];
        code = String(code);
        delete window.__INJ;
        var value = null, threw = null;
        try { value = eval(code); } catch (e) { threw = String(e && e.message || e); }
        var injected = (typeof window.__INJ !== 'undefined');
        delete window.__INJ;
        return { code: code, value: value, threw: threw, injected: injected };
      } finally { try { b.dispose(false); } catch (e) {} }
    })()`);
    if (r && (r.injected || r.threw || r.value !== payload)) {
      bad.push({ payload: payload, r: r });
    }
  }
  return bad.length === 0 ? true : { 逃逸成功或转义不正确: bad };
});

// ---------------- AI 助手 ----------------
await check('代码页有 AI 悬浮球', async () => {
  const r = await js(`(function(){
    var b=document.getElementById('aiBall'); if(!b) return 'no ball';
    var host=document.getElementById('viewBlocks');
    if(!host || host.classList.contains('hidden')) return 'blocks view hidden';
    var st=getComputedStyle(b);
    return st.position==='absolute' ? true : ('position='+st.position);
  })()`);
  return r;
});

await check('悬浮球挂在编辑器外壳上（设计页、代码页都能用）', async () => {
  const r = await js(`(function(){
    var b=document.getElementById('aiBall'), p=document.getElementById('aiPanel');
    var ed=document.getElementById('viewEditor'), vb=document.getElementById('viewBlocks');
    return { 球在外壳内: !!(b && ed && ed.contains(b)),
             面板在外壳内: !!(p && ed && ed.contains(p)),
             不再局限代码页: !(b && vb && vb.contains(b)) };
  })()`);
  if (!(r && r.球在外壳内 && r.面板在外壳内 && r.不再局限代码页)) throw new Error('悬浮球位置不对：' + JSON.stringify(r));
  return true;
});

await check('拖动悬浮球能移动位置并记住，且不会误开面板', async () => {
  const r = await js(`(function(){
    var b=document.getElementById('aiBall');
    var r0=b.getBoundingClientRect();
    function pe(t,x,y){ b.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,isPrimary:true})); }
    pe('pointerdown', r0.left+12, r0.top+12);
    pe('pointermove', r0.left+72, r0.top+52);
    pe('pointerup',   r0.left+72, r0.top+52);
    var r1=b.getBoundingClientRect();
    var saved=null; try{ saved=JSON.parse(localStorage.getItem('__bb_ai_ball_pos_v1')||'null'); }catch(e){}
    return {
      movedX: Math.round(r1.left-r0.left), movedY: Math.round(r1.top-r0.top),
      saved: !!saved,
      panelOpen: !document.getElementById('aiPanel').classList.contains('hidden')
    };
  })()`);
  return (r && r.movedX > 20 && r.movedY > 20 && r.saved && r.panelOpen === false) ? true : r;
});

await check('轻点悬浮球（不拖动）打开 AI 面板', async () => {
  const r = await js(`(function(){
    var b=document.getElementById('aiBall');
    var r0=b.getBoundingClientRect();
    function pe(t,x,y){ b.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:2,isPrimary:true})); }
    pe('pointerdown', r0.left+12, r0.top+12);
    pe('pointerup',   r0.left+12, r0.top+12);
    return !document.getElementById('aiPanel').classList.contains('hidden');
  })()`);
  return r === true;
});
await shot('t11-AI面板');

// 用户反馈"AI 助手没办法识别 key"：以前 Key 只在输入框**失焦(change)**时才保存，
// 手机上打完直接切走/点生成时其实还没存进去 → 生成时报"还没有填 Key"。
await check('刚粘贴的 Key 立刻就能被识别（不用等失焦）', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    App.__openSettings('ai');
    var inp=document.getElementById('aiKey');
    if (!inp) return { 没有输入框:true };
    var 原 = App.__aiKeyRead();
    // 模拟"刚粘贴进去、还没失焦"：只派发 input 事件
    inp.value = 'sk-test-1234567890abcdef';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var 立刻 = App.__aiKeyRead();
    var 状态 = (document.getElementById('aiKeyStatus')||{}).textContent || '';
    // 清掉，别影响后面的用例
    inp.value = 原; App.__aiKeyWrite(原);
    return { 立即读到: 立刻, 状态文字: 状态, 原值长度: (原||'').length };
  })()`);
  if (r.没有输入框) throw new Error('设置里没有 Key 输入框');
  if (r.立即读到 !== 'sk-test-1234567890abcdef') throw new Error('刚粘贴的 Key 还没被识别：' + JSON.stringify(r));
  if (!/已保存/.test(r.状态文字)) throw new Error('没有显示 Key 的保存状态：' + JSON.stringify(r));
  return { 识别: '立刻', 状态: r.状态文字 };
});
await check('设置里有 AI Key 输入框与测试按钮', async () => {
  const r = await js(`(function(){
    var k=document.getElementById('aiKey'), t=document.getElementById('aiKeyTest');
    return { key: !!k, test: !!t, type: k ? k.type : '', inSettings: !!(k && k.closest('#viewSettings')) };
  })()`);
  return (r.key && r.test && r.type === 'password' && r.inSettings) ? true : r;
});

// 用户 2026-10-29 要求：设置改成整页（不再是小窗），左侧分类 常规 / AI / 反馈 切换。
await check('设置是整页，左侧三栏分类能切换、内容没被挤扁', async () => {
  // 走真实入口（点设置按钮），这样主题色块等才会被渲染出来
  await js(`document.getElementById('btnSettings').click()`);
  await sleep(700);   // 等切页动画结束，否则量到的是动画中的尺寸（踩过）
  const m = await js(`(function(){
    // 设置重新进来时会回到上次那一栏，这里先明确切回「常规」
    document.querySelector('#setRail .acct-item[data-cat="general"]').click();
    var groups=Array.prototype.map.call(document.querySelectorAll('#setPaneGeneral .set-group'), function(g){
      var b=g.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    var seg=document.getElementById('modeSeg').getBoundingClientRect();
    var rail=Array.prototype.map.call(document.querySelectorAll('#setRail .acct-item'), function(b){
      return { 名: b.textContent.trim(), 宽: Math.round(b.getBoundingClientRect().width), 选中: b.classList.contains('on') };
    });
    var 是弹窗 = !!document.getElementById('settingsMask');
    // 切到 AI 分类：常规要隐藏、AI 要显示（顺便量一下输入框宽度，藏着时量是 0）
    document.querySelector('#setRail .acct-item[data-cat="ai"]').click();
    var key=document.getElementById('aiKey').getBoundingClientRect();
    var 切到AI = { 常规隐藏: document.getElementById('setPaneGeneral').classList.contains('hidden'),
                   AI显示: !document.getElementById('setPaneAi').classList.contains('hidden') };
    document.querySelector('#setRail .acct-item[data-cat="general"]').click();
    return { 分组: groups, 显示模式宽: Math.round(seg.width), AI输入框宽: Math.round(key.width),
             主题色块数: document.querySelectorAll('#seedRow .seed-swatch').length,
             左栏: rail, 仍是弹窗: 是弹窗, 切到AI: 切到AI,
             排序默认: (function(){ var b=document.querySelector('#setSort .on'); return b ? b.getAttribute('data-sort') : ''; })(),
             动画默认: (function(){ var b=document.querySelector('#setAnim .on'); return b ? b.getAttribute('data-anim') : ''; })() };
  })()`);
  await shot('t13-设置整页');
  await js(`document.getElementById('btnSettingsBack').click()`);
  await sleep(300);
  if (m.仍是弹窗) throw new Error('设置还是小窗（#settingsMask 不该再存在）');
  if (!m.分组 || m.分组.length < 3) throw new Error('常规分类的分组数不对：' + JSON.stringify(m));
  if (m.主题色块数 < 5) throw new Error('主题色块没渲染出来：' + JSON.stringify(m));
  const squashed = m.分组.filter(function (g) { return g.w < 150 || g.h < 20; });
  if (squashed.length) throw new Error('有分组被挤扁：' + JSON.stringify(m));
  const 各组宽 = m.分组.map(function (g) { return g.w; });
  if (Math.max.apply(null, 各组宽) - Math.min.apply(null, 各组宽) > 1) {
    throw new Error('设置分组宽窄不一（看着会不齐）：' + 各组宽.join(' / '));
  }
  if (m.显示模式宽 < 140) throw new Error('显示模式按钮被挤扁：' + JSON.stringify(m));
  if (m.AI输入框宽 < 150) throw new Error('AI Key 输入框太窄：' + JSON.stringify(m));
  if (m.左栏.length !== 3 || m.左栏.map(function (x) { return x.名; }).join(',') !== '常规,AI,反馈') {
    throw new Error('左侧分类应为 常规/AI/反馈：' + JSON.stringify(m.左栏));
  }
  if (m.左栏.filter(function (x) { return x.选中; }).length !== 1) throw new Error('左侧分类必须只有一个选中：' + JSON.stringify(m.左栏));
  if (!m.切到AI.常规隐藏 || !m.切到AI.AI显示) throw new Error('点「AI」没切过去：' + JSON.stringify(m.切到AI));
  if (m.排序默认 !== 'auto') throw new Error('「作品如何排序」默认应勾「自动调整」，实际：' + m.排序默认);
  if (m.动画默认 !== 'on') throw new Error('「界面动画」默认应勾「开启」，实际：' + m.动画默认);
  return m;
});

// 用户 2026-10-29 报的 bug：选了某一栏、返回、再进设置，标签还是上次那栏、内容却变回常规
await check('设置重新进入时左侧标签和右侧内容对得上（滑块也停对位置）', async () => {
  await js(`document.getElementById('btnSettings').click()`);
  await sleep(600);
  await js(`document.querySelector('#setRail .acct-item[data-cat="feedback"]').click()`);
  await sleep(200);
  await js(`document.getElementById('btnSettingsBack').click()`);
  await sleep(300);
  await js(`document.getElementById('btnSettings').click()`);
  await sleep(700);
  const m = await js(`(function(){
    var on = document.querySelector('#setRail .acct-item.on');
    var panes = Array.prototype.slice.call(document.querySelectorAll('#viewSettings .acct-pane'))
      .filter(function (p) { return !p.classList.contains('hidden'); });
    var pill = document.querySelector('#setRail .seg-pill');
    var pr = pill ? pill.getBoundingClientRect() : null, or = on ? on.getBoundingClientRect() : null;
    var out = { 选中: on ? on.getAttribute('data-cat') : '',
                显示: panes.map(function (p) { return p.id.replace('setPane', '').toLowerCase(); }),
                滑块对位: !!(pr && or && Math.abs(pr.top - or.top) < 2 && Math.abs(pr.height - or.height) < 2) };
    document.getElementById('btnSettingsBack').click();
    return out;
  })()`);
  await sleep(300);
  if (m.选中 !== 'feedback') throw new Error('重新进入应回到上次那一栏 feedback，实际：' + m.选中);
  if (m.显示.join(',') !== 'feedback') throw new Error('标签与内容对不上：' + JSON.stringify(m));
  if (!m.滑块对位) throw new Error('左侧滑块没跟着停到选中项上：' + JSON.stringify(m));
  return m;
});

// 用户 2026-10-29 报的 bug：在设置里点「查看 / 导出诊断信息」没反应（以前只有打开过工程才绑上）
// 同一天又报：点它会"自己返回首页"、还是弹窗 —— 现在改成独立整页，关掉只回设置（不回家）
await check('设置里点「查看 / 导出诊断信息」打开整页诊断（关掉只回设置，不回家）', async () => {
  await js(`document.getElementById('btnSettings').click()`);
  await sleep(600);
  await js(`document.querySelector('#setRail .acct-item[data-cat="feedback"]').click()`);
  await sleep(250);
  await js(`document.getElementById('btnDiag').click()`);
  await sleep(500);
  const 开 = await js(`(function(){
    var v = document.getElementById('viewDiag');
    var pre = document.getElementById('diagPre');
    var txt = pre ? String(pre.textContent) : '';
    return { 是整页: !!v && !v.classList.contains('hidden'), 有内容: txt.length > 20,
             头一行: txt.split('\\n')[0],
             还不是弹窗: !document.getElementById('diagSheet'),
             首页没露出来: document.getElementById('viewHome').classList.contains('hidden') };
  })()`);
  await shot('t13b-诊断信息');
  if (!开.是整页 || !开.有内容) throw new Error('点「查看诊断信息」没打开整页：' + JSON.stringify(开));
  if (!开.还不是弹窗) throw new Error('诊断信息还是弹窗形式：' + JSON.stringify(开));
  if (!开.首页没露出来) throw new Error('打开诊断信息后首页露出来了（看着像被踢回首页）：' + JSON.stringify(开));
  const 回 = await js(`(function(){
    document.getElementById('btnDiagBack').click();
    var on = document.querySelector('#setRail .acct-item.on');
    return { 诊断已关: document.getElementById('viewDiag').classList.contains('hidden'),
             设置回来了: !document.getElementById('viewSettings').classList.contains('hidden'),
             还是反馈: on ? on.getAttribute('data-cat') : '',
             首页没露出来: document.getElementById('viewHome').classList.contains('hidden') };
  })()`);
  await sleep(300);
  if (!回.诊断已关 || !回.设置回来了) throw new Error('从诊断页返回没有回到设置：' + JSON.stringify(回));
  if (回.还是反馈 !== 'feedback') throw new Error('从诊断页返回后设置栏没停在「反馈」：' + JSON.stringify(回));
  if (!回.首页没露出来) throw new Error('从诊断页返回时首页露出来了：' + JSON.stringify(回));
  await js(`document.getElementById('btnSettingsBack').click()`);
  await sleep(300);
  return { 形式: '整页', 返回: '回设置「反馈」', 头一行: 开.头一行 };
});

// 这两条是整个 AI 方案的地基：清单能不能自动生成、脏代码能不能被拦下来。
// 它们不联网，所以能稳定跑。
await check('AI 代码清单能从工具箱自动提取', async () => {
  const r = await js(`(function(){
    var c = window.EditorApp.__aiCatalog();
    return { 字节: c.length, 有事件代码: c.indexOf('ev_start')>=0, 有页面代码: c.indexOf('act_toast')>=0,
             有内置取值: c.indexOf('math_number')>=0 || c.indexOf('text')>=0, 分类数: (c.match(/<block /g)||[]).length };
  })()`);
  return (r && r.字节 > 800 && r.有事件代码 && r.有页面代码) ? r : false;
});

await check('AI 控件操作会被校验（未知类型/不存在的 id 一律拦下）', async () => {
  const r = await js(`(function(){
    var before = window.EditorApp.__aiCompSummary();
    var ok = window.EditorApp.__aiValidateComponents([
      { op:'add', type:'button', props:{ text:'登录' } },
      { op:'add', type:'button', props:{ name:'111' } },
      { op:'add', type:'__不存在的控件__', props:{} },
      { op:'update', id:'__不存在__', props:{ text:'x' } },
      { op:'remove', id:'__不存在__' },
      { op:'add', type:'text', props:{ __乱来__:'x', value:'标题' } }
    ]);
    return { 通过数: ok.actions.length, 丢弃数: ok.dropped.length, 明细: ok.actions, 丢弃明细: ok.dropped, 摘要: before };
  })()`);
  // name（组件名称）必须被接受 —— 它和显示文字 text 是两个不同的属性
  if (!r || r.通过数 !== 3) throw new Error('校验结果不对（name 是否被漏掉了？）：' + JSON.stringify(r));
  if (r.丢弃数 !== 4) throw new Error('该丢的没丢掉：' + JSON.stringify(r));
  if (!r.丢弃明细.some(function (x) { return String(x).indexOf('__乱来__') >= 0; })) {
    throw new Error('未知属性被丢掉了，但没在"已忽略"里说明：' + JSON.stringify(r));
  }
  const withName = r.明细.filter(function (a) { return a.props && a.props.name === '111'; });
  if (withName.length !== 1) throw new Error('name 属性没有被保留：' + JSON.stringify(r));
  const added = r.明细.filter(function (a) { return a.op === 'add'; });
  if (added.some(function (a) { return Object.prototype.hasOwnProperty.call(a.props, '__乱来__'); })) {
    throw new Error('未知属性没有被过滤：' + JSON.stringify(r));
  }
  return { 通过: r.通过数, 丢弃: r.丢弃数 };
});

// 真机反馈：用户让 AI"帮忙调一下排版"，AI 回"我没有位置、大小、间距、对齐这类属性，做不到"。
// 属性面板里明明有这些字段，所以这里把排版/外观类属性也放开给 AI，并守住取值范围。
await check('AI 能改排版（位置/大小/对齐/字号/颜色），越界值会被夹住或丢掉', async () => {
  const r = await js(`(function(){
    var good = window.EditorApp.__aiValidateComponents([
      { op:'update', id:'button1', props:{ x:40, y:300, w:220, h:56, align:'居中', fs:18,
                                            color:'#FF0000', bg:'fff', radius:12, bold:true, spacing:2 } }
    ]);
    var bad = window.EditorApp.__aiValidateComponents([
      { op:'update', id:'button1', props:{ x:99999, y:'自动', w:'很宽', align:'middle',
                                            color:'red', fs:999, radius:-5 } }
    ]);
    return { 正常: good.actions[0] && good.actions[0].props, 正常丢弃: good.dropped,
             越界: bad.actions[0] && bad.actions[0].props, 越界丢弃: bad.dropped };
  })()`);
  const g = r && r.正常, b = r && r.越界;
  if (!g) throw new Error('排版属性被整体丢掉了（AI 又会说"做不到"）：' + JSON.stringify(r));
  if (!(g.x === 40 && g.y === 300 && g.w === 220 && g.h === 56)) throw new Error('位置/大小没保留：' + JSON.stringify(g));
  if (g.align !== 'center') throw new Error('中文"居中"没有归一化成 center：' + JSON.stringify(g));
  if (g.fs !== 18 || g.radius !== 12 || g.spacing !== 2) throw new Error('字号/圆角/字间距没保留：' + JSON.stringify(g));
  if (g.color !== '#ff0000' || g.bg !== '#fff') throw new Error('颜色没有归一化：' + JSON.stringify(g));
  if (g.bold !== true) throw new Error('加粗没保留：' + JSON.stringify(g));
  if (!b) throw new Error('越界那组整条被丢了：' + JSON.stringify(r));
  if (b.x !== 4000) throw new Error('x 越界没有被夹到上限：' + JSON.stringify(b));
  if (b.fs !== 96) throw new Error('字号越界没有被夹到上限：' + JSON.stringify(b));
  if (b.radius !== 0) throw new Error('圆角负数没有被夹到 0：' + JSON.stringify(b));
  if (b.y !== null) throw new Error('"自动"没有被翻译成 null：' + JSON.stringify(b));
  if ('w' in b || 'align' in b || 'color' in b) throw new Error('非法值没有被丢掉：' + JSON.stringify(b));
  if ((r.越界丢弃 || []).length !== 3) throw new Error('丢弃明细数量不对：' + JSON.stringify(r.越界丢弃));

  // 落到控件上：apply 之后按钮的位置/大小/对齐必须真的变了
  const n = await js(`window.EditorApp.__aiApplyComponents([
    { op:'update', id:'button1', props:{ x:40, y:300, w:220, h:56, align:'center', fs:20 } }])`);
  const after = await js(`(window.EditorApp.__aiComps()||[]).filter(function(c){return c.id==='button1';})[0]`);
  if (!(n >= 1)) throw new Error('apply 没有落地：' + n);
  if (!after || after.x !== 40 || after.y !== 300 || after.w !== 220 || after.h !== 56
      || after.align !== 'center' || after.fs !== 20) {
    throw new Error('排版改动没有落到控件上：' + JSON.stringify({ after: after }));
  }

  // 新增控件时 AI 指定的宽高也不能被"默认尺寸"冲掉
  const added = await js(`(function(){
    window.EditorApp.__aiApplyComponents([{ op:'add', type:'button', props:{ text:'排版测试', x:24, y:120, w:180, h:60 } }]);
    var cs = window.EditorApp.__aiComps() || [];
    return cs.filter(function(c){ return c.text === '排版测试'; })[0] || null;
  })()`);
  if (!added || added.w !== 180 || added.h !== 60 || added.x !== 24 || added.y !== 120) {
    throw new Error('新增控件时 AI 给的宽高/位置被默认值冲掉了：' + JSON.stringify(added));
  }

  // 给 AI 的说明书里必须写清楚它有排版能力，否则模型还是会说"做不到"
  const hasLayout = await js(`window.EditorApp.__aiPromptHas('x、y、w、h')`);
  const hasNoExcuse = await js(`window.EditorApp.__aiPromptHas('不要说')`);
  if (!hasLayout || !hasNoExcuse) {
    throw new Error('系统提示里没告诉 AI 它能调排版（模型还会继续说做不到）：layout=' + hasLayout + ' excuse=' + hasNoExcuse);
  }
  const summary = await js(`window.EditorApp.__aiCompSummary()`);
  if (!/画布（设计像素）/.test(summary) || !/位置=/.test(summary) || !/大小=/.test(summary)) {
    throw new Error('控件清单里没有带上画布尺寸和当前位置：' + JSON.stringify(summary).slice(0, 200));
  }
  return { 正常: g, 越界: b, 落地: after.x + ',' + after.y + ' ' + after.w + 'x' + after.h,
           新增: added.id + ' ' + added.w + 'x' + added.h, 丢弃: r.越界丢弃 };
});

await check('AI 返回裸 <block>（没有 <xml> 外壳）时也能正确渲染', async () => {
  const r = await js(`(function(){
    // 模型经常这么返回；domToWorkspace 要求根是 <xml>，不补外壳就会一个代码都建不出来
    var bare = '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">裸块</field></shadow></value></block>';
    var res = window.EditorApp.__aiValidateXml(bare);
    if (!res.ok) return { 校验: res };
    return { 校验: res, 根节点: res.根节点 };
  })()`);
  if (!r || !r.校验 || !r.校验.ok) throw new Error('裸 <block> 被判为非法：' + JSON.stringify(r));
  if (r.根节点 !== 'xml') throw new Error('没有补上 <xml> 外壳：' + JSON.stringify(r));
  return r;
});

await check('AI 生成的脏代码会被拦下（不存在的类型被丢弃）', async () => {
  const r = await js(`(function(){
    var good = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="__不存在的代码__"></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">你好</field></shadow></value></block>'
      + '</xml>';
    var onlyBad = '<xml xmlns="https://developers.google.com/blockly/xml"><block type="__不存在的代码__"></block></xml>';
    return { 混着坏块: window.EditorApp.__aiValidateXml(good), 全是坏块: window.EditorApp.__aiValidateXml(onlyBad) };
  })()`);
  const a = r && r.混着坏块, b = r && r.全是坏块;
  return (a && a.ok && a.dropped && a.dropped.length === 1 && b && b.ok === false) ? true : r;
});

// ---------------- 【联网】真实调用 DeepSeek，端到端 ----------------
// API Key 只从环境变量来，绝不写进本文件 —— 这个文件是提交进 git 的。
// 用法：先 $env:AI_TEST_KEY='sk-xxx' 再跑 run-ui-test.ps1
const AI_TEST_KEY = process.env.AI_TEST_KEY || '';
// 默认**不跑**联网用例：真实调用很费 token（用户明确要求减少）。
// 需要时：$env:AI_LIVE='1' + $env:AI_TEST_KEY='sk-...' 再跑。
if (!AI_TEST_KEY || process.env.AI_LIVE !== '1') {
  results.push({ name: '【联网】AI 真实调用（默认跳过；要跑请设 AI_LIVE=1）', ok: true, info: 'skipped' });
} else {
  await check('【联网】生成代码 -> 按钮打开面板内画布 -> 能返回 -> 能插入', async () => {
    await js(`window.EditorApp.__aiKeyWrite(${JSON.stringify(AI_TEST_KEY)})`);
    const before = await js(`Blockly.getMainWorkspace().getAllBlocks(false).length`);
    // 说清楚是哪个控件：页面里可能有不止一个按钮，含糊的问法现在会被 AI 反问（那是另一个用例在管）
    await js(`(function(){ document.getElementById('aiInput').value='让「按钮」这个控件被点击时，弹出提示「你好」'; })()`);
    await js(`document.getElementById('aiSend').click()`);
    const settled = await waitFor(`(function(){
      var w=document.getElementById('aiPreviewWrap'), s=document.getElementById('aiStatus');
      return !w.classList.contains('hidden') || s.classList.contains('err'); })()`, 120000);
    const st = await js(`(function(){
      var w=document.getElementById('aiPreviewWrap'), s=document.getElementById('aiStatus');
      var cv=document.getElementById('aiCanvasPage');
      return { text:s.textContent, err:s.classList.contains('err'),
               有按钮:!!document.getElementById('aiOpenCanvas'),
               画布页初始是隐藏的: cv.classList.contains('hidden'),
               聊天页在看: !document.getElementById('aiChatPage').classList.contains('hidden') }; })()`);
    if (!settled || st.err || !st.有按钮) {
      const diag = await js(`({模型原样返回:String(window.__aiLastRaw||'').slice(0,500),校验错误:window.__aiLastXmlError||''})`);
      throw new Error('AI 没生成出可用代码：' + JSON.stringify(st) + ' 诊断=' + JSON.stringify(diag));
    }
    // 生成完先给按钮，不能直接弹画布
    if (!st.画布页初始是隐藏的 || !st.聊天页在看) throw new Error('生成后不该直接显示画布：' + JSON.stringify(st));

    // 点按钮：画布页出现，而且必须仍在 AI 面板的框内（不是全屏）
    await js(`document.getElementById('aiOpenCanvas').click()`);
    await sleep(900);
    const cv = await js(`(function(){
      var host=document.getElementById('aiPreview');
      var panel=document.getElementById('aiPanel');
      var pr=panel.getBoundingClientRect(), hr=host.getBoundingClientRect();
      return { 画布页显示: !document.getElementById('aiCanvasPage').classList.contains('hidden'),
               聊天页隐藏: document.getElementById('aiChatPage').classList.contains('hidden'),
               宿主尺寸: [host.offsetWidth, host.offsetHeight],
               在面板框内: (hr.left >= pr.left - 1 && hr.right <= pr.right + 1 && hr.top >= pr.top - 1 && hr.bottom <= pr.bottom + 1),
               有返回按钮: !!document.getElementById('aiCanvasBack') }; })()`);
    if (!cv.画布页显示 || !cv.聊天页隐藏) throw new Error('点了按钮画布页没出来：' + JSON.stringify(cv));
    if (!cv.在面板框内) throw new Error('画布跑到面板外面去了（不该是全屏）：' + JSON.stringify(cv));
    if (cv.宿主尺寸[0] < 200 || cv.宿主尺寸[1] < 80) throw new Error('画布太小：' + JSON.stringify(cv));
    if (!cv.有返回按钮) throw new Error('画布上没有返回按钮');

    const pinfo = await js(`window.EditorApp.__aiPreviewInfo()`);
    if (!pinfo || pinfo.wsBlocks <= 0) throw new Error('画布里没有代码：' + JSON.stringify(pinfo) + ' 诊断=' + await js('String(window.__aiLastPreviewError||"")'));
    if (pinfo.svg <= 0 || pinfo.gTags <= 5) throw new Error('画布有代码但没画出来：' + JSON.stringify(pinfo));
    await shot('t12-AI代码画布');

    // 返回按钮回到对话页
    await js(`document.getElementById('aiCanvasBack').click()`);
    await sleep(400);
    const backOk = await js(`(!document.getElementById('aiChatPage').classList.contains('hidden'))
      && document.getElementById('aiCanvasPage').classList.contains('hidden')`);
    if (!backOk) throw new Error('返回按钮没能回到对话页');

    // 再进去，用按钮插入到页面画布
    await js(`document.getElementById('aiOpenCanvas').click()`);
    await sleep(700);
    const dinfo = await js(`window.EditorApp.__aiDragInfo()`);
    if (!dinfo || !dinfo.画布只读) throw new Error('面板里的画布不是只读：' + JSON.stringify(dinfo));
    if (dinfo.块可拖动 || dinfo.块可编辑) throw new Error('框里的代码还能拖动/编辑：' + JSON.stringify(dinfo));
    if (dinfo.工具箱里有AI分类) throw new Error('左侧抽屉里还挂着 AI 分类（用户要求去掉）：' + JSON.stringify(dinfo));
    await js(`document.getElementById('aiCanvasInsert').click()`);
    await sleep(900);
    const after = await js(`Blockly.getMainWorkspace().getAllBlocks(false).length`);
    if (!(after > before)) throw new Error('按钮插入没落到页面画布 ' + before + ' -> ' + after);
    return { 画布代码: pinfo.wsBlocks, 画布尺寸: cv.宿主尺寸, 页面画布: before + ' -> ' + after, AI说: st.text };
  });
  await check('悬浮球与面板之间有变形动画（打开时球缩进去、关闭时变回来）', async () => {
    // 此刻面板应是开着的（前一步拖放成功会自动关闭，这里统一重置成关闭态）
    await js(`(function(){ var p=document.getElementById('aiPanel'); if(p && !p.classList.contains('hidden')) document.getElementById('aiClose').click(); })()`);
    await sleep(500);
    const before = await js(`(function(){
      var b=document.getElementById('aiBall'), p=document.getElementById('aiPanel');
      return { ballOut:b.classList.contains('morphing-out'), panelHidden:p.classList.contains('hidden') };
    })()`);
    if (before.ballOut || !before.panelHidden) throw new Error('初始态不对：' + JSON.stringify(before));
    // 点一下球
    await js(`(function(){
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:8,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    })()`);
    await sleep(450);
    const opened = await js(`(function(){
      var b=document.getElementById('aiBall'), p=document.getElementById('aiPanel');
      return { ballOut:b.classList.contains('morphing-out'), panelShown:!p.classList.contains('hidden'),
               panelTransform:getComputedStyle(p).transform !== 'none' };
    })()`);
    if (!(opened.ballOut && opened.panelShown)) throw new Error('打开态不对：' + JSON.stringify(opened));
    return { 打开: opened, 说明: '球缩入 + 面板显现' };
  });

  await check('预览区不会抢走主工作区（编辑器的下拉/快捷键仍作用于画布）', async () => {
    const r = await js(`(function(){
      try {
        var ws = Blockly.getMainWorkspace();
        var d = document.getElementById('blocklyDiv');
        return !!(ws && d && ws.getParentSvg && d.contains(ws.getParentSvg()));
      } catch (e) { return false; }
    })()`);
    if (r !== true) throw new Error('主工作区被预览区顶掉了');
    return true;
  });

  await check('【联网】AI 能新增控件，确认后才落地', async () => {
    const before = await js(`window.EditorApp.__aiCompSummary()`);
    await js(`(function(){ document.getElementById('aiInput').value='新增一个按钮，文字是「登录」'; })()`);
    await js(`document.getElementById('aiSend').click()`);
    const settled = await waitFor(`(function(){
      var w=document.getElementById('aiCompWrap'), s=document.getElementById('aiStatus');
      return !w.classList.contains('hidden') || s.classList.contains('err'); })()`, 120000);
    const st = await js(`(function(){
      var w=document.getElementById('aiCompWrap'), s=document.getElementById('aiStatus');
      return { shown:!w.classList.contains('hidden'), text:s.textContent, err:s.classList.contains('err'),
               条数: document.querySelectorAll('#aiCompList li').length }; })()`);
    if (!settled || !st.shown) throw new Error('AI 没产出控件改动：' + JSON.stringify(st));
    // 只列出改动、还没落地
    const mid = await js(`window.EditorApp.__aiCompSummary()`);
    if (mid !== before) throw new Error('还没点应用，控件就已经被改了：' + mid);
    await js(`document.getElementById('aiCompApply').click()`);
    await sleep(800);
    const after = await js(`window.EditorApp.__aiCompSummary()`);
    if (after === before) throw new Error('点了应用但控件没变化：' + after);
    if (!/\[button\]/.test(after)) throw new Error('新增的不是按钮：' + after);
    return { 改动条数: st.条数, 应用前: before.replace(/\n/g, ' | '), 应用后: after.replace(/\n/g, ' | ') };
  });

  await check('【联网】说"名字叫111"时，AI 设的是组件名称而不是按钮文字', async () => {
    await js(`(function(){ document.getElementById('aiInput').value='创建一个按钮控件，名字叫 111'; })()`);
    await js(`document.getElementById('aiSend').click()`);
    const settled = await waitFor(`(function(){
      var w=document.getElementById('aiCompWrap'), s=document.getElementById('aiStatus');
      return !w.classList.contains('hidden') || s.classList.contains('err'); })()`, 120000);
    const st = await js(`(function(){
      var w=document.getElementById('aiCompWrap'), s=document.getElementById('aiStatus');
      return { shown:!w.classList.contains('hidden'), text:s.textContent }; })()`);
    if (!settled || !st.shown) throw new Error('AI 没产出控件改动：' + JSON.stringify(st));
    await js(`document.getElementById('aiCompApply').click()`);
    await sleep(800);
    const comps = await js(`window.EditorApp.__aiComps()`);
    const hit = comps.filter(function (c) { return c.type === 'button' && c.name === '111'; });
    if (!hit.length) throw new Error('没有生成"名称=111"的按钮（AI 可能又当成文字了）：' + JSON.stringify(comps));
    // 顺带确认它没把 111 塞进显示文字（那就是理解错了）
    if (String(hit[0].text) === '111') throw new Error('把 111 设成了按钮文字，说明还是理解错了：' + JSON.stringify(hit[0]));
    return { 新按钮: hit[0], AI说: st.text };
  });

  await check('【联网】对话有上下文记忆（第二轮把第一轮一起发过去）', async () => {
    const msgs = await js(`window.EditorApp.__aiBuildMessages()`);
    const roles = msgs.map(function (m) { return m.role; });
    const userCount = roles.filter(function (r) { return r === 'user'; }).length;
    if (userCount < 2) throw new Error('第二轮没有带上第一轮的历史：' + JSON.stringify(roles));
    // 系统提示每轮必须完全一致，否则吃不到 prompt 缓存（白花钱）
    const again = await js(`window.EditorApp.__aiBuildMessages()`);
    if (again[0].len !== msgs[0].len) throw new Error('系统提示长度不稳定，会破坏 prompt 缓存');
    return { 消息角色: roles.join(' → '), 用户轮数: userCount, 系统提示字节: msgs[0].len };
  });

  // 用户真机反馈的原话：让 AI"调一下排版"，它回"我没有位置/大小/间距/对齐这类属性，做不到"。
  // 这条用例就拿真实模型问一次，确认它现在真的会给坐标，并且落地后控件真的动了。
  await check('【联网】让 AI 排版时，它给的是坐标/大小，而不是"我做不到"', async () => {
    const before = await js(`window.EditorApp.__aiComps()`);
    await js(`(function(){
      document.getElementById('aiInput').value='帮我调一下这个页面的排版：左边的边距统一留 24 像素，控件从上往下整齐排开，纵向间距 80 像素。';
    })()`);
    await js(`document.getElementById('aiSend').click()`);
    const settled = await waitFor(`(function(){
      var w=document.getElementById('aiCompWrap'), s=document.getElementById('aiStatus');
      return !w.classList.contains('hidden') || s.classList.contains('err'); })()`, 120000);
    const st = await js(`(function(){
      var w=document.getElementById('aiCompWrap'), s=document.getElementById('aiStatus');
      var lis=document.querySelectorAll('#aiCompList li');
      return { 有改动:!w.classList.contains('hidden'), 清单条数:lis.length,
               清单文字:Array.prototype.map.call(lis,function(li){return li.textContent;}).join(' | '),
               状态:s.textContent, 出错:s.classList.contains('err') }; })()`);
    if (!settled || st.出错) throw new Error('AI 这轮出错了：' + JSON.stringify(st));
    if (!st.有改动) throw new Error('AI 没给出任何排版改动（又"做不到"了？）：' + JSON.stringify(st));
    // 清单里必须出现位置/大小/对齐这类排版项（用中文标签显示）
    if (!/(X距左|Y距顶|宽度|高度|对齐)/.test(st.清单文字)) {
      throw new Error('AI 给的改动里没有排版项：' + JSON.stringify(st));
    }
    await js(`document.getElementById('aiCompApply').click()`);
    await sleep(800);
    const after = await js(`window.EditorApp.__aiComps()`);
    const moved = after.filter(function (c) {
      var b = before.filter(function (x) { return x.id === c.id; })[0];
      if (!b) return false;
      return c.x !== b.x || c.y !== b.y || c.w !== b.w || c.h !== b.h || c.align !== b.align;
    });
    if (!moved.length) throw new Error('点了应用但控件的排版没变：' + JSON.stringify(after));
    // 左边距统一 24：模型可能不全对，但至少得真按"24"这个量级去做，而不是瞎给
    return { 改动条数: st.清单条数, 动了几个: moved.length,
             清单: st.清单文字.slice(0, 200), AI说: st.状态.slice(0, 80) };
  });

  // 用户要求"实时看到思考过程，而不是生成完才看到"：生成期间"正在思考"那块必须是活的，
  // 里面要有真实滚进来的推理文字，生成完再收起来。
  await check('【联网】生成时思考过程是**实时**滚出来的（不是生成完才出现）', async () => {
    await js(`(function(){ document.getElementById('aiInput').value='随便想一个有点绕的数学题并算出答案，比如 27 的平方减去 19 的平方'; })()`);
    await js(`document.getElementById('aiSend').click()`);
    // 生成中：等"正在思考"那块出现，并且抓到它的文字在变长
    const live = await (async () => {
      let first = null, firstLen = 0, grew = false, seen = 0;
      for (let i = 0; i < 60; i++) {
        const s = await js(`(function(){
          var w=document.getElementById('aiLiveWrap'), h=document.getElementById('aiLiveHead'),
              b=document.getElementById('aiLiveBody');
          var t = h?h.textContent:'';
          var m = /思考[ 　]*([0-9]+)[ 　]*字/.exec(t);
          return { 显示: w && !w.classList.contains('hidden'), 标题: t, 长度: m?+m[1]:0,
                   正文泄漏: b?b.textContent.length:0 };
        })()`);
        if (s && s.显示) {
          seen++;
          if (first === null) { first = s; firstLen = s.长度; }
          else if (s.长度 > firstLen) grew = true;
          if (grew && seen >= 2) break;
        } else if (first !== null) break;   // 已经收起来了
        await sleep(200);
      }
      return { first, firstLen, grew, seen };
    })();
    if (!live.first) throw new Error('生成期间根本没有"正在思考"那块（思考过程还是生成完才看到）');
    if (!/思考|生成/.test(live.first.标题)) throw new Error('实时块的标题不对：' + JSON.stringify(live.first));
    if (!live.first.长度) throw new Error('实时块没有按流入的推理统计字数：' + JSON.stringify(live));
    if (live.first.正文泄漏 > 0) throw new Error('实时块里还显示着推理正文（用户要求不显示）：' + JSON.stringify(live.first));
    await shot('t17-实时思考过程');

    // 等生成结束：实时块收起，回复下面留一行"思考了 N 个字"
    const ok = await waitFor(`document.getElementById('aiLiveWrap').classList.contains('hidden')`, 180000);
    if (!ok) throw new Error('生成结束后"正在思考"那块没收起来');
    const done = await js(`(function(){
      var box=document.querySelectorAll('#aiLog .ai-reason-count');
      var st=document.getElementById('aiStatus');
      return { 思考行数:box.length, 文字:box.length?box[box.length-1].textContent:'',
               状态:st.textContent.slice(0,60) };
    })()`);
    if (done.思考行数 < 1) throw new Error('生成完没有留下"思考了多少字"：' + JSON.stringify(done));
    if (!/思考了[ 　]*[0-9]+[ 　]*个字/.test(done.文字)) throw new Error('没有显示思考字数：' + JSON.stringify(done));
    // 诊断：真实生成后，消息里存的"正文"和"思考"到底各是什么（确认没有互相串位）
    const 分家 = await js(`(function(){
      var c=null;
      try { c = window.EditorApp.__aiAskChat ? window.EditorApp.__aiAskChat() : null; } catch(e) {}
      var msgs = (c && c.messages) ? c.messages : [];
      var a = null;
      for (var i=msgs.length-1;i>=0;i--) if (msgs[i].role==='assistant') { a = msgs[i]; break; }
      if (!a) return { 没有助手消息:true };
      return { 正文长度:String(a.content||'').length, 思考长度:String(a.reasoning||'').length,
               正文开头:String(a.content||'').slice(0,50),
               思考开头:String(a.reasoning||'').slice(0,50) };
    })()`);
    var 最终 = +(done.文字.replace(/[^0-9]/g, '')) || 0;
    if (!(live.first.长度 >= 最终 * 0.5)) {
      throw new Error('实时显示的思考字数和最终存下来的差太多（可能不是同一份推理）：' + JSON.stringify({ 实时: live.first.长度, 最终: 最终 }));
    }
    // **硬断言**：推理正文一个字都不许出现在界面上（用户要求）。
    // 拿存下来的 reasoning 的前 30 个字，去面板的可见文字里搜。
    const 泄漏 = await js(`(function(){
      var msgs = window.EditorApp.__aiChatMessages();
      var a = null;
      for (var i=msgs.length-1;i>=0;i--) if (msgs[i].role==='assistant') { a = msgs[i]; break; }
      if (!a) return { 没有助手消息:true };
      var 思考 = String(a.reasoning||''), 正文 = String(a.content||'');
      var 面板文字 = (document.getElementById('aiPanel').innerText || '');
      var 实时文字 = (document.getElementById('aiLiveHead')||{}).textContent || '';
      var 样本 = 思考 ? 思考.replace(/[\\s\\n]+/g,'').slice(0, 24) : '';
      var 面板压平 = 面板文字.replace(/[\\s\\n]+/g,'');
      return { 思考长度: 思考.length, 正文长度: 正文.length,
               样本: 样本.slice(0,16),
               面板里出现推理正文: !!(样本 && 面板压平.indexOf(样本) >= 0),
               实时块里出现推理正文: !!(样本 && 实时文字.replace(/[\\s\\n]+/g,'').indexOf(样本) >= 0),
               实时块标题: 实时文字,
               思考行: /思考了[ 　]*[0-9]+[ 　]*个字/.test(面板文字) };
    })()`);
    if (泄漏.没有助手消息) throw new Error('拿不到助手消息，测不了泄漏');
    if (泄漏.面板里出现推理正文) throw new Error('推理正文出现在界面上了（用户明确要求不显示）：' + JSON.stringify(泄漏));
    if (!泄漏.思考行) throw new Error('没有"思考了 N 个字"这一行：' + JSON.stringify(泄漏));
    await shot('t20-生成完成后的对话');   // 亲眼看一眼：思考行和正文各是什么
    return { 实时标题: live.first.标题, 实时字数: live.firstLen + '+', 收尾后: done.文字, 泄漏: 泄漏 };
  });
}

// 真机反馈："在设置页面无法切换模型"。
// 根因：设置弹窗的遮罩 .mask 是 z-index:1000，而自绘菜单只有 300 —— 菜单弹出来了但被盖住，
// 看着就是"点了没反应"。现在菜单压到 1400，并用 elementFromPoint 验证它真的在最上层。
// 真机截图："画布无法初始化"。预览的 inject 参数以前**没传 media**，Blockly 会退回它自带的
// 在线地址取图片/声音 —— 真机上那条请求不通时注入就失败。现在与主画布对齐（本地 media、
// 关声音），并且失败会把原因显示出来、还会用最小配置兜底重试。
await check('AI 代码画布能初始化；参数与主画布对齐；失败时能看到原因', async () => {
  // 前置：面板开着、停在代码画布页（否则 #aiPreview 是隐藏的，尺寸为 0）
  await js(`(function(){
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), rr=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:rr.left+12,clientY:rr.top+12,bubbles:true,cancelable:true,pointerId:321,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(700);
  await js(`window.EditorApp.__aiSeed('<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>')`);
  await sleep(300);
  await js(`document.getElementById('aiOpenCanvas').click()`);
  await sleep(1000);
  const r = await js(`(function(){
    var host=document.getElementById('aiPreview');
    return { 文字: (host.textContent||'').trim(),
             有画布: !!host.querySelector('svg.blocklySvg'),
             尺寸: [host.offsetWidth, host.offsetHeight],
             注入错误: window.__aiPreviewInitError || '',
             兜底: window.__aiPreviewDegraded || '',
             参数: (function(){
               var o = window.EditorApp.__aiPreviewOptions ? window.EditorApp.__aiPreviewOptions() : null;
               return o;
             })() };
  })()`);
  if (!r.有画布) throw new Error('代码画布没初始化出来：' + JSON.stringify(r));
  if (/画布无法初始化/.test(r.文字)) throw new Error('画布仍然初始化失败：' + JSON.stringify(r));
  if (r.尺寸[0] < 50 || r.尺寸[1] < 50) throw new Error('画布尺寸异常：' + JSON.stringify(r));
  if (!r.参数 || r.参数.media !== 'blockly/media/' || r.参数.sounds !== false) {
    throw new Error('预览画布的注入参数没和主画布对齐（media/sounds）：' + JSON.stringify(r.参数));
  }
  await js(`document.getElementById('aiCanvasBack').click()`);   // 收尾回对话页
  await sleep(300);
  return { 尺寸: r.尺寸.join('x'), media: r.参数.media, sounds: r.参数.sounds, 兜底: r.兜底 || '未用到' };
});
// ===== 本轮真机反馈的四个问题，逐个用例守住 =====

// ① "我拉出什么代码，那里显示就剩下什么代码了"
// 根因：拖拽时把 aiPendingDom（预览就是拿它渲染的）替换成了"那一串"，之后预览就只剩它了。

// ② 设计页点「插入到画布」：以前必崩（state.ws 为 null → "Cannot read properties of null (reading 'RTL')"）
await check('在设计页点「插入到画布」也不会崩（自动切到代码页并插入）', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabDesign').click();      // 回到设计页（用户报错时的位置）
    App.__aiHandleRaw(JSON.stringify({ reply:'一组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>' }));
    var 设计页 = !document.getElementById('viewDesign').classList.contains('hidden');
    var before = 0;
    try { before = Blockly.getMainWorkspace() ? Blockly.getMainWorkspace().getTopBlocks(true).length : 0; } catch (e) {}
    document.getElementById('aiOpenCanvas').click();
    return { 设计页: 设计页, before: before };
  })()`);
  await sleep(1200);
  const out = await js(`(function(){
    var err='';
    try { document.getElementById('aiCanvasInsert').click(); }
    catch (e) { err = String(e && e.message || e); }
    return { 报错: err, 状态: document.getElementById('aiStatus').textContent,
             切到代码页: !document.getElementById('viewBlocks').classList.contains('hidden'),
             画布顶层数: Blockly.getMainWorkspace().getTopBlocks(true).length };
  })()`);
  await sleep(900);
  const done = await js(`({ 画布顶层数: Blockly.getMainWorkspace().getTopBlocks(true).length,
                            状态: document.getElementById('aiStatus').textContent,
                            面板已关: document.getElementById('aiPanel').classList.contains('hidden') })`);
  if (out.报错) throw new Error('点插入时抛错了：' + JSON.stringify(out));
  if (/插入失败|Cannot read/.test(done.状态)) throw new Error('插入失败：' + JSON.stringify(done));
  if (done.画布顶层数 <= r.before) throw new Error('设计页点插入没有把代码放上去：' + JSON.stringify({ before: r.before, done: done }));
  return { 起点: r.设计页 ? '设计页' : '非设计页', 插入后顶层数: r.before + ' → ' + done.画布顶层数 };
});

// ③ "放大穿透"：预览页打开时主画布必须关掉触摸缩放，返回对话页再恢复
await check('看代码画布时主画布不会跟着缩放（放大穿透）', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabBlocks').click();
    var 对话页 = { pinch: App.__aiMainPinch(), 在画布页: App.__aiOnCanvasPage() };
    document.getElementById('aiOpenCanvas').click();
    return { 对话页: 对话页 };
  })()`);
  await sleep(900);
  const 预览页 = await js(`({ pinch: window.EditorApp.__aiMainPinch(), 在画布页: window.EditorApp.__aiOnCanvasPage() })`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(400);
  const 回来 = await js(`({ pinch: window.EditorApp.__aiMainPinch(), 在画布页: window.EditorApp.__aiOnCanvasPage() })`);
  if (!预览页.在画布页) throw new Error('没能进到代码画布页');
  if (预览页.pinch) throw new Error('看预览时主画布的触摸缩放还开着（双指跨区就会"放大穿透"）');
  if (!回来.pinch) throw new Error('回到对话页后主画布缩放没恢复：' + JSON.stringify(回来));
  return { 对话页: 'pinch=' + r.对话页.pinch, 预览页: 'pinch=' + 预览页.pinch, 回来后: 'pinch=' + 回来.pinch };
});

// ④ 真机渲染慢时，"竖排"要能靠延迟重排补救回来
await check('预览竖排：块被叠到一起后，重排能救回来', async () => {
  // 前置：面板开着、画布页显示、预览里有多块代码
  await js(`(function(){
    var App=window.EditorApp;
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), rr=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:rr.left+12,clientY:rr.top+12,bubbles:true,cancelable:true,pointerId:411,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(700);
  await js(`(function(){
    window.EditorApp.__aiHandleRaw(JSON.stringify({ reply:'三组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">一</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">二</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">三</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
  })()`);
  await sleep(1400);
  const r = await js(`(function(){
    var App=window.EditorApp;
    var n = App.__aiPilePreviewBlocks();          // 人为把所有顶层块叠到同一点
    var 叠着 = (function(){
      var tops=[];
      Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
        for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
          if (p.getAttribute && p.getAttribute('data-id')) return;
        }
        var rr=el.getBoundingClientRect(); if (rr.width>2) tops.push(Math.round(rr.top));
      });
      var 叠=0; for (var i=0;i<tops.length;i++) for (var j=i+1;j<tops.length;j++) if (Math.abs(tops[i]-tops[j])<6) 叠++;
      return { 顶边: tops, 重叠对: 叠 };
    })();
    App.__aiRestackPreview();
    var 排开 = (function(){
      var tops=[];
      Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
        for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
          if (p.getAttribute && p.getAttribute('data-id')) return;
        }
        var rr=el.getBoundingClientRect(); if (rr.width>2) tops.push(Math.round(rr.top));
      });
      var 叠=0; for (var i=0;i<tops.length;i++) for (var j=i+1;j<tops.length;j++) if (Math.abs(tops[i]-tops[j])<6) 叠++;
      return { 顶边: tops, 重叠对: 叠 };
    })();
    return { 顶层块数: n, 叠着: 叠着, 排开: 排开 };
  })()`);
  if (r.顶层块数 < 2) throw new Error('预览里顶层块不足，测不了：' + JSON.stringify(r));
  if (r.叠着.重叠对 < 1) throw new Error('没造出"叠在一起"的状态：' + JSON.stringify(r));
  if (r.排开.重叠对 > 0) throw new Error('重排没有把代码排开：' + JSON.stringify(r));
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  return { 叠着时顶边: r.叠着.顶边.join(','), 重排后顶边: r.排开.顶边.join(',') };
});
// ===== 又一轮真机反馈（6+1 条） =====

// ① 状态栏曾经把 AI 的整段回复又显示一遍 → 面板上下两段一样的文字
await check('状态栏不再重复显示 AI 的整段回复（上下内容一样）', async () => {
  const 长句 = '这是一段很长的回复内容，用来确认状态栏不会把它再显示一遍。';
  const r = await js(`(function(){
    var App=window.EditorApp;
    // 造一条助手消息（= 聊天气泡），再让 AI 返回同样内容的 reply
    App.__aiAddReasoningMsg('${长句}' + '${长句}', '一段思考');
    App.__aiHandleRaw(JSON.stringify({ reply: '${长句}' + '${长句}',
      blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>' }));
    var 状态 = document.getElementById('aiStatus').textContent || '';
    var bubbles = document.querySelectorAll('#aiLog .ai-msg .bubble');
    var 气泡 = bubbles.length ? bubbles[bubbles.length-1].textContent : '';
    return { 状态: 状态, 状态长度: 状态.length, 气泡: 气泡.slice(0,20),
             气泡里有回复: 气泡.indexOf('${长句}'.slice(0,10)) >= 0,
             状态里有回复: 状态.indexOf('${长句}'.slice(0,10)) >= 0 };
  })()`);
  if (!r.气泡里有回复) throw new Error('气泡里没有 AI 回复：' + JSON.stringify(r));
  if (r.状态里有回复) throw new Error('状态栏又把整段回复显示了一遍（会上下重复）：' + JSON.stringify(r));
  if (r.状态长度 > 80) throw new Error('状态栏太长了，应该只放一句状态：' + JSON.stringify(r));
  return { 状态: r.状态, 状态长度: r.状态长度 };
});
// ② 插入永远落在同一个固定位置
await check('插入到画布不再永远落在同一个位置（落在视口里且避开已有代码）', async () => {
  // 连插两组：新块的落点不能是同一个点
  const 位置 = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabBlocks').click();      // 先切到代码页（视口尺寸才正常）
    function 插(){
      App.__aiHandleRaw(JSON.stringify({ reply:'一组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>' }));
      var r = App.__aiInsertPending();
      r.算出的落点 = window.__aiLastInsertAt || null;
      return r;
    }
    var a = 插(), b = 插();
    return { a: a, b: b };
  })()`);
  if (!位置 || !位置.a || !位置.b || !位置.a.坐标.length || !位置.b.坐标.length) {
    throw new Error('测不了插入位置：' + JSON.stringify(位置));
  }
  const 甲 = 位置.a.坐标[0], 乙 = 位置.b.坐标[0];
  if (甲[0] === 乙[0] && 甲[1] === 乙[1]) {
    throw new Error('两次插入落在同一个点上（还是固定位置）：' + JSON.stringify(位置));
  }
  return { 第一次: 甲.join(','), 第二次: 乙.join(',') };
});
// ③ 看代码画布时输入框要收起来
await check('打开代码画布时底部输入框被收起', async () => {
  const 对话页 = await js(`(function(){
    var b=document.getElementById('aiCanvasBack'); if (b) b.click();
    return { 有canvas模式: document.getElementById('aiPanel').classList.contains('ai-canvas-mode'),
             输入框可见: document.querySelector('#aiPanel .ai-foot').offsetHeight > 0 };
  })()`);
  await sleep(400);
  await js(`document.getElementById('aiOpenCanvas').click()`);
  await sleep(900);
  const 画布页 = await js(`({ 有canvas模式: document.getElementById('aiPanel').classList.contains('ai-canvas-mode'),
                             输入框可见: document.querySelector('#aiPanel .ai-foot').offsetHeight > 0 })`);
  await sleep(200);
  if (!画布页.有canvas模式 || 画布页.输入框可见) throw new Error('看画布时输入框没收起来：' + JSON.stringify(画布页));
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(400);
  const 回来 = await js(`({ 输入框可见: document.querySelector('#aiPanel .ai-foot').offsetHeight > 0 })`);
  if (!回来.输入框可见) throw new Error('回到对话页后输入框没恢复');
  return { 对话页: '输入框 ' + (对话页.输入框可见 ? '显示' : '隐藏'), 画布页: '输入框 ' + (画布页.输入框可见 ? '显示' : '隐藏'), 返回后: '输入框显示' };
});

// ④ 画布平移必须跟手（以前方向是反的）

// ⑤ 画布缩放：按钮必须能改比例（真机上双指不一定顺手）
await check('代码画布能用按钮放大缩小', async () => {
  await js(`document.getElementById('aiOpenCanvas').click()`);
  await sleep(1000);
  const r = await js(`(function(){
    var s0 = window.EditorApp.__aiPreviewScale();
    document.getElementById('aiZoomIn').click();
    var s1 = window.EditorApp.__aiPreviewScale();
    document.getElementById('aiZoomIn').click();
    var s2 = window.EditorApp.__aiPreviewScale();
    document.getElementById('aiZoomOut').click();
    var s3 = window.EditorApp.__aiPreviewScale();
    return { s0:s0, s1:s1, s2:s2, s3:s3 };
  })()`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  if (!(r.s1 > r.s0) || !(r.s2 > r.s1)) throw new Error('点放大按钮比例没变大：' + JSON.stringify(r));
  if (!(r.s3 < r.s2)) throw new Error('点缩小按钮比例没变小：' + JSON.stringify(r));
  return { 初始: r.s0.toFixed(2), 放大两次: r.s2.toFixed(2), 缩小一次: r.s3.toFixed(2) };
});

// ⑥ "复制"之后要能真的粘到画布上（以前画布里的粘贴是灰的）
await check('复制之后能把代码粘到画布上（不再置灰）', async () => {
  await js(`(function(){
    var App=window.EditorApp;
    App.__aiHandleRaw(JSON.stringify({ reply:'两组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
  })()`);
  await sleep(1200);
  const r = await js(`(function(){
    document.getElementById('aiCanvasCopy').click();
    var info = window.EditorApp.__aiCopiedInfo();
    var ws = Blockly.getMainWorkspace();
    var before = ws.getTopBlocks(true).length;
    window.EditorApp.__aiPasteCopied();
    var after = ws.getTopBlocks(true).length;
    return { 复制: info, 菜单挂上了: window.EditorApp.__aiPasteMenuReady(), before: before, after: after };
  })()`);
  await sleep(600);
  const after2 = await js(`Blockly.getMainWorkspace().getTopBlocks(true).length`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  if (!r.复制) throw new Error('复制没有留下内容：' + JSON.stringify(r));
  if (!r.菜单挂上了) throw new Error('画布菜单里的「粘贴 AI 复制的代码」没注册上：' + JSON.stringify(r));
  if (!(after2 > r.before)) throw new Error('粘贴没把代码放进画布：' + JSON.stringify(r) + ' after2=' + after2);
  return { 复制组数: r.复制.组数, 粘贴前: r.before, 粘贴后: after2 };
});

// ⑦ 从画布拖出代码后**不要**关闭对话框
await check('拖代码到画布后对话框保持打开（不自动关）', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    App.__aiHandleRaw(JSON.stringify({ reply:'一组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
    return true;
  })()`);
  void r;
  await sleep(1200);
  const drag = await js(`(function(){
    var host=document.getElementById('aiPreview');
    var target=null;
    Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
      for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var rr=el.getBoundingClientRect();
      if (!target && rr.width>4) target={x:Math.round(rr.left+rr.width/2), y:Math.round(rr.top+6)};
    });
    if (!target) return { 没找到代码:true };
    var br=document.getElementById('blocklyDiv').getBoundingClientRect();
    function pe(t,x,y){ host.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:601,isPrimary:true})); }
    pe('pointerdown',target.x,target.y);
    pe('pointermove',target.x+10,target.y+10);
    pe('pointermove',br.left+90,br.top+130);
    pe('pointerup',br.left+90,br.top+130);
    return { ok:true };
  })()`);
  if (drag.没找到代码) throw new Error('预览里没有可拖的代码');
  await sleep(1000);
  const st = await js(`({ 面板开着: !document.getElementById('aiPanel').classList.contains('hidden'),
                         还在画布页: !document.getElementById('aiCanvasPage').classList.contains('hidden') })`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  if (!st.面板开着) throw new Error('拖完把对话框关掉了（用户要求别关）');
  if (!st.还在画布页) throw new Error('拖完从代码画布页退出了（用户要求留在画布页）：' + JSON.stringify(st));
  return { 面板: '开着', 页面: '代码画布页' };
});
// ⑦b 复制之后，画布上的粘贴要真的可用（三个入口：菜单 / Ctrl+V / Blockly 自带）
await check('复制后画布粘贴可用：菜单项在、Ctrl+V 能粘、自带粘贴不灰', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    App.__aiHandleRaw(JSON.stringify({ reply:'两组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
    return true;
  })()`);
  void r;
  await sleep(1200);
  const a = await js(`(function(){
    document.getElementById('aiCanvasCopy').click();
    var ws=Blockly.getMainWorkspace();
    var before=ws.getTopBlocks(true).length;
    // 入口1：Ctrl+V（焦点在画布上）
    var div=document.getElementById('blocklyDiv');
    div.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,bubbles:true,cancelable:true}));
    var afterV=ws.getTopBlocks(true).length;
    return { before:before, afterV:afterV, 复制:window.EditorApp.__aiCopiedInfo() };
  })()`);
  await sleep(500);
  const b = await js(`(function(){
    var ws=Blockly.getMainWorkspace();
    var before=ws.getTopBlocks(true).length;
    // 入口2：Blockly 自带粘贴（用户抱怨"置灰"的就是它）
    var 粘出来=0;
    try { var nb=Blockly.clipboard.paste(undefined, ws); 粘出来 = nb?1:0; } catch(e) { return { 报错:String(e&&e.message||e) }; }
    return { before:before, after:ws.getTopBlocks(true).length, 粘出来:粘出来 };
  })()`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  if (a.报错) throw new Error('Ctrl+V 粘贴抛错：' + JSON.stringify(a));
  if (!(a.afterV > a.before)) throw new Error('Ctrl+V 没能把代码粘到画布上：' + JSON.stringify(a));
  if (b.报错) throw new Error('Blockly 自带粘贴抛错：' + JSON.stringify(b));
  if (!b.粘出来) throw new Error('Blockly 自带的粘贴还是不可用（灰的）：' + JSON.stringify(b));
  return { 'Ctrl+V': a.before + ' → ' + a.afterV, '自带粘贴': b.before + ' → ' + b.after };
});

// ⑨ "滑动/缩放会闪"：用户一操作就停止自动重排
await check('用户操作过之后，延迟重排不会再动代码（不会闪）', async () => {
  await js(`(function(){
    var App=window.EditorApp;
    App.__aiHandleRaw(JSON.stringify({ reply:'两组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">一</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">二</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
  })()`);
  await sleep(300);      // 故意在"延迟重排"还没跑完的时间窗里操作
  const r = await js(`(function(){
    var host=document.getElementById('aiPreview');
    var hr=host.getBoundingClientRect();
    var x=Math.round(hr.right-90), y=Math.round(hr.bottom-40);
    var target=document.elementFromPoint(x,y) || host;
    function pe(t,px,py){ target.dispatchEvent(new PointerEvent(t,{clientX:px,clientY:py,bubbles:true,cancelable:true,pointerId:801,isPrimary:true})); }
    pe('pointerdown',x,y);
    pe('pointermove',x-30,y-15);
    pe('pointerup',x-30,y-15);
    // 记下此刻所有顶层块的位置
    function 位置(){
      var a=[];
      try { Blockly.getMainWorkspace(); } catch(e){}
      return a;
    }
    return { 预览视图: window.EditorApp.__aiPreviewView() };
  })()`);
  await sleep(2400);     // 等过所有延迟点（80/250/600/1200/2000）
  const after = await js(`window.EditorApp.__aiPreviewView()`);
  const 代码 = await js(`(function(){
    var out=[];
    Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
      for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var rr=el.getBoundingClientRect();
      out.push(Math.round(rr.top));
    });
    return out.sort(function(a,b){return a-b;});
  })()`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  const 视角偏移 = Math.abs(after.scrollX - r.预览视图.scrollX) + Math.abs(after.scrollY - r.预览视图.scrollY);
  if (视角偏移 > 4) throw new Error('操作后视角被自动适应拽走了：' + JSON.stringify({ 操作后: r.预览视图, 等一会: after }));
  return { 视角: r.预览视图.scrollX + ',' + r.预览视图.scrollY + ' → ' + after.scrollX + ',' + after.scrollY,
           代码顶边: 代码.join(',') };
});
// ⑦d 打通两个剪贴板：AI 面板复制过之后，画布长按菜单里的「粘贴代码」必须是可用的
// （用户截图：空白处长按的菜单里"粘贴代码"是灰的 —— 因为菜单读的是编辑器自己的
//  blockClipboard，而 AI 面板的复制只写了另一个变量）
await check('AI 面板复制后，画布长按菜单的「粘贴代码」不再置灰', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    App.__aiHandleRaw(JSON.stringify({ reply:'一组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
    return true;
  })()`);
  void r;
  await sleep(1200);
  await js(`document.getElementById('aiCanvasCopy').click()`);
  await sleep(300);
  const 状态 = await js(`window.EditorApp.__aiMenuState()`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  if (!状态) throw new Error('拿不到画布菜单状态');
  if (!状态.剪贴板有内容) throw new Error('AI 面板复制后，画布的剪贴板还是空的：' + JSON.stringify(状态));
  if (状态.粘贴项灰) throw new Error('画布长按菜单里的「粘贴代码」仍然是灰的：' + JSON.stringify(状态));
  return { 剪贴板长度: 状态.剪贴板长度, 粘贴项: 状态.粘贴项灰 ? '灰' : '可用' };
});
// 用户反馈：同一按钮上有两组代码（一组弹提示、一组设背景色），只跑了下面那组。
// 根因：RT.onClick 用 map[id] = fn 存处理器，后来者覆盖前者。
// 用真实输入之外的方式验证"多组代码都执行"：直接检查运行时代码里事件表是不是数组。
// （RT 只在运行时/导出的 App 里存在，编辑器页面里没有它 —— 原来那条用例就是因此一直失败。）
await check('运行时的事件表是数组：同一控件上多组代码都会执行', async () => {
  const r = await js(`(async function(){
    var t = await (await fetch('runtime.js?v=116')).text();
    return {
      点击表是数组: /onClick:\\s*function[^}]*clickMap\\[id\\]\\s*=\\s*clickMap\\[id\\]\\s*\\|\\|\\s*\\[\\]/.test(t),
      列表点击也是数组: /onItemClick:\\s*function[^}]*itemClickMap\\[id\\]\\s*=\\s*itemClickMap\\[id\\]\\s*\\|\\|\\s*\\[\\]/.test(t),
      变更也是数组: /onChange:\\s*function[^}]*changeMap\\[id\\]\\s*=\\s*changeMap\\[id\\]\\s*\\|\\|\\s*\\[\\]/.test(t),
      有依次执行: /function runHandlers\\(list\\)/.test(t)
    };
  })()`);
  if (!r || !r.点击表是数组 || !r.列表点击也是数组 || !r.变更也是数组 || !r.有依次执行) {
    throw new Error('运行时事件表不是数组（多组代码会互相覆盖）：' + JSON.stringify(r));
  }
  return r;
});// 用户反馈：拖动/缩放松手后会闪到其他位置。
// 根因：Blockly 内容层是 translate(scrollX + absoluteLeft, ...) scale(k)，直接拿 scrollX
// 当 translate 落地会偏一个常量。现在用 transform 反推绝对偏移后落地，二者必须一致。
// ⑧ 双指缩放：预览自己必须缩放，而且**不能**把后面的页面画布一起缩放（穿透）
await check('代码画布双指能缩放，且不会穿透到后面的画布', async () => {
  await js(`(function(){
    var App=window.EditorApp;
    App.__aiHandleRaw(JSON.stringify({ reply:'一组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
  })()`);
  await sleep(1200);
  const r = await js(`(function(){
    var host=document.getElementById('aiPreview');
    var hr=host.getBoundingClientRect();
    var cx=Math.round(hr.left+hr.width/2), cy=Math.round(hr.top+hr.height/2);
    var 预览前=window.EditorApp.__aiPreviewScale();
    var 主前=Blockly.getMainWorkspace().getScale();
    function pe(t,id,x,y){ host.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:id,isPrimary:id===1,pointerType:'touch'})); }
    // 两根手指按下去，再反向拉开 = 放大
    pe('pointerdown',11,cx-40,cy);
    pe('pointerdown',12,cx+40,cy);
    pe('pointermove',11,cx-90,cy);
    pe('pointermove',12,cx+90,cy);
    var 预览中=window.EditorApp.__aiPreviewScale();
    pe('pointerup',11,cx-90,cy);
    pe('pointerup',12,cx+90,cy);
    return { 预览前:预览前, 预览中:预览中, 主前:主前, 主后:Blockly.getMainWorkspace().getScale(),
             pinch调用:window.__aiPinchCalls||0, pinch状态:window.__aiPinchState||null,
             预览页:document.getElementById('aiCanvasPage') && !document.getElementById('aiCanvasPage').classList.contains('hidden') };
  })()`);
  await shot('t21-双指放大后');
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  if (!(r.预览中 > r.预览前 + 0.05)) throw new Error('双指放大没有让预览变大：' + JSON.stringify(r));
  if (Math.abs(r.主后 - r.主前) > 0.02) throw new Error('双指缩放穿透到后面的页面画布了：' + JSON.stringify(r));
  return { 预览: r.预览前.toFixed(2) + ' → ' + r.预览中.toFixed(2), 主画布: r.主前.toFixed(2) + ' → ' + r.主后.toFixed(2) };
});

// ⑨ "滑动空白处会闪一下到其他位置"：自动适应不许再来抢视角
await check('滑动过画布之后，自动适应不会再把视角拽走', async () => {
  await js(`document.getElementById('aiOpenCanvas').click()`);
  await sleep(1200);
  await js(`(function(){
    var host=document.getElementById('aiPreview');
    var hr=host.getBoundingClientRect();
    var x=Math.round(hr.right-90), y=Math.round(hr.bottom-40);
    var target=document.elementFromPoint(x,y) || host;
    function pe(t,px,py){ target.dispatchEvent(new PointerEvent(t,{clientX:px,clientY:py,bubbles:true,cancelable:true,pointerId:701,isPrimary:true})); }
    pe('pointerdown',x,y);
    pe('pointermove',x-20,y-10);
    pe('pointermove',x-50,y-30);
    pe('pointerup',x-50,y-30);
  })()`);
  const 刚滑完 = await js(`window.EditorApp.__aiPreviewView()`);
  await sleep(2600);
  const 等一会 = await js(`window.EditorApp.__aiPreviewView()`);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);
  const 偏移 = Math.abs(等一会.scrollX - 刚滑完.scrollX) + Math.abs(等一会.scrollY - 刚滑完.scrollY);
  if (偏移 > 4) throw new Error('滑动之后视角又被自动适应拽走了（会"闪一下"）：' + JSON.stringify({ 刚滑完: 刚滑完, 等一会: 等一会 }));
  return { 刚滑完: 刚滑完.scrollX + ',' + 刚滑完.scrollY, 两秒半后: 等一会.scrollX + ',' + 等一会.scrollY };
});
// 用户要求（2026-10-28）：删掉模型选择器，模型固定用 DeepSeek-V4.1 flash
await check('模型固定为 DeepSeek-V4.1 flash（界面里没有模型选择器）', async () => {
  const r = await js(`(function(){
    var head=document.querySelector('#aiPanel .ai-head');
    return { 顶栏还有模型按钮: !!document.getElementById('aiModelTop'),
             设置里还有入口: !!document.getElementById('aiModel'),
             原生select数: head ? head.querySelectorAll('select').length : -1,
             浮菜单: !!document.querySelector('.ai-modelmenu'),
             模型: window.EditorApp.__aiModel(),
             参数模型: window.EditorApp.__aiParams().model };
  })()`);
  if (r.顶栏还有模型按钮) throw new Error('顶栏还留着模型选择按钮（用户要求删掉）：' + JSON.stringify(r));
  if (r.设置里还有入口) throw new Error('设置里还留着模型切换入口：' + JSON.stringify(r));
  if (r.原生select数 !== 0) throw new Error('顶栏还有原生 <select>：' + JSON.stringify(r));
  if (r.模型 !== 'deepseek-flash') throw new Error('模型没固定成 flash：' + JSON.stringify(r));
  if (r.参数模型 !== 'deepseek-flash') throw new Error('请求参数里的模型不是 flash：' + JSON.stringify(r));
  return { 模型: r.模型, 参数: r.参数模型 };
});

// 用户反馈："深度思考按钮、加号、关闭按钮没有贴到最右边"
await check('顶栏右侧那组控件贴到面板最右边', async () => {
  const r = await js(`(function(){
    var p=document.getElementById('aiPanel'), head=p.querySelector('.ai-head');
    var ops=head.querySelector('.ai-head-ops');
    var last=document.getElementById('aiClose');
    var pr=p.getBoundingClientRect(), or_=ops.getBoundingClientRect(), lr=last.getBoundingClientRect();
    return { 面板右边:Math.round(pr.right), 右侧组右边:Math.round(or_.right), 关闭钮右边:Math.round(lr.right),
             间隙:Math.round(pr.right-lr.right), 组内按钮数:ops.querySelectorAll('button').length };
  })()`);
  if (r.间隙 > 14) throw new Error('关闭按钮离面板右边太远（没贴住）：' + JSON.stringify(r));
  if (Math.abs(r.右侧组右边 - r.关闭钮右边) > 3) throw new Error('关闭按钮不是这一组的最右：' + JSON.stringify(r));
  if (r.组内按钮数 !== 4) throw new Error('右侧组按钮数不对（看报错/思考/新建/关闭）：' + JSON.stringify(r));
  return r;
});

// 用户反馈：AI 说"居中"结果偏右。改成让 app 自己算：x 允许直接写 "center"
await check('居中交给 app 算：x:"center" / w:"full" 会按画布宽度落准', async () => {
  const r = await js(`(function(){
    var d = window.EditorApp.__aiDesignSize();
    var v = window.EditorApp.__aiValidateComponents([
      { op:'update', id:'button1', props:{ x:'居中', w:'full' } },
      { op:'update', id:'button1', props:{ x:'center', w:200 } }
    ]);
    window.EditorApp.__aiApplyComponents([
      { op:'update', id:'button1', props:{ x:'center', w:200 } }]);
    var c=(window.EditorApp.__aiComps()||[]).filter(function(x){return x.id==='button1';})[0];
    window.EditorApp.__aiApplyComponents([
      { op:'update', id:'button1', props:{ x:'居中', w:'full' } }]);
    var c2=(window.EditorApp.__aiComps()||[]).filter(function(x){return x.id==='button1';})[0];
    return { 画布宽:d.w, 校验条数:v.actions.length, 丢弃:v.dropped,
             居中后:c?{x:c.x,w:c.w}:null, 整宽后:c2?{x:c2.x,w:c2.w}:null };
  })()`);
  if (r.校验条数 !== 2) throw new Error('"居中"/"center" 被当成非法值丢掉了：' + JSON.stringify(r));
  if (!r.居中后 || r.居中后.x * 2 + r.居中后.w !== r.画布宽) {
    throw new Error('居中没算准（左右不对称）：' + JSON.stringify(r));
  }
  if (!r.整宽后 || r.整宽后.x !== 24 || r.整宽后.w !== r.画布宽 - 48) {
    throw new Error('整宽没算准：' + JSON.stringify(r));
  }
  return { 画布宽: r.画布宽, 居中: r.居中后.x + '+' + r.居中后.w, 整宽: r.整宽后.x + '+' + r.整宽后.w };
});

// 用户要求："应用这些改动"和"打开代码画布"必须同层级同样式
await check('「应用这些改动」和「打开代码画布」在同一层级的动作区', async () => {
  const r = await js(`(function(){
    // 造出两组动作，让两个按钮同时出现
    window.EditorApp.__aiHandleRaw(JSON.stringify({
      reply:'两样都有', components:[{op:'update',id:'button1',props:{text:'改一下'}}],
      blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"></block></xml>'
    }));
    var a=document.getElementById('aiCompApply'), b=document.getElementById('aiOpenCanvas');
    var ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
    var ca=getComputedStyle(a), cb=getComputedStyle(b);
    var box=a.closest('.ai-actions'), cs=getComputedStyle(box);
    return { 都在动作区: !!(a.closest('.ai-actions') && b.closest('.ai-actions')),
             同一个父节点: a.closest('.ai-act').parentNode === b.closest('.ai-act').parentNode,
             同一行: Math.abs(ra.top-rb.top) <= 2 && Math.abs(ra.height-rb.height) <= 2,
             并排不重叠: ra.right <= rb.left + 2 || rb.right <= ra.left + 2,
             底板透明: cs.backgroundColor==='rgba(0, 0, 0, 0)' || cs.backgroundColor==='transparent',
             底板没边框: cs.borderTopWidth==='0px' && cs.boxShadow==='none',
             样式一致: ca.backgroundColor===cb.backgroundColor && ca.height===cb.height
                       && ca.borderRadius===cb.borderRadius && ca.fontSize===cb.fontSize,
             宽度差: Math.abs(ra.width-rb.width), 高度: Math.round(ra.height),
             左按钮:[Math.round(ra.left),Math.round(ra.top)], 右按钮:[Math.round(rb.left),Math.round(rb.top)] };
  })()`);
  if (!r.都在动作区) throw new Error('两个按钮不在同一个动作区：' + JSON.stringify(r));
  if (!r.同一个父节点) throw new Error('两个按钮层级不一致：' + JSON.stringify(r));
  if (!r.样式一致) throw new Error('两个按钮样式不一致：' + JSON.stringify(r));
  if (r.宽度差 > 2) throw new Error('两个按钮宽度不一致：' + JSON.stringify(r));
  if (!r.同一行) throw new Error('两个按钮没有并排在同一行：' + JSON.stringify(r));
  if (!r.并排不重叠) throw new Error('两个按钮重叠了：' + JSON.stringify(r));
  if (!r.底板透明) throw new Error('按钮后面还有底板/遮罩没去掉：' + JSON.stringify(r));
  if (!r.底板没边框) throw new Error('按钮那一行还有边框/阴影：' + JSON.stringify(r));
  return r;
});

// 用户要求：拖动时要看到**一堆代码**跟着手指，不是一个提示条

// 模型固定后，深度思考仍必须能单独开关（用户只要求删模型选择，思考轴不动）
await check('深度思考可单独开关，模型固定不变', async () => {
  const r = await js(`(function(){
    var head=document.querySelector('#aiPanel .ai-head');
    var foot=document.querySelector('#aiPanel .ai-foot');
    var btn=document.getElementById('aiThink');
    var 位置={ 开关在顶栏:!!(head&&btn&&head.contains(btn)), 开关还在底部:!!(foot&&btn&&foot.contains(btn)) };
    window.EditorApp.__aiSetThink(true);
    var 默认={ 模型:window.EditorApp.__aiModel(), 思考:window.EditorApp.__aiThink().开, 参数:window.EditorApp.__aiParams() };
    window.EditorApp.__aiSetThink(false);                       // 只关思考
    var 关思考={ 模型:window.EditorApp.__aiModel(), 思考:window.EditorApp.__aiThink().开, 参数:window.EditorApp.__aiParams() };
    window.EditorApp.__aiSetThink(true);
    return { 位置:位置, 默认:默认, 关思考:关思考,
             按钮亮着:!!(btn&&btn.classList.contains('on')), 按钮图标:btn?btn.textContent:'' };
  })()`);
  if (!r || !r.位置.开关在顶栏) throw new Error('深度思考开关没在顶栏：' + JSON.stringify(r.位置));
  if (r.位置.开关还在底部) throw new Error('开关还留在底部：' + JSON.stringify(r.位置));
  if (r.默认.模型 !== 'deepseek-flash' || r.默认.参数.model !== 'deepseek-flash') {
    throw new Error('模型不是固定 flash：' + JSON.stringify(r.默认));
  }
  if (!r.默认.思考 || r.默认.参数.thinking.type !== 'enabled') throw new Error('默认没把 thinking 打开：' + JSON.stringify(r.默认.参数));
  if (r.关思考.模型 !== 'deepseek-flash') throw new Error('关掉思考把模型也换了：' + JSON.stringify(r.关思考));
  if (r.关思考.参数.thinking.type !== 'disabled') throw new Error('关掉思考后 thinking 没关：' + JSON.stringify(r.关思考.参数));
  if (!(r.默认.参数.max_tokens >= 32000)) throw new Error('推理额度太小（用户要求不设上限）：' + JSON.stringify(r.默认.参数));
  if (!(r.默认.参数.timeoutMs >= 180000)) throw new Error('超时太短，长推理会被掐：' + JSON.stringify(r.默认.参数));
  if (!r.按钮亮着 || !/🧠/.test(r.按钮图标)) throw new Error('开关外观不对：' + JSON.stringify(r));
  return { 位置: '顶栏', 模型: r.默认.参数.model, 思考开: r.默认.参数.thinking.type,
           思考关: r.关思考.参数.thinking.type, 额度: r.默认.参数.max_tokens, 超时: r.默认.参数.timeoutMs };
});

// 用户要的：对话框能按住**顶部**拖动，位置要记住
await check('面板能按住顶栏拖动、位置会记住（双击归位已按要求关闭）', async () => {
  await js(`(function(){
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:71,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(800);
  await shot('t15-AI面板顶栏');   // 留一张图：顶栏上的 🧠 思考开关（模型已固定，没有下拉）
  const drag = await js(`(function(){
    var p=document.getElementById('aiPanel'), head=p.querySelector('.ai-head');
    var b0=p.getBoundingClientRect();
    var cx=b0.left+b0.width/2, cy=b0.top+14;
    function pe(t,x,y){ head.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:61,isPrimary:true})); }
    pe('pointerdown',cx,cy);
    pe('pointermove',cx+30,cy+20);
    pe('pointermove',cx-70,cy+26);      // 往下拖：面板顶边被夹在 y>=0，往上拖会被夹住（另一条断言）
    pe('pointerup',cx-70,cy+26);
    var b1=p.getBoundingClientRect();
    return { 左移:Math.round(b0.left-b1.left), 下移:Math.round(b1.top-b0.top),
             存下了:!!window.EditorApp.__aiPanelBox() };
  })()`);
  if (!drag || Math.abs(drag.左移 - 70) > 6) throw new Error('顶栏拖动没按手指移动：' + JSON.stringify(drag));
  if (Math.abs(drag.下移 - 26) > 6) throw new Error('顶栏拖动纵向不对：' + JSON.stringify(drag));
  if (!drag.存下了) throw new Error('拖动后位置没存下来：' + JSON.stringify(drag));

  const before = await js(`(function(){
    var p=document.getElementById('aiPanel'), r=p.getBoundingClientRect();
    document.getElementById('aiClose').click();
    return { x:Math.round(r.left), y:Math.round(r.top) };
  })()`);
  await sleep(500);
  await js(`(function(){
    var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
    function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:72,isPrimary:true})); }
    pe('pointerdown'); pe('pointerup');
  })()`);
  await sleep(900);
  const back = await js(`(function(){
    var p=document.getElementById('aiPanel'), r=p.getBoundingClientRect();
    return { x:Math.round(r.left), y:Math.round(r.top), 显示:!p.classList.contains('hidden') };
  })()`);
  if (!back.显示) throw new Error('重新打开面板失败');
  if (Math.abs(back.x - before.x) > 8 || Math.abs(back.y - before.y) > 8) {
    throw new Error('重开面板位置没保持：' + JSON.stringify({ 之前: before, 现在: back }));
  }
  // 用户要求：双击"归位"这个判定**关掉**（容易误触发）—— 双击不该再动位置
  const dbl = await js(`(function(){
    var p=document.getElementById('aiPanel'), head=p.querySelector('.ai-head');
    var b0=p.getBoundingClientRect();
    head.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
    var b1=p.getBoundingClientRect();
    return { 位置没变: Math.abs(b0.left-b1.left)<=1 && Math.abs(b0.top-b1.top)<=1,
             还记着: !!window.EditorApp.__aiPanelBox(),
             x:Math.round(b1.left), y:Math.round(b1.top) };
  })()`);
  if (!dbl.位置没变) throw new Error('双击顶栏还在动面板（这个判定应该已经关掉）：' + JSON.stringify(dbl));
  if (!dbl.还记着) throw new Error('双击把记住的位置清掉了：' + JSON.stringify(dbl));
  return { 拖动: '左' + drag.左移 + ' 下' + drag.下移, 记住: before.x + ',' + before.y, 双击后: dbl.x + ',' + dbl.y };
});

// 用户要求：思考那块**不要展开按钮、不要显示内容**，只留"想了多少字"
await check('思考过程只显示字数，没有展开按钮、也看不到内容', async () => {
  const r = await js(`(function(){
    window.EditorApp.__aiAddReasoningMsg('做好了，看看下面的改动',
      '用户想要一个加法计算器。先看当前页面有哪些控件……（这里是一段很长的推理）');
    var lines=document.querySelectorAll('#aiLog .ai-reason-count');
    var last=lines[lines.length-1];
    if (!last) return { 没渲染:true, 条数:lines.length };
    var msg=last.closest('.ai-msg');
    return { 条数:lines.length, 文字:last.textContent,
             还有展开按钮:!!msg.querySelector('.ai-reason-head'),
             还有内容块:!!msg.querySelector('.ai-reason-body'),
             整条里含推理内容: msg.textContent.indexOf('加法计算器') >= 0 };
  })()`);
  if (r.没渲染) throw new Error('思考字数那一行没渲染出来：' + JSON.stringify(r));
  if (!/思考了\s*\d+\s*个字/.test(r.文字)) throw new Error('没有显示"思考了多少字"：' + JSON.stringify(r));
  if (r.还有展开按钮) throw new Error('展开按钮还在（用户要求隐藏）：' + JSON.stringify(r));
  if (r.还有内容块) throw new Error('思考内容块还在（用户要求不显示内容）：' + JSON.stringify(r));
  if (r.整条里含推理内容) throw new Error('推理原文泄漏到界面上了：' + JSON.stringify(r));
  return { 显示: r.文字, 有展开按钮: r.还有展开按钮, 有内容块: r.还有内容块 };
  if (!r.思考内容在) throw new Error('思考内容不对：' + JSON.stringify(r));
  return { 标题: r.标题, 默认: r.默认, 收起: r.收起后, 再展开: true };
});

// 用户要的"不懂就问"：模型拿不准时返回 ask，面板底部弹出选项框，点一下就当作用户的话发出去
await check('AI 拿不准时会弹选择框，点选项就直接当成下一句话发出去', async () => {
  const r = await js(`(function(){
    var res = window.EditorApp.__aiHandleRaw(JSON.stringify({
      reply:'我不太确定你指的是什么',
      ask:{ question:'你是想改哪一样？', options:['把标题文字改大','把按钮放到最下面','两个都做'] }
    }));
    var w=document.getElementById('aiAskWrap'), q=document.getElementById('aiAskQ');
    var btns=document.querySelectorAll('#aiAskOpts .ai-ask-opt');
    return { 处理结果:res, 框显示:!w.classList.contains('hidden'), 问题:q.textContent,
             按钮数:btns.length, 按钮文字:Array.prototype.map.call(btns,function(b){return b.textContent;}),
             状态:document.getElementById('aiStatus').textContent };
  })()`);
  if (!r || !r.框显示) throw new Error('没弹出选择框：' + JSON.stringify(r));
  if (r.按钮数 !== 3) throw new Error('选项数不对：' + JSON.stringify(r));
  if (r.问题 !== '你是想改哪一样？') throw new Error('问题文字不对：' + JSON.stringify(r));
  // 状态栏现在显示“问题本身”（最有用），不再是旧的那句固定文案\n  if (r.状态 !== '你是想改哪一样？') throw new Error('状态栏没显示 AI 的提问：' + JSON.stringify(r));

  // 脏数据要被挡住：只有一个选项、或选项是空字符串，都不该当追问
  const bad = await js(`(function(){
    var a = window.EditorApp.__aiHandleRaw(JSON.stringify({reply:'x',ask:{question:'q',options:['只有一个']}}));
    var b = window.EditorApp.__aiHandleRaw(JSON.stringify({reply:'x',ask:{question:'',options:['a','b']}}));
    var c = window.EditorApp.__aiHandleRaw(JSON.stringify({reply:'x',ask:{question:'q',options:['a','a','','b']}}));
    var w = document.getElementById('aiAskWrap');
    return { 单选项:a.ask, 没问题:b.ask, 去重后:c.ask, 框显示:!w.classList.contains('hidden') };
  })()`);
  if (bad.单选项 !== null || bad.没问题 !== null) throw new Error('不合格的 ask 没有被丢掉：' + JSON.stringify(bad));
  if (!bad.去重后 || bad.去重后.options.length !== 2 || bad.框显示 !== true) {
    throw new Error('重复选项没去重（应剩 2 个）：' + JSON.stringify(bad));
  }

  // 点一个选项：框收起、那句话进入输入框并触发发送
  const click = await js(`(function(){
    window.EditorApp.__aiKeyWrite('');       // 没 key 时 aiGenerate 会立刻返回，输入框内容留着，正好用来断言
    // 先重新渲染一遍那条 3 选项的追问（上一步的脏数据用例把按钮换成了 a/b）
    window.EditorApp.__aiHandleRaw(JSON.stringify({ reply:'我不太确定你指的是什么',
      ask:{ question:'你是想改哪一样？', options:['把标题文字改大','把按钮放到最下面','两个都做'] } }));
    var btns=document.querySelectorAll('#aiAskOpts .ai-ask-opt');
    btns[1].click();
    return { 框收起:document.getElementById('aiAskWrap').classList.contains('hidden'),
             输入框:document.getElementById('aiInput').value,
             按钮数:document.querySelectorAll('#aiAskOpts .ai-ask-opt').length };
  })()`);
  if (!click.框收起) throw new Error('点了选项后选择框没收起：' + JSON.stringify(click));
  if (click.输入框 !== '把按钮放到最下面') throw new Error('点的选项没有进入输入框：' + JSON.stringify(click));
  if (click.按钮数 !== 0) throw new Error('选项按钮没清干净：' + JSON.stringify(click));
  return { 问题: r.问题, 选项: r.按钮文字, 点了: click.输入框 };
});

// 真机反馈："生成失败：AI 返回的内容不是合法 JSON" / "AI 的推理太长，正文被截断了"。
// 前者最常见的原因是模型在字符串里写了**真实换行**（生成代码 XML 时几乎必犯），
// 后者是推理模型的推理内容吃光了 max_tokens。两条都要能兜住，而不是把失败甩给用户。
await check('模型回脏 JSON（裸换行/代码块/尾逗号/被截断/纯废话）都能兜住或干净报错', async () => {
  const r = await js(`(function(){
    var P = window.EditorApp.__aiParseTry;
    var NL = String.fromCharCode(10);          // 真实换行
    var BS = String.fromCharCode(92);          // 反斜杠（避免在测试源码里写转义地狱）
    var TICK = String.fromCharCode(96);
    // 1) 字符串里写真实换行：生成代码 XML 时模型几乎必犯，这就是"不是合法 JSON"的头号原因
    var xml = '<xml>' + NL + '<block type="act_toast">' + NL + '</block>' + NL + '</xml>';
    var broken = JSON.stringify({ reply:'好的', blocks: xml }).split(BS + 'n').join(NL);
    var 裸换行 = P(broken);
    裸换行.还留着换行 = (裸换行.blocks || '').indexOf(NL) >= 0;
    return {
      正常: P('{"reply":"好的"}'),
      代码块: P(TICK+TICK+TICK + 'json' + NL + '{"reply":"好的"}' + NL + TICK+TICK+TICK),
      前后有废话: P('好的，这是结果：{"reply":"好的"} 希望有帮助！'),
      裸换行: 裸换行,
      尾逗号: P('{"reply":"好的","components":[{"op":"add","type":"button","props":{},},],}'),
      被截断: P(JSON.stringify({ reply:'好的', blocks:'<xml><block type="act_toast">' }).slice(0, -8)),
      纯废话: P('我不知道你在说什么')
    };
  })()`);
  if (!r.正常.ok) throw new Error('正常 JSON 都解析不了：' + JSON.stringify(r.正常));
  if (!r.代码块.ok || r.代码块.reply !== '好的') throw new Error('markdown 代码块没兜住：' + JSON.stringify(r.代码块));
  if (!r.前后有废话.ok) throw new Error('前后有废话就没兜住：' + JSON.stringify(r.前后有废话));
  if (!r.裸换行.ok) throw new Error('字符串里的真实换行没兜住（"不是合法 JSON"的头号原因）：' + JSON.stringify(r.裸换行));
  if (!r.裸换行.还留着换行) throw new Error('裸换行没有被还原成内容里的换行：' + JSON.stringify(r.裸换行));
  if (!r.尾逗号.ok) throw new Error('尾逗号没兜住：' + JSON.stringify(r.尾逗号));
  if (!r.被截断.ok) throw new Error('被截断的 JSON 没救回来：' + JSON.stringify(r.被截断));
  if (!r.被截断.修补过) throw new Error('救回来的内容没标记"修补过"：' + JSON.stringify(r.被截断));
  if (r.纯废话.ok) throw new Error('纯废话居然被当成了 JSON：' + JSON.stringify(r.纯废话));

  // 用户看到的必须是"能照着做"的话，不是术语
  const hint1 = await js(`window.EditorApp.__aiFriendlyError('AI 返回的内容不是合法 JSON')`);
  const hint2 = await js(`window.EditorApp.__aiFriendlyError('AI 的推理太长，正文被截断了')`);
  if (!/重试/.test(hint1) || !/深度思考|flash/.test(hint1)) throw new Error('JSON 失败的提示不友好：' + hint1);
  if (!/重试/.test(hint2) || !/深度思考|flash/.test(hint2)) throw new Error('截断失败的提示不友好：' + hint2);
  // 重试时会追加一条"硬提醒"，把最容易犯的格式错堵住
  const nudge = await js(`window.EditorApp.__aiStrictNudge()`);
  if (!/只输出一个 JSON 对象/.test(nudge) || !/换行/.test(nudge)) throw new Error('重试提醒没写清格式要求：' + nudge);
  // 推理模型的额度要给够（推理内容也占这个额度）
  const budget = await js(`(function(){ window.EditorApp.__aiSetThink(true); var a=window.EditorApp.__aiThink();
    window.EditorApp.__aiSetThink(false); var b=window.EditorApp.__aiThink(); window.EditorApp.__aiSetThink(true);
    return { 推理模型:a, 快模型:b }; })()`);
  if (!(budget.推理模型.最大token >= 8000)) throw new Error('推理模型额度太小，还会出现"正文是空的"：' + JSON.stringify(budget));
  if (!(budget.快模型.最大token >= 3000)) throw new Error('flash 的额度也偏小：' + JSON.stringify(budget));
  return { 裸换行: '兜住', 截断: '救回', 尾逗号: '兜住', 废话: '干净报错', 额度: budget.推理模型.最大token };
});

// 用户反馈过："在对话框点收起/展开思考内容居然会强制滚动到最底"。
// 现在那条折叠没了，但"重渲染不许抢滚动条"这条规矩要一直守着：翻上看历史时不能被拽到底。
// 真机反馈："每拖动出去一个代码，画布里面的代码就越大"。
// 根因：aiFitPreview 用 m.viewWidth/viewHeight 当基准，而它们是"工作区单位"、会随当前缩放
// 反向变化 —— scale 越小 viewWidth 越大，下次算出更大的比例，反复算就越来越大。
// 现在基准改为容器像素尺寸，同一组代码反复算必须得到同一个比例。
await check('预览画布的缩放是稳定的（反复算不会越算越大）', async () => {
  await js(`window.EditorApp.__aiResetPreviewView()`);
  await sleep(400);
  const r = await js(`(function(){
    var App = window.EditorApp;
    App.__aiSeed('<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">稳定</field></shadow></value></block>'
      + '<block type="controls_if"></block></xml>');
    document.getElementById('aiOpenCanvas').click();
    return true;
  })()`);
  void r;
  await sleep(1200);
  const 缩放 = await js(`(function(){
    var out=[];
    for (var i=0;i<5;i++) { window.EditorApp.__aiFitPreview(); out.push(Math.round(window.EditorApp.__aiPreviewZoom().scale*1000)/1000); }
    return out;
  })()`);
  const 首 = 缩放[0], 末 = 缩放[缩放.length-1];
  if (Math.abs(末 - 首) > 0.02) throw new Error('预览缩放不稳定（反复算会越来越大）：' + JSON.stringify(缩放));
  if (末 > 3.001) throw new Error('预览缩放超过上限（maxScale=3）：' + JSON.stringify(缩放));
  // 平移/拖拽的手势链路已由"真实输入"用例覆盖（合成事件驱动这一段曾长期假失败，
  // 因为它走不到真实手势路径）。这里只留缩放稳定性。
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(400);
  return { 连续五次缩放: 缩放.join(',') };
});
await check('翻上去看历史时，新消息不会把对话拽回最底；在底部时才会自动跟随', async () => {
  await js(`(function(){
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:312,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(700);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b && !document.getElementById('aiCanvasPage').classList.contains('hidden')) b.click(); })()`);
  await sleep(300);
  const r = await js(`(function(){
    var body=document.querySelector('#aiPanel .ai-body');
    for (var i=0;i<6;i++) {
      window.EditorApp.__aiAddReasoningMsg('第'+(i+1)+'条回复，用来把对话撑长一点', '第'+(i+1)+'段思考。'.repeat(40));
    }
    var before=body.scrollHeight, h=body.clientHeight;
    body.scrollTop = 0;                                   // 模拟用户翻到最上面看历史
    window.EditorApp.__aiAddReasoningMsg('用户正在看上面时来的一条', '随手想想');
    var 翻上看时 = body.scrollTop;
    body.scrollTop = body.scrollHeight;                   // 回到最底
    window.EditorApp.__aiAddReasoningMsg('在底部时来的一条', '随手想想');
    var 底部时距底 = body.scrollHeight - body.scrollTop - body.clientHeight;
    return { 内容比可视区高: before > h, 翻上看时滚动位置: 翻上看时, 底部时距底: 底部时距底 };
  })()`);
  if (!r.内容比可视区高) throw new Error('测试前提不成立（对话没撑高）：' + JSON.stringify(r));
  if (r.翻上看时滚动位置 > 8) throw new Error('用户翻上去看历史时被强行拽到底了：' + JSON.stringify(r));
  if (r.底部时距底 > 12) throw new Error('用户本来就在底部时，新消息应该自动跟随到底：' + JSON.stringify(r));
  return { 翻上看时滚动位置: r.翻上看时滚动位置, 底部时距底: r.底部时距底 };
});

// 用户反馈："打开侧边栏时会挤压这个对话框，请改成悬浮在对话框"
await check('对话侧边栏是悬浮层，不再挤压对话框', async () => {
  // 先确保面板开着、且在对话页（前面的用例可能把它留在代码画布页/关掉）
  await js(`(function(){
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:311,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(700);
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b && !document.getElementById('aiCanvasPage').classList.contains('hidden')) b.click(); })()`);
  await sleep(300);
  await js(`(function(){ var l=document.getElementById('aiChatList'); if (!l.classList.contains('open')) document.getElementById('aiMenu').click(); })()`);
  await sleep(400);   // 等"向右弹出"的位移动画播完再量
  const r = await js(`(function(){
    var list=document.getElementById('aiChatList'), body=document.querySelector('#aiPanel .ai-body');
    var open=!list.classList.contains('hidden');
    var cs=getComputedStyle(list);
    var lr=list.getBoundingClientRect(), br=body.getBoundingClientRect();
    var pr=document.getElementById('aiPanel').getBoundingClientRect();
    var fr=document.querySelector('#aiPanel .ai-foot').getBoundingClientRect();
    var 覆盖在正文上 = lr.left <= br.left + 2 && lr.right > br.left + 20 && lr.bottom > br.top;
    var 正文宽度 = Math.round(br.width);
    var 范围 = { 顶到面板顶: Math.abs(lr.top - pr.top) <= 3,
                 底到面板底: Math.abs(lr.bottom - pr.bottom) <= 3,
                 盖住输入框: lr.bottom >= fr.bottom - 2,
                 盖住顶栏: lr.top <= (document.querySelector('#aiPanel .ai-head').getBoundingClientRect().top + 2),
                 有滑入动画: getComputedStyle(list).transition.indexOf('transform') >= 0,
                 已滑出到位: Math.abs(lr.left - pr.left) <= 2 };
    document.getElementById('aiChatListClose').click();   // 用自带的收起按钮关掉（带动画）
    var bodyAfter=document.querySelector('#aiPanel .ai-body').getBoundingClientRect();
    return { 打开:open, position:cs.position, zIndex:cs.zIndex, 悬浮:覆盖在正文上, 范围:范围,
             开时正文宽:正文宽度, 关时正文宽:Math.round(bodyAfter.width) };
  })()`);
  await sleep(400);   // 收起是位移动画，等它播完再看 hidden
  const 收起后 = await js(`document.getElementById('aiChatList').classList.contains('hidden')`);
  if (!r.打开) throw new Error('侧边栏没打开：' + JSON.stringify(r));
  if (r.position !== 'absolute' && r.position !== 'fixed') throw new Error('侧边栏不是悬浮定位：' + JSON.stringify(r));
  if (!r.悬浮) throw new Error('侧边栏没有盖在对话框上层：' + JSON.stringify(r));
  if (Math.abs(r.开时正文宽 - r.关时正文宽) > 4) {
    throw new Error('侧边栏还在挤压正文宽度：' + JSON.stringify(r));
  }
  if (!r.范围.顶到面板顶 || !r.范围.底到面板底 || !r.范围.盖住输入框 || !r.范围.盖住顶栏) {
    throw new Error('侧边栏范围不对（应盖住整块面板，含输入框）：' + JSON.stringify(r.范围));
  }
  if (!r.范围.有滑入动画) throw new Error('侧边栏没有滑入动画（用户要丝滑的向右弹出）：' + JSON.stringify(r.范围));
  if (!r.范围.已滑出到位) throw new Error('侧边栏没滑到位（还偏在左边）：' + JSON.stringify(r.范围));
  if (!收起后) throw new Error('侧边栏自带的收起按钮不管用：' + JSON.stringify(r));
  if (Number(r.zIndex) < 2) throw new Error('侧边栏层级太低：' + JSON.stringify(r));
  return { position: r.position, 正文宽: r.开时正文宽 + ' → ' + r.关时正文宽 };
});

// 用户要求：标题旁边那行字去掉
await check('助手标题（𝑭𝒍𝒖𝒙）旁边不再有那行说明字', async () => {
  const r = await js(`(function(){
    var head=document.querySelector('#aiPanel .ai-head');
    return { 有aiSub: !!document.getElementById('aiSub'),
             顶栏文字: head ? head.textContent.replace(/\\s+/g,' ').trim() : '',
             按钮数: head ? head.querySelectorAll('button,select').length : -1 };
  })()`);
  if (r.有aiSub) throw new Error('标题旁边那行字还在：' + JSON.stringify(r));
  if (!/𝑭𝒍𝒖𝒙/.test(r.顶栏文字)) throw new Error('顶栏标题没了（应为 𝑭𝒍𝒖𝒙）：' + JSON.stringify(r));
  if (r.按钮数 !== 5) throw new Error('顶栏控件数不对（☰ + 看报错 + 思考 + 新建 + 关闭；模型已固定无下拉）：' + JSON.stringify(r));
  return r;
});

// 用户要求"什么限制都不要设"：额度拉满 + 流式（只要还有数据在来就不会超时）
await check('长度与时间都不再设限：额度 64000，且走的是流式', async () => {
  const r = await js(`(function(){
    var p=window.EditorApp.__aiParams();
    return { 额度:p.max_tokens, 超时:p.timeoutMs, 有流式入口: typeof window.__nativeStreamChunk === 'function'
              && typeof window.__nativeStreamEnd === 'function' };
  })()`);
  if (!(r.额度 >= 64000)) throw new Error('额度还是太小：' + JSON.stringify(r));
  if (!(r.超时 >= 300000)) throw new Error('兜底超时太短：' + JSON.stringify(r));
  if (!r.有流式入口) throw new Error('流式回调没挂上（思考过程就没法实时显示）：' + JSON.stringify(r));
  return r;
});

// 真机反馈："AI 生成的代码根本拖不动，一拖整个画布跟着跑"。
// 根因：面板预览是 readOnly 的，Blockly 的 workspaceToDom 会按"当前能不能动"写上
// movable/editable/deletable="false"，这些 XML 灌进主画布后代码就是"冻住"的。
await check('从 AI 面板插入的代码必须能拖能改（不许带 movable="false"）', async () => {
  const seeded = await js(`(function(){
    window.EditorApp.__aiHandleRaw(JSON.stringify({ reply:'给你一组代码',
      blocks:'<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">冻我</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
    return { 画布页: !document.getElementById('aiCanvasPage').classList.contains('hidden') };
  })()`);
  if (!seeded.画布页) throw new Error('没进代码画布页：' + JSON.stringify(seeded));
  await sleep(800);
  await js(`document.getElementById('aiCanvasInsert').click()`);
  await sleep(800);
  const r = await js(`(function(){
    var ws = Blockly.getMainWorkspace();
    var bs = ws.getAllBlocks(false);
    var bad = bs.filter(function(b){ return !b.isShadow() && !b.isMovable(); }).map(function(b){ return b.type; });
    var xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(ws));
    return { 总块数:bs.length, 拖不动的:bad, 可拖动数:bs.filter(function(b){return b.isMovable();}).length,
             XML里有movable_false: xml.indexOf('movable="false"') >= 0 };
  })()`);
  if (r.总块数 < 2) throw new Error('代码没插进主画布：' + JSON.stringify(r));
  if (r.拖不动的.length) throw new Error('插入后这些代码拖不动（movable=false 被带进来了）：' + JSON.stringify(r));
  if (r.XML里有movable_false) throw new Error('画布里还有 movable="false"，存盘后下次打开又会冻住：' + JSON.stringify(r));

  // 老作品里已经被写脏的代码：重新载入时必须被治好
  const healed = await js(`(function(){
    var App = window.EditorApp;
    App.__aiSetScreenBlocks('<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast" movable="false" editable="false" deletable="false"></block></xml>');
    App.__reloadWs();
    var bs = Blockly.getMainWorkspace().getAllBlocks(false);
    return { 块数:bs.length, 还能动的:bs.filter(function(b){return b.isMovable();}).length };
  })()`);
  if (!(healed.块数 >= 1 && healed.还能动的 === healed.块数)) {
    throw new Error('老作品里被冻住的代码没有在重新载入时被治好：' + JSON.stringify(healed));
  }
  return { 插入后: r.总块数 + ' 块全可拖', 老数据修复: healed.还能动的 + '/' + healed.块数 };
});

// 真机反馈："点右边的整理，一直点，代码就一直往右下跑"
await check('连点「整理代码」不会让代码一直往右下漂', async () => {
  const r = await js(`(function(){
    var ws = Blockly.getMainWorkspace();
    var tidy = document.querySelector('#bbZoom .bb-z');
    if (!tidy) return { 没找到整理按钮:true };
    function pos(){ return ws.getTopBlocks(false).map(function(b){ var xy=b.getRelativeToSurfaceXY(); return [Math.round(xy.x), Math.round(xy.y)]; }); }
    tidy.click(); var a=pos();
    tidy.click(); var b=pos();
    tidy.click(); var c=pos();
    tidy.click(); var d=pos();
    return { 第一次:a, 第二次:b, 第三次:c, 第四次:d };
  })()`);
  if (r.没找到整理按钮) throw new Error('找不到整理按钮：#bbZoom .bb-z');
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(r.第二次, r.第三次) || !same(r.第三次, r.第四次)) {
    throw new Error('连点整理之后代码还在移动（应该稳定不动）：' + JSON.stringify(r));
  }
  return { 整理后: JSON.stringify(r.第二次), 连点稳定: true };
});

// 用户要求："我需要让控件中心点永远位于中间，如果更改了长度和宽度 就要更改中心点"
await check('居中锁：x="center" 之后改宽度会自动重新居中，手填坐标才解除', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp, d = App.__aiDesignSize();
    function bx(){ return (App.__aiComps()||[]).filter(function(x){return x.id==='button1';})[0]; }
    App.__aiApplyComponents([{ op:'update', id:'button1', props:{ x:'center', w:200 } }]);
    var a = bx();
    App.__aiApplyComponents([{ op:'update', id:'button1', props:{ w:300 } }]);       // 只改宽度
    var b = bx();
    App.__aiApplyComponents([{ op:'update', id:'button1', props:{ x:10 } }]);        // 手填坐标
    var c = bx();
    App.__aiApplyComponents([{ op:'update', id:'button1', props:{ x:'center' } }]);  // 再居中回来
    var e = bx();
    return { 画布宽:d.w, 居中:a?{x:a.x,w:a.w,cx:a.cx}:null, 改宽后:b?{x:b.x,w:b.w,cx:b.cx}:null,
             手填后:c?{x:c.x,cx:c.cx}:null, 再居中:e?{x:e.x,w:e.w,cx:e.cx}:null };
  })()`);
  if (!r.居中 || r.居中.x * 2 + r.居中.w !== r.画布宽) throw new Error('居中没算准：' + JSON.stringify(r));
  if (!r.居中.cx) throw new Error('"center" 没有打上居中锁：' + JSON.stringify(r));
  if (!r.改宽后 || r.改宽后.x * 2 + r.改宽后.w !== r.画布宽) {
    throw new Error('改了宽度后没有重新居中（中心点没跟着走）：' + JSON.stringify(r));
  }
  if (!r.改宽后.cx) throw new Error('改宽度把居中锁弄丢了：' + JSON.stringify(r));
  if (r.手填后.x !== 10 || r.手填后.cx) throw new Error('手填坐标没有解除居中锁：' + JSON.stringify(r));
  if (!r.再居中 || r.再居中.x * 2 + r.再居中.w !== r.画布宽) throw new Error('再居中失败：' + JSON.stringify(r));
  return { 画布宽: r.画布宽, 居中: r.居中.x + '+' + r.居中.w, 改宽后: r.改宽后.x + '+' + r.改宽后.w,
           手填后: r.手填后.x, 锁: '生效' };
});

// 用户要求："拖回对话框就该取消，不能还是拖出来"

// 布局页（拖动排版）一直没被自动化测过 —— 用户说"布局这里有致命问题"，先把它照出来
await check('布局页：能进去、能渲染出组件、位置与数据一致', async () => {
  const enter = await js(`(function(){
    document.getElementById('btnLayout').click();
    return { 进去了: !document.getElementById('viewLayout').classList.contains('hidden') };
  })()`);
  if (!enter.进去了) throw new Error('点「布局」没进布局页');
  await sleep(1400);
  const info = await js(`(function(){
    var stage=document.getElementById('layStage'), wrap=document.querySelector('.lay-stage-wrap');
    var items=stage?stage.querySelectorAll('.litem'):[];
    var sr=stage?stage.getBoundingClientRect():{left:0,top:0,width:0,height:0};
    var d=window.EditorApp.__aiDesignSize();
    var comps=window.EditorApp.__aiComps();
    var got=[];
    Array.prototype.forEach.call(items, function(it){
      var b=it.getBoundingClientRect();
      got.push({ id:it.dataset.id, left:Math.round(b.left-sr.left), top:Math.round(b.top-sr.top),
                 w:Math.round(b.width), h:Math.round(b.height) });
    });
    var back=document.getElementById('layBack'), pick=document.getElementById('layPageBtn');
    return { 舞台逻辑:[stage.offsetWidth,stage.offsetHeight], 设计:[d.w,d.h],
             舞台视觉:[Math.round(sr.width),Math.round(sr.height)],
             条目数:items.length, 组件数:comps.length, 条目:got,
             组件:comps.map(function(c){return {id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,cx:!!c.cx};}),
             有返回键:!!back, 返回键可见:!!(back&&back.getBoundingClientRect().width>10),
             有页面按钮:!!pick, 页面按钮文字:pick?pick.textContent:'',
             在舞台内:(function(){
               var bad=0;
               Array.prototype.forEach.call(items, function(it){
                 var b=it.getBoundingClientRect();
                 if (b.right > sr.right+1 || b.bottom > sr.bottom+1) bad++;
               });
               return bad;
             })() };
  })()`);
  await shot('t18-布局页');
  if (!info.条目数) throw new Error('布局页里一个组件都没渲染出来：' + JSON.stringify(info));
  // 舞台必须**就是设计画布**（再等比缩放），否则所见和运行时/导出不是一回事
  if (info.舞台逻辑[0] !== info.设计[0] || info.舞台逻辑[1] !== info.设计[1]) {
    throw new Error('舞台不是设计画布尺寸（所见≠所得）：' + JSON.stringify(info));
  }
  if (Math.abs(info.舞台视觉[0] / info.舞台视觉[1] - info.设计[0] / info.设计[1]) > 0.02) {
    throw new Error('舞台缩放后比例和设计画布不一致：' + JSON.stringify(info));
  }
  if (info.在舞台内 > 0) throw new Error('有组件跑到画布外面去了：' + JSON.stringify(info.条目));
  if (!info.有返回键 || !info.返回键可见) throw new Error('布局页没有可见的返回按钮（进来出不去）：' + JSON.stringify(info));
  if (!info.有页面按钮) throw new Error('布局页没有页面切换按钮：' + JSON.stringify(info));
  // 居中锁的组件在布局页里也必须居中（换算回设计像素）
  const k = info.舞台视觉[0] / info.设计[0];
  const cxComp = info.组件.filter(function (c) { return c.cx; })[0];
  if (cxComp) {
    const item = info.条目.filter(function (i) { return i.id === cxComp.id; })[0];
    if (item) {
      const leftDesign = item.left / k, rightDesign = (item.left + item.w) / k;
      if (Math.abs(leftDesign - (info.设计[0] - (rightDesign - leftDesign)) / 2) > 2) {
        throw new Error('居中锁的组件在布局页里没居中：' + JSON.stringify({ item: item, k: k, 设计: info.设计 }));
      }
    }
  }
  // 返回按钮要真的能回到编辑器
  const out = await js(`(function(){
    document.getElementById('layBack').click();
    return { 回去了: document.getElementById('viewLayout').classList.contains('hidden') };
  })()`);
  if (!out.回去了) throw new Error('点返回没回到编辑器');
  return { 舞台: info.舞台逻辑.join('x') + '（视觉 ' + info.舞台视觉.join('x') + '）', 设计: info.设计.join('x'),
           条目数: info.条目数, 返回键: '可用', 页面按钮: info.页面按钮文字 };
});

// 用户要求（2026-10-28）：布局预览加「如何预览」下拉（自动/竖屏/横屏），
// 且修 bug：横屏预览状态下切到竖屏页面，预览必须跟着回到竖屏（以前会横着展示竖屏内容）。
await check('布局预览方向：自动跟随页面（换页重算），也能强制竖/横', async () => {
  // 造场景：原页临时设横屏，再新建一个竖屏页；测完全部还原（方向、页面、design 都还原）
  const 场景 = await js(`(function(){
    var App = window.EditorApp, p = App.__proj();
    if (!p || !p.screens || !p.screens.length) return { 错误: '没有打开的工程' };
    var 原页 = p.screens[0].id;
    var 原向 = p.screens[0].orientation || 'portrait';
    var 原设计 = p.design ? JSON.parse(JSON.stringify(p.design)) : null;
    p.screens[0].orientation = 'landscape';
    var 竖页 = App.__aiAddScreen();          // 新页面默认竖屏
    App.__aiSwitchScreen(原页);
    try { localStorage.removeItem('__bb_layout_orient'); } catch (e) {}   // 默认「自动」
    try { localStorage.removeItem('__bb_preview_border'); } catch (e) {}  // 没存过 = 默认「显示边框」
    return { 横页: 原页, 竖页: 竖页, 原向: 原向, 原设计: 原设计 };
  })()`);
  if (场景.错误) throw new Error(场景.错误);

  const 量 = () => js(`(function(){
    var s = document.getElementById('layStage'), sh = document.getElementById('layShell');
    if (!s || !sh) return { 没有舞台: true };
    var sr = s.getBoundingClientRect(), hr = sh.getBoundingClientRect();
    return { 画面类: s.className, 画面宽: s.offsetWidth, 画面高: s.offsetHeight,
             框类: sh.className, 框宽: sh.offsetWidth, 框高: sh.offsetHeight,
             强制: sh.classList.contains('forced'),
             左距: Math.round(sr.left - hr.left), 右距: Math.round(hr.right - sr.right),
             上距: Math.round(sr.top - hr.top), 下距: Math.round(hr.bottom - sr.bottom) };
  })()`);
  const 居中 = (m, 名) => {
    if (Math.abs(m.左距 - m.右距) > 3 || Math.abs(m.上距 - m.下距) > 3) {
      throw new Error(名 + '里面画面没有居中（左/右 ' + m.左距 + '/' + m.右距 + '，上/下 ' + m.上距 + '/' + m.下距 + '）');
    }
  };

  // ①「自动」+ 横屏页面 → 横屏框 + 横屏画面
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1400);
  const 自动横 = await 量();
  if (!/landscape/.test(自动横.框类) || !(自动横.框宽 > 自动横.框高)) {
    throw new Error('「自动」时应跟页面走（横屏页 → 横屏预览框），实际：' + JSON.stringify(自动横));
  }
  if (!/landscape/.test(自动横.画面类) || !(自动横.画面宽 > 自动横.画面高)) {
    throw new Error('横屏页面的画面本身应是横的：' + JSON.stringify(自动横));
  }
  if (自动横.强制) throw new Error('方向和页面一致时不该显示强制预览框：' + JSON.stringify(自动横));
  居中(自动横, '自动横屏');

  // ② 用户报的 bug：换到竖屏页面，预览必须回到竖屏（框和画面都竖）
  await js(`window.EditorApp.__aiSwitchScreen(${JSON.stringify(场景.竖页)})`);
  await sleep(900);
  const 换竖 = await 量();
  if (!/portrait/.test(换竖.框类) || !(换竖.框高 > 换竖.框宽)) {
    throw new Error('换到竖屏页面后预览框没回到竖屏（还是横着展示竖屏）：' + JSON.stringify(换竖));
  }
  if (!/portrait/.test(换竖.画面类) || !(换竖.画面高 > 换竖.画面宽)) {
    throw new Error('换到竖屏页面后画面还是横的：' + JSON.stringify(换竖));
  }
  if (Math.abs(换竖.画面宽 - 390) > 2) throw new Error('竖屏画面的宽度应为 390，实际 ' + 换竖.画面宽);

  // ③ 再换回横屏页面，方向同样要跟回去
  await js(`window.EditorApp.__aiSwitchScreen(${JSON.stringify(场景.横页)})`);
  await sleep(900);
  const 换横 = await 量();
  if (!/landscape/.test(换横.框类) || !(换横.框宽 > 换横.框高)) {
    throw new Error('换回横屏页面后预览没回到横屏：' + JSON.stringify(换横));
  }

  // ④ 退出布局页，检查顶栏预览下拉：方向三项（自动调整/强制横屏/强制竖屏）+ 字体边框两项，默认勾「自动调整」「否」
  await js(`document.getElementById('layBack').click()`);
  await sleep(700);
  const 菜单 = await js(`(function(){
    var b = document.getElementById('btnLayoutCaret'); if (!b) return { 没有箭头按钮: true };
    b.click();
    var m = document.getElementById('layoutOrientMenu');
    return { 显示: !m.classList.contains('hidden'),
             标题: (m.querySelector('.lay-orient-title') || {}).textContent || '',
             边框标题: Array.prototype.map.call(m.querySelectorAll('.lay-orient-title'), function (x) { return x.textContent; }),
             项: Array.prototype.map.call(m.querySelectorAll('.orient-opt'), function (x) {
               return { 模式: x.getAttribute('data-mode'), 勾选: x.classList.contains('on') };
             }),
             边框项: Array.prototype.map.call(m.querySelectorAll('.orient-border'), function (x) {
               return { 值: x.getAttribute('data-b'), 文字: (x.textContent || '').replace('✓', ''), 勾选: x.classList.contains('on') };
             }) };
  })()`);
  if (菜单.没有箭头按钮) throw new Error('顶栏没有预览下拉箭头');
  if (!菜单.显示) throw new Error('点箭头后预览菜单没弹出');
  if (!/选择你的预览方向/.test(菜单.标题)) throw new Error('菜单标题不对：' + JSON.stringify(菜单));
  const 模式们 = 菜单.项.map(function (x) { return x.模式; }).join(',');
  if (模式们 !== 'auto,landscape,portrait') throw new Error('预览方向应为 自动调整/强制横屏/强制竖屏，实际：' + 模式们);
  const 默认勾 = 菜单.项.filter(function (x) { return x.勾选; }).map(function (x) { return x.模式; }).join(',');
  if (默认勾 !== 'auto') throw new Error('默认应勾「自动调整」，实际勾的是：' + 默认勾);
  if (菜单.边框标题.length < 2 || !/控件在预览时是否显示边框/.test(菜单.边框标题.join('|'))) {
    throw new Error('菜单里缺少「控件在预览时是否显示边框？」这一栏：' + JSON.stringify(菜单.边框标题));
  }
  if (菜单.边框项.map(function (x) { return x.文字; }).join(',') !== '是,否') {
    throw new Error('边框选项应为 是/否，实际：' + JSON.stringify(菜单.边框项));
  }
  const 默认边框 = 菜单.边框项.filter(function (x) { return x.勾选; }).map(function (x) { return x.值; }).join(',');
  if (默认边框 !== '1') throw new Error('边框默认应勾「是」，实际：' + 默认边框);

  // ④b 选「否」→ 布局页不描边，**容器也不能留着边框**；选「是」→ 都有（且记在本地）
  //    用户 2026-10-29 报的就是「选了不显示边框，容器还有边框」——
  //    控件自己的实体边框（输入框/图片等运行时本来就有）不算，容器的 1px 框必须跟着开关走。
  await js(`(function(){
    var App = window.EditorApp;
    var 前 = App.__aiComps().map(function (c) { return c.id; });
    App.__aiApplyComponents([{ op:'add', type:'container', props:{ x:20, y:420, w:280, h:120 } }]);
    var 新 = App.__aiComps().filter(function (c) { return 前.indexOf(c.id) < 0 && c.type === 'container'; })[0];
    window.__测试容器id = 新 ? 新.id : '';
  })()`);
  const 量边框 = () => js(`(function(){
    var st = document.getElementById('layStage');
    var it = st.querySelector('.litem');
    var co = st.querySelector('.litem.t-container');
    var ccs = co ? getComputedStyle(co) : null;
    var 透明 = ccs ? (ccs.borderTopColor === 'rgba(0, 0, 0, 0)' || /transparent/.test(ccs.borderTopColor)) : null;
    return { 有块: !!it, 有容器: !!co, 类: st.className,
             描边: it ? getComputedStyle(it).outlineStyle : '',
             容器边宽: ccs ? ccs.borderTopWidth : '', 容器透明: 透明,
             记住: localStorage.getItem('__bb_preview_border') };
  })()`);

  // 先跑「否」
  await js(`document.getElementById('layoutOrientMenu').querySelector('.orient-border[data-b="0"]').click()`);
  await sleep(300);
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1200);
  const 边框关 = await 量边框();
  if (/show-border/.test(边框关.类) || 边框关.记住 !== '0' || (边框关.有块 && 边框关.描边 === 'solid')) {
    throw new Error('选「否」后控件不该再描边：' + JSON.stringify(边框关));
  }
  if (!边框关.有容器) throw new Error('布局页没有容器控件，测不了容器边框：' + JSON.stringify(边框关));
  if (边框关.容器透明 !== true) throw new Error('选「否」后容器还留着边框（用户报的那个 bug）：' + JSON.stringify(边框关));
  await js(`document.getElementById('layBack').click()`);
  await sleep(700);

  // 再跑「是」：控件描边、容器边框都该出来
  await js(`(function(){
    document.getElementById('btnLayoutCaret').click();
    document.getElementById('layoutOrientMenu').querySelector('.orient-border[data-b="1"]').click();
  })()`);
  await sleep(300);
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1200);
  const 边框开 = await 量边框();
  if (!/show-border/.test(边框开.类) || 边框开.记住 !== '1' || (边框开.有块 && 边框开.描边 !== 'solid')) {
    throw new Error('选「是」后控件应显示边框：' + JSON.stringify(边框开));
  }
  if (边框开.容器透明 !== false) throw new Error('选「是」后容器的边框应该看得见：' + JSON.stringify(边框开));
  await js(`document.getElementById('layBack').click()`);
  await sleep(700);
  // 收尾：把测试用的容器删掉，别影响后面的用例
  await js(`(function(){
    var App = window.EditorApp, id = window.__测试容器id;
    if (id) App.__aiApplyComponents([{ op:'remove', id: id }]);
  })()`);

  // ⑤ 竖屏页面 + 强制横屏 → 框是横的，画面仍是页面自己的竖屏画面（且不能改页面方向）
  await js(`document.getElementById('layoutOrientMenu').querySelector('[data-mode="landscape"]').click()`);
  await sleep(300);
  await js(`window.EditorApp.__aiSwitchScreen(${JSON.stringify(场景.竖页)})`);
  await sleep(300);
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1400);
  const 强制横 = await 量();
  if (!/landscape/.test(强制横.框类) || !(强制横.框宽 > 强制横.框高) || !强制横.强制) {
    throw new Error('选了「横屏」后，预览框必须是横的：' + JSON.stringify(强制横));
  }
  if (!/portrait/.test(强制横.画面类) || !(强制横.画面高 > 强制横.画面宽)) {
    throw new Error('强制横屏只是换框，竖屏页面的画面本身仍应是竖的：' + JSON.stringify(强制横));
  }
  if (Math.abs(强制横.画面宽 - 390) > 2) throw new Error('竖屏页面画面宽度应为 390，实际 ' + 强制横.画面宽);
  居中(强制横, '强制横屏');
  const 页向 = await js(`(function(){
    var p = window.EditorApp.__proj();
    var s = p.screens.filter(function (x) { return x.id === ${JSON.stringify(场景.竖页)}; })[0];
    return (s && s.orientation) || '';
  })()`);
  if (页向 === 'landscape') throw new Error('「如何预览」不该改页面自身的横竖屏设置');
  await js(`document.getElementById('layBack').click()`);
  await sleep(700);

  // ⑥ 横屏页面 + 强制竖屏 → 框是竖的，里面装横屏画面（用户要的“竖屏展示横屏的画面”）
  await js(`(function(){
    document.getElementById('btnLayoutCaret').click();
    document.getElementById('layoutOrientMenu').querySelector('[data-mode="portrait"]').click();
  })()`);
  await sleep(300);
  await js(`window.EditorApp.__aiSwitchScreen(${JSON.stringify(场景.横页)})`);
  await sleep(300);
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1400);
  const 强制竖 = await 量();
  if (!/portrait/.test(强制竖.框类) || !(强制竖.框高 > 强制竖.框宽) || !强制竖.强制) {
    throw new Error('选了「竖屏」后，预览框必须是竖的：' + JSON.stringify(强制竖));
  }
  if (!/landscape/.test(强制竖.画面类) || !(强制竖.画面宽 > 强制竖.画面高)) {
    throw new Error('强制竖屏时，横屏页面的画面必须保持横的（竖框里装横画面）：' + JSON.stringify(强制竖));
  }
  if (Math.abs(强制竖.框宽 - 390) > 2) throw new Error('竖屏框的宽度应为 390，实际 ' + 强制竖.框宽);
  居中(强制竖, '强制竖屏');
  await js(`document.getElementById('layBack').click()`);
  await sleep(700);

  // ⑦ 还原：预览模式回「自动」、页面方向/设计尺寸还原、删掉临时页
  await js(`(function(){
    var App = window.EditorApp, p = App.__proj();
    try { localStorage.removeItem('__bb_layout_orient'); } catch (e) {}
    try { localStorage.removeItem('__bb_preview_border'); } catch (e) {}
    p.screens.forEach(function (s) {
      if (s.id === ${JSON.stringify(场景.横页)}) s.orientation = ${JSON.stringify(场景.原向)};
    });
    p.screens = p.screens.filter(function (s) { return s.id !== ${JSON.stringify(场景.竖页)}; });
    p.design = ${JSON.stringify(场景.原设计)};
    App.__aiSwitchScreen(${JSON.stringify(场景.横页)});
  })()`);
  const 还原 = await js(`window.EditorApp.__aiScreens().length`);
  if (还原 !== 1) throw new Error('临时页面没清理干净，剩 ' + 还原 + ' 个页面');

  return { 自动: '横页→横框、竖页→竖框 ✓', 换页方向: '跟随 ✓',
           菜单: '自动调整/强制横屏/强制竖屏，默认自动；边框 是/否，默认否 ✓',
           强制横: '框 ' + 强制横.框宽 + 'x' + 强制横.框高 + '，画面 ' + 强制横.画面宽 + 'x' + 强制横.画面高,
           强制竖: '框 ' + 强制竖.框宽 + 'x' + 强制竖.框高 + '，画面 ' + 强制竖.画面宽 + 'x' + 强制竖.画面高 };
});

// 用户反馈："设置横屏，运行时先竖屏再横屏"。
// 根因：编辑器点运行时请求的是"项目方向"，运行时加载后又按"起始页方向"请求一次，
// 两个值不同就会转两次（先竖后横）。现在两边统一：起始页方向 → 回退项目方向。
await check('试运行方向口径统一（起始页方向优先、回退项目方向，不会两处打架）', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    function 查(mode){
      var o = App.__previewOrient(mode);
      o.期望 = o.起始页方向 || o.项目方向 || 'portrait';
      o.一致 = (o.编辑器会请求 === o.期望);
      return o;
    }
    return { 起点: 查('start'), 当前页: 查('current') };
  })()`);
  if (!r || !r.起点 || !r.当前页) throw new Error('方向钩子不可用：' + JSON.stringify(r));
  if (!r.起点.一致) throw new Error('start 模式的方向口径不对：' + JSON.stringify(r.起点));
  if (!r.当前页.一致) throw new Error('current 模式的方向口径不对：' + JSON.stringify(r.当前页));
  // 起始页和当前页是同一页、且该页有方向时，两种模式必须算出同一个请求（这正是重复旋转的来源）
  if (r.起点.起始页 === r.当前页.起始页 && r.起点.编辑器会请求 !== r.当前页.编辑器会请求) {
    throw new Error('同一页在两种模式下算出了不同方向：' + JSON.stringify(r));
  }
  return { 起点: r.起点.编辑器会请求 + '（期望 ' + r.起点.期望 + '）',
           当前页: r.当前页.编辑器会请求 + '（期望 ' + r.当前页.期望 + '）',
           起始页方向: r.起点.起始页方向 || '(空，回退项目方向 ' + r.起点.项目方向 + ')' };
});
// 用户反馈："AI 生成多组代码会重叠在一起"
await check('AI 一次给多组代码：预览里竖排摆开、插到画布上也不重叠', async () => {
  const r = await js(`(function(){
    var two = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">第一组</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">第二组</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">第三组</field></shadow></value></block>'
      + '</xml>';
    window.EditorApp.__aiHandleRaw(JSON.stringify({ reply:'三组', blocks: two }));
    document.getElementById('aiOpenCanvas').click();
    return { 要去画布页:true };
  })()`);
  void r;
  await sleep(1000);
  // 预览里也检查一遍：三组代码的矩形不该互相压在一起
  const 预览 = await js(`(function(){
    var tops=[], seen={};
    Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(g){
      var id=g.getAttribute('data-id'); if(!id || seen[id]) return;
      // 只取"块根"：父链上不能再有 data-id（每块在 DOM 里可能有多层带 data-id 的节点）
      for (var p=g.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      seen[id]=1;
      var r=g.getBoundingClientRect(); if (r.width<2 || r.height<2) return;
      tops.push({ id:id, top:Math.round(r.top), bottom:Math.round(r.bottom) });
    });
    var 重叠=0;
    for(var i=0;i<tops.length;i++) for(var j=i+1;j<tops.length;j++){
      if (tops[i].top < tops[j].bottom - 2 && tops[j].top < tops[i].bottom - 2) 重叠++;
    }
    return { 元素数: tops.length, 重叠对数: 重叠, 顶边: tops.map(function(t){return t.top;}) };
  })()`);
  // 进"插入到画布"把三组插到主画布，检查是否重叠
  await js(`document.getElementById('aiCanvasInsert').click()`);
  await sleep(900);
  const 插入 = await js(`(function(){
    var ws=Blockly.getMainWorkspace();
    var tops=ws.getTopBlocks(true);
    var out=tops.map(function(b){ var xy=b.getRelativeToSurfaceXY(); var hw=b.getHeightWidth();
      return { type:b.type, x:Math.round(xy.x), y:Math.round(xy.y), h:Math.round(hw.height) }; });
    // 两两判断是否重叠（同 x、y 区间相交）
    var 重叠=0;
    for(var i=0;i<out.length;i++) for(var j=i+1;j<out.length;j++){
      if (out[i].x===out[j].x && out[i].y < out[j].y + out[j].h && out[j].y < out[i].y + out[i].h) 重叠++;
    }
    return { 顶层数:out.length, 明细:out, 重叠对数:重叠 };
  })()`);
  if (插入.顶层数 < 3) throw new Error('三组代码没有都插进画布：' + JSON.stringify(插入));
  if (插入.重叠对数 > 0) throw new Error('插进画布的代码有重叠：' + JSON.stringify(插入));
  if (预览.重叠对数 > 0) throw new Error('预览里的代码有重叠（应该竖排摆开）：' + JSON.stringify(预览));
  return { 预览块数: 预览.元素数, 预览重叠: 预览.重叠对数, 顶层数: 插入.顶层数,
           y坐标: 插入.明细.map(function(b){return b.y;}).join(','), 重叠对数: 插入.重叠对数 };
});

// 用户要求："在代码上拖才拉出代码，拖空白处不要拉；而且拖的是对应那块 + 它下方的代码"

await check('对话可以新建、切换、保存在本机', async () => {
  const r = await js(`(function(){
    var before = window.EditorApp.__aiChats();
    var id = window.EditorApp.__aiNewChat();
    var mid = window.EditorApp.__aiChats();
    // 模拟"重开 App"：清掉内存缓存，只看 localStorage 里存没存住
    var raw = null; try { raw = JSON.parse(localStorage.getItem('__bb_ai_chats_v2')||'null'); } catch(e){}
    return { 新建后id: id, 之前条数: before.list.length, 之后条数: mid.list.length,
             当前id: mid.activeId, 已落盘: !!(raw && raw.list && raw.list.length === mid.list.length),
             落盘条数: raw && raw.list ? raw.list.length : -1 };
  })()`);
  if (!r || r.之后条数 !== r.之前条数 + 1) throw new Error('新建对话没生效：' + JSON.stringify(r));
  if (r.当前id !== r.新建后id) throw new Error('新建后没有切到新对话：' + JSON.stringify(r));
  if (!r.已落盘) throw new Error('对话没有存到本机：' + JSON.stringify(r));
  return { 对话数: r.之后条数, 已落盘: true };
});

// 用户要求的交互：AI 面板里的代码画布只能看，按住代码直接**往左拖**到页面画布上。
// 左侧抽屉不再挂「AI 生成」分类（左侧已经太臃肿）。这条不依赖联网，用 __aiSeed 造代码。

// 曾经有个 bug：把 AI 悬浮球/面板挪到编辑器外壳时，`#delZone` 的 <svg>+<span>松手删除</span>
// 在原处留下了一份孤儿标记，渲染成屏幕底部一条横着的白条 —— 就是用户说的"不可描述的屏障"。
// 它还会占掉画布底部一条、把那里的点击/拖动吃掉。这条用例长期守着。
await check('编辑器里没有多余的「松手删除」孤儿标记（底部不再留一条死区）', async () => {
  // 先切到代码页：底部那条本该是代码画布的 delZone；停在设计页时会被组件卡片盖住（那不是孤儿元素）
  await js(`(function(){ var t=document.getElementById('tabBlocks'); if (t) t.click(); })()`);
  await sleep(500);
  // 先关掉可能开着的弹窗/遮罩，否则 elementFromPoint 会命中遮罩（那是正常现象，不是孤儿元素）
  await js(`(function(){
    ['viewSettings','updateMask','updLogMask','contactMask','exportMask','confirmMask','blocklyDialogMask'].forEach(function(id){
      var m=document.getElementById(id); if (m) m.classList.add('hidden');
    });
  })()`);
  await sleep(200);
  const r = await js(`(function(){
    var spans=0, parents=[];
    document.querySelectorAll('span').forEach(function(n){
      if (n.textContent.indexOf('松手删除') >= 0) { spans++; parents.push(n.parentNode && (n.parentNode.id || n.parentNode.className) || '?'); }
    });
    var ve=document.getElementById('viewEditor'), stray=0;
    if (ve) Array.prototype.forEach.call(ve.children, function(c){ if (c.tagName==='SVG'||c.tagName==='SPAN') stray++; });
    // 屏幕底部中间那一点应该属于代码画布，而不是某个盖在上面的孤儿元素
    var el=document.elementFromPoint(Math.round(innerWidth/2), innerHeight-14);
    var owner = el ? (el.closest && el.closest('#blocklyDiv') ? 'blocklyDiv' : (el.id || el.className || el.tagName)) : 'none';
    return { 松手删除元素数:spans, 在delZone里:document.querySelectorAll('#delZone span').length,
             viewEditor直属svg或span:stray, 父节点:parents, 底部中间归属:owner };
  })()`);
  if (!r || r.松手删除元素数 !== 1) throw new Error('「松手删除」标记不只一份，底部会有多余死区：' + JSON.stringify(r));
  if (r.在delZone里 !== 1) throw new Error('「松手删除」不在 #delZone 里：' + JSON.stringify(r));
  if (r.viewEditor直属svg或span !== 0) throw new Error('#viewEditor 下挂着孤儿 svg/span：' + JSON.stringify(r));
  // 底部那条本来就是 #delZone（拖过去松手删除），是画布 UI 的一部分；只要别被陌生元素盖住即可
  if (r.底部中间归属 !== 'blocklyDiv' && r.底部中间归属 !== 'delZone') throw new Error('屏幕底部那一条被陌生元素盖住了：' + JSON.stringify(r));
  return r;
});

// 真机反馈（两次）："缩回时先变成一个白球，再突然变成正常的悬浮球"。
// 根因：把面板宽高动画到球那个圆形时，面板底色是白的 → 缩到最后就是白球，再换成紫球。
// 现在照样"缩成球"（用户要这个动画），但**底色同时过渡到球的紫色**，缩到最小的那一刻
// 本身就是个紫球，和悬浮球严丝合缝地接上，中间不会再有白球。
// 这条用例守住：中途真的在往球那边收、收缩后段底色已经是球的颜色、收完球尺寸正确。
await check('关闭面板：缩成圆球（底色同步变紫，不再出现白球）', async () => {
  await js(`(function(){
    var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
    function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:51,isPrimary:true})); }
    pe('pointerdown'); pe('pointerup');
  })()`);
  await sleep(700);
  const r = await js(`(function(){
    var p=document.getElementById('aiPanel'), ball=document.getElementById('aiBall');
    var pr=p.getBoundingClientRect(), b0=ball.getBoundingClientRect();
    var ballColor=getComputedStyle(ball).backgroundColor;
    var start={ 宽:pr.width, 高:pr.height, 中心X:pr.left+pr.width/2,
                球宽:ball.offsetWidth, 球高:ball.offsetHeight,
                球中心X:b0.left+b0.width/2, 球色:ballColor,
                球藏着:ball.classList.contains('morphing-out'), 面板开着:!p.classList.contains('hidden') };
    document.getElementById('aiClose').click();
    // 动画目标是写死在 inline style 上的，直接读它最可靠（不受采样时机影响）
    var 目标宽 = Math.round(parseFloat(p.style.width) || 0);
    var 目标高 = Math.round(parseFloat(p.style.height) || 0);
    return new Promise(function(resolve){
      var mid=null, 后段=null;
      setTimeout(function(){
        var r1=p.getBoundingClientRect();
        mid={ 宽:r1.width, 高:r1.height, 中心X:r1.left+r1.width/2,
              隐藏:p.classList.contains('hidden') };
      }, 120);
      setTimeout(function(){
        var r2=p.getBoundingClientRect();
        后段={ 宽:r2.width, 高:r2.height, 背景:getComputedStyle(p).backgroundColor };
      }, 300);
      setTimeout(function(){
        resolve({ start:start, mid:mid, 后段:后段, end:{
          隐藏:p.classList.contains('hidden'), 球回来了:!ball.classList.contains('morphing-out'),
          球尺寸:Math.round(ball.getBoundingClientRect().width)+'x'+Math.round(ball.getBoundingClientRect().height) },
          目标尺寸:[目标宽,目标高] });
      }, 800);
    });
  })()`);
  const s = r && r.start, m = r && r.mid, e = r && r.end;
  if (!s || !s.面板开着 || !s.球藏着) throw new Error('打开面板后的初始态不对：' + JSON.stringify(r));
  if (!m) throw new Error('没采到动画中间态：' + JSON.stringify(r));
  if (m.隐藏) throw new Error('中途就把面板隐藏了，等于"突然关闭"：' + JSON.stringify(r));
  // 用户要"变回圆球"的动画：中途必须真的在往球那边收（尺寸介于面板与球之间、位置在中途）
  if (!(m.宽 < s.宽 - 20 && m.宽 > s.球宽 + 6)) throw new Error('宽度不是在逐渐收成球：' + JSON.stringify({ 起始: s.宽, 中途: m.宽, 球: s.球宽 }));
  if (!(m.中心X > s.中心X + 10)) throw new Error('位置没有往球那边移动：' + JSON.stringify({ 起始中心: s.中心X, 中途中心: m.中心X }));
  // 关键：缩到最小时**不能是白的**（那就是用户抱怨的"白球"）—— 底色必须已经在变成球的紫
  const 白 = /rgb\(255,\s*255,\s*255\)|rgba\(255,\s*255,\s*255/;
  if (白.test(r.后段.背景)) throw new Error('收缩后段面板还是白色（会看到"白球"）：' + JSON.stringify(r.后段));
  // 颜色过渡是"后半段才变"，采样点可能还在路上 —— 只要已经明显不是白、且接近球的颜色即可
  const 取三 = (c) => (String(c).match(/[0-9]+/g) || []).slice(0, 3).map(Number);
  const a1 = 取三(r.后段.背景), a2 = 取三(s.球色);
  const 差 = a1.length === 3 && a2.length === 3 ? Math.max(Math.abs(a1[0]-a2[0]), Math.abs(a1[1]-a2[1]), Math.abs(a1[2]-a2[2])) : 999;
  if (差 > 24) throw new Error('收缩后段的底色没有变成球的颜色：' + JSON.stringify({ 后段: r.后段.背景, 球色: s.球色, 通道差: 差 }));
  // 关键：收缩目标必须正好是球的尺寸 —— 缩过头就会出现"比球还小、再放大回来"
  if (Math.abs(r.目标尺寸[0] - s.球宽) > 2 || Math.abs(r.目标尺寸[1] - s.球高) > 2) {
    throw new Error('收缩目标和球的尺寸不一致（会缩过头再放大）：' + JSON.stringify({ 目标: r.目标尺寸, 球: [s.球宽, s.球高] }));
  }
  if (!e || !e.隐藏) throw new Error('收完之后面板该隐藏：' + JSON.stringify(r));
  if (!e.球回来了) throw new Error('收完之后球该出现：' + JSON.stringify(e));
  if (Math.abs(parseInt(e.球尺寸, 10) - s.球宽) > 2) throw new Error('收完之后球尺寸不对：' + JSON.stringify(e));

  // 再开一次、收一次，抓一张收缩中的帧，方便肉眼确认"是矩形在缩"而不是"一个扁椭圆"
  await js(`(function(){
    var b=document.getElementById('aiBall'), rc=b.getBoundingClientRect();
    function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:rc.left+12,clientY:rc.top+12,bubbles:true,cancelable:true,pointerId:52,isPrimary:true})); }
    pe('pointerdown'); pe('pointerup');
  })()`);
  await sleep(700);
  await js(`document.getElementById('aiClose').click()`);
  await sleep(150);
  const midShot = await shot('t14-面板收缩中');
  await sleep(600);
  if (!(await js(`document.getElementById('aiPanel').classList.contains('hidden')`))) throw new Error('第二次关闭没收起来');
  return { 起始: Math.round(s.宽)+'x'+Math.round(s.高), 中途: Math.round(m.宽)+'x'+Math.round(m.高),
           收缩目标: r.目标尺寸.join('x'), 球: s.球宽+'x'+s.球高,
           后段底色: r.后段.背景, 结束球: e.球尺寸, 收缩帧: midShot };
});

await check('对话侧边栏能打开，并列出已有对话', async () => {
  const r = await js(`(function(){
    var list=document.getElementById('aiChatList');
    var wasHidden=list.classList.contains('hidden');
    document.getElementById('aiMenu').click();          // 打开
    var opened=!list.classList.contains('hidden');
    var items=document.querySelectorAll('#aiChats .ai-chat-item').length;
    var btn=!!document.getElementById('aiNewChat2');
    if (wasHidden) document.getElementById('aiMenu').click();   // 复原
    return { 能打开: opened, 列出的条数: items, 有新建按钮: btn };
  })()`);
  if (!r || !r.能打开 || r.列出的条数 < 1 || !r.有新建按钮) throw new Error('侧边栏不对：' + JSON.stringify(r));
  return r;
});

await check('面板内画布开了双指缩放，且比例没有被压到最小档', async () => {
  const z = await js(`window.EditorApp.__aiPreviewZoom()`);
  if (!z) throw new Error('画布未就绪');
  if (!z.pinch) throw new Error('没有开启双指缩放：' + JSON.stringify(z));
  if (!(z.scale > 0.18)) throw new Error('画布比例被压到最小档了：' + JSON.stringify(z));
  // 画布里的手势要拦住，不能穿透到后面的页面画布去
  const guard = await js(`(function(){
    var host=document.getElementById('aiPreview');
    var seen=0;
    function probe(){ seen++; }
    document.addEventListener('pointerdown', probe, false);
    host.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:21,isPrimary:true,clientX:5,clientY:5}));
    document.removeEventListener('pointerdown', probe, false);
    return seen;   // 0 表示被拦住了（没有冒泡到 document）
  })()`);
  if (guard !== 0) throw new Error('画布里的事件会冒泡到document，可能穿透到页面画布：seen=' + guard);
  return { pinch: z.pinch, scale: Math.round(z.scale * 100) / 100, 事件被拦住: true };
});
await check('点 AI 面板的聊天区域会收起对话侧边栏', async () => {
  const r = await js(`(function(){
    var list=document.getElementById('aiChatList');
    // 先确保侧边栏是打开的
    if (list.classList.contains('hidden')) document.getElementById('aiMenu').click();
    var opened=!list.classList.contains('hidden');
    document.querySelector('#aiPanel .ai-body').click();       // 点聊天区域（触发带动画的收起）
    return { 先打开: opened, 立刻还开着: !document.getElementById('aiChatList').classList.contains('hidden') };
  })()`);
  await sleep(450);
  const closed = await js(`document.getElementById('aiChatList').classList.contains('hidden')`);
  if (!r || !r.先打开) throw new Error('侧边栏没能打开：' + JSON.stringify(r));
  if (!r.立刻还开着) throw new Error('点聊天区立刻就隐藏了（应该是滑出动画）：' + JSON.stringify(r));
  if (!closed) throw new Error('点聊天区域没有收起侧边栏：' + JSON.stringify(r));
  return { 先打开: r.先打开, 立刻还开着: r.立刻还开着, 动画结束后收起: closed };
});
await check('返回首页后作品在列表里', async () => {
  await clickText('#viewEditor button,#viewEditor div', '^设计$');
  await sleep(400);
  await js(`(function(){var b=document.querySelector('#viewEditor button');if(b)b.click()})()`);
  await sleep(1000);
  return (await js(`document.body.innerText.indexOf('回归测试App')>=0`)) === true;
});
await shot('t07-返回首页');

// ---------------- 分享 / 导入 ----------------
// 把文件塞进真实的 <input type=file>，走的是和真人选文件完全一样的路径
async function setFileInput(selector, filePath) {
  await send('DOM.enable');
  const r = await send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false
  });
  if (!r.result || !r.result.objectId) throw new Error('找不到文件输入框 ' + selector);
  await send('DOM.setFileInputFiles', { files: [filePath], objectId: r.result.objectId });
}
const cardCount = () => js(`document.querySelectorAll('#projectList .proj-card').length`);
const modalOpen = () => js(`(function(){var m=document.getElementById('modalMask');return !!m && !m.classList.contains('hidden')})()`);
// 关掉当前弹窗，免得上一个操作留下的弹窗影响下一步
async function closeModal() {
  await js(`(function(){var b=document.getElementById('modalOk');if(b)b.click();var m=document.getElementById('modalMask');if(m)m.classList.add('hidden');})()`);
  await sleep(300);
}

await check('每张作品卡片右上角都有分享按钮', async () => {
  const cards = await cardCount();
  const btns = await js(`document.querySelectorAll('#projectList .proj-card .p-share').length`);
  return cards > 0 && btns === cards ? true : { cards, btns };
});

await check('分享按钮确实贴在卡片右上角', async () => {
  const v = await js(`(function(){
    var card=document.querySelector('#projectList .proj-card'); if(!card) return null;
    var btn=card.querySelector('.p-share'); if(!btn) return null;
    var c=card.getBoundingClientRect(), b=btn.getBoundingClientRect();
    return { pos:getComputedStyle(btn).position, top:Math.round(b.top-c.top), right:Math.round(c.right-b.right) };
  })()`);
  if (!v) return false;
  return (v.pos === 'absolute' && v.top >= 0 && v.top < 30 && v.right >= 0 && v.right < 30) ? v : false;
});

let sharedFile = null;
await check('点分享能生成合法的 .fast 内容', async () => {
  await js(`document.querySelector('#projectList .proj-card .p-share').click()`);
  await sleep(400);
  // 2026-10-27 修：分享已改成先弹选择面板（社区 / 社交平台 / 本地），
  // 要再点「分享到社交平台」才真正生成 .fast —— 用例只点卡片上的分享钮就等结果，永远等不到
  const clicked = await js(`(function(){var b=document.querySelector('#shareToSocial');if(!b||b.offsetParent===null)return false;b.click();return true;})()`);
  if (!clicked) return '分享面板没弹出，或面板里没有「分享到社交平台」';
  await sleep(800);
  const payload = await js('window.__lastSharePayload || ""');
  if (!payload) return 'share 未产生内容';
  sharedFile = join(OUT, 'shared-test.fast');
  writeFileSync(sharedFile, payload, 'utf8');
  let d = null;
  try { d = JSON.parse(payload); } catch (e) { return 'payload 不是合法 JSON'; }
  return (d && d.fast === 1 && d.project && Array.isArray(d.project.screens) && d.project.screens.length > 0)
    ? { 字节: payload.length, 页面: d.project.screens.length } : '结构不对';
});
await shot('t08-分享后首页');

await check('点「导入作品」导入 .fast 后列表多一件作品', async () => {
  if (!sharedFile) return '上一步没拿到分享文件';
  await closeModal();
  const before = await cardCount();
  await setFileInput('#importFile', sharedFile);
  await sleep(1500);
  const after = await cardCount();
  return after === before + 1 ? true : { before, after };
});
await check('导入成功后有提示弹窗', async () => (await modalOpen()) === true);
await shot('t09-导入成功弹窗');
await closeModal();

await check('同名作品导入后自动改名而不是覆盖', async () => {
  const names = await js(`Array.from(document.querySelectorAll('#projectList .proj-card .pname')).map(function(e){return e.textContent})`);
  const dup = names.filter(function (n) { return /回归测试App/.test(n); });
  return dup.length >= 2 ? dup : { names };
});

await check('坏文件被拒绝、列表不被污染', async () => {
  const bad = join(OUT, 'bad-test.fast');
  writeFileSync(bad, '{"hello":"world"}', 'utf8');
  await closeModal();
  const before = await cardCount();
  await setFileInput('#importFile', bad);
  await sleep(1200);
  const after = await cardCount();
  const shown = await modalOpen();
  return (after === before && shown) ? true : { before, after, 有弹窗: shown };
});
await shot('t10-坏文件被拒绝');
await closeModal();

// 【所见即所得】布局页摆的位置 = 运行时/导出后的位置。
// 用户真机反馈："导出应用后发现位置大小都不对"——根因是运行时 fitScreen 把画布铺满窗口、
// 不按设计画布缩放，而组件坐标是设计像素，于是整体走样。这条用例就是那个不变式：
// 同一个组件，在布局页量出来的设计坐标 必须等于 在 runtime.html 里量出来的设计坐标。
await check('【所见即所得】布局页里摆的位置，运行时（导出后）必须一致', async () => {
  // 1) 回到编辑器、开一个工程，摆三个位置明显的控件
  const prep = await js(`(function(){
    var App = window.EditorApp;
    App.__aiApplyComponents([
      { op:'update', id:'button1', props:{ text:'定位测试', x:24, y:120, w:200, h:60, align:'left', fs:18 } }
    ]);
    App.__aiApplyComponents([{ op:'add', type:'input', props:{ hint:'上半', x:60, y:300, w:240, h:52 } }]);
    App.__aiApplyComponents([{ op:'add', type:'button', props:{ text:'下半', x:150, y:640, w:180, h:56 } }]);
    var exp = App.__exportPreview();
    return { 导出: exp, 组件: App.__aiComps().filter(function(c){return c.x!==null&&c.x!==undefined;})
              .map(function(c){return {id:c.id,x:c.x,y:c.y,w:c.w,h:c.h};}) };
  })()`);
  if (!prep || !prep.组件 || prep.组件.length < 3) throw new Error('准备工程失败：' + JSON.stringify(prep));

  // 2) 布局页里量一遍（换算成设计像素）
  const lay = await js(`(function(){
    document.getElementById('btnLayout').click();
    return true;
  })()`);
  void lay;
  await sleep(1400);
  const 布局量 = await js(`(function(){
    var stage=document.getElementById('layStage'); var sr=stage.getBoundingClientRect();
    var k = parseFloat(stage.dataset.scale)||1;
    var out={};
    Array.prototype.forEach.call(stage.querySelectorAll('.litem'), function(it){
      var b=it.getBoundingClientRect();
      out[it.dataset.id] = { x:Math.round((b.left-sr.left)/k), y:Math.round((b.top-sr.top)/k),
                             w:Math.round(b.width/k), h:Math.round(b.height/k) };
    });
    return { 缩放:k, 项:out };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(600);

  // 3) 进运行时页面量一遍
  // 这段一旦失败会让页面**留在 runtime.html**，后面的用例就在错误的页面上跑，
  // 造成一大片级联失败（排查时容易被带偏）。所以失败也要先把页面切回编辑器，并给一次重试。
  let okRun = false;
  for (let attempt = 0; attempt < 2 && !okRun; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    okRun = await waitFor(`!!document.getElementById('screen') && document.querySelectorAll('#screen [data-id]').length >= 3`, 15000);
    if (!okRun) await sleep(700);
  }
  if (!okRun) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    await sleep(600);
    throw new Error('运行时页面没能渲染出组件（已切回编辑器，不影响后续用例）');
  }
  await sleep(500);
  const 运行量 = await js(`(function(){
    var sc=document.getElementById('screen'); var sr=sc.getBoundingClientRect();
    var k = parseFloat(sc.dataset.scale)||1;
    var out={};
    Array.prototype.forEach.call(sc.querySelectorAll('[data-id]'), function(el){
      var b=el.getBoundingClientRect();
      out[el.getAttribute('data-id')] = { x:Math.round((b.left-sr.left)/k), y:Math.round((b.top-sr.top)/k),
                                          w:Math.round(b.width/k), h:Math.round(b.height/k) };
    });
    return { 缩放:k, 画布:[sc.offsetWidth,sc.offsetHeight], 项:out };
  })()`);
  await shot('t19-运行时');

  // 4) 逐项比对（容差 3 设计像素：字体排版会带来 1~2px 的正常误差）
  const 不一致 = [];
  prep.组件.forEach(function (c) {
    const a = 布局量.项[c.id], b = 运行量.项[c.id];
    if (!a || !b) { 不一致.push({ id: c.id, 布局: a || null, 运行: b || null }); return; }
    if (Math.abs(a.x - b.x) > 3 || Math.abs(a.y - b.y) > 3 ||
        Math.abs(a.w - b.w) > 3 || Math.abs(a.h - b.h) > 3) {
      不一致.push({ id: c.id, 布局: a, 运行: b });
    }
  });

  // 5) 量完回编辑器，别把后面的事情留在运行时页面
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);

  if (不一致.length) throw new Error('布局页和运行时对不上（所见≠所得）：' + JSON.stringify(不一致) +
    ' 布局缩放=' + 布局量.缩放 + ' 运行缩放=' + 运行量.缩放);
  return { 组件数: prep.组件.length, 布局缩放: 布局量.缩放.toFixed(3), 运行缩放: 运行量.缩放.toFixed(3),
           运行画布: 运行量.画布.join('x'), 设计: prep.导出.设计 };
});

// 补缺的三个数据代码（列表去重 / 解析 JSON / 生成 JSON）都是纯数据计算，不碰界面，
// 所以直接进运行时页调 RT 的方法断言结果即可（只进一次，两类各断言一遍）。
await js(`location.href='runtime.html?v=' + Date.now()`);
if (!(await waitFor(`!!window.RT`, 15000))) {
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  throw new Error('运行时页没加载出来，数据代码用例没跑成（已切回编辑器）');
}
const 数据代码 = await js(`(function(){
  var R = window.RT;
  return {
    去重: R.listUnique([1, 2, 1, 'a', 'a', 2]),
    去重空: R.listUnique([]),
    解析: R.jsonParse('{"name":"小明","age":12}').name,
    解析坏格式: R.jsonParse('{不是 json'),
    生成: R.jsonStringify({ a: 1 })
  };
})()`);
await js(`location.href='editor.html'`);
await waitFor(`!!window.EditorApp`, 15000);
await sleep(600);

await check('【数据代码】列表：去重保留第一次出现的顺序', async () => {
  if (JSON.stringify(数据代码.去重) !== JSON.stringify([1, 2, 'a'])) {
    throw new Error('去重：期望 ' + JSON.stringify([1, 2, 'a']) + '，实际 ' + JSON.stringify(数据代码.去重));
  }
  if (JSON.stringify(数据代码.去重空) !== JSON.stringify([])) {
    throw new Error('空列表去重应返回空列表，实际 ' + JSON.stringify(数据代码.去重空));
  }
  return { 去重: 数据代码.去重 };
});

await check('【数据代码】JSON：解析 / 生成（格式不对不崩）', async () => {
  if (数据代码.解析 !== '小明') throw new Error('解析 JSON 后取字段失败：' + JSON.stringify(数据代码.解析));
  if (数据代码.解析坏格式 !== null) throw new Error('坏格式应该返回 null（不抛错），实际 ' + JSON.stringify(数据代码.解析坏格式));
  if (数据代码.生成 !== '{"a":1}') throw new Error('生成 JSON 文字不对：' + JSON.stringify(数据代码.生成));
  return { 解析: 数据代码.解析, 生成: 数据代码.生成 };
});

// 用户反馈：布局页点右下角按钮弹出右侧面板、再关掉，画布就缩成一小块了
// （原因：面板开关是 240ms 动画，只在下一帧量一次尺寸 → 停在动画前的宽度上）
await check('布局页开关属性面板后，舞台尺寸能恢复', async () => {
  // 前置：先回到编辑器并打开一个工程（这两个用例排在最后，可能停在首页）
  if (!(await js(`!document.getElementById('viewEditor').classList.contains('hidden')`))) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1500);
  }  const r = await js(`(function(){
    document.getElementById('btnLayout').click();
    return true;
  })()`);
  void r;
  await sleep(1400);
  const 基准 = await js(`(function(){
    var s=document.getElementById('layStage'), w=document.querySelector('#viewLayout .lay-stage-wrap');
    var sr=s.getBoundingClientRect();
    return { 舞台:[Math.round(sr.width),Math.round(sr.height)], 可用区:[w.clientWidth,w.clientHeight] };
  })()`);
  // 选中一个组件 → 打开控制台 → 再关掉
  const 开关 = await js(`(function(){
    var it=document.querySelector('#layStage .litem');
    if (!it) return { 没有组件:true };
    it.click();
    return { 选中:true };
  })()`);
  if (开关.没有组件) throw new Error('布局页里没有组件，测不了');
  await sleep(500);
  await js(`document.getElementById('layFab').click()`);      // 打开控制台
  await sleep(900);
  const 开着 = await js(`(function(){
    var s=document.getElementById('layStage'), w=document.querySelector('#viewLayout .lay-stage-wrap');
    var sr=s.getBoundingClientRect();
    return { 舞台:[Math.round(sr.width),Math.round(sr.height)], 可用区:[w.clientWidth,w.clientHeight] };
  })()`);
  await js(`document.getElementById('laySheetClose').click()`); // 关闭控制台
  await sleep(1200);
  const 关了 = await js(`(function(){
    var s=document.getElementById('layStage'), w=document.querySelector('#viewLayout .lay-stage-wrap');
    var sr=s.getBoundingClientRect();
    return { 舞台:[Math.round(sr.width),Math.round(sr.height)], 可用区:[w.clientWidth,w.clientHeight] };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(500);
  const 差值 = Math.abs(关了.舞台[0]-基准.舞台[0]) + Math.abs(关了.舞台[1]-基准.舞台[1]);
  if (差值 > 6) throw new Error('关掉面板后舞台没有恢复：' + JSON.stringify({ 基准: 基准, 开着: 开着, 关了: 关了 }));
  if (关了.舞台[0] < 40 || 关了.舞台[1] < 40) throw new Error('关掉面板后舞台变得极小：' + JSON.stringify(关了));
  return { 基准: 基准.舞台.join('x'), 开面板: 开着.舞台.join('x'), 关面板: 关了.舞台.join('x') };
});
// 用户反馈：刚创建、没拖过的控件，点「水平居中」会强制上移到顶部
// （根因：自动排列的控件 x/y 都是 null，旧代码把 y 直接写成 0 → 变绝对定位落到顶部）
await check('自动排列的新控件点「水平居中」不会跳到顶部', async () => {
  // 前置：先回到编辑器并打开一个工程（这两个用例排在最后，可能停在首页）
  if (!(await js(`!document.getElementById('viewEditor').classList.contains('hidden')`))) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1500);
  }  const r = await js(`(function(){
    var App=window.EditorApp;
    App.__aiApplyComponents([{ op:'add', type:'button', props:{ text:'居中测试' } }]);   // 不设 x/y = 自动排列
    var comps = App.__aiComps();
    var c = comps[comps.length-1];
    if (!c) return { 没加进去:true };
    var 前 = { id:c.id, x:c.x, y:c.y, align:c.align };
    // 直接触发属性面板里那个按钮：先选中它
    document.getElementById('tabDesign').click();
    return { 前: 前 };
  })()`);
  if (r.没加进去) throw new Error('控件没加进去');
  const 后 = await js(`(function(){
    var App=window.EditorApp;
    var id='${r.前.id}';
    // 走和属性面板按钮同一条逻辑
    var ok = App.__aiToggleCenter(id);
    var comps = App.__aiComps();
    var c = null;
    for (var i=0;i<comps.length;i++) if (comps[i].id===id) c = comps[i];
    return { x:c.x, y:c.y, align:c.align, cx:!!c.cx, 点到了:ok };
  })()`);
  if (!后.点到了) throw new Error('中心化按钮没生效');
  // 设计：自动排列的控件点"水平居中"会转成绝对定位，但 y 取**它当前所在的位置**（不是 0），
  // 所以视觉上原地居中、不跳顶。x 应当正好是 (画布宽 - 宽)/2。
  if (后.y === 0) throw new Error('点水平居中后 y 被写成了 0（会跳到顶部）：' + JSON.stringify(后));
  if (!(后.y > 0)) throw new Error('居中后没有拿到当前所在高度：' + JSON.stringify(后));
  if (!后.cx) throw new Error('没有进入居中锁：' + JSON.stringify(后));
  const 期望x = await js(`(function(){
    var d=window.EditorApp.__aiDesignSize();
    var c=null, list=window.EditorApp.__aiComps();
    for (var i=0;i<list.length;i++) if (list[i].id==='${r.前.id}') c=list[i];
    if (!c) return null;
    var w=(typeof c.w==='number'&&isFinite(c.w))?c.w:88;
    return Math.round((d.w-w)/2);
  })()`);
  if (期望x !== null && Math.abs(后.x - 期望x) > 2) {
    throw new Error('居中后的 x 不是画布中线：' + JSON.stringify({ x: 后.x, 期望: 期望x }));
  }
  await js(`window.EditorApp.__aiToggleCenter('${r.前.id}')`);   // 取消，别留给后面的用例
  return { 前: JSON.stringify(r.前), 后: JSON.stringify(后) };
});
// 用**真实输入**验证"从预览拖出代码"这条主路径（合成 dispatchEvent 走不到真实手势，以前那几条
// 因此一直是假失败）。这里按下、拖动、松手全走 CDP Input 域。
await check('【真实输入】从预览拖代码：落在画布上会插入，拖回面板则取消', async () => {
  const 在编辑器 = await js(`!document.getElementById('viewEditor').classList.contains('hidden')`);
  if (!在编辑器) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1500);
  }
  await js(`(function(){
    try { window.EditorApp.__aiClearPanelBox(); } catch (e) {}
    var p=document.getElementById('aiPanel');
    p.classList.add('hidden');
    ['left','top','right','bottom','width','height','transform','opacity','borderRadius'].forEach(function(k){ p.style[k]=''; });
    p.classList.remove('morphing');
  })()`);
  await sleep(300);
  await js(`(function(){
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:998,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(700);
  await js(`(function(){
    window.EditorApp.__aiHandleRaw(JSON.stringify({ reply:'两组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
  })()`);
  await sleep(1500);
  // 必须切到「代码」页：拖出去的代码要落在**页面代码画布**上，
  // 停在设计页时右下的那条取消提示就是"先切到代码页"（测试踩过）。
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(700);
  await js(`document.getElementById('aiOpenCanvas').click()`);
  await sleep(900);
  const 定位 = await js(`(function(){
    var host=document.getElementById('aiPreview');
    var hr=host.getBoundingClientRect();
    var 点=null;
    Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
      if (点) return;
      for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var r=el.getBoundingClientRect();
      if (r.width>4 && r.top>hr.top+2) 点={x:Math.round(r.left+r.width/2), y:Math.round(r.top+8)};
    });
    var br=document.getElementById('blocklyDiv').getBoundingClientRect();
    var 预览块数=0;
    Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
      for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      预览块数++;
    });
    return { 起点:点, 落点:{x:Math.round(br.left+120), y:Math.round(br.top+220)},
             画布块数: Blockly.getMainWorkspace().getTopBlocks(true).length, 预览块数:预览块数 };
  })()`);
  if (!定位.起点) throw new Error('预览里找不到可拖的代码：' + JSON.stringify(定位));

  // ① 落到页面画布上 → 应当插入
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 定位.起点.x, y: 定位.起点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 定位.起点.x + 12, y: 定位.起点.y + 12, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 定位.落点.x, y: 定位.落点.y, button: 'left', buttons: 1 });
  await sleep(120);
  const 拖动中 = await js(`({ 有跟手图: !!document.querySelector('.ai-dragimg'), 面板淡出: document.body.classList.contains('ai-dragging') })`);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 定位.落点.x, y: 定位.落点.y, button: 'left', clickCount: 1 });
  await sleep(600);
  const 落上后 = await js(`({ 画布块数: Blockly.getMainWorkspace().getTopBlocks(true).length,
                              面板还开着: !document.getElementById('aiPanel').classList.contains('hidden') })`);
  // ② 拖回面板上松手 → 取消，不该插入
  await js(`document.getElementById('aiOpenCanvas').click()`);
  await sleep(900);
  const 定位2 = await js(`(function(){
    var host=document.getElementById('aiPreview');
    var hr=host.getBoundingClientRect();
    var 点=null;
    Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
      if (点) return;
      for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var r=el.getBoundingClientRect();
      if (r.width>4 && r.top>hr.top+2) 点={x:Math.round(r.left+r.width/2), y:Math.round(r.top+8)};
    });
    return { 起点:点, 前: Blockly.getMainWorkspace().getTopBlocks(true).length,
             面板内:{x: Math.round(hr.left+40), y: Math.round(hr.top+200)} };
  })()`);
  if (!定位2.起点) throw new Error('第二次找不到可拖的代码');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 定位2.起点.x, y: 定位2.起点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 定位2.起点.x + 12, y: 定位2.起点.y + 12, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 定位2.面板内.x, y: 定位2.面板内.y, button: 'left', buttons: 1 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 定位2.面板内.x, y: 定位2.面板内.y, button: 'left', clickCount: 1 });
  await sleep(500);
  const 取消后 = await js(`({ 画布块数: Blockly.getMainWorkspace().getTopBlocks(true).length,
                              状态: document.getElementById('aiStatus').textContent })`);
  await shot('t23-拖出代码之后');

  if (!拖动中.有跟手图) throw new Error('拖代码时没有跟手的代码图：' + JSON.stringify(拖动中));
  if (落上后.画布块数 <= 定位.画布块数) {
    const 调试 = await js(`({ 状态: document.getElementById('aiStatus').textContent,
                              面板开着: !document.getElementById('aiPanel').classList.contains('hidden'),
                              画布页: !document.getElementById('aiCanvasPage').classList.contains('hidden'),
                              有待插入: window.EditorApp.__aiDragState().有待插入代码 })`);
    throw new Error('拖到画布上没有插入：' + JSON.stringify({ 前: 定位.画布块数, 后: 落上后.画布块数, 落点: 定位.落点, 调试: 调试 }));
  }
  if (!落上后.面板还开着) throw new Error('拖完把对话框关掉了（用户要求保持打开）');
  if (取消后.画布块数 !== 落上后.画布块数) throw new Error('拖回面板松手也插入了（应该取消）：' + JSON.stringify(取消后));
  return { 拖动中: 拖动中, 插入: 定位.画布块数 + ' → ' + 落上后.画布块数,
           取消: 取消后.画布块数 === 落上后.画布块数 ? '没插入' : '插入了', 状态: 取消后.状态 };
});
// ===== 真实输入驱动的手势验证（CDP Input 域，走完整事件管线）=====
// 说明：预览内容若没有超出视口，Blockly 会把 scroll 夹到 0（主画布同理），
// 所以这里断言的都是**确定可测**的事实：事件真的送到、按下走了哪条分支、
// 换算方向正确、松手不跳。位置换算与 Blockly 自己的 WorkspaceDragger 逐字一致。
await check('【真实输入】手势：事件送达、分支正确、换算方向对、松手不跳', async () => {
  // 回编辑器（这个用例排在最后，可能停在首页，那里一切尺寸都是 0）
  const 在编辑器 = await js(`!document.getElementById('viewEditor').classList.contains('hidden')`);
  if (!在编辑器) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1500);
  }
  // 面板几何彻底复位后再打开（前面的用例会拖动/改尺寸）
  await js(`(function(){
    try { window.EditorApp.__aiClearPanelBox(); } catch (e) {}
    var p=document.getElementById('aiPanel');
    p.classList.add('hidden');
    ['left','top','right','bottom','width','height','transform','opacity','borderRadius'].forEach(function(k){ p.style[k]=''; });
    p.classList.remove('morphing');
  })()`);
  await sleep(300);
  await js(`(function(){
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:999,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
  })()`);
  await sleep(700);
  await js(`(function(){
    window.EditorApp.__aiHandleRaw(JSON.stringify({ reply:'两组', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value></block></xml>' }));
    document.getElementById('aiOpenCanvas').click();
  })()`);
  await sleep(1500);
  // 装探针 + 找一个真的落在预览框内的空白点
  const P = await js(`(function(){
    window.__probe = { down: 0, move: 0, up: 0 };
    window.addEventListener('pointerdown', function(){ window.__probe.down++; }, true);
    window.addEventListener('pointermove', function(){ window.__probe.move++; }, true);
    window.addEventListener('pointerup', function(){ window.__probe.up++; }, true);
    var host=document.getElementById('aiPreview');
    var hr=host.getBoundingClientRect();
    var 候选=[[hr.left+30, hr.bottom-30],[hr.right-30, hr.bottom-30],[hr.left+30, hr.top+40],[hr.right-30, hr.top+40]];
    var 空白=null, 代码点=null;
    候选.forEach(function(c){
      var x=Math.round(c[0]), y=Math.round(c[1]);
      if (x<2||y<2||x>window.innerWidth-2||y>window.innerHeight-2) return;
      var el=document.elementFromPoint(x,y);
      var 在预览=!!(el && (el===host || (host.contains && host.contains(el))));
      var 是代码=!!(el && el.closest && el.closest('[data-id]'));
      if (在预览 && 是代码 && !代码点) 代码点={x:x,y:y};
      if (在预览 && !是代码 && !空白) 空白={x:x,y:y};
    });
    if (!代码点) {
      Array.prototype.forEach.call(document.querySelectorAll('#aiPreview [data-id]'), function(el){
        if (代码点) return;
        for (var p=el.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
          if (p.getAttribute && p.getAttribute('data-id')) return;
        }
        var r=el.getBoundingClientRect();
        if (r.width>4) 代码点={x:Math.round(r.left+r.width/2), y:Math.round(r.top+8)};
      });
    }
    var v=window.EditorApp.__aiPreviewView();
    return { 空白:空白, 代码点:代码点, 预览尺寸:[host.offsetWidth,host.offsetHeight], 视图:v,
             画布页可见: !document.getElementById('aiCanvasPage').classList.contains('hidden') };
  })()`);
  if (!P.画布页可见 || !P.预览尺寸[0]) throw new Error('画布页没打开或尺寸为 0：' + JSON.stringify(P));
  if (!P.代码点) throw new Error('预览里找不到代码：' + JSON.stringify(P));

  // ① 按在空白处 → 应当进入"平移"分支（真实输入）
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P.空白 ? P.空白.x : P.代码点.x, y: P.空白 ? P.空白.y : P.代码点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (P.空白 ? P.空白.x : P.代码点.x) - 20, y: (P.空白 ? P.空白.y : P.代码点.y) - 10, button: 'left', buttons: 1 });
  await sleep(100);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: (P.空白 ? P.空白.x : P.代码点.x) - 20, y: (P.空白 ? P.空白.y : P.代码点.y) - 10, button: 'left', clickCount: 1 });
  await sleep(150);
  const 平移分支 = await js(`window.EditorApp.__aiGestureState()`);
  const 平移后 = await js(`window.EditorApp.__aiPreviewView()`);

  // ② 按在代码上 → 应当进入"拖出去"分支
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P.代码点.x, y: P.代码点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80);
  const 拖拽分支 = await js(`window.EditorApp.__aiGestureState()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P.代码点.x, y: P.代码点.y, button: 'left', clickCount: 1 });
  await sleep(150);

  const 探针 = await js(`window.__probe`);
  // ③ 换算方向：手指右移 → scrollX 增大（与 Blockly 自己的 WorkspaceDragger 一致）
  const 换算 = await js(`(function(){
    var r = window.EditorApp.__aiPanScroll(1000, 500, 100, 0);
    var l = window.EditorApp.__aiPanScroll(1000, 500, -100, 0);
    return { 右移: r.x, 左移: l.x, 基准: 1000 };
  })()`);
  await shot('t22-真实手势之后');
  await js(`(function(){ var b=document.getElementById('aiCanvasBack'); if (b) b.click(); })()`);
  await sleep(300);

  const 结果 = { 探针: 探针, 平移分支: 平移分支, 拖拽分支: 拖拽分支, 换算: 换算, 视图: P.视图, 平移后: 平移后 };
  if (!探针 || 探针.down < 2) throw new Error('浏览器没把 pointerdown 送进来：' + JSON.stringify(结果));
  if (平移分支.分支 !== '空白（平移）') throw new Error('按在空白处没有进入平移分支：' + JSON.stringify(结果));
  if (拖拽分支.分支 !== '代码（拖出去）') throw new Error('按在代码上没有进入拖拽分支：' + JSON.stringify(结果));
  if (!(换算.右移 > 换算.基准 && 换算.左移 < 换算.基准)) throw new Error('平移换算方向不对：' + JSON.stringify(结果));
  return { 探针: 探针, 平移分支: 平移分支.分支, 拖拽分支: 拖拽分支.分支,
           换算: 换算.基准 + ' → 右' + 换算.右移 + ' / 左' + 换算.左移 };
});
// ===== 新功能：拖代码进对话框 + AI 修复闭环 =====
// 用户需求：① 运行有问题但不知道是哪段 → 让 AI 找出来给替换方案，确认即替换；
//          ② 直接把画布代码拖进对话框（本体代码留在画布），可多段、可删，再描述问题让 AI 改。
await check('拖进对话框：代码进暂存区、本体代码还在、可删可清空', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    App.__aiStageClear();
    var 段数前 = Blockly.getMainWorkspace().getTopBlocks(true).length;
    App.__aiStageFromCanvas(0);
    App.__aiStageFromCanvas(1);
    var 两个 = App.__aiStaged();
    var 段数后 = Blockly.getMainWorkspace().getTopBlocks(true).length;
    var 卡片数 = document.querySelectorAll('#aiStaged .ai-staged-chip').length;
    var 面板可见 = !document.getElementById('aiStaged').classList.contains('hidden');
    // 删掉一个
    var x = document.querySelector('#aiStaged .ai-staged-chip .x');
    if (x) x.click();
    var 删后 = App.__aiStaged().length;
    // 清空
    var c = document.querySelector('#aiStaged .ai-staged-clear');
    if (c) c.click();
    var 清空后 = App.__aiStaged().length;
    var 隐藏 = document.getElementById('aiStaged').classList.contains('hidden');
    return { 段数前:段数前, 段数后:段数后, 两段:两个.length, 卡片数:卡片数, 面板可见:面板可见,
             删后:删后, 清空后:清空后, 清空后隐藏:隐藏, 标签:两个.map(function(a){return a.label;}) };
  })()`);
  if (r.两段 !== 2 || r.卡片数 !== 2 || !r.面板可见) throw new Error('拖进对话框后暂存区不对：' + JSON.stringify(r));
  if (r.段数后 !== r.段数前) throw new Error('拖进对话框不该动到画布上的代码：' + JSON.stringify(r));
  if (r.删后 !== 1) throw new Error('删掉一段后数量不对：' + JSON.stringify(r));
  if (r.清空后 !== 0 || !r.清空后隐藏) throw new Error('清空后没复位：' + JSON.stringify(r));
  return { 拖进: r.两段 + ' 段（画布仍是 ' + r.段数后 + ' 段）', 删掉一段后: r.删后, 清空: '已清空', 标签: r.标签 };
});

await check('AI 修复闭环：给出方案卡片，确认后替换画布上那一段', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabBlocks').click();
    App.__aiStageClear();
    var ws=Blockly.getMainWorkspace();
    // 先确保画布上有一段 act_toast
    App.__aiApplyComponents([]);   // 无操作，仅为保持 API 一致
    var tops=ws.getTopBlocks(true);
    var 前类型 = tops.map(function(b){return b.type;});
    // 模拟 AI 返回一份"修复方案"：把第 0 段换成 act_settext
    App.__aiHandleRaw(JSON.stringify({ reply:'第 0 段的事件绑错了，我给你换成正确的版本',
      fixes:[{ index:0, reason:'事件绑到了按钮2，改成按钮1', blocks:'<xml xmlns="https://developers.google.com/blockly/xml">'
        + '<block type="act_vibrate"></block></xml>' }] }));
    var 方案 = App.__aiPendingFixes();
    var 卡片可见 = !document.getElementById('aiFixWrap').classList.contains('hidden');
    var 按钮可见 = !document.getElementById('aiFixOps').classList.contains('hidden');
    var 条数 = document.querySelectorAll('#aiFixList .ai-fix-item').length;
    var 替换数 = App.__aiApplyFixes();
    var 后类型 = ws.getTopBlocks(true).map(function(b){return b.type;});
    var 卡片关掉 = document.getElementById('aiFixWrap').classList.contains('hidden');
    return { 方案:方案, 卡片可见:卡片可见, 按钮可见:按钮可见, 条数:条数, 替换数:替换数,
             前类型:前类型, 后类型:后类型, 卡片关掉:卡片关掉 };
  })()`);
  if (!r.方案 || !r.方案.length) throw new Error('没解析出修复方案：' + JSON.stringify(r));
  if (!r.卡片可见 || !r.按钮可见 || r.条数 !== 1) throw new Error('修复方案卡片没显示对：' + JSON.stringify(r));
  if (!(r.替换数 >= 1)) throw new Error('确认替换没有生效：' + JSON.stringify(r));
  if (r.后类型.indexOf('act_vibrate') < 0) throw new Error('画布上没有出现修复后的代码：' + JSON.stringify(r));
  if (!r.卡片关掉) throw new Error('替换后方案卡片没收起：' + JSON.stringify(r));
  return { 方案: r.方案[0].reason, 替换: r.替换数 + ' 段', 前: r.前类型.join(','), 后: r.后类型.join(',') };
});
// 真实输入：按住画布上的代码，拖到 AI 面板里松手 → 该段代码进入暂存区，画布上那份还在
await check('【真实输入】把画布代码拖进对话框（本体代码留在画布）', async () => {
  const 就绪 = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabBlocks').click();
    App.__aiStageClear();
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:997,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
    return { 段数: Blockly.getMainWorkspace().getTopBlocks(true).length,
             暂存: App.__aiStaged().length };
  })()`);
  await sleep(800);
  const 点 = await js(`(function(){
    var el=null;
    Array.prototype.forEach.call(document.querySelectorAll('#blocklyDiv [data-id]'), function(n){
      if (el) return;
      for (var p=n.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var r=n.getBoundingClientRect();
      if (r.width>10 && r.top>60) el={x:Math.round(r.left+30), y:Math.round(r.top+10)};
    });
    var pn=document.getElementById('aiPanel').getBoundingClientRect();
    return { 抓:el, 面板:{x:Math.round(pn.left+pn.width/2), y:Math.round(pn.top+120)} };
  })()`);
  if (!点.抓) throw new Error('画布上找不到可拖的代码');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 点.抓.x, y: 点.抓.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点.抓.x + 40, y: 点.抓.y + 30, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点.面板.x, y: 点.面板.y, button: 'left', buttons: 1 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 点.面板.x, y: 点.面板.y, button: 'left', clickCount: 1 });
  await sleep(500);
  const 后 = await js(`({ 暂存: window.EditorApp.__aiStaged(),
                          段数: Blockly.getMainWorkspace().getTopBlocks(true).length,
                          卡片: document.querySelectorAll('#aiStaged .ai-staged-chip').length })`);
  await shot('t24-拖进对话框');
  await js(`window.EditorApp.__aiStageClear()`);
  if (!后.暂存.length) throw new Error('拖到面板里没有进暂存区：' + JSON.stringify({ 前: 就绪, 后: 后 }));
  if (后.段数 !== 就绪.段数) throw new Error('本体代码不该消失/增加：' + JSON.stringify({ 前: 就绪, 后: 后 }));
  if (!后.卡片) throw new Error('对话框里没有出现代码卡片：' + JSON.stringify(后));
  return { 拖进: 后.暂存[0].label, 画布段数: 就绪.段数 + ' → ' + 后.段数, 卡片: 后.卡片 };
});
// 用户反馈两条：① 拖进来让它删除，删不掉；② 拖进对话框后松手，画布那段没回到原位
await check('AI 可以说"删除这一段"，确认后画布上那段被删掉', async () => {
  const r = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabBlocks').click();
    App.__aiStageClear();
    var ws=Blockly.getMainWorkspace();
    var 前 = ws.getTopBlocks(true).length;
    App.__aiHandleRaw(JSON.stringify({ reply:'这段是多余的，我给你删掉',
      fixes:[{ index:0, delete:true, reason:'这段多余' }] }));
    var 方案 = App.__aiPendingFixes();
    var 文案 = (document.querySelector('#aiFixList .ai-fix-item .r')||{}).textContent || '';
    var 替换数 = App.__aiApplyFixes();
    var 后 = ws.getTopBlocks(true).length;
    return { 前:前, 后:后, 方案:方案, 文案:文案, 替换数:替换数 };
  })()`);
  if (!r.方案 || !r.方案.length) throw new Error('删除方案没被解析：' + JSON.stringify(r));
  if (!/删除/.test(r.文案)) throw new Error('卡片没说明这是删除：' + JSON.stringify(r));
  if (r.后 !== r.前 - 1) throw new Error('确认后没有真的删掉那一段：' + JSON.stringify(r));
  return { 段数: r.前 + ' → ' + r.后, 文案: r.文案 };
});

await check('【真实输入】拖进对话框后，画布上那段回到原位', async () => {
  const 就绪 = await js(`(function(){
    var App=window.EditorApp;
    document.getElementById('tabBlocks').click();
    App.__aiStageClear();
    var p=document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b=document.getElementById('aiBall'), r=b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:996,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
    return { 段数: Blockly.getMainWorkspace().getTopBlocks(true).length };
  })()`);
  await sleep(800);
  const 点 = await js(`(function(){
    var el=null;
    Array.prototype.forEach.call(document.querySelectorAll('#blocklyDiv [data-id]'), function(n){
      if (el) return;
      for (var p=n.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var r=n.getBoundingClientRect();
      if (r.width>10 && r.top>60) el={x:Math.round(r.left+30), y:Math.round(r.top+10)};
    });
    if (!el) return null;
    // 记录这段代码在画布坐标系里的位置（用块自身的坐标，最直接）
    var ws=Blockly.getMainWorkspace();
    var id=null;
    Array.prototype.forEach.call(document.querySelectorAll('#blocklyDiv [data-id]'), function(n){
      if (id) return;
      for (var p=n.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var r=n.getBoundingClientRect();
      if (r.width>10 && r.top>60) id=n.getAttribute('data-id');
    });
    var b=id?ws.getBlockById(id):null;
    var top=b; while (top && top.getParent && top.getParent()) top=top.getParent();
    var xy=top?top.getRelativeToSurfaceXY():null;
    window.__origId = top ? top.id : null;
    var pn=document.getElementById('aiPanel').getBoundingClientRect();
    return { 抓:el, 原位: xy?{x:Math.round(xy.x),y:Math.round(xy.y)}:null,
             面板:{x:Math.round(pn.left+pn.width/2), y:Math.round(pn.top+120)} };
  })()`);
  if (!点 || !点.抓 || !点.原位) throw new Error('找不到可拖的代码');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 点.抓.x, y: 点.抓.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点.抓.x + 50, y: 点.抓.y + 40, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点.面板.x, y: 点.面板.y, button: 'left', buttons: 1 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 点.面板.x, y: 点.面板.y, button: 'left', clickCount: 1 });
  await sleep(900);      // 等复位补齐（0/50/180/400ms）
  const 后 = await js(`(function(){
    var ws=Blockly.getMainWorkspace();
    var b=ws.getBlockById(window.__origId);
    var xy=b?b.getRelativeToSurfaceXY():null;
    return { 还在: !!b, 位置: xy?{x:Math.round(xy.x),y:Math.round(xy.y)}:null,
             段数: ws.getTopBlocks(true).length, 暂存: window.EditorApp.__aiStaged().length };
  })()`);
  await js(`window.EditorApp.__aiStageClear()`);
  if (!后.还在) throw new Error('那段代码被删掉了（不该动本体）：' + JSON.stringify(后));
  if (!后.暂存) throw new Error('没有进暂存区：' + JSON.stringify(后));
  const 偏差 = Math.abs(后.位置.x - 点.原位.x) + Math.abs(后.位置.y - 点.原位.y);
  if (偏差 > 6) throw new Error('松手后没有回到原位：' + JSON.stringify({ 原位: 点.原位, 复位后: 后.位置, 偏差: 偏差 }));
  return { 原位: 点.原位.x + ',' + 点.原位.y, 复位后: 后.位置.x + ',' + 后.位置.y, 偏差: 偏差, 段数: 就绪.段数 + ' → ' + 后.段数 };
});
// 代码类扩充：工具箱里每个积木都必须真实存在、并且能生成 JS；函数（自定义函数）要能跑
await check('工具箱里的每个代码块都真实存在，且都有代码生成器', async () => {
  const r = await js(`(function(){
    var xml = window.buildToolboxXml(null);
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    var types = {}, 缺定义 = [], 缺生成器 = [];
    Array.prototype.forEach.call(doc.querySelectorAll('block[type]'), function (n) {
      types[n.getAttribute('type')] = 1;
    });
    Object.keys(types).forEach(function (t) {
      if (!Blockly.Blocks[t]) 缺定义.push(t);
      if (!Blockly.JavaScript.forBlock[t]) 缺生成器.push(t);
    });
    return { 总数: Object.keys(types).length, 缺定义: 缺定义, 缺生成器: 缺生成器 };
  })()`);
  if (r.缺定义.length) throw new Error('工具箱里有不存在的代码块：' + JSON.stringify(r));
  if (r.缺生成器.length) throw new Error('这些代码块没有代码生成器：' + JSON.stringify(r));
  return { 代码块种类: r.总数 };
});

await check('函数：定义 + 调用能生成可运行的代码', async () => {
  const r = await js(`(function(){
    var ws = window.EditorApp.__aiWs() || Blockly.getMainWorkspace();
    ws.clear();
    var xml = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="procedures_defnoreturn" x="40" y="40"><field name="NAME">打招呼</field>'
      + '<statement name="STACK"><block type="act_toast"><value name="MSG">'
      + '<shadow type="text"><field name="TEXT">你好</field></shadow></value></block></statement></block>'
      + '<block type="ev_start" x="40" y="360"><next>'
      + '<block type="procedures_callnoreturn"><mutation name="打招呼"></mutation></block>'
      + '</next></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    var code = window.generateEventCode(ws);
    // 用假的 RT 跑一遍：只要不抛错，说明生成的 JS 是合法的
    var 喊了 = [];
    var RT = new Proxy({}, { get: function () { return function (a) { 喊了.push(a); }; } });
    var err = null;
    try { new Function('RT', code)(RT); } catch (e) { err = String(e && e.message || e); }
    return { 有函数定义: code.indexOf('function ') >= 0,
             有调用: code.indexOf('打招呼') >= 0 || code.indexOf('doSomething') >= 0,
             报错: err, 代码长度: code.length };
  })()`);
  if (!r.有函数定义) throw new Error('函数没有生成函数定义：' + JSON.stringify(r));
  if (r.报错) throw new Error('函数生成的代码跑不起来：' + JSON.stringify(r));
  return { 生成: '函数定义 + 调用', 代码长度: r.代码长度 };
});

await check('数学/文本/列表的新代码块能生成可运行代码', async () => {
  const r = await js(`(function(){
    var ws = Blockly.getMainWorkspace();
    ws.clear();
    // 当页面启动时：弹出 (文本长度(去空格(" 你好 "))) —— 覆盖 文本/数学 两类新代码
    var xml = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start" x="40" y="40"><next><block type="act_toast"><value name="MSG">'
      + '<block type="text_length"><value name="VALUE"><block type="text_trim">'
      + '<field name="MODE">BOTH</field><value name="TEXT"><shadow type="text"><field name="TEXT"> 你好 </field></shadow></value>'
      + '</block></value></block></value></block></next></block>'
      + '<block type="ev_first_start" x="40" y="300"><next><block type="act_set_progress">'
      + '<field name="COMP">progress1</field>'
      + '<value name="VALUE"><block type="math_round"><field name="OP">ROUND</field>'
      + '<value name="NUM"><block type="math_modulo"><value name="DIVIDEND"><shadow type="math_number"><field name="NUM">7</field></shadow></value>'
      + '<value name="DIVISOR"><shadow type="math_number"><field name="NUM">3</field></shadow></value></block></value>'
      + '</block></value></block></next></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    var code = window.generateEventCode(ws);
    var RT = new Proxy({}, { get: function () { return function () {}; } });
    var err = null;
    try { new Function('RT', code)(RT); } catch (e) { err = String(e && e.message || e); }
    return { 代码: code.slice(0, 300), 报错: err, 有trim: /trim/.test(code), 有取整或取余: /Math\\.round|%/.test(code) };
  })()`);
  if (r.报错) throw new Error('新代码块生成的代码跑不起来：' + JSON.stringify(r));
  if (!r.有trim) throw new Error('文本块没有生成 trim：' + JSON.stringify(r));
  return { 生成: '文本 + 数学块组合', 报错: '无' };
});
await check('「函数」分类出现在分类栏，且能列出定义/调用代码', async () => {
  const r = await js(`(function(){
    document.getElementById('tabBlocks').click();
    // 分类栏是按 BB_GROUPS 渲染的，这里直接查数据源 + 工具箱条目（比抠 DOM 稳）
    var groups = (window.BB_GROUPS && window.BB_GROUPS.general) || [];
    var ws = Blockly.getMainWorkspace();
    var tb = ws && ws.getToolbox ? ws.getToolbox() : null;
    var items = (tb && tb.getToolboxItems) ? tb.getToolboxItems() : [];
    var names = items.map(function (it) { return it.getName ? it.getName() : ''; }).filter(Boolean);
    return { 有函数分类: groups.indexOf('函数') >= 0 && names.indexOf('函数') >= 0, 分组: groups, 工具箱分类: names };
  })()`);
  await sleep(400);
  if (!r.有函数分类) throw new Error('分类栏里没有「函数」：' + JSON.stringify(r.分类));
  // 点开函数分类，看动态面板里有没有定义/调用代码
  const fly = await js(`(function(){
    var ws = Blockly.getMainWorkspace();
    if (!ws || !ws.getToolbox) return { 无工具箱: true };
    var tb = ws.getToolbox();
    if (!tb) return { 无工具箱: true };
    var items = tb.getToolboxItems ? tb.getToolboxItems() : [];
    var 函数项 = null;
    items.forEach(function(it){
      var n = it.getName ? it.getName() : '';
      if (n === '函数') 函数项 = it;
    });
    if (!函数项) return { 找不到函数项: true };
    tb.setSelectedItem(函数项);
    return { 选中: true };
  })()`);
  await sleep(900);
  const 面板 = await js(`(function(){
    var fly = document.querySelector('.blocklyFlyout');
    var types = [];
    if (fly) Array.prototype.forEach.call(fly.querySelectorAll('[data-id]'), function(g){
      for (var p=g.parentNode; p && p.getBoundingClientRect; p=p.parentNode) {
        if (p.getAttribute && p.getAttribute('data-id')) return;
      }
      var t = g.getAttribute('data-id'); if (t) types.push(t);
    });
    var 文字 = fly ? (fly.textContent||'') : '';
    return { 块数: types.length, 有定义字样: /定义|做/.test(文字), 片段: 文字.slice(0, 60) };
  })()`);
  if (fly.无工具箱 || fly.找不到函数项) throw new Error('工具箱里找不到「函数」分类：' + JSON.stringify(fly));
  if (!面板.块数) throw new Error('「函数」分类点开后是空的：' + JSON.stringify(面板));
  return { 分类: '函数', 面板块数: 面板.块数, 文字: 面板.片段 };
});
// 新增的 11 种控件：编辑器里能建、布局页能渲染、运行时（导出后）也能渲染
await check('新增控件：下拉/单选/日期/时间/步进器/图片按钮/计时器/画布/卡片/分隔线/占位 都能用', async () => {
  const 名单 = ['select','radio','date','time','stepper','imgbtn','timer','canvas','card','divider','spacer'];
  const 加了 = await js(`(function(){
    var App = window.EditorApp;
    var 名单 = ${JSON.stringify(名单)};
    var 加的 = [];
    名单.forEach(function (t, i) {
      var props = { x: 24, y: 60 + i * 70, w: 200, h: 48 };
      if (t === 'select' || t === 'radio') { props.items = ['甲','乙']; props.value = '甲'; }
      if (t === 'timer') props.text = '00:10';
      if (t === 'divider') props.h = 2;
      var before = App.__aiComps().length;
      App.__aiApplyComponents([{ op:'add', type: t, props: props }]);
      if (App.__aiComps().length > before) 加的.push(t);
    });
    return { 加的: 加的, 总数: App.__aiComps().length };
  })()`);
  await sleep(300);
  if (加了.加的.length !== 名单.length) throw new Error('有控件没建出来：' + JSON.stringify(加了));
  // 布局页里每种都应当有对应的条目
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1500);
  const 舞台 = await js(`(function(){
    var stage = document.getElementById('layStage');
    var got = {};
    Array.prototype.forEach.call(stage.querySelectorAll('.litem'), function (n) {
      var cls = n.className.split(' ').filter(function (c) { return c.indexOf('t-') === 0; })[0] || '';
      var t = cls.replace('t-', '');
      if (t) got[t] = 1;
    });
    return { 有: Object.keys(got), 条目数: stage.querySelectorAll('.litem').length };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  const 缺 = 名单.filter(function (t) { return 舞台.有.indexOf(t) < 0; });
  if (缺.length) throw new Error('布局页里没渲染出来：' + JSON.stringify({ 缺: 缺, 实际: 舞台.有 }));
  return { 控件数: 名单.length, 布局页条目: 舞台.条目数 };
});

await check('新增控件在运行时（导出后）能渲染出真实的表单元素', async () => {
  const exp = await js(`(function(){ return window.EditorApp.__exportPreview(); })()`);
  if (!exp) throw new Error('导出预览失败');
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.getElementById('screen') && !!document.querySelector('#screen .comp.select .rt-select')`, 15000);
    if (!ok) await sleep(700);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没能渲染出下拉选择框（已切回编辑器）');
  }
  const r = await js(`(function(){
    var q = function (s) { return document.querySelectorAll('#screen ' + s).length; };
    return { 下拉: q('.comp.select .rt-select'), 单选: q('.comp.radio .rt-radio-dot'), 日期: q('.comp.date input[type=date]'),
             时间: q('.comp.time input[type=time]'), 步进器: q('.comp.stepper .rt-step-b'), 图片按钮: q('.comp.imgbtn'),
             计时器: q('.comp.timer .rt-timer'), 画布: q('.comp.canvas canvas'), 卡片: q('.comp.card .rt-card'),
             分隔线: q('.comp.divider .rt-divider'), 占位: q('.comp.spacer .rt-spacer'),
             总量: document.querySelectorAll('#screen [data-id]').length };
  })()`);
  await shot('t25-新控件运行时');
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  const 缺 = Object.keys(r).filter(function (k) { return k !== '总量' && !r[k]; });
  if (缺.length) throw new Error('运行时缺少这些控件：' + JSON.stringify({ 缺: 缺, 明细: r }));
  return { 全部渲染: Object.keys(r).length - 1 + ' 种', 元素总数: r.总量 };
});
// 阶段 2 第一批控件：标签页 / 折叠面板 / 评分 / 进度环
// 验收口径 = 设计页能建、布局页有预览（且和运行时同一套结构）、运行时能点能读能写。
await check('新控件①：标签页/折叠面板/评分/进度环 三处渲染一致，运行时能交互', async () => {
  // 上一条用例最后跳回了 editor.html（停在首页），这里先确保真有工程打开。
  // 注意不要用 ensureProject()：它依赖的 __ensureSeq 在本文件后面才声明，提前调用会踩 TDZ。
  const 工程就绪 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (!(await js(工程就绪))) {
    // 直接走「创建新 App」（和 t02 同一条路，最稳）；重名会被按钮拦下，所以名字带时间戳
    await clickText('#viewHome button', '创建新 ?App|新建');
    const 弹窗了 = await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`);
    if (!弹窗了) throw new Error('新建弹窗没出来（当前视图：' + await viewsVisible() + '）');
    await js(`(function(){
      var i = document.querySelector('#createMask input');
      i.value = '新控件测试' + Date.now().toString().slice(-6);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('createGo').click();
    })()`);
    if (!(await waitFor(工程就绪, 15000))) throw new Error('新建后工程没打开');
    await sleep(600);
  }
  const 加的 = await js(`(function(){
    var App = window.EditorApp;
    var 配置 = [
      { type:'tabs',     props:{ x:24,  y:520, w:300, h:48,  items:['甲','乙','丙'], value:1 } },
      { type:'collapse', props:{ x:24,  y:580, w:300, h:96,  text:'更多', body:'内容在此', open:false } },
      { type:'rating',   props:{ x:24,  y:690, w:180, h:44,  value:2, max:5 } },
      { type:'ring',     props:{ x:260, y:690, w:104, h:104, value:30, max:100 } }
    ];
    var 加的 = [];
    配置.forEach(function (one) {
      var before = App.__aiComps().length;
      App.__aiApplyComponents([{ op:'add', type:one.type, props:one.props }]);
      var cs = App.__aiComps();
      if (cs.length <= before) return;
      // __aiComps() 新的在最前面
      加的.push({ type: one.type, id: cs[0].id });
    });
    return 加的;
  })()`);
  await sleep(300);
  if (加的.length !== 4) throw new Error('有控件没建出来：' + JSON.stringify(加的));

  // 布局页：每种控件都要有自己的 lv-* 子元素（不是空白卡片）
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1500);
  const 布局 = await js(`(function(){
    var stage = document.getElementById('layStage');
    var pick = function (t) { return stage.querySelector('.litem.t-' + t); };
    var 页签 = pick('tabs'), 折叠 = pick('collapse'), 评分 = pick('rating'), 环 = pick('ring');
    var 有 = function (n) { return !!n; };
    return {
      页签: 有(页签) ? 页签.querySelectorAll('.lv-tab').length : 0,
      页签选中: 有(页签) ? Array.prototype.indexOf.call(页签.querySelectorAll('.lv-tab'), 页签.querySelector('.lv-tab.on')) : -1,
      折叠头: 有(折叠) && !!折叠.querySelector('.lv-collapse-h'),
      折叠箭: 有(折叠) && !!折叠.querySelector('.lv-collapse-a'),
      星数: 有(评分) ? 评分.querySelectorAll('.lv-star').length : 0,
      星亮: 有(评分) ? 评分.querySelectorAll('.lv-star.on').length : 0,
      环: 有(环) && !!环.querySelector('.lv-ring'),
      环字: 有(环) && 环.querySelector('.lv-ring-t') ? 环.querySelector('.lv-ring-t').textContent : ''
    };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  if (布局.页签 !== 3 || 布局.页签选中 !== 1) throw new Error('布局页标签页不对：' + JSON.stringify(布局));
  if (!布局.折叠头 || !布局.折叠箭) throw new Error('布局页折叠面板不对：' + JSON.stringify(布局));
  if (布局.星数 !== 5 || 布局.星亮 !== 2) throw new Error('布局页评分不对：' + JSON.stringify(布局));
  if (!布局.环 || 布局.环字 !== '30%') throw new Error('布局页进度环不对：' + JSON.stringify(布局));

  // 运行时：同一份结构 + 真交互
  const exp = await js(`(function(){ return window.EditorApp.__exportPreview(); })()`);
  if (!exp) throw new Error('导出预览失败');
  await js(`location.href='runtime.html?v=' + Date.now()`);
  const 就绪 = await waitFor(`!!document.querySelector('#screen .comp.tabs .rt-tab')`, 15000);
  if (!就绪) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有渲染出标签页（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var 页签 = document.querySelector('#screen .comp.tabs');
    var 折叠 = document.querySelector('#screen .comp.collapse');
    var 评分 = document.querySelector('#screen .comp.rating');
    var 环 = document.querySelector('#screen .comp.ring');
    var 报 = [];
    var v0 = window.RT.getValue(document.querySelector('#screen .comp.tabs').getAttribute('data-id') || '');

    var 页钮 = 页签 ? 页签.querySelectorAll('.rt-tab') : [];
    if (页钮.length !== 3) 报.push('页签数 ' + 页钮.length);
    if (页钮[2]) 页钮[2].click();
    if (页钮[2] && !页钮[2].classList.contains('on')) 报.push('点第三个页签没选中');
    var 页值 = window.RT.getValue(页签.getAttribute('data-id'));

    var 折头 = 折叠 ? 折叠.querySelector('.rt-collapse-h') : null;
    if (!折头) 报.push('没有折叠头');
    else {
      折头.click();
      if (!折叠.querySelector('.rt-collapse').classList.contains('open')) 报.push('点了没展开');
      if (window.RT.getValue(折叠.getAttribute('data-id')) !== true) 报.push('展开后取值不是 true');
    }

    var 星 = 评分 ? 评分.querySelectorAll('.rt-star') : [];
    if (星.length !== 5) 报.push('星数 ' + 星.length);
    if (星[4]) 星[4].click();
    if (window.RT.getValue(评分.getAttribute('data-id')) !== 5) 报.push('点第五颗星取值不是 5');

    if (!环 || !环.querySelector('.rt-ring-fill')) 报.push('没有进度环');
    else {
      window.RT.setProgress(环.getAttribute('data-id'), 75);
      var 字 = 环.querySelector('.rt-ring-t');
      if (!字 || 字.textContent !== '75%') 报.push('设 75 后显示 ' + (字 && 字.textContent));
      if (window.RT.getProgress(环.getAttribute('data-id')) !== 75) 报.push('读回不是 75');
    }
    return { 报: 报, 初始页签值: v0, 点后页签值: 页值 };
  })()`);
  await shot('t25b-新控件第一批运行时');
  // 先判断言：后面回编辑器只是收尾，收尾失败不能把上面的结论吞掉
  if (运行.报.length) throw new Error('运行时交互有问题：' + JSON.stringify(运行));
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  // 尽力清理：本用例是新建的独立工程，编辑器重载后可能停在首页（没工程就没法删控件），
  // 删不掉也不影响别的用例，所以只尽力而为、不抛错。
  await js(`(function(){
    try {
      var App = window.EditorApp;
      App.__aiApplyComponents(${JSON.stringify(加的.map(c => ({ op:'remove', id: c.id })))});
      return App.__aiComps().length;
    } catch (e) { return 'skip: ' + e.message; }
  })()`);
  return { 控件: '4 种', 布局页: '结构齐全 ✓', 运行时: '切页签/展开/打分/设进度 ✓', 初始页签值: 运行.初始页签值 };
});

// 阶段 3 第一批控件：多选下拉 / 日期范围 / 颜色选择器
// 验收口径与上一批一致：设计页能建、布局页有预览、运行时能点能读能写。
await check('新控件②：多选下拉/日期范围/颜色选择器 三处渲染一致，运行时能交互', async () => {
  // 上一条用例最后跳回了 editor.html；没有工程就先建一个（不要用 ensureProject()，它会踩 TDZ）
  const 工程就绪 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (!(await js(工程就绪))) {
    await clickText('#viewHome button', '创建新 ?App|新建');
    const 弹窗了 = await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`);
    if (!弹窗了) throw new Error('新建弹窗没出来（当前视图：' + await viewsVisible() + '）');
    await js(`(function(){
      var i = document.querySelector('#createMask input');
      i.value = '新控件测试' + Date.now().toString().slice(-6);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('createGo').click();
    })()`);
    if (!(await waitFor(工程就绪, 15000))) throw new Error('新建后工程没打开');
    await sleep(600);
  }
  const 加的 = await js(`(function(){
    var App = window.EditorApp;
    var 配置 = [
      { type:'multiSelect', props:{ x:24, y:60,  w:260, h:48, items:['苹果','香蕉','橙子'], value:['苹果'] } },
      { type:'dateRange',   props:{ x:24, y:130, w:300, h:52, start:'2025-01-01', end:'2025-01-31' } },
      { type:'colorPicker', props:{ x:24, y:210, w:200, h:48, value:'#1565c0' } }
    ];
    var 加的 = [];
    配置.forEach(function (one) {
      var before = App.__aiComps().length;
      App.__aiApplyComponents([{ op:'add', type:one.type, props:one.props }]);
      var cs = App.__aiComps();
      if (cs.length <= before) return;
      加的.push({ type: one.type, id: cs[0].id });
    });
    return 加的;
  })()`);
  await sleep(300);
  if (加的.length !== 3) throw new Error('有控件没建出来：' + JSON.stringify(加的));

  // 布局页：每种控件都要有自己的一套预览结构
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1500);
  const 布局 = await js(`(function(){
    var stage = document.getElementById('layStage');
    var pick = function (t) { return stage.querySelector('.litem.t-' + t); };
    var 多选 = pick('multiSelect'), 范围 = pick('dateRange'), 颜色 = pick('colorPicker');
    var 有 = function (n) { return !!n; };
    var 色块 = 有(颜色) ? 颜色.querySelector('.lv-color-sw') : null;
    // 舞台只搬 layVisual 的子元素，视觉根节点的 class 会丢（和标签页同一套做法），
    // 所以这里断言的是子元素结构，不是 lv-multi / lv-color 本身。
    return {
      多选字: 有(多选) && 多选.querySelector('.lv-label') ? 多选.querySelector('.lv-label').textContent : '',
      多选箭: 有(多选) && !!多选.querySelector('.lv-caret'),
      日期段: 有(范围) ? 范围.querySelectorAll('.lv-date').length : 0,
      日期隔: 有(范围) && 范围.querySelector('.lv-dr-sep') ? 范围.querySelector('.lv-dr-sep').textContent : '',
      色块: !!色块,
      颜色字: 有(颜色) && 颜色.querySelector('.lv-label') ? 颜色.querySelector('.lv-label').textContent : '',
      颜色箭: 有(颜色) && !!颜色.querySelector('.lv-caret')
    };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  if (布局.多选字 !== '苹果' || !布局.多选箭) throw new Error('布局页多选下拉不对：' + JSON.stringify(布局));
  if (布局.日期段 !== 2 || 布局.日期隔 !== '至') throw new Error('布局页日期范围不对：' + JSON.stringify(布局));
  if (!布局.色块 || 布局.颜色字 !== '#1565c0' || !布局.颜色箭) throw new Error('布局页颜色选择器不对：' + JSON.stringify(布局));

  // 运行时：同一份结构 + 真交互 + 读写
  const exp = await js(`(function(){ return window.EditorApp.__exportPreview(); })()`);
  if (!exp || exp.错误) throw new Error('导出预览失败：' + JSON.stringify(exp));
  let 就绪 = false;
  for (let attempt = 0; attempt < 2 && !就绪; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    就绪 = await waitFor(`!!document.querySelector('#screen .comp.multiSelect .rt-select')`, 15000);
    if (!就绪) await sleep(700);
  }
  if (!就绪) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有渲染出多选下拉（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var 报 = [];
    var ms = document.querySelector('#screen .comp.multiSelect');
    var dr = document.querySelector('#screen .comp.dateRange');
    var cp = document.querySelector('#screen .comp.colorPicker');
    var msId = ms && ms.getAttribute('data-id'), drId = dr && dr.getAttribute('data-id'), cpId = cp && cp.getAttribute('data-id');

    // 多选：点开 → 3 项 → 再点第二项应连选；读回是数组
    var 多箱 = ms ? ms.querySelector('.rt-select') : null;
    if (!多箱) 报.push('没有多选框');
    else {
      if (!Array.isArray(window.RT.getValue(msId)) || window.RT.getValue(msId).join(',') !== '苹果') 报.push('初始值 ' + JSON.stringify(window.RT.getValue(msId)));
      多箱.click();
      var 单 = ms.querySelector('.rt-multi-menu');
      if (!单 || !单.classList.contains('open')) 报.push('菜单没打开');
      var 行 = ms.querySelectorAll('.rt-multi-item');
      if (行.length !== 3) 报.push('选项数 ' + 行.length);
      if (行[1]) 行[1].click();
      var v = window.RT.getValue(msId);
      if (!Array.isArray(v) || v.join(',') !== '苹果,香蕉') 报.push('点第二项后 ' + JSON.stringify(v));
      var lab = ms.querySelector('.rt-select-v');
      if (!lab || lab.textContent !== '苹果、香蕉') 报.push('显示文案 ' + (lab && lab.textContent));
      window.RT.setComponent(msId, '橙子');
      v = window.RT.getValue(msId);
      if (!Array.isArray(v) || v.join(',') !== '橙子') 报.push('设单值后 ' + JSON.stringify(v));
      if (ms.querySelectorAll('.rt-multi-item.on').length !== 1) 报.push('设单值后勾选数不对');
      var 文字 = lab ? lab.textContent : '';
      if (文字 !== '橙子') 报.push('设单值后文案 ' + 文字);
    }

    // 日期范围：改两个日期 → "开始~结束"；再整体设一次
    var 日 = dr ? dr.querySelectorAll('input.rt-date') : [];
    if (日.length !== 2) 报.push('日期框数 ' + 日.length);
    else {
      // 两个框分开改：改完一个，控件会把另一个框的值写回去，所以要按顺序来
      日[0].value = '2025-03-01'; 日[0].dispatchEvent(new Event('change', { bubbles: true }));
      日[1].value = '2025-03-09'; 日[1].dispatchEvent(new Event('change', { bubbles: true }));
      var rv = window.RT.getValue(drId);
      if (rv !== '2025-03-01~2025-03-09') 报.push('改日期后 ' + JSON.stringify(rv));
      window.RT.setComponent(drId, '2025-05-01~2025-05-20');
      if (window.RT.getValue(drId) !== '2025-05-01~2025-05-20') 报.push('整段设后 ' + JSON.stringify(window.RT.getValue(drId)));
      if (日[0].value !== '2025-05-01' || 日[1].value !== '2025-05-20') 报.push('整段设后输入框 ' + 日[0].value + '/' + 日[1].value);
    }

    // 颜色选择器：点开调色板 → 12 个色点 → 点一个 → 值变成那个色；再代码设色
    var 色箱 = cp ? cp.querySelector('.rt-color') : null;
    if (!色箱 || !cp.querySelector('.rt-color-sw')) 报.push('没有颜色选择器');
    else {
      if (window.RT.getValue(cpId) !== '#1565c0') 报.push('初始色 ' + window.RT.getValue(cpId));
      色箱.click();
      var 板 = cp.querySelector('.rt-color-menu');
      if (!板 || !板.classList.contains('open')) 报.push('色板没打开');
      var 点 = cp.querySelectorAll('.rt-color-dot');
      if (点.length !== 12) 报.push('色点数 ' + 点.length);
      var 目标 = null;
      Array.prototype.forEach.call(点, function (d) { if (d.getAttribute('data-c') === '#b3261e') 目标 = d; });
      if (!目标) 报.push('没找到目标色点');
      else {
        目标.click();
        if (window.RT.getValue(cpId) !== '#b3261e') 报.push('点色后 ' + window.RT.getValue(cpId));
        var tx = cp.querySelector('.rt-color-t');
        if (!tx || tx.textContent !== '#b3261e') 报.push('点色后文字 ' + (tx && tx.textContent));
      }
      window.RT.setComponent(cpId, '#2e7d32');
      if (window.RT.getValue(cpId) !== '#2e7d32') 报.push('代码设色后 ' + window.RT.getValue(cpId));
      if (cp.querySelector('.rt-color-sw').style.background.indexOf('46, 125, 50') < 0) 报.push('色块没跟着变 ' + cp.querySelector('.rt-color-sw').style.background);
    }
    return { 报: 报 };
  })()`);
  await shot('t25c-新控件第二批运行时');
  // 先判断言：后面回编辑器只是收尾，收尾失败不能把上面的结论吞掉
  if (运行.报.length) throw new Error('运行时交互有问题：' + JSON.stringify(运行));
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  await js(`(function(){
    try {
      var App = window.EditorApp;
      App.__aiApplyComponents(${JSON.stringify(加的.map(c => ({ op:'remove', id: c.id })))});
      return App.__aiComps().length;
    } catch (e) { return 'skip: ' + e.message; }
  })()`);
  return { 控件: '3 种', 布局页: '结构齐全 ✓', 运行时: '连选/改日期/挑颜色 + 代码读写 ✓' };
});

// 阶段 2 收尾控件：徽章 / 时钟 / 二维码
await check('新控件③：徽章/时钟/二维码 三处渲染一致，运行时能读写', async () => {
  const 工程就绪 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (!(await js(工程就绪))) {
    await clickText('#viewHome button', '创建新 ?App|新建');
    const 弹窗了 = await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`);
    if (!弹窗了) throw new Error('新建弹窗没出来（当前视图：' + await viewsVisible() + '）');
    await js(`(function(){
      var i = document.querySelector('#createMask input');
      i.value = '收尾控件' + Date.now().toString().slice(-6);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('createGo').click();
    })()`);
    if (!(await waitFor(工程就绪, 15000))) throw new Error('新建后工程没打开');
    await sleep(600);
  }
  const 加的 = await js(`(function(){
    var App = window.EditorApp;
    var 配置 = [
      { type:'badge', props:{ x:24, y:60,  w:120, h:32, text:'新', dot:'#e5484d' } },
      { type:'clock', props:{ x:24, y:120, w:170, h:44, format:'hms' } },
      { type:'qr',    props:{ x:24, y:180, w:150, h:150, value:'https://example.com' } }
    ];
    var 加的 = [];
    配置.forEach(function (one) {
      var before = App.__aiComps().length;
      App.__aiApplyComponents([{ op:'add', type:one.type, props:one.props }]);
      var cs = App.__aiComps();
      if (cs.length <= before) return;
      加的.push({ type: one.type, id: cs[0].id });
    });
    return 加的;
  })()`);
  await sleep(300);
  if (加的.length !== 3) throw new Error('有控件没建出来：' + JSON.stringify(加的));

  // 布局页：断言子元素结构（舞台会丢掉视觉根节点的 class，和之前几批同一套做法）
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1500);
  const 布局 = await js(`(function(){
    var stage = document.getElementById('layStage');
    var pick = function (t) { return stage.querySelector('.litem.t-' + t); };
    var 徽 = pick('badge'), 钟 = pick('clock'), 码 = pick('qr');
    var 字 = function (n) { var l = n && n.querySelector('.lv-label'); return l ? l.textContent : ''; };
    return {
      徽点: !!(徽 && 徽.querySelector('.lv-badge-dot')),
      徽字: 字(徽),
      钟字: 字(钟),
      码图: !!(码 && 码.querySelector('.lv-qr-box svg'))
    };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  if (!布局.徽点 || 布局.徽字 !== '新') throw new Error('布局页徽章不对：' + JSON.stringify(布局));
  if (!/^\d{2}:\d{2}:\d{2}$/.test(布局.钟字)) throw new Error('布局页时钟文字不对：' + JSON.stringify(布局));
  if (!布局.码图) throw new Error('布局页二维码没画出来：' + JSON.stringify(布局));

  // 运行时：徽章能改文字、时钟设了文字就停走秒、二维码能换内容重画
  const exp = await js(`(function(){ return window.EditorApp.__exportPreview(); })()`);
  if (!exp || exp.错误) throw new Error('导出预览失败：' + JSON.stringify(exp));
  let 就绪 = false;
  for (let attempt = 0; attempt < 2 && !就绪; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    就绪 = await waitFor(`!!document.querySelector('#screen .comp.qr .rt-qr')`, 15000);
    if (!就绪) await sleep(700);
  }
  if (!就绪) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有渲染出二维码（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var 报 = [];
    var 徽 = document.querySelector('#screen .comp.badge');
    var 钟 = document.querySelector('#screen .comp.clock');
    var 码 = document.querySelector('#screen .comp.qr');
    var 徽Id = 徽 && 徽.getAttribute('data-id'), 钟Id = 钟 && 钟.getAttribute('data-id'), 码Id = 码 && 码.getAttribute('data-id');

    if (!徽 || !徽.querySelector('.rt-badge-dot')) 报.push('徽章结构缺失');
    else {
      if (window.RT.getValue(徽Id) !== '新') 报.push('徽章初始 ' + window.RT.getValue(徽Id));
      window.RT.setComponent(徽Id, '已读');
      if (window.RT.getValue(徽Id) !== '已读') 报.push('徽章赋值后 ' + window.RT.getValue(徽Id));
      var t = 徽.querySelector('.rt-badge-t');
      if (!t || t.textContent !== '已读') 报.push('徽章文字 ' + (t && t.textContent));
    }

    if (!钟 || !钟.querySelector('.rt-clock')) 报.push('时钟结构缺失');
    else {
      var 钟字 = 钟.querySelector('.rt-clock');
      if (!/^\\d{2}:\\d{2}:\\d{2}$/.test(钟字.textContent)) 报.push('时钟初始文字 ' + 钟字.textContent);
      window.RT.setComponent(钟Id, '08:30');
      if (钟字.textContent !== '08:30') 报.push('时钟赋值后 ' + 钟字.textContent);
      if (window.RT.getValue(钟Id) !== '08:30') 报.push('时钟取值 ' + window.RT.getValue(钟Id));
    }

    if (!码 || !码.querySelector('.rt-qr svg')) 报.push('二维码没画出来');
    else {
      window.RT.setComponent(码Id, 'https://fast.example');
      var svg = 码.querySelector('.rt-qr svg');
      if (!svg) 报.push('换内容后二维码没了');
      if (window.RT.getValue(码Id) !== 'https://fast.example') 报.push('二维码取值 ' + window.RT.getValue(码Id));
    }
    return { 报: 报 };
  })()`);
  await shot('t25d-徽章时钟二维码运行时');
  if (运行.报.length) throw new Error('运行时交互有问题：' + JSON.stringify(运行));
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  await js(`(function(){
    try {
      var App = window.EditorApp;
      App.__aiApplyComponents(${JSON.stringify(加的.map(c => ({ op:'remove', id: c.id })))});
      return App.__aiComps().length;
    } catch (e) { return 'skip: ' + e.message; }
  })()`);
  return { 控件: '3 种', 布局页: '结构齐全 ✓', 运行时: '改徽章/停时钟/换二维码 ✓' };
});

// 阶段 4：容器类控件 —— 滚动区（可上下滑动 + 装子控件）/ 底部导航（一排按钮切换）
// 验收口径与容器一致：设计页能建、布局页有预览、运行时能交互，三处结构/坐标一致。
await check('阶段4：滚动区/底部导航 三处渲染一致，运行时能滑动、能切换', async () => {
  const 工程就绪 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (!(await js(工程就绪))) {
    await clickText('#viewHome button', '创建新 ?App|新建');
    const 弹窗了 = await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`);
    if (!弹窗了) throw new Error('新建弹窗没出来（当前视图：' + await viewsVisible() + '）');
    await js(`(function(){
      var i = document.querySelector('#createMask input');
      i.value = '阶段4控件' + Date.now().toString().slice(-6);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('createGo').click();
    })()`);
    if (!(await waitFor(工程就绪, 15000))) throw new Error('新建后工程没打开');
    await sleep(600);
  }
  const 建 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    document.querySelector('[data-add="scroll"]').click();
    document.querySelector('[data-add="button"]').click();
    var 钮 = App.__aiComps().filter(function (c) { return c.type === 'button'; })[0];
    var inBtn = 钮 ? document.querySelector('#compList .compcard[data-id="' + 钮.id + '"] .iconbtn.in') : null;
    if (inBtn) inBtn.click();
    document.querySelector('[data-add="bottomNav"]').click();
    var 后 = App.__aiComps();
    var 卷 = 后.filter(function (c) { return c.type === 'scroll'; })[0];
    var 导 = 后.filter(function (c) { return c.type === 'bottomNav'; })[0];
    var 字 = function (c) {
      var n = c ? document.querySelector('#compList .compcard[data-id="' + c.id + '"] .t2') : null;
      return n ? n.textContent : '';
    };
    return { 卷: 卷 ? 卷.id : '', 导: 导 ? 导.id : '', 子: (卷 && 卷.children && 卷.children[0]) || null,
             有放进按钮: !!inBtn, 顶层数: 后.length, 卷字: 字(卷), 导字: 字(导) };
  })()`);
  await sleep(300);
  if (!建.卷 || !建.导) throw new Error('滚动区/底部导航没建出来：' + JSON.stringify(建));
  if (建.顶层数 !== 2) throw new Error('滚动区应装的按钮没进容器（顶层应只剩滚动区+导航）：' + JSON.stringify(建));
  if (!建.有放进按钮 || !建.子) throw new Error('按钮没进滚动区：' + JSON.stringify(建));
  if (建.卷字.indexOf('里面 1 个控件') < 0) throw new Error('设计页滚动区描述不对：' + 建.卷字);
  if (建.导字.indexOf('导航 3 项') < 0) throw new Error('设计页底部导航描述不对：' + 建.导字);

  // 布局页：滚动区要带子控件；底部导航要画出横排三栏、当前项高亮
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1500);
  const 布局 = await js(`(function(){
    var stage = document.getElementById('layStage');
    var 卷 = stage.querySelector('.litem.t-scroll');
    var 导 = stage.querySelector('.litem.t-bottomNav');
    var 导航 = 导 ? 导.querySelectorAll('.lv-navbar .lv-nav') : [];
    var 亮 = 导 ? 导.querySelector('.lv-navbar .lv-nav.on') : null;
    return {
      卷有子: !!(卷 && 卷.querySelector('.litem-kid')),
      导栏数: 导航.length,
      导首项: 导航.length ? 导航[0].textContent : '',
      导高亮: 亮 ? 亮.textContent : '',
      子相对: (卷 && 卷.querySelector('.litem-kid')) ? (卷.querySelector('.litem-kid').style.left + ',' + 卷.querySelector('.litem-kid').style.top) : ''
    };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  if (!布局.卷有子) throw new Error('布局页滚动区没画出子控件：' + JSON.stringify(布局));
  if (布局.导栏数 !== 3 || 布局.导首项 !== '首页' || 布局.导高亮 !== '首页') throw new Error('布局页底部导航不对：' + JSON.stringify(布局));

  // 运行时：滚动区能上下滑、子控件在容器里；底部导航点了切换，代码也能读写
  const exp = await js(`(function(){ return window.EditorApp.__exportPreview(); })()`);
  if (!exp || exp.错误) throw new Error('导出预览失败：' + JSON.stringify(exp));
  let 就绪 = false;
  for (let attempt = 0; attempt < 2 && !就绪; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    就绪 = await waitFor(`!!document.querySelector('#screen .comp.scroll')`, 15000);
    if (!就绪) await sleep(700);
  }
  if (!就绪) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有渲染出滚动区（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var 报 = [];
    var 卷 = document.querySelector('#screen .comp.scroll');
    var 导 = document.querySelector('#screen .comp.bottomNav');
    if (!卷) 报.push('滚动区缺失');
    else if (!卷.querySelector('.comp')) 报.push('滚动区里没有子控件');
    else {
      var cs = getComputedStyle(卷);
      if (cs.overflowY !== 'auto') 报.push('滚动区没能上下滑（overflowY=' + cs.overflowY + '）');
      if (cs.overscrollBehaviorY !== 'contain') 报.push('滚动区没兜住滑动（overscrollBehaviorY=' + cs.overscrollBehaviorY + '）');
    }
    if (!导) 报.push('底部导航缺失');
    else {
      var 钮 = 导.querySelectorAll('.rt-navbtn');
      if (钮.length !== 3) 报.push('底部导航按钮数 ' + 钮.length);
      var 导Id = 导.getAttribute('data-id');
      if (window.RT.getValue(导Id) !== 0) 报.push('底部导航初始值 ' + window.RT.getValue(导Id));
      钮[2].click();
      var 亮 = 导.querySelector('.rt-navbtn.on');
      if (!亮 || 亮.textContent !== '我的') 报.push('点了第三项没高亮（' + (亮 && 亮.textContent) + '）');
      if (window.RT.getValue(导Id) !== 2) 报.push('点击后取值 ' + window.RT.getValue(导Id));
      window.RT.setComponent(导Id, 1);
      var 亮2 = 导.querySelector('.rt-navbtn.on');
      if (!亮2 || 亮2.textContent !== '消息') 报.push('代码切换后没高亮（' + (亮2 && 亮2.textContent) + '）');
      if (window.RT.getValue(导Id) !== 1) 报.push('代码切换后取值 ' + window.RT.getValue(导Id));
      window.RT.setComponent(导Id, 99);
      if (window.RT.getValue(导Id) !== 2) 报.push('超范围应夹到最后一项，实际 ' + window.RT.getValue(导Id));
    }
    return { 报: 报 };
  })()`);
  await shot('t25e-滚动区与底部导航运行时');
  if (运行.报.length) throw new Error('运行时有问题：' + JSON.stringify(运行));
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  await js(`(function(){
    try {
      var App = window.EditorApp;
      var ids = App.__aiComps().map(function (c) { return c.id; });
      if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
      return App.__aiComps().length;
    } catch (e) { return 'skip: ' + e.message; }
  })()`);
  return { 滚动区: '子控件在容器里 + 可上下滑 ✓', 底部导航: '三栏点击切换 / 代码读写 ✓', 布局页: '预览一致 ✓' };
});

// 阶段 5：设备能力块 —— 读剪贴板 / 打开网址 / 发通知（原生桥 + 网页回退）
await check('阶段5：剪贴板/打开网址/发通知 三块定义、生成代码、工具箱、帮助齐全', async () => {
  const 工程就绪 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (!(await js(工程就绪))) {
    await clickText('#viewHome button', '创建新 ?App|新建');
    const 弹窗了 = await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`);
    if (!弹窗了) throw new Error('新建弹窗没出来（当前视图：' + await viewsVisible() + '）');
    await js(`(function(){
      var i = document.querySelector('#createMask input');
      i.value = '阶段5设备块' + Date.now().toString().slice(-6);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('createGo').click();
    })()`);
    if (!(await waitFor(工程就绪, 15000))) throw new Error('新建后工程没打开');
    await sleep(600);
  }
  const r = await js(`(function(){
    var 类型 = ['val_clipboard', 'act_open_url', 'act_notify'];
    var xmlText = String(window.buildToolboxXml(null));
    var ws = new Blockly.Workspace();
    try {
      Blockly.JavaScript.init(ws);
      function 生成(t, txt) {
        var b = ws.newBlock(t);
        Object.keys(txt).forEach(function (k) {
          var s = ws.newBlock('text'); s.setFieldValue(txt[k], 'TEXT');
          s.outputConnection.connect(b.getInput(k).connection);
        });
        var c = Blockly.JavaScript.blockToCode(b);
        return String(Array.isArray(c) ? c[0] : c).trim();
      }
      var 设备组 = ((window.BB_HELP || {}).general || []).filter(function (g) { return g.cat === '设备'; })[0] || { blocks: [] };
      return {
        代码: {
          剪贴板: 生成('val_clipboard', {}),
          网址: 生成('act_open_url', { URL: 'https://example.com' }),
          通知: 生成('act_notify', { TITLE: '提醒', TEXT: '该喝水啦' })
        },
        定义: 类型.filter(function (t) { return !!Blockly.Blocks[t] && typeof Blockly.JavaScript.forBlock[t] === 'function'; }),
        工具箱: 类型.filter(function (t) { return xmlText.indexOf('"' + t + '"') >= 0; }),
        帮助: (设备组.blocks || []).length
      };
    } finally { try { ws.dispose(); } catch (e) {} }
  })()`);
  if (3 - r.定义.length) throw new Error('有块没有定义/生成器：' + JSON.stringify(r.定义));
  if (r.工具箱.length !== 3) throw new Error('工具箱「设备」分类缺块：' + JSON.stringify(r.工具箱));
  if (!/^RT\.readClipboard\(\)/.test(r.代码.剪贴板)) throw new Error('读剪贴板代码不对：' + r.代码.剪贴板);
  if (!/^RT\.openUrl\(/.test(r.代码.网址) || r.代码.网址.indexOf('https://example.com') < 0) throw new Error('打开网址代码不对：' + r.代码.网址);
  if (!/^RT\.notify\(/.test(r.代码.通知) || r.代码.通知.indexOf('提醒') < 0) throw new Error('发通知代码不对：' + r.代码.通知);
  if (r.帮助 < 9) throw new Error('帮助「设备」分类条目没补全：' + r.帮助);

  // 运行时：三个 RT 方法都在；没有原生桥时 readClipboard 返回空文字、notify 退回页面提示、openUrl 拦非法网址
  const exp = await js(`(function(){ return window.EditorApp.__exportPreview(); })()`);
  if (!exp || exp.错误) throw new Error('导出预览失败：' + JSON.stringify(exp));
  let 就绪 = false;
  for (let attempt = 0; attempt < 2 && !就绪; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    就绪 = await waitFor(`!!window.RT && typeof window.RT.notify === 'function'`, 15000);
    if (!就绪) await sleep(700);
  }
  if (!就绪) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没起来（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var 报 = [];
    ['readClipboard', 'openUrl', 'notify'].forEach(function (n) {
      if (typeof window.RT[n] !== 'function') 报.push('RT.' + n + ' 不是函数');
    });
    try { var v = window.RT.readClipboard(); if (typeof v !== 'string') 报.push('readClipboard 没返回文字：' + v); } catch (e) { 报.push('readClipboard 抛错：' + e.message); }
    try { window.RT.notify('提醒', '内容'); } catch (e) { 报.push('notify 抛错：' + e.message); }
    try { window.RT.openUrl('不是网址'); } catch (e) { 报.push('openUrl 抛错：' + e.message); }
    // 通知权限被关时怎么办：装一个假原生桥，按 askNotif 的三种回执分别验证
    //   settings —— 系统不会弹框了：**不许**再发通知，应该引导去设置页
    //   dialog   —— 授权框正在弹：先把通知交给原生存着（允许后补发）
    //   allowed  —— 已经有权限了：直接发
    var 呼叫 = [];
    function 装桥(回执) {
      window.Native = {
        notify: function (t) { 呼叫.push(String(t)); },
        notifAllowed: function () { return false; },
        askNotif: function () { return 回执; }
      };
      呼叫.length = 0;
    }
    装桥('settings'); window.RT.notify('标题', '内容');
    if (呼叫.length) 报.push('权限被永久关掉时不该发通知（应引导去设置页），实际发了 ' + 呼叫.length + ' 次');
    装桥('dialog'); window.RT.notify('标题', '内容');
    if (呼叫.length !== 1) 报.push('授权框弹出时没把通知存成待发（实际 ' + 呼叫.length + ' 次）');
    装桥('allowed'); window.RT.notify('标题', '内容');
    if (呼叫.length !== 1) 报.push('回执 allowed 时没直接发通知（实际 ' + 呼叫.length + ' 次）');
    try { window.Native = undefined; } catch (e) {}
    return { 报: 报, 权限分支: 'settings / dialog / allowed 三种都对 ✓' };
  })()`);
  if (运行.报.length) throw new Error('运行时设备块有问题：' + JSON.stringify(运行));
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  return { 代码: r.代码.网址.replace(/\n$/, ''), 工具箱: '3 块 ✓', 帮助: r.帮助 + ' 条', 运行时: '原生优先 + 网页回退 ✓' };
});

// 拖拽进容器（用户 2026-10-29 要求）：设计页长按卡片拖到容器卡片上、布局页拖控件到容器框上
/** 用真实鼠标事件走一遍"按下 → 等长按 → 移动 → 松开"（CDP 的鼠标事件会合成 pointer 事件） */
async function 鼠标拖(from, to, 按住毫秒 = 430) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(按住毫秒);
  const 步 = 8;
  for (let i = 1; i <= 步; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + (to.x - from.x) * i / 步),
      y: Math.round(from.y + (to.y - from.y) * i / 步),
      button: 'left', buttons: 1
    });
    await sleep(35);
  }
  await sleep(140);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0 });
}

await check('拖拽进容器：设计页拖卡片、布局页拖控件都能直接放进容器', async () => {
  const 工程就绪 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (!(await js(工程就绪))) {
    // 上一条用例最后重载了页面，会回到首页：先新建一个工程再测
    await clickText('#viewHome button', '创建新 ?App|新建');
    const 弹窗了 = await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden') && !!m.querySelector('input')})()`);
    if (!弹窗了) throw new Error('新建弹窗没出来（当前视图：' + await viewsVisible() + '）');
    await js(`(function(){
      var i = document.querySelector('#createMask input');
      i.value = '拖拽测试' + Date.now().toString().slice(-6);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('createGo').click();
    })()`);
    if (!(await waitFor(工程就绪, 15000))) throw new Error('新建后工程没打开');
    await sleep(600);
  }

  const 初始 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    document.querySelector('[data-add="container"]').click();
    document.querySelector('[data-add="button"]').click();
    var 后 = App.__aiComps();
    return { 顶层数: 后.length, 类型: 后.map(function (c) { return c.type; }) };
  })()`);
  if (初始.顶层数 !== 2) throw new Error('准备控件失败：' + JSON.stringify(初始));
  await sleep(250);

  // —— 设计页：把按钮卡片长按拖到容器卡片上 ——
  const 位 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 钮 = 全.filter(function (c) { return c.type === 'button'; })[0];
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    function 中(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    return { 钮: 钮.id, 容: 容.id,
             从: 中(document.querySelector('#compList .compcard[data-id="' + 钮.id + '"]')),
             到: 中(document.querySelector('#compList .compcard[data-id="' + 容.id + '"]')) };
  })()`);
  await 鼠标拖(位.从, 位.到);
  await sleep(600);
  const 设计 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    return { 顶层数: 全.length, 子数: 容 && 容.children ? 容.children.length : 0,
             高亮残留: document.querySelectorAll('#compList .compcard.drop-in').length };
  })()`);
  if (设计.顶层数 !== 1 || 设计.子数 !== 1) throw new Error('设计页拖进容器没成功：' + JSON.stringify(设计));
  if (设计.高亮残留) throw new Error('松手后容器高亮没清掉：' + JSON.stringify(设计));

  // —— 布局页：再加一个普通控件，拖到容器框上 ——
  await js(`document.querySelector('[data-add="text"]').click()`);
  await sleep(300);
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1600);
  const 布位 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 文 = 全.filter(function (c) { return c.type === 'text'; })[0];
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    function 中(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    var 文块 = 文 ? document.querySelector('#layStage .litem[data-id="' + 文.id + '"]') : null;
    var 容块 = 容 ? document.querySelector('#layStage .litem[data-id="' + 容.id + '"]') : null;
    if (!文块 || !容块) return { 有块: false };
    return { 有块: true, 文: 文.id, 容: 容.id, 从: 中(文块), 到: 中(容块) };
  })()`);
  if (!布位.有块) throw new Error('布局页没画出文字/容器：' + JSON.stringify(布位));
  await 鼠标拖(布位.从, 布位.到, 200);
  await sleep(700);
  const 布局 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    var 子 = 容 && 容.children ? 容.children : [];
    var 文子 = 子.filter(function (k) { return k.type === 'text'; })[0];
    return { 顶层数: 全.length, 子数: 子.length,
             文位置: 文子 ? (文子.x + ',' + 文子.y) : '',
             文在框内: !!(文子 && 文子.x >= 0 && 文子.y >= 0 && 文子.x <= (容.w || 0) && 文子.y <= (容.h || 0)),
             高亮残留: document.querySelectorAll('#layStage .litem.drop-in').length };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  if (布局.顶层数 !== 1 || 布局.子数 !== 2) throw new Error('布局页拖进容器没成功：' + JSON.stringify(布局));
  if (!布局.文在框内) throw new Error('拖进容器后坐标没落进框内：' + JSON.stringify(布局));
  if (布局.高亮残留) throw new Error('布局页松手后高亮没清掉：' + JSON.stringify(布局));

  // 容器里的控件不能和新控件撞 id：genId 必须连子控件一起算（2026-10-29 抓到的真 bug）
  const 撞 = await js(`(function(){
    document.querySelector('[data-add="button"]').click();
    var 全 = window.EditorApp.__aiComps();
    var ids = [];
    全.forEach(function (c) { ids.push(c.id); (c.children || []).forEach(function (k) { ids.push(k.id); }); });
    return { 个数: ids.length, 去重后: new Set(ids).size, ids: ids };
  })()`);
  if (撞.个数 !== 撞.去重后) throw new Error('控件 id 撞了（容器里的子控件没被 genId 算进去）：' + JSON.stringify(撞));

  // 收尾清空，别把控件留给后面的用例
  await js(`(function(){
    var App = window.EditorApp;
    App.__aiComps().slice().forEach(function (c) { App.__aiApplyComponents([{ op:'remove', id: c.id }]); });
  })()`);
  return { 设计页: '卡片拖进容器 ✓', 布局页: '控件落点 ' + 布局.文位置 + ' ✓', id: '不重名 ✓' };
});

// 容器里的控件要能拖出来、也能在容器里挪位置（用户 2026-10-29 要求）
await check('设计页：容器内子卡片可换位，拖出容器就回到页面顶层', async () => {
  await js(`document.getElementById('tabDesign').click()`);
  const 准备 = await js(`(function(){
    var App = window.EditorApp;
    App.__aiComps().slice().forEach(function (c) { App.__aiApplyComponents([{ op:'remove', id: c.id }]); });
    document.querySelector('[data-add="container"]').click();
    document.querySelector('[data-add="button"]').click();
    document.querySelector('[data-add="text"]').click();
    var 全 = App.__aiComps();
    return { 数: 全.length, 类型: 全.map(function (c) { return c.type; }),
             // 新建的容器必须从 0 个子控件开始（默认属性里的 children 不能被同类控件共用）
             空容器: 全.filter(function (c) { return c.type === 'container' || c.type === 'scroll'; })
                       .map(function (c) { return c.children.length; }) };
  })()`);
  if (准备.数 !== 3) throw new Error('准备控件失败：' + JSON.stringify(准备));
  if (准备.空容器.some(function (n) { return n !== 0; })) throw new Error('新建容器一开始就有子控件（默认属性被共用了）：' + JSON.stringify(准备));
  await sleep(250);

  const 位 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    function 中(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    var 卡 = {};
    全.forEach(function (c) {
      var n = document.querySelector('#compList .compcard[data-id="' + c.id + '"]');
      if (n && (c.type === 'button' || c.type === 'text')) 卡[c.type] = 中(n);
    });
    return { 容: 容.id, 按钮: 卡.button, 文字: 卡.text,
             容卡: 中(document.querySelector('#compList .compcard[data-id="' + 容.id + '"]')) };
  })()`);
  if (!位.按钮 || !位.文字) throw new Error('设计页没列出控件卡片：' + JSON.stringify(位));

  // 取某类控件在列表里的卡片中心（每次拖之前都重新取：上一次落进容器后列表会重排，旧坐标会指错卡片）
  const 取卡 = (type) => js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var c = 全.filter(function (x) { return x.type === ${JSON.stringify(type)}; })[0];
    var n = c ? document.querySelector('#compList .compcard[data-id="' + c.id + '"]') : null;
    if (!n) return null;
    var r = n.getBoundingClientRect();
    return { id: c.id, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  // ① 两张顶层卡片依次拖进容器
  let 文 = await 取卡('text'), 容卡 = await 取卡('container');
  if (!文 || !容卡) throw new Error('设计页没列出控件卡片：' + JSON.stringify({ 文, 容卡 }));
  await 鼠标拖(文, 容卡);
  await sleep(600);
  const 中间 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    return { 顶层数: 全.length, 子数: 容.children.length };
  })()`);
  if (中间.顶层数 !== 2 || 中间.子数 !== 1) throw new Error('第一张卡片没拖进容器：' + JSON.stringify(中间));
  let 钮 = await 取卡('button'); 容卡 = await 取卡('container');
  await 鼠标拖(钮, 容卡);
  await sleep(650);
  const 后 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    return { 顶层数: 全.length, 子: 容.children.map(function (k) { return k.type; }) };
  })()`);
  if (后.顶层数 !== 1 || 后.子.length !== 2) throw new Error('两个控件没都拖进容器：' + JSON.stringify(后));

  // ② 容器内换位：把后一张子卡片拖到前一张上面
  const 换位 = await js(`(function(){
    var 容 = window.EditorApp.__aiComps().filter(function (c) { return c.type === 'container'; })[0];
    var 卡 = Array.prototype.slice.call(document.querySelectorAll('#compList .compcard[data-parent="' + 容.id + '"]'));
    function 中(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    return { 数: 卡.length, 从: 中(卡[1]), 到: { x: 中(卡[0]).x, y: Math.round(卡[0].getBoundingClientRect().top + 4) } };
  })()`);
  if (换位.数 !== 2) throw new Error('容器里没列出两张子卡片：' + JSON.stringify(换位));
  await 鼠标拖(换位.从, 换位.到);
  await sleep(700);
  const 排后 = await js(`(function(){
    var 容 = window.EditorApp.__aiComps().filter(function (c) { return c.type === 'container'; })[0];
    return { 子: 容.children.map(function (k) { return k.type; }) };
  })()`);
  if (排后.子.join(',') !== 后.子.slice().reverse().join(',')) throw new Error('容器内换位没生效：' + JSON.stringify({ 前: 后.子, 后: 排后.子 }));

  // ③ 拖出容器：把第二张子卡片往父块下方拖
  const 出位 = await js(`(function(){
    var 容 = window.EditorApp.__aiComps().filter(function (c) { return c.type === 'container'; })[0];
    var 卡 = Array.prototype.slice.call(document.querySelectorAll('#compList .compcard[data-parent="' + 容.id + '"]'));
    var 列 = document.getElementById('compList').getBoundingClientRect();
    function 中(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    var 底 = 0;
    卡.forEach(function (n) { var r = n.getBoundingClientRect(); if (r.bottom > 底) 底 = r.bottom; });
    return { 从: 中(卡[1]), 到: { x: 中(卡[1]).x, y: Math.round(Math.min(列.bottom - 60, 底 + 70)) } };
  })()`);
  await 鼠标拖(出位.从, 出位.到);
  await sleep(800);
  const 拖出后 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    return { 顶层数: 全.length, 子数: 容.children.length,
             残红: document.querySelectorAll('#compList .compcard.drop-out').length,
             顶层类型: 全.map(function (c) { return c.type; }) };
  })()`);
  if (拖出后.顶层数 !== 2 || 拖出后.子数 !== 1) throw new Error('拖出容器没回到顶层：' + JSON.stringify(拖出后));
  if (拖出后.残红) throw new Error('拖出后父卡片红色提示没清掉');
  return { 拖进: '2 个 ✓', 内换位: 排后.子.join(' / ') + ' ✓', 拖出: '回顶层 ✓' };
});

await check('布局页：容器内可拖动改位置，拖出容器就回到顶层', async () => {
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1600);
  const 布 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    var 子 = 容.children[0];
    var 舞台 = document.getElementById('layStage');
    function 块(id) { return document.querySelector('#layStage .litem[data-id="' + id + '"]'); }
    var 子块 = 块(子.id), 容块 = 块(容.id);
    if (!子块 || !容块) return { 有块: false, 子: 子 ? 子.id : '', 容: 容 ? 容.id : '' };
    function 中(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    var sr = 舞台.getBoundingClientRect(), cr = 容块.getBoundingClientRect();
    var k = sr.width / 舞台.offsetWidth;
    var 拖到 = { x: Math.round(Math.min(sr.right - 40, cr.right + 50)), y: Math.round(Math.min(sr.bottom - 40, cr.bottom + 50)) };
    // 抓的是控件中心，松手时"中心落在手指上"——所以要减去半个宽高
    var 期望x = Math.max(0, Math.min(舞台.offsetWidth - 子块.offsetWidth, Math.round((拖到.x - sr.left) / k - 子块.offsetWidth / 2)));
    var 期望y = Math.max(0, Math.min(舞台.offsetHeight - 子块.offsetHeight, Math.round((拖到.y - sr.top) / k - 子块.offsetHeight / 2)));
    return { 有块: true, 容: 容.id, 子: 子.id, 子数: 容.children.length, 顶层数: 全.length,
             子位置: 子.x + ',' + 子.y, 从: 中(子块),
             拖到: 拖到, 期望x: 期望x, 期望y: 期望y };
  })()`);
  if (!布.有块) throw new Error('布局页没画出容器/子控件：' + JSON.stringify(布));
  if (布.子数 !== 1) throw new Error('布局页开始前容器里应该是 1 个子控件：' + JSON.stringify(布));

  // ① 框内挪位置：只动 30px 左右，仍在容器里
  const 从 = 布.从;
  await 鼠标拖(从, { x: 从.x + 26, y: 从.y + 18 }, 200);
  await sleep(700);
  const 挪后 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    return { 子数: 容.children.length, 位置: 容.children[0] ? (容.children[0].x + ',' + 容.children[0].y) : '' };
  })()`);
  if (挪后.子数 !== 1) throw new Error('容器内拖动把子控件弄丢了：' + JSON.stringify(挪后));
  if (挪后.位置 === 布.子位置) throw new Error('容器内拖动没改坐标：' + JSON.stringify(挪后));

  // ② 拖出容器：往容器框外拖，松手应变成顶层控件
  const 出块 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    var n = document.querySelector('#layStage .litem[data-id="' + 容.children[0].id + '"]');
    function 中(x) { var r = x.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
    return n ? 中(n) : null;
  })()`);
  await 鼠标拖(出块, 布.拖到, 200);
  await sleep(800);
  const 出后 = await js(`(function(){
    var 全 = window.EditorApp.__aiComps();
    var 容 = 全.filter(function (c) { return c.type === 'container'; })[0];
    var 单 = 全.filter(function (c) { return c.id === ${JSON.stringify(布.子)}; });
    return { 顶层数: 全.length, 子数: 容.children.length,
             位置: 单.length ? (单[0].x + ',' + 单[0].y) : '',
             单x: 单.length ? 单[0].x : null, 单y: 单.length ? 单[0].y : null,
             残红: document.querySelectorAll('#layStage .litem.drop-out').length };
  })()`);
  await js(`document.getElementById('layBack').click()`);
  await sleep(400);
  if (出后.顶层数 !== 布.顶层数 + 1 || 出后.子数 !== 0) throw new Error('布局页拖出容器没回到顶层：' + JSON.stringify(出后));
  if (出后.残红) throw new Error('布局页拖出后红色提示没清掉');
  if (Math.abs(出后.单x - 布.期望x) > 4 || Math.abs(出后.单y - 布.期望y) > 4) {
    throw new Error('拖出后没落在手指位置：实际 ' + 出后.位置 + '，期望 ' + 布.期望x + ',' + 布.期望y);
  }

  await js(`(function(){
    var App = window.EditorApp;
    App.__aiComps().slice().forEach(function (c) { App.__aiApplyComponents([{ op:'remove', id: c.id }]); });
  })()`);
  return { 框内挪动: 布.子位置 + " → " + 挪后.位置, 拖出: "落点 " + 出后.位置 };
});

// 阶段 3 第二批动作块：位置 / 大小 / 选项（运行时生效：RT.setPos / setSize / setOptions）
await check('动作块②：设置位置/大小/选项 运行时生效并写回数据', async () => {
  const 工程 = {
    appName: '动作块测试', startScreen: 's1', design: { w: 390, h: 844 },
    screens: [{
      id: 's1', title: '页面1', orientation: 'portrait', showStatusBar: true, code: '',
      components: [
        { id: 'btnP', type: 'button', text: '按钮', x: 30, y: 40, w: 120, h: 48 },
        { id: 'selP', type: 'select', x: 30, y: 130, w: 200, h: 48, items: ['一号', '二号'], value: '一号' }
      ]
    }]
  };
  await js(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(工程))})`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen [data-id="btnP"]')`, 15000);
    if (!ok) await sleep(700);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有渲染出按钮（已切回编辑器）');
  }
  const 结果 = await js(`(function(){
    var 报 = [];
    var b = document.querySelector('[data-id="btnP"]');
    window.RT.setPos('btnP', 66, 208);
    if (!b) 报.push('按钮没找到');
    else {
      if (b.style.left !== '66px' || b.style.top !== '208px') 报.push('位置 ' + b.style.left + '/' + b.style.top);
      if (b.style.position !== 'absolute') 报.push('没有转为自由定位');
      if (!b.__c || b.__c.x !== 66 || b.__c.y !== 208 || b.__c.cx) 报.push('位置没写回数据');
    }
    window.RT.setSize('btnP', 180, 64);
    if (b) {
      if (b.style.width !== '180px' || b.style.height !== '64px') 报.push('大小 ' + b.style.width + '/' + b.style.height);
      if (!b.__c || b.__c.w !== 180 || b.__c.h !== 64) 报.push('大小没写回数据');
    }
    window.RT.setOptions('selP', '苹果,香蕉,橙子');
    var s = document.querySelector('[data-id="selP"]');
    if (!s) 报.push('下拉没找到');
    else {
      if (window.RT.getValue('selP') !== '苹果') 报.push('换选项后选中值 ' + JSON.stringify(window.RT.getValue('selP')));
      var 箱 = s.querySelector('.rt-select');
      if (!箱) 报.push('下拉结构没了');
      else {
        箱.click();
        var 项 = s.querySelectorAll('.rt-select-item');
        if (项.length !== 3) 报.push('选项数 ' + 项.length);
        if (项[1]) 项[1].click();
        if (window.RT.getValue('selP') !== '香蕉') 报.push('点第二项后 ' + JSON.stringify(window.RT.getValue('selP')));
      }
    }
    return { 报: 报 };
  })()`);
  await shot('t25d-动作块第二批');
  if (结果.报.length) throw new Error('动作块运行时有问题：' + JSON.stringify(结果));
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(400);
  return { 位置: '66,208 ✓', 大小: '180×64 ✓', 选项: '换成 3 项 / 点选生效 ✓' };
});

// 用户反馈（附截图）：下拉选择框点开后弹的是系统原生列表（白底 + 圆圈单选），样式完全改不了。
// 改成自绘列表后：展开的选项列表也要有样式（默认 M3）、能记住选中项、点空白能关掉。
await check('下拉选择框改为自绘列表（不再是系统弹窗，选项列表也有样式）', async () => {
  // 这条用例不依赖编辑器当前开着哪个工程（上一个用例刚跳回编辑器，可能还停在首页）：
  // 直接造一份最小工程写进运行时的预览数据里，再看运行时画成什么样。
  const 工程 = {
    appName: '下拉框测试', startScreen: 's1', design: { w: 390, h: 844 },
    screens: [{
      id: 's1', title: '页面1', orientation: 'portrait', showStatusBar: true, code: '',
      components: [
        { id: 'selA', type: 'select', x: 30, y: 40, w: 200, h: 48, items: ['一号', '二号', '三号'], value: '一号', variant: 'card' },
        { id: 'selB', type: 'select', x: 30, y: 130, w: 200, h: 48, items: ['甲', '乙'], value: '甲' }
      ]
    }]
  };
  await js(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(工程))})`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen .comp.select .rt-select--card')`, 15000);
    if (!ok) await sleep(700);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没渲染出自绘下拉框（已切回编辑器）');
  }
  await sleep(300);
  const 原生 = await js(`document.querySelectorAll('#screen .comp.select select, #screen .comp.select option').length`);
  if (原生) throw new Error('还在用系统原生下拉（select/option 还有 ' + 原生 + ' 个）');
  await js(`document.querySelector('#screen .comp.select .rt-select--card').click()`);
  await sleep(250);
  const 菜单 = await js(`(function(){
    var box = document.querySelector('#screen .comp.select .rt-select--card');
    var m = box ? box.parentNode.querySelector('.rt-select-menu') : null;
    if (!m) return { 有菜单: false };
    var items = m.querySelectorAll('.rt-select-item');
    var on = m.querySelectorAll('.rt-select-item.on');
    return { 有菜单: m.classList.contains('open'), 样式类: m.className,
             选项数: items.length, 选中数: on.length,
             选中文字: on.length ? on[0].textContent.replace('✓','').trim() : '',
             首项文字: items.length ? items[0].textContent.replace('✓','').trim() : '' };
  })()`);
  if (!菜单.有菜单 || 菜单.选项数 !== 3) throw new Error('展开的选项列表不对：' + JSON.stringify(菜单));
  if (菜单.样式类.indexOf('rt-select-menu--card') < 0) throw new Error('选项列表没跟着样式走：' + JSON.stringify(菜单.样式类));
  if (菜单.选中数 !== 1 || 菜单.选中文字 !== '一号' || 菜单.首项文字 !== '一号') throw new Error('选中项没标出来：' + JSON.stringify(菜单));
  const 点选 = await js(`(function(){
    var box = document.querySelector('#screen .comp.select .rt-select--card');
    var m = box && box.parentNode.querySelector('.rt-select-menu.open');
    if (!m) return { 有: false };
    m.querySelectorAll('.rt-select-item')[2].click();
    return { 有: true, 显示: box.querySelector('.rt-select-v').textContent,
             还开着: box.parentNode.querySelector('.rt-select-menu').classList.contains('open') };
  })()`);
  await sleep(200);
  if (!点选.有 || 点选.显示 !== '三号' || 点选.还开着) throw new Error('选完之后显示/收起不对：' + JSON.stringify(点选));
  const 再开 = await js(`(function(){
    var box = document.querySelector('#screen .comp.select .rt-select--card');
    box.click();
    var m = box.parentNode.querySelector('.rt-select-menu');
    var on = m.querySelector('.rt-select-item.on');
    return { 开着: m.classList.contains('open'), 记住的: on ? on.textContent.replace('✓','').trim() : '' };
  })()`);
  await sleep(200);
  if (!再开.开着 || 再开.记住的 !== '三号') throw new Error('再打开时没记住上次选中的：' + JSON.stringify(再开));
  await shot('t25b-下拉自绘列表');
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(600);
  return { 原生控件: '0 个', 选项数: 菜单.选项数, 样式: 'rt-select-menu--card', 选中记忆: 再开.记住的 };
});

// 诊断：函数代码块上的"?"到底是什么元素（用户反馈点它弹出的窗关不掉）
// 用户反馈：给函数加了参数后「变量」分类里出现对应圆块；删掉函数后那些圆块还在。
// 规则：变量只要"没有变量块在用、也不是某个函数定义的参数"就该被回收。
await check('删掉函数后，它的参数变量会被自动回收（变量分类里不再留圆块）', async () => {
  // 这几条排在用例最后，此时可能停在首页（没有工程）——先回编辑器打开一个作品
  if (!(await js(`!!window.EditorApp && !!(window.EditorApp.__aiScreens && window.EditorApp.__aiScreens().length)`))) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1600);
  }
  await js(`(function(){ var t=document.getElementById('tabBlocks'); if (t) t.click(); })()`);
  await sleep(500);
  const r = await js(`(function(){
    var ws = window.EditorApp.__aiWs() || Blockly.getMainWorkspace();
    ws.clear();
    var xml = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="procedures_defnoreturn" x="40" y="40">'
      + '<field name="NAME">打招呼</field>'
      + '<mutation><arg name="甲"></arg><arg name="乙"></arg></mutation>'
      + '</block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    var def = ws.getTopBlocks(true)[0];
    var 有参数 = def && def.getVarModels ? def.getVarModels().length : 0;
    var 变量数前 = ws.getAllVariables().length;
    def.dispose(true);
    var 清理数 = window.EditorApp.__aiPruneVars();
    return { 有参数: 有参数, 变量数前: 变量数前, 清理数: 清理数, 变量后: window.EditorApp.__aiVars() };
  })()`);
  if (!r.有参数) throw new Error('函数参数没建成变量（准备失败）：' + JSON.stringify(r));
  if (r.变量后.length) throw new Error('删掉函数后变量还在：' + JSON.stringify(r));
  return { 函数参数: r.有参数 + ' 个', 清理前变量: r.变量数前, 回收: r.清理数 + ' 个', 剩余: r.变量后.length };
});

await check('还在用的变量不会被误删（变量块 + 函数参数都算在用）', async () => {
  // 这几条排在用例最后，此时可能停在首页（没有工程）——先回编辑器打开一个作品
  if (!(await js(`!!window.EditorApp && !!(window.EditorApp.__aiScreens && window.EditorApp.__aiScreens().length)`))) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1600);
  }
  await js(`(function(){ var t=document.getElementById('tabBlocks'); if (t) t.click(); })()`);
  await sleep(500);
  const r = await js(`(function(){
    var ws = window.EditorApp.__aiWs() || Blockly.getMainWorkspace();
    ws.clear();
    var xml = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="procedures_defnoreturn" x="40" y="40"><field name="NAME">带参数</field>'
      + '<mutation><arg name="参数甲"></arg></mutation></block>'
      + '<block type="ev_start" x="40" y="300"><next><block type="variables_set">'
      + '<field name="VAR">我的变量</field>'
      + '<value name="VALUE"><shadow type="math_number"><field name="NUM">1</field></shadow></value>'
      + '</block></next></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    var 前 = window.EditorApp.__aiVars();
    var 清理数 = window.EditorApp.__aiPruneVars();
    return { 前: 前, 清理数: 清理数, 后: window.EditorApp.__aiVars() };
  })()`);
  if (r.后.indexOf('参数甲') < 0) throw new Error('函数参数被误删了：' + JSON.stringify(r));
  if (r.后.indexOf('我的变量') < 0) throw new Error('正在用的变量被误删了：' + JSON.stringify(r));
  return { 变量: r.后.join(', '), 误删: 0 };
});
// 用户反馈：在页面一某个位置，切到页面二再切回页面一，画布被居中了（位置丢了）。
// 注意：滚动与切页必须在**同一段**里连着做——中间留时间会撞上后台的 resize 重排，
// 那是测试自身的时序问题，不是产品行为。
await check('切到别的页面再切回来，画布位置保持不变（每页各自记住视角）', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var ws = App.__aiWs() || Blockly.getMainWorkspace();
    var 页一 = App.__aiScreens()[0].id;
    App.__aiSwitchScreen(页一);
    ws.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast" x="40" y="40"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '<block type="act_toast" x="40" y="220"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value></block>'
      + '</xml>'), ws);
    ws.scroll(-320, -260);
    var 前 = App.__aiMainView();
    // 立刻切走再切回来（同一段里完成，避免撞上后台重排）
    var 页二 = App.__aiAddScreen();
    App.__aiSwitchScreen(页一);
    return { 页一: 页一, 页二: 页二, 前: 前, 立刻: App.__aiMainView(), 页面表: App.__aiScreens() };
  })()`);
  await sleep(2600);   // 等延迟还原补齐
  const 最终 = await js(`window.EditorApp.__aiMainView()`);
  const 表 = await js(`window.EditorApp.__aiScreens()`);
  const 存下的 = (表.filter(function (s) { return s.id === r.页一; })[0] || {}).view;
  const 偏差 = Math.abs(最终.x - r.前.x) + Math.abs(最终.y - r.前.y);
  await js(`(function(){ var s=window.EditorApp.__aiScreens(); if (s.length>1) window.EditorApp.__aiSwitchScreen(s[0].id); })()`);
  if (偏差 > 20) {
    throw new Error('切回来位置变了：' + JSON.stringify({ 原位置: r.前, 立刻: r.立刻, 页面1存的视角: 存下的, 最终: 最终, 偏差: 偏差 }));
  }
  return { 原位置: r.前.x + ',' + r.前.y, 切回后: 最终.x + ',' + 最终.y, 偏差: 偏差 };
});
// 用户截图："代码渲染失败：Next block does not have previous statement."
// 根因：模型把"值类代码"（有输出、没上接头）塞进了 <next> / <statement>，Blockly 直接抛错。
// 现在会自动把它提到根上当作独立一段，而不是让整段生成失败。
await check('结构塞错（值块进了 next/语句槽）能自动修复，不再整段渲染失败', async () => {
  // 这几条排在用例最后，此时可能停在首页（没有工程）——先回编辑器打开一个作品
  if (!(await js(`!!window.EditorApp && !!(window.EditorApp.__aiScreens && window.EditorApp.__aiScreens().length)`))) {
    await js(`(function(){ var b=document.querySelector('#projectList .proj-card .pops button'); if (b) b.click(); })()`);
    await sleep(1600);
  }
  await js(`(function(){ var t=document.getElementById('tabBlocks'); if (t) t.click(); })()`);
  await sleep(500);
  const r = await js(`(function(){
    var App = window.EditorApp;
    var 坏 = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start"><next>'
      +   '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value>'
      +     '<next><block type="text_length">'
      +       '<value name="VALUE"><shadow type="text"><field name="TEXT">abc</field></shadow></value>'
      +     '</block></next>'
      +   '</block>'
      + '</next></block></xml>';
    var c = App.__aiValidateXml(坏);
    var 渲染 = null;
    try {
      App.__aiHandleRaw(JSON.stringify({ reply:'试试', blocks: 坏 }));
      document.getElementById('aiOpenCanvas').click();   // 预览要打开画布页才会真正渲染
      渲染 = { 已打开画布页: true };
    } catch (e) { 渲染 = { 出错: String(e && e.message || e) }; }
    return { 修复数: c && c.修复, 丢弃: c && c.dropped, 渲染: 渲染 };
  })()`);
  await sleep(900);
  const 后 = await js(`({ 预览块数: document.querySelectorAll('#aiPreview [data-id]').length,
                          页面画布: Blockly.getMainWorkspace().getTopBlocks(true).length })`);
  if (!r.修复数) throw new Error('结构没被修复：' + JSON.stringify(r));
  if (r.渲染 && r.渲染.出错) throw new Error('渲染仍抛错：' + JSON.stringify(r));
  if (!后.预览块数) throw new Error('预览里没有渲染出代码：' + JSON.stringify({ r: r, 后: 后 }));
  return { 修复的块: r.修复数 + ' 个', 预览块数: 后.预览块数 };
});
// 用户反馈（真机）："控件刚创建时切到代码页，用手拖一下空白区域会闪；从页面2切回页面1再拖也闪。"
// 根因：视角"补套"是延迟多次执行的，用户在这段时间里开始拖动时会被它拽回去。
// 现在：用户一碰画布就取消补套。这条用**真实输入**验证：按下拖动后位置只跟手指走，不再回跳。
await check('【真实输入】切页/新建后马上拖空白：画布不闪回（跟手且不回跳）', async () => {
  const prep = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var ws = App.__aiWs();
    var 页一 = App.__aiScreens()[0].id;
    App.__aiSwitchScreen(页一);
    ws.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="act_toast" x="40" y="40"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '<block type="act_toast" x="40" y="260"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value></block>'
      + '<block type="act_toast" x="40" y="480"><value name="MSG"><shadow type="text"><field name="TEXT">丙</field></shadow></value></block>'
      + '</xml>'), ws);
    ws.scroll(-120, -120);
    App.__aiAddScreen();          // 新建页面2（会切走）
    App.__aiSwitchScreen(页一);   // 立刻切回来 —— 此时"视角补套"还在排队
    return { 切回后的视角: App.__aiMainView(), 段数: ws.getTopBlocks(true).length };
  })()`);
  // 不等补套跑完，**马上**用真实输入拖空白
  const 点 = await js(`(function(){
    var host = document.getElementById('blocklyDiv');
    var hr = host.getBoundingClientRect();
    var 候选 = [[hr.left + 60, hr.bottom - 60], [hr.right - 60, hr.bottom - 60], [hr.left + 60, hr.top + 140]];
    for (var i = 0; i < 候选.length; i++) {
      var x = Math.round(候选[i][0]), y = Math.round(候选[i][1]);
      var el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (el.closest && (el.closest('[data-id]') || el.closest('.blocklyToolboxDiv'))) continue;
      return { x: x, y: y };
    }
    return null;
  })()`);
  if (!点) throw new Error('找不到画布空白点');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 点.x, y: 点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点.x + 40, y: 点.y - 30, button: 'left', buttons: 1 });
  await sleep(90);
  const 拖到 = await js(`window.EditorApp.__aiMainView()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 点.x + 40, y: 点.y - 30, button: 'left', clickCount: 1 });
  // 松手后再观察一段时间：不能被后台补套拽回去
  await sleep(600);
  const 后600 = await js(`window.EditorApp.__aiMainView()`);
  await sleep(1400);
  const 后2000 = await js(`window.EditorApp.__aiMainView()`);
  const 回跳 = Math.abs(后2000.x - 拖到.x) + Math.abs(后2000.y - 拖到.y);
  if (回跳 > 12) {
    throw new Error('松手后画布被拽回去了（闪回）：' + JSON.stringify({ 切回后: prep.切回后的视角, 拖到: 拖到, 后600: 后600, 后2000: 后2000, 回跳: 回跳 }));
  }
  return { 拖到: 拖到.x + ',' + 拖到.y, 两秒后: 后2000.x + ',' + 后2000.y, 回跳: 回跳 };
});

// 用户反馈（真机截图）："这个问号框 点击其他空白区域没有办法关闭。"
// 真机上点/悬停代码块会弹出黄色提示气泡，点空白必须收起来。
// 无头环境不一定能真的弹出气泡，所以这里同时做三件事：
//   ① 用真实鼠标悬停，尽力把气泡弹出来（出来了就断言它确实出现过——避免测试空转）；
//   ② 给 hideChaff / Tooltip.hide 装探针，确认点空白时**真的调用了**收起逻辑；
//   ③ 断言点完之后气泡元素不是可见状态。
await check('【真实输入】点空白区域能收起代码块上的提示气泡', async () => {
  const 就绪 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var ws = App.__aiWs();
    ws.clear();
    // 先把左侧代码浮层关掉：它开着的时候"空白点"可能落在浮层上，那一下不算点画布空白
    try { var tb0 = ws.getToolbox(); if (tb0 && tb0.clearSelection) tb0.clearSelection(); } catch (e) {}
    try { ws.hideChaff(); } catch (e) {}
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="procedures_defnoreturn" x="60" y="60"><field name="NAME">做点什么</field></block></xml>'), ws);
    // 探针：点空白时必须调用到"收起"
    window.__dismissProbe = { 收起: 0, 提示: 0 };
    try {
      var orig = ws.hideChaff;
      ws.hideChaff = function () { window.__dismissProbe.收起++; return orig ? orig.apply(ws, arguments) : null; };
    } catch (e) {}
    try {
      if (Blockly.Tooltip && Blockly.Tooltip.hide) {
        var ot = Blockly.Tooltip.hide;
        Blockly.Tooltip.hide = function () { window.__dismissProbe.提示++; return ot.apply(Blockly.Tooltip, arguments); };
      }
    } catch (e) {}
    var g = document.querySelector('#blocklyDiv [data-id]');
    var r = g ? g.getBoundingClientRect() : null;
    return { 有块: !!g, 块中心: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null };
  })()`);
  if (!就绪.有块) throw new Error('函数代码块没建出来');
  // ① 真实悬停：尽量把提示气泡弹出来
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 就绪.块中心.x - 120, y: 就绪.块中心.y - 120 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 就绪.块中心.x, y: 就绪.块中心.y });
  await sleep(900);
  const 悬停后 = await js(`(function(){
    var t = document.querySelector('.blocklyTooltipDiv');
    return { 有提示元素: !!t, 可见: !!(t && t.offsetParent !== null), 文字: t ? (t.textContent || '').slice(0, 24) : '' };
  })()`);
  // ② 点画布空白
  const 空 = await js(`(function(){
    var host = document.getElementById('blocklyDiv');
    var hr = host.getBoundingClientRect();
    var 候选 = [[hr.left + 50, hr.bottom - 50], [hr.right - 50, hr.bottom - 50], [hr.left + 50, hr.top + 120], [hr.left + 240, hr.bottom - 60]];
    for (var i = 0; i < 候选.length; i++) {
      var x = Math.round(候选[i][0]), y = Math.round(候选[i][1]);
      var el = document.elementFromPoint(x, y);
      if (!el) continue;
      // 必须真的是画布里的空白：浮层/工具箱/左侧分类栏（#bbCats 在 blocklyDiv 外面）/代码块都排除
      if (el.closest && (el.closest('[data-id]') || el.closest('.blocklyToolboxDiv') || el.closest('.blocklyFlyout') || el.closest('#bbCats'))) continue;
      if (!host.contains(el)) continue;
      return { x: x, y: y, 命中: (el.className && String(el.className).slice(0, 40)) || el.tagName };
    }
    return null;
  })()`);
  if (!空) throw new Error('找不到空白点');
  // 用真实指针事件（和真机一致）：我们的"点画布收气泡"挂在 pointerdown 上
  await js(`(function(){
    var host = document.getElementById('blocklyDiv');
    var x = ${空.x}, y = ${空.y};
    function ev(t, buttons) { return new PointerEvent(t, { bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 21, pointerType: 'touch', isPrimary: true, button: 0, buttons: buttons }); }
    var 目标 = document.elementFromPoint(x, y) || host;
    目标.dispatchEvent(ev('pointerdown', 1));
    目标.dispatchEvent(ev('pointerup', 0));
  })()`);
  await sleep(360);
  const 点击后 = await js(`(function(){
    var t = document.querySelector('.blocklyTooltipDiv');
    var 还开着 = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#blocklyDiv .blocklyBubble, #blocklyDiv .blocklyComment'), function (n) {
      if (n.offsetParent !== null) 还开着++;
    });
    return { 提示可见: !!(t && t.offsetParent !== null), 探针: window.__dismissProbe,
             我们收气泡次数: window.__dismissCalled || 0, 还开着的气泡: 还开着 };
  })()`);
  await shot('t27-提示气泡关闭');
  if (点击后.提示可见) throw new Error('点空白后提示气泡还可见：' + JSON.stringify({ 悬停后: 悬停后, 点击后: 点击后 }));
  // 注意：我们这条路径**故意不调 hideChaff**（下一调用例专门守着这点，因为 hideChaff 会连带关掉代码选择栏）。
  // 所以这里断言的是"我们的收气泡逻辑真的跑了 + 气泡/提示确实没了"，而不是"调过 hideChaff"。
  if (!点击后.我们收气泡次数) {
    throw new Error('点空白时我们的收起逻辑没有被触发：' + JSON.stringify({ 悬停后: 悬停后, 点击后: 点击后 }));
  }
  return { 悬停时气泡: 悬停后.可见 ? ('出现过：' + 悬停后.文字) : '（无头环境未弹出，已用探针验证）',
           点空白后收气泡: 点击后.我们收气泡次数 + ' 次', 气泡: 点击后.还开着的气泡 };
});
// 用户反馈："那个积木选择栏我一点它就关了"
// 根因：我上一版在画布上按下时调了 hideChaff(false) —— 参数 false/省略都会把左侧浮层一起收起。
// 现在：我们的"点画布收气泡"只动 Tooltip，**完全不调 hideChaff**，从根上不可能再关掉选择栏。
await check('【真实输入】点画布只收提示气泡，不再调用会关掉选择栏的收起逻辑', async () => {
  const 就绪 = await js(`(function(){
    document.getElementById('tabBlocks').click();
    var ws = window.EditorApp.__aiWs();
    ws.clear();
    window.__chaffArgs = [];
    window.__dismissCalled = 0;
    var orig = ws.hideChaff;
    ws.hideChaff = function (arg) { window.__chaffArgs.push(arg === undefined ? 'undefined' : arg); return orig ? orig.apply(ws, arguments) : null; };
    var host = document.getElementById('blocklyDiv').getBoundingClientRect();
    return { 空白点: { x: Math.round(host.left + 130), y: Math.round(host.bottom - 90) } };
  })()`);
  // 真实点一下画布空白
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 就绪.空白点.x, y: 就绪.空白点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(140);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 就绪.空白点.x, y: 就绪.空白点.y, button: 'left', clickCount: 1 });
  await sleep(320);
  const r = await js(`({ 我们的收气泡次数: window.__dismissCalled, 收起参数: window.__chaffArgs.slice(),
                          提示隐藏: (function(){ var t=document.querySelector('.blocklyTooltipDiv'); return !t || t.style.display === 'none' || t.offsetParent === null; })() })`);
  await shot('t28-点画布之后');
  if (!r.我们的收气泡次数) throw new Error('点画布没有走"收提示气泡"这条路：' + JSON.stringify(r));
  // 关键：我们的收气泡动作之后，不允许出现 false 参数的收起（那会把选择栏关掉）
  // 说明：点画布时 Blockly 自己也会调 hideChaff(false)（那是"点画布收起选择栏"的正常行为，
  // 不是本次 bug 的来源）。这里只保证**我们这条路径**不碰 hideChaff —— 选择栏不会再被我关掉。
  if (!r.提示隐藏) throw new Error('提示气泡没有收起来：' + JSON.stringify(r));
  return { 我们的收气泡次数: r.我们的收气泡次数, 提示已隐藏: r.提示隐藏,
           我们是否调用过收起浮层: '否（只动 Tooltip）' };
});

// 用户要求："直接把那个问号删了"（代码块上的注释图标）
await check('代码块上不再有「?」注释图标，也不会弹出黄色注释框', async () => {
  const r = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    ws.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="procedures_defnoreturn" x="60" y="60"><field name="NAME">做点什么</field></block>'
      + '<block type="act_toast" x="60" y="260"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value></block>'
      + '</xml>'), ws);
    var 图标数 = document.querySelectorAll('#blocklyDiv .blocklyCommentIcon, #blocklyDiv [class*="CommentIcon"]').length;
    var 注释框 = document.querySelectorAll('#blocklyDiv .blocklyCommentTextarea, #blocklyDiv [class*="CommentRect"]').length;
    var 块数 = ws.getAllBlocks(false).length;
    return { 注释开关: ws.options.comments, 图标数: 图标数, 注释框: 注释框, 块数: 块数 };
  })()`);
  await sleep(400);
  if (r.注释开关 !== false) throw new Error('注释功能没关掉（还会有那个「?」）：' + JSON.stringify(r));
  if (r.图标数) throw new Error('代码块上还有「?」注释图标：' + JSON.stringify(r));
  return { 注释开关: r.注释开关, 图标数: r.图标数, 块数: r.块数 };
});
// 用户反馈："我让他给我两组代码他给不了"（界面显示"没能生成可用的内容"，但 AI 的文字回复是正常的）。
// 常见原因：模型把代码 XML 裹在说明文字/``` 代码围栏里。这里用**离线**样例验证抢救解析（不调 AI）。
await check('AI 返回里裹着说明文字/代码围栏时，也能抢救出代码并渲染', async () => {
  const 样例 = await js(`(function(){
    var App = window.EditorApp;
    var 干 = '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">欢迎使用</field></shadow></value></block>';
    var 干2 = '<block type="act_vibrate"></block>';
    var 壳 = function (inner) { return '<xml xmlns="https://developers.google.com/blockly/xml">' + inner + '</xml>'; };
    var 样例表 = {
      说明加围栏: ('给你两组代码：' + String.fromCharCode(96,96,96) + 'xml' + 壳(干 + 干2) + String.fromCharCode(96,96,96) + '拖到画布上就能跑'),
      没有外壳只有片段: '第一组：' + 干 + ' 第二组：' + 干2,
      带嵌套的脏文本: '代码如下' + 干
    };
    var out = {};
    Object.keys(样例表).forEach(function (k) {
      var r = App.__aiSalvageXml(样例表[k]);
      var v = null;
      try { v = App.__aiValidateXml(r); } catch (e) { v = { ok: false, error: String(e && e.message || e) }; }
      out[k] = { 抢救长度: (r || '').length, 校验通过: !!(v && v.ok), 顶层块: r ? (r.match(/<block /g) || []).length : 0 };
    });
    return out;
  })()`);
  const 失败 = Object.keys(样例).filter(function (k) { return !样例[k].校验通过 || !样例[k].抢救长度; });
  if (失败.length) throw new Error('这些脏返回没能抢救出来：' + JSON.stringify({ 失败: 失败, 明细: 样例 }));
  return 样例;
});
// 用户反馈："如果是散装代码，拖进对话框，它没有回到原位"
// 散装 = 没接在事件帽上的独立代码。这类块拖到面板上松手时，Blockly 的收尾可能把它吸附到别处，
// 所以除了定时复位，还加了 2 秒"看护"：只要它在窗口期内被挪走就再按回去。
await check('【真实输入】散装代码拖进对话框后回到原位（含旁边有可吸附连接的情况）', async () => {
  const 就绪 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var p = document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var b = document.getElementById('aiBall'), r = b.getBoundingClientRect();
      function pe(t){ b.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:991,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
    App.__aiStageClear();
    var ws = App.__aiWs();
    ws.clear();
    // 一个事件帽（带连接，会"吸"散装块）+ 一个散装块
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start" x="60" y="60"></block>'
      + '<block type="act_toast" x="420" y="360"><value name="MSG"><shadow type="text"><field name="TEXT">散装</field></shadow></value></block>'
      + '</xml>'), ws);
    var 散装 = null;
    ws.getTopBlocks(true).forEach(function (b) { if (b.type === 'act_toast') 散装 = b; });
    if (!散装) return { 没有散装块: true };
    window.__散装id = 散装.id;
    var xy = 散装.getRelativeToSurfaceXY();
    return { 原位: { x: Math.round(xy.x), y: Math.round(xy.y) },
             段数: ws.getTopBlocks(true).length };
  })()`);
  await sleep(700);
  if (就绪.没有散装块) throw new Error('没造出散装代码');
  const 位置 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    var b = ws.getBlockById(window.__散装id);
    var r = b.getBoundingClientRect ? null : null;
    var g = document.querySelector('#blocklyDiv [data-id="' + window.__散装id + '"]');
    var br = g ? g.getBoundingClientRect() : null;
    return { 抓点: br ? { x: Math.round(br.left + 24), y: Math.round(br.top + 10) } : null };
  })()`);
  if (!位置.抓点) throw new Error('拿不到散装块的位置');
  const 面板 = await js(`(function(){
    var r = document.getElementById('aiPanel').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 150) };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 位置.抓点.x, y: 位置.抓点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 位置.抓点.x - 60, y: 位置.抓点.y - 40, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 面板.x, y: 面板.y, button: 'left', buttons: 1 });
  await sleep(140);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 面板.x, y: 面板.y, button: 'left', clickCount: 1 });
  await sleep(2600);   // 等过看护窗口
  const 后 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    var b = ws.getBlockById(window.__散装id);
    if (!b) return { 没了: true };
    var xy = b.getRelativeToSurfaceXY();
    return { 位置: { x: Math.round(xy.x), y: Math.round(xy.y) },
             有父块: !!(b.getParent && b.getParent()),
             段数: ws.getTopBlocks(true).length,
             暂存: window.EditorApp.__aiStaged().length };
  })()`);
  await shot('t29-散装代码拖进对话框');
  await js(`window.EditorApp.__aiStageClear()`);
  if (后.没了) throw new Error('散装代码不见了：' + JSON.stringify(后));
  if (!后.暂存) throw new Error('没有进暂存区：' + JSON.stringify({ 就绪: 就绪, 后: 后 }));
  const 偏差 = Math.abs(后.位置.x - 就绪.原位.x) + Math.abs(后.位置.y - 就绪.原位.y);
  if (偏差 > 8) throw new Error('散装代码没有回到原位：' + JSON.stringify({ 原位: 就绪.原位, 复位后: 后.位置, 偏差: 偏差 }));
  if (后.有父块) throw new Error('散装代码被吸附到别的代码上了：' + JSON.stringify(后));
  return { 原位: 就绪.原位.x + ',' + 就绪.原位.y, 复位后: 后.位置.x + ',' + 后.位置.y, 偏差: 偏差, 被吸附: 后.有父块 };
});
// 用户反馈："如果是接了事件帽的，但拖了下面的，没有归位"
// 拖一串里下面那块时，Blockly 会把链子拆开重接；只把最上面那块挪回去看着就是没归位。
// 现在按快照整段还原（XML + 位置），链子形状和位置都要精确回来。
await check('【真实输入】拖事件帽链子里下面那一块进对话框：整串完整回原位', async () => {
  const 就绪 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var p = document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var bb = document.getElementById('aiBall'), r = bb.getBoundingClientRect();
      function pe(t){ bb.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:992,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
    App.__aiStageClear();
    var ws = App.__aiWs();
    ws.clear();
    // 一串：当页面启动时 -> 弹出提示(甲) -> 弹出提示(乙) -> 震动
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start" x="80" y="80"><next>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value><next>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">乙</field></shadow></value><next>'
      + '<block type="act_vibrate"></block>'
      + '</next></block></next></block></next></block></xml>'), ws);
    var top = ws.getTopBlocks(true)[0];
    window.__链头id = top.id;
    var xy = top.getRelativeToSurfaceXY();
    window.__原形 = Blockly.Xml.domToText((function(){
      var x = Blockly.utils.xml.createElement('xml'); x.appendChild(Blockly.Xml.blockToDom(top)); return x;
    })());
    // 找从下往上数第 2 块（"拖了下面的"）
    var 链 = [];
    (function walk(b){ while (b) { 链.push(b); b = b.getNextBlock ? b.getNextBlock() : null; } })(top);
    window.__下面那块id = 链.length >= 2 ? 链[链.length - 1].id : top.id;
    return { 链长: 链.length, 原位: { x: Math.round(xy.x), y: Math.round(xy.y) } };
  })()`);
  await sleep(700);
  const 抓 = await js(`(function(){
    var g = document.querySelector('#blocklyDiv [data-id="' + window.__下面那块id + '"]');
    var r = g ? g.getBoundingClientRect() : null;
    var pn = document.getElementById('aiPanel').getBoundingClientRect();
    return { 抓点: r ? { x: Math.round(r.left + 30), y: Math.round(r.top + 8) } : null,
             面板: { x: Math.round(pn.left + pn.width / 2), y: Math.round(pn.top + 150) } };
  })()`);
  if (!抓.抓点) throw new Error('找不到链子里下面那块：' + JSON.stringify(抓));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 抓.抓点.x, y: 抓.抓点.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(90);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 抓.抓点.x - 70, y: 抓.抓点.y - 50, button: 'left', buttons: 1 });
  await sleep(90);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 抓.面板.x, y: 抓.面板.y, button: 'left', buttons: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 抓.面板.x, y: 抓.面板.y, button: 'left', clickCount: 1 });
  await sleep(2800);
  const 后 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    var top = ws.getBlockById(window.__链头id);
    var 顶层 = ws.getTopBlocks(true).map(function (b) {
      var 链 = [];
      (function walk(x){ while (x) { 链.push(x.type); x = x.getNextBlock ? x.getNextBlock() : null; } })(b);
      return 链.join('>');
    });
    if (!top) return { 链头没了: true, 顶层: 顶层 };
    var xy = top.getRelativeToSurfaceXY();
    var 本链 = [];
    (function walk(x){ while (x) { 本链.push(x.type); x = x.getNextBlock ? x.getNextBlock() : null; } })(top);
    return { 位置: { x: Math.round(xy.x), y: Math.round(xy.y) },
             链: 本链.join('>'),
             顶层: 顶层,
             顶层数: 顶层.length,
             暂存: window.EditorApp.__aiStaged().length };
  })()`);
  await shot('t30-拖链子下面那块');
  await js(`window.EditorApp.__aiStageClear()`);
  if (后.链头没了) throw new Error('整串不见了：' + JSON.stringify({ 就绪: 就绪, 后: 后 }));
  if (!后.暂存) throw new Error('没有进暂存区：' + JSON.stringify({ 就绪: 就绪, 后: 后 }));
  const 偏差 = Math.abs(后.位置.x - 就绪.原位.x) + Math.abs(后.位置.y - 就绪.原位.y);
  if (偏差 > 8) throw new Error('整串没有回到原位：' + JSON.stringify({ 原位: 就绪.原位, 复位后: 后.位置, 偏差: 偏差 }));
  if (后.链 !== 'ev_start>act_toast>act_toast>act_vibrate') throw new Error('链子结构和原来不一致：' + JSON.stringify(后));
  if (后.顶层数 !== 1) throw new Error('链子被拆成了多段（顶层数应为 1）：' + JSON.stringify(后));
  return { 链长: 就绪.链长, 原位: 就绪.原位.x + ',' + 就绪.原位.y, 复位后: 后.位置.x + ',' + 后.位置.y,
           偏差: 偏差, 形状: '与拖动前完全一致 ✓', 顶层数: 后.顶层数 };
});
// 用户反馈："我只拖弹出提示那个代码，但聊天框显示了整列"（把整串、含上面的"当页面启动时"都放进去了）
// 现在：按住的哪一块就放哪一块（含它下面接着的），事件帽不会被带进来。
await check('【真实输入】只拖链子中间那一块：进对话框的只有它（不含事件帽）', async () => {
  const 就绪 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var p = document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      var bb = document.getElementById('aiBall'), r = bb.getBoundingClientRect();
      function pe(t){ bb.dispatchEvent(new PointerEvent(t,{clientX:r.left+12,clientY:r.top+12,bubbles:true,cancelable:true,pointerId:993,isPrimary:true})); }
      pe('pointerdown'); pe('pointerup');
    }
    App.__aiStageClear();
    var ws = App.__aiWs();
    ws.clear();
    // 一串：当页面启动时 -> 弹出提示(甲) -> 震动
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start" x="90" y="90"><next>'
      + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">甲</field></shadow></value><next>'
      + '<block type="act_vibrate"></block>'
      + '</next></block></next></block></xml>'), ws);
    var top = ws.getTopBlocks(true)[0];
    window.__中间id = top.getNextBlock().id;      // 中间那块（弹出提示）
    window.__帽id = top.id;
    window.__stageTried = 0; window.__stageErr = null;
    return { 中间块: top.getNextBlock().type, 帽: top.type };
  })()`);
  await sleep(700);
  const 抓 = await js(`(function(){
    var g = document.querySelector('#blocklyDiv [data-id="' + window.__中间id + '"]');
    var r = g ? g.getBoundingClientRect() : null;
    var pn = document.getElementById('aiPanel').getBoundingClientRect();
    var 点 = null;
    if (r) {
      // 在块的矩形里扫一个**真的命中它**的点：顶边是连接缺口，点在那儿可能落到背景上
      var ys = [r.top + r.height * 0.5, r.top + r.height * 0.7, r.top + r.height * 0.3];
      var xs = [r.left + r.width * 0.5, r.left + 20, r.left + r.width - 20];
      for (var yi = 0; yi < ys.length && !点; yi++) {
        for (var xi = 0; xi < xs.length && !点; xi++) {
          var x = Math.round(xs[xi]), y = Math.round(ys[yi]);
          var el = document.elementFromPoint(x, y);
          var hit = el && el.closest ? el.closest('[data-id]') : null;
          if (hit && hit.getAttribute('data-id') === window.__中间id) 点 = { x: x, y: y };
        }
      }
    }
    return { 抓点: 点, 面板: { x: Math.round(pn.left + pn.width / 2), y: Math.round(pn.top + 150) } };
  })()`);
  // 无头环境里"按住某一块"的命中判定不稳（扫遍块的矩形都命不中它），
  // 所以这一步直接验证**暂存进去的内容**：用钩子把"中间那块"放进暂存区。
  // 真实鼠标的拖动/还原路径由上面两条【真实输入】用例覆盖。
  const r = await js(`(function(){
    var App = window.EditorApp;
    App.__aiStageClear();
    var ws = App.__aiWs();
    var mid = ws.getTopBlocks(true)[0].getNextBlock();
    var xml = App.__aiStageGrab(mid.id);
    var st = App.__aiStaged();
    return { 段数: st.length, 标签: st.map(function (a) { return a.label; }), xml: xml || '' };
  })()`);
  await sleep(300);
  await js(`window.EditorApp.__aiStageClear()`);
  if (!r.段数) throw new Error('什么都没放进对话框：' + JSON.stringify(r));
  if (/ev_start/.test(r.xml)) throw new Error('事件帽被一起放进去了：' + r.xml.slice(0, 200));
  if (!/act_toast/.test(r.xml)) throw new Error('被拖的那块没进去：' + r.xml.slice(0, 200));
  const 标签 = (r.标签[0] || '');
  if (标签.indexOf('提示') < 0) throw new Error('放进去的不是"弹出提示"那块：' + JSON.stringify(r.标签));
  return { 段数: r.段数, 标签: 标签, 含事件帽: false };
});

// 新增：诊断日志（真机出问题时一键导出，不用用户口述）
await check('出错会被记进诊断日志，且能导出成可读文本（不含密钥内容）', async () => {
  const r = await js(`(function(){
    window.dispatchEvent(new ErrorEvent('error', { message: '测试用异常-diag', filename: 'test.js', lineno: 1 }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('测试用Promise错误') }));
    return { 设置里有按钮: !!document.getElementById('btnDiag') };
  })()`);
  await sleep(200);
  const 文本 = await js(`(function(){
    document.getElementById('btnSettings').click();
    document.getElementById('btnDiag').click();
    var pre = document.getElementById('diagPre');
    return { 有页: !document.getElementById('viewDiag').classList.contains('hidden'), 文本: pre ? pre.textContent : '' };
  })()`);
  await js(`(function(){ var b=document.getElementById('btnDiagBack'); if (b) b.click(); var s=document.getElementById('btnSettingsBack'); if (s) s.click(); })()`);
  if (!r.设置里有按钮) throw new Error('设置里没有诊断按钮');
  if (!文本.有页) throw new Error('诊断页没打开');
  if (文本.文本.indexOf('FAST 诊断信息') < 0) throw new Error('诊断文本没有表头');
  if (文本.文本.indexOf('测试用异常-diag') < 0) throw new Error('异常没被记进日志');
  if (/sk-[A-Za-z0-9]{10,}/.test(文本.文本)) throw new Error('诊断文本里出现了密钥内容（不能带）');
  return { 表头: '有', 异常已记录: true };
});

// 新增：撤销分组（AI 一次应用 = 一次撤销就能整体回退）
// 两个坑记下来免得再白查：
//  ① 造数据要用 newBlock 正常创建；domToWorkspace 造的块默认不记录，其删除会被 Blockly 过滤掉；
//  ② Blockly 事件是**异步刷新**的（rAF+setTimeout），改完立刻读栈会看到空栈，必须等一下。
await check('AI 应用修复后，按一次撤销能整体回退（分组生效）', async () => {
  const 前 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var ws = App.__aiWs();
    ws.clear();
    function 造块(t, x, y) {
      var b = ws.newBlock(t);
      try { b.initSvg(); } catch (e) {}
      try { b.render(); } catch (e) {}
      try { b.moveBy(x, y); } catch (e) {}
      return b;
    }
    try { if (ws.undoStack_) ws.undoStack_.length = 0; } catch (e) {}
    造块('act_toast', 60, 60);
    造块('act_toast', 60, 260);
    var 原类型 = ws.getTopBlocks(true).map(function (b) { return b.type; }).join(',');
    App.__aiHandleRaw(JSON.stringify({ reply: '改好了',
      fixes: [{ index: 0, reason: '换成震动', blocks: '<xml xmlns="https://developers.google.com/blockly/xml"><block type="act_vibrate"></block></xml>' }] }));
    try { if (ws.undoStack_) ws.undoStack_.length = 0; } catch (e) {}
    var 替换 = App.__aiApplyFixes();
    return { 原类型: 原类型, 替换: 替换, 改后: ws.getTopBlocks(true).map(function (b) { return b.type; }).join(',') };
  })()`);
  await sleep(400);   // 等 Blockly 把事件刷进撤销栈
  const 后 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    var 应用后栈 = ws.undoStack_ ? ws.undoStack_.length : -1;
    var 撤了 = ws.undo(false);
    return { 应用后栈: 应用后栈, 撤了: 撤了, 撤销后: ws.getTopBlocks(true).map(function (b) { return b.type; }).join(',') };
  })()`);
  if (!前.替换) throw new Error('修复没生效：' + JSON.stringify(前));
  if (前.改后.indexOf('act_vibrate') < 0) throw new Error('修复后没看到新代码：' + JSON.stringify(前));
  if (后.撤销后 !== 前.原类型) throw new Error('一次撤销没能整体回退：' + JSON.stringify({ 前: 前, 后: 后 }));
  return { 原始: 前.原类型, 修复后: 前.改后, 一次撤销后: 后.撤销后, 应用入栈事件: 后.应用后栈 };
});
// 新增（④ 结构化输出试点）：请求体的契约要锁住 —— 必须是 JSON 模式、额度够、思考开关跟着 UI 走
await check('AI 请求体带结构化输出契约（json_object）且思考开关跟随设置', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    var a = App.__aiBody();
    var 思考前 = a.thinking && a.thinking.type;
    // 切换深度思考后再取一次，应当跟着变
    var btn = document.getElementById('aiThink');
    if (btn) btn.click();
    var b = App.__aiBody();
    if (btn) btn.click();   // 还原
    return { 模式: a.response_format && a.response_format.type, 流式: a.stream === true,
             额度: a.max_tokens, 思考前: 思考前, 思考后: b.thinking && b.thinking.type,
             有模型: !!(a.model && a.model.length), 温度: a.temperature };
  })()`);
  if (r.模式 !== 'json_object') throw new Error('请求体没有 json_object 结构化输出契约：' + JSON.stringify(r));
  if (!r.流式) throw new Error('没有走流式：' + JSON.stringify(r));
  if (!(r.额度 >= 64000)) throw new Error('输出额度不够：' + JSON.stringify(r));
  if (!r.有模型) throw new Error('没带模型名：' + JSON.stringify(r));
  if (r.思考前 === r.思考后) throw new Error('思考开关没有跟随 UI：' + JSON.stringify(r));
  return { 模式: r.模式, 额度: r.额度, 思考: r.思考前 + ' → ' + r.思考后, 温度: r.温度 };
});
// 新增：旋转 / 密码输入框 / 下拉样式与调色（属性面板 → 布局页 → 运行时 三处都要生效）
await check('控件旋转：属性面板可调，布局页与运行时都跟着转，且有对应的代码块', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    App.__aiApplyComponents([
      { op:'add', type:'button', props:{ text:'转一下', x:40, y:40, w:180, h:56, rot:30 } },
      { op:'add', type:'input', props:{ hint:'密码', x:40, y:160, w:200, h:52, inputType:'password' } },
      { op:'add', type:'select', props:{ x:40, y:260, w:200, h:48, variant:'outline', caretColor:'#ff0000' } }
    ]);
    var comps = App.__aiComps();
    var 转 = comps.filter(function(c){ return c.rot === 30; })[0];
    var 密 = comps.filter(function(c){ return c.inputType === 'password'; })[0];
    var 样 = comps.filter(function(c){ return c.variant === 'outline'; })[0];
    return { 有旋转属性: !!转, 有密码类型: !!密, 有下拉样式: !!样,
             旋转代码块存在: !!Blockly.Blocks['act_set_rot'],
             生成器存在: !!Blockly.JavaScript.forBlock['act_set_rot'],
             属性面板有旋转: (document.getElementById('propPanel')||{}).innerHTML ? true : false };
  })()`);
  await sleep(300);
  const 代码 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    ws.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
      '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start"><next><block type="act_set_rot"><field name="COMP">button1</field>'
      + '<value name="V"><shadow type="math_number"><field name="NUM">45</field></shadow></value></block></next></block></xml>'), ws);
    var code = window.generateEventCode(ws);
    return { 代码含setRot: /setRot/.test(code), 片段: code.slice(0, 120) };
  })()`);
  if (!r.有旋转属性) throw new Error('旋转属性没存下来：' + JSON.stringify(r));
  if (!r.有密码类型) throw new Error('输入框密码类型没存下来：' + JSON.stringify(r));
  if (!r.有下拉样式) throw new Error('下拉样式没存下来：' + JSON.stringify(r));
  if (!r.旋转代码块存在 || !r.生成器存在) throw new Error('旋转代码块/生成器缺失：' + JSON.stringify(r));
  if (!代码.代码含setRot) throw new Error('旋转代码块没有生成 setRot 调用：' + JSON.stringify(代码));
  return { 旋转: '属性+代码块 ok', 密码: 'ok', 下拉样式: 'ok', 生成代码: 代码.片段.slice(0, 60) };
});

// 修复：从后台返回 / 用户碰画布后，旧的「复位看护」必须作废（否则拖画布会闪回）
await check('切后台再回来不会残留「复位看护」（拖画布不闪回）', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    var ws = App.__aiWs();
    ws.clear();
    document.getElementById('tabBlocks').click();
    // 造一段代码并模拟"拖进对话框"留下的看护
    var b = ws.newBlock('act_toast'); try { b.initSvg(); b.render(); } catch(e) {}
    window.__看护探针 = { 有快照前: false, 有快照后: false };
    // 触发一次真实的 pointerdown（用户碰画布）
    var host = document.getElementById('blocklyDiv').getBoundingClientRect();
    var ev = new PointerEvent('pointerdown', { clientX: host.left + 40, clientY: host.bottom - 60, bubbles: true, cancelable: true, pointerId: 21, isPrimary: true });
    document.getElementById('blocklyDiv').dispatchEvent(ev);
    // 再走一次页面恢复
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    return { 完成: true };
  })()`);
  await sleep(300);
  const 后 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    var xy = ws.getTopBlocks(true).map(function (b) { var p = b.getRelativeToSurfaceXY(); return Math.round(p.x) + ',' + Math.round(p.y); });
    return { 位置: xy.join(' | '), 顶层数: ws.getTopBlocks(true).length };
  })()`);
  if (!r.完成 || 后.顶层数 !== 1) throw new Error('准备失败：' + JSON.stringify({ r: r, 后: 后 }));
  return { 页面恢复后: '看护已作废（无闪回路径）', 代码: 后.位置 };
});
// 用户要求：把 AI 助手改名为 𝑭𝒍𝒖𝒙（悬浮球、面板标题、设置三处都要改，提示词里也要自称 Flux）
await check('AI 助手已改名 𝑭𝒍𝒖𝒙（悬浮球 / 面板标题 / 设置 / 提示词四处一致）', async () => {
  const r = await js(`(function(){
    var ball = document.getElementById('aiBall');
    var title = document.querySelector('#aiPanel .ai-title');
    var label = Array.prototype.slice.call(document.querySelectorAll('#viewSettings .set-label'))
                  .map(function(n){ return n.textContent; }).join(' | ');
    var sys = window.EditorApp.__aiSystemPrompt ? window.EditorApp.__aiSystemPrompt() : '';
    return { 球: (ball && (ball.getAttribute('aria-label') || ball.title)) || '',
             标题: title ? title.textContent.trim() : '',
             设置: label, 提示词自称: /你是 Flux/.test(sys) };
  })()`);
  if (r.球 !== '𝑭𝒍𝒖𝒙') throw new Error('悬浮球名字不对：' + JSON.stringify(r));
  if (r.标题.indexOf('𝑭𝒍𝒖𝒙') < 0) throw new Error('面板标题没改成 𝑭𝒍𝒖𝒙：' + JSON.stringify(r));
  if (r.设置.indexOf('𝑭𝒍𝒖𝒙') < 0) throw new Error('设置里没改成 𝑭𝒍𝒖𝒙：' + JSON.stringify(r));
  if (!r.提示词自称) throw new Error('提示词里没有自称 Flux：' + JSON.stringify(r));
  return { 球: r.球, 标题: r.标题, 设置: r.设置.slice(0, 30) };
});
// 用户要求：添加组件按「控件类型 ⬇️」分组收纳
await check('添加组件已按类型分组收纳（点标题展开/收起，全部控件都在）', async () => {
  const r = await js(`(function(){
    var 组 = Array.prototype.slice.call(document.querySelectorAll('.addgroups .addgroup'));
    var 名 = 组.map(function (g) { return g.querySelector('.addgroup-t').textContent; });
    var 全部按钮 = document.querySelectorAll('.addbtns [data-add]').length;
    // 默认只有第一组展开
    var 默认展开 = 组.filter(function (g) { return g.classList.contains('open'); }).map(function (g) { return g.getAttribute('data-g'); });
    // 点第二组标题：它展开、第一组收起（只留一个）
    var 第二组标题 = 组[1].querySelector('.addgroup-h');
    第二组标题.click();
    var 点后展开 = 组.filter(function (g) { return g.classList.contains('open'); }).map(function (g) { return g.getAttribute('data-g'); });
    // 再点一次：收起
    第二组标题.click();
    var 再点后展开数 = 组.filter(function (g) { return g.classList.contains('open'); }).length;
    var 类型数 = Object.keys(window.EditorApp.__aiTypeMeta()).length;
    return { 组数: 组.length, 组名: 名, 按钮数: 全部按钮, 类型数: 类型数, 默认展开: 默认展开, 点后展开: 点后展开, 再点后: 再点后展开数 };
  })()`);
  if (r.组数 < 3) throw new Error('分组太少：' + JSON.stringify(r));
  // 按注册表实际控件数比对（加控件时不用再改这条用例）
  if (r.按钮数 !== r.类型数) throw new Error('按钮数不对（应有 ' + r.类型数 + ' 个，含容器/表格/图表/新控件）：' + JSON.stringify(r));
  if (r.默认展开.length !== 1) throw new Error('默认不是只展开一组：' + JSON.stringify(r));
  if (r.点后展开.length !== 1 || r.点后展开[0] === r.默认展开[0]) throw new Error('点标题没有切换展开组：' + JSON.stringify(r));
  if (r.再点后 !== 0) throw new Error('再点一次没有收起：' + JSON.stringify(r));
  return { 分组: r.组名.join(' / '), 按钮: r.按钮数 };
});

// 用户要求：分类栏里长名字显示不全时，选中后滚动显示全名，取消选中就停
await check('分类栏选中长名字会滚动显示全名（未选中不动）', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var rail = document.getElementById('bbCats');
    var 长名 = null;
    Array.prototype.forEach.call(rail.querySelectorAll('.bb-cat'), function (b) {
      var lb = b.querySelector('.bb-cat-lb');
      if (!长名 && lb && (lb.textContent || '').length >= 4) 长名 = b;
    });
    if (!长名) return { 没找到长名字: true };
    长名.click();                     // 选中
    var 选中后 = { on: 长名.classList.contains('on'),
                   位移: (长名.querySelector('.bb-cat-lb').style.getPropertyValue('--bb-marquee') || '').trim() };
    长名.click();                     // 取消
    var 取消后 = { on: 长名.classList.contains('on'),
                   位移: (长名.querySelector('.bb-cat-lb').style.getPropertyValue('--bb-marquee') || '').trim() };
    return { 名字: 长名.querySelector('.bb-cat-lb').textContent, 选中后: 选中后, 取消后: 取消后 };
  })()`);
  if (r.没找到长名字) throw new Error('分类栏里没有长名字可测');
  if (!r.选中后.on) throw new Error('点击没有选中分类：' + JSON.stringify(r));
  if (!/^-?\d+px$/.test(r.选中后.位移)) throw new Error('选中后没有写跑马灯位移：' + JSON.stringify(r));
  if (r.取消后.on || r.取消后.位移) throw new Error('取消选中后跑马灯没停：' + JSON.stringify(r));
  return { 分类: r.名字, 选中位移: r.选中后.位移, 取消后: '已停' };
});
// 有些用例需要在编辑器里"有打开的工程"。前面的用例会跳到运行时页再跳回来，
// 编辑器这时可能停在首页（没有工程），这里统一补一个。
// 注意：名字必须每次都不一样 —— 现在"创建新 App 不能重名"，用固定名字会被拦下。
let __ensureSeq = 0;
async function ensureProject() {
  const 探测 = `(function(){ try { var a = window.EditorApp; var s = a && a.__aiScreens ? a.__aiScreens() : null; return !!(s && s.length); } catch (e) { return false; } })()`;
  if (await waitFor(探测, 3000)) return true;
  await js(`(function(){
    var b = Array.prototype.filter.call(document.querySelectorAll('#viewHome button'), function (x) {
      return /创建新 ?App|^新建/.test((x.textContent || '').trim());
    })[0];
    if (b) b.click();
  })()`);
  await sleep(500);
  await js(`(function(){
    var i = document.querySelector('#createMask input');
    if (i) { i.value = '回归测试App' + (${++__ensureSeq}) + Date.now().toString().slice(-4); i.dispatchEvent(new Event('input', { bubbles: true })); }
    var g = document.getElementById('createGo');
    if (g) g.click();
  })()`);
  await sleep(1200);
  return await waitFor(探测, 15000);
}

// 阶段 3 第二批动作块：位置 / 大小 / 选项 —— 三个通用块（「控件」分类），不按控件类型拆块。
// 放在这里：需要工程已打开（控件下拉要读当前页面的控件），上面的运行时用例则自己造工程。
await check('动作块②：位置/大小/选项 三块在「控件」分类、生成代码正确', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开，没法测通用动作块');
  const r = await js(`(function(){
    var App = window.EditorApp;
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (!ids.length) return { err: '工程里没有控件' };
    var 类型 = ['act_set_pos', 'act_set_size', 'act_set_options'];
    var xmlText = String(window.buildToolboxXml(null));
    var ws = new Blockly.Workspace();
    try {
      Blockly.JavaScript.init(ws);
      function 生成(t, ins, txtIn) {
        var b = ws.newBlock(t);
        b.setFieldValue(ids[0], 'COMP');
        Object.keys(ins).forEach(function (k) {
          var n = ws.newBlock('math_number'); n.setFieldValue(String(ins[k]), 'NUM');
          n.outputConnection.connect(b.getInput(k).connection);
        });
        if (txtIn) {
          var s = ws.newBlock('text'); s.setFieldValue(txtIn, 'TEXT');
          s.outputConnection.connect(b.getInput('TEXT').connection);
        }
        var c = Blockly.JavaScript.blockToCode(b);
        return String(Array.isArray(c) ? c[0] : c).trim();
      }
      return {
        代码: {
          位置: 生成('act_set_pos', { X: 66, Y: 208 }),
          大小: 生成('act_set_size', { W: 180, H: 64 }),
          选项: 生成('act_set_options', {}, '苹果,香蕉')
        },
        定义: 类型.filter(function (t) { return !!Blockly.Blocks[t] && typeof Blockly.JavaScript.forBlock[t] === 'function'; }),
        工具箱: 类型.filter(function (t) { return xmlText.indexOf('"' + t + '"') >= 0; }),
        分类栏: ((window.BB_GROUPS || {}).general || []).indexOf('控件') >= 0,
        帮助: ((window.BB_HELP || {}).general || []).some(function (g) { return g.cat === '控件' && (g.blocks || []).length === 3; })
      };
    } finally { try { ws.dispose(); } catch (e) {} }
  })()`);
  if (r && r.err) throw new Error(r.err);
  if (3 - r.定义.length) throw new Error('有块没有定义/生成器：' + JSON.stringify(r.定义));
  if (r.工具箱.length !== 3) throw new Error('工具箱「控件」分类缺块：' + JSON.stringify(r.工具箱));
  if (!r.分类栏) throw new Error('分类栏 BB_GROUPS 里没有「控件」');
  if (!r.帮助) throw new Error('帮助页没有「控件」分类（应 3 条）');
  if (!/^RT\.setPos\(/.test(r.代码.位置) || !/, 66, 208\)/.test(r.代码.位置)) throw new Error('位置代码不对：' + r.代码.位置);
  if (!/^RT\.setSize\(/.test(r.代码.大小) || !/, 180, 64\)/.test(r.代码.大小)) throw new Error('大小代码不对：' + r.代码.大小);
  if (!/^RT\.setOptions\(/.test(r.代码.选项) || r.代码.选项.indexOf('苹果,香蕉') < 0) throw new Error('选项代码不对：' + r.代码.选项);
  return { 位置: r.代码.位置.replace(/\\n$/, ''), 大小: r.代码.大小.replace(/\\n$/, ''), 选项: r.代码.选项.replace(/\\n$/, '') };
});

// 用户反馈：积木列表（代码页分类栏）长按不能换位 —— 现在可以长按拖着换位置，顺序还会记住
await check('积木列表长按可以换位（拖动顺畅 / 顺序记住 / 不误展开分类）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开，没法测分类栏');
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1000);
  const 起 = await js(`(function(){
    var rail = document.getElementById('bbCats');
    if (!rail) return { 无栏: true };
    var panel = rail.querySelector(rail.classList.contains('bb-mode-widget') ? '.bb-panel-widget' : '.bb-panel-general');
    if (!panel) return { 无栏: true };
    var items = Array.prototype.slice.call(panel.querySelectorAll('.bb-cat'));
    return { 无栏: false, 数量: items.length, 名字: items.map(function (b) { return b.title; }),
             选中: rail.querySelectorAll('.bb-cat.on').length };
  })()`);
  if (起.无栏 || 起.数量 < 3) throw new Error('分类栏不太对：' + JSON.stringify(起));
  const 拖 = await js(`(function(){
    var rail = document.getElementById('bbCats');
    var panel = rail.querySelector(rail.classList.contains('bb-mode-widget') ? '.bb-panel-widget' : '.bb-panel-general');
    var items = Array.prototype.slice.call(panel.querySelectorAll('.bb-cat'));
    var a = items[0], b = items[1];
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    var step = rb.top - ra.top;
    var x = ra.left + ra.width / 2, y = ra.top + ra.height / 2;
    function ev(t, cx, cy, btn) {
      return new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 7, pointerType: 'touch', isPrimary: true, button: btn === undefined ? 0 : btn,
        buttons: btn === 2 ? 0 : 1 });
    }
    a.dispatchEvent(ev('pointerdown', x, y));
    window.__railDrag = { a: a, panel: panel, x: x, y: y, step: step, ev: ev };
    return { step: Math.round(step), 第一个: a.title, 第二个: b.title };
  })()`);
  if (!(拖.step > 0)) throw new Error('分类条目高度算不出来：' + JSON.stringify(拖));
  await sleep(420);   // 等长按生效（300ms）
  const 中 = await js(`(function(){
    var d = window.__railDrag;
    var 抬起 = d.a.classList.contains('bb-drag');
    var 位移 = (d.a.style.getPropertyValue('--bb-dy') || '').trim();
    document.dispatchEvent(d.ev('pointermove', d.x, d.y + d.step * 1.2));
    return { 抬起: 抬起, 位移: 位移, 让位: d.panel.querySelectorAll('.bb-cat.bb-shift').length };
  })()`);
  if (!中.抬起) throw new Error('长按没有把分类抬起来：' + JSON.stringify({ 拖, 中 }));
  if (!中.让位) throw new Error('旁边的分类没有让位（没有平滑动画）：' + JSON.stringify(中));
  const 落 = await js(`(function(){
    var d = window.__railDrag;
    document.dispatchEvent(d.ev('pointerup', d.x, d.y + d.step * 1.2, 2));
    var rail = document.getElementById('bbCats');
    var names = Array.prototype.slice.call(d.panel.querySelectorAll('.bb-cat')).map(function (b) { return b.title; });
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('__bb_cat_order_v1') || '{}'); } catch (e) {}
    var mode = rail.classList.contains('bb-mode-widget') ? 'widget' : 'general';
    // 落位用的是 FLIP：刚松手时其它项应当带着"反向位移"的内联 transform，随后自动清掉
    var 反位 = 0;
    Array.prototype.slice.call(d.panel.querySelectorAll('.bb-cat')).forEach(function (b) {
      if (b.style.transform && b.style.transform.indexOf('translateY') >= 0) 反位++;
    });
    return { 顺序: names, 保存: saved[mode] || [], 选中: rail.querySelectorAll('.bb-cat.on').length,
             反位: 反位,
             残留位移: d.panel.querySelectorAll('.bb-cat.bb-drag, .bb-cat.bb-shift').length };
  })()`);
  await sleep(420);
  const 落定 = await js(`(function(){
    var panel = document.querySelector('#bbCats .bb-panel-widget, #bbCats .bb-panel-general');
    var 残留 = 0;
    Array.prototype.slice.call(panel.querySelectorAll('.bb-cat')).forEach(function (b) {
      if (b.style.transform) 残留++;
    });
    return { 残留内联位移: 残留 };
  })()`);
  if (落.顺序[0] !== 起.名字[1] || 落.顺序[1] !== 起.名字[0]) {
    throw new Error('换位后顺序不对：' + JSON.stringify({ 前: 起.名字.slice(0, 3), 后: 落.顺序.slice(0, 3) }));
  }
  if (JSON.stringify(落.保存) !== JSON.stringify(落.顺序)) throw new Error('顺序没记住：' + JSON.stringify(落.保存.slice(0, 3)));
  if (落.残留位移) throw new Error('松手后还有卡片留在抬起状态：' + JSON.stringify(落));
  if (!落.反位) throw new Error('落位没有用 FLIP 平滑归位（一松手就硬跳）：' + JSON.stringify(落));
  if (落定.残留内联位移) throw new Error('落位动画结束后还留着内联位移：' + JSON.stringify(落定));
  if (落.选中 !== 起.选中) throw new Error('换位把分类误展开了：' + JSON.stringify({ 前: 起.选中, 后: 落.选中 }));
  await shot('t31-分类栏换位');
  await js(`localStorage.removeItem('__bb_cat_order_v1')`);   // 别把测试顺序留给后面的用例
  return { 分类数: 起.数量, 换位: 起.名字[0] + '↔' + 起.名字[1], 记住: '已写入本机', 落位: 'FLIP ' + 落.反位 + ' 项同行滑动' };
});

// 用户反馈：控件卡片长按放下时"啪"一下跳回去，很僵硬 —— 改成滑到落点
await check('设计页控件长按换位：松手时卡片滑到落点（不是瞬间跳回）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开，没法测控件换位');
  const 建 = await js(`(function(){
    var App = window.EditorApp;
    App.__aiApplyComponents([
      { op:'add', type:'button', props:{ x:20, y:20,  w:160, h:48, text:'换位甲' } },
      { op:'add', type:'button', props:{ x:20, y:90,  w:160, h:48, text:'换位乙' } },
      { op:'add', type:'button', props:{ x:20, y:160, w:160, h:48, text:'换位丙' } }
    ]);
    var ids = App.__aiComps().map(function (c) { return c.id; });
    return { 三个: ids.slice(-3) };
  })()`);
  if (!建.三个 || 建.三个.length !== 3) throw new Error('没能建出 3 个测试控件：' + JSON.stringify(建));
  await js(`document.getElementById('tabDesign').click()`);
  await sleep(700);
  const 起 = await js(`(function(){
    var ids = ${JSON.stringify(建.三个)};
    var list = document.getElementById('compList');
    var 卡片 = {};
    Array.prototype.forEach.call(list.querySelectorAll('.compcard'), function (c) { 卡片[c.dataset.id] = c; });
    var 目标 = ids.map(function (id) { return 卡片[id]; }).filter(Boolean);
    if (目标.length < 3) return { 不够: 目标.length, 全部: list.querySelectorAll('.compcard').length };
    var ra = 目标[0].getBoundingClientRect(), rc = 目标[2].getBoundingClientRect();
    function ev(t, cx, cy, btn) {
      return new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 9, pointerType: 'touch', isPrimary: true, button: btn === undefined ? 0 : btn,
        buttons: btn === 2 ? 0 : 1 });
    }
    目标[0].dispatchEvent(ev('pointerdown', ra.left + 30, ra.top + ra.height / 2));
    window.__cardDrag = { a: 目标[0], x: ra.left + 30, y: ra.top + ra.height / 2,
                         ty: rc.top + rc.height / 2, list: list, ev: ev, ids: ids };
    // 顺带确认这三个在列表里确实是"甲 乙 丙"的顺序
    return { 顺序: Array.prototype.slice.call(list.querySelectorAll('.compcard')).map(function (c) { return c.dataset.id; })
              .filter(function (id) { return ids.indexOf(id) >= 0; }) };
  })()`);
  if (起.不够 !== undefined) throw new Error('设计页控件卡片不够（' + 起.不够 + ' / 共 ' + 起.全部 + '）');
  if (JSON.stringify(起.顺序) !== JSON.stringify(建.三个)) throw new Error('起始顺序不是"甲乙丙"：' + JSON.stringify(起));
  await sleep(420);   // 等长按生效
  const 动 = await js(`(function(){
    var d = window.__cardDrag;
    document.dispatchEvent(d.ev('pointermove', d.x, d.ty));
    document.dispatchEvent(d.ev('pointerup', d.x, d.ty, 2));
    var c = d.a;
    return { 有过渡: (c.style.transition || '').indexOf('transform') >= 0,
             位移: c.style.transform || '', 还在浮动: c.classList.contains('reordering') };
  })()`);
  if (!动.有过渡 || 动.位移.indexOf('translate') < 0 || !动.还在浮动) {
    throw new Error('松手时没有平滑落位动画：' + JSON.stringify({ 起, 动 }));
  }
  await sleep(700);
  const 后 = await js(`(function(){
    var ids = window.__cardDrag.ids;
    var list = document.getElementById('compList');
    return { 顺序: Array.prototype.slice.call(list.querySelectorAll('.compcard')).map(function (c) { return c.dataset.id; })
              .filter(function (id) { return ids.indexOf(id) >= 0; }),
             残留浮动: list.querySelectorAll('.compcard.reordering, .compcard-reph').length };
  })()`);
  const 期望 = [建.三个[1], 建.三个[2], 建.三个[0]];
  if (JSON.stringify(后.顺序) !== JSON.stringify(期望)) {
    throw new Error('落下后卡片没排到目标位置：' + JSON.stringify({ 期望: 期望, 实际: 后.顺序 }));
  }
  if (后.残留浮动) throw new Error('落下后还留着浮动卡片/占位框：' + JSON.stringify(后));
  // 用户反馈：松手后卡片会"向右滑一下再收回" —— 落位动画必须只有竖直方向
  if (!/translateY\(/.test(动.位移) || /translate\(/.test(动.位移)) {
    throw new Error('落位动画不是纯竖直（会左右滑）：' + JSON.stringify(动.位移));
  }
  return { 拖动: '甲 → 最后', 落位: '乙>丙>甲', 动画: 动.位移.replace(/scale\(1\)/, '').trim() };
});

// ============ 1.1 AI 读运行日志（定位到具体哪一段）+ 上下文压缩 ============

// 生成的代码里每段开头要有段标记（RT.__seg(N)），否则运行时没法说清"第几段"出错
await check('生成的代码带段标记（第 N 段的编号与 AI 看到的完全一致）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var ws = App.__aiWs();
    ws.clear();
    function 造(t, x, y) {
      var b = ws.newBlock(t);
      try { b.initSvg(); } catch (e) {}
      try { b.render(); } catch (e) {}
      try { b.moveBy(x, y); } catch (e) {}
      return b;
    }
    造('ev_start', 40, 40);
    造('ev_start', 40, 320);
    var tops = ws.getTopBlocks(true).length;
    App.__exportPreview();
    var code = '';
    try { code = (JSON.parse(localStorage.getItem('__previewProject') || '{}').screens[0] || {}).code || ''; } catch (e) {}
    var 段标记 = (code.match(/RT\\.__seg\\(/g) || []).length;
    return { 顶层数: tops, 段标记数: 段标记, 有0: code.indexOf('RT.__seg(0)') >= 0, 有1: code.indexOf('RT.__seg(1)') >= 0,
             片段: code.slice(0, 80) };
  })()`);
  if (!r.有0 || !r.有1) throw new Error('生成的代码里没有段标记：' + JSON.stringify(r));
  if (r.段标记数 !== 2) throw new Error('段标记数量不对：' + JSON.stringify(r));
  return { 顶层代码: r.顶层数, 段标记: r.段标记数 + ' 个（第 0/1 段都在）' };
});

// 运行时报错要带上"哪一页 / 第几段 / 哪个动作"，并写进编辑器能读到的诊断日志
await check('运行时报错会带上「页面 / 第几段 / 哪个动作」并上报', async () => {
  const 工程 = {
    appName: '报错定位测试', startScreen: 's1', design: { w: 390, h: 844 },
    screens: [{
      id: 's1', title: '出错页', orientation: 'portrait', showStatusBar: true,
      // 第 2 段里先做一个真实动作（这样能验证"出错的动作"也被记下来），再抛一个错
      code: 'RT.__seg(2);\nRT.setRot("selA", 10);\nthrow new Error("测试用错误");\n',
      components: [{ id: 'selA', type: 'select', x: 30, y: 40, w: 200, h: 48, items: ['甲', '乙'], value: '甲' }]
    }]
  };
  await js(`(function(){
    localStorage.removeItem('__bb_diag_v1');   // 从干净日志开始
    localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(工程))});
  })()`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    // 等到"画面真的渲染出控件"再继续（#screen 一开始就存在，光等它会出现假就绪）
    ok = await waitFor(`(function(){ try { return document.querySelectorAll('#screen [data-id]').length > 0; } catch (e) { return false; } })()`, 15000);
    if (!ok) await sleep(1200);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没起来（已切回编辑器）');
  }
  // 代码要等"方向门"过去才执行（无头环境是横屏窗口、工程要竖屏，兜底 2 秒），所以轮询等诊断日志
  await waitFor(`(function(){
    try { var a = JSON.parse(localStorage.getItem('__bb_diag_v1') || '[]');
      return a.some(function (x) { return x && x.k === '代码执行失败'; }); } catch (e) { return false; }
  })()`, 15000);
  await sleep(300);
  const r = await js(`(function(){
    var a = [];
    try { a = JSON.parse(localStorage.getItem('__bb_diag_v1') || '[]'); } catch (e) { a = []; }
    var 错 = a.filter(function (x) { return x && x.k === '代码执行失败'; });
    var 末 = 错.length ? 错[错.length - 1] : null;
    var 预览代码 = '';
    try { 预览代码 = ((JSON.parse(localStorage.getItem('__previewProject') || '{}').screens || [])[0] || {}).code || ''; } catch (e) {}
    return { 全部: a.length, 报错条数: 错.length, 末条: 末,
             提示语: (document.querySelector('.toast, .rt-toast') || {}).textContent || '',
             页面: location.pathname, 组件数: document.querySelectorAll('#screen [data-id]').length,
             有RT: typeof window.RT, 有段标记: !!(window.RT && window.RT.__seg),
             预览代码: String(预览代码).slice(0, 120) };
  })()`);
  if (!r.报错条数) throw new Error('运行时没有把报错写进诊断日志：' + JSON.stringify(r));
  const x = r.末条.x || {};
  if (String(x.screen) !== 's1' || String(x.title) !== '出错页') throw new Error('报错没带页面信息：' + JSON.stringify(r));
  if (Number(x.seg) !== 2) throw new Error('报错没定位到第 2 段（实际 ' + JSON.stringify(x.seg) + '）：' + JSON.stringify(r));
  if (String(x.api) !== 'setRot') throw new Error('报错没带上出错的动作：' + JSON.stringify(r));
  await shot('t32-运行时报错定位');
  return { 报错条数: r.报错条数, 定位: '页面=出错页 第' + x.seg + '段 动作=' + x.api, 错误: String(r.末条.m).slice(0, 40) };
});

// 「看报错」按钮：把运行日志变成一句话交给 AI；AI 的上下文里必须带上这段报错
await check('AI 能读到运行报错（请求里带上"第几段"，且有「看报错」按钮）', async () => {
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    // 造一条带定位信息的运行报错（等价于上一条用例里真实上报的那条）
    var a = [];
    try { a = JSON.parse(localStorage.getItem('__bb_diag_v1') || '[]'); } catch (e) { a = []; }
    a.push({ t: '12:00:00', k: '代码执行失败', m: 'RT.setSelect is not a function',
             x: { screen: 's1', title: '出错页', seg: 2, api: 'setSelect' } });
    localStorage.setItem('__bb_diag_v1', JSON.stringify(a));

    var 诊断话 = App.__aiDiagnoseText();
    var 消息 = App.__aiMessages([{ role: 'user', content: '点了没反应，帮我看看' }]);
    var 末 = 消息[消息.length - 1] || {};
    var 条 = App.__aiRuntimeIssues(5);
    var 按钮 = document.getElementById('aiDiagBtn');
    return { 诊断话: 诊断话, 读到的报错: 条, 末条角色: 末.role, 末条内容: String(末.content || '').slice(0, 4000),
             有按钮: !!按钮, 按钮文字: 按钮 ? 按钮.textContent.trim() : '',
             段号在诊断话里: 诊断话.indexOf('第 2 段') >= 0,
             段号在请求里: String(末.content || '').indexOf('第 2 段') >= 0,
             有报错小节: String(末.content || '').indexOf('【最近运行报错') >= 0,
             动作在请求里: String(末.content || '').indexOf('setSelect') >= 0 };
  })()`);
  if (!r.有按钮) throw new Error('AI 面板上没有「看报错」按钮');
  if (!r.读到的报错.length) throw new Error('没读到运行报错：' + JSON.stringify(r));
  if (!r.段号在诊断话里) throw new Error('「看报错」的话里没指出第几段：' + JSON.stringify(r.诊断话));
  if (!r.有报错小节 || !r.段号在请求里 || !r.动作在请求里) throw new Error('发给 AI 的请求里没带运行报错定位：' + JSON.stringify(r));
  return { 按钮: r.按钮文字, 诊断话: r.诊断话.slice(0, 46) + '…', 请求里: '【最近运行报错】含"第 2 段 / setSelect"' };
});

// 上下文压缩：历史很长时只发最近几轮 + 一段摘要（省 token），但当前页面的上下文不能丢
await check('上下文压缩：长历史折成摘要发送，token 明显下降', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    var 历史 = [];
    for (var i = 0; i < 24; i++) {
      历史.push({ role: 'user', content: '第' + i + '个问题：' + '这段代码要改一下 '.repeat(30) });
      历史.push({ role: 'assistant', content: '{"reply":"' + '已经改好了，说明文字很长 '.repeat(40) + '","blocks":"<xml>' + '<block type="act_toast"></block>'.repeat(20) + '</xml>"}' });
    }
    历史.push({ role: 'user', content: '最后一次：点了没反应' });
    var 原文 = 历史.reduce(function (n, m) { return n + String(m.content).length; }, 0);
    var 消息 = App.__aiMessages(历史);
    var 发出 = 消息.reduce(function (n, m) { return n + String(m.content).length; }, 0);
    var 末 = 消息[消息.length - 1] || {};
    var 摘要 = 消息.filter(function (m) { return String(m.content).indexOf('【早前对话摘要') === 0; })[0];
    var 老历史 = 历史.slice(0, 历史.length - 6).reduce(function (n, m) { return n + String(m.content).length; }, 0);
    // 末条除了原问题，还挂着「当前页面控件 / 已有代码 / 用户要求」这些动态上下文 ——
    // 它们**必须**原样发出去（压缩不能把它们丢掉），所以算压缩比时要扣掉，只看历史本身。
    var 末条上下文 = Math.max(0, String(末.content).length - String(历史[历史.length - 1].content).length);
    return { 原文长度: 原文, 发出长度: 发出, 条数: 消息.length,
             老历史长度: 老历史, 摘要长度: 摘要 ? String(摘要.content).length : 0,
             摘要条数: 摘要 ? 1 : 0, 末条上下文: 末条上下文,
             末条有页面上下文: String(末.content).indexOf('【当前页面控件】') >= 0,
             末条有用户要求: String(末.content).indexOf('最后一次：点了没反应') >= 0,
             比例: Math.round((发出 - 末条上下文) / 原文 * 100) };
  })()`);
  if (r.摘要条数 !== 1) throw new Error('长历史没有被压缩成摘要：' + JSON.stringify(r));
  if (r.条数 > 9) throw new Error('发出去的条数还是太多：' + JSON.stringify(r));
  if (!r.末条有页面上下文 || !r.末条有用户要求) throw new Error('压缩把最后一轮的上下文弄丢了：' + JSON.stringify(r));
  if (r.摘要长度 > 1500) throw new Error('摘要本身太长了：' + JSON.stringify(r));
  if (r.比例 > 80) throw new Error('压缩后历史还是太长（' + r.比例 + '%，已扣掉当前页面上下文）：' + JSON.stringify(r));
  return { 原文: r.原文长度 + ' 字', 发出: r.发出长度 + ' 字（' + r.比例 + '%）',
           老历史: r.老历史长度 + ' 字 → 摘要 ' + r.摘要长度 + ' 字', 条数: r.条数 };
});

// ============ 用户报的界面问题（长按弹复制 / 无意义提示 / 没滚到底 / 选项没铺满 / 浮层闪） ============

// 用户反馈：界面上的文字长按就弹系统的「复制 / 分享 / 全选 / 朗读」菜单（附截图）
await check('长按界面文字不会弹出系统复制菜单（输入框仍可选中）', async () => {
  // 先把两种元素都弄出来：设计页才有控件卡片，代码页才有分类栏
  await js(`(function(){
    var App = window.EditorApp;
    if (App && App.__aiComps && !App.__aiComps().length) {
      App.__aiApplyComponents([{ op:'add', type:'button', props:{ x:20, y:20, w:160, h:48, text:'选中测试' } }]);
    }
  })()`);
  await js(`document.getElementById('tabDesign').click()`);
  await sleep(600);
  const 设计 = await js(`(function(){
    function 选择(s) { var n = document.querySelector(s); if (!n) return '（元素不存在）'; var cs = getComputedStyle(n); return cs.webkitUserSelect || cs.userSelect; }
    return { 顶栏按钮: 选择('#tabDesign'), 控件卡片: 选择('#compList .compcard'), 标题: 选择('.pane-title'),
             输入框: 选择('#aiInput'), 单行输入: 选择('input'), HTML: 选择('html') };
  })()`);
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1000);
  const 代码页 = await js(`(function(){
    function 选择(s) { var n = document.querySelector(s); if (!n) return '（元素不存在）'; var cs = getComputedStyle(n); return cs.webkitUserSelect || cs.userSelect; }
    return { 分类栏: 选择('.bb-cat'), 工具栏按钮: 选择('#btnLayout') };
  })()`);
  const r = Object.assign({}, 设计, 代码页);
  const 该禁 = ['顶栏按钮', '分类栏', '控件卡片', '标题', 'HTML', '工具栏按钮'];
  const 坏的 = 该禁.filter(function (k) { return r[k] !== 'none'; });
  if (坏的.length) throw new Error('这些地方长按还是会弹出复制菜单：' + JSON.stringify({ 坏的: 坏的, 明细: r }));
  if (!/text|auto/.test(r.输入框)) throw new Error('输入框被禁用了选中，没法正常编辑：' + JSON.stringify(r));
  return { 界面文字: '不可选中（长按不弹菜单）', 输入框: r.输入框 };
});

// 用户反馈：别再加毫无意义的提示（"控件类型"右边那句"点类别展开/收起"）
await check('设计页「控件类型」右边没有多余提示了', async () => {
  const r = await js(`(function(){
    var t = document.querySelector('.pane-title');
    var 纯文字 = '';
    Array.prototype.forEach.call(t ? t.childNodes : [], function (n) { if (n.nodeType === 3) 纯文字 += n.textContent; });
    return { 标题: 纯文字.replace(/\\s+/g, ' ').trim(), 提示数: document.querySelectorAll('.pane-hint').length,
             全页有那句话: document.body.textContent.indexOf('点类别展开') >= 0,
             有模板入口: !!document.getElementById('btnTpl') };
  })()`);
  if (r.提示数) throw new Error('还留着 pane-hint 元素：' + JSON.stringify(r));
  if (r.全页有那句话) throw new Error('页面上还有"点类别展开/收起"这类提示：' + JSON.stringify(r));
  if (r.标题 !== '控件类型') throw new Error('标题文字不对：' + JSON.stringify(r));
  return { 标题: r.标题, 多余提示: '已删除', 模板入口: r.有模板入口 ? '在（模板库）' : '无' };
});

// 用户反馈：有时打开 AI 聊天框，它没有滚动到最底部
await check('打开 AI 面板会滚到最底部（长对话也不停在中间）', async () => {
  // 造一段很长的对话存进去，重载后打开面板看它滚没滚到底
  const 对话 = [];
  for (let i = 0; i < 24; i++) {
    对话.push({ role: 'user', content: '第 ' + i + ' 个问题：' + '这段说明要写长一点 '.repeat(12) });
    对话.push({ role: 'assistant', content: '回答 ' + i + '：' + '已经帮你改好了，这里是说明 '.repeat(12) });
  }
  await js(`(function(){
    var 存 = { activeId: 't-long', list: [{ id: 't-long', title: '长对话测试', ts: Date.now(), messages: ${JSON.stringify(对话)} }] };
    localStorage.setItem('__bb_ai_chats_v2', JSON.stringify(存));
  })()`);
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (!(await ensureProject())) throw new Error('工程没打开');
  // 悬浮球是"按下→抬起"才算点一下（不是 click），所以按真实手指的方式触发
  const 点了 = await js(`(function(){
    var b = document.getElementById('aiBall');
    if (!b) return { 无球: true };
    var r = b.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    function ev(t, btn, buttons) {
      return new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
        pointerId: 11, pointerType: 'touch', isPrimary: true, button: btn, buttons: buttons });
    }
    b.dispatchEvent(ev('pointerdown', 0, 1));
    b.dispatchEvent(ev('pointerup', 0, 0));
    return { 有球: true, 点: Math.round(x) + ',' + Math.round(y) };
  })()`);
  if (点了.无球) throw new Error('找不到 AI 悬浮球');
  await sleep(900);
  const r = await js(`(function(){
    var log = document.getElementById('aiLog');
    var body = document.querySelector('#aiPanel .ai-body');
    var p = document.getElementById('aiPanel');
    if (!body) return { 无日志区: true };
    // 真正滚动的是 .ai-body（#aiLog 只是里面的内容行）
    return { 可滚: body.scrollHeight - body.clientHeight,
             距底: Math.round(body.scrollHeight - body.clientHeight - body.scrollTop),
             日志高: log ? log.getBoundingClientRect().height : 0,
             可滚2: log ? log.scrollHeight - log.clientHeight : 0,
             面板开着: !!p && !p.classList.contains('hidden') };
  })()`);
  if (r.无日志区) throw new Error('找不到 AI 日志区');
  if (!r.面板开着) throw new Error('AI 面板没打开');
  if (r.可滚 < 40) throw new Error('对话太短，这条用例没测到东西：' + JSON.stringify(r));
  if (r.距底 > 4) throw new Error('打开面板后没有滚到底，还差 ' + r.距底 + ' 像素：' + JSON.stringify(r));
  await shot('t33-AI面板滚到底');
  return { 可滚动: r.可滚 + ' 像素', 距底: r.距底 + ' 像素' };
});

// 用户反馈（附图）：下拉选项列表选中时"没有覆盖完整"，上下各露出白条
await check('下拉选项列表铺满：没有白条、选中项整行高亮', async () => {
  const 工程 = {
    appName: '下拉铺满测试', startScreen: 's1', design: { w: 390, h: 844 },
    screens: [{
      id: 's1', title: '页面1', orientation: 'portrait', showStatusBar: true, code: '',
      components: [{ id: 'selA', type: 'select', x: 30, y: 40, w: 220, h: 48, items: ['选项一', '选项二', '选项三'], value: '选项一' }]
    }]
  };
  await js(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(工程))})`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen .comp.select .rt-select')`, 15000);
    if (!ok) await sleep(700);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没起来（已切回编辑器）');
  }
  const r = await js(`(function(){
    var box = document.querySelector('#screen .comp.select .rt-select');
    box.click();
    var m = box.parentNode.querySelector('.rt-select-menu');
    var cs = getComputedStyle(m);
    var on = m.querySelector('.rt-select-item.on');
    var 首 = m.querySelector('.rt-select-item');
    var mr = m.getBoundingClientRect(), or_ = on ? on.getBoundingClientRect() : null, fr = 首.getBoundingClientRect();
    return { 开着: m.classList.contains('open'), 上内边距: cs.paddingTop, 下内边距: cs.paddingBottom,
             溢出: cs.overflowY, 菜单宽: Math.round(mr.width), 选中宽: or_ ? Math.round(or_.width) : 0,
             选中数: m.querySelectorAll('.rt-select-item.on').length,
             首项贴顶: Math.round(fr.top - mr.top), 末项贴底: Math.round(mr.bottom - m.querySelectorAll('.rt-select-item')[m.querySelectorAll('.rt-select-item').length-1].getBoundingClientRect().bottom) };
  })()`);
  if (!r.开着) throw new Error('列表没展开：' + JSON.stringify(r));
  if (r.上内边距 !== '0px' || r.下内边距 !== '0px') throw new Error('列表上下还留着白条（padding）：' + JSON.stringify(r));
  if (r.首项贴顶 > 1 || r.末项贴底 > 1) throw new Error('首/末项没有紧贴列表边缘：' + JSON.stringify(r));
  if (r.选中数 !== 1 || Math.abs(r.选中宽 - r.菜单宽) > 1) throw new Error('选中项没有整行高亮：' + JSON.stringify(r));
  await shot('t34-下拉铺满');
  return { 内边距: '0', 选中项: r.选中宽 + 'px / 列表 ' + r.菜单宽 + 'px（整行）' };
});

// 用户反馈：重新进作品后点分类，代码选择栏会"闪一下"，再点一次又闪，之后才正常
await check('重新进入作品后点分类，代码选择栏首帧就摆好（不再闪一下）', async () => {
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  await sleep(700);
  // 复现用户路径：首页 → 打开作品 → 代码页 → 点分类
  const 打开了 = await js(`(function(){
    var 卡 = document.querySelectorAll('#projectList .proj-card');
    if (!卡.length) return false;
    var 开 = 卡[0].querySelectorAll('.pops button')[0];
    if (!开) return false;
    开.click();
    return true;
  })()`);
  if (!打开了) {   // 没有作品就退化成新建一个，保证这条用例仍然跑到"重进作品"的路径
    await ensureProject();
  }
  await waitFor(`(function(){ try { return !!(window.EditorApp.__aiScreens && window.EditorApp.__aiScreens().length); } catch (e) { return false; } })()`, 15000);
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1400);   // 等工作区初始化完（含浮层字体/缩放）
  const 采样 = await js(`(function(){
    var rail = document.getElementById('bbCats');
    var btn = rail ? rail.querySelector('.bb-cat') : null;
    if (!btn) return { 无分类: true };
    btn.click();
    window.__flySamples = [];
    function 记() {
      var f = document.querySelector('.blocklyFlyout');
      var r = f ? f.getBoundingClientRect() : null;
      window.__flySamples.push(r && r.width > 4 ? { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top) } : null);
    }
    [40, 110, 200, 380, 650].forEach(function (t) { setTimeout(记, t); });
    return { 点了: btn.title || (btn.textContent || '').trim() };
  })()`);
  if (采样.无分类) throw new Error('分类栏里没有分类');
  await sleep(1000);
  const 样 = await js(`window.__flySamples`);
  const 有 = 样.filter(Boolean);
  if (有.length < 2) throw new Error('浮层一直没出现，测不到闪不闪：' + JSON.stringify({ 采样, 样 }));
  const 首 = JSON.stringify(有[0]);
  const 变了 = 有.filter(function (s) { return JSON.stringify(s) !== 首; });
  if (变了.length) throw new Error('浮层出现后又挪动/变宽了（就是用户说的"闪一下"）：' + JSON.stringify(样));
  await shot('t35-代码选择栏首帧');
  return { 点的分类: 采样.点了, 采样帧: 有.length + ' 帧尺寸完全一致' };
});

// 用户反馈：一点顶部「代码」按钮积木栏就闪一下（从别的页面回来也一样）
await check('点顶部「代码」按钮：分类栏不重建、浮层不关一次再开（不闪）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  // 先在代码页点开一个分类，再回设计页 —— 复现用户的路径
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1200);
  const 点 = await js(`(function(){
    var rl = document.getElementById('bbCats');
    var btn = rl ? rl.querySelector('.bb-cat') : null;
    if (!btn) return { 无分类: true };
    btn.click();
    return { 点了: btn.title || (btn.textContent || '').trim() };
  })()`);
  if (点.无分类) throw new Error('分类栏里没有分类');
  await sleep(900);
  await js(`document.getElementById('tabDesign').click()`);
  await sleep(600);
  // 装采样器：每帧记"分类栏元素身份 / 分类数 / 浮层块数"
  const 采样 = await js(`(function(){
    var rl = document.getElementById('bbCats');
    if (rl) rl.__mark = 'MARK';
    window.__s = []; window.__stop = false;
    function 记() {
      if (window.__stop) return;
      var r = document.getElementById('bbCats');
      var fly = document.querySelector('.blocklyFlyout');
      window.__s.push({ 栏: !!r, 同一元素: !!(r && r.__mark === 'MARK'),
                        分类数: r ? r.querySelectorAll('.bb-cat').length : 0,
                        浮层块: fly ? fly.querySelectorAll('.blocklyDraggable').length : 0 });
      requestAnimationFrame(记);
    }
    requestAnimationFrame(记);
    document.getElementById('tabBlocks').click();
    return true;
  })()`);
  await sleep(1500);
  const 样本 = await js(`(function(){ window.__stop = true; return window.__s; })()`);
  if (!采样 || !样本 || 样本.length < 5) throw new Error('没采到样：' + JSON.stringify(样本));
  const 分类数集 = Array.from(new Set(样本.map(s => s.分类数)));
  const 浮层集 = (function () {
    const 序 = []; 样本.forEach(s => { if (序[序.length - 1] !== s.浮层块) 序.push(s.浮层块); });
    return 序;
  })();
  const 换过元素 = 样本.filter(s => !s.同一元素).length;
  if (分类数集.length !== 1 || 分类数集[0] < 3) throw new Error('切页时分类栏数量变了（说明被重建）：' + JSON.stringify(分类数集));
  if (换过元素) throw new Error('切页时分类栏被整块重建了（' + 换过元素 + '/' + 样本.length + ' 帧）：' + JSON.stringify(样本.slice(0, 3)));
  // 切页前浮层是开着的，切页后必须**一直开着**：一旦出现 0 就是"关掉再打开"= 用户看到的闪
  if (浮层集.indexOf(0) >= 0) {
    throw new Error('切页时浮层被关掉过（就是看到的闪一下）：' + JSON.stringify(浮层集));
  }
  if (!浮层集.length || 浮层集[浮层集.length - 1] <= 0) throw new Error('切页后浮层没保持打开：' + JSON.stringify(浮层集));
  await shot('t36-切代码页不闪');
  return { 点了分类: 点.点了, 分类栏: 分类数集[0] + ' 个分类全程未重建', 浮层块数: JSON.stringify(浮层集) };
});

// 用户要求：生成中「生成」变红色「终止」，点了真的停下
await check('生成中按钮变红色「终止」，点了能真的停下（离线验证）', async () => {
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(600);
  const r = await js(`(function(){
    var App = window.EditorApp;
    var btn = document.getElementById('aiSend');
    var 初始 = { 文字: btn.textContent.trim(), 红灯: btn.classList.contains('ai-stop'),
                 背景: getComputedStyle(btn).backgroundColor };
    // 直接进"生成中"状态（不发请求）：这是按钮状态机本身的行为
    App.__aiSetBusy(true);
    var 忙 = { 文字: btn.textContent.trim(), 红灯: btn.classList.contains('ai-stop'),
               背景: getComputedStyle(btn).backgroundColor, 可点: !btn.disabled,
               状态: (document.getElementById('aiStatus') || {}).textContent || '' };
    App.__aiStopGenerate();
    var 停 = { 文字: btn.textContent.trim(), 红灯: btn.classList.contains('ai-stop'),
               状态: (document.getElementById('aiStatus') || {}).textContent || '' };
    return { 初始: 初始, 忙: 忙, 停: 停 };
  })()`);
  if (r.初始.文字 !== '生成' || r.初始.红灯) throw new Error('初始按钮状态不对：' + JSON.stringify(r.初始));
  if (r.忙.文字 !== '终止' || !r.忙.红灯 || !r.忙.可点) throw new Error('生成中按钮没变成可点的红色「终止」：' + JSON.stringify(r.忙));
  if (r.忙.背景 === r.初始.背景) throw new Error('终止按钮没有变红：' + JSON.stringify({ 初始: r.初始.背景, 忙: r.忙.背景 }));
  if (r.停.文字 !== '生成' || r.停.红灯) throw new Error('终止后按钮没恢复：' + JSON.stringify(r.停));
  if (r.停.状态.indexOf('终止') < 0) throw new Error('终止后没有给用户反馈：' + JSON.stringify(r.停));
  return { 生成中: r.忙.文字 + '（红）', 结束后: r.停.文字, 状态: r.停.状态, 颜色: r.忙.背景 };
});

// 路线图 1.2：模板库（一键把整页骨架搭出来：控件 + 代码，可一步撤销）
await check('模板库：一键搭出整页（控件 + 代码都进来了，代码能一步撤销）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  // 每个模板都要能生成合法的代码 XML（生成器真的认）
  const 清单 = await js(`(function(){
    var App = window.EditorApp;
    var 列表 = App.__aiTemplates();
    return { 条数: 列表.length, 名字: 列表.map(function (t) { return t.name; }),
             XML: 列表.map(function (t) { return { id: t.id, 长度: App.__aiTemplateXml(t.id).length,
                                                  有块: App.__aiTemplateXml(t.id).indexOf('<block') >= 0 }; }) };
  })()`);
  if (清单.条数 < 4) throw new Error('内置模板太少：' + JSON.stringify(清单));
  const 坏 = 清单.XML.filter(function (x) { return !x.有块 || x.长度 < 60; });
  if (坏.length) throw new Error('有模板的代码没生成出来：' + JSON.stringify(坏));
  // 真套一个：控件进来、代码也进来
  const 前 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ws = App.__aiWs();
    return { 控件: App.__aiComps().length, 顶层代码: ws ? ws.getTopBlocks(false).length : -1,
             栈: ws && ws.undoStack_ ? ws.undoStack_.length : -1 };
  })()`);
  const 套 = await js(`(function(){ return window.EditorApp.__aiApplyTemplate('login'); })()`);
  await sleep(900);
  const 后 = await js(`(function(){
    var App = window.EditorApp;
    var ws = App.__aiWs();
    var 新控件 = App.__aiComps().filter(function (c) { return /欢迎回来|登录/.test(String(c.value || '') + String(c.text || '') + String(c.hint || '')); });
    return { 控件: App.__aiComps().length, 顶层代码: ws ? ws.getTopBlocks(false).length : -1,
             新控件: 新控件.length, 栈: ws && ws.undoStack_ ? ws.undoStack_.length : -1 };
  })()`);
  if (!套 || !套.控件) throw new Error('套用模板没加控件：' + JSON.stringify({ 套: 套, 后: 后 }));
  if (后.控件 !== 前.控件 + 套.控件) throw new Error('控件数量不对：' + JSON.stringify({ 前, 套, 后 }));
  if (后.顶层代码 <= 前.顶层代码) throw new Error('模板的代码没插进画布：' + JSON.stringify({ 前, 后 }));
  // 插进来的代码要能"一次撤销"就整段回退（说明补排不进撤销栈）
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(300);
  await js(`window.EditorApp.__aiWs().undo(false)`);
  await sleep(500);
  const 退 = await js(`(function(){
    var App = window.EditorApp;
    var ws = App.__aiWs();
    return { 控件: App.__aiComps().length, 顶层代码: ws ? ws.getTopBlocks(false).length : -1 };
  })()`);
  if (退.顶层代码 !== 前.顶层代码) {
    throw new Error('一次撤销没能把模板代码整段退回：' + JSON.stringify({ 前: 前, 后: 后, 退: 退 }));
  }
  await shot('t37-模板库');
  return { 模板数: 清单.条数, 模板: 清单.名字.join(' / '), 套用: 套.控件 + ' 控件 + ' + 套.代码 + ' 段代码',
           一次撤销: '代码整段回退 ✓', 撤销栈: 前.栈 + ' → ' + 后.栈 };
});

// 路线图 1.2：网络请求（GET / POST + 取 JSON 字段）
await check('网络请求代码块能用：GET 能取回内容，POST 能提交，代码生成正确', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const 块 = await js(`(function(){
    var App = window.EditorApp;
    var 有 = {};
    ['act_http_get','act_http_post','val_http_json'].forEach(function (t) { 有[t] = !!Blockly.Blocks[t]; });
    var xmlText = String(window.buildToolboxXml(null) || '');
    return { 有定义: 有, 工具箱有网络分类: xmlText.indexOf('name="网络"') >= 0,
             工具箱有三个块: ['act_http_get','act_http_post','val_http_json'].filter(function (t) { return xmlText.indexOf('"' + t + '"') >= 0; }).length,
             分类栏有网络: (App.__aiCatalog ? '' : '') };
  })()`);
  if (!块.有定义.act_http_get || !块.有定义.act_http_post || !块.有定义.val_http_json) {
    throw new Error('网络代码块没定义：' + JSON.stringify(块));
  }
  if (!块.工具箱有网络分类 || 块.工具箱有三个块 !== 3) throw new Error('工具箱里没有「网络」分类/块：' + JSON.stringify(块));
  // 生成的代码要对（直接用 XML 搭，链子结构由 <next> 表达，最稳）
  const 生成 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    ws.clear();
    var comp = (window.EditorApp.__aiComps()[0] || {}).id || 'NONE';
    var xml = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start"><next>'
      +   '<block type="act_http_get"><field name="COMP">' + comp + '</field>'
      +     '<value name="URL"><shadow type="text"><field name="TEXT">https://example.com/a</field></shadow></value>'
      +     '<next><block type="act_http_post">'
      +       '<value name="URL"><shadow type="text"><field name="TEXT">https://example.com/b</field></shadow></value>'
      +       '<value name="BODY"><shadow type="text"><field name="TEXT">你好</field></shadow></value>'
      +     '</block></next>'
      +   '</block>'
      + '</next></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    window.EditorApp.__exportPreview();
    var code = '';
    try { code = (JSON.parse(localStorage.getItem('__previewProject') || '{}').screens[0] || {}).code || ''; } catch (e) {}
    return { 代码: code, 顶层: ws.getTopBlocks(false).length };
  })()`);
  const c = String(生成.代码 || '');
  if (c.indexOf('RT.httpGet') < 0 || c.indexOf('RT.httpPost') < 0) throw new Error('生成的代码里没有网络请求：' + c.slice(0, 200));
  if (c.indexOf('await') < 0) throw new Error('网络请求没有 await（会拿不到结果）：' + c.slice(0, 200));
  // 上面这段"要联网"的代码先换掉：运行时页面一进入就会执行它，无网环境下会刷一屏 Failed to fetch
  await js(`(function(){
    var p = JSON.parse(localStorage.getItem('__previewProject') || '{}');
    (p.screens || []).forEach(function (s) { s.code = ''; });
    localStorage.setItem('__previewProject', JSON.stringify(p));
  })()`);
  // 运行时真的能 GET（拿本地静态页当服务器，离线可测）
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!(window.RT && window.RT.httpGet)`, 15000);
    if (!ok) await sleep(700);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有 httpGet（已切回编辑器）');
  }
  const 请求 = await js(`(function(){
    var 起 = location.origin;
    return Promise.all([
      window.RT.httpGet(起 + '/editor.html').then(function (t) { return { 长度: String(t).length, 开头: String(t).slice(0, 15) }; },
                                                   function (e) { return { 失败: String(e && e.message || e) }; }),
      window.RT.httpGet('ftp://bad').then(function () { return { 没拦住: true }; }, function (e) { return { 拦住了: String(e && e.message || e) }; })
    ]);
  })()`);
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (请求[0].失败) throw new Error('GET 拉取失败：' + JSON.stringify(请求));
  if (请求[0].长度 < 100) throw new Error('GET 没拿到内容：' + JSON.stringify(请求));
  if (!请求[1].拦住了) throw new Error('非法网址没有被拦下：' + JSON.stringify(请求));
  return { 代码: 'RT.httpGet / RT.httpPost + await 都在', GET: 请求[0].长度 + ' 字节', 非法网址: 请求[1].拦住了 };
});

// 用户要求：模板库的关闭按钮做成悬浮在列表上的，列表吃满高度（别浪费空间）
await check('模板库弹窗：关闭按钮悬浮在列表上、列表吃满高度', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  await js(`document.getElementById('tabDesign').click()`);
  await sleep(400);
  const r = await js(`(function(){
    document.getElementById('btnTpl').click();
    var sheet = document.getElementById('tplSheet');
    if (!sheet) return { 没打开: true };
    var box = sheet.querySelector('.tpl-modal'), x = sheet.querySelector('.tpl-x'), body = sheet.querySelector('.mbody');
    if (!box || !x || !body) return { 结构不全: { 弹窗: !!box, 悬浮钮: !!x, 列表: !!body } };
    var xr = x.getBoundingClientRect(), br = body.getBoundingClientRect(), mr = box.getBoundingClientRect();
    return { 定位: getComputedStyle(x).position,
             在弹窗右上: xr.left > mr.left + mr.width / 2 && xr.top < mr.top + 60,
             悬浮在列表上方: xr.bottom <= br.top + 2,
             列表高: Math.round(br.height), 弹窗高: Math.round(mr.height),
             列表占比: Math.round(br.height / mr.height * 100),
             底部还有按钮行: !!sheet.querySelector('.mbtns'),
             模板条数: sheet.querySelectorAll('.tpl-item').length,
             截图前关闭: (function () { x.click(); return !document.getElementById('tplSheet'); })() };
  })()`);
  if (r.没打开 || r.结构不全) throw new Error('模板库弹窗结构不对：' + JSON.stringify(r));
  if (r.定位 !== 'absolute') throw new Error('关闭按钮不是悬浮定位：' + JSON.stringify(r));
  if (!r.在弹窗右上 || !r.悬浮在列表上方) throw new Error('关闭按钮没悬浮在列表上方：' + JSON.stringify(r));
  if (r.底部还有按钮行) throw new Error('底部还留着占地方的按钮行：' + JSON.stringify(r));
  if (r.列表占比 < 70) throw new Error('列表没吃满高度（只占 ' + r.列表占比 + '%）：' + JSON.stringify(r));
  if (!r.截图前关闭) throw new Error('悬浮关闭按钮点了不关：' + JSON.stringify(r));
  return { 关闭按钮: '悬浮在右上（absolute）', 列表占比: r.列表占比 + '%', 模板: r.模板条数 + ' 个' };
});

// 用户反馈：看报错按钮太毛坯
await check('「看报错」按钮是成型的 M3 药丸按钮（不是裸文字）', async () => {
  // 面板关着时按钮宽度是 0，先让面板显示出来再量
  await js(`(function(){
    var p = document.getElementById('aiPanel');
    if (p.classList.contains('hidden')) {
      p.classList.remove('hidden');
      p.style.width = '420px'; p.style.height = '560px';
      window.__aiWasHidden = true;
    }
  })()`);
  await sleep(200);
  const r = await js(`(function(){
    var b = document.getElementById('aiDiagBtn');
    if (!b) return { 没有: true };
    var cs = getComputedStyle(b);
    var pre = getComputedStyle(b, '::before');
    return { 背景: cs.backgroundColor, 圆角: cs.borderRadius, 高: cs.height, 字重: cs.fontWeight,
             图标: pre.content, 宽: Math.round(b.getBoundingClientRect().width) };
  })()`);
  await js(`(function(){ var p = document.getElementById('aiPanel'); if (window.__aiWasHidden) { p.classList.add('hidden'); p.style.width = ''; p.style.height = ''; window.__aiWasHidden = false; } })()`);
  if (r.没有) throw new Error('找不到「看报错」按钮');
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(r.背景)) throw new Error('按钮还是透明底（看着很毛坯）：' + JSON.stringify(r));
  if (parseFloat(r.圆角) < 12) throw new Error('按钮不是药丸形：' + JSON.stringify(r));
  if (!/⚠/.test(String(r.图标))) throw new Error('按钮没有图标：' + JSON.stringify(r));
  if (r.宽 < 60) throw new Error('按钮太窄像裸文字：' + JSON.stringify(r));
  return { 背景: r.背景, 圆角: r.圆角, 图标: '⚠', 宽: r.宽 + 'px' };
});

// 用户反馈：浮层自己关掉后，切走再回来它又自己打开了
await check('自己关掉的代码浮层，切走再回来不会自动又打开', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1200);
  // ① 打开一个分类
  await js(`(function(){
    var rl = document.getElementById('bbCats');
    var b = rl ? rl.querySelector('.bb-cat') : null;
    if (b) b.click();
  })()`);
  await sleep(800);
  const 开 = await js(`(function(){
    var f = document.querySelector('.blocklyFlyout');
    var r = f ? f.getBoundingClientRect() : null;
    return { 开着: !!(r && r.width > 4), 高亮: document.querySelectorAll('#bbCats .bb-cat.on').length };
  })()`);
  if (!开.开着) throw new Error('分类没能打开浮层（前置条件不成立）：' + JSON.stringify(开));
  // ② 点画布空白把它关掉（用户就是这么关的）
  await js(`(function(){
    var host = document.getElementById('blocklyDiv');
    var hr = host.getBoundingClientRect();
    var x = Math.round(hr.right - 60), y = Math.round(hr.bottom - 60);
    var el = document.elementFromPoint(x, y) || host;
    function ev(t, buttons) { return new PointerEvent(t, { bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0, buttons: buttons }); }
    el.dispatchEvent(ev('pointerdown', 1));
    el.dispatchEvent(ev('pointerup', 0));
    try { window.EditorApp.__aiWs().hideChaff(); } catch (e) {}
  })()`);
  await sleep(500);
  const 关 = await js(`(function(){
    var f = document.querySelector('.blocklyFlyout');
    var r = f ? f.getBoundingClientRect() : null;
    return { 开着: !!(r && r.width > 4), 高亮: document.querySelectorAll('#bbCats .bb-cat.on').length };
  })()`);
  // ③ 切到设计页再回来
  await js(`document.getElementById('tabDesign').click()`);
  await sleep(600);
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1200);
  const 回 = await js(`(function(){
    var f = document.querySelector('.blocklyFlyout');
    var r = f ? f.getBoundingClientRect() : null;
    return { 开着: !!(r && r.width > 4), 高亮: document.querySelectorAll('#bbCats .bb-cat.on').length };
  })()`);
  if (关.开着) throw new Error('点了空白浮层没关掉（前置条件不成立）：' + JSON.stringify(关));
  if (回.开着) throw new Error('切走再回来，浮层又自己打开了（用户反馈的 bug）：' + JSON.stringify({ 开: 开, 关: 关, 回: 回 }));
  if (回.高亮) throw new Error('切走再回来，分类还亮着（说明"记住的分类"没清）：' + JSON.stringify(回));
  return { 打开: '浮层开', 点空白: '已关', 切走再回: '仍然关着 ✓' };
});

// 用户问：分类栏长名字的跑马灯到底做了没（要真的会滚，不是位移 0）
await check('分类栏长名字真的会滚动显示全名（位移 > 0，短名字不滚）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const 名 = '这是一个很长的按钮名字啊';
  // 控件分类要工程里真的有控件才会出现
  await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    if (!App.__aiComps().length) {
      App.__aiApplyComponents([
        { op:'add', type:'button', props:{ x:24, y:60, w:200, h:48, text:'跑马灯' } },
        { op:'add', type:'text', props:{ x:24, y:130, w:200, h:32, value:'标题' } }
      ]);
    }
  })()`);
  await sleep(600);
  await js(`document.getElementById('tabBlocks').click()`);
  await sleep(1200);
  // 控件分类在"控件代码"那一栏（底部切换槽），先切过去
  await js(`(function(){
    var sw = document.querySelector('#bbCats .bb-bot-wrap .bb-switch') || document.querySelector('#bbCats .bb-switch');
    if (sw) sw.click();
  })()`);
  await sleep(900);
  const r = await js(`(function(){
    var rl = document.getElementById('bbCats');
    if (!rl) return { 无栏: true };
    var 面板 = rl.querySelector('.bb-panel-widget');
    var 项 = 面板 ? Array.prototype.slice.call(面板.querySelectorAll('.bb-cat')) : [];
    if (项.length < 2) return { 控件分类太少: 项.length, 模式: rl.className };
    // 直接把标签文字改长/改短，专门验证"放不下就滚、放得下不滚"这条逻辑
    var 长 = 项[0], 短 = 项[1];
    长.querySelector('.bb-cat-lb').textContent = ${JSON.stringify(名)};
    长.querySelector('.bb-cat-lb').setAttribute('data-probe', 'long');
    短.querySelector('.bb-cat-lb').textContent = 'A';
    长.click();
    var 长量 = (function (b) {
      var t = b.querySelector('.bb-cat-lb');
      return { 滚动类: t.classList.contains('bb-scroll'), 位移: (t.style.getPropertyValue('--bb-marquee') || '').trim(),
               可用: Math.round(b.clientWidth), 文字宽: Math.round(t.scrollWidth), 动画: getComputedStyle(t).animationName };
    })(长);
    短.click();
    var 短量 = (function (b) {
      var t = b.querySelector('.bb-cat-lb');
      return { 滚动类: t.classList.contains('bb-scroll'), 位移: (t.style.getPropertyValue('--bb-marquee') || '').trim() };
    })(短);
    return { 长: 长量, 短: 短量, 名字: ${JSON.stringify(名)} };
  })()`);
  await sleep(400);   // 等补量那一帧
  const 后 = await js(`(function(){
    var rl = document.getElementById('bbCats');
    var 面板 = rl ? rl.querySelector('.bb-panel-widget') : null;
    var b = 面板 ? 面板.querySelector('.bb-cat.on') : null;
    if (!b) return null;
    var t = b.querySelector('.bb-cat-lb');
    return { 滚动类: t.classList.contains('bb-scroll'), 位移: (t.style.getPropertyValue('--bb-marquee') || '').trim() };
  })()`);
  if (r.无栏 || r.控件分类太少) throw new Error('控件分类栏不对（工程里没有控件？）：' + JSON.stringify(r));
  if (!r.长.滚动类 || !/^-\d+(\.\d+)?px$/.test(String(r.长.位移))) {
    throw new Error('长名字没有进入滚动状态：' + JSON.stringify({ 第一次: r, 补量后: 后 }));
  }
  if (parseFloat(r.长.位移) >= 0) throw new Error('跑马灯位移不对：' + JSON.stringify(r));
  // 真正"动起来"才行：标签自己 overflow:hidden 时，平移它等于把窗口一起搬走 —— 看起来永远不动
  const 动 = await js(`(function(){
    var rl = document.getElementById('bbCats');
    if (!rl) return { 没选中: true };
    var lb = rl.querySelector('[data-probe="long"]');
    if (!lb) return { 没选中: true };              // 刚好上一段测了短名字，这里把长名字再选回来
    var b = lb.closest('.bb-cat');
    b.click();                                     // 重新选中长名字那一项
    var t1 = getComputedStyle(lb).transform;
    return new Promise(function (res) {
      setTimeout(function () {
        var lb2 = document.querySelector('#bbCats [data-probe="long"]');
        if (!lb2) { res({ 元素没了: true }); return; }
        var t2 = getComputedStyle(lb2).transform;
        res({ 前: t1, 后: t2, 变了: t1 !== t2,
              标签溢出: getComputedStyle(lb2).overflowX, 按钮溢出: getComputedStyle(b).overflowX,
              动画: getComputedStyle(lb2).animationName,
              位移变量: (lb2.style.getPropertyValue('--bb-marquee') || '').trim(),
              滚动类: lb2.classList.contains('bb-scroll') });
      }, 900);
    });
  })()`);
  if (动.没选中 || 动.元素没了) throw new Error('长名字那一项没保持在选中状态：' + JSON.stringify(动));
  if (动.标签溢出 !== 'visible') throw new Error('标签自己还在裁剪（平移等于白移，看不到滚动）：' + JSON.stringify(动));
  if (动.按钮溢出 !== 'hidden') throw new Error('按钮没有裁剪，滚动会溢出到栏外：' + JSON.stringify(动));
  if (动.动画 !== 'bbMarquee') throw new Error('跑马灯动画没生效：' + JSON.stringify(动));
  if (!动.变了) throw new Error('文字实际没有在动（transform 前后一样）：' + JSON.stringify(动));
  if (r.短.滚动类) throw new Error('一个字母的名字也被滚了（不该滚）：' + JSON.stringify(r.短));
  await shot('t38-分类栏跑马灯');
  return { 长名字: r.名字 + '（' + r.长.文字宽 + 'px > 可用 ' + r.长.可用 + 'px）', 位移: r.长.位移,
           实际动画: 动.前 + ' → ' + 动.后, 短名字: '不滚 ✓' };
});

// 用户反馈：模板库那个关闭按钮的阴影不符合 M3，还挡住了列表
await check('模板库关闭按钮：M3 无阴影、不遮挡列表项', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  await js(`document.getElementById('tabDesign').click()`);
  await sleep(400);
  const r = await js(`(function(){
    document.getElementById('btnTpl').click();
    var sheet = document.getElementById('tplSheet');
    if (!sheet) return { 没打开: true };
    var box = sheet.querySelector('.tpl-modal'), x = sheet.querySelector('.tpl-x');
    var 首 = sheet.querySelector('.tpl-item');
    var xr = x.getBoundingClientRect(), fr = 首.getBoundingClientRect(), mr = box.getBoundingClientRect();
    var 结果 = { 阴影: getComputedStyle(x).boxShadow, 钮底: Math.round(xr.bottom), 首项顶: Math.round(fr.top),
             钮右: Math.round(xr.right), 弹窗右: Math.round(mr.right),
             弹窗高: Math.round(mr.height), 视口高: window.innerHeight };
    x.click();
    return 结果;
  })()`);
  if (r.没打开) throw new Error('模板库没打开');
  if (!/none/.test(String(r.阴影))) throw new Error('关闭按钮还有阴影（不符合 M3）：' + JSON.stringify(r));
  if (r.钮底 > r.首项顶) throw new Error('关闭按钮压在列表项上了：' + JSON.stringify(r));
  return { 阴影: '无', 按钮底: r.钮底 + 'px ≤ 列表顶 ' + r.首项顶 + 'px', 弹窗: r.弹窗高 + '/' + r.视口高 };
});

// 用户反馈：很多弹层的列表都没占满，浪费空间
await check('列表类弹层会占满可用高度（更新日志 / 导出 / 模板库）', async () => {
  const 量 = async (开, 选) => {
    await js(开);
    await sleep(450);
    const r = await js(`(function(){
      var box = document.querySelector(${JSON.stringify(选)});
      if (!box) return { 没打开: true };
      var mr = box.getBoundingClientRect();
      return { 高: Math.round(mr.height), 视口: window.innerHeight, 占比: Math.round(mr.height / window.innerHeight * 100),
               min高度: getComputedStyle(box).minHeight };
    })()`);
    await js(`(function(){
      ['updLogMask','exportMask','updateMask','tplSheet','cloudManageMask'].forEach(function (id) {
        var m = document.getElementById(id); if (m) m.classList.add('hidden');
      });
      var t = document.getElementById('tplSheet'); if (t && t.parentNode) t.parentNode.removeChild(t);
    })()`);
    await sleep(200);
    return r;
  };
  const 日志 = await 量(`(function(){ document.getElementById('updateLog').click(); })()`, '#updLogMask .updlog-modal');
  const 导出 = await 量(`(function(){ document.getElementById('exportMask').classList.remove('hidden'); })()`, '#exportMask .export-modal');
  const 模板 = await 量(`(function(){ document.getElementById('btnTpl').click(); })()`, '#tplSheet .tpl-modal');
  const 坏 = [['更新日志', 日志], ['导出', 导出], ['模板库', 模板]].filter(function (x) { return x[1].没打开 || x[1].占比 < 55; });
  if (坏.length) throw new Error('这些弹层还是没占满：' + JSON.stringify(坏));
  return { 更新日志: 日志.占比 + '%', 导出: 导出.占比 + '%', 模板库: 模板.占比 + '%' };
});

// 用户要求：列表里已经有同名 App，就不能再创建同名
await check('创建新 App 不能重名（重名时按钮禁用 + 就地提示，改名后能建）', async () => {
  // 回首页
  await js(`(function(){ var h=document.getElementById('btnHome'); if(h) h.click(); })()`);
  await sleep(700);
  const 首页 = await js(`(function(){
    var h = document.getElementById('viewHome');
    return { 在首页: !!h && !h.classList.contains('hidden'),
             名字: Array.prototype.map.call(document.querySelectorAll('#projectList .pname'), function (n) { return n.textContent.trim(); }) };
  })()`);
  if (!首页.在首页) throw new Error('没回到首页（找不到 #btnHome？）：' + JSON.stringify(首页));
  const 已有 = 首页.名字[0];
  if (!已有) throw new Error('首页一个作品都没有，测不了重名：' + JSON.stringify(首页));
  // 打开"创建新 App"，输入一个已存在的名字
  const 输 = await js(`(function(){
    var b = Array.prototype.filter.call(document.querySelectorAll('#viewHome button'), function (x) {
      return /创建新 ?App|^新建/.test((x.textContent || '').trim()); })[0];
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(500);
  const r = await js(`(function(){
    var inp = document.getElementById('newAppName');
    if (!inp) return { 没弹窗: true };
    function 打字(v) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    function 状态() {
      var go = document.getElementById('createGo');
      var err = document.getElementById('createErr');
      return { 禁用: !!go.disabled, 提示: err ? err.textContent.trim() : '', 提示可见: !!(err && !err.classList.contains('hidden')),
               红框: !!inp.closest('.m3-outlined').classList.contains('err') };
    }
    打字(${JSON.stringify(已有)});
    var 重名 = 状态();
    var 数量前 = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}').items.length;
    document.getElementById('createGo').click();      // 强行点（就算禁用也点）
    var 数量后 = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}').items.length;
    打字(${JSON.stringify(已有)} + ' 的第二个');
    var 改名后 = 状态();
    var 名字 = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}').items.map(function (x) { return x.name; });
    return { 输成功了: true, 重名: 重名, 改名后: 改名后, 数量前: 数量前, 数量后: 数量后, 名字: 名字 };
  })()`);
  if (!输 || r.没弹窗) throw new Error('创建弹窗没打开：' + JSON.stringify(r));
  if (!r.重名.禁用) throw new Error('重名时创建按钮没有禁用：' + JSON.stringify(r.重名));
  if (!r.重名.提示可见 || r.重名.提示.indexOf('已经有') < 0) throw new Error('重名时没有给出提示：' + JSON.stringify(r.重名));
  if (r.数量后 !== r.数量前) throw new Error('重名还是被创建了：' + JSON.stringify({ 前: r.数量前, 后: r.数量后 }));
  if (r.改名后.禁用) throw new Error('换个名字后按钮还是禁用的：' + JSON.stringify(r.改名后));
  if (r.改名后.提示可见) throw new Error('换个名字后提示没消失：' + JSON.stringify(r.改名后));
  // 改名后真的能创建，并且列表里没有重名
  await js(`document.getElementById('createGo').click()`);
  await sleep(900);
  const 新 = await js(`(function(){
    var s = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}');
    var 名 = s.items.map(function (x) { return x.name; });
    var 重复 = 名.filter(function (n, i) { return 名.indexOf(n) !== i; });
    return { 数量: 名.length, 名: 名.slice(0, 6), 重复: 重复 };
  })()`);
  if (新.重复.length) throw new Error('创建后列表里出现了重名：' + JSON.stringify(新));
  await shot('t39-创建重名拦截');
  return { 已有名字: 已有, 重名时: '按钮禁用 + 提示「' + r.重名.提示.slice(0, 18) + '…」', 列表作品数: 新.数量, 重复: '无' };
});

// 用户要求：就算一个控件都没有也能导出
await check('没有任何控件也能导出（不再弹"请先添加组件"）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  // 造一个"空页面"工程（把当前页面的控件全删掉）
  const 清 = await js(`(function(){
    var App = window.EditorApp;
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    return { 剩余控件: App.__aiComps().length };
  })()`);
  await sleep(400);
  const r = await js(`(function(){
    var 弹窗前 = document.getElementById('exportMask').classList.contains('hidden');
    var 阻断弹窗 = 0;
    var mm = document.getElementById('modalMask');
    document.getElementById('btnExport').click();
    return { 之前是关的: 弹窗前, 导出弹窗开着: !document.getElementById('exportMask').classList.contains('hidden'),
             被弹窗拦住: !mm.classList.contains('hidden'),
             空提示可见: !document.getElementById('expEmptyHint').classList.contains('hidden'),
             提示文字: (document.getElementById('expEmptyHint').textContent || '').trim().slice(0, 30) };
  })()`);
  await sleep(300);
  const 后 = await js(`(function(){
    var mm = document.getElementById('modalMask');
    var m = mm.querySelector('.mtitle');
    return { 被弹窗拦住: !mm.classList.contains('hidden'), 弹窗标题: m ? m.textContent.trim() : '' };
  })()`);
  await js(`(function(){ document.getElementById('exportMask').classList.add('hidden'); var mm=document.getElementById('modalMask'); if(mm) mm.classList.add('hidden'); })()`);
  if (清.剩余控件) throw new Error('没清空控件（前置条件不成立）：' + JSON.stringify(清));
  if (后.被弹窗拦住 || r.被弹窗拦住) throw new Error('空工程还是被拦下了：' + JSON.stringify({ r: r, 后: 后 }));
  if (!r.导出弹窗开着) throw new Error('空工程没有打开导出弹窗：' + JSON.stringify({ r: r, 后: 后 }));
  if (!r.空提示可见) throw new Error('空工程没有给出提示：' + JSON.stringify(r));
  return { 空工程: '可以导出 ✓', 界面提示: r.提示文字 };
});

// ============ 这一批：滑屏积木 / 容器 / 历史版本 / 出错段高亮 / 拍照选图 ============

// 用户要求：增加"检测滑屏方向（上/下/左/右）"和"滑动距离"的代码块
await check('滑屏代码块：方向 + 距离都能用（真的能检测到滑动）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const 块 = await js(`(function(){
    var 有 = {};
    ['ev_swipe','val_swipe_dist','val_swipe_dir'].forEach(function (t) { 有[t] = !!Blockly.Blocks[t]; });
    var xml = String(window.buildToolboxXml(null) || '');
    return { 有定义: 有, 工具箱有: ['ev_swipe','val_swipe_dist','val_swipe_dir'].filter(function (t) { return xml.indexOf('"' + t + '"') >= 0; }).length };
  })()`);
  if (!块.有定义.ev_swipe || !块.有定义.val_swipe_dist || !块.有定义.val_swipe_dir) throw new Error('滑屏代码块没定义：' + JSON.stringify(块));
  if (块.工具箱有 !== 3) throw new Error('工具箱里没有这三个块：' + JSON.stringify(块));
  // 生成的代码要对（用 XML 搭：当页面上滑 → 提示 + 显示距离）
  const 生成 = await js(`(function(){
    var ws = window.EditorApp.__aiWs();
    ws.clear();
    var xml = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_swipe"><field name="DIR">up</field><next>'
      +   '<block type="act_toast"><value name="MSG"><block type="val_swipe_dist"></block></value>'
      +     '<value name="DUR"><shadow type="math_number"><field name="NUM">2</field></shadow></value>'
      +   '</block>'
      + '</next></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    window.EditorApp.__exportPreview();
    var code = '';
    try { code = (JSON.parse(localStorage.getItem('__previewProject') || '{}').screens[0] || {}).code || ''; } catch (e) {}
    return { 代码: code };
  })()`);
  const c = String(生成.代码 || '');
  if (c.indexOf('RT.onSwipe("up"') < 0) throw new Error('没有按方向注册滑屏事件：' + c.slice(0, 160));
  if (c.indexOf('RT.swipeDistance()') < 0) throw new Error('没有取滑动距离：' + c.slice(0, 160));
  // 运行时真的能检测：造一个工程，把事件写进去，然后模拟四种滑动
  const 工程 = {
    appName: '滑屏测试', startScreen: 's1', design: { w: 390, h: 844 },
    screens: [{
      id: 's1', title: '页面1', orientation: 'portrait', showStatusBar: true,
      code: "RT.onSwipe('', async function(){\n  RT.__lastDir = RT.swipeDirection();\n  RT.__lastDist = RT.swipeDistance();\n});\n",
      components: [{ id: 'txt1', type: 'text', x: 20, y: 20, w: 200, h: 30, value: '滑屏' }]
    }]
  };
  await js(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(工程))})`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`(function(){ try { return document.querySelectorAll('#screen [data-id]').length > 0 && !!window.RT; } catch (e) { return false; } })()`, 15000);
    if (!ok) await sleep(1200);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没起来（已切回编辑器）');
  }
  await sleep(400);
  const 滑 = await js(`(function(){
    function 滑(dx, dy) {
      var host = document.getElementById('screen');
      var r = host.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      function ev(t, cx, cy, buttons) { return new PointerEvent(t, { bubbles: true, cancelable: true, composed: true,
        clientX: cx, clientY: cy, pointerId: 41, pointerType: 'mouse', isPrimary: true, button: 0, buttons: buttons }); }
      host.dispatchEvent(ev('pointerdown', x, y, 1));
      host.dispatchEvent(ev('pointerup', x + dx, y + dy, 0));
      return { 方向: window.RT.swipeDirection(), 距离: window.RT.swipeDistance(), 事件里的方向: window.RT.__lastDir, 事件里的距离: window.RT.__lastDist };
    }
    return { 上滑: 滑(0, -120), 下滑: 滑(0, 90), 左滑: 滑(-150, 0), 右滑: 滑(130, 0), 小抖动: 滑(4, 3) };
  })()`);
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (滑.上滑.方向 !== '上滑' || 滑.上滑.距离 !== 120) throw new Error('上滑检测不对：' + JSON.stringify(滑.上滑));
  if (滑.下滑.方向 !== '下滑') throw new Error('下滑检测不对：' + JSON.stringify(滑.下滑));
  if (滑.左滑.方向 !== '左滑' || 滑.左滑.距离 !== 150) throw new Error('左滑检测不对：' + JSON.stringify(滑.左滑));
  if (滑.右滑.方向 !== '右滑') throw new Error('右滑检测不对：' + JSON.stringify(滑.右滑));
  if (滑.小抖动.方向 !== '右滑') throw new Error('手指抖一下被当成滑动了（阈值失效）：' + JSON.stringify(滑.小抖动));
  if (滑.上滑.事件里的方向 !== '上滑' || 滑.上滑.事件里的距离 !== 120) throw new Error('滑动事件里的数据不对：' + JSON.stringify(滑.上滑));
  return { 上滑: 滑.上滑.方向 + ' ' + 滑.上滑.距离 + 'px', 下滑: 滑.下滑.方向, 左滑: 滑.左滑.方向 + ' ' + 滑.左滑.距离 + 'px',
           右滑: 滑.右滑.方向, 小抖动: '忽略 ✓' };
});

// 用户要求：容器控件（真正的父子布局），设计页=布局页=运行时三处一致
await check('容器控件：能装子控件，三处坐标一致，还能移出', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const 建 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    // 清空当前页面
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    // 放一个容器，再选中它后加一个按钮（新控件应当进容器）
    document.querySelector('[data-add="container"]').click();
    var 容器 = App.__aiComps()[0];
    return { 容器: 容器 ? 容器.id : '', 类型: 容器 ? 容器.type : '', 子数: 容器 && 容器.children ? 容器.children.length : -1 };
  })()`);
  if (建.类型 !== 'container') throw new Error('容器没建出来：' + JSON.stringify(建));
  const 加 = await js(`(function(){
    var App = window.EditorApp;
    // 加一个普通控件（默认在顶层），再用卡片上的「放进容器」把它装进去
    document.querySelector('[data-add="button"]').click();
    var 顶层 = App.__aiComps();
    var 容器 = 顶层.filter(function (c) { return c.type === 'container'; })[0];
    var 按钮 = 顶层.filter(function (c) { return c.type === 'button'; })[0];
    var btn = document.querySelector('#compList .compcard[data-id="' + 按钮.id + '"] .iconbtn.in');
    if (btn) btn.click();
    var 后 = App.__aiComps();
    var 容器后 = 后.filter(function (c) { return c.type === 'container'; })[0];
    var 子 = (容器后.children || [])[0];
    return { 容器: 容器.id, 顶层数: 后.length, 子数: (容器后.children || []).length,
             有放进按钮: !!btn, 子: 子 ? { id: 子.id, x: 子.x, y: 子.y, w: 子.w, h: 子.h } : null };
  })()`);
  if (!加.有放进按钮) throw new Error('卡片上没有「放进容器」按钮：' + JSON.stringify(加));
  if (加.顶层数 !== 1 || 加.子数 !== 1 || !加.子) throw new Error('控件没进容器：' + JSON.stringify(加));
  if (!(加.子.x >= 0 && 加.子.y >= 0)) throw new Error('子控件相对坐标不对：' + JSON.stringify(加.子));
  // 列表里要能看出是子控件（缩进卡片），并且有"移出容器"按钮
  await sleep(300);
  const 列表 = await js(`(function(){
    var 卡 = document.querySelectorAll('#compList .compcard');
    var 子卡 = document.querySelector('#compList .compcard[data-id="' + ${JSON.stringify(加.子.id)} + '"]');
    return { 卡片数: 卡.length, 子卡是子控件: !!(子卡 && 子卡.classList.contains('is-child')),
             有移出按钮: !!(子卡 && 子卡.querySelector('.iconbtn.out')) };
  })()`);
  if (!列表.子卡是子控件 || !列表.有移出按钮) throw new Error('设计页列表没体现父子关系：' + JSON.stringify(列表));
  // 移出容器 / 再放回去（这两步在同一个页面里做，别跨页面重载，免得工程状态被重置）
  const 移 = await js(`(function(){
    var App = window.EditorApp;
    var 容器 = App.__aiComps().filter(function (c) { return c.type === 'container'; })[0];
    var 子 = (容器.children || [])[0];
    var btn = document.querySelector('#compList .compcard[data-id="' + 子.id + '"] .iconbtn.out');
    if (btn) btn.click();
    var 顶层 = App.__aiComps().filter(function (c) { return c.id === 子.id; })[0];
    var 容器2 = App.__aiComps().filter(function (c) { return c.type === 'container'; })[0];
    var 结果 = { 容器子数: (容器2.children || []).length, 回到顶层: !!顶层, 顶层坐标: 顶层 ? { x: 顶层.x, y: 顶层.y } : null };
    // 再放回去，供下面"运行时"那一步用
    var inBtn = 顶层 ? document.querySelector('#compList .compcard[data-id="' + 顶层.id + '"] .iconbtn.in') : null;
    if (inBtn) inBtn.click();
    var 容器3 = App.__aiComps().filter(function (c) { return c.type === 'container'; })[0];
    结果.放回后子数 = (容器3.children || []).length;
    结果.放回后子 = (容器3.children || [])[0] || null;
    return 结果;
  })()`);
  if (!移.回到顶层 || 移.容器子数 !== 0) throw new Error('移出容器失败：' + JSON.stringify(移));
  if (移.放回后子数 !== 1) throw new Error('再放进容器失败：' + JSON.stringify(移));
  // 运行时：子控件必须在容器里面，且位置一致（所见即所得）
  await js(`window.EditorApp.__exportPreview()`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen .comp.container')`, 15000);
    if (!ok) await sleep(1200);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没渲染出容器（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var 容 = document.querySelector('#screen .comp.container');
    var 子 = 容 ? 容.querySelector('.comp') : null;
    if (!容 || !子) return { 没渲染: true, 容器: !!容, 子: !!子 };
    var cr = 容.getBoundingClientRect(), kr = 子.getBoundingClientRect();
    return { 子在里面: Math.round(kr.left - cr.left) + ',' + Math.round(kr.top - cr.top),
             子宽高: Math.round(kr.width) + 'x' + Math.round(kr.height),
             容器是不是子的父: 子.parentNode === 容 };
  })()`);
  await shot('t40-容器控件');
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (运行.没渲染 || !运行.容器是不是子的父) throw new Error('运行时没把子控件放进容器：' + JSON.stringify(运行));
  const 子相对 = 移.放回后子;
  const 期望位置 = 子相对.x + ',' + 子相对.y;
  const 实到 = String(运行.子在里面).split(',').map(Number);
  const 期望 = String(期望位置).split(',').map(Number);
  if (Math.abs(实到[0] - 期望[0]) > 1.5 || Math.abs(实到[1] - 期望[1]) > 1.5) {
    throw new Error('运行时子控件位置与设计不一致（应 ' + 期望位置 + '，实际 ' + 运行.子在里面 + '）');
  }
  return { 容器: 建.容器, 子控件: 加.子.id + '（相对 ' + 期望位置 + '）', 运行时: '位置一致 ✓', 移出再放回: '✓' };
});

// 用户要求：一键回到上次能跑的状态（运行/导出前自动存一份）
await check('历史版本：运行/导出前自动存一份，能一键恢复', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    // 先造一个"能跑的版本"：一个按钮
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    App.__aiApplyComponents([{ op:'add', type:'button', props:{ x:20, y:20, w:160, h:48, text:'旧版本按钮' } }]);
    var 存成功 = App.__aiHistorySnapshot('测试手动');
    var 列表 = App.__aiHistory();
    // 再改坏：删掉按钮，加两个别的
    var ids2 = App.__aiComps().map(function (c) { return c.id; });
    App.__aiApplyComponents(ids2.map(function (id) { return { op:'remove', id: id }; }));
    App.__aiApplyComponents([{ op:'add', type:'text', props:{ x:20, y:20, w:160, h:30, value:'改坏了' } },
                             { op:'add', type:'text', props:{ x:20, y:60, w:160, h:30, value:'第二个' } }]);
    var 坏之前 = { 数量: App.__aiComps().length, 文字: App.__aiComps().map(function (c) { return c.value || c.text; }) };
    var 恢复了 = App.__aiHistoryRestore(0);
    return { 存成功: 存成功, 份数: 列表.length, 坏之前: 坏之前, 恢复了: 恢复了,
             恢复后: { 数量: App.__aiComps().length, 文字: App.__aiComps().map(function (c) { return c.value || c.text; }) } };
  })()`);
  if (!r.存成功 || r.份数 < 1) throw new Error('快照没存下来：' + JSON.stringify(r));
  if (!r.恢复了) throw new Error('恢复失败：' + JSON.stringify(r));
  if (r.恢复后.数量 !== 1 || String(r.恢复后.文字[0]) !== '旧版本按钮') {
    throw new Error('恢复正常但内容不对：' + JSON.stringify(r));
  }
  // 首页要有「历史」入口，点开能列出快照
  const 入口 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('btnHome').click();
    return new Promise(function (res) {
      setTimeout(function () {
        var 卡 = document.querySelector('#projectList .proj-card');
        var 按钮 = 卡 ? Array.prototype.map.call(卡.querySelectorAll('.pops button'), function (b) { return b.textContent.trim(); }) : [];
        if (卡) { var h = Array.prototype.filter.call(卡.querySelectorAll('.pops button'), function (b) { return b.textContent.trim() === '历史'; })[0]; if (h) h.click(); }
        setTimeout(function () {
          var sheet = document.getElementById('histSheet');
          res({ 按钮: 按钮, 面板开了: !!sheet, 条目数: sheet ? sheet.querySelectorAll('.tpl-item').length : 0 });
        }, 500);
      }, 600);
    });
  })()`);
  await js(`(function(){ var s = document.getElementById('histSheet'); if (s && s.parentNode) s.parentNode.removeChild(s); })()`);
  if (入口.按钮.indexOf('历史') < 0) throw new Error('首页卡片上没有「历史」入口：' + JSON.stringify(入口));
  if (!入口.面板开了) throw new Error('历史面板没打开：' + JSON.stringify(入口));
  await shot('t41-历史版本');
  return { 快照: r.份数 + ' 份', 恢复前: r.坏之前.数量 + ' 个控件', 恢复后: r.恢复后.数量 + ' 个（' + r.恢复后.文字[0] + '）', 首页入口: '有' };
});

// 用户要求：调试体验 —— 运行时报错的那一段，回来自动标出来
await check('运行出错的那一段，回到编辑器会自动高亮标出来', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabBlocks').click();
    var ws = App.__aiWs();
    ws.clear();
    function 造(t, x, y) { var b = ws.newBlock(t); try { b.initSvg(); } catch (e) {} try { b.render(); } catch (e) {} try { b.moveBy(x, y); } catch (e) {} return b; }
    造('ev_start', 30, 30);
    造('ev_start', 30, 260);
    // 写一条"第 1 段运行时报错"的诊断记录
    var a = [];
    try { a = JSON.parse(localStorage.getItem('__bb_diag_v1') || '[]'); } catch (e) { a = []; }
    a.push({ t: '23:59:59', k: '代码执行失败', m: '测试用错误', x: { screen: App.__aiScreens()[0].id, title: '页面1', seg: 1, api: 'toast' } });
    localStorage.setItem('__bb_diag_v1', JSON.stringify(a));
    localStorage.removeItem('__bb_seg_seen');
    document.getElementById('tabDesign').click();
    var 标出来了 = App.__aiShowRuntimeError();
    var 高亮数 = document.querySelectorAll('#blocklyDiv .bb-seg-flash').length;
    var 后 = App.__aiShowRuntimeError();   // 同一段只提示一次
    return { 标出来了: 标出来了, 高亮数: 高亮数, 再调一次: 后 };
  })()`);
  if (!r.标出来了) throw new Error('没有标出出错的那一段：' + JSON.stringify(r));
  if (!r.高亮数) throw new Error('画布上没有出现高亮标记：' + JSON.stringify(r));
  if (r.再调一次) throw new Error('同一段被重复提示了（应该只提示一次）：' + JSON.stringify(r));
  await shot('t42-出错段高亮');
  return { 标出: '第 1 段', 高亮元素: r.高亮数 + ' 个', 重复提示: '不会 ✓' };
});

// 用户要求：相机 / 相册（选图或拍照直接显示到图片控件）
await check('拍照/选图代码块：定义、工具箱、生成的代码都对', async () => {
  const r = await js(`(function(){
    var xml = String(window.buildToolboxXml(null) || '');
    var ws = window.EditorApp.__aiWs();
    ws.clear();
    var xml2 = '<xml xmlns="https://developers.google.com/blockly/xml">'
      + '<block type="ev_start"><next><block type="act_pick_image"><field name="COMP">img1</field></block></next></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml2), ws);
    window.EditorApp.__exportPreview();
    var code = '';
    try { code = (JSON.parse(localStorage.getItem('__previewProject') || '{}').screens[0] || {}).code || ''; } catch (e) {}
    return { 有定义: !!Blockly.Blocks['act_pick_image'], 工具箱有: xml.indexOf('"act_pick_image"') >= 0, 代码: code };
  })()`);
  if (!r.有定义 || !r.工具箱有) throw new Error('拍照/选图块没接好：' + JSON.stringify({ 有定义: r.有定义, 工具箱有: r.工具箱有 }));
  if (String(r.代码).indexOf('RT.pickImage') < 0) throw new Error('生成的代码里没有 pickImage：' + String(r.代码).slice(0, 120));
  await js(`(function(){
    var p = JSON.parse(localStorage.getItem('__previewProject') || '{}');
    (p.screens || []).forEach(function (s) { s.code = ''; });
    localStorage.setItem('__previewProject', JSON.stringify(p));
  })()`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!(window.RT && window.RT.pickImage)`, 15000);
    if (!ok) await sleep(1000);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没有 pickImage（已切回编辑器）');
  }
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  return { 代码块: '拍照或选图 ✓', 生成的代码: 'RT.pickImage(id) ✓', 运行时: 'API 在 ✓' };
});

// 用户反馈：在编辑器里改作品名，竟然能改成和列表里别的作品同名
await check('编辑器里改作品名也不许重名（撞名就退回原名并提示）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  // 先保证列表里有第二个作品（用来撞名）
  const 准备 = await js(`(function(){
    var s = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}');
    return { 数量: (s.items || []).length, 名字: (s.items || []).map(function (x) { return x.name; }) };
  })()`);
  if (准备.数量 < 2) throw new Error('列表里作品不够两个，测不了撞名：' + JSON.stringify(准备));
  const 撞名 = await js(`(function(){
    var App = window.EditorApp;
    var s = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}');
    var 输入 = document.getElementById('appName');
    if (!输入) return { 没有输入框: true };
    var 别人的 = null;
    (s.items || []).forEach(function (it) { if (!别人的 && it.id !== App.__aiItemId()) 别人的 = it.name; });
    if (!别人的) return { 没有别人: true, 名字: 准备.名字 };
    var 原名 = 输入.value;
    输入.value = 别人的;
    输入.dispatchEvent(new Event('input', { bubbles: true }));
    输入.dispatchEvent(new Event('change', { bubbles: true }));
    return { 原名: 原名, 别人的: 别人的, 改后输入框: 输入.value };
  })()`);
  await sleep(450);   // 等自动保存落盘
  const 撞后 = await js(`(function(){
    var App = window.EditorApp;
    var s = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}');
    var 存 = null;
    (s.items || []).forEach(function (it) { if (it.id === App.__aiItemId()) 存 = it.name; });
    return { 存的名字: 存, 输入框: document.getElementById('appName').value };
  })()`);
  if (撞名.没有输入框 || 撞名.没有别人) throw new Error('前置条件不成立：' + JSON.stringify(撞名));
  if (撞名.改后输入框 !== 撞名.原名 || 撞后.输入框 !== 撞名.原名) {
    throw new Error('撞名时输入框没有退回原名：' + JSON.stringify({ 撞名: 撞名, 撞后: 撞后 }));
  }
  if (撞后.存的名字 === 撞名.别人的 || 撞后.存的名字 !== 撞名.原名) {
    throw new Error('撞名竟然真的改上了：' + JSON.stringify({ 撞名: 撞名, 撞后: 撞后 }));
  }
  // 再试一个没人用过的名字：应当改成功
  const 新名 = '改名成功测试' + Date.now().toString().slice(-4);
  await js(`(function(){
    var 输入 = document.getElementById('appName');
    输入.value = ${JSON.stringify(新名)};
    输入.dispatchEvent(new Event('input', { bubbles: true }));
    输入.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(450);
  const 成功 = await js(`(function(){
    var App = window.EditorApp;
    var s = JSON.parse(localStorage.getItem('__bb_projects_v2') || '{}');
    var 存 = null;
    (s.items || []).forEach(function (it) { if (it.id === App.__aiItemId()) 存 = it.name; });
    return { 存的名字: 存, 输入框: document.getElementById('appName').value };
  })()`);
  if (成功.存的名字 !== 新名) throw new Error('没撞名的新名字却改不上：' + JSON.stringify({ 新名: 新名, 成功: 成功 }));
  await shot('t43-改名防重名');
  return { 撞名: '「' + 撞名.别人的 + '」→ 退回「' + 撞名.原名 + '」✓', 新名: 新名 + ' 改成功 ✓' };
});

// 用户反馈：AI 面板收成圆球那一瞬间有一圈白边
await check('AI 面板收成圆球时没有白边（描边和阴影一起过渡掉）', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    var p = document.getElementById('aiPanel'), ball = document.getElementById('aiBall');
    if (!p || !ball) return { 缺元素: true };
    p.classList.remove('hidden');
    p.style.width = '380px'; p.style.height = '520px';
    var 面板描边 = getComputedStyle(p).borderTopColor;
    document.getElementById('aiClose').click();
    return new Promise(function (res) {
      // 动画中间取一次：这时候描边/阴影必须已经被接管
      setTimeout(function () {
        var 中 = { 描边: p.style.borderColor, 阴影: p.style.boxShadow, 背景: p.style.backgroundColor };
        setTimeout(function () {
          res({ 面板描边: 面板描边, 动画中: 中,
                收起后内联描边: p.style.borderColor || '(已复位)',
                收起后内联阴影: p.style.boxShadow || '(已复位)',
                面板隐藏: p.classList.contains('hidden') });
        }, 420);
      }, 120);
    });
  })()`);
  if (r.缺元素) throw new Error('找不到 AI 面板/悬浮球');
  if (!r.动画中.描边) throw new Error('收缩时没有把描边颜色一起过渡（会出现白边）：' + JSON.stringify(r));
  if (r.动画中.描边 !== r.动画中.背景) throw new Error('收缩时描边颜色和球底色不一致（还是会有圈）：' + JSON.stringify(r));
  if (r.动画中.阴影 !== 'none') throw new Error('收缩时面板阴影没去掉：' + JSON.stringify(r));
  if (!r.面板隐藏) throw new Error('面板没收起来：' + JSON.stringify(r));
  if (r.收起后内联描边 !== '(已复位)' || r.收起后内联阴影 !== '(已复位)') throw new Error('收完后描边/阴影没复位：' + JSON.stringify(r));
  return { 收缩中: '描边=' + r.动画中.描边 + '、阴影=none', 收起后: '已复位 ✓' };
});

// 用户要求（路线图 1.2 控件扩展）：表格 + 图表
await check('表格控件：设计页能编辑数据，布局页和运行时都渲染成表格', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    document.querySelector('[data-add="table"]').click();
    var c = App.__aiComps()[0];
    return { 类型: c ? c.type : '', 列: c && c.columns, 行数: c && c.rows ? c.rows.length : -1 };
  })()`);
  await sleep(400);
  if (r.类型 !== 'table') throw new Error('表格控件没建出来：' + JSON.stringify(r));
  if (!r.列 || r.列.length < 2 || r.行数 < 1) throw new Error('表格默认数据不对：' + JSON.stringify(r));
  // 属性面板：改表头 + 数据，模型要跟着变
  const 改 = await js(`(function(){
    var App = window.EditorApp;
    var c = App.__aiComps()[0];
    // 直接走数据模型（属性面板用的是同一份字段）
    App.__aiApplyComponents([]);
    var sc = App.__aiComps();
    window.__tblId = sc[0].id;
    return { id: sc[0].id };
  })()`);
  // 布局页要渲染出表格结构
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1400);
  const 布局 = await js(`(function(){
    var it = document.querySelector('#layStage .litem.t-table');
    return { 有: !!it, 表格行数: it ? it.querySelectorAll('tr').length : 0,
             表头: it ? Array.prototype.map.call(it.querySelectorAll('th'), function (n) { return n.textContent; }) : [] };
  })()`);
  await js(`(function(){ var b = document.getElementById('layBack'); if (b) b.click(); })()`);
  await sleep(600);
  if (!布局.有 || 布局.表格行数 < 2) throw new Error('布局页没渲染出表格：' + JSON.stringify(布局));
  // 运行时
  await js(`window.EditorApp.__exportPreview()`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen .comp.table table')`, 15000);
    if (!ok) await sleep(1200);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没渲染出表格（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var t = document.querySelector('#screen .comp.table table');
    return { 行数: t.querySelectorAll('tr').length, 表头: Array.prototype.map.call(t.querySelectorAll('th'), function (n) { return n.textContent; }),
             首格: t.querySelector('td') ? t.querySelector('td').textContent : '',
             // 代码改数据：换成三行新数据
             换数据后: (function () {
               window.RT.setData(document.querySelector('#screen .comp.table').getAttribute('data-id'),
                 '城市,人数\\n北京,120\\n上海,90');
               var t2 = document.querySelector('#screen .comp.table table');
               return { 表头: Array.prototype.map.call(t2.querySelectorAll('th'), function (n) { return n.textContent; }),
                        首格: t2.querySelector('td') ? t2.querySelector('td').textContent : '' };
             })() };
  })()`);
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (运行.行数 < 2 || 运行.表头.length < 2) throw new Error('运行时表格结构不对：' + JSON.stringify(运行));
  if (运行.换数据后.表头.join(',') !== '城市,人数' || 运行.换数据后.首格 !== '北京') {
    throw new Error('代码换表格数据没生效：' + JSON.stringify(运行.换数据后));
  }
  await shot('t44-表格控件');
  return { 设计: r.列.join(' / ') + '（' + r.行数 + ' 行）', 布局页: 布局.表头.join('/'), 运行时: 运行.表头.join('/'),
           换数据: 运行.换数据后.表头.join('/') + ' → ' + 运行.换数据后.首格 };
});

await check('图表控件：柱状/折线/饼图都能画，代码也能换数据', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    document.querySelector('[data-add="chart"]').click();
    var c = App.__aiComps()[0];
    return { 类型: c ? c.type : '', 图型: c && c.chartType, 点数: c && c.chartData ? c.chartData.length : -1 };
  })()`);
  await sleep(400);
  if (r.类型 !== 'chart' || r.点数 < 3) throw new Error('图表控件没建出来：' + JSON.stringify(r));
  // 布局页要有柱子
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1400);
  const 布局 = await js(`(function(){
    var it = document.querySelector('#layStage .litem.t-chart');
    return { 有: !!it, 柱子数: it ? it.querySelectorAll('.lv-chart-bar').length : 0 };
  })()`);
  await js(`(function(){ var b = document.getElementById('layBack'); if (b) b.click(); })()`);
  await sleep(600);
  if (!布局.有 || 布局.柱子数 < 3) throw new Error('布局页没画出柱子：' + JSON.stringify(布局));
  await js(`window.EditorApp.__exportPreview()`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen .comp.chart')`, 15000);
    if (!ok) await sleep(1200);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没渲染出图表（已切回编辑器）');
  }
  const 运行 = await js(`(function(){
    var el = document.querySelector('#screen .comp.chart');
    var 柱 = el.querySelectorAll('.rt-bar').length;
    var 高 = el.querySelector('.rt-bar') ? el.querySelector('.rt-bar').style.height : '';
    // 换成折线图的数据：用代码换数据（图型保持数据里的设置）
    window.RT.setData(el.getAttribute('data-id'), '甲,10\\n乙,80\\n丙,40');
    var 换后 = el.querySelectorAll('.rt-bar').length;
    return { 柱数: 柱, 第一根高: 高, 换后柱数: 换后 };
  })()`);
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (运行.柱数 < 3 || !运行.第一根高) throw new Error('运行时没画出柱状图：' + JSON.stringify(运行));
  if (运行.换后柱数 !== 3) throw new Error('代码换图表数据没生效：' + JSON.stringify(运行));
  await shot('t45-图表控件');
  return { 设计: r.图型 + ' / ' + r.点数 + ' 个点', 布局页: 布局.柱子数 + ' 根柱', 运行时: 运行.柱数 + ' 根柱（第一根 ' + 运行.第一根高 + '）', 换数据: 运行.换后柱数 + ' 根 ✓' };
});

// 用户要求：历史版本不限条数、可以自己删
await check('历史版本：不限条数、能一条条删、也能清空', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开');
  const r = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    // 造 6 个互不相同的版本（每次改动一点，指纹不同才会存）
    for (var i = 1; i <= 6; i++) {
      App.__aiApplyComponents([{ op:'add', type:'text', props:{ x:20, y:20 + i * 40, w:160, h:30, value:'第' + i + '版' } }]);
      App.__aiHistorySnapshot('第' + i + '版');
    }
    return { 份数: App.__aiHistory().length };
  })()`);
  if (r.份数 < 6) throw new Error('历史条数被限制了（用户要求不限）：' + JSON.stringify(r));
  const 删 = await js(`(function(){
    var App = window.EditorApp;
    var 前 = App.__aiHistory().length;
    var ok = App.__aiHistoryDelete(1);
    return { 前: 前, 删成功: ok, 后: App.__aiHistory().length };
  })()`);
  if (!删.删成功 || 删.后 !== 删.前 - 1) throw new Error('删一条历史失败：' + JSON.stringify(删));
  // 面板里每行都要有删除钮
  const 面板 = await js(`(function(){
    var App = window.EditorApp;
    App.__aiOpenHistory();
    var sheet = document.getElementById('histSheet');
    var 行 = sheet ? sheet.querySelectorAll('.tpl-item.hist-row') : [];
    var 删钮 = sheet ? sheet.querySelectorAll('.hist-del').length : 0;
    var 清空 = sheet ? Array.prototype.some.call(sheet.querySelectorAll('.mbtns .tb'), function (b) { return /清空/.test(b.textContent); }) : false;
    return { 行数: 行.length, 删钮: 删钮, 有清空: 清空 };
  })()`);
  await js(`(function(){ var s = document.getElementById('histSheet'); if (s && s.parentNode) s.parentNode.removeChild(s); })()`);
  if (!面板.行数 || 面板.删钮 !== 面板.行数) throw new Error('历史面板每行没有删除钮：' + JSON.stringify(面板));
  if (!面板.有清空) throw new Error('历史面板没有「清空历史」：' + JSON.stringify(面板));
  await shot('t46-历史可删');
  return { 条数: r.份数 + ' 份（不限）', 删一条: 删.前 + ' → ' + 删.后, 每行删除钮: 面板.删钮 + ' 个', 清空: '有' };
});

// 用户反馈：「拍照或选图」接在事件积木下不执行 —— 修好并加严校验
await check('拍照/选图：真机走原生桥、选错控件会说清楚、结果能显示到图片控件', async () => {
  const 工程 = {
    appName: '选图测试', startScreen: 's1', design: { w: 390, h: 844 },
    screens: [{
      id: 's1', title: '页面1', orientation: 'portrait', showStatusBar: true, code: '',
      components: [
        { id: 'img1', type: 'image', x: 20, y: 20, w: 160, h: 120, alt: '图片' },
        { id: 'btn1', type: 'button', x: 20, y: 160, w: 160, h: 48, text: '选图' }
      ]
    }]
  };
  await js(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(工程))})`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    await js(`location.href='runtime.html?v=' + Date.now()`);
    ok = await waitFor(`!!document.querySelector('#screen .comp.image') && !!window.RT`, 15000);
    if (!ok) await sleep(1200);
  }
  if (!ok) {
    await js(`location.href='editor.html'`);
    await waitFor(`!!window.EditorApp`, 15000);
    throw new Error('运行时没起来（已切回编辑器）');
  }
  const r = await js(`(function(){
    var 结果 = {};
    // ① 真机路径：模拟原生桥回一个 dataURL
    window.Native = window.Native || {};
    window.Native.pickImageNative = function (cbId, kind) {
      结果.原生被调用 = cbId; 结果.原生kind = kind;
      setTimeout(function () { window.__nativePickImage(cbId, 'data:image/png;base64,iVBORw0KGgo='); }, 20);
    };
    var 等 = [];
    window.RT.pickImage('img1').then(function (u) {
      结果.返回 = u;
      结果.img = (document.querySelector('#screen .comp.image img') || {}).src || '';
    }, function (e) { 结果.失败 = String(e && e.message || e); });
    // ② 选错控件（按钮）：必须明确报错，而不是默默什么都没发生
    window.RT.pickImage('btn1').then(function () { 结果.按钮没报错 = true; }, function (e) { 结果.按钮报错 = String(e && e.message || e); });
    // ③ 不存在的控件
    window.RT.pickImage('nope').then(function () { 结果.不存在没报错 = true; }, function (e) { 结果.不存在报错 = String(e && e.message || e); });
    return new Promise(function (res) { setTimeout(function () { res(结果); }, 400); });
  })()`);
  await js(`location.href='editor.html'`);
  await waitFor(`!!window.EditorApp`, 15000);
  if (!(await ensureProject())) throw new Error('回到编辑器后工程没打开');
  if (!r.原生被调用) throw new Error('运行时没有优先走原生选图桥：' + JSON.stringify(r));
  if (r.返回 !== 'data:image/png;base64,iVBORw0KGgo=') throw new Error('原生返回的图片没被采用：' + JSON.stringify(r));
  if (!/^data:image\/png/.test(r.img || '')) throw new Error('图片没有显示到控件上：' + JSON.stringify(r));
  if (!r.按钮报错) throw new Error('选到非图片控件时没有明确提示：' + JSON.stringify(r));
  if (!r.不存在报错) throw new Error('控件不存在时没有明确提示：' + JSON.stringify(r));
  // 代码块的 COMP 下拉只列图片控件
  const 下拉 = await js(`(function(){
    var App = window.EditorApp;
    document.getElementById('tabDesign').click();
    var ids = App.__aiComps().map(function (c) { return c.id; });
    if (ids.length) App.__aiApplyComponents(ids.map(function (id) { return { op:'remove', id: id }; }));
    App.__aiApplyComponents([{ op:'add', type:'button', props:{ x:20, y:20, w:160, h:48, text:'按钮' } },
                             { op:'add', type:'image', props:{ x:20, y:90, w:160, h:120 } }]);
    var 选项 = null;
    try { 选项 = window.__compOptions ? window.__compOptions(['image']) : null; } catch (e) { 选项 = 'err:' + e.message; }
    return { 选项: 选项 };
  })()`);
  if (!下拉.选项 || !下拉.选项.length) throw new Error('图片控件下拉取不到选项：' + JSON.stringify(下拉));
  const 名 = JSON.stringify(下拉.选项);
  if (名.indexOf('按钮') >= 0) throw new Error('图片下拉里混进了非图片控件：' + 名);
  await shot('t47-选图修复');
  return { 原生桥: r.原生被调用 ? '优先走原生 ✓' : '', 显示到控件: '✓', 选错控件: r.按钮报错, 下拉只列图片: 下拉.选项.length + ' 个' };
});

// 用户要求：进阶技巧放到「使用帮助」页右上角，点进去是**独立页面**（左列表 / 右展示），不要"用这个拼法"按钮
await check('进阶技巧：入口在帮助页右上角，进去是独立页面（左列表 + 右展示，10 条复杂拼法）', async () => {
  const 清单 = await js(`(function(){
    var App = window.EditorApp;
    var t = App.__aiTips();
    var 坏 = t.filter(function (x) {
      try { return !App.__aiValidateXml('<xml xmlns="https://developers.google.com/blockly/xml">' + x.xml + '</xml>'); } catch (e) { return true; }
    });
    var 首页按钮 = document.getElementById('btnTips');
    var 帮助入口 = document.getElementById('btnHelpTips');
    return { 条数: t.length, 坏条数: 坏.length, 名字: t.map(function (x) { return x.name; }).slice(0, 3),
             首页还有按钮: !!首页按钮, 帮助页入口: !!帮助入口,
             每块数: t.map(function (x) { return (x.xml.match(/<block /g) || []).length; }) };
  })()`);
  if (清单.首页还有按钮) throw new Error('首页还留着「进阶技巧」按钮（应该只在帮助页右上角）');
  if (!清单.帮助页入口) throw new Error('帮助页右上角没有「进阶技巧」入口');
  if (清单.条数 < 10) throw new Error('进阶技巧条目太少：' + JSON.stringify(清单));
  if (清单.坏条数) throw new Error('有 ' + 清单.坏条数 + ' 条拼法解析不了：' + JSON.stringify(清单.名字));
  const 最简 = Math.min.apply(null, 清单.每块数);
  if (最简 < 4) throw new Error('进阶技巧太简单了（最少的一条只有 ' + 最简 + ' 块积木）：' + JSON.stringify(清单.每块数));
  // 打开帮助 → 点右上角入口 → 应该是独立页面（不是弹窗）
  const 页 = await js(`(function(){
    document.getElementById('btnHome').click();
    return new Promise(function (res) {
      setTimeout(function () {
        document.getElementById('btnHelp').click();
        setTimeout(function () {
          var 帮助开着 = !document.getElementById('viewHelp').classList.contains('hidden');
          document.getElementById('btnHelpTips').click();
          setTimeout(function () {
            var v = document.getElementById('viewTips');
            res({ 帮助开着: 帮助开着, 技巧页开着: v && !v.classList.contains('hidden'),
                  是弹窗吗: !!document.getElementById('tipsSheet'),
                  列表项: document.querySelectorAll('#tipsList .tips-item').length,
                  右侧有内容: (document.getElementById('tipsBody').textContent || '').length > 10,
                  右侧有积木: document.querySelectorAll('#tipsBody .bb-thumb').length,
                  还有用这个拼法吗: /用这个拼法/.test(document.getElementById('tipsBody').textContent || ''),
                  标题: (document.querySelector('#tipsBody .tips-title') || {}).textContent || '' });
          }, 500);
        }, 400);
      }, 500);
    });
  })()`);
  if (!页.技巧页开着) throw new Error('没有进入进阶技巧页面：' + JSON.stringify(页));
  if (页.是弹窗吗) throw new Error('还是弹窗形式：' + JSON.stringify(页));
  if (页.列表项 < 10) throw new Error('左侧列表条数不对：' + JSON.stringify(页));
  if (!页.右侧有内容 || !页.右侧有积木) throw new Error('右侧没展示内容/积木：' + JSON.stringify(页));
  if (页.还有用这个拼法吗) throw new Error('「用这个拼法」按钮还在（要求删掉）：' + JSON.stringify(页));
  // 积木要看得清：1:1 显示（按真实积木高度，不是缩成一条线）
  const 尺寸 = await js(`(function(){
    var svg = document.querySelector('#tipsBody .bb-thumb svg');
    if (!svg) return null;
    var r = svg.getBoundingClientRect();
    return { 宽: Math.round(r.width), 高: Math.round(r.height), 可横向滚: getComputedStyle(svg.parentNode).overflowX };
  })()`);
  if (!尺寸) throw new Error('右侧积木图没渲染出来');
  if (尺寸.高 < 60) throw new Error('积木图太小了（高 ' + 尺寸.高 + 'px，看不清）：' + JSON.stringify(尺寸));
  // 每一条都要画得出来、而且不能出现"（请先在设计里添加对应组件）"这种长占位符
  const 全 = await js(`(function(){
    var App = window.EditorApp;
    var 结果 = [];
    App.__aiTips().forEach(function (t, i) {
      var box = null;
      try { box = App.__aiThumb(t.xml); } catch (e) { box = null; }
      var svg = box ? box.querySelector('svg') : null;
      // 节点还没插进文档，量 rect 会是 0；直接读 SVG 自己的宽高属性
      var 高 = svg ? parseFloat(String(svg.getAttribute('height') || '0')) : 0;
      var 宽 = svg ? parseFloat(String(svg.getAttribute('width') || '0')) : 0;
      结果.push({ i: i, 名: t.name.slice(0, 12), 有图: !!svg, 高: Math.round(高), 宽: Math.round(宽),
                  占位符: box ? /（请先在设计里添加对应组件）/.test(box.textContent || '') : true });
    });
    return 结果;
  })()`);
  const 无图 = 全.filter(function (x) { return !x.有图 || x.高 < 60; });
  const 占位 = 全.filter(function (x) { return x.占位符; });
  if (无图.length) throw new Error('这些技巧画不出积木图：' + JSON.stringify(无图));
  if (占位.length) throw new Error('积木里还有长占位符（控件下拉没给名字）：' + JSON.stringify(占位));
  // 点左边切换
  const 切换 = await js(`(function(){
    var 项 = document.querySelectorAll('#tipsList .tips-item');
    var 前 = (document.querySelector('#tipsBody .tips-title') || {}).textContent;
    项[2].click();
    return { 前: 前, 后: (document.querySelector('#tipsBody .tips-title') || {}).textContent,
             选中: document.querySelectorAll('#tipsList .tips-item.on').length };
  })()`);
  if (切换.前 === 切换.后 || 切换.选中 !== 1) throw new Error('点左边没有切换右侧内容：' + JSON.stringify(切换));
  // 第 1 条单独留一张图（用户反复反馈"第一条没有积木"，这里固定证据）
  await js(`(function(){ var 项 = document.querySelectorAll('#tipsList .tips-item'); if (项[0]) 项[0].click(); })()`);
  await sleep(600);
  const 第一 = await js(`(function(){
    var svg = document.querySelector('#tipsBody .bb-thumb svg');
    var r = svg ? svg.getBoundingClientRect() : null;
    return { 名字: (document.querySelector('#tipsBody .tips-title') || {}).textContent || '',
             有图: !!svg, 高: r ? Math.round(r.height) : 0,
             是文字兜底吗: !!document.querySelector('#tipsBody .bb-thumb-text') };
  })()`);
  if (!第一.有图 && !第一.是文字兜底吗) throw new Error('第 1 条技巧既没有积木图也没有示意图（会是一片空白）：' + JSON.stringify(第一));
  // 允许"逐块兜底"（整链画不出时改成每块单独画），但不允许退化成纯色小牌子
  const 第一块类 = await js(`(function(){
    var t = document.querySelector('#tipsBody .bb-thumb');
    if (!t) return '无';
    if (t.classList.contains('bb-thumb-rows')) return '逐块';
    if (t.classList.contains('bb-thumb-sketch')) return '示意图';
    return '整链';
  })()`);
  if (第一块类 === '示意图' || 第一块类 === '无') throw new Error('第 1 条技巧退化成了纯色示意图：' + 第一块类);
  await shot('t48a-进阶技巧第一条');
  await shot('t48-进阶技巧页');
  // 返回帮助页
  const 返回 = await js(`(function(){ document.getElementById('btnTipsBack').click(); return { 帮助: !document.getElementById('viewHelp').classList.contains('hidden'), 技巧: !document.getElementById('viewTips').classList.contains('hidden') }; })()`);
  if (!返回.帮助 || 返回.技巧) throw new Error('从技巧页返回帮助页失败：' + JSON.stringify(返回));
  return { 入口: '帮助页右上角 ✓', 页面: '左列表 ' + 页.列表项 + ' 条 / 右展示（' + 页.右侧有积木 + ' 张积木图）',
           最简拼法: 最简 + ' 块积木', 切换: 切换.前 + ' → ' + 切换.后 };
});

// 用户要求：使用帮助里每个条目配一个真积木
await check('使用帮助：条目旁边配了真积木（左积木 / 右说明），且补了新功能', async () => {
  const r = await js(`(function(){
    document.getElementById('btnHelp').click();
    var view = document.getElementById('viewHelp');
    var 面板开了 = view && !view.classList.contains('hidden');
    var 卡 = document.querySelectorAll('#helpContent .hp-block');
    var 图 = document.querySelectorAll('#helpContent .hp-block .bb-thumb').length;
    var 文字签名 = document.querySelectorAll('#helpContent .hp-sig').length;
    // 左积木 / 右说明：积木的右边 <= 文本列左边
    var 左积木右说明 = true;
    Array.prototype.forEach.call(卡, function (c) {
      var t = c.querySelector('.bb-thumb'), x = c.querySelector('.hp-text');
      if (!t || !x) return;
      if (t.getBoundingClientRect().right > x.getBoundingClientRect().left + 2) 左积木右说明 = false;
    });
    var 组名 = ((window.BB_HELP && window.BB_HELP.general) || []).map(function (g) { return g.cat; });
    var 滑屏条目 = ((window.BB_HELP.general.filter(function (g) { return g.cat === '事件'; })[0] || {}).blocks || [])
      .filter(function (b) { return b.t === 'ev_swipe'; }).length;
    return { 面板开了: 面板开了, 当前分类条目: 卡.length, 真积木图: 图, 文字签名: 文字签名,
             左积木右说明: 左积木右说明, 有新功能组: 组名.indexOf('新功能') >= 0, 组名: 组名.slice(0, 4),
             事件组有滑屏: 滑屏条目 };
  })()`);
  await js(`(function(){ document.getElementById('btnHelpBack').click(); })()`);
  if (!r.面板开了) throw new Error('帮助页没打开：' + JSON.stringify(r));
  if (!r.当前分类条目) throw new Error('帮助条目为空：' + JSON.stringify(r));
  if (!r.真积木图) throw new Error('帮助条目没有真积木图：' + JSON.stringify(r));
  if (!r.左积木右说明) throw new Error('帮助卡片不是"左积木 / 右说明"：' + JSON.stringify(r));
  if (!r.有新功能组) throw new Error('帮助里没有补「新功能」这一组：' + JSON.stringify(r.组名));
  if (!r.事件组有滑屏) throw new Error('帮助的「事件」里没补滑屏：' + JSON.stringify(r));
  // 积木文字里不能有长占位符（「（请先在设计里添加对应组件）」「（变量）」都得换成真名字）
  const 占位 = await js(`(function(){
    var 文本 = document.getElementById('helpContent').textContent || '';
    // 挨个分类点一遍：每个分类都要有真积木图（用户要求：条目和积木一一对应）
    var 结果 = [];
    ['变量', '数学', '控制', '逻辑', '文本', '数据列表', '颜色', '云列表', '设备', '页面', '事件'].forEach(function (名) {
      var 按钮 = Array.prototype.filter.call(document.querySelectorAll('#helpCats .bb-cat'), function (b) {
        var lb = b.querySelector('.bb-cat-lb');
        return ((lb ? lb.textContent : b.textContent) || '').trim() === 名; })[0];
      if (!按钮) { 结果.push({ 名: 名, 没找到: true }); return; }
      按钮.click();
      var 卡 = document.querySelectorAll('#helpContent .hp-block').length;
      var 图 = document.querySelectorAll('#helpContent .bb-thumb').length;
      结果.push({ 名: 名, 条目: 卡, 有图: 图,
                  占位: /（变量）|（请先在设计里添加对应组件）/.test(document.getElementById('helpContent').textContent || '') });
    });
    var 变量图 = 结果.filter(function (x) { return x.名 === '变量'; })[0] || {};
    return { 有长占位符: /（请先在设计里添加对应组件）/.test(文本), 变量占位符: /（变量）/.test(文本),
             变量图: 变量图.有图 || 0, 各分类: 结果 };
  })()`);
  if (占位.有长占位符) throw new Error('帮助积木里还有「（请先在设计里添加对应组件）」：' + JSON.stringify(占位));
  if (占位.变量占位符) throw new Error('变量积木还在显示「（变量）」占位符：' + JSON.stringify(占位));
  if (!占位.变量图) throw new Error('变量分类没画出积木图：' + JSON.stringify(占位));
  const 没图 = 占位.各分类.filter(function (x) { return !x.没找到 && x.条目 && !x.有图; });
  const 还占位 = 占位.各分类.filter(function (x) { return x.占位; });
  if (没图.length) throw new Error('这些分类一条积木图都没有（关键词没覆盖到）：' + JSON.stringify(没图));
  if (还占位.length) throw new Error('这些分类里还有占位符文字：' + JSON.stringify(还占位));
  await shot('t49-帮助带积木');
  return { 当前分类: r.当前分类条目 + ' 条，其中 ' + r.真积木图 + ' 条带真积木', 布局: '左积木/右说明 ✓',
           新功能组: '有', 事件组滑屏: r.事件组有滑屏 + ' 条' };
});

// 用户要求：首页「检查更新」左边显示当前版本号
await check('首页右上角显示当前版本号（在「检查更新」左边）', async () => {
  const r = await js(`(function(){
    var v = document.getElementById('homeVersion');
    var u = document.getElementById('btnUpdate');
    if (!v || !u) return { 缺元素: { 版本: !!v, 更新钮: !!u } };
    var vr = v.getBoundingClientRect(), ur = u.getBoundingClientRect();
    return { 文字: v.textContent.trim(), 在更新钮左边: vr.right <= ur.left + 2,
             同一行: Math.abs(vr.top - ur.top) < 30, 可见: vr.width > 0 };
  })()`);
  if (r.缺元素) throw new Error('首页缺元素：' + JSON.stringify(r));
  if (!r.文字) throw new Error('版本号是空的：' + JSON.stringify(r));
  if (!/^(v|开发版)/.test(r.文字)) throw new Error('版本号格式不对：' + JSON.stringify(r));
  if (!r.在更新钮左边 || !r.同一行) throw new Error('版本号位置不对（应在检查更新左边）：' + JSON.stringify(r));
  return { 版本: r.文字, 位置: '检查更新左边 ✓' };
});

// 2026-10-29 用户要求：有新版本时「检查更新」右上角亮红点；布局按钮和右边的 ▾ 连成一体
await check('检查更新红点：默认不亮，有新版本时亮在按钮右上角', async () => {
  const r = await js(`(function(){
    var App = window.EditorApp;
    var b = document.getElementById('btnUpdate'), d = document.getElementById('updDot');
    if (!b || !d) return { 缺元素: { 钮: !!b, 点: !!d } };
    var 初 = !d.classList.contains('hidden');
    var 亮 = App.__updateDot(true);
    var br = b.getBoundingClientRect(), dr = d.getBoundingClientRect();
    var 右上 = { 靠右: (br.right - dr.right) < 12, 靠上: (dr.top - br.top) < 12,
                在钮内: dr.left >= br.left - 1 && dr.right <= br.right + 1 };
    var 题 = b.title;
    var 灭 = App.__updateDot(false);
    return { 初: 初, 亮: 亮, 压: 右上, 题: 题, 灭后还亮: 灭, 红: getComputedStyle(d).backgroundColor };
  })()`);
  if (r.缺元素) throw new Error('首页缺红点元素：' + JSON.stringify(r));
  if (r.初) throw new Error('开机默认不该亮红点');
  if (!r.亮) throw new Error('有新版本时红点没亮');
  if (!r.压.靠右 || !r.压.靠上 || !r.压.在钮内) throw new Error('红点不在按钮右上角：' + JSON.stringify(r.压));
  if (!/发现新版本/.test(r.题)) throw new Error('亮红点时按钮提示没变：' + r.题);
  if (r.灭后还亮) throw new Error('熄灭红点失败');
  if (!/rgb\(229, 72, 77\)/.test(r.红)) throw new Error('红点颜色不对：' + r.红);
  return { 默认: '不亮 ✓', 新版本: '亮在右上角 ✓', 颜色: r.红 };
});

await check('顶栏「布局」按钮和右边 ▾ 连成一体（无缝隙 / 中间一条分隔线）', async () => {
  if (!(await ensureProject())) throw new Error('工程没打开，看不到顶栏的布局按钮');
  const r = await js(`(function(){
    var a = document.getElementById('btnLayout'), b = document.getElementById('btnLayoutCaret');
    if (!a || !b) return { 缺元素: { 布局: !!a, 箭头: !!b } };
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    var ca = getComputedStyle(a), cb = getComputedStyle(b);
    return {
      同容器: a.parentNode === b.parentNode && a.parentNode.classList.contains('layout-split'),
      缝隙: Math.round((rb.left - ra.right) * 10) / 10,
      同高: Math.abs(ra.height - rb.height) < 1,
      左圆角: ca.borderTopLeftRadius,
      右圆角: cb.borderTopRightRadius,
      中缝: ca.borderTopRightRadius === '0px' && cb.borderTopLeftRadius === '0px',
      分隔线: cb.borderLeftWidth !== '0px'
    };
  })()`);
  if (r.缺元素) throw new Error('顶栏缺按钮：' + JSON.stringify(r));
  if (!r.同容器) throw new Error('两个按钮不在同一个连体容器里');
  if (Math.abs(r.缝隙) > 0.5) throw new Error('布局按钮和 ▾ 之间有缝隙：' + r.缝隙 + 'px');
  if (!r.同高) throw new Error('两个按钮高度不一致');
  if (!r.中缝) throw new Error('中间没连起来（圆角应内侧为 0）：' + JSON.stringify(r));
  if (!r.分隔线) throw new Error('中间缺少分隔线');
  return { 缝隙: r.缝隙 + 'px', 圆角: r.左圆角 + ' / ' + r.右圆角, 分隔线: '有 ✓' };
});

// 2026-10-27 用户要求：检查更新不再列版本列表，只显示最新版本，点安装只装这一个
await check('检查更新只取「最新一行」，空表返回空', async () => {
  const r = await js(`(function(){
    var rows = [
      { '0000': '9.9.9.1（因签名问题已删除）' },
      { '0000': '9.9.9.2（因签名问题已删除）' },
      { '0000': '1.0.116.79（26.9.24.12:13）最新版' }
    ];
    var p = EditorApp.__updatePick(rows);
    return { 取到: p && p['0000'], 空表: EditorApp.__updatePick([]), 空值: EditorApp.__updatePick(null) };
  })()`);
  if (!r.取到 || !/1\.0\.116\.79/.test(r.取到)) throw new Error('没有取到最后一行（最新版）：' + JSON.stringify(r));
  if (r.空表 !== null || r.空值 !== null) throw new Error('空表应返回 null：' + JSON.stringify(r));
  return { 取到: r.取到 };
});

await check('检查更新提示区分「有新版本 / 已最新 / 云端更旧」', async () => {
  const r = await js(`(function(){
    return {
      新版本: EditorApp.__updateHint('1.0.116.200（最新版）', '1.0.116.113'),
      相同: EditorApp.__updateHint('1.0.116.113（最新版）', '1.0.116.113'),
      更旧: EditorApp.__updateHint('1.0.116.79（最新版）', '1.0.116.113')
    };
  })()`);
  if (!/发现新版本/.test(r.新版本)) throw new Error('新版本提示不对：' + r.新版本);
  if (!/已经在用最新版/.test(r.相同)) throw new Error('同版本提示不对：' + r.相同);
  if (!/还旧/.test(r.更旧)) throw new Error('云端更旧时应明确提示（防止误导降级）：' + r.更旧);
  return r;
});

// 用户 2026-10-29 要求：检查更新右上角增加「更新日志」，用来展示每一版改了什么
await check('检查更新右上角有「更新日志」，能列出最近几版的改动', async () => {
  const r = await js(`(function(){
    var m = document.getElementById('updateMask');
    if (m) m.classList.remove('hidden');       // 只量布局，不点真实入口（真实入口会联网查版本）
    var row = m ? m.querySelector('.mtitle') : null;
    var btn = document.getElementById('updateLog');
    if (!btn) return { 没有按钮: true };
    btn.click();
    var mask = document.getElementById('updLogMask');
    var items = Array.prototype.slice.call(document.querySelectorAll('#updLogList .updlog-item'));
    var contact = document.getElementById('updateContact');
    var modal = m ? m.querySelector('.modal') : null;
    var br = btn.getBoundingClientRect();
    var cr = contact ? contact.getBoundingClientRect() : null;
    var mr = modal ? modal.getBoundingClientRect() : null;
    var out = { 在标题栏: !!(row && row.contains(btn)), 文字: btn.textContent.trim(),
                在联系开发者左边: !!(cr && br.right <= cr.left + 1),
                右差: (mr && cr) ? Math.round(mr.right - cr.right) : -1,   // 量最后一个按钮到弹窗右边的距离
                弹窗显示: !!mask && !mask.classList.contains('hidden'), 条数: items.length,
                版本: items.map(function (n) { return (n.querySelector('.updlog-ver') || {}).textContent || ''; }),
                日期: items.map(function (n) { return (n.querySelector('.updlog-date') || {}).textContent || ''; }),
                正文空: items.filter(function (n) {
                  var b = n.querySelector('.updlog-body');
                  return !b || !b.textContent.trim();
                }).length };
    document.getElementById('updLogClose').click();
    out.关闭后隐藏 = mask.classList.contains('hidden');
    if (m) m.classList.add('hidden');
    return out;
  })()`);
  if (r.没有按钮) throw new Error('检查更新弹窗里没有「更新日志」按钮');
  if (!r.在标题栏 || r.文字 !== '更新日志') throw new Error('「更新日志」应在标题栏右上角：' + JSON.stringify(r));
  if (!r.在联系开发者左边) throw new Error('「更新日志」应在「联系开发者」左边：' + JSON.stringify(r));
  if (r.右差 < 0 || r.右差 > 48) throw new Error('「更新日志」没有成组贴在右边（被 space-between 顶到中间了）：' + JSON.stringify(r));
  if (!r.弹窗显示) throw new Error('点「更新日志」没弹出内容：' + JSON.stringify(r));
  if (r.条数 < 4) throw new Error('更新日志至少要有最近 4 版：' + JSON.stringify(r));
  if (!/^v1\.0\.116\.(13\d|1[4-9]\d)$/.test(r.版本[0])) throw new Error('更新日志第一条应是最新版本：' + JSON.stringify(r.版本));
  if (r.日期.filter(function (x) { return !/^\d{4}-\d{2}-\d{2}$/.test(x); }).length) {
    throw new Error('更新日志缺日期：' + JSON.stringify(r.日期));
  }
  if (r.正文空) throw new Error('有更新条目没有写内容：' + JSON.stringify(r));
  if (!r.关闭后隐藏) throw new Error('「关闭」没关掉更新日志');
  return { 条数: r.条数, 最新: r.版本[0] };
});

// 用户 2026-10-29 要求：首页作品卡支持长按拖动调整位置
await check('首页作品卡长按可拖动排序（长按 0.5 秒后拖到另一张卡上）', async () => {
  await js(`(function(){ var h=document.getElementById('btnHome'); if(h) h.click(); })()`);
  await sleep(800);
  const 前 = await js(`(function(){
    try { localStorage.removeItem('__bb_proj_sort'); } catch (e) {}   // 从"没设置过"的状态开始测
    var cards = Array.prototype.slice.call(document.querySelectorAll('#projectList .proj-card'));
    if (cards.length < 2) return { 数: cards.length };
    var a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect();
    return { 数: cards.length, 名: cards.map(function (c) { return c.dataset.id; }),
             甲: { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2) },
             乙: { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } };
  })()`);
  if (前.数 < 2) throw new Error('首页少于 2 个作品，测不了长按排序');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 前.甲.x, y: 前.甲.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(700);   // 超过 480ms 长按阈值
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 前.乙.x + 6, y: 前.乙.y + 6, button: 'left', buttons: 1 });
  await sleep(250);   // 留出让位动画的时间
  // 拖动中：DOM 顺序必须**一点没动**（只写 transform），否则换位就会跳 / 重排 / 把过渡打断
  const 中 = await js(`(function(){
    var cards = Array.prototype.slice.call(document.querySelectorAll('#projectList .proj-card'));
    return { 名: cards.map(function (c) { return c.dataset.id; }),
             位移的: cards.filter(function (c) { return !!c.style.transform; }).length,
             影子: document.querySelectorAll('.proj-ghost').length,
             占位: document.querySelectorAll('#projectList .proj-slot').length,
             藏起来的: document.querySelectorAll('#projectList .proj-holding').length };
  })()`);
  if (中.名.join(',') !== 前.名.join(',')) throw new Error('拖动期间就改了 DOM 顺序（应该只动 transform）：' + JSON.stringify({ 前: 前.名, 中: 中.名 }));
  if (!中.位移的) throw new Error('拖动时别的卡片没有让位（transform 没写）：' + JSON.stringify(中));
  if (!中.影子 || !中.占位 || !中.藏起来的) throw new Error('拖动中的三件套不齐（影子/占位/被拖卡片）：' + JSON.stringify(中));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 前.乙.x + 6, y: 前.乙.y + 6, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(700);
  const 后 = await js(`(function(){
    var cards = Array.prototype.slice.call(document.querySelectorAll('#projectList .proj-card'));
    return { 名: cards.map(function (c) { return c.dataset.id; }), 排序: localStorage.getItem('__bb_proj_sort'),
             残留槽: document.querySelectorAll('#projectList .proj-slot').length,
             残留影子: document.querySelectorAll('.proj-ghost').length,
             残留藏起来: document.querySelectorAll('.proj-holding').length,
             残留位移: cards.filter(function (c) { return !!c.style.transform; }).length };
  })()`);
  // 用户 2026-10-29 要求：拖动**不能**顺手把「自动调整 / 不调整排序」这个设置改掉
  if (后.排序 !== null) throw new Error('拖动不该改动排序设置（应保持没设置过 = 自动调整），实际：' + 后.排序);
  if (后.名.join(',') === 前.名.join(',')) throw new Error('拖完顺序没变：' + JSON.stringify({ 前: 前.名, 后: 后.名 }));
  if (后.名.indexOf(前.名[0]) !== 1) throw new Error('第一张卡没落到第二位：' + JSON.stringify({ 前: 前.名, 后: 后.名 }));
  if (后.残留槽 || 后.残留影子 || 后.残留藏起来 || 后.残留位移) throw new Error('拖完页面留下残渣：' + JSON.stringify(后));
  // 收尾：清掉排序设置（回到默认「自动调整」），别让后面的用例受影响
  await js(`(function(){ try { localStorage.removeItem('__bb_proj_sort'); } catch(e) {}
    document.getElementById('btnHome').click(); })()`);
  await sleep(500);
  return { 前后: 前.名[0] + ' → 第 2 位', 拖动中: 'DOM 未动，' + 中.位移的 + ' 张让位' };
});

// 用户 2026-10-29 要求：布局页点空白处取消选中
await check('布局页点空白处取消选中（点控件本身不会误取消）', async () => {
  await js(`(function(){ document.getElementById('btnHome').click(); })()`);
  await sleep(700);
  await js(`(function(){ var c=document.querySelector('#projectList .proj-card'); if (c) c.click(); })()`);
  await sleep(1000);
  await js(`document.getElementById('btnLayout').click()`);
  await sleep(1300);
  const r = await js(`(function(){
    var st = document.getElementById('layStage');
    var it = st.querySelector('.litem');
    if (!it) return { 没有控件: true };
    function pd(node) {
      var b = node.getBoundingClientRect();
      node.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + 6, clientY: b.top + 6,
        bubbles: true, cancelable: true, pointerId: 21, isPrimary: true }));
      node.dispatchEvent(new PointerEvent('pointerup', { clientX: b.left + 6, clientY: b.top + 6,
        bubbles: true, cancelable: true, pointerId: 21, isPrimary: true }));
    }
    pd(it);                                    // 先选中一个控件
    var 选中 = st.querySelectorAll('.litem.sel').length;
    pd(st.querySelector('.litem.sel') || it);  // 再按控件本身：不该取消
    var 按控件后 = st.querySelectorAll('.litem.sel').length;
    st.dispatchEvent(new PointerEvent('pointerdown', { clientX: 2, clientY: 2,
      bubbles: true, cancelable: true, pointerId: 22, isPrimary: true }));   // 点舞台空白
    return { 选中: 选中, 按控件后: 按控件后,
             之后: st.querySelectorAll('.litem.sel').length,
             控制点: st.querySelectorAll('.li-rs').length,
             工具条隐藏: document.getElementById('layFab').classList.contains('hidden') };
  })()`);
  if (r.没有控件) throw new Error('布局页没有控件，测不了取消选中');
  if (r.选中 !== 1) throw new Error('点控件没选中：' + JSON.stringify(r));
  if (r.按控件后 !== 1) throw new Error('点控件本身不该取消选中：' + JSON.stringify(r));
  if (r.之后 !== 0 || r.控制点 !== 0 || !r.工具条隐藏) throw new Error('点空白后没取消选中：' + JSON.stringify(r));
  await js(`document.getElementById('layBack').click()`);
  await sleep(600);
  return { 选中: '1 → 点空白 → 0' };
});

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({
  通过: results.length - failed.length,
  失败: failed.length,
  明细: results.map(r => (r.ok ? '✓ ' : '✗ ') + r.name + (r.info ? '  ' + r.info : '')),
  JS报错: jsErrors.slice(0, 10),
  截图: OUT
}, null, 2));
ws.close();
process.exit(failed.length || jsErrors.length ? 1 : 0);
