// 逐行记录 FastDrawer 右侧路径贡献
const BASE = 'http://127.0.0.1:8931/editor.html?z=' + Date.now();
const PORT = 9333;
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===id){ws.removeEventListener('message',h);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method,params}));});}
  async function ev(expr){const r=await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable');
  await cdp('Page.navigate',{url:BASE});
  await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='probe2';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"><mutation elseif="1" else="1"/>
    <value name="IF0"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="math_number"><field name="NUM">123456</field></block></value><value name="B"><block type="math_number"><field name="NUM">654321</field></block></value></block></value>
    <statement name="DO0"><block type="act_back"></block></statement></block></xml>`;
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs);'ok'`);
  await sleep(500);
  const out = await ev(`(function(){
    var ren=blocklyWs.getRenderer(); var b=blocklyWs.getTopBlocks(true).find(function(x){return x.type==='controls_if';});
    var info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info);
    var log=[];
    var proto=Object.getPrototypeOf(dr);
    ['drawRightSideRow_','drawStatementInput_','drawValueInput_'].forEach(function(m){
      var orig=proto[m]; if(!orig)return;
      proto[m]=function(row){ var before=this.outlinePath_; orig.call(this,row); var delta=this.outlinePath_.slice(before.length);
        var nm=(row&&row.getLastInput&&row.getLastInput()&&row.getLastInput().input&&row.getLastInput().input.name)||'';
        log.push(m+' y='+(row&&row.yPos)+' h='+(row&&row.height)+' w='+(row&&(row.width||0).toFixed&&(row.width).toFixed(1))+' name='+nm+' :: '+delta); };
    });
    dr.drawOutline_&&dr.drawOutline_();
    return log.join('\\n');
  })()`);
  console.log(out);
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
