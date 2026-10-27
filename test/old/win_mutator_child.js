const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let failures=0;
function check(n,c,x){console.log((c?'  OK  ':'  FAIL')+' '+n+(x?'  '+x:''));if(!c)failures++;}
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(m,p={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const d=JSON.parse(ev.data);if(d.id===id){ws.removeEventListener('message',h);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method:m,params:p}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable');
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='v113c';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(
    `<xml xmlns="https://developers.google.com/blockly/xml">
      <block type="controls_if" x="60" y="40">
        <statement name="DO0"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">齿轮测试超长提示哈哈哈哈哈哈</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
      </block></xml>`)}),blocklyWs);'ok'`);
  await sleep(300);
  async function state(tag){ const s=await ev(`(function(){
     var b=blocklyWs.getTopBlocks(true)[0];
     var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure();
     var dr=blocklyWs.getRenderer().makeDrawer_(b,i); dr.drawOutline_();
     var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
     var c0=b.getInput('DO0').connection.targetBlock();
     var pockets=[];
     i.rows.forEach(function(r){ if(r.hasStatement){var inp=r.getLastInput(); var c=inp&&inp.connectedBlock;
       pockets.push(inp.input.name+':'+(+i.__ifRowEdge.get(r).toFixed(1))+(c?'['+c.type+']':''));}});
     return 'n='+i.__ifEdges.length+' pathL='+(+bb.x.toFixed(2))+' DO0child='+(c0?c0.type:'NONE')+' pockets=['+pockets.join(',')+']';
  })()`); return tag+' '+s; }
  async function mut(ei,hasElse){ return ev(`(function(){
     var b=blocklyWs.getTopBlocks(true)[0];
     var oldState=b.saveExtraState?b.saveExtraState():{elseIfCount:b.elseifCount_||0,hasElse:!!b.elseCount_};
     var newState={elseIfCount:${ei},hasElse:${hasElse?'true':'false'}};
     var g='ifmut_'+Date.now()+'_'+Math.floor(Math.random()*1e6);
     Blockly.Events.setGroup(g);
     try{ Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,JSON.stringify(oldState),JSON.stringify(newState)));
       b.loadExtraState(newState); b.render(); } finally { Blockly.Events.setGroup(false); }
     return 1; })()`); }
  console.log(await state('start'));
  await mut(1,false); await sleep(200); console.log(await state('+elseif'));
  await mut(2,true); await sleep(200); console.log(await state('+elseif2+else'));
  await mut(0,false); await sleep(200); console.log(await state('back-to-basic'));
  await mut(1,true); await sleep(200); console.log(await state('again'));
  const last=await state('final');
  check('final has DO0 toast child', /DO0child=act_toast/.test(last), last);
  check('final pathL=0', /pathL=0/.test(last), last);
  console.log(failures===0?'\nALL PASSED':'\n'+failures+' FAILED');
  ws.close(); process.exit(failures?2:0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
