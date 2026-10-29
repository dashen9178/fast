/* 代码应用运行时 v1.2：渲染界面（含坐标/样式）+ 执行代码生成的 JS */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var project = null, isPreview = false;
  var stack = [], current = null;
  var clickMap = {}, itemClickMap = {}, startHandlers = [], firstStartHandlers = [], selected = {}, changeMap = {};
/* 滑屏（用户要求：检测上/下/左/右滑 + 滑动距离）。滑完把方向与距离记在 lastSwipe，
   代码块里的「滑动的距离 / 滑动的方向」就是读它。 */
var swipeHandlers = [], lastSwipe = { dir: '', dx: 0, dy: 0, dist: 0, ms: 0 };
/* 渲染容器子控件时，把"父容器宽度"放这里：这样居中锁/默认尺寸按容器算，而不是按整屏算 */
var 渲染父宽 = null;
// 计时器 / 画布 的运行时状态（按控件 id 存）
var timers = {}, canvasMap = {};
/* 时钟控件：一个全局 1 秒定时器统一刷新所有 .rt-clock 节点。
   用"先查询再更新"而不是给每个控件各开一个 interval：控件随页面切换被销毁时，
   下一个 tick 用 document.body.contains 一判就把它剔掉，不会留下悬空定时器。 */
var 时钟表 = [];
function 时钟文字(fmt) {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  if (fmt === 'hms') return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  if (fmt === 'mdhm') return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function 启动走秒(node, fmt) {
  node.textContent = 时钟文字(fmt);
  node.__fmt = fmt;
  时钟表.push({ node: node, fmt: fmt });
  if (时钟表.定时) return;
  时钟表.定时 = setInterval(function () {
    for (var i = 时钟表.length - 1; i >= 0; i--) {
      var x = 时钟表[i];
      if (!document.body.contains(x.node)) { 时钟表.splice(i, 1); continue; }
      if (x.node.__frozen) continue;          // 代码里设过文字就不再走秒
      x.node.textContent = 时钟文字(x.fmt);
    }
    if (!时钟表.length) { clearInterval(时钟表.定时); 时钟表.定时 = 0; }
  }, 1000);
}
  // “当页面首次启动时”只在本次运行进程内记录；杀掉后台/重新打开 App（页面重新加载）会重新执行
  var firstFired = Object.create(null);
  // 页面渲染代号：每次 render 自增。启动事件改为渲染完成后的异步任务，跳转离开后旧任务作废
  var renderGen = 0;
  // 循环跳转保护：每个页面的代码只在该页面被打开（渲染）时执行。
  // 判定方式：在“启动事件引发的连续自动跳转”里（含等待后才跳的慢循环——整个 async 事件都算自动流程），
  // 同一页面的“当页面启动时”第 3 次触发，即说明存在由启动事件驱动的死循环（如两个页面互跳），静默刹车。
  // 不再弹提示框（原黑框 toast 已按需求移除）；“首次启动”代码只执行一次，照常执行。
  // 不会误拦：线性流程（每页只开一次）、“当页面首次启动时”（仅一次）、用户点按钮/返回等手势（会重置计数）。
  var autoBurst = Object.create(null);
  // 当前导航由谁发起：'auto'=页面启动事件（含其 await 之后的延续）；'user'=点击/滑块/列表项/返回等手势。
  // 自动导航只“替换”栈顶（启动链上的中转页不该进返回栈，否则按返回会被启动代码弹回、退不出去）；
  // 用户主动跳转才压栈。
  var navKind = 'auto';
  function refillNavBudget() { autoBurst = Object.create(null); }   // 用户操作=新流程
  function userGesture() { navKind = 'user'; refillNavBudget(); }

  function mode() { return (window.Native && Native.getMode) ? Native.getMode() : 'editor'; }

  /* ---------------- 设备信息：帧率实时采样 + 原生 deviceInfo ---------------- */
  // 用 requestAnimationFrame 实测 App 实际渲染帧率（每秒更新一次滚动值）
  var fpsValue = 0;
  (function startFpsMeter() {
    var frames = 0, last = (window.performance && performance.now) ? performance.now() : Date.now(), first = true;
    function tick(now) {
      frames++;
      var t = now || Date.now();
      var win = first ? 500 : 1000;   // 首次 500ms 快速出值，之后每秒更新
      if (t - last >= win) { fpsValue = Math.round(frames * 1000 / (t - last)); frames = 0; last = t; first = false; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();
  // 原生信息缓存 1.2 秒（避免每个代码都反序列化一次 JSON）
  var devCache = null, devCacheAt = 0;
  function readDeviceInfo() {
    var now = Date.now();
    if (devCache && now - devCacheAt < 1200) return devCache;
    var info = null;
    try {
      if (window.Native && Native.deviceInfo) info = JSON.parse(Native.deviceInfo() || '{}');
    } catch (e) { info = null; }
    if (!info) {
      // 浏览器/无原生环境兜底，保证试运行/PC 预览不报错
      info = {
        cpuCores: navigator.hardwareConcurrency || -1, cpuUsage: -1, gpuUsage: -1,
        memUsage: -1, memAvailGB: -1, memTotalGB: navigator.deviceMemory || -1,
        battery: -1, batteryTemp: -1, deviceTemp: -1, charging: false,
        netType: navigator.onLine ? '网络' : '无网络', online: !!navigator.onLine,
        refreshRate: 60, brightness: -1,
        screenWidth: window.screen.width, screenHeight: window.screen.height,
        density: window.devicePixelRatio || 1,
        model: '', manufacturer: '', androidVersion: '', sdkInt: -1,
        language: (navigator.language || '').slice(0, 2)
      };
    }
    devCache = info; devCacheAt = now;
    return info;
  }

  /* 参考设计画布尺寸；优先用编辑器在真机捕获的 project.design（与本机可用区同宽高比），
     等比缩放后恰好铺满，上下左右严格对齐，不再出现“布局碰底、运行留缝”。 */
  var DESIGN = { portrait: { w: 390, h: 827 }, landscape: { w: 827, h: 390 } };
  function designSize() {
    var o = (current && current.orientation) || (project && project.orientation) || 'portrait';
    var base = (o === 'landscape') ? DESIGN.landscape : DESIGN.portrait;
    var p = project && project.design;
    if (p && p.orientation === o &&
        typeof p.w === 'number' && isFinite(p.w) && typeof p.h === 'number' && isFinite(p.h) &&
        p.w >= 240 && p.h >= 240) {
      return { w: Math.round(p.w), h: Math.round(p.h) };
    }
    return base;
  }
  /**
   * 设计画布整体等比缩放（contain）后居中显示。
   *
   * 这里曾经写成"screen 直接铺满窗口、不缩放、坐标用真实像素"，**这是个致命错误**：
   * 组件的 x/y/w/h 都是**设计像素**（比如 390×827 的画布），而窗口是设备真实像素
   * （不同机型 393×851、412×915…还有状态栏差），两者不相等 —— 于是"编辑器布局页摆好的位置、
   * 导出后完全走样"（用户真机反馈：位置大小都不对、按钮跑出屏幕）。
   * 必须和编辑器布局页（editor.js 的 fitStage）用同一套规矩：
   *   canvas = 设计画布尺寸，再按 min(vw/dw, vh/dh) 等比缩放居中。
   * #viewport 是 flex 居中 且 #screen 的 transform-origin 是 center，所以缩放后自然居中。
   */
  function fitScreen() {
    var sc = $('#screen'); if (!sc || !project) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var d = designSize();
    var k = Math.min(vw / d.w, vh / d.h);
    if (!(k > 0) || !isFinite(k)) k = 1;
    sc.style.width = d.w + 'px';
    sc.style.height = d.h + 'px';
    sc.dataset.scale = String(k);
    sc.style.transformOrigin = 'center center';
    sc.style.transform = 'scale(' + k + ')';
  }
  window.addEventListener('resize', fitScreen);
  window.addEventListener('orientationchange', function () { setTimeout(fitScreen, 60); setTimeout(fitScreen, 260); });

  function loadProject() {
    var raw = null;
    try {
      var pv = localStorage.getItem('__previewProject');
      if (pv) { raw = pv; isPreview = true; }
      else if (mode() === 'shell' && window.Native) { raw = Native.getProject(); }
    } catch (e) { raw = null; }
    if (!raw) { $('#screen').innerHTML = '<div class="text">项目数据缺失，无法运行。</div>'; return; }
    try { project = JSON.parse(raw); } catch (e) {
      $('#screen').innerHTML = '<div class="text">项目数据损坏：' + e.message + '</div>'; return;
    }
    // 运行时横竖屏为页面级：直接按起始页方向锁定，避免先竖屏再转横屏的闪烁
    var startId = project.startScreen || (project.screens[0] && project.screens[0].id);
    var previewStart = null;
    try { previewStart = localStorage.getItem('__previewStartScreen'); } catch (e) { previewStart = null; }
    if (isPreview && previewStart && screenById(previewStart)) startId = previewStart;
    try { localStorage.removeItem('__previewStartScreen'); } catch (e) {}
    var startSc = screenById(startId);
    /* 起始方向只有一处口径：起始页方向 → 回退项目方向。
       以前这里写的是 `startSc.orientation || 'portrait'`，而下面的方向门看的是 project.orientation ——
       两者不一致时，运行时会先把屏幕转回竖屏、再等方向门等到超时才画，表现就是
       「选了横屏，点运行不显示/要等好几秒」（用户 2026-10-28 报的）。 */
    var startOrient = (startSc && startSc.orientation) || (project && project.orientation) || 'portrait';
    if (window.Native && Native.setOrientation) Native.setOrientation(startOrient);
    if (window.Native && Native.setStatusBar) Native.setStatusBar(!startSc || startSc.showStatusBar !== false);
    fitScreen();
    setTimeout(fitScreen, 120); setTimeout(fitScreen, 400);   // 物理旋转是异步的，旋转后再校准
    // 预览（编辑器里的试运行）不再有页面内的结束按钮：结束方式改成**系统通知栏里的卡片**，
    // 卡片右侧的「终止运行」由原生侧回调 window.__nativeStopRun()（用户要求）。
    if (isPreview || mode() === 'editor') {
      window.__runNoticeName = String((project && project.appName) || '作品');   // 排错/测试可见：通知卡片上的作品名
      try { if (window.Native && Native.startRunNotice) Native.startRunNotice(window.__runNoticeName); } catch (e) {}
    }
    aiOrientGate(startOrient, function () { navigate(startId, true); });
  }

  /**
   * 方向门：**第一次渲染**要等屏幕方向转到项目要求的方向再画。
   *
   * 原来的毛病：点「运行」后页面立刻按当时的窗口方向渲染一帧，原生旋转随后才生效，
   * 于是横屏项目会先按竖屏排一次版、再"啪"地转到横屏（用户："致命问题，先竖屏再横屏"）。
   * 现在方向不对就先不画（#screen 空着，底色与画布同色，看不出跳变），
   * 方向一到就画；万一设备/模拟器一直转不过去，1.2 秒后兜底照画（不能让页面卡住）。
   *
   * 电脑/浏览器里没有 setOrientation，屏幕根本不会转 —— 那种情况下干等是没有意义的，
   * 直接画（以前横屏工程在网页预览里必卡满 2 秒）。
   */
  var aiFirstPaintDone = false;
  function aiOrientGate(want, fn) {
    if (aiFirstPaintDone) { fn(); return; }
    want = want || (project && project.orientation) || 'portrait';
    var 能转向 = false;
    try { 能转向 = !!(window.Native && Native.setOrientation); } catch (e) {}
    if (!能转向) { aiFirstPaintDone = true; fn(); return; }
    var deadline = Date.now() + 1200;
    var finished = false;
    function ok() {
      var land = window.innerWidth > window.innerHeight;
      return want === 'landscape' ? land : !land;
    }
    function tryPaint() {
      if (finished) return;
      if (ok() || Date.now() > deadline) {
        finished = true;
        aiFirstPaintDone = true;
        window.removeEventListener('resize', tryPaint);
        window.removeEventListener('orientationchange', tryPaint);
        fn();
      }
    }
    window.addEventListener('resize', tryPaint);
    window.addEventListener('orientationchange', tryPaint);
    setTimeout(tryPaint, 60);
    setTimeout(tryPaint, 400);
    setTimeout(tryPaint, 1200);      // 兜底：一直转不过去也得把画面画出来（与 deadline 一致）
  }

  /* 滑屏检测（用户要求）：在画布区域上按下→抬起，位移超过阈值就判定为一次滑动，
     方向按"位移大的那个轴"算；滑完把方向/距离记进 lastSwipe 并触发「当页面被…滑动」的代码。
     注意不 preventDefault：普通点击、列表滚动、输入框都照旧。 */
  (function 绑滑屏() {
    var host = document.getElementById('screen');
    if (!host || host.__swipeWired) return;
    host.__swipeWired = true;
    var sx = 0, sy = 0, st = 0, tracking = false;
    function down(x, y) { tracking = true; sx = x; sy = y; st = Date.now(); }
    function up(x, y) {
      if (!tracking) return;
      tracking = false;
      var dx = x - sx, dy = y - sy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 30) return;                                  // 手指抖一下不算滑动
      var dir = (Math.abs(dx) >= Math.abs(dy)) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      lastSwipe = { dir: dir, dx: Math.round(dx), dy: Math.round(dy), dist: Math.round(dist), ms: Date.now() - st };
      var 要跑 = [];
      swipeHandlers.forEach(function (h) { if (h && (!h.dir || h.dir === dir)) 要跑.push(h.fn); });
      if (要跑.length) runHandlers(要跑);
    }
    host.addEventListener('touchstart', function (e) { var t = e.touches && e.touches[0]; if (t) down(t.clientX, t.clientY); }, { passive: true });
    host.addEventListener('touchend', function (e) { var t = e.changedTouches && e.changedTouches[0]; if (t) up(t.clientX, t.clientY); }, { passive: true });
    // PC / 预览窗口里也能验证：鼠标按住拖一下
    host.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse') down(e.clientX, e.clientY); });
    host.addEventListener('pointerup', function (e) { if (e.pointerType === 'mouse') up(e.clientX, e.clientY); });
  })();

  function screenById(id) {
    for (var i = 0; i < project.screens.length; i++) if (project.screens[i].id === id) return project.screens[i];
    return null;
  }
  function resolveScreen(name) {
    if (!name) return null;
    var s = screenById(name); if (s) return s;
    for (var i = 0; i < project.screens.length; i++) {
      var x = project.screens[i]; if (x.name === name || x.title === name) return x;
    }
    return null;
  }
  function navigate(id, isStart) {
    var sc = screenById(id); if (!sc) return;
    if (!isStart) {
      // 跳到当前正在显示的页面：无操作，避免“页面启动时又跳自己”这类自循环
      if (current && current.id === sc.id) return;
    }
    if (isStart) stack = [id];
    else if (navKind === 'auto') {
      // 启动事件（含等待后的延续）引发的自动跳转：替换栈顶。
      // 启动链 A→B→C 结束后，返回栈里只有 [来源页, C]，按一次返回就回来源页，
      // 不会落到中转页 B 又被它的“页面启动时”弹回 C。
      if (stack.length) stack[stack.length - 1] = id;
      else stack.push(id);
    } else {
      stack.push(id);
      if (stack.length > 48) stack.splice(1, stack.length - 48);   // 安全上限，防止异常流程无限压栈
    }
    render(sc);
  }
  function goBack() {
    userGesture();   // 返回属于用户操作：按用户导航处理，并重置循环保护
    if (stack.length > 1) { stack.pop(); render(screenById(stack[stack.length - 1])); return true; }
    return false;
  }

  /* ---------------- 渲染 ---------------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (text != null) e.textContent = text; return e;
  }

  function render(sc) {
    current = sc; clickMap = {}; itemClickMap = {}; changeMap = {};
    startHandlers = []; firstStartHandlers = [];
    swipeHandlers = []; lastSwipe = { dir: '', dx: 0, dy: 0, dist: 0, ms: 0 };
    renderGen++;
    // 按当前页面的设置锁定屏幕方向与通知栏（页面级，不再全局）
    if (window.Native && Native.setOrientation) Native.setOrientation(sc.orientation || 'portrait');
    if (window.Native && Native.setStatusBar) Native.setStatusBar(sc.showStatusBar !== false);
    fitScreen();
    var root = $('#screen'); root.innerHTML = '';
    // #flow 承载自动排列组件（padding/gap 与编辑器拖动布局的测量层完全一致）；
    // 绝对定位组件直接挂到 #screen，坐标原点是画布边框(0,0)，与编辑器舞台一一对应，
    // 不再因 #screen 的 16px padding 产生“布局放好的位置运行时偏移”。
    var flow = el('div'); flow.id = 'flow'; root.appendChild(flow);
    var comps = sc.components || [];
    // 自动排列（流式）组件：保持数组顺序，index 0 在流程最上方
    comps.forEach(function (c) {
      if (!(validNum(c.x) || validNum(c.y))) flow.appendChild(renderComp(c));
    });
    // 绝对定位组件：倒序渲染，使设计页列表最上方（index 0）对应运行时最顶层
    comps.slice().reverse().forEach(function (c) {
      if (validNum(c.x) || validNum(c.y)) root.appendChild(renderComp(c));
    });
    runCode(sc);
    root.scrollTop = 0;
  }

  // 只有“有限数字”才算有效参数；null/undefined/''/NaN 一律按“未设置”，绝不拖垮整个组件
  function validNum(v) { return typeof v === 'number' && isFinite(v); }
  function px(v) { return validNum(v) ? (v + 'px') : null; }

  /* 绝对定位且未填宽高时的默认尺寸：与编辑器取同一份 comp-spec.js，保证所见即所得 */
  function defaultBox(c) {
    return FAST_COMP.sizeOf(c.type);
  }

  /* 把编辑器里设置的位置/大小落到节点上：每个参数独立生效，留空的轴自动处理 */
  function applyLayout(wrap, c) {
    var hasX = validNum(c.x), hasY = validNum(c.y),
        hasW = validNum(c.w), hasH = validNum(c.h);
    if (hasX || hasY) {                 // 只填 X 或只填 Y 也生效，缺省轴按 0（画布边缘），与编辑器一致
      wrap.classList.add('absolute');
      wrap.style.position = 'absolute';
      var db0 = defaultBox(c);
      var w0 = hasW ? c.w : db0.w;
      // 居中锁（c.cx）：x 永远 = (画布宽 - 宽)/2；在容器里就是"按容器宽居中"
      var scr = document.getElementById('screen');
      var sw = (渲染父宽 != null) ? 渲染父宽 : (scr ? scr.clientWidth : 0);
      var left = (c.cx && sw > 0) ? Math.max(0, Math.round((sw - w0) / 2)) : (hasX ? c.x : 0);
      wrap.style.left = px(left);
      wrap.style.top = hasY ? px(c.y) : '0px';
      var db = defaultBox(c);           // 绝对定位时缺省宽高用统一默认值，与编辑器一致
      wrap.style.width = px(hasW ? c.w : db.w);
      wrap.style.height = px(hasH ? c.h : db.h);
    } else {                            // 自动排列：宽度默认占满，仅在用户填写时覆盖
      if (hasW) wrap.style.width = px(c.w);
      if (hasH) wrap.style.height = px(c.h);
    }
  }
  // 把 #RRGGBB 调亮(amt>0)/调暗(amt<0)，amt 为 -1~1；非法输入回退到紫色系
  function shadeHex(hex, amt) {
    var s = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];  // 支持 #abc 简写
    if (!/^[0-9a-f]{6}$/i.test(s)) s = '6750a4';                                   // 非法回退主色
    var n = parseInt(s, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function mix(c) {
      c = amt >= 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt));
      return Math.max(0, Math.min(255, c));
    }
    function h(c) { var v = mix(c).toString(16); return v.length < 2 ? '0' + v : v; }
    return '#' + h(r) + h(g) + h(b);
  }
  // 移除元素上所有以 prefix 开头的类（如 btn- / skin- / art-），用于运行时切换个性化风格
  function stripPrefixed(node, prefix) {
    if (!node || !node.classList) return;
    var rm = [];
    node.classList.forEach(function (c) { if (c.indexOf(prefix) === 0) rm.push(c); });
    rm.forEach(function (c) { node.classList.remove(c); });
  }
  function applyTextStyle(node, c, defaultSize) {
    if (validNum(c.fs)) node.style.fontSize = px(c.fs);
    else if (defaultSize) node.style.fontSize = defaultSize;
    if (c.color) node.style.color = c.color;
    if (c.bold) node.style.fontWeight = '700';
    if (c.italic) node.style.fontStyle = 'italic';
    if (c.underline) node.style.textDecoration = 'underline';
    if (validNum(c.spacing)) node.style.letterSpacing = px(c.spacing);
    if (c.align) node.style.textAlign = c.align;
    if (c.artStyle) {
      node.classList.add('art-' + c.artStyle);
      // 霓虹发光依赖文字颜色，默认黑字发黑光看不清，未设颜色时给青色
      if (c.artStyle === 'neon' && !c.color) node.style.color = '#00bcd4';
    }
  }
  // 按钮风格（磨砂玻璃/描边/幽灵/渐变/胶囊/阴影）
  function applyBtnStyle(btn, c) {
    var st = c.btnStyle;
    if (!st) return;
    btn.classList.add('btn-' + st);
    // 描边/幽灵按钮是透明底，默认白字在浅色背景上不可见；未显式设文字色时用主色
    if ((st === 'outline' || st === 'ghost') && !c.color) btn.style.color = '#6750a4';
    if (st === 'gradient') {
      var base = c.bg || '#6750a4';
      btn.style.setProperty('--g1', shadeHex(base, 0.14));
      btn.style.setProperty('--g2', shadeHex(base, -0.24));
    }
  }
  // 容器外观（磨砂玻璃/描边/阴影），作用到输入框/列表/图片占位等主元素
  function applySkin(node, c) {
    if (!c.skin) return;
    node.classList.add('skin-' + c.skin);
  }

  /* 表格：表头 + 数据行（字号/颜色取控件属性，和布局页一致） */
  function 画表格(wrap, c) {
    var tb = document.createElement('table');
    tb.className = 'rt-table';
    var th = document.createElement('tr');
    (c.columns || ['列1', '列2']).forEach(function (cn) {
      var h = document.createElement('th');
      h.textContent = (cn == null ? ' ' : String(cn));
      th.appendChild(h);
    });
    tb.appendChild(th);
    (c.rows || []).forEach(function (row) {
      var tr = document.createElement('tr');
      (row || []).forEach(function (cell) {
        var td = document.createElement('td');
        td.textContent = cell == null ? '' : String(cell);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    if (validNum(c.fs)) tb.style.fontSize = px(c.fs);
    if (c.color) tb.style.color = c.color;
    wrap.innerHTML = '';
    wrap.appendChild(tb);
  }
  /* 图表：柱状 / 折线 / 饼图，纯 DOM+CSS 画（不用 canvas，缩放也不糊） */
  function 画图表(wrap, c) {
    var 数据 = c.chartData || [];
    var 型 = c.chartType || 'bar';
    if (型 === 'pie') {
      var 总 = 数据.reduce(function (n, p) { return n + Math.max(0, Number(p.value) || 0); }, 0) || 1;
      var 起 = 0, 段 = [];
      var 色 = ['#6750A4', '#7D5260', '#00695C', '#EF6C00', '#1565C0', '#AD1457', '#2E7D32', '#5D4037'];
      数据.slice(0, 8).forEach(function (p, i) {
        var 占比 = Math.max(0, Number(p.value) || 0) / 总 * 100;
        段.push(色[i % 色.length] + ' ' + 起.toFixed(2) + '% ' + (起 + 占比).toFixed(2) + '%');
        起 += 占比;
      });
      var pie = document.createElement('div');
      pie.className = 'rt-pie';
      pie.style.background = 'conic-gradient(' + (段.join(',') || '#e0e0e0 0 100%') + ')';
      wrap.appendChild(pie);
      var 图例 = document.createElement('div');
      图例.className = 'rt-chart-legend';
      数据.slice(0, 8).forEach(function (p, i) {
        var it = document.createElement('span'); it.className = 'rt-chart-lgi';
        var dot = document.createElement('i'); dot.className = 'rt-chart-dot';
        dot.style.background = 色[i % 色.length];
        it.appendChild(dot);
        it.appendChild(document.createTextNode((p.label || '') + ' ' + (p.value == null ? '' : p.value)));
        图例.appendChild(it);
      });
      wrap.innerHTML = '';
      wrap.appendChild(pie);
      wrap.appendChild(图例);
      return;
    }
    var 值 = 数据.map(function (p) { return Math.max(0, Number(p.value) || 0); });
    var 最大 = Math.max.apply(null, 值.concat([1]));
    var 盒 = document.createElement('div');
    盒.className = 'rt-chart ' + (型 === 'line' ? 'is-line' : 'is-bar');
    if (型 === 'line') {
      // 折线：每个点按比例定位，用 CSS 画点 + 用一条斜线连起来（简单、清楚、不依赖 canvas）
      var 点 = 数据.slice(0, 12);
      点.forEach(function (p, i) {
        var x = 点.length > 1 ? (i / (点.length - 1) * 100) : 50;
        var y = 100 - (Number(p.value) || 0) / 最大 * 100;
        var d = document.createElement('i');
        d.className = 'rt-line-dot';
        d.style.left = x.toFixed(2) + '%';
        d.style.bottom = y.toFixed(2) + '%';
        if (c.color) d.style.background = c.color;
        盒.appendChild(d);
        if (i > 0) {
          var a = 点[i - 1];
          var x0 = (i - 1) / (点.length - 1) * 100, y0 = 100 - (Number(a.value) || 0) / 最大 * 100;
          var ln = document.createElement('i');
          ln.className = 'rt-line-seg';
          var dx = x - x0, dy = y0 - y;
          ln.style.left = x0 + '%';
          ln.style.bottom = y0 + '%';
          ln.style.width = Math.sqrt(dx * dx + dy * dy) + '%';
          ln.style.transform = 'rotate(' + (-Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + 'deg)';
          if (c.color) ln.style.background = c.color;
          盒.appendChild(ln);
        }
      });
    } else {
      数据.slice(0, 12).forEach(function (p) {
        var col = document.createElement('div'); col.className = 'rt-bar-col';
        var bar = document.createElement('i'); bar.className = 'rt-bar';
        bar.style.height = Math.max(3, Math.round((Number(p.value) || 0) / 最大 * 100)) + '%';
        if (c.color) bar.style.background = c.color;
        col.appendChild(bar);
        col.appendChild(Object.assign(document.createElement('span'), { className: 'rt-bar-lb', textContent: p.label || '' }));
        盒.appendChild(col);
      });
    }
    wrap.innerHTML = '';
    wrap.appendChild(盒);
  }

  function renderComp(c) {    var wrap = el('div', 'comp ' + c.type);
    wrap.setAttribute('data-id', c.id);
    wrap.__c = c;                 // 运行时改位置/大小/选项时，同步写回组件数据
    applyLayout(wrap, c);
    var abs = wrap.classList.contains('absolute');
    // 初始可见性 / 透明度
    if (c.visible === false) wrap.style.display = 'none';
    // 旋转：所有控件通用（属性面板可调，运行时的"旋转"代码也能改）
    if (validNum(c.rot) && Number(c.rot) !== 0) {
      wrap.style.transform = 'rotate(' + Number(c.rot) + 'deg)';
      wrap.style.transformOrigin = 'center center';
    }
    if (validNum(c.opacity)) wrap.style.opacity = (Math.max(0, Math.min(100, c.opacity)) / 100).toFixed(3);

    // 容器 / 滚动区：自己是一块底板，子控件用**相对坐标**画在里面（和布局页/设计页同一套坐标）
    if (c.type === 'container' || c.type === 'scroll') {
      wrap.style.position = 'relative';
      wrap.style.overflow = c.type === 'scroll' ? 'auto' : 'hidden';   // 滚动区：内容超高时上下滑
      if (c.type === 'scroll') wrap.classList.add('rt-scroll');
      if (c.bg) wrap.style.background = c.bg;
      if (validNum(c.radius)) wrap.style.borderRadius = px(c.radius);
      if (!validNum(c.w)) wrap.style.width = '100%';
      var 子 = c.children || [];
      子.forEach(function (k) {
        var 旧 = 渲染父宽;
        渲染父宽 = validNum(c.w) ? c.w : wrap.clientWidth || 300;
        try { wrap.appendChild(renderComp(k)); } finally { 渲染父宽 = 旧; }
      });
      wrap.classList.add('clickable');
      wrap.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.comp') && e.target.closest('.comp') !== wrap) return;
        runHandlers(clickMap[c.id]);
      });
      return wrap;
    }

    // 表格 / 图表：设计页、布局页、运行时三处长得一样（同一套 DOM 结构）
    if (c.type === 'table') {
      画表格(wrap, c);
      wrap.classList.add('clickable');
      wrap.addEventListener('click', function () { runHandlers(clickMap[c.id]); });
      return wrap;
    }
    if (c.type === 'chart') {
      画图表(wrap, c);
      wrap.setAttribute('data-chart', c.chartType || 'bar');   // 代码改数据时要知道画哪种
      wrap.classList.add('clickable');
      wrap.addEventListener('click', function () { runHandlers(clickMap[c.id]); });
      return wrap;
    }

    if (c.type === 'text') {
      var t = el('span', 'v-text', c.value != null ? c.value : (c.text || ''));
      applyTextStyle(t, c);
      if (c.align) wrap.style.textAlign = c.align; // span 是内联，对齐要设在块级父元素
      wrap.appendChild(t);
      wrap.classList.add('clickable');
      wrap.addEventListener('click', function () { runHandlers(clickMap[c.id]); });
    } else if (c.type === 'button') {
      var b = el('button', 'matbtn');
      if (c.icon) { var ic = el('span', 'bicon', c.icon); b.appendChild(ic); }
      b.appendChild(el('span', 'v-text', c.text || '按钮'));
      applyTextStyle(b, c);
      if (c.bg) b.style.background = c.bg;
      if (validNum(c.radius)) b.style.borderRadius = px(c.radius);
      applyBtnStyle(b, c);
      b.style.height = validNum(c.h) ? px(c.h) : (abs ? '100%' : '');  // 绝对定位时填满统一默认高度
      if (c.align) b.style.justifyContent = c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'flex-start');
      b.addEventListener('click', function () { runHandlers(clickMap[c.id]); });
      wrap.appendChild(b);
    } else if (c.type === 'input') {
      var inp = el('input');
      inp.type = c.inputType || 'text';   // 可切密码/数字/电话/邮箱
      inp.placeholder = c.hint || '请输入';
      if (c.value) inp.value = c.value;
      if (validNum(c.fs)) inp.style.fontSize = px(c.fs);
      if (c.color) inp.style.color = c.color;                 // 修复：输入框文字颜色此前不生效
      if (c.bold) inp.style.fontWeight = '700';              // 修复：输入框加粗此前不生效
      if (c.italic) inp.style.fontStyle = 'italic';
      if (c.underline) inp.style.textDecoration = 'underline';
      if (validNum(c.spacing)) inp.style.letterSpacing = px(c.spacing);
      if (c.bg) inp.style.background = c.bg;
      if (validNum(c.radius)) inp.style.borderRadius = px(c.radius);
      applySkin(inp, c);
      inp.style.height = validNum(c.h) ? px(c.h) : (abs ? '100%' : '');
      if (c.align) inp.style.textAlign = c.align;
      wrap.appendChild(inp);
    } else if (c.type === 'list') {
      var box = el('div', 'list');
      if (c.bg) box.style.background = c.bg;
      if (c.color) box.style.color = c.color;                // 修复：列表文字颜色此前不生效
      if (c.bold) box.style.fontWeight = '700';
      if (c.italic) box.style.fontStyle = 'italic';
      if (validNum(c.spacing)) box.style.letterSpacing = px(c.spacing);
      if (validNum(c.radius)) box.style.borderRadius = px(c.radius);
      applySkin(box, c);
      if (abs) box.style.height = '100%';                    // 绝对定位填满统一默认高度
      if (validNum(c.h)) box.style.height = px(c.h);
      var ul = el('div', 'ul');
      if (validNum(c.fs)) ul.style.fontSize = px(c.fs);
      if (!abs) ul.style.maxHeight = '60vh'; else ul.style.maxHeight = '100%';
      box.appendChild(ul);
      var items = c.items || [];
      if (!items.length) ul.appendChild(el('div', 'empty', '（空列表）'));
      items.forEach(function (txt, i) { ul.appendChild(makeLi(c.id, txt, i, c)); });
      wrap.appendChild(box);
    } else if (c.type === 'image') {
      if (c.src) {
        var img = el('img'); img.src = c.src;
        img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
        if (validNum(c.radius)) img.style.borderRadius = px(c.radius);
        wrap.appendChild(img);
      } else {
        var ph = el('div', 'imgph', c.alt || '图片');
        if (validNum(c.radius)) ph.style.borderRadius = px(c.radius);
        applySkin(ph, c);
        wrap.appendChild(ph);
      }
      wrap.classList.add('clickable');
      wrap.addEventListener('click', function () { runHandlers(clickMap[c.id]); });
    } else if (c.type === 'select') {
      /* 下拉选择框：自绘列表（不再用原生 <select>）。
         原生控件在手机上弹的是系统选择器（白底 + 圆圈单选），样式改不了 ——
         所以改成自绘：展开的选项列表也能跟着样式走，默认 M3。 */
      var box = el('div', 'rt-select' + (c.variant ? (' rt-select--' + c.variant) : ''));
      var valEl = el('span', 'rt-select-v');
      var caret = el('span', 'rt-select-a', '▾');
      box.appendChild(valEl); box.appendChild(caret);
      if (validNum(c.fs)) box.style.fontSize = px(c.fs);
      if (c.color) box.style.color = c.color;
      if (c.bg) box.style.background = c.bg;
      if (validNum(c.radius)) box.style.borderRadius = px(c.radius);
      if (validNum(c.h)) box.style.height = px(c.h);
      if (c.caretColor) caret.style.color = c.caretColor;
      applySkin(box, c);
      wrap.__val = c.value != null ? c.value : ((c.items || [])[0] || '');
      var menu = el('div', 'rt-select-menu' + (c.variant ? (' rt-select-menu--' + c.variant) : ''));
      var drawOpts = function () {
        menu.innerHTML = '';
        var 列表 = (c.items || []).slice();
        if (wrap.__val !== '' && wrap.__val != null && 列表.indexOf(wrap.__val) < 0) 列表.push(wrap.__val);
        列表.forEach(function (it) {
          var on = (it === wrap.__val);
          var row = el('div', 'rt-select-item' + (on ? ' on' : ''));
          row.appendChild(el('span', 'rt-select-item-t', String(it)));
          row.appendChild(el('span', 'rt-select-item-c', on ? '✓' : ''));
          row.addEventListener('click', function (e) {
            e.stopPropagation();
            wrap.__val = it; valEl.textContent = String(it);
            drawOpts(); closeMenu();
            runHandlers(changeMap[c.id]);
          });
          menu.appendChild(row);
        });
        if (c.color) menu.style.color = c.color;
      };
      var closeMenu = function () { menu.classList.remove('open'); menu.classList.remove('up'); box.classList.remove('open'); };
      var openMenu = function () {
        drawOpts();
        // 关掉页面上其它还开着的下拉
        var root = wrap.parentNode;
        if (root) {
          var om = root.querySelectorAll('.rt-select-menu.open');
          for (var oi = 0; oi < om.length; oi++) om[oi].classList.remove('open');
          var ob = root.querySelectorAll('.rt-select.open');
          for (var bi = 0; bi < ob.length; bi++) ob[bi].classList.remove('open');
        }
        menu.classList.remove('up');
        menu.classList.add('open'); box.classList.add('open');
        // 下面放不下就往上弹（顶部控件不会被挤出屏幕）
        var r = box.getBoundingClientRect();
        var vh = window.innerHeight || 800;
        if (r.bottom + menu.offsetHeight + 8 > vh && r.top > menu.offsetHeight + 8) menu.classList.add('up');
        document.removeEventListener('click', closeMenu);
        setTimeout(function () { document.addEventListener('click', closeMenu, { once: true }); }, 0);
      };
      valEl.textContent = String(wrap.__val);
      box.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu.classList.contains('open')) closeMenu(); else openMenu();
      });
      wrap.appendChild(box); wrap.appendChild(menu);
    } else if (c.type === 'radio') {
      // 单选组：一组里只能选一个
      var rbox = el('div', 'rt-radio');
      wrap.__val = c.value != null ? c.value : ((c.items || [])[0] || '');
      (c.items || []).forEach(function (it) {
        var row = el('label', 'rt-radio-row');
        var dot = el('i', 'rt-radio-dot' + (it === wrap.__val ? ' on' : ''));
        row.appendChild(dot);
        var tx = el('span', 'v-text', it); applyTextStyle(tx, c); row.appendChild(tx);
        row.addEventListener('click', function () {
          wrap.__val = it;
          Array.prototype.forEach.call(rbox.querySelectorAll('.rt-radio-dot'), function (n) { n.classList.remove('on'); });
          dot.classList.add('on');
          runHandlers(changeMap[c.id]);
        });
        rbox.appendChild(row);
      });
      wrap.appendChild(rbox);
    } else if (c.type === 'date' || c.type === 'time') {
      var din = el('input', 'rt-date'); din.type = c.type === 'date' ? 'date' : 'time';
      if (c.value) din.value = c.value;
      if (validNum(c.h)) din.style.height = px(c.h);
      if (validNum(c.fs)) din.style.fontSize = px(c.fs);
      if (c.bg) din.style.background = c.bg;
      if (validNum(c.radius)) din.style.borderRadius = px(c.radius);
      applySkin(din, c);
      wrap.__val = c.value || '';
      din.addEventListener('change', function () { wrap.__val = din.value; runHandlers(changeMap[c.id]); });
      wrap.appendChild(din);
    } else if (c.type === 'stepper') {
      var strow = el('div', 'ctl-row rt-step-row');
      var stlab = el('span', 'v-text', c.text || '数量'); applyTextStyle(stlab, c);
      var stbox = el('div', 'rt-step');
      var minus = el('button', 'rt-step-b', '−'); minus.type = 'button';
      var plus = el('button', 'rt-step-b', '+'); plus.type = 'button';
      var stval = el('span', 'rt-step-v', '');
      var mn = validNum(c.min) ? c.min : 0, mx = validNum(c.max) ? c.max : 99;
      wrap.__val = validNum(c.value) ? c.value : mn;
      function drawStep() {
        var n = Math.max(mn, Math.min(mx, wrap.__val));
        wrap.__val = n; stval.textContent = String(n);
        minus.disabled = n <= mn; plus.disabled = n >= mx;
      }
      minus.addEventListener('click', function (e) { e.stopPropagation(); wrap.__val--; drawStep(); runHandlers(changeMap[c.id]); });
      plus.addEventListener('click', function (e) { e.stopPropagation(); wrap.__val++; drawStep(); runHandlers(changeMap[c.id]); });
      stbox.appendChild(minus); stbox.appendChild(stval); stbox.appendChild(plus);
      strow.appendChild(stlab); strow.appendChild(stbox);
      if (c.align) strow.style.justifyContent = c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'space-between');
      drawStep();
      wrap.appendChild(strow);
    } else if (c.type === 'imgbtn') {
      var ib = el('button', 'rt-imgbtn'); ib.type = 'button';
      if (c.src) { var ibi = el('img'); ibi.src = c.src; ibi.style.width = '100%'; ibi.style.height = '100%'; ibi.style.objectFit = 'contain'; ib.appendChild(ibi); }
      else { ib.appendChild(el('span', 'rt-imgbtn-ph', '🖼')); }
      if (c.text) ib.appendChild(el('span', 'rt-imgbtn-tx', c.text));
      if (c.bg) ib.style.background = c.bg;
      if (validNum(c.radius)) ib.style.borderRadius = px(c.radius);
      ib.style.width = '100%'; ib.style.height = '100%';
      applyBtnStyle(ib, c);
      ib.addEventListener('click', function () { runHandlers(clickMap[c.id]); });
      wrap.appendChild(ib);
      wrap.classList.add('clickable');
    } else if (c.type === 'timer') {
      var tbox = el('div', 'rt-timer', c.text || '00:00');
      applyTextStyle(tbox, c);
      if (c.align) tbox.style.justifyContent = c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'flex-start');
      wrap.__val = 0;
      timers[c.id] = { el: tbox, left: 0, timer: 0 };
      wrap.appendChild(tbox);
    } else if (c.type === 'canvas') {
      var cv = el('canvas', 'rt-canvas');
      var cw = validNum(c.w) ? c.w : 300, ch = validNum(c.h) ? c.h : 200;
      cv.width = cw; cv.height = ch;
      cv.style.width = '100%'; cv.style.height = '100%';
      if (c.bg) cv.style.background = c.bg;
      if (validNum(c.radius)) cv.style.borderRadius = px(c.radius);
      canvasMap[c.id] = cv.getContext('2d');
      wrap.appendChild(cv);
    } else if (c.type === 'card') {
      var cardBox = el('div', 'rt-card');
      if (c.bg) cardBox.style.background = c.bg;
      if (validNum(c.radius)) cardBox.style.borderRadius = px(c.radius);
      if (validNum(c.h)) cardBox.style.height = px(c.h);
      applySkin(cardBox, c);
      if (c.text) { var ct = el('div', 'rt-card-t', c.text); applyTextStyle(ct, c); cardBox.appendChild(ct); }
      wrap.appendChild(cardBox);
    } else if (c.type === 'divider') {
      var dv = el('div', 'rt-divider');
      if (c.bg) dv.style.background = c.bg;
      dv.style.height = px(validNum(c.h) ? Math.max(1, c.h) : 2);
      wrap.appendChild(dv);
    } else if (c.type === 'spacer') {
      var sp = el('div', 'rt-spacer');
      if (validNum(c.h)) sp.style.height = px(c.h);
      wrap.appendChild(sp);
    } else if (c.type === 'tabs') {
      // 标签页：一排页签，点哪个就把 __val 记成那个序号（0 开始），并触发「值变了」
      var 页签们 = (c.items && c.items.length) ? c.items : ['页签一', '页签二'];
      var 页签条 = el('div', 'rt-tabs');
      var 页签钮 = [];
      wrap.__val = Math.max(0, Math.min(页签们.length - 1, Number(c.value) || 0));
      function 画页签() {
        页签钮.forEach(function (b, i) { b.classList.toggle('on', i === wrap.__val); });
      }
      页签们.forEach(function (it, i) {
        var b = el('button', 'rt-tab', String(it == null ? '' : it));
        b.type = 'button';
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (wrap.__val === i) return;
          wrap.__val = i; 画页签();
          runHandlers(changeMap[c.id]);
        });
        页签钮.push(b); 页签条.appendChild(b);
      });
      if (validNum(c.fs)) 页签条.style.fontSize = px(c.fs);
      if (c.color) 页签条.style.color = c.color;
      if (c.bg) 页签条.style.background = c.bg;
      if (validNum(c.radius)) 页签条.style.borderRadius = px(c.radius);
      画页签();
      wrap.appendChild(页签条);
    } else if (c.type === 'bottomNav') {
      // 底部导航：一排按钮，点哪个把 __val 记成那个序号（0 开始），并触发「值变了」
      var 导航们 = (c.items && c.items.length) ? c.items : ['首页', '消息', '我的'];
      var 导航框 = el('div', 'rt-navbar');
      var 导航钮 = [];
      wrap.__val = Math.max(0, Math.min(导航们.length - 1, Number(c.value) || 0));
      function 画导航() {
        导航钮.forEach(function (b, i) { b.classList.toggle('on', i === wrap.__val); });
      }
      导航们.forEach(function (it, i) {
        var b = el('button', 'rt-navbtn', String(it == null ? '' : it));
        b.type = 'button';
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (wrap.__val === i) return;
          wrap.__val = i; 画导航();
          runHandlers(changeMap[c.id]);
        });
        导航钮.push(b); 导航框.appendChild(b);
      });
      if (validNum(c.fs)) 导航框.style.fontSize = px(c.fs);
      if (c.color) 导航框.style.color = c.color;
      if (c.bg) 导航框.style.background = c.bg;
      if (validNum(c.radius)) 导航框.style.borderRadius = px(c.radius);
      画导航();
      wrap.appendChild(导航框);
    } else if (c.type === 'collapse') {
      // 折叠面板：点标题展开/收起，__val = 是否展开
      var 折盒 = el('div', 'rt-collapse' + (c.open ? ' open' : ''));
      var 折头 = el('div', 'rt-collapse-h');
      var 折题 = el('span', 'rt-collapse-t', c.text || '点我展开');
      var 折箭 = el('span', 'rt-collapse-a', '▾');
      折头.appendChild(折题); 折头.appendChild(折箭);
      var 折身 = el('div', 'rt-collapse-b', c.body || '');
      if (c.color) { 折题.style.color = c.color; 折身.style.color = c.color; }
      if (c.bg) 折盒.style.background = c.bg;
      if (validNum(c.radius)) 折盒.style.borderRadius = px(c.radius);
      if (validNum(c.fs)) { 折题.style.fontSize = px(c.fs); 折身.style.fontSize = px(c.fs); }
      wrap.__val = !!c.open;
      折头.addEventListener('click', function (e) {
        e.stopPropagation();
        wrap.__val = !wrap.__val;
        折盒.classList.toggle('open', wrap.__val);
        runHandlers(changeMap[c.id]);
      });
      折盒.appendChild(折头); 折盒.appendChild(折身);
      wrap.appendChild(折盒);
    } else if (c.type === 'rating') {
      // 评分：点第 N 颗星就把分数记成 N；__val = 分数
      var 星数 = Math.max(1, Number(c.max) || 5);
      var 星条 = el('div', 'rt-rating');
      var 星钮 = [];
      wrap.__val = Math.max(0, Math.min(星数, Math.round(Number(c.value) || 0)));
      function 画星() {
        星钮.forEach(function (s, i) { s.classList.toggle('on', i < wrap.__val); });
      }
      for (var 星 = 0; 星 < 星数; 星++) {
        (function (i) {
          var s = el('button', 'rt-star', '★'); s.type = 'button';
          s.addEventListener('click', function (e) {
            e.stopPropagation();
            wrap.__val = i + 1; 画星();
            runHandlers(changeMap[c.id]);
          });
          星钮.push(s); 星条.appendChild(s);
        })(星);
      }
      if (c.color) 星条.style.setProperty('--star-on', c.color);
      if (validNum(c.fs)) 星条.style.fontSize = px(c.fs);
      画星();
      wrap.appendChild(星条);
    } else if (c.type === 'ring') {
      // 进度环：SVG 圆环 + 中间百分比；__val / __max 与进度条同一套读写
      // 注意：AI 建的控件里 value/max 可能是字符串（属性清单统一转字符串），这里按数字洗一遍
      var 环最大 = Math.max(1, Number(c.max) || 100);
      var 环值 = Math.max(0, Math.min(环最大, Number(c.value) || 0));
      var 环半径 = 42, 环周长 = 2 * Math.PI * 环半径;
      var 环盒 = el('div', 'rt-ring');
      环盒.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">'
        + '<circle class="rt-ring-track" cx="50" cy="50" r="' + 环半径 + '" stroke-width="10"></circle>'
        + '<circle class="rt-ring-fill" cx="50" cy="50" r="' + 环半径 + '" stroke-width="10"'
        + ' stroke-dasharray="' + 环周长 + '" stroke-dashoffset="' + (环周长 * (1 - (环最大 ? 环值 / 环最大 : 0))) + '"></circle>'
        + '</svg>';
      var 环字 = el('span', 'rt-ring-t', Math.round(环最大 ? (环值 / 环最大 * 100) : 0) + '%');
      var 环线 = 环盒.querySelector('.rt-ring-fill');
      if (环线 && c.bg) 环线.style.stroke = c.bg;
      if (c.color) 环字.style.color = c.color;
      if (validNum(c.fs)) 环字.style.fontSize = px(c.fs);
      环盒.appendChild(环字);
      wrap.__val = 环值; wrap.__max = 环最大;
      wrap.appendChild(环盒);
    } else if (c.type === 'badge') {
      // 徽章：小圆点 + 文字，纯展示（没有点击事件）；__val = 文字
      var 徽盒 = el('div', 'rt-badge');
      var 徽点 = el('i', 'rt-badge-dot');
      徽点.style.background = c.dot || '#e5484d';
      徽盒.appendChild(徽点);
      var 徽字 = el('span', 'rt-badge-t', c.text || '');
      if (c.color) 徽字.style.color = c.color;
      if (validNum(c.fs)) 徽字.style.fontSize = px(c.fs);
      徽盒.appendChild(徽字);
      if (c.bg) 徽盒.style.background = c.bg;
      if (validNum(c.radius)) 徽盒.style.borderRadius = px(c.radius);
      wrap.__val = String(c.text == null ? '' : c.text);
      wrap.appendChild(徽盒);
    } else if (c.type === 'clock') {
      // 时钟：默认走真实时间（1 秒刷新）；代码设过文字后停走秒，设空串恢复走秒
      var 钟字 = el('div', 'rt-clock');
      applyTextStyle(钟字, c);
      if (validNum(c.h)) 钟字.style.height = px(c.h);
      wrap.__val = 时钟文字(c.format || 'hm');
      wrap.appendChild(钟字);
      启动走秒(钟字, c.format || 'hm');
    } else if (c.type === 'qr') {
      // 二维码：纯前端离线生成（qr.js），内容就是 __val；太长/为空的画占位文字
      var 码盒 = el('div', 'rt-qr');
      wrap.__val = String(c.value == null ? '' : c.value);
      var 画码 = function () {
        var 边 = Math.max(40, Math.min(validNum(c.w) ? c.w : 150, validNum(c.h) ? c.h : 150));
        码盒.innerHTML = '';
        var svg = (window.FAST_QR && wrap.__val) ? window.FAST_QR.svg(wrap.__val, 边, c.color || '#000000', c.bg || '#ffffff') : '';
        if (svg) 码盒.innerHTML = svg;
        else 码盒.appendChild(el('span', 'rt-qr-ph', wrap.__val ? '内容太长，放不进二维码' : '二维码'));
      };
      画码();
      wrap.appendChild(码盒);
      wrap.__画码 = 画码;
    } else if (c.type === 'multiSelect') {
      // 多选下拉：自绘列表，点一行切换一行（可以连选多项）；__val = 选中的值数组
      function 多变数组(v) {
        if (Array.isArray(v)) return v.map(function (x) { return String(x); });
        return String(v == null ? '' : v).split(/[,，、\n]/).map(function (s) { return s.trim(); })
          .filter(function (s) { return s !== ''; });
      }
      var 多箱 = el('div', 'rt-select rt-multi');
      var 多值 = el('span', 'rt-select-v');
      var 多箭 = el('span', 'rt-select-a', '▾');
      多箱.appendChild(多值); 多箱.appendChild(多箭);
      if (validNum(c.fs)) 多箱.style.fontSize = px(c.fs);
      if (c.color) 多箱.style.color = c.color;
      if (c.bg) 多箱.style.background = c.bg;
      if (validNum(c.radius)) 多箱.style.borderRadius = px(c.radius);
      if (validNum(c.h)) 多箱.style.height = px(c.h);
      if (c.caretColor) 多箭.style.color = c.caretColor;
      applySkin(多箱, c);
      wrap.__val = 多变数组(c.value);
      var 多单 = el('div', 'rt-select-menu rt-multi-menu');
      var 画多值 = function () {
        多值.textContent = wrap.__val.length ? wrap.__val.join('、') : '请选择';
        多箱.classList.toggle('has-val', !!wrap.__val.length);
      };
      var 画多单 = function () {
        多单.innerHTML = '';
        (c.items || []).forEach(function (it) {
          it = String(it == null ? '' : it);
          var on = wrap.__val.indexOf(it) >= 0;
          var row = el('div', 'rt-select-item rt-multi-item' + (on ? ' on' : ''));
          row.appendChild(el('span', 'rt-select-item-t', it));
          row.appendChild(el('span', 'rt-select-item-c rt-multi-box', on ? '✓' : ''));
          row.addEventListener('click', function (e) {
            e.stopPropagation();
            var at = wrap.__val.indexOf(it);
            if (at >= 0) wrap.__val.splice(at, 1); else wrap.__val.push(it);
            画多值(); 画多单();
            runHandlers(changeMap[c.id]);
          });
          多单.appendChild(row);
        });
        if (c.color) 多单.style.color = c.color;
      };
      var 关多单 = function () { 多单.classList.remove('open'); 多单.classList.remove('up'); 多箱.classList.remove('open'); };
      var 开多单 = function () {
        画多单();
        var root = wrap.parentNode;
        if (root) {
          var om = root.querySelectorAll('.rt-select-menu.open');
          for (var oi = 0; oi < om.length; oi++) om[oi].classList.remove('open');
          var ob = root.querySelectorAll('.rt-select.open');
          for (var bi = 0; bi < ob.length; bi++) ob[bi].classList.remove('open');
        }
        多单.classList.remove('up'); 多单.classList.add('open'); 多箱.classList.add('open');
        var r = 多箱.getBoundingClientRect();
        var vh = window.innerHeight || 800;
        if (r.bottom + 多单.offsetHeight + 8 > vh && r.top > 多单.offsetHeight + 8) 多单.classList.add('up');
        document.removeEventListener('click', 关多单);
        setTimeout(function () { document.addEventListener('click', 关多单, { once: true }); }, 0);
      };
      画多值();
      多箱.addEventListener('click', function (e) {
        e.stopPropagation();
        if (多单.classList.contains('open')) 关多单(); else 开多单();
      });
      wrap.appendChild(多箱); wrap.appendChild(多单);
    } else if (c.type === 'dateRange') {
      // 日期范围：起止两个日期，__val = "开始~结束"（同时保留 __start/__end 供代码读取）
      var 日盒 = el('div', 'rt-daterange');
      var 起日 = el('input'); 起日.type = 'date'; 起日.className = 'rt-date';
      var 止日 = el('input'); 止日.type = 'date'; 止日.className = 'rt-date';
      var 至字 = el('span', 'rt-dr-sep', '至');
      wrap.__start = String(c.start == null ? '' : c.start);
      wrap.__end = String(c.end == null ? '' : c.end);
      var 拼范围 = function () {
        wrap.__val = (wrap.__start || wrap.__end) ? (wrap.__start + '~' + wrap.__end) : '';
        起日.value = wrap.__start; 止日.value = wrap.__end;
      };
      if (validNum(c.fs)) { 起日.style.fontSize = px(c.fs); 止日.style.fontSize = px(c.fs); }
      if (c.color) { 起日.style.color = c.color; 止日.style.color = c.color; }
      if (c.bg) { 起日.style.background = c.bg; 止日.style.background = c.bg; }
      if (validNum(c.radius)) { 起日.style.borderRadius = px(c.radius); 止日.style.borderRadius = px(c.radius); }
      起日.addEventListener('change', function () { wrap.__start = 起日.value; 拼范围(); runHandlers(changeMap[c.id]); });
      止日.addEventListener('change', function () { wrap.__end = 止日.value; 拼范围(); runHandlers(changeMap[c.id]); });
      拼范围();
      日盒.appendChild(起日); 日盒.appendChild(至字); 日盒.appendChild(止日);
      wrap.appendChild(日盒);
    } else if (c.type === 'colorPicker') {
      // 颜色选择器：点开调色板挑颜色，__val = #rrggbb
      var 色箱 = el('div', 'rt-color');
      var 色块 = el('span', 'rt-color-sw');
      var 色字 = el('span', 'rt-color-t');
      var 色箭 = el('span', 'rt-select-a', '▾');
      色箱.appendChild(色块); 色箱.appendChild(色字); 色箱.appendChild(色箭);
      if (validNum(c.h)) 色箱.style.height = px(c.h);
      if (validNum(c.fs)) 色字.style.fontSize = px(c.fs);
      if (c.color) 色字.style.color = c.color;
      if (validNum(c.radius)) 色箱.style.borderRadius = px(c.radius);
      wrap.__val = String(c.value || '#6750a4');
      色块.style.background = wrap.__val;
      色字.textContent = wrap.__val;
      var 色板 = ['#6750a4', '#7d5260', '#b3261e', '#ef6c00', '#f9a825', '#2e7d32',
                 '#00838f', '#1565c0', '#4527a0', '#795548', '#000000', '#ffffff'];
      var 色单 = el('div', 'rt-select-menu rt-color-menu');
      var 设色 = function (hex) {
        wrap.__val = String(hex);
        色块.style.background = wrap.__val;
        色字.textContent = wrap.__val;
      };
      var 关色单 = function () { 色单.classList.remove('open'); 色单.classList.remove('up'); 色箱.classList.remove('open'); };
      var 画色单 = function () {
        色单.innerHTML = '';
        色板.forEach(function (hex) {
          var dot = el('span', 'rt-color-dot' + (String(hex).toLowerCase() === String(wrap.__val).toLowerCase() ? ' on' : ''));
          dot.setAttribute('data-c', hex);
          dot.style.background = hex;
          dot.addEventListener('click', function (e) {
            e.stopPropagation();
            设色(hex); 关色单();
            runHandlers(changeMap[c.id]);
          });
          色单.appendChild(dot);
        });
      };
      var 开色单 = function () {
        画色单();
        var root = wrap.parentNode;
        if (root) {
          var om = root.querySelectorAll('.rt-select-menu.open');
          for (var oi = 0; oi < om.length; oi++) om[oi].classList.remove('open');
          var ob = root.querySelectorAll('.rt-select.open');
          for (var bi = 0; bi < ob.length; bi++) ob[bi].classList.remove('open');
        }
        色单.classList.remove('up'); 色单.classList.add('open'); 色箱.classList.add('open');
        var r = 色箱.getBoundingClientRect();
        var vh = window.innerHeight || 800;
        if (r.bottom + 色单.offsetHeight + 8 > vh && r.top > 色单.offsetHeight + 8) 色单.classList.add('up');
        document.removeEventListener('click', 关色单);
        setTimeout(function () { document.addEventListener('click', 关色单, { once: true }); }, 0);
      };
      色箱.addEventListener('click', function (e) {
        e.stopPropagation();
        if (色单.classList.contains('open')) 关色单(); else 开色单();
      });
      wrap.appendChild(色箱); wrap.appendChild(色单);
    } else if (c.type === 'switch') {
      var srow = el('div', 'ctl-row sw-row');
      var slab = el('span', 'v-text', c.text || '开关'); applyTextStyle(slab, c);
      var sw = el('button', 'sw' + (c.checked ? ' on' : '')); sw.type = 'button';
      sw.appendChild(el('span', 'sw-knob'));
      srow.appendChild(slab); srow.appendChild(sw);
      wrap.__val = !!c.checked;
      function swToggle() {
        wrap.__val = !wrap.__val; sw.classList.toggle('on', wrap.__val);
        runHandlers(clickMap[c.id])
      }
      sw.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swToggle(); });
      srow.addEventListener('click', function () { swToggle(); });
      if (c.align) srow.style.justifyContent = c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'space-between');
      wrap.appendChild(srow);
    } else if (c.type === 'checkbox') {
      var crow = el('div', 'ctl-row ck-row');
      var ck = el('span', 'ck' + (c.checked ? ' on' : '')); ck.appendChild(el('span', 'ck-tick', '✓'));
      var clab = el('span', 'v-text', c.text || '复选项'); applyTextStyle(clab, c);
      crow.appendChild(ck); crow.appendChild(clab);
      wrap.__val = !!c.checked;
      function ckToggle() {
        wrap.__val = !wrap.__val; ck.classList.toggle('on', wrap.__val);
        runHandlers(clickMap[c.id])
      }
      crow.addEventListener('click', function (e) { e.preventDefault(); ckToggle(); });
      if (c.align) crow.style.justifyContent = c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'flex-start');
      wrap.appendChild(crow);
    } else if (c.type === 'slider') {
      var rng = el('input'); rng.type = 'range'; rng.className = 'rng';
      rng.min = validNum(c.min) ? c.min : 0;
      rng.max = validNum(c.max) ? c.max : 100;
      rng.value = validNum(c.value) ? c.value : 0;
      if (c.bg) rng.style.accentColor = c.bg;
      if (c.color) rng.style.accentColor = c.color;
      wrap.__val = Number(rng.value);
      rng.addEventListener('input', function () {
        wrap.__val = Number(rng.value);
        var fns = changeMap[c.id] || []; if (fns.length) { userGesture(); fns.forEach(function (fn) { safe(function () { fn(wrap.__val); }); }); }
      });
      wrap.appendChild(rng);
    } else if (c.type === 'progress') {
      var pmax = validNum(c.max) ? c.max : 100;
      var pv0 = Math.max(0, Math.min(pmax, validNum(c.value) ? c.value : 0));
      var track = el('div', 'prog');
      var pfill = el('div', 'prog-fill');
      if (c.bg) pfill.style.background = c.bg;
      if (validNum(c.radius)) { track.style.borderRadius = px(c.radius); pfill.style.borderRadius = px(c.radius); }
      track.appendChild(pfill);
      wrap.appendChild(track);
      wrap.__val = pv0; wrap.__max = pmax;
      pfill.style.width = (pmax ? (pv0 / pmax * 100) : 0) + '%';
    } else if (c.type === 'video') {
      var vid = el('video', 'rt-media'); vid.controls = false; vid.preload = 'metadata';
      vid.setAttribute('playsinline', '');
      if (c.src) vid.src = resolveMedia(c.src);
      if (validNum(c.radius)) vid.style.borderRadius = px(c.radius);
      applySkin(vid, c);
      vid.addEventListener('error', function () {});
      wrap.__media = vid;
      wrap.appendChild(vid);
    } else if (c.type === 'audio') {
      var aud = el('audio', 'rt-media'); aud.controls = true; aud.preload = 'none';
      if (c.src) aud.src = resolveMedia(c.src);
      applySkin(aud, c);
      wrap.__media = aud;
      wrap.appendChild(aud);
    } else if (c.type === 'web') {
      var frm = el('iframe', 'rt-web'); frm.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frm.setAttribute('allow', 'fullscreen');
      if (c.url) frm.src = c.url;
      if (validNum(c.radius)) frm.style.borderRadius = px(c.radius);
      applySkin(frm, c);
      wrap.__media = frm;
      wrap.appendChild(frm);
    }
    return wrap;
  }

  function makeLi(listId, txt, i, c) {
    var li = el('div', 'li', txt == null ? '' : String(txt));
    if (c && validNum(c.fs)) li.style.fontSize = px(c.fs);
    if (c && c.align) li.style.justifyContent = c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'flex-start');
    li.addEventListener('click', function () {
      selected[listId] = { item: txt, index: i };
      var fns = itemClickMap[listId] || [];
      if (fns.length) {
        userGesture();
        fns.forEach(function (fn) { safe(function () { fn(txt, i); }); });
      }
    });
    return li;
  }

  function compRoot(id) { return document.querySelector('[data-id="' + id + '"]'); }
  function compRootMedia(id) { var r = compRoot(id); return r ? r.__media : null; }
  // media://xxx 引用：交由原生解析成可播放 file 地址（编辑器私有目录 / 导出 APK 的 assets）
  function resolveMedia(src) {
    if (src && src.indexOf('media://') === 0) {
      var name = src.slice(8);
      try { if (window.Native && Native.mediaUrl) { var u = Native.mediaUrl(name); if (u) return u; } } catch (e) {}
      return src;
    }
    return src;
  }

  /* ---------------- 云列表（SeaTable，支持一个作品接入多个云表格） ---------------- */
  function newCloudSlot() { return { cfg: null, jwt: null, uuid: null, gateway: null, meta: {} }; }
  var cloudPool = Object.create(null);
  var cloudLegacy = newCloudSlot();   // 旧版 cloudSetup 代码使用的默认连接
  function cloudSlot(id) {
    if (id && cloudPool[id]) return cloudPool[id];
    return cloudLegacy;
  }
  function cloudDefaultServer(p) {
    if (p === 'seatable-io') return 'https://cloud.seatable.io';
    return 'https://cloud.seatable.cn';
  }
  function sqlEscape(v) { return String(v == null ? '' : v).replace(/'/g, "''"); }
  // 统一解析：非 2xx 或业务错误都抛出带信息的 Error
  function cloudInterpret(status, txt) {
    var data = null; if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
    var errMsg = data && (data.error_message || data.error_msg || data.detail || data.error);
    if (status < 200 || status >= 300 || errMsg) throw new Error(errMsg || ('云列表请求失败 HTTP ' + status));
    return data;
  }
  // 原生桥接 HTTP（App 内优先；绕过 WebView CORS，例如 SeaTable 网关重复 ACAO 头）
  var httpSeq = 0;
  window.__nativeHttpResolve = function (id, json) {
    var f = window.__httpPending && window.__httpPending[id];
    if (f) { try { delete window.__httpPending[id]; } catch (e) { window.__httpPending[id] = null; } f(json); }
  };
  function nativeHttp(method, url, headers, bodyText) {
    return new Promise(function (resolve, reject) {
      if (!(window.Native && Native.httpRequest)) { reject(new Error('NO_NATIVE')); return; }
      var id = 'h' + (++httpSeq) + '_' + Date.now();
      window.__httpPending = window.__httpPending || {};
      var done = false;
      var timer = setTimeout(function () {
        if (done) return; done = true; delete window.__httpPending[id]; reject(new Error('网络请求超时'));
      }, 25000);
      window.__httpPending[id] = function (payloadText) {
        if (done) return; done = true; clearTimeout(timer); delete window.__httpPending[id];
        var r = null; try { r = JSON.parse(payloadText); } catch (e) { reject(new Error('网络响应解析失败')); return; }
        resolve(r);
      };
      try { Native.httpRequest(id, method, url, JSON.stringify(headers || {}), bodyText || ''); }
      catch (e) { if (done) return; done = true; clearTimeout(timer); delete window.__httpPending[id]; reject(e); }
    });
  }
  /**
   * 通用网络请求（路线图 1.2）：GET / POST。
   * 真机走原生 HttpURLConnection（绕开 CORS、支持任意 https），浏览器/导出预览里退回 fetch。
   * 返回服务器回的文字（JSON 就自己再解析，用 RT.jsonGet 取字段）。
   */
  function httpRequest(method, url, body) {
    url = String(url == null ? '' : url).trim();
    if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('网址要以 http:// 或 https:// 开头'));
    var headers = { 'Accept': 'application/json, text/plain, */*' };
    var bodyText = null;
    if (body !== undefined && body !== null && String(body) !== '') {
      headers['Content-Type'] = 'application/json';
      bodyText = (typeof body === 'string') ? body : JSON.stringify(body);
    }
    if (window.Native && Native.httpRequest) {
      return nativeHttp(method, url, headers, bodyText).then(function (r) {
        if (r && r.error) throw new Error(r.error);
        var 码 = (r && r.status) || 0;
        if (码 >= 400) throw new Error('服务器返回 ' + 码);
        return String((r && r.body) || '');
      });
    }
    var opt = { method: method, headers: headers };
    if (bodyText !== null) opt.body = bodyText;
    return fetch(url, opt).then(function (resp) {
      if (!resp.ok) throw new Error('服务器返回 ' + resp.status);
      return resp.text();
    });
  }
  function cloudHttp(method, url, body, token) {
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) h['Authorization'] = 'Token ' + token;
    var bodyText = (body !== undefined && body !== null) ? JSON.stringify(body) : null;
    if (window.Native && Native.httpRequest) {
      return nativeHttp(method, url, h, bodyText).then(function (r) {
        if (r && r.error) throw new Error(r.error);
        return cloudInterpret((r && r.status) || 0, (r && r.body) || '');
      });
    }
    var opt = { method: method, headers: h };
    if (bodyText !== null) opt.body = bodyText;
    return fetch(url, opt).then(function (resp) {
      return resp.text().then(function (txt) { return cloudInterpret(resp.status, txt); });
    });
  }
  async function cloudAuth(slot, force) {
    if (!slot.cfg) throw new Error('请先在“云列表”分类里创建云表格（填写名称、UUID 和 API 密钥）');
    if (slot.jwt && !force) return slot;
    var d = await cloudHttp('GET', slot.cfg.server + '/api/v2.1/dtable/app-access-token/', null, slot.cfg.token);
    if (!d || !d.access_token) throw new Error('云表格鉴权失败，请检查 API 密钥');
    slot.jwt = d.access_token;
    slot.uuid = d.dtable_uuid || slot.cfg.uuid;
    slot.gateway = (d.dtable_server || (slot.cfg.server + '/api-gateway/')).replace(/\/+$/, '');
    return slot;
  }
  async function cloudGateway(slot, method, path, body, retrying) {
    var s = await cloudAuth(slot, false);
    // 路径里的 {uuid} 在鉴权完成后再替换（首次调用时 slot.uuid 尚未拿到）
    var realPath = String(path).replace('{uuid}', encodeURIComponent(s.uuid || ''));
    try {
      return await cloudHttp(method, s.gateway + realPath, body, s.jwt);
    } catch (e) {
      // token 过期（401/403）时强制重新鉴权重试一次
      if (!retrying && /HTTP (401|403)/.test(e.message)) {
        await cloudAuth(s, true);
        return cloudGateway(s, method, path, body, true);
      }
      throw e;
    }
  }
  // 取某表的 列key→列名 映射（GET rows 返回列 key，需要转回中文列名）
  async function cloudColumnMap(slot, table) {
    if (slot.meta[table]) return slot.meta[table];
    var d = await cloudGateway(slot, 'GET', '/api/v2/dtables/{uuid}' + '/metadata/', null);
    var map = {};
    ((d && d.metadata && d.metadata.tables) || []).forEach(function (t) {
      if (t.name !== table) return;
      (t.columns || []).forEach(function (col) { map[col.key] = col.name; });
    });
    slot.meta[table] = map;
    return map;
  }

  /* ---------------- 代码可调用的 RT API ---------------- */
  /** 依次执行某个控件上的**所有**事件处理器 —— 同一个事件可以有多组代码（用户反馈只跑了最后那组） */
  function runHandlers(list) {
    if (!list || !list.length) return;
    userGesture();
    list.forEach(function (fn) { safe(fn); });
  }
  /* 数据代码用的小工具：把任意值安全地变成文字 / 列表。
     代码块的槽里可能是空、数字、null、甚至一整个列表，这里统一兜住，别让运行时抛错。 */
  function rtText(v) { return (v === null || v === undefined) ? '' : String(v); }
  function rtList(v) {
    if (Array.isArray(v)) return v.slice();
    if (v === null || v === undefined || v === '') return [];
    if (typeof v === 'string') { try { var a = JSON.parse(v); if (Array.isArray(a)) return a; } catch (e) {} }
    return [v];
  }

  var RT = {
    on: function (evt, fn) {
      if (evt === 'start') startHandlers.push(fn);
      else if (evt === 'firstStart') firstStartHandlers.push(fn);
      else if (evt === 'swipe') swipeHandlers.push({ dir: '', fn: fn });
    },
    /** 滑屏事件：dir 为 ''（任意）/ 'up' / 'down' / 'left' / 'right' */
    onSwipe: function (dir, fn) { swipeHandlers.push({ dir: String(dir || ''), fn: fn }); },
    /** 最近一次滑动的方向（中文：上滑/下滑/左滑/右滑，没滑过就是空） */
    swipeDirection: function () {
      var d = lastSwipe.dir;
      return d === 'up' ? '上滑' : d === 'down' ? '下滑' : d === 'left' ? '左滑' : d === 'right' ? '右滑' : '';
    },
    /** 最近一次滑动的方向代号（up/down/left/right，便于比较） */
    swipeDirCode: function () { return lastSwipe.dir || ''; },
    /** 最近一次滑动的距离（像素，直线距离） */
    swipeDistance: function () { return Number(lastSwipe.dist) || 0; },
    /** 最近一次滑动的横向位移（正=向右） */
    swipeDx: function () { return Number(lastSwipe.dx) || 0; },
    /**
     * 给表格/图表换数据（代码块「把〔表格/图表〕的数据设为〔文本〕」用它）。
     * 文本格式：
     *   表格 —— 第一行是表头，其余每行一条数据，单元格用逗号：`名称,数量\n苹果,3\n香蕉,5`
     *   图表 —— 每行「名称,数值」或只写数值：`一月,30\n二月,60`
     */
    setData: function (id, text) {
      var root = compRoot(id); if (!root) return false;
      var 文本 = String(text == null ? '' : text).replace(/\r/g, '');
      var 行 = 文本.split('\n').filter(function (s) { return s.trim() !== ''; });
      var 拆 = function (line) { return line.split(/[,，\t]/).map(function (s) { return s.trim(); }); };
      // 找到数据模型里的这个控件：改完数据顺手写回模型，之后重渲染也不会丢
      var c = null;
      try { (current.components || []).forEach(function (x) { if (x.id === id) c = x; }); } catch (e) {}
      var 是表 = (c && c.type === 'table') || String(root.className || '').indexOf('table') >= 0;
      if (是表) {
        var 列 = 行.length ? 拆(行[0]) : [];
        var 数据 = 行.slice(1).map(拆);
        if (c) { c.columns = 列; c.rows = 数据; 画表格(root, c); }
        else { 画表格(root, { columns: 列, rows: 数据 }); }
        return true;
      }
      var 点 = 行.map(function (line, i) {
        var 段 = 拆(line);
        if (段.length >= 2) return { label: 段[0], value: Number(段[1]) || 0 };
        return { label: String(i + 1), value: Number(段[0]) || 0 };
      });
      if (c) { c.chartData = 点; 画图表(root, c); }
      else { 画图表(root, { chartType: root.getAttribute('data-chart') || 'bar', chartData: 点 }); }
      return true;
    },
    /** 最近一次滑动的纵向位移（正=向下） */
    swipeDy: function () { return Number(lastSwipe.dy) || 0; },
    /**
     * 选图 / 拍照（用户要求：相机、相册）。
     * 用 WebView 自带的文件选择器：带 capture 时安卓优先打开相机，没有相机就退回相册。
     * 选好后读成 dataURL 直接塞进图片控件，不需要改原生、也不占应用私有目录。
     */
    pickImage: function (compId) {
      return new Promise(function (resolve, reject) {
        var root = compRoot(compId);
        // 没选控件 / 选错了控件（不是图片）：直接说清楚，别让用户以为"代码没执行"
        if (!root) { showToast('这段代码里还没选图片控件'); reject(new Error('没有选图片控件')); return; }
        if (String(root.className || '').indexOf('image') < 0) { showToast('请把结果显示到「图片」控件上'); reject(new Error('目标不是图片控件')); return; }
        function 落地(url) {
          var img = root.querySelector('img');
          if (!img) {
            img = document.createElement('img');
            img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
            root.appendChild(img);
          }
          img.src = url;
          var ph = root.querySelector('.imgph'); if (ph) ph.style.display = 'none';
          resolve(url);
        }
        // 真机优先走原生（相机/相册都能开，也不受 WebView 文件选择器限制）
        try {
          if (window.Native && Native.pickImageNative) {
            var id = 'pick' + (++httpSeq) + '_' + Date.now();
            window.__pickPending = window.__pickPending || {};
            window.__pickPending[id] = function (dataUrl) {
              delete window.__pickPending[id];
              if (!dataUrl) { reject(new Error('没有选择图片')); return; }
              落地(dataUrl);
            };
            window.__nativePickImage = function (cbId, dataUrl) {
              var f = window.__pickPending && window.__pickPending[cbId];
              if (f) f(dataUrl);
            };
            showToast('正在打开相机 / 相册…');
            Native.pickImageNative(id, 'image');
            return;
          }
        } catch (e) {}
        // 浏览器 / 预览：WebView 的文件选择器（带 capture 时安卓优先开相机）
        try {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.setAttribute('capture', 'environment');
          input.style.position = 'fixed'; input.style.left = '-9999px';
          document.body.appendChild(input);
          var 清理 = function () { try { if (input.parentNode) input.parentNode.removeChild(input); } catch (e) {} };
          input.addEventListener('change', function () {
            var f = input.files && input.files[0];
            if (!f) { 清理(); reject(new Error('没有选择图片')); return; }
            var fr = new FileReader();
            fr.onload = function () { 清理(); 落地(String(fr.result || '')); };
            fr.onerror = function () { 清理(); reject(new Error('图片读取失败')); };
            fr.readAsDataURL(f);
          });
          showToast('正在打开相机 / 相册…');
          input.click();
        } catch (e) { reject(e); }
      });
    },
    onClick: function (id, fn) { (clickMap[id] = clickMap[id] || []).push(fn); },
    onItemClick: function (id, fn) { (itemClickMap[id] = itemClickMap[id] || []).push(fn); },
    onChange: function (id, fn) { (changeMap[id] = changeMap[id] || []).push(fn); },
    setText: function (id, v) {
      var root = compRoot(id); if (!root) return;
      var t = root.querySelector('.v-text'); if (t) t.textContent = (v == null ? '' : String(v));
      var inp = root.querySelector('input'); if (inp) inp.value = (v == null ? '' : String(v));
    },
    getText: function (id) {
      var root = compRoot(id); if (!root) return '';
      var inp = root.querySelector('input'); if (inp) return inp.value;
      var t = root.querySelector('.v-text'); return t ? t.textContent : '';
    },
    /* 设置输入框提示词（placeholder） */
    setHint: function (id, v) {
      var root = compRoot(id); if (!root) return;
      var inp = root.querySelector('input'); if (inp) inp.placeholder = (v == null ? '' : String(v));
    },
    toast: function (m, secs) { showToast(String(m == null ? '' : m), secs); },
    gotoPage: function (name) { var s = resolveScreen(name); if (s) navigate(s.id, false); },
    back: function () { goBack(); },
    listAdd: function (id, v) {
      var root = compRoot(id), ul = root && root.querySelector('.ul'); if (!ul) return;
      var empty = ul.querySelector('.empty'); if (empty) empty.remove();
      var c = (current.components || []).filter(function (x) { return x.id === id; })[0];
      ul.appendChild(makeLi(id, v, ul.querySelectorAll('.li').length, c));
    },
    listClear: function (id) { var root = compRoot(id), ul = root && root.querySelector('.ul'); if (ul) ul.innerHTML = '<div class="empty">（空列表）</div>'; },
    listSet: function (id, arr) {
      var root = compRoot(id), ul = root && root.querySelector('.ul'); if (!ul) return;
      ul.innerHTML = '';
      var c = (current.components || []).filter(function (x) { return x.id === id; })[0];
      if (!arr || !arr.length) { ul.appendChild(el('div', 'empty', '（空列表）')); return; }
      arr.forEach(function (v, i) { ul.appendChild(makeLi(id, v, i, c)); });
    },
    selectedItem: function (id) { return selected[id] ? selected[id].item : ''; },
    selectedIndex: function (id) { return selected[id] ? selected[id].index : -1; },
    /* 显示 / 隐藏组件 */
    show: function (id) { var r = compRoot(id); if (r) r.style.display = ''; },
    hide: function (id) { var r = compRoot(id); if (r) r.style.display = 'none'; },
    setVisible: function (id, v) { var r = compRoot(id); if (r) r.style.display = v ? '' : 'none'; },
    /* 启用 / 禁用组件：禁用后点不动、也不能输入，视觉上变灰 */
    enable: function (id) {
      var r = compRoot(id); if (!r) return;
      r.classList.remove('rt-disabled');
      r.style.pointerEvents = '';
      Array.prototype.forEach.call(r.querySelectorAll('input,button,select,textarea,video,audio'), function (el) { el.disabled = false; });
    },
    disable: function (id) {
      var r = compRoot(id); if (!r) return;
      r.classList.add('rt-disabled');
      r.style.pointerEvents = 'none';
      Array.prototype.forEach.call(r.querySelectorAll('input,button,select,textarea,video,audio'), function (el) { el.disabled = true; });
    },
    /* 旋转角度：所有控件通用 */
    setRot: function (id, deg) {
      var r = compRoot(id); if (!r) return;
      var n = Number(deg); if (!isFinite(n)) return;
      r.style.transform = n === 0 ? '' : ('rotate(' + n + 'deg)');
      r.style.transformOrigin = 'center center';
    },
    getRot: function (id) {
      var r = compRoot(id); if (!r) return 0;
      var m = /rotate\((-?[\d.]+)deg\)/.exec(r.style.transform || '');
      return m ? Number(m[1]) : 0;
    },
    isDisabled: function (id) {
      var r = compRoot(id);
      return !!(r && (r.classList.contains('rt-disabled') || r.style.pointerEvents === 'none'));
    },
    /* 位置 / 大小：改 DOM 的同时写回组件数据，同一页面内切回来也不会丢 */
    setPos: function (id, x, y) {
      var r = compRoot(id); if (!r) return;
      var nx = Number(x), ny = Number(y);
      var 有X = isFinite(nx), 有Y = isFinite(ny);
      if (!有X && !有Y) return;
      var c = r.__c; if (!c) return;
      if (有X) c.x = nx;
      if (有Y) c.y = ny;
      c.cx = false;                                  // 手动定位优先于“居中锁”
      r.classList.add('absolute');
      r.style.position = 'absolute';
      if (有X) r.style.left = nx + 'px';
      if (有Y) r.style.top = ny + 'px';
      // 自动排列的控件本来没有宽高，改成自由定位后要补上默认尺寸，否则会缩成一条
      var db = defaultBox(c.type);
      if (!validNum(c.w)) { c.w = db.w; r.style.width = px(db.w); }
      if (!validNum(c.h)) { c.h = db.h; r.style.height = px(db.h); }
    },
    setSize: function (id, w, h) {
      var r = compRoot(id); if (!r) return;
      var c = r.__c; if (!c) return;
      var nw = Number(w), nh = Number(h);
      if (isFinite(nw) && nw >= 0) { c.w = nw; r.style.width = nw + 'px'; }
      if (isFinite(nh) && nh >= 0) { c.h = nh; r.style.height = nh + 'px'; }
    },
    /* 透明度 0~100 */
    setOpacity: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var n = Number(v); if (!isFinite(n)) return;
      r.style.opacity = (Math.max(0, Math.min(100, n)) / 100).toFixed(3);
    },
    /* 震动：优先原生（WebView 多禁用 navigator.vibrate），回退网页振动 */
    vibrate: function (ms) {
      var n = Math.max(1, parseInt(ms, 10) || 30);
      try { if (window.Native && Native.vibrate) { Native.vibrate(n); return; } } catch (e) {}
      try { navigator.vibrate && navigator.vibrate(n); } catch (e) {}
    },
    /* ===== 设备信息 ===== */
    deviceVal: function (key) {
      // 帧率走 JS 实时实测；启动瞬间首次采样未满 1 秒时回退屏幕刷新率，避免返回 0
      if (key === 'fps') return fpsValue > 0 ? fpsValue : (readDeviceInfo().refreshRate || 60);
      var info = readDeviceInfo();
      var v = info[key];
      if (v === undefined || v === null) return '';
      return v;
    },
    setBrightness: function (v) {
      var n = Number(v); if (!isFinite(n)) return;
      try { if (window.Native && Native.setBrightness) Native.setBrightness(n); } catch (e) {}
    },
    setKeepScreenOn: function (on) {
      try { if (window.Native && Native.setKeepScreenOn) Native.setKeepScreenOn(!!on); } catch (e) {}
    },
    // 退出试运行：恢复系统亮度（清除窗口亮度覆盖）并取消常亮，避免带回编辑器
    restoreDisplay: function () {
      try { if (window.Native && Native.restoreDisplay) Native.restoreDisplay(); } catch (e) {}
    },
    copyText: function (text) {
      var s = String(text == null ? '' : text);
      try {
        if (window.Native && Native.copyText) { Native.copyText(s); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s); return; }
      } catch (e) {}
    },
    /* 读取剪贴板：值是同步返回的（代码块当普通文字用）；网页里拿不到时给空文字 */
    readClipboard: function () {
      try {
        if (window.Native && Native.readClipboard) return String(Native.readClipboard() || '');
      } catch (e) {}
      return '';
    },
    /* 打开网址：先在系统浏览器里打开；网页版回退新标签页 */
    openUrl: function (url) {
      var u = String(url == null ? '' : url).replace(/^\s+|\s+$/g, '');
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) { showToast('网址要以 http:// 或 https:// 开头'); return; }
      try {
        if (window.Native && Native.openUrl) { Native.openUrl(u); return; }
        if (window.open) { window.open(u, '_blank'); return; }
      } catch (e) {}
      showToast('打不开这个网址');
    },
    /* 发通知：原生通知栏；网页版退回页面内提示 */
    notify: function (title, text) {
      var t = String(title == null ? '' : title).replace(/^\s+|\s+$/g, '') || '提醒';
      var x = String(text == null ? '' : text);
      try {
        if (window.Native && Native.notify) {
          // Android 13+ 默认不给通知权限：第一次用时先问一次，别让用户以为"发了但没反应"
          var 允许 = true;
          try { if (Native.notifAllowed) 允许 = !!Native.notifAllowed(); } catch (e) {}
          if (!允许) {
            try { if (Native.askNotif) Native.askNotif(); } catch (e) {}
            showToast('请在弹窗里允许通知，之后才会显示在通知栏');
            return;
          }
          Native.notify(t, x);
          return;
        }
      } catch (e) {}
      showToast(t + (x ? '：' + x : ''));
    },
    /* 等待若干秒（在 async 事件里用 await 调用），界面不卡死 */
    wait: function (sec) {
      var n = Number(sec); if (!isFinite(n) || n < 0) n = 0;
      return new Promise(function (resolve) { setTimeout(resolve, n * 1000); });
    },
    /* 退出：试运行/编辑器内只退出试运行（返回编辑器）；导出的独立 App 才真正退出应用 */
    exit: function () {
      if (isPreview || mode() === 'editor') {
        RT.restoreDisplay();
        try { history.back(); } catch (e) {}
        return;
      }
      try { if (window.Native && Native.exitApp) { Native.exitApp(); return; } } catch (e) {}
      showToast('已请求退出应用');
    },
    /* 开关 / 复选框：设置与读取布尔状态 */
    setChecked: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var on = !!v; r.__val = on;
      var sw = r.querySelector('.sw'), ck = r.querySelector('.ck');
      if (sw) sw.classList.toggle('on', on);
      if (ck) ck.classList.toggle('on', on);
    },
    getChecked: function (id) { var r = compRoot(id); return r ? !!r.__val : false; },
    /* 滑块：设置与读取数值 */
    setSlider: function (id, v) {
      var r = compRoot(id), n = r && r.querySelector('.rng'); if (!n) return;
      var num = Number(v); if (!isFinite(num)) return;
      n.value = num; r.__val = Number(n.value);
    },
    getSlider: function (id) { var r = compRoot(id); return r ? Number(r.__val || 0) : 0; },
    /* 进度条 / 进度环：设置与读取进度（按最大值自动钳制） */
    setProgress: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var mx = r.__max || 100, n = Math.max(0, Math.min(mx, Number(v) || 0));
      r.__val = n;
      var f = r.querySelector('.prog-fill');
      if (f) { f.style.width = (mx ? (n / mx * 100) : 0) + '%'; return; }
      var 环线 = r.querySelector('.rt-ring-fill');       // 进度环走 SVG 描边
      if (环线) {
        var 周长 = 2 * Math.PI * 42;
        环线.setAttribute('stroke-dashoffset', String(周长 * (1 - (mx ? n / mx : 0))));
        var 环字 = r.querySelector('.rt-ring-t');
        if (环字) 环字.textContent = Math.round(mx ? (n / mx * 100) : 0) + '%';
      }
    },
    getProgress: function (id) { var r = compRoot(id); return r ? Number(r.__val || 0) : 0; },
    /* 标签页 / 评分 / 折叠面板：用代码改值 */
    setTabs: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var 钮 = r.querySelectorAll('.rt-tab'); if (!钮.length) return;
      var n = Math.floor(Number(v)); if (!isFinite(n)) return;
      n = Math.max(0, Math.min(钮.length - 1, n));
      r.__val = n;
      Array.prototype.forEach.call(钮, function (b, i) { b.classList.toggle('on', i === n); });
    },
    setBottomNav: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var 钮 = r.querySelectorAll('.rt-navbtn'); if (!钮.length) return;
      var n = Math.floor(Number(v)); if (!isFinite(n)) return;
      n = Math.max(0, Math.min(钮.length - 1, n));
      r.__val = n;
      Array.prototype.forEach.call(钮, function (b, i) { b.classList.toggle('on', i === n); });
    },
    setRating: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var 钮 = r.querySelectorAll('.rt-star'); if (!钮.length) return;
      var n = Math.round(Number(v)); if (!isFinite(n)) return;
      n = Math.max(0, Math.min(钮.length, n));
      r.__val = n;
      Array.prototype.forEach.call(钮, function (s, i) { s.classList.toggle('on', i < n); });
    },
    setCollapse: function (id, open) {
      var r = compRoot(id); if (!r) return;
      var 盒 = r.querySelector('.rt-collapse'); if (!盒) return;
      r.__val = !!open;
      盒.classList.toggle('open', !!open);
    },
    /* 多选下拉 / 日期范围 / 颜色选择器：用代码读写 */
    setMultiSelect: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var arr = Array.isArray(v) ? v.map(function (x) { return String(x); })
        : String(v == null ? '' : v).split(/[,，、\n]/).map(function (s) { return s.trim(); })
          .filter(function (s) { return s !== ''; });
      r.__val = arr;
      var lab = r.querySelector('.rt-select-v');
      if (lab) lab.textContent = arr.length ? arr.join('、') : '请选择';
      var rows = r.querySelectorAll('.rt-multi-item');
      Array.prototype.forEach.call(rows, function (row) {
        var t = row.querySelector('.rt-select-item-t');
        var on = t && arr.indexOf(String(t.textContent)) >= 0;
        row.classList.toggle('on', !!on);
        var c2 = row.querySelector('.rt-multi-box');
        if (c2) c2.textContent = on ? '✓' : '';
      });
    },
    setDateRange: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var ins = r.querySelectorAll('input'); if (!ins.length) return;
      var s = '', e = '';
      if (Array.isArray(v)) { s = String(v[0] == null ? '' : v[0]); e = String(v[1] == null ? '' : v[1]); }
      else {
        var 段 = String(v == null ? '' : v).split(/[~～至,，]/);
        s = String(段[0] == null ? '' : 段[0]).trim();
        e = String(段[1] == null ? '' : 段[1]).trim();
      }
      r.__start = s; r.__end = e;
      r.__val = (s || e) ? (s + '~' + e) : '';
      if (ins[0]) ins[0].value = s;
      if (ins[1]) ins[1].value = e;
    },
    setColorPicker: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var hex = String(v == null ? '' : v).trim();
      if (!hex) return;
      r.__val = hex;
      var sw = r.querySelector('.rt-color-sw');
      if (sw) sw.style.background = hex;
      var tx = r.querySelector('.rt-color-t');
      if (tx) tx.textContent = hex;
      var dots = r.querySelectorAll('.rt-color-dot');
      Array.prototype.forEach.call(dots, function (d) {
        d.classList.toggle('on', String(d.getAttribute('data-c') || '').toLowerCase() === hex.toLowerCase());
      });
    },
    /* 徽章 / 时钟 / 二维码：用代码改值 */
    setBadge: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var t = r.querySelector('.rt-badge-t');
      r.__val = String(v == null ? '' : v);
      if (t) t.textContent = r.__val;
    },
    setClock: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var t = r.querySelector('.rt-clock'); if (!t) return;
      var s = String(v == null ? '' : v);
      if (s) { t.textContent = s; t.__frozen = true; r.__val = s; }   // 设了文字就停走秒
      else { t.__frozen = false; t.textContent = 时钟文字(t.__fmt || 'hm'); r.__val = t.textContent; }
    },
    setQR: function (id, v) {
      var r = compRoot(id); if (!r) return;
      r.__val = String(v == null ? '' : v);
      if (r.__画码) r.__画码();
    },
    /* ---- 新增控件的取值 / 赋值 ---- */
    getValue: function (id) { var r = compRoot(id); return r && r.__val != null ? r.__val : ''; },
    getNumber: function (id) { var r = compRoot(id); var n = Number(r && r.__val); return isFinite(n) ? n : 0; },
    setSelect: function (id, v) {
      var r = compRoot(id); if (!r) return;
      v = String(v == null ? '' : v);
      var lab = r.querySelector('.rt-select-v');
      if (lab) lab.textContent = v;
      r.__val = v;
    },
    /* 替换下拉/单选/多选/标签页的可选项：文字按逗号或换行分隔。
       改完数据后原位重画这一个控件，选项列表/选中态/点击回调一起更新。 */
    setOptions: function (id, text) {
      var r = compRoot(id); if (!r) return;
      var c = r.__c; if (!c) return;
      var arr = (Array.isArray(text) ? text.map(function (x) { return String(x); })
        : String(text == null ? '' : text).split(/[,，、\n]/))
        .map(function (s) { return String(s).trim(); })
        .filter(function (s) { return s !== ''; });
      c.items = arr;
      if (c.type === 'select' || c.type === 'radio') {
        if (arr.indexOf(String(c.value)) < 0) c.value = arr[0] || '';
      } else if (c.type === 'multiSelect') {
        var 已选 = Array.isArray(c.value) ? c.value : String(c.value == null ? '' : c.value).split(/[,，、\n]/);
        c.value = 已选.map(function (x) { return String(x).trim(); })
          .filter(function (x) { return arr.indexOf(x) >= 0; });
      } else if (c.type === 'tabs') {
        var 序 = Number(c.value) || 0;
        if (序 < 0 || 序 >= arr.length) c.value = 0;
      }
      var 新 = renderComp(c);
      if (r.parentNode) r.parentNode.replaceChild(新, r);
    },
    setRadio: function (id, v) {
      var r = compRoot(id); if (!r) return;
      v = String(v == null ? '' : v);
      var rows = r.querySelectorAll('.rt-radio-row'), hit = null;
      Array.prototype.forEach.call(rows, function (row) {
        var dot = row.querySelector('.rt-radio-dot');
        var isHit = (row.textContent || '').trim() === v;
        if (dot) dot.classList.toggle('on', isHit);
        if (isHit) hit = row;
      });
      if (hit) r.__val = v;
    },
    setDate: function (id, v) {
      var r = compRoot(id), i = r && r.querySelector('input'); if (!i) return;
      i.value = String(v || ''); r.__val = i.value;
    },
    /* 通用赋值：按控件当前类型挑对应的 setter（下拉/单选/日期/步进/开关/进度/输入框…） */
    setComponent: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var cls = r.className || '';
      if (cls.indexOf('multiSelect') >= 0) return RT.setMultiSelect(id, v);
      if (cls.indexOf('dateRange') >= 0) return RT.setDateRange(id, v);
      if (cls.indexOf('colorPicker') >= 0) return RT.setColorPicker(id, v);
      if (cls.indexOf('select') >= 0) return RT.setSelect(id, v);
      if (cls.indexOf('radio') >= 0) return RT.setRadio(id, v);
      if (cls.indexOf('date') >= 0 || cls.indexOf('time') >= 0) return RT.setDate(id, v);
      if (cls.indexOf('stepper') >= 0) return RT.setStepper(id, v);
      if (cls.indexOf('switch') >= 0 || cls.indexOf('checkbox') >= 0) return RT.setChecked(id, !!v);
      if (cls.indexOf('slider') >= 0) return RT.setSlider(id, v);
      if (cls.indexOf('progress') >= 0) return RT.setProgress(id, v);
      if (cls.indexOf('ring') >= 0) return RT.setProgress(id, v);
      if (cls.indexOf('tabs') >= 0) return RT.setTabs(id, v);
      if (cls.indexOf('bottomNav') >= 0) return RT.setBottomNav(id, v);
      if (cls.indexOf('rating') >= 0) return RT.setRating(id, v);
      if (cls.indexOf('collapse') >= 0) return RT.setCollapse(id, v);
      if (cls.indexOf('badge') >= 0) return RT.setBadge(id, v);
      if (cls.indexOf('clock') >= 0) return RT.setClock(id, v);
      if (cls.indexOf('qr') >= 0) return RT.setQR(id, v);
      if (cls.indexOf('input') >= 0) return RT.setText(id, v);
      if (cls.indexOf('timer') >= 0 || cls.indexOf('text') >= 0) return RT.setText(id, v);
    },
    setStepper: function (id, v) {
      var r = compRoot(id); if (!r) return;
      var n = Number(v); if (!isFinite(n)) return;
      r.__val = n;
      var btn = r.querySelectorAll('.rt-step-b');
      if (btn[0] && btn[0].click) { /* 只更新显示，不触发事件 */ }
      var vv = r.querySelector('.rt-step-v'); if (vv) vv.textContent = String(n);
    },
    /* ---- 计时器 / 倒计时 ---- */
    startTimer: function (id, seconds, countdown) {
      var t = timers[id]; if (!t) return;
      var left = Math.max(0, Number(seconds) || 0);
      if (t.timer) { clearInterval(t.timer); t.timer = 0; }
      function draw() {
        var s = Math.ceil(left);
        var m = Math.floor(s / 60), ss = s % 60;
        t.el.textContent = (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
      }
      draw();
      t.timer = setInterval(function () {
        left = countdown ? left - 0.1 : left + 0.1;
        if (countdown && left <= 0) { left = 0; draw(); clearInterval(t.timer); t.timer = 0; runHandlers(changeMap[id]); return; }
        draw();
      }, 100);
    },
    stopTimer: function (id) { var t = timers[id]; if (t && t.timer) { clearInterval(t.timer); t.timer = 0; } },
    timerValue: function (id) {
      var t = timers[id];
      if (!t) return 0;
      var m = /(\d+):(\d+)/.exec(t.el.textContent || '');
      return m ? (Number(m[1]) * 60 + Number(m[2])) : 0;
    },
    /* ---- 画布绘图 ---- */
    canvasClear: function (id) {
      var ctx = canvasMap[id], cv = compRoot(id) && compRoot(id).querySelector('canvas');
      if (ctx && cv) ctx.clearRect(0, 0, cv.width, cv.height);
    },
    canvasLine: function (id, x1, y1, x2, y2, color, width) {
      var ctx = canvasMap[id]; if (!ctx) return;
      ctx.beginPath(); ctx.strokeStyle = color || '#000';
      ctx.lineWidth = Math.max(1, Number(width) || 2);
      ctx.moveTo(Number(x1) || 0, Number(y1) || 0); ctx.lineTo(Number(x2) || 0, Number(y2) || 0); ctx.stroke();
    },
    canvasRect: function (id, x, y, w, h, color, fill) {
      var ctx = canvasMap[id]; if (!ctx) return;
      if (fill) { ctx.fillStyle = color || '#000'; ctx.fillRect(Number(x) || 0, Number(y) || 0, Number(w) || 0, Number(h) || 0); }
      else { ctx.strokeStyle = color || '#000'; ctx.strokeRect(Number(x) || 0, Number(y) || 0, Number(w) || 0, Number(h) || 0); }
    },
    canvasCircle: function (id, x, y, r, color, fill) {
      var ctx = canvasMap[id]; if (!ctx) return;
      ctx.beginPath(); ctx.arc(Number(x) || 0, Number(y) || 0, Math.max(0, Number(r) || 0), 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = color || '#000'; ctx.fill(); }
      else { ctx.strokeStyle = color || '#000'; ctx.stroke(); }
    },
    canvasText: function (id, x, y, text, color, size) {
      var ctx = canvasMap[id]; if (!ctx) return;
      ctx.fillStyle = color || '#000';
      ctx.font = Math.max(8, Number(size) || 16) + 'px sans-serif';
      ctx.fillText(String(text == null ? '' : text), Number(x) || 0, Number(y) || 0);
    },
    /* 视频 / 音频：播放、暂停、切换地址 */
    videoPlay: function (id) { var m = compRootMedia(id); if (m && m.play) try { m.play(); } catch (e) {} },
    videoPause: function (id) { var m = compRootMedia(id); if (m && m.pause) try { m.pause(); } catch (e) {} },
    videoSeek: function (id, sec) { var m = compRootMedia(id); if (!m) return; var t = Number(sec); if (isFinite(t)) try { m.currentTime = Math.max(0, t); } catch (e) {} },
    videoSrc: function (id, url) { var r = compRoot(id); if (!r || !r.__media) return; r.__media.src = resolveMedia(String(url || '')); if (r.__media.play) { try { r.__media.load(); r.__media.play(); } catch (e) {} } },
    audioPlay: function (id) { var m = compRootMedia(id); if (m && m.play) try { m.play(); } catch (e) {} },
    audioPause: function (id) { var m = compRootMedia(id); if (m && m.pause) try { m.pause(); } catch (e) {} },
    audioSeek: function (id, sec) { var m = compRootMedia(id); if (!m) return; var t = Number(sec); if (isFinite(t)) try { m.currentTime = Math.max(0, t); } catch (e) {} },
    audioSrc: function (id, url) { var r = compRoot(id); if (!r || !r.__media) return; r.__media.src = resolveMedia(String(url || '')); if (r.__media.play) { try { r.__media.load(); r.__media.play(); } catch (e) {} } },
    /* 网页：加载网址 */
    webUrl: function (id, url) { var r = compRoot(id); if (!r || !r.__media) return; r.__media.src = String(url || ''); },
    /* 背景色 / 文字颜色：作用到组件的可见元素 */
    setBg: function (id, color) {
      var r = compRoot(id); if (!r || !color) return;
      var n = r.querySelector('.matbtn,input,.list,.imgph,.sw.on,.prog-fill,.rng') || r;
      if (n.classList && n.classList.contains('rng')) { n.style.accentColor = color; return; }
      n.style.background = color;
    },
    setFg: function (id, color) {
      var r = compRoot(id); if (!r || !color) return;
      var n = r.querySelector('.matbtn,input,.list,.v-text,.ck.on') || r;
      n.style.color = color;
    },
    /* ===== 个性化外观（运行时动态切换，与设计页属性面板选项一致） ===== */
    // 按钮风格：实心(默认)/磨砂玻璃/描边/幽灵/渐变/胶囊/立体阴影
    setBtnStyle: function (id, style) {
      var r = compRoot(id); if (!r) return;
      var btn = r.querySelector('.matbtn'); if (!btn) return;
      stripPrefixed(btn, 'btn-');
      btn.style.removeProperty('--g1'); btn.style.removeProperty('--g2');
      if (btn.dataset.autoColor) { btn.style.color = ''; delete btn.dataset.autoColor; }
      var st = String(style || '');
      if (!st) return;
      btn.classList.add('btn-' + st);
      if ((st === 'outline' || st === 'ghost') && !btn.style.color) { btn.style.color = '#6750a4'; btn.dataset.autoColor = '1'; }
      if (st === 'gradient') {
        var base = (btn.style.background && /^#/.test(btn.style.background)) ? btn.style.background : '#6750a4';
        btn.style.setProperty('--g1', shadeHex(base, 0.14));
        btn.style.setProperty('--g2', shadeHex(base, -0.24));
      }
    },
    // 容器外观：普通/磨砂玻璃/描边/立体阴影（输入框、列表、图片、视频、音频、网页）
    setSkin: function (id, skin) {
      var r = compRoot(id); if (!r) return;
      var t = r.querySelector('input,.list,.imgph,img') || r.__media || r;
      stripPrefixed(t, 'skin-');
      if (skin) t.classList.add('skin-' + skin);
    },
    // 文字特效：普通/描边空心/阴影/霓虹/渐变/浮雕（作用于控件内真实文本节点）
    setArtStyle: function (id, art) {
      var r = compRoot(id); if (!r) return;
      var t = r.querySelector('.v-text') || r;
      stripPrefixed(t, 'art-');
      if (t.dataset.neonAuto) { t.style.color = ''; delete t.dataset.neonAuto; }
      var a = String(art || '');
      if (!a) return;
      t.classList.add('art-' + a);
      if (a === 'neon' && !t.style.color) { t.style.color = '#00bcd4'; t.dataset.neonAuto = '1'; }
    },
    /* ===== 云表格（SeaTable），每个云表格由编辑器分配 id ===== */
    // 登记一个云表格（代码生成时自动注入，同步执行）
    cloudRegister: function (id, cfg) {
      if (!id || !cfg) return;
      var provider = cfg.provider || 'seatable-cn';
      var srv = String(cfg.server || '').trim().replace(/\/+$/, '');
      if (provider !== 'seatable-custom' || !srv) srv = cloudDefaultServer(provider);
      cloudPool[id] = newCloudSlot();
      cloudPool[id].cfg = {
        provider: provider, server: srv,
        uuid: String(cfg.uuid == null ? '' : cfg.uuid).trim(),
        token: String(cfg.token == null ? '' : cfg.token).trim(),
        name: cfg.name || ''
      };
    },
    cloudTables: async function (cid) {
      var s = cloudSlot(cid);
      var d = await cloudGateway(s, 'GET', '/api/v2/dtables/{uuid}' + '/metadata/', null);
      return (d && d.metadata && d.metadata.tables || []).map(function (t) { return t.name; });
    },
    cloudRows: async function (cid, table) {
      var s = cloudSlot(cid), name = sqlEscape(table).replace(/`/g, '');
      var d = await cloudGateway(s, 'POST', '/api/v2/dtables/{uuid}' + '/sql/',
        { sql: 'SELECT * FROM `' + name + '`', convert_keys: true });
      return (d && d.results) || [];
    },
    cloudSql: async function (cid, sql) {
      var s = cloudSlot(cid);
      var d = await cloudGateway(s, 'POST', '/api/v2/dtables/{uuid}' + '/sql/',
        { sql: String(sql == null ? '' : sql), convert_keys: true });
      return (d && d.results) || [];
    },
    cloudRowCount: async function (cid, table) {
      var s = cloudSlot(cid), name = sqlEscape(table).replace(/`/g, '');
      var d = await cloudGateway(s, 'POST', '/api/v2/dtables/{uuid}' + '/sql/',
        { sql: 'SELECT COUNT(*) AS n FROM `' + name + '`', convert_keys: true });
      var rows = (d && d.results) || [];
      return rows[0] ? Number(rows[0].n || 0) : 0;
    },
    cloudRowById: async function (cid, table, rowId) {
      var s = cloudSlot(cid), id = String(rowId == null ? '' : rowId);
      if (!id) throw new Error('取一行需要填写行 Id');
      var path = '/api/v2/dtables/{uuid}' + '/rows/?table_name=' + encodeURIComponent(String(table))
        + '&start=0&limit=1000';
      var d = await cloudGateway(s, 'GET', path, null);
      var raw = ((d && d.rows) || []).filter(function (r) { return r._id === id; })[0];
      if (!raw) return null;
      var colMap = await cloudColumnMap(s, String(table));
      var row = {};
      Object.keys(raw).forEach(function (k) { row[colMap[k] || k] = raw[k]; });
      return row;
    },
    cloudAddRow: async function (cid, table, rowOrJson) {
      var s = cloudSlot(cid);
      var row = rowOrJson;
      if (typeof row === 'string') { try { row = JSON.parse(row); } catch (e) { throw new Error('新增一行的数据格式不正确：' + e.message); } }
      if (!row || typeof row !== 'object') throw new Error('新增一行需要至少一个字段');
      var d = await cloudGateway(s, 'POST', '/api/v2/dtables/{uuid}' + '/rows/',
        { table_name: String(table), rows: [row] });
      var ids = (d && d.row_ids) || [];
      return ids[0] && ids[0]._id ? ids[0]._id : ((d && d.inserted_row_count) || 0);
    },
    cloudUpdateRow: async function (cid, table, rowId, rowOrJson) {
      var s = cloudSlot(cid), id = String(rowId == null ? '' : rowId);
      if (!id) throw new Error('更新一行需要填写行 Id');
      var row = rowOrJson;
      if (typeof row === 'string') { try { row = JSON.parse(row); } catch (e) { throw new Error('更新内容格式不正确：' + e.message); } }
      if (!row || typeof row !== 'object') throw new Error('更新一行需要至少一个字段');
      var d = await cloudGateway(s, 'PUT', '/api/v2/dtables/{uuid}' + '/rows/',
        { table_name: String(table), updates: [{ row_id: id, row: row }] });
      return !!(d && d.success);
    },
    cloudDeleteRow: async function (cid, table, rowId) {
      var s = cloudSlot(cid), id = String(rowId == null ? '' : rowId);
      if (!id) throw new Error('删除一行需要填写行 Id');
      var d = await cloudGateway(s, 'DELETE', '/api/v2/dtables/{uuid}' + '/rows/',
        { table_name: String(table), row_ids: [id] });
      return Number((d && d.deleted_rows) || 0);
    },
    // 旧版（v1.9.6）设置云列表代码：登记到默认连接
    cloudSetup: async function (provider, server, uuid, token) {
      var srv = String(server || '').trim().replace(/\/+$/, '');
      if (provider === 'seatable-custom' && srv) { /* 使用自定义服务器 */ }
      else srv = cloudDefaultServer(provider);
      cloudLegacy.cfg = {
        provider: provider || 'seatable-cn', server: srv,
        uuid: String(uuid == null ? '' : uuid).trim(),
        token: String(token == null ? '' : token).trim()
      };
      cloudLegacy.jwt = null; cloudLegacy.uuid = null; cloudLegacy.gateway = null; cloudLegacy.meta = {};
      if (!cloudLegacy.cfg.uuid || !cloudLegacy.cfg.token) throw new Error('云列表缺少 UUID 或 API 密钥');
      await cloudAuth(cloudLegacy, true);
    },
    /* ---------------- 只补 Blockly 自带分类里没有的 3 个数据代码 ----------------
       列表去重 / 解析 JSON / 生成 JSON；纯数据计算，不碰界面，
       试运行和导出后结果一致。参数兜底（空槽 → 空列表 / 空文字），漏填也不报错。 */
    /** 去重：保留第一次出现的顺序 */
    listUnique: function (v) {
      var seen = Object.create(null), out = [];
      rtList(v).forEach(function (x) {
        var k = (typeof x) + '|' + rtText(x);
        if (seen[k]) return;
        seen[k] = 1; out.push(x);
      });
      return out;
    },
    /** 解析 JSON 文字：格式不对返回 null（不抛错，免得整段代码停住） */
    jsonParse: function (v) {
      if (typeof v !== 'string') return v;
      var s = v.trim(); if (!s) return v;
      try { return JSON.parse(s); } catch (e) { return null; }
    },
    /** 生成 JSON 文字 */
    jsonStringify: function (v) {
      try {
        var s = JSON.stringify(v);
        return (s === undefined || s === null) ? '' : s;
      } catch (e) { return ''; }
    },
    // 从一行数据（对象或 JSON 字符串）里取某字段的值
    jsonGet: function (obj, key) {
      if (obj == null) return '';
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return ''; } }
      if (typeof obj !== 'object') return '';
      return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : '';
    }
  };

  /* 出错定位：生成代码里每段开头会调 RT.__seg(N)，这里记下"当前跑的是第几段"；
     再把每个 RT 动作包一层，记下"最后调用的是哪个动作"（如 setSelect / jump），
     两者一起进诊断日志，编辑器里的 AI 就能直接说"第几段的哪个动作报错了"。 */
  RT.__seg = function (n) { try { curSeg = Number(n); } catch (e) {} return curSeg; };
  RT.__curApi = '';
  /* 网络请求（代码块"读取网址/提交到网址"用）：GET 返回文字，POST 返回服务器回的文字 */
  RT.httpGet = function (url) { return httpRequest('GET', url, null); };
  RT.httpPost = function (url, body) { return httpRequest('POST', url, body); };
  try { window.RT = RT; } catch (e) {}   // 方便诊断/自动化测试直接调运行时 API
  (function 包一层动作记录() {
    Object.keys(RT).forEach(function (k) {
      if (k === '__seg' || k === '__curApi') return;
      var f = RT[k];
      if (typeof f !== 'function') return;
      RT[k] = function () {
        RT.__curApi = k;
        return f.apply(RT, arguments);
      };
    });
  })();

  /* 把运行时的报错也丢进编辑器的诊断日志（同一个 localStorage），这样"试运行出错"切回编辑器就能看到。
     除了错误本身，还记**哪一页 / 第几段 / 哪个动作**出错 —— AI 才能直接定位到那一段去改。 */
  var curScreenRef = null;      // 当前正在运行的页面（出错时报给编辑器）
  var curSeg = null;            // 当前正在执行的第几段（生成代码每段开头会调 RT.__seg）
