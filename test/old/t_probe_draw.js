const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 两个块：宽→窄（else），等宽对照
await ev(`(function(){
  var B=Blockly;
  var xml=B.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="60" y="40"><mutation else="1"></mutation>'
      +'<value name="IF0"><block type="logic_compare"><field name="OP">EQ</field></block></value>'
    +'</block>'
    +'<block type="controls_if" x="60" y="420"><mutation else="1"></mutation></block>'
    +'</xml>');
  B.Xml.domToWorkspace(xml,blocklyWs);
  return 1;})()`);
await sleep(500);
// 插桩：包裹 zelos Drawer 的 drawStatementInput_ / drawRightSideRow_，记录真实行数据
await ev(`(function(){
  window.__log=[];
  var ren=blocklyWs.getRenderer();
  var b0=blocklyWs.getTopBlocks(true)[0];
  var drawer=ren.makeDrawer_(b0,ren.makeRenderInfo_(b0));
  var D=Object.getPrototypeOf(drawer);
  var origS=D.drawStatementInput_, origR=D.drawRightSideRow_;
  D.drawStatementInput_=function(row){
    var before=this.outlinePath_;
    var b=row.getLastInput();
    var c=b?b.xPos+b.notchOffset+b.shape.width:null;
    origS.call(this,row);
    var added=this.outlinePath_.slice(before.length);
    window.__log.push({k:'stmt',bt:this.block_.type,id:this.block_.id.slice(0,4),
      y:row.yPos,h:row.height,x:row.xPos,w:row.width,edge:row.statementEdge,
      c:c, connBottom:b?b.connectedBottomNextConnection:null,
      pr:b?b.shape.pathRight:null, pl:b?b.shape.pathLeft:null, added:added});
  };
  D.drawRightSideRow_=function(row){
    var before=this.outlinePath_;
    origR.call(this,row);
    var added=this.outlinePath_.slice(before.length);
    if(row.height>0||added.trim())window.__log.push({k:'row',bt:this.block_.type,id:this.block_.id.slice(0,4),
      y:row.yPos,h:row.height,x:row.xPos,w:row.width,added:added});
  };
  blocklyWs.getAllBlocks(false).forEach(function(b){if(b.rendered)b.renderEfficiently?b.renderEfficiently():b.render();});
  return 1;})()`);
await sleep(600);
const log=await ev(`window.__log`);
console.log(JSON.stringify(log,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
