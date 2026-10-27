// 齿轮增删分支 / 撤销重做后几何仍正确、无异常
const fs = require('fs');
const http = require('http');
const HTTP = 'http://127.0.0.1:9222';
const out = process.argv[2] || 'mutate.png';
function get(p) {
  return new Promise((res, rej) => http.get(HTTP + p, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
(async () => {
  const l = await get('/json/list');
  const t = l.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const P = {};
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => {
    const o = JSON.parse(e.data);
    if (o.id && P[o.id]) o.error ? P[o.id].j(new Error(JSON.stringify(o.error))) : P[o.id].r(o.result);
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') logs.push(o.params.args.map(a => a.value || a.description).join(' '));
    if (o.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (o.params.exceptionDetails.exception ? o.params.exceptionDetails.exception.description : o.params.exceptionDetails.text));
  };
  const logs = [];
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; P[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.log('EXC', JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails).slice(0, 700));
    return r.result.value;
  };
  await send('Page.navigate', { url: 'http://127.0.0.1:8932/editor.html' });
  await sleep(2000);
  await ev(`document.getElementById('btnNewApp').click();1`); await sleep(400);
  await ev(`var i=document.getElementById('newAppName');i.value='变异';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`); await sleep(1100);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(800);

  const result = await ev(`(function(){
    var ws0=blocklyWs,B=Blockly; var trace=[];
    function mk(type,fields){var b=ws0.newBlock(type);b.initSvg();b.render();if(fields)Object.keys(fields).forEach(function(k){b.setFieldValue(fields[k],k);});return b;}
    var top=ws0.newBlock('controls_if');top.initSvg();top.render();top.moveBy(80,60);
    var bri=mk('act_set_brightness'); bri.getInput('V').connection.connect(mk('math_number',{NUM:'80'}).outputConnection);
    top.getInput('DO0').connection.connect(bri.previousConnection);
    var vib=mk('act_vibrate'); vib.getInput('MS').connection.connect(mk('math_number',{NUM:'30'}).outputConnection);
    function shape(ei,el){top.elseifCount_=ei;top.elseCount_=el;if(top.rebuildShape_)top.rebuildShape_();else top.updateShape_();top.render();}
    function snap(tag){
      var info=ws0.getRenderer().makeRenderInfo_(top);info.measure();
      var bad=[];
      var stmtRows=info.rows.filter(function(r){return r.hasStatement;});
      var inputs=top.inputList.filter(function(i){return i.type===B.inputTypes.STATEMENT;});
      inputs.forEach(function(inp,k){var tb=inp.connection.targetBlock();if(!tb)return;var row=stmtRows[k];var idx=info.rows.indexOf(row);
        var cr=(row.statementEdge||0)+tb.getHeightWidth().width; if(cr>info.__ifRowEdges[idx]+9)bad.push(inp.name+':'+Math.round(cr-info.__ifRowEdges[idx]));});
      trace.push(tag+' ei='+top.elseifCount_+' el='+top.elseCount_+' inputs='+inputs.length+' rows='+info.rows.length+(bad.length?(' BAD '+bad.join(',')):' ok'));
    }
    shape(1,0); top.getInput('DO1').connection.connect(vib.previousConnection); top.render(); snap('+elseif1');
    shape(2,0); snap('+elseif2(empty)');
    shape(2,1); snap('+else');
    // 把宽块从 DO0 移到 DO2
    var wide=top.getInput('DO0').connection.targetBlock();
    top.getInput('DO2').connection.connect(wide.previousConnection); snap('move wide->DO2');
    shape(1,1); snap('-elseif (2->1)');
    shape(0,0); snap('-all');
    shape(2,1);
    var w2=top.getInput('DO2')?top.getInput('DO2').connection.targetBlock():null;
    snap('re-add 2+1 wideStill='+(w2?w2.type:'LOST'));
    return JSON.stringify(trace,null,1);
  })()`);
  console.log(result);
  await sleep(300);
  console.log('CONSOLE_ERRORS', JSON.stringify(logs));
  const q = await ev(`(function(){var b=blocklyWs.getBlocksByType('controls_if')[0];var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left-14),y:Math.round(r.top-14),w:Math.round(r.width+28),h:Math.round(r.height+28)});})()`);
  const p = JSON.parse(q);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: p.x, y: p.y, width: p.w, height: p.h, scale: 2 } });
  fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
  console.log('shot ->', out);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