function diagPush(kind, msg, extra) {
  try {
    var KEY = '__bb_diag_v1';
    var a = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(a)) a = [];
    var rec = { t: new Date().toISOString().slice(11, 23), k: String(kind || ''), m: String(msg == null ? '' : msg).slice(0, 600) };
    var sc = curScreenRef;
    var x = { screen: (extra && extra.screen) || (sc && sc.id) || '', title: (extra && extra.title) || (sc && sc.title) || '',
              seg: (extra && extra.seg != null) ? extra.seg : curSeg,
              api: (extra && extra.api) || ((typeof RT !== 'undefined' && RT && RT.__curApi) || '') };
    if (x.screen || x.seg != null || x.api) rec.x = x;
    a.push(rec);
    if (a.length > 200) a = a.slice(-200);
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch (e) {}
}
try { window.addEventListener('error', function (ev) { diagPush('运行时错误', (ev && ev.message) || 'error'); }); } catch (e) {}
try { window.addEventListener('unhandledrejection', function (ev) { var r = ev && ev.reason; diagPush('运行时Promise', (r && (r.message || r)) || 'unhandled'); }); } catch (e) {}

function runCode(sc) {
    curScreenRef = sc || null; curSeg = null;
    try { new Function('RT', sc.code || '')(RT); }
    catch (e) {
      diagPush('代码执行失败', (e && e.message) || e, { seg: curSeg, api: RT.__curApi });
      console.error('逻辑执行错误', e);
      showToast('该页面逻辑有误：' + e.message + (curSeg == null ? '' : '（第 ' + curSeg + ' 段）'));
    }
    // 收集本页要触发的启动事件：首次启动仅本进程第一次打开该页时触发（先于每次启动）
    var isFirst = !firstFired[sc.id];
    if (isFirst) firstFired[sc.id] = true;
    var queue = isFirst ? firstStartHandlers.concat(startHandlers) : startHandlers.slice();
    var gen = renderGen;
    // 关键：等当前渲染/跳转调用栈完全结束后（宏任务）再触发启动事件。
    // 否则“页面启动就跳转、新页面启动又跳回”会在同一个调用栈里递归，直接爆栈。
    setTimeout(function () {
      if (gen !== renderGen) return;          // 已被后续跳转取代，本页启动事件不再补跑
      var times = (autoBurst[sc.id] || 0) + 1;
      autoBurst[sc.id] = times;
      if (times >= 3) {
        // 同一页面的“当页面启动时”在一段自动跳转中第 3 次触发=启动事件驱动的死循环（含等待后互跳的慢循环）：
        // 静默刹车，不再执行“每次启动”代码（不再弹提示框）；“首次启动”代码只会执行一次，不可能构成死循环，照常执行。
        queue = isFirst ? firstStartHandlers.slice() : [];
      }
      // 串行 await：整个启动事件（含“等待 N 秒再跳转”的延续）都算自动导航流程，
      // 期间跳转替换返回栈、循环计数不清零；前一个事件跳走后本页后续事件不再执行。
      (async function runQueue() {
        navKind = 'auto';
        for (var i = 0; i < queue.length; i++) {
          if (gen !== renderGen) return;      // 队列中前一个代码已跳转到别的页面，本页后续代码不再执行
          await safeAsync(queue[i]);
        }
      })();
    }, 0);
  }
  function safe(fn) {
    try {
      var r = fn();
      if (r && typeof r.then === 'function') r.catch(function (e) { console.error(e); showToast('动作出错：' + e.message); });
    } catch (e) { console.error(e); showToast('动作出错：' + e.message); }
  }
  // 与 safe 相同，但等待事件执行完（含 await），供启动队列串行调度使用
  function safeAsync(fn) {
    return new Promise(function (resolve) {
      try {
        var r = fn();
        if (r && typeof r.then === 'function') {
          r.then(function () { resolve(); }, function (e) { console.error(e); showToast('动作出错：' + e.message); resolve(); });
        } else resolve();
      } catch (e) { console.error(e); showToast('动作出错：' + e.message); resolve(); }
    });
  }

  var toastTimer = null;
  function showToast(msg, secs) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    var n = Number(secs);
    var ms = (isFinite(n) && n > 0) ? Math.round(n * 1000) : 1800;   // 留空/非法用默认 1.8 秒
    ms = Math.max(400, Math.min(ms, 15000));                         // 钳制在 0.4~15 秒，避免误填
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms);
  }

  /* 系统返回键：能出栈就出栈；运行时页面不响应返回/侧滑返回；否则交给原生退出 */
  window.__rtSystemBack = function () {
    if (goBack()) return true;
    if (isPreview) {
      /* 2026-10-28 用户要求：试运行期间**关掉侧滑关闭运行**。
         侧滑返回在系统里就是「返回」，所以这里直接吃掉这次返回，页面不动。
         结束方式统一成通知栏卡片里的「终止运行」（原生回调 __nativeStopRun）。
         电脑/浏览器预览没有通知卡片，若也吞掉就再也退不出去了 —— 那种情况保留返回。 */
      var 有通知卡片 = false;
      try { 有通知卡片 = !!(window.Native && Native.startRunNotice); } catch (e) {}
      if (有通知卡片) return true;
      RT.restoreDisplay(); history.back(); return true;
    }
    return false;
  };
  /* 通知栏卡片里的「终止运行」→ 收掉卡片、恢复屏幕显示设置、回到编辑器 */
  window.__nativeStopRun = function () {
    try { RT.restoreDisplay(); } catch (e) {}
    try { if (window.Native && Native.stopRunNotice) Native.stopRunNotice(); } catch (e) {}
    // 留个时间戳：真机排查"到底有没有收到终止"时，回编辑器能看到
    try { sessionStorage.setItem('__bb_stop_run_at', String(Date.now())); } catch (e) {}
    try { history.back(); } catch (e) {}
    return true;
  };

  /* 无论从哪条路径离开运行页（系统返回、侧滑、history），都恢复系统亮度/常亮并收掉通知卡片，
     避免运行时设置的屏幕亮度残留到编辑器。原生侧 post 到主线程，页面销毁不影响执行。 */
  window.addEventListener('pagehide', function () {
    try { if (window.Native && Native.restoreDisplay) Native.restoreDisplay(); } catch (e) {}
    try { if (window.Native && Native.stopRunNotice) Native.stopRunNotice(); } catch (e) {}
  });

  /* 用户要求：**去掉** App 自己那套「从左边缘往右滑就退出运行」。
     这里整段删掉，不是改成"拦下来不动" —— 一个触摸监听都不留，
     作品自己的滑屏代码（swipeHandlers 那套）才能照常收到左滑/右滑，
     系统返回手势和返回键也保持可用（我们没有 capture/ preventDefault 任何事件）。 */

  loadProject();
})();
