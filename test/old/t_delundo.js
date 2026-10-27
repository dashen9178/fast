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
// 当前页面是齿轮测试后的编辑器（1 elseif 状态）。清空，构造 5 个纵向堆叠块
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
await sleep(400);
// 用 Blockly 原生连接把它们纵向串起来（模拟堆叠），再记录每个块的相对位置
await ev(`(function(){
  var tops=blocklyWs.getTopBlocks(true);
  for(var i=0;i<tops.length-1;i++){
    var c=tops[i].nextConnection;var p=tops[i+1].previousConnection;
    if(c&&p)c.connect(p);
  }
  return 1;
})()`);
await sleep(400);
function gaps(){return ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];var chain=[];var cur=b;
  while(cur){var r=cur.getSvgRoot().getBoundingClientRect();chain.push({t:cur.type,y:Math.round(r.top),h:Math.round(r.height)});cur=cur.getNextBlock();}
  var overlaps=[];for(var i=0;i<chain.length-1;i++){var gap=chain[i+1].y-(chain[i].y+chain[i].h);if(gap<-2)overlaps.push(i+':'+gap);}
  return JSON.stringify({n:chain.length,overlaps:overlaps,ys:chain.map(c=>c.y)});
})()`);}
const before=JSON.parse(await gaps());
// 删除链中第 3 个（text_print），模拟 UI“删除此单个积木”：调用 delBlock 逻辑等价——删除并愈合打包
await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];var mid=b.getNextBlock().getNextBlock(); // 第3个
  window.__mid=mid;
  Blockly.Events.setGroup('testdel');
  var prev=mid.previousConnection.targetConnection;var next=mid.nextConnection&&mid.nextConnection.targetConnection;
  mid.dispose(false);
  if(prev&&next)prev.connect(next);
  Blockly.Events.setGroup(false);
  return 1;
})()`);
await sleep(400);
const afterDel=JSON.parse(await gaps());
// 撤销
await ev(`blocklyWs.undo(false);1`);await sleep(500);
const afterUndo=JSON.parse(await gaps());
console.log(JSON.stringify({before,afterDel,afterUndo},null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
