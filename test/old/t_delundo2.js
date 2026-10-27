const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,200));return r.result.value;};
await ev(`blocklyWs.clear();1`);await sleep(200);
await ev(`(function(){
  var xml=Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="300" y="60"></block>'
    +'<block type="controls_repeat_ext" x="300" y="200"></block>'
    +'<block type="text_print" x="300" y="340"></block>'
    +'<block type="text_print" x="300" y="420"></block>'
    +'<block type="controls_if" x="300" y="500"></block>'
    +'</xml>');
  Blockly.Xml.domToWorkspace(xml,blocklyWs);
  return 1;
})()`);
await sleep(300);
await ev(`(function(){
  var tops=blocklyWs.getTopBlocks(true);
  for(var i=0;i<tops.length-1;i++){var c=tops[i].nextConnection;var p=tops[i+1].previousConnection;if(c&&p)c.connect(p);}
  return 1;
})()`);
await sleep(500);
function chainLayout(){return ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];var out=[];var cur=b;
  while(cur){var p=cur.getRelativeToSurfaceXY();out.push({t:cur.type,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,h:cur.height.width?cur.getHeightWidth().height:cur.height});cur=cur.getNextBlock();}
  // 相邻块 y 差应等于上一块高度
  var bad=[];for(var i=0;i<out.length-1;i++){var d=Math.round((out[i+1].y-out[i].y)*10)/10;if(Math.abs(d-out[i].h)>0.6)bad.push(i+':gap='+d+' h='+out[i].h);}
  return JSON.stringify({n:out.length,bad:bad,ys:out.map(o=>o.y)});
})()`);}
const before=JSON.parse(await chainLayout());
// 复刻 delBlock(b,true)：dispose(true) 愈合，同一撤销组
await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];var mid=b.getNextBlock().getNextBlock();
  Blockly.Events.setGroup('testdel2');
  mid.dispose(true);
  Blockly.Events.setGroup(false);
  return 1;
})()`);
await sleep(500);
const afterDel=JSON.parse(await chainLayout());
await ev(`blocklyWs.undo(false);1`);await sleep(600);
const afterUndo=JSON.parse(await chainLayout());
// 再撤销（应回到未连接的散落状态之一不做要求），重做应恢复删除
await ev(`blocklyWs.undo(true);1`);await sleep(500);
const afterRedo=JSON.parse(await chainLayout());
console.log(JSON.stringify({before,afterDel,afterUndo,afterRedo},null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
