/* 演示工程运行时全功能自测：逐页操作每个积木功能并断言结果（云表格走真机接口） */
const WebSocket = require('ws');
const fs = require('fs');
const HTTP = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9223');
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
function conn(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u, { perMessageDeflate: false }); const pend = {}, hand = [];
    ws.on('open', () => res({
      send: (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      on: (m, f) => hand.push({ m, f }), _hand: hand
    }));
    ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result); hand.forEach(h => h.m === o.m && h.f(o.params)); });
    ws.on('error', rej);
  });
}
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } }

(async () => {
  const project = JSON.parse(fs.readFileSync('/tmp/demo_project.json', 'utf8'));
  const l = await get('/json/list'); let t = l.find(x => x.type === 'page'); const c = await conn(t.webSocketDebuggerUrl); const send = c.send;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { const d = r.exceptionDetails; console.log('  !! EXC', d.exception && d.exception.description || d.text); return undefined; } return r.result.value; };
  const load = async u => { await send('Page.navigate', { url: u + '?t=' + Date.now() }); await sleep(1000); };
  const tap = async (x, y) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(350); };
  const center = async expr => ev(`(function(){var b=${expr};b.scrollIntoView({block:'center'});var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  const tapComp = async cid => { const p = await center(`document.querySelector('[data-id="${cid}"]')`); await tap(p.x, p.y); };
  const tapBtnText = async label => { const p = await center(`[].slice.call(document.querySelectorAll('.matbtn')).find(function(b){return b.textContent.indexOf(${JSON.stringify(label)})>=0;})`); await tap(p.x, p.y); };
  const root = cid => `document.querySelector('[data-id="${cid}"]')`;
  const textOf = cid => ev(`${root(cid)}.textContent.trim()`);
  const toast = async () => { await sleep(200); return ev(`(function(){var t=document.getElementById('toast');return t.classList.contains('show')?t.textContent.trim():'';})()`); };
  const waitToast = async (ms) => { const end=Date.now()+ms; let last=''; while(Date.now()<end){ last=await toast(); if(last) return last; await sleep(400); } return last; };

  // 记录震动/退出调用
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__vib=[];window.__exited=0;
    window.Native={getMode:function(){return 'editor';},vibrate:function(n){window.__vib.push(n);},exitApp:function(){window.__exited++;history.back();}};` });

  await ev(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(project))});1`);
  await load('http://127.0.0.1:8931/runtime.html');
  ok('首页渲染', (await ev(`document.querySelectorAll('#screen [data-id]').length`)) === 8);
  ok('首次启动 toast', (await toast()).indexOf('首次') >= 0, await toast());

  /* ===== 页面2 基础交互 ===== */
  await tapBtnText('① 基础交互'); await sleep(400);
  ok('进入基础交互页/启动积木改了文字', (await textOf(project.screens[1].components.find(c => (c.value || '').indexOf('点下面按钮') === 0 || (c.value || '').indexOf('页面已启动') === 0).id)).indexOf('页面已启动') === 0);
  const T2 = project.screens[1].components.find(c => c.value && c.value.indexOf('点下面按钮') === 0).id;
  const IMG = project.screens[1].components.find(c => c.type === 'image').id;
  await tapBtnText('随机背景色'); await sleep(200);
  const bg = await ev(`${root(T2)}.style.background || ${root(T2)}.style.backgroundColor`);
  ok('随机背景色生效（colour_rgb+随机整数）', /rgb/.test(bg), bg);
  await tapBtnText('文字变红色'); await sleep(200);
  const fg = await ev(`window.getComputedStyle(${root(T2)}.querySelector('.v-text')).color`);
  ok('文字颜色生效（取色块）', fg === 'rgb(216, 27, 96)', fg);
  await tapBtnText('隐藏图片'); await sleep(200);
  ok('隐藏积木生效', await ev(`${root(IMG)}.style.display==='none'`));
  await tapBtnText('显示图片'); await sleep(200);
  ok('显示积木生效', await ev(`${root(IMG)}.style.display!=='none'`));
  await tapBtnText('随机透明度'); await sleep(200);
  const op = await ev(`parseFloat(${root(IMG)}.style.opacity)`);
  ok('随机透明度生效（随机小数×100）', typeof op === 'number' && op >= 0 && op <= 1, op);
  await tapComp(IMG);
  ok('图片点击事件', (await toast()).indexOf('图片') >= 0);
  await tapBtnText('震动并提示'); await sleep(200);
  ok('震动积木调用原生震动', (await ev(`JSON.stringify(window.__vib)`)) === '[60]');
  ok('震动后 toast', (await toast()).indexOf('震动') >= 0);
  await tapBtnText('返回首页'); await sleep(400);
  ok('返回上一页回到首页', !!await ev(`document.querySelector('#screen [data-id]')`));

  /* ===== 页面3 输入与列表 ===== */
  await tapBtnText('② 输入框与列表'); await sleep(400);
  const s3 = project.screens[2].components;
  const INP = s3.find(c => c.type === 'input').id, LST = s3.find(c => c.type === 'list').id;
  const CNT = s3.find(c => c.value && c.value.indexOf('项数') === 0).id;
  ok('启动时设置提示词', (await ev(`${root(INP)}.querySelector('input').placeholder`) === '请输入一项后点添加'));
  ok('启动时列表初始化为 3 项', (await ev(`${root(LST)}.querySelectorAll('.li').length`)) === 3);
  ok('启动时项数文本=项数：3', (await textOf(CNT)) === '项数：3', await textOf(CNT));
  // 空输入分支
  await tapBtnText('添加到列表'); await sleep(200);
  ok('空输入走否则分支提示', (await toast()) === '输入框是空的');
  // 输入内容
  await ev(`(function(){var i=${root(INP)}.querySelector('input');i.focus();i.value='葡萄';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await tapBtnText('添加到列表'); await sleep(250);
  ok('添加后列表 4 项', (await ev(`${root(LST)}.querySelectorAll('.li').length`)) === 4);
  ok('添加后计数文本=项数：4（变量+加法+拼接）', (await textOf(CNT)) === '项数：4', await textOf(CNT));
  ok('添加后输入框清空', (await ev(`${root(INP)}.querySelector('input').value`)) === '');
  ok('添加 toast 含文本长度（text_length）', (await toast()).indexOf('长度：2') >= 0);
  // 点列表第 2 项
  const li2 = await center(`${root(LST)}.querySelectorAll('.li')[1]`); await tap(li2.x, li2.y);
  const t3 = await toast();
  ok('列表项点击：选中项+序号', t3.indexOf('香蕉') >= 0 && t3.indexOf('第2项') >= 0, t3);
  await tapBtnText('清空列表'); await sleep(200);
  ok('清空列表=0 项且计数归零', (await ev(`${root(LST)}.querySelectorAll('.li').length`)) === 0 && (await textOf(CNT)) === '项数：0');
  await tapBtnText('返回首页'); await sleep(400);

  /* ===== 页面4 开关/滑块/进度 ===== */
  await tapBtnText('③ 开关'); await sleep(400);
  const s4 = project.screens[3].components;
  const SW = s4.find(c => c.type === 'switch').id, CB = s4.find(c => c.type === 'checkbox').id;
  const SL = s4.find(c => c.type === 'slider').id, PB = s4.find(c => c.type === 'progress').id;
  const TVAL = s4.find(c => typeof c.value === 'string' && c.value.indexOf('滑块') === 0).id;
  ok('启动初始化开关/复选为关', await ev(`!${root(SW)}.querySelector('.sw').classList.contains('on') && !${root(CB)}.querySelector('.ck').classList.contains('on')`));
  ok('启动滑块/进度=30', await ev(`${root(SL)}.__val===30 && ${root(PB)}.__val===30`));
  // 拖滑块到 90（input 事件）
  await ev(`(function(){var r=${root(SL)}.querySelector('input.rng');r.value=90;r.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  ok('滑块变化事件联动进度条', await ev(`${root(PB)}.__val===90`));
  ok('滑块变化事件刷新文本', (await textOf(TVAL)) === '滑块：90', await textOf(TVAL));
  // 翻转开关（逻辑非）
  await tapBtnText('翻转开关'); await sleep(200);
  ok('逻辑非翻转开关为开', await ev(`${root(SW)}.querySelector('.sw').classList.contains('on')`));
  await tapBtnText('两个都开？'); await sleep(200);
  ok('AND 逻辑：只开一个→还没都开', (await toast()) === '还没都开');
  // 勾选复选框
  await ev(`${root(CB)}.querySelector('.ck-row').click();1`); await sleep(200);
  await tapBtnText('两个都开？'); await sleep(200);
  ok('AND 逻辑：两个都开→提示', (await toast()) === '两个都开了');
  await tapBtnText('读取所有状态'); await sleep(300);
  const t4 = await toast();
  ok('单条 toast 含比较分支与全部状态', t4.indexOf('滑块偏大') === 0 && t4.indexOf('开关:true') >= 0 && t4.indexOf('复选:true') >= 0 && t4.indexOf('进度:90') >= 0, t4);
  await tapBtnText('滑块归 50'); await sleep(200);
  ok('重置：滑块50/进度50/复选勾选（真积木）', await ev(`${root(SL)}.__val===50 && ${root(PB)}.__val===50 && ${root(CB)}.querySelector('.ck').classList.contains('on')`));
  await tapBtnText('返回首页'); await sleep(400);

  /* ===== 页面5 控制/数学/变量 ===== */
  await tapBtnText('④ 控制'); await sleep(400);
  const s5 = project.screens[4].components;
  const byVal = v => s5.find(c => c.value === v).id;
  await tapBtnText('1 加到 10'); await sleep(300);
  ok('for 循环+变量累加：1到10的和=55', (await textOf(byVal('for 结果：'))) === '1到10的和=55', await textOf(byVal('for 结果：')));
  await tapBtnText('while 计数'); await sleep(300);
  ok('while+break：k=5', (await textOf(byVal('while 结果：'))) === '计数完成 k=5', await textOf(byVal('while 结果：')));
  await tapBtnText('重复 3 次拼星'); await sleep(300);
  ok('repeat 循环+拼接：★★★', (await textOf(byVal('repeat 结果：'))) === '重复3次：★★★', await textOf(byVal('repeat 结果：')));
  await tapBtnText('√144 与随机数'); await sleep(300);
  const mres = byVal('math 结果：');
  const mt = await textOf(mres);
  ok('math_single：√144=12；随机整数出现', /^√144=12，随机1~100=\d+$/.test(mt), mt);
  const T5 = project.screens[4].components.find(c => typeof c.value === 'string' && c.value.indexOf('控制·数学') >= 0).id;
  await tapBtnText('标题随机变色'); await sleep(200);
  ok('colour_rgb 随机背景', /rgb/.test(await ev(`${root(T5)}.style.background||${root(T5)}.style.backgroundColor`)));
  await tapBtnText('返回首页'); await sleep(400);

  /* ===== 页面6 云表格（真机接口） ===== */
  console.log('— 云表格（真机 SeaTable）—');
  await tapBtnText('⑤ 云表格'); await sleep(400);
  ok('云页启动 toast', (await toast()).indexOf('云表格') >= 0);
  const s6 = project.screens[5].components;
  const LST6 = s6.find(c => c.type === 'list').id;
  const ST = s6.find(c => typeof c.value === 'string' && c.value.indexOf('状态') === 0).id;
  await tapBtnText('表格名称与行数');
  await waitToast(8000);
  const info = await textOf(ST);
  ok('cloud_tables+cloud_count：含表名与行数数字', /测试表/.test(info) && /行数：\d+/.test(info), info);
  const m0 = info.match(/行数：(\d+)/); const before = m0 ? +m0[1] : -1;
  await tapBtnText('读取所有行'); await sleep(6000);
  const liBefore = await ev(`${root(LST6)}.querySelectorAll('.li').length`);
  ok('cloud_rows+jsonGet+for：列表行数=表行数', liBefore === before && before >= 0, { liBefore, before });
  // 新增
  await tapBtnText('新增一行');
  ok('新增 toast', (await waitToast(8000)).indexOf('已新增') === 0);
  await tapBtnText('读取所有行'); await sleep(6000);
  const liAdd = await ev(`${root(LST6)}.querySelectorAll('.li').length`);
  ok('cloud_add 后行数 +1', liAdd === before + 1, { liAdd, before });
  const addedText = await ev(`(function(){var ls=[].slice.call(${root(LST6)}.querySelectorAll('.li')).map(function(x){return x.textContent;});return ls.find(function(x){return /^演示\\d{4}$/.test(x);})||'';})()`);
  ok('新行出现在列表（字段 测试列1）', /^演示\d{4}$/.test(addedText), addedText);
  // 点选新行
  const liAdded = await center(`[].slice.call(${root(LST6)}.querySelectorAll('.li')).find(function(x){return /^演示\\d{4}$/.test(x.textContent);})`);
  await tap(liAdded.x, liAdded.y); await sleep(300);
  ok('行点击取 _id 并 toast 列值', (await toast()).indexOf('已选：演示') === 0);
  // 更新
  await tapBtnText('更新选中行');
  ok('cloud_update toast', (await waitToast(8000)).indexOf('已更新') === 0);
  // SQL 查询（新增行 col2 已改为“已更新”，查 来自FAST 的数量）
  await tapBtnText('SQL 查询演示'); await waitToast(8000);
  const sqlTxt = await textOf(ST);
  ok('cloud_sql+lists_length：命中行数为数字', /SQL 命中行数：\d+/.test(sqlTxt), sqlTxt);
  // 删除（先重新点选新行，更新后 selId 还在，但保险起见再点一次）
  const liAdded2 = await center(`[].slice.call(${root(LST6)}.querySelectorAll('.li')).find(function(x){return /^演示\\d{4}$/.test(x.textContent);})`);
  await tap(liAdded2.x, liAdded2.y); await sleep(300);
  await tapBtnText('删除选中行');
  const delToast = await waitToast(9000);
  ok('cloud_row_by_id 取行并 cloud_delete', delToast.indexOf('删除：演示') === 0, delToast);
  await sleep(1500);
  await tapBtnText('读取所有行'); await sleep(6000);
  const liDel = await ev(`${root(LST6)}.querySelectorAll('.li').length`);
  ok('删除后行数恢复', liDel === before, { liDel, before });
  // 清理本次及历史测试产生的行（演示NNNN / 测试列2 为 来自FAST、已更新）
  const cleaned = await ev(`(async function(){
    var SERVER='https://cloud.seatable.cn', UUID='99498ec1-ede9-4e40-a881-cb7f9a2fd3dc', TOK='9437f5e39a7292abfe631bf55d5fa9cebd885e32';
    var at=await (await fetch(SERVER+'/api/v2.1/dtable/app-access-token/',{headers:{Authorization:'Token '+TOK}})).json();
    var gw=(at.dtable_server||SERVER+'/api-gateway/').replace(new RegExp('/+$'),'');
    var rows=await (await fetch(gw+'/api/v2/dtables/'+UUID+'/rows/?table_name='+encodeURIComponent('测试表1')+'&start=0&limit=1000',{headers:{Authorization:'Bearer '+at.access_token}})).json();
    var ids=(rows.rows||[]).filter(function(r){return new RegExp('^演示[0-9]{4}$').test(r['测试列1'])||r['测试列2']==='来自FAST'||r['测试列2']==='已更新';}).map(function(r){return r._id;});
    if(ids.length){await fetch(gw+'/api/v2/dtables/'+UUID+'/rows/',{method:'DELETE',headers:{Authorization:'Bearer '+at.access_token,'Content-Type':'application/json'},body:JSON.stringify({table_name:'测试表1',row_ids:ids})});}
    return ids.length;
  })()`);
  console.log('  清理云表测试行:', cleaned, '行');
  await tapBtnText('返回首页'); await sleep(400);
  ok('云页返回首页', (await ev(`document.querySelectorAll('#screen [data-id]').length`)) === 8);

  /* ===== 退出应用积木（独立 App=shell 模式走 Native.exitApp） ===== */
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__exited=0;
    window.Native={getMode:function(){return 'shell';},getProject:function(){return ${JSON.stringify(JSON.stringify(project))};},
      vibrate:function(n){},exitApp:function(){window.__exited++;},setOrientation:function(){},httpRequest:function(){}};` });
  await ev(`localStorage.removeItem('__previewProject');1`);
  await load('http://127.0.0.1:8931/runtime.html');
  await sleep(800);
  await tapBtnText('退出应用'); await sleep(500);
  ok('退出积木调用 Native.exitApp', (await ev(`window.__exited`)) >= 1);

  console.log(`\n演示运行时结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
