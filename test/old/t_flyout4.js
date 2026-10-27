const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='事件');if(b)b.click();return 1;})()`);
await sleep(500);
// 模拟加载工程后 setScale 1.1 但不 reflow
await ev(`blocklyWs.setScale(1.1);1`);
await sleep(300);
const before=await ev(`(function(){var fl=blocklyWs.getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.getSvgRoot().getBoundingClientRect();var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();return JSON.stringify({flScale:fl.getWorkspace().scale,flW:fl.width_,overhangR:Math.round(r.right-svg.right),overhangL:Math.round(svg.left-r.left)});})()`);
console.log('broken state:',before);
// 手动 reflow
await ev(`(function(){var fl=blocklyWs.getFlyout();fl.reflow();fl.position();return 1;})()`);
await sleep(300);
const after=await ev(`(function(){var fl=blocklyWs.getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.getSvgRoot().getBoundingClientRect();var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();return JSON.stringify({flScale:fl.getWorkspace().scale,flW:fl.width_,overhangR:Math.round(r.right-svg.right),overhangL:Math.round(svg.left-r.left)});})()`);
console.log('after reflow:',after);
// 测试补偿函数原型
const proto=await ev(`(function(){
  var fl=blocklyWs.getFlyout();
  function compensate(){
    var fws=fl.getWorkspace(), scale=fws.scale; if(!scale)return;
    var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();
    var maxL=0,maxR=0;
    fws.getTopBlocks(true).forEach(function(b){
      var r=b.getSvgRoot().getBoundingClientRect();
      maxL=Math.max(maxL,svg.left-r.left);
      maxR=Math.max(maxR,r.right-svg.right);
    });
    var pad=6;
    var dx=maxL+pad>0?Math.ceil((maxL+pad)/scale):0;
    var dw=maxR+pad>0?Math.ceil((maxR+pad)/scale):0;
    if(dx){fws.getTopBlocks(true).forEach(function(b){b.moveBy(dx,0);var rc=fl.rectMap_&&fl.rectMap_.get(b);if(rc)fl.moveRectToBlock_(rc,b);});}
    if(dw){fl.width_+=(dw*scale);fl.position();}
    return JSON.stringify({dx:dx,dw:dw});
  }
  fl.width_=fl.getWidth?fl.getWidth():fl.width_;
  return compensate();
})()`);
console.log('compensate @1.1:',proto);
await sleep(200);
const fin=await ev(`(function(){var fl=blocklyWs.getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.getSvgRoot().getBoundingClientRect();var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();return JSON.stringify({flW:fl.width_,overhangR:Math.round(r.right-svg.right),overhangL:Math.round(svg.left-r.left)});})()`);
console.log('final:',fin);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/t_flyout_fix.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
