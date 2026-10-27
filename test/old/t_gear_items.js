const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,250));return r.result.value;};
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2200);
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(500);
await ev(`var i=document.getElementById('newAppName');i.value='齿轮项';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
const R={};
async function run(type, minCount){
  await ev(`blocklyWs.clear();1`);await sleep(200);
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="${type}" x="300" y="200"></block></xml>'),blocklyWs);1`);await sleep(400);
  const init=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');return b.itemCount_;})()`);
  // 点齿轮
  const p=JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');var r=ic.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`));
  async function clickAt(x,y){await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(20);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await sleep(300);}
  await clickAt(p.x,p.y);
  const title=await ev(`(document.getElementById('ifMutTitle')||{}).textContent`);
  const num0=await ev(`document.getElementById('ifMutNum').textContent`);
  await ev(`document.getElementById('ifMutPlus').click();1`);await sleep(120);
  await ev(`document.getElementById('ifMutPlus').click();1`);await sleep(120);
  const num2=await ev(`document.getElementById('ifMutNum').textContent`);
  const cnt2=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');return b.itemCount_;})()`);
  const inputs2=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');return b.inputList.filter(i=>/^ADD/.test(i.name)).length;})()`);
  // 减到下限
  for(let k=0;k<5;k++){ await ev(`var m=document.getElementById('ifMutMinus');if(!m.disabled)m.click();1`);await sleep(80); }
  const minDisabled=await ev(`document.getElementById('ifMutMinus').disabled`);
  const cntMin=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');return b.itemCount_;})()`);
  await clickAt(6,6); // mask 关闭
  // 撤销应恢复
  await ev(`blocklyWs.undo(false);1`);await sleep(150);
  const undoCnt=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');return b.itemCount_;})()`);
  R[type]={init,title,num0,num2,cnt2,inputs2,minDisabled,cntMin,undoCnt};
}
await run('text_join');
await run('lists_create_with');
console.log(JSON.stringify(R,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
