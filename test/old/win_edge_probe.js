// CDP 探针：用 Node22 内置 WebSocket 连 Edge headless，复刻编辑器进入流程后导出 controls_if 几何
const BASE = 'http://127.0.0.1:8931/editor.html?z=' + Date.now();
const PORT = 9333;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function getJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error('GET '+u+' '+r.status); return r.json(); }

(async()=>{
  let list=null;
  for(let i=0;i<30;i++){ try{ list = await getJSON('http://127.0.0.1:'+PORT+'/json/list'); if(list && list.length) break; }catch(e){} await sleep(500); }
  if(!list) throw new Error('edge devtools not reachable');
  let page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.addEventListener('open',res,{once:true}); ws.addEventListener('error',rej,{once:true}); });
  let seq=0;
  function cdp(method,params={}){ return new Promise((res,rej)=>{ const id=++seq; const h=(ev)=>{ const m=JSON.parse(ev.data); if(m.id===id){ ws.removeEventListener('message',h); m.error?rej(new Error(JSON.stringify(m.error))):res(m.result); } }; ws.addEventListener('message',h); ws.send(JSON.stringify({id,method,params})); }); }
  async function ev(expr){ const r = await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text)); return r.result.value; }

  await cdp('Page.enable');
  await cdp('Page.navigate',{url:BASE});
  await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click(); 'ok'`);
  await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='probe';i.dispatchEvent(new Event('input',{bubbles:true}));return i.value;})()`);
  await sleep(200);
  await ev(`document.getElementById('createGo').click(); 'ok'`);
  await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click(); 'ok'`);
  await sleep(1500);

  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="1" else="1"/>
      <value name="IF0"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="math_number"><field name="NUM">123456</field></block></value><value name="B"><block type="math_number"><field name="NUM">654321</field></block></value></block></value>
      <statement name="DO0"><block type="act_back"></block></statement>
      <statement name="DO1"><block type="act_toast"></block></statement>
    </block></xml>`;
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'loaded'`);
  await sleep(500);

  const dump = await ev(`(function(){
    var ws=blocklyWs, ren=ws.getRenderer();
    var b=ws.getTopBlocks(true).find(function(x){return x.type==='controls_if';});
    var C=ren.getConstants();
    var info=ren.makeRenderInfo_(b); info.measure();
    var rows=info.rows.map(function(rw,idx){
      var rec={i:idx, kind:rw.constructor.name.replace(/.+\\./,''), hasStmt:!!rw.hasStatement, w:+rw.width.toFixed(1), x:+rw.xPos.toFixed(1), y:+rw.yPos.toFixed(1), h:+rw.height.toFixed(1)};
      try{ var inp=rw.getLastInput&&rw.getLastInput(); if(inp){ rec.inputName=inp.input&&inp.input.name; rec.inpX=+inp.xPos.toFixed(1); rec.inpW=+inp.width.toFixed(1); rec.notchOff=inp.notchOffset; rec.shapeW=inp.shape&&inp.shape.width; rec.inpCtor=inp.constructor.name.replace(/.+\\./,''); } }catch(e){ rec.inpErr=String(e); }
      rec.els=(rw.elements||[]).map(function(e){ return e.constructor.name.replace(/.+\\./,'')+(T_isSpacer(e)?('['+(e.width||0).toFixed(0)+']'):''); function T_isSpacer(x){ return x && x.type===1; } });
      return rec;
    });
    // drawer outline
    var dr=ren.makeDrawer_(b, info); dr.drawOutline_&&dr.drawOutline_();
    var path=dr.outlinePath_;
    return { constants:{ PAD_L:C.STATEMENT_INPUT_PADDING_LEFT, NOTCH_OFF_LEFT:C.NOTCH_OFFSET_LEFT, STMT_NOTCH_OFF:C.STATEMENT_INPUT_NOTCH_OFFSET, NOTCH_W:C.NOTCH_WIDTH, INSIDE_W:C.INSIDE_CORNERS.rightWidth||C.INSIDE_CORNERS.width, MIN_ARM:C.STATEMENT_INPUT_SPACER_MIN_WIDTH }, edges:info.__ifEdges, width:info.width, rows:rows, path:path };
  })()`);
  console.log(JSON.stringify(dump,null,1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('PROBE ERR', e); process.exit(1); });
