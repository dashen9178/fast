/* v1.9.7 综合回归：
   创建弹窗 / 文案 / 滚动条 / 全局缩放 / 数字编辑 M3 弹窗 / 提示词积木 /
   云列表（空浮层→创建 M3 弹窗→云积木/下拉/代码生成）/ 运行时 SeaTable 真机 CRUD（fetch + 原生桥）/
   整理积木 / 错误密钥拦截 */
const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:' + (process.env.CDP_PORT || 9222);
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
    ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result); hand.forEach(h => h.m === o.method && h.f(o.params)); });
    ws.on('error', rej);
  });
}
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } }

const UUID = '99498ec1-ede9-4e40-a881-cb7f9a2fd3dc';
const TOK = '9437f5e39a7292abfe631bf55d5fa9cebd885e32';

(async () => {
  const l = await get('/json/list'); let t = l.find(x => x.type === 'page'); const c = await conn(t.webSocketDebuggerUrl); const send = c.send;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { console.log('EXC', r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return undefined; } return r.result.value; };
  async function load(url) { await new Promise(r => { c.on('Page.loadEventFired', r); send('Page.navigate', { url: url + '?t=' + Date.now() }); }); await sleep(900); }
  async function tap(x, y) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); }
  async function center(selExpr) {
    return ev(`(function(){var b=${selExpr};var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  }
  async function setMode(m) {
    const isW = () => ev(`document.getElementById('bbCats').classList.contains('bb-mode-widget')`);
    if (await isW() === (m === 'widget')) return;
    const sel = m === 'widget' ? '.bb-bot-wrap .bb-switch' : '.bb-top-wrap .bb-switch';
    for (let i = 0; i < 3; i++) {
      const p = await center(`document.querySelector('${sel}')`); await tap(p.x, p.y); await sleep(450);
      if (await isW() === (m === 'widget')) return;
    }
    // CDP 合成轻点偶发不触发 click 时的确定性兜底（真实手指点击不受影响）
    await ev(`document.querySelector('${sel}').click();1`); await sleep(300);
  }
  const genCat = `[].slice.call(document.querySelectorAll('#bbCats .bb-panel-general .bb-cat'))`;
  async function openGenCat(name) {
    const p = await center(genCat + `.find(function(b){return b.querySelector('.bb-cat-lb').textContent===${JSON.stringify(name)};})`);
    await tap(p.x, p.y); await sleep(550);
  }
  async function flyoutButton(i) {
    return ev(`(function(){var bs=Blockly.getMainWorkspace().getFlyout().buttons_.filter(function(b){return !b.isLabel();});bs[${i}].onMouseUp({});return bs.length;})()`);
  }

  /* ============ 1. 创建弹窗 ============ */
  console.log('— 创建弹窗 —');
  await load('http://127.0.0.1:8931/editor.html');
  await ev(`localStorage.clear();1`); await load('http://127.0.0.1:8931/editor.html');
  await ev(`document.getElementById('btnNewApp').click();1`); await sleep(250);
  ok('弹窗打开', await ev(`!document.getElementById('createMask').classList.contains('hidden')`));
  ok('空名时创建按钮禁用', await ev(`document.getElementById('createGo').disabled===true`));
  await ev(`document.getElementById('createGo').click();1`); await sleep(200);
  ok('空名点击不创建', await ev(`!document.getElementById('createMask').classList.contains('hidden') && document.getElementById('viewEditor').classList.contains('hidden')`));
  const order = await ev(`(function(){var c=document.getElementById('createCancel'),g=document.getElementById('createGo');return {cancel:!!c,left:c.compareDocumentPosition(g)&Node.DOCUMENT_POSITION_FOLLOWING,text:c.textContent.trim()};})()`);
  ok('创建左边有取消按钮', order && order.cancel && order.text === '取消', order);
  await ev(`document.getElementById('createCancel').click();1`); await sleep(200);
  ok('取消关闭弹窗', await ev(`document.getElementById('createMask').classList.contains('hidden')`));
  await ev(`document.getElementById('btnNewApp').click();1`); await sleep(250);
  const icon = await ev(`(function(){
    var p=document.querySelector('#newOrient .ori[data-orient=portrait] line');
    var l=document.querySelector('#newOrient .ori[data-orient=landscape] line');
    var pr=p.getAttribute('y1'), lx=l.getAttribute('x1');
    var pick=document.getElementById('newOrient');
    var bs=pick.querySelectorAll('.ori');
    var r0=bs[0].getBoundingClientRect(),r1=bs[1].getBoundingClientRect();
    var cs=getComputedStyle(pick);
    return {portraitIslandY:pr,landIslandX:lx,joined:Math.abs(r1.left-r0.right)<=1,pickBorder:cs.borderTopWidth,btnBorder0:getComputedStyle(bs[0]).borderTopWidth};
  })()`);
  ok('竖屏灵动岛在顶部', icon.portraitIslandY === '5.7', icon);
  ok('横屏灵动岛在左边', icon.landIslandX === '5.7', icon);
  ok('方向按钮连体', icon.joined && icon.pickBorder !== '0px' && icon.btnBorder0 === '0px', icon);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='横屏App';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#newOrient .ori[data-orient=landscape]').click();document.getElementById('createGo').click();})()`); await sleep(500);
  ok('创建成功', await ev(`!document.getElementById('viewEditor').classList.contains('hidden')`));
  ok('存储为 landscape', await ev(`(function(){var s=JSON.parse(localStorage.getItem('__bb_projects_v2'));return s.items[s.items.length-1].project.orientation;})()`) === 'landscape');

  /* ============ 2. 积木栏文案 ============ */
  console.log('— 积木栏文案 —');
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(1300);
  const railText = await ev(`(function(){var r=document.getElementById('bbCats');return {bot:r.querySelector('.bb-bot-wrap .bb-sw-tx').textContent,top:r.querySelector('.bb-top-wrap .bb-sw-tx').textContent,gen:r.querySelectorAll('.bb-panel-general .bb-cat').length,wid:r.querySelectorAll('.bb-panel-widget .bb-cat').length};})()`);
  ok('常规态底部槽=控件积木', railText.bot === '控件积木', railText);
  ok('常规分类11个(含云列表)', railText.gen === 11, railText);
  ok('控件分类9个', railText.wid === 9, railText);
  await setMode('widget');
  ok('控件态顶部槽=常规积木', await ev(`document.querySelector('.bb-top-wrap .bb-sw-tx').textContent`) === '常规积木');

  /* ============ 3. 滚动条 ============ */
  console.log('— 滚动条 —');
  const sb = await ev(`(function(){
    var th=Blockly.Scrollbar.scrollbarThickness;
    var mains=document.querySelectorAll('.blocklyMainWorkspaceScrollbar');
    var hidden=mains.length?[].every.call(mains,function(m){return getComputedStyle(m).display==='none';}):'none';
    return {thickness:th,mainHidden:hidden};
  })()`);
  ok('浮层滚动条厚度=5', sb.thickness === 5, sb);
  ok('主画布滚动条隐藏', sb.mainHidden === true, sb);
  await setMode('general');
  await openGenCat('控制');
  const flySb = await ev(`(function(){var g=document.querySelector('.blocklyFlyoutScrollbar');if(!g)return null;var r=g.getBoundingClientRect();return {w:Math.round(r.width)};})()`);
  ok('浮层竖向滚动条纤细(≤7px)', flySb && flySb.w <= 7, flySb);

  /* ============ 4. 数字编辑走 M3 弹窗（替代原生 prompt） ============ */
  console.log('— 数字编辑 M3 弹窗 —');
  await ev(`(function(){
    var ws=Blockly.getMainWorkspace();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="math_number" x="60" y="60"><field name="NUM">30</field></block></xml>'), ws);
    ws.getBlocksByType('math_number')[0].getField('NUM').showPromptEditor_();
  })()`); await sleep(300);
  const bd = await ev(`(function(){return {vis:!document.getElementById('blocklyDialogMask').classList.contains('hidden'),msg:document.getElementById('bdMessage').textContent,val:document.getElementById('bdInput').value,cancel:document.getElementById('bdCancel').style.display!=='none'};})()`);
  ok('数字编辑弹 M3 弹窗(标题/当前值/取消)', bd && bd.vis && bd.msg === '更改值：' && bd.val === '30' && bd.cancel, bd);
  await ev(`document.getElementById('bdInput').value='77';document.getElementById('bdOk').click();1`); await sleep(150);
  ok('确定后数字写回积木', await ev(`String(Blockly.getMainWorkspace().getBlocksByType('math_number')[0].getFieldValue('NUM'))`) === '77');
  await ev(`Blockly.getMainWorkspace().getBlocksByType('math_number')[0].getField('NUM').showPromptEditor_();1`); await sleep(200);
  await ev(`document.getElementById('bdCancel').click();1`); await sleep(150);
  ok('取消保持原值', await ev(`String(Blockly.getMainWorkspace().getBlocksByType('math_number')[0].getFieldValue('NUM'))`) === '77');

  /* ============ 5. 输入框提示词积木 ============ */
  console.log('— 提示词积木 —');
  await setMode('widget');
  async function openWidgetCat(name) {
    const find = `[].slice.call(document.querySelectorAll('#bbCats .bb-panel-widget .bb-cat')).find(function(b){return b.querySelector('.bb-cat-lb').textContent===${JSON.stringify(name)};})`;
    for (let i = 0; i < 3; i++) { const p = await center(find); await tap(p.x, p.y); await sleep(450);
      const sel = await ev(`(function(){var it=Blockly.getMainWorkspace().getToolbox().getSelectedItem();return it?it.name_:'';})()`);
      if (sel === name) return; }
    await ev(`(${find}).click();1`); await sleep(400);
  }
  await openWidgetCat('输入框');
  const hintBlock = await ev(`(function(){var ws=Blockly.getMainWorkspace().getFlyout().getWorkspace();var b=ws.getAllBlocks().find(function(x){return x.type==='v_input_sethint';});return b?b.toString():null;})()`);
  ok('输入框分类含提示词积木', hintBlock && /提示词/.test(hintBlock), hintBlock);

  /* ============ 6. 云列表：空浮层 → 创建 → 云积木 ============ */
  console.log('— 云列表浮层与创建 —');
  await setMode('general');
  await openGenCat('云列表');
  const empty = await ev(`(function(){var fl=Blockly.getMainWorkspace().getFlyout();
    return {blocks:fl.getWorkspace().getTopBlocks(true).length,btns:fl.buttons_.filter(function(b){return !b.isLabel();}).length,labels:fl.buttons_.filter(function(b){return b.isLabel();}).length};})()`);
  ok('空态：无积木+2按钮+1提示', empty && empty.blocks === 0 && empty.btns === 2 && empty.labels === 1, empty);
  await flyoutButton(0); await sleep(350);
  ok('创建按钮打开 M3 弹窗', await ev(`!document.getElementById('cloudCreateMask').classList.contains('hidden')`));
  ok('弹窗含服务器下拉+3输入框(名称/UUID/API)', await ev(`['ccProvider','ccName','ccUuid','ccToken'].every(function(i){return !!document.getElementById(i);}) && document.getElementById('ccProvider').options.length===3`));
  // 空提交
  await ev(`document.getElementById('ccGo').click();1`); await sleep(200);
  ok('空名称拦截', (await ev(`document.getElementById('ccError').textContent`)).indexOf('名字') >= 0);
  // 错误密钥
  await ev(`(function(){document.getElementById('ccName').value='错的云';document.getElementById('ccUuid').value='bad-uuid';document.getElementById('ccToken').value='bad-token';['ccName','ccUuid','ccToken'].forEach(function(i){document.getElementById(i).dispatchEvent(new Event('input',{bubbles:true}));});document.getElementById('ccGo').click();return 1;})()`);
  await sleep(3000);
  ok('错误密钥内联报错', (await ev(`document.getElementById('ccError').textContent`)).indexOf('创建失败') === 0);
  // 真实创建
  await ev(`(function(){document.getElementById('ccName').value='测试云';document.getElementById('ccUuid').value='${UUID}';document.getElementById('ccToken').value='${TOK}';['ccName','ccUuid','ccToken'].forEach(function(i){document.getElementById(i).dispatchEvent(new Event('input',{bubbles:true}));});document.getElementById('ccGo').click();return 1;})()`);
  await sleep(4000);
  ok('真实创建成功并关弹窗', await ev(`document.getElementById('cloudCreateMask').classList.contains('hidden') && BB_getProjectClouds().length===1`));
  // 浮层出现全套积木
  await openGenCat('云列表');
  const cloudTypes = await ev(`Blockly.getMainWorkspace().getFlyout().getWorkspace().getTopBlocks(true).map(function(b){return b.type;}).join(',')`);
  ['cloud_tables','cloud_rows','cloud_sql','cloud_count','cloud_row_by_id','cloud_add','cloud_update','cloud_delete','cloud_field','val_json_get'].forEach(function (tp0) {
    ok('浮层含 ' + tp0, cloudTypes.indexOf(tp0) >= 0, cloudTypes);
  });
  // 下拉含云名
  ok('每块带云表格下拉(测试云)', await ev(`(function(){var b=Blockly.getMainWorkspace().getFlyout().getWorkspace().getBlocksByType('cloud_tables')[0];return b.getField('CLOUD').getOptions(true).map(function(o){return o[0];}).join('/');})()`) === '测试云');
  // 管理弹窗
  await flyoutButton(1); await sleep(350);
  ok('管理弹窗列出云表格', (await ev(`(document.querySelector('#cmList .cm-name')||{}).textContent`)) === '测试云');
  await ev(`document.getElementById('cmClose').click();1`); await sleep(200);
  // 代码生成：云表格注册前缀 + 字段堆叠（无手写 JSON）
  const cid = await ev(`BB_getProjectClouds()[0].id`);
  const codegen = await ev(`(function(){
    var ws=Blockly.getMainWorkspace();
    var cid=${JSON.stringify(cid)};
    var xml='<xml xmlns="https://developers.google.com/blockly/xml"><block type="ev_start" x="20" y="300"><statement name="DO">'
      +'<block type="act_toast"><value name="MSG"><block type="cloud_tables"><field name="CLOUD">'+cid+'</field></block></value>'
      +'<next><block type="cloud_add"><field name="CLOUD">'+cid+'</field><value name="TABLE"><shadow type="text"><field name="TEXT">测试表1</field></shadow></value>'
      +'<statement name="FIELDS"><block type="cloud_field"><value name="KEY"><shadow type="text"><field name="TEXT">测试列1</field></shadow></value><value name="VAL"><shadow type="text"><field name="TEXT">x</field></shadow></value></block></statement>'
      +'</block></next></block></statement></block></xml>';
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    return generateEventCode(ws);
  })()`);
  ok('代码前缀注入 cloudRegister', new RegExp('RT\\.cloudRegister\\("' + cid + '"').test(codegen), codegen.slice(0, 200));
  ok('代码含 await RT.cloudTables', /await RT\.cloudTables\(/.test(codegen));
  ok('字段堆叠生成 __r[ 赋值（无 JSON.stringify 手填）', /__r\[/.test(codegen) && !/ROWJSON/.test(codegen));
  ok('新增行 await RT.cloudAddRow', /await RT\.cloudAddRow\(/.test(codegen));

  /* ============ 7. 整理积木 ============ */
  console.log('— 整理积木 —');
  const tidyBtn = await ev(`!!document.querySelector('#bbZoom .bb-z[title="整理积木"]')`);
  ok('缩放列顶部有整理按钮', tidyBtn);
  const tidy = await ev(`(function(){
    var ws=Blockly.getMainWorkspace();
    var before=ws.getTopBlocks(true).map(function(b){var p=b.getRelativeToSurfaceXY();return Math.round(p.x)+'/'+Math.round(p.y);}).join(',');
    document.querySelector('#bbZoom .bb-z[title="整理积木"]').click();
    var after=ws.getTopBlocks(true).map(function(b){var p=b.getRelativeToSurfaceXY();return Math.round(p.x)+'/'+Math.round(p.y);}).join(',');
    return {before:before,after:after,snack:document.getElementById('snackbar').textContent};
  })()`);
  const afterPts = tidy.after.split(',').map(function (p) { return p.split('/').map(Number); });
  ok('cleanUp 后全部左对齐(x=14)且纵向不重叠', afterPts.length >= 2 && afterPts.every(function (p) { return p[0] === 14; }) && afterPts[1][1] > afterPts[0][1], tidy);
  ok('整理有 snack 提示', tidy.snack === '已整理积木', tidy);

  /* ============ 8. 全局缩放持久化（跨新 App） ============ */
  console.log('— 全局缩放 —');
  await ev(`(function(){var ws=Blockly.getMainWorkspace();ws.setScale(1.15);ws.scrollCenter();return 1;})()`);
  await ev(`document.body.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));1`); await sleep(450);
  const gz = await ev(`localStorage.getItem('__bb_block_zoom_v1')`);
  ok('缩放写入全局存储', gz && Math.abs(parseFloat(gz) - 1.15) < 0.02, gz);
  await ev(`document.getElementById('btnHome').click();1`); await sleep(400);
  await ev(`document.getElementById('btnNewApp').click();1`); await sleep(250);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='新App';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`); await sleep(500);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(1300);
  ok('新建 App 缩放沿用全局值', Math.abs(await ev(`Blockly.getMainWorkspace().getScale()`) - 1.15) < 0.03);

  /* ============ 9. 运行时 SeaTable 真机 CRUD（fetch 回退链路） ============ */
  console.log('— SeaTable 真机 CRUD（fetch） —');
  const crudCode =
    "RT.cloudRegister('c1',{provider:'seatable-cn',server:'https://cloud.seatable.cn',uuid:'" + UUID + "',token:'" + TOK + "',name:'测试云'});" +
    "RT.on('start', async function(){ try {" +
    "RT.setHint('inp1','请输入姓名');" +
    "var tables=await RT.cloudTables('c1');" +
    "var n0=await RT.cloudRowCount('c1','测试表1');" +
    "var rid=await RT.cloudAddRow('c1','测试表1',{'测试列1':'无头自动化','测试列2':'CRUD'});" +
    "var one=await RT.cloudRowById('c1','测试表1',rid);" +
    "var v=RT.jsonGet(one,'测试列1');" +
    "var upd=await RT.cloudUpdateRow('c1','测试表1',rid,{'测试列2':'已更新'});" +
    "var rows=await RT.cloudRows('c1','测试表1');var found=null;for(var i=0;i<rows.length;i++)if(rows[i]['_id']===rid)found=rows[i];" +
    "var sql=await RT.cloudSql('c1',\"SELECT * FROM \\u0060测试表1\\u0060 WHERE \\u0060测试列1\\u0060='无头自动化'\");" +
    "var del=await RT.cloudDeleteRow('c1','测试表1',rid);" +
    "var n1=await RT.cloudRowCount('c1','测试表1');" +
    "window.__cloudResult=JSON.stringify({ok:true,tables:tables,n0:n0,rid:rid,get:v,upd:upd,updVal:found&&found['测试列2'],sql:sql.length,del:del,n1:n1,hint:document.querySelector('[data-id=inp1] input').placeholder});" +
    "} catch(e){ window.__cloudResult=JSON.stringify({ok:false,err:String(e&&e.message||e)}); } });";
  const project = { appName: '云测', orientation: 'portrait', startScreen: 's1', screens: [{ id: 's1', name: '页面1', components: [{ id: 'inp1', type: 'input', hint: '旧提示' }], code: crudCode }] };
  await ev(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(project))});1`);
  await load('http://127.0.0.1:8931/runtime.html');
  let live = null;
  for (let i = 0; i < 20; i++) { live = await ev(`window.__cloudResult||null`); if (live) break; await sleep(600); }
  const lr = live ? JSON.parse(live) : { ok: false, err: 'timeout' };
  ok('鉴权+表名', lr.ok && lr.tables.indexOf('测试表1') >= 0, lr);
  ok('新增返回行Id', lr.ok && typeof lr.rid === 'string' && lr.rid.length >= 6, lr);
  ok('按Id取行+jsonGet', lr.ok && lr.get === '无头自动化', lr);
  ok('更新成功且回读=已更新', lr.ok && lr.upd === true && lr.updVal === '已更新', lr);
  ok('SQL WHERE 命中', lr.ok && lr.sql >= 1, lr);
  ok('删除1行且计数还原', lr.ok && lr.del === 1 && lr.n1 === lr.n0, lr);
  ok('setHint 运行时生效', lr.ok && lr.hint === '请输入姓名', lr);

  /* ============ 9b. 原生 HTTP 桥接链路 ============ */
  console.log('— 原生桥接链路 —');
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    "window.Native={getMode:function(){return 'shell';}," +
    "httpRequest:function(id,method,url,hj,body){" +
    "var h;try{h=JSON.parse(hj||'{}');}catch(e){h={};}" +
    "fetch(url,{method:method,headers:h,body:body||undefined}).then(function(r){return r.text().then(function(t){window.__nativeHttpResolve(id,JSON.stringify({status:r.status,body:t}));});})" +
    ".catch(function(e){window.__nativeHttpResolve(id,JSON.stringify({error:String(e&&e.message||e)}));});}};"
  });
  await ev(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(project))});1`);
  await load('http://127.0.0.1:8931/runtime.html');
  let live2 = null;
  for (let i = 0; i < 20; i++) { live2 = await ev(`window.__cloudResult||null`); if (live2) break; await sleep(600); }
  const lr2 = live2 ? JSON.parse(live2) : { ok: false, err: 'timeout' };
  ok('原生链路完整 CRUD', lr2.ok && lr2.get === '无头自动化' && lr2.updVal === '已更新' && lr2.del === 1 && lr2.n1 === lr2.n0, lr2);

  /* ============ 10. 错误密钥拦截 ============ */
  const badCode = "RT.cloudRegister('cbad',{provider:'seatable-cn',server:'https://cloud.seatable.cn',uuid:'" + UUID + "',token:'bad_token_xxx'});" +
    "RT.on('start', async function(){ try { await RT.cloudTables('cbad'); window.__cloudResult2='NO'; } catch(e){ window.__cloudResult2=e.message; } });";
  const p2 = { appName: '错测', orientation: 'portrait', startScreen: 's1', screens: [{ id: 's1', name: '页面1', components: [], code: badCode }] };
  await ev(`localStorage.setItem('__previewProject', ${JSON.stringify(JSON.stringify(p2))});1`);
  await load('http://127.0.0.1:8931/runtime.html');
  let bad = null;
  for (let i = 0; i < 15; i++) { bad = await ev(`window.__cloudResult2||null`); if (bad) break; await sleep(500); }
  ok('错误密钥被拦截并报错', !!bad && bad !== 'NO' && bad.length > 0, bad);

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
