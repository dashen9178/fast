const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2200);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(500);
await ev(`var i=document.getElementById('newAppName');i.value='冒烟';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
const xml=`<xml xmlns="https://developers.google.com/blockly/xml">
<block type="controls_repeat_ext" x="60" y="40"><value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value></block>
<block type="controls_whileUntil" x="60" y="200"></block>
<block type="controls_for" x="60" y="340"><field name="VAR">i</field></block>
<block type="ev_first_start" x="60" y="520"><next><block type="ev_start"></block></next></block>
</xml>`;
await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);1`);await sleep(600);
const s=await send('Page.captureScreenshot',{format:'png',clip:{x:300,y:60,width:520,height:620,scale:1.5}});
fs.writeFileSync('/tmp/t_csmoke.png',Buffer.from(s.data,'base64'));
console.log(await ev(`JSON.stringify(blocklyWs.getAllBlocks?blocklyWs.getAllBlocks().map(b=>b.type):[])`));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
