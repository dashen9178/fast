const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===id){ws.removeEventListener('message',h);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method,params}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable');
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='sm';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const res = await ev(`(function(){
    var types=Object.keys(Blockly.Blocks);
    var bad=[], createErr=[], ok=0;
    for(var k=0;k<types.length;k++){
      var ty=types[k];
      try{
        blocklyWs.clear();
        Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="'+ty+'" x="40" y="40"></block></xml>'),blocklyWs);
        var b=blocklyWs.getTopBlocks(true)[0];
        if(!b){ createErr.push(ty+':no-block'); continue; }
        var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
        var dr=ren.makeDrawer_(b,info); dr.drawOutline_();
        var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
        if(Math.abs(bb.x)>0.05) bad.push(ty+':pathL='+(+bb.x.toFixed(2)));
        else ok++;
      }catch(e){ createErr.push(ty+':'+e.message.split(String.fromCharCode(10))[0].slice(0,60)); }
    }
    return JSON.stringify({total:types.length,ok:ok,bad:bad,createErr:createErr},null,0);
  })()`);
  const r=JSON.parse(res);
  console.log('TOTAL',r.total,'OK',r.ok);
  console.log('PATHL BAD ('+r.bad.length+'):', r.bad.join(' | ')||'none');
  console.log('CREATE ERR ('+r.createErr.length+'):', r.createErr.join(' | ')||'none');
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
