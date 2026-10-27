const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
const R={};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1100);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(180);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(80);
await ev(`document.getElementById('createGo').click();1`);await sleep(600);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);

// 1. 新事件帽块：无语句槽、有 next
await ev(`(function(){
  var xml=Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
   +'<block type="ev_start" x="200" y="80"><next><block type="text_print"><value name="TEXT"><shadow type="text"><field name="TEXT">hi</field></shadow></value></block></next></block>'
   +'</xml>');
  Blockly.Xml.domToWorkspace(xml,blocklyWs);
  return 1;
})()`);await sleep(400);
R.hatShape=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='ev_start');
  return JSON.stringify({stmtCount:b.statementInputCount,hasNext:!!b.nextConnection,hasPrev:!!b.previousConnection,
    nextType:b.getNextBlock()&&b.getNextBlock().type});})()`);
// 2. 代码生成：回调体含下方积木且不重复
R.hatCode=await ev(`(function(){var c=window.generateEventCode(blocklyWs);return c.replace(/\\s+/g,' ').trim();})()`);

// 3. if 新规则：加 2 分支，无 else
await ev(`(function(){var b=Blockly.Xml.domToBlock(Blockly.utils.xml.textToDom('<block type="controls_if"></block>'),blocklyWs);b.moveBy(260,300);return 1;})()`);await sleep(300);
R.if0=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');return JSON.stringify({ei:b.elseifCount_,el:b.elseCount_,stmt:b.statementInputCount});})()`);
// 齿轮加 2
async function gearClick(btn){
  var pos=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');var r=ic.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
  var p=JSON.parse(pos);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await sleep(30);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});await sleep(350);
  await ev(`document.getElementById('${btn}').click();1`);await sleep(150);
  if(btn==='ifMutPlus')await ev(`document.getElementById('${btn}').click();1`); // 加两次
  await sleep(150);
  // 点遮罩外关闭
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:6,y:6,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:6,y:6,button:'left',clickCount:1});await sleep(350);
}
await gearClick('ifMutPlus');
R.ifAfterAdd2=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');
  return JSON.stringify({ei:b.elseifCount_,el:b.elseCount_,stmt:b.statementInputCount,
    labels:[].slice.call(b.getSvgRoot().querySelectorAll('text.blocklyText')).map(t=>t.textContent).filter(s=>s.indexOf('如果')>=0||s.indexOf('否则')>=0)});})()`);

// 4. 旧工程迁移：旧 ev_start 带 DO 槽；旧 if 带 else
var oldXml='<xml xmlns="https://developers.google.com/blockly/xml">'
 +'<block type="ev_start" x="600" y="80"><statement name="DO"><block type="text_print"><value name="TEXT"><shadow type="text"><field name="TEXT">old</field></shadow></value></block><next><block type="act_show"></block></next></statement></block>'
 +'<block type="controls_if" x="600" y="300"><mutation elseif="1" else="1"></mutation></block>'
 +'</xml>';
R.migrate=await ev(`(function(){
  var dom=Blockly.utils.xml.textToDom(${JSON.stringify(oldXml)});
  migrateEventHatXml(dom);
  var ser=Blockly.utils.xml.domToText(dom);
  Blockly.Xml.domToWorkspace(dom,blocklyWs);
  var ev2=blocklyWs.getTopBlocks(true).filter(b=>b.type==='ev_start').pop();
  var chain=[];var c=ev2;while(c){chain.push(c.type);c=c.getNextBlock();}
  var oldIf=blocklyWs.getTopBlocks(true).filter(b=>b.type==='controls_if').pop();
  return JSON.stringify({hasStatementDO:ser.indexOf('statement')<0,chain:chain,oldIfEi:oldIf.elseifCount_,oldIfEl:oldIf.elseCount_});
})()`);
await sleep(300);
// 迁移后旧事件代码生成
R.migratedCode=await ev(`(function(){
  var ws=new Blockly.Workspace();
  var dom=Blockly.utils.xml.textToDom(${JSON.stringify(oldXml)});
  migrateEventHatXml(dom);Blockly.Xml.domToWorkspace(dom,ws);
  var code=window.generateEventCode(ws);ws.dispose();
  return code.replace(/\\s+/g,' ').trim();
})()`);

console.log(JSON.stringify(R,null,1));
// 截图：新事件帽 + if
let shot=async (expr,file)=>{const q=await send('Runtime.evaluate',{expression:expr,returnByValue:true});const p=JSON.parse(q.result.value);
  const s=await send('Page.captureScreenshot',{format:'png',clip:{x:p.x,y:p.y,width:p.w,height:p.h,scale:1.7}});
  fs.writeFileSync(file,Buffer.from(s.data,'base64'));};
await shot(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left-8),y:Math.round(r.top-8),w:Math.round(r.width+16),h:Math.round(r.height+16)});})()`,'/tmp/t_new_if.png');
await shot(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='ev_start');var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left-40),y:Math.round(r.top-12),w:Math.round(r.width+60),h:Math.round(r.height+24)});})()`,'/tmp/t_new_hat.png');
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
