/* FAST 编辑器 v1.5 */
/* ============================================================================
   目录索引 —— 本文件约 4000 行，全部包在下面这一个闭包里（内部变量都是私有的，
   所以不能拆成多个文件）。改动前先在这里定位：用编辑器搜索右侧的锚点函数名即可跳过去。

   基础与工具        el / clampNum / validN / fmtTime / clone / catItemName
   缩放记忆          globalBlockScale / savedBlockScale / recordZoom
   主题与配色        getTheme / saveTheme / applyTheme / hex2hsl / hslToHex
                     / pickColor / bindColorPicker / confirmDialog
   Blockly 弹窗适配  setupBlocklyDialogs / bindBlocklyDialogUi / bdFinish
   云表格            cloudProviderLabel / cloudDefaultServer / editorCloudHttp
                     / openCloudCreate / renderCloudManage / bindCloudUi / refreshCloudUi
   作品存储与首页    blankProject / loadStore / persist / autosave / showHome / renderHome
                     / createItem / confirmCreate / openItem / duplicateItem / deleteItem
   帮助页            openHelp / buildHelp / renderHelpCat
   页面与控件        renderTabs / renderCompList / addComponent / delComp / moveComp
                     / addScreen / deleteScreen / switchScreen / curScreen / genId
   属性面板与表单    ppField / txtInput / numInput / areaInput / colorInput / segInput
                     / selectInput / fillPropFields / renderPropPanel / pickImage
   >> 代码自定义渲染 registerFastRenderer   ← 全文件最大的一块，代码外形/描边都在这里
   手势与飞出菜单    setupCustomPinch / bindBlockLongPress / armGhostGuard
                     / patchFlyoutGuard / reflowFlyoutSoon / installClickCatcher
   如果/分支编辑器   bindIfBranchEditor / migrateEventHatXml
   工作区与分类栏    initWorkspace / buildCategoryRail / guardToolboxScroll / bindDeleteOnDrag
   保存与代码生成    saveCurrentWs / loadScreenToWs / genCode / buildOutput
   布局编辑器        openLayout / renderLayout / renderLayStage / renderLaySheet
                     / bindLitemDrag / openSheet / bindLayoutChrome
   通用 UI 小件      snack / modal / modalExtra / closeMenus / toggleMenu / buildSettings
   试运行与导出      getRunMode / setRunMode / applyRunMode / onRun / openExport / doExport
   启动入口          init
   ============================================================================ */
(function () {
  'use strict';
  var B = window.Blockly;
  var $ = function (id) { return document.getElementById(id); };
  function el(t, cls, txt) { var e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  /**
   * 切页过渡：给刚显示的页面挂一个 200ms 的淡入（前进从下往上 6px、返回从上往下 6px）。
   *
   * 为什么用 CSS animation 而不是 transition：animation 播完就结束，元素自己回到正常样式，
   * 不会留下内联 transform / 强制回流，也不参与布局计算 —— 上次那版就是栽在"给面板持续挂 transform"上。
   * 这里只挂给 5 个整页视图（首页/编辑器/账号/帮助/进阶技巧），**不碰任何画布**。
   */
  function 切页(node, 方向) {
    if (!node) return;
    node.classList.remove('page-fwd', 'page-back');
    void node.offsetWidth;                       // 强制回流，保证连续切页也能重播
    node.classList.add(方向 === 'back' ? 'page-back' : 'page-fwd');
    var 清 = function () {
      node.classList.remove('page-fwd', 'page-back');
      node.removeEventListener('animationend', 清);
    };
    node.addEventListener('animationend', 清);
    setTimeout(清, 400);                          // 兜底：动画没触发也要清干净
  }
  /** 列表项错峰上浮：给子项排个序号，CSS 用 --i × --stagger 延后出现。
      纯 CSS animation，播完即止，不留内联样式、不动布局属性 —— 挂了最多是"没动画"，不会卡交互。 */
  function 错峰(node, 序号) {
    if (!node) return node;
    node.classList.add('item-in');
    node.style.setProperty('--i', String(Math.min(序号 | 0, 7)));   // 最多延后 8 档，长列表不会等到天荒地老
    return node;
  }

  /**
   * 关弹窗：先播一遍反向动画，再挂 hidden（以前是"啪"地消失，进出不对称）。
   * 兜底做得死一点：animationend + 定时器双保险，**任何情况下都一定会 hidden**，
   * 绝不让弹窗卡在半路（上次改动画翻车就是栽在"没有兜底"上）。
   */
  function 关遮罩(mask) {
    if (!mask || mask.classList.contains('hidden')) return;
    mask.classList.add('closing');
    var 收尾 = function () {
      mask.classList.remove('closing');
      mask.classList.add('hidden');
      mask.removeEventListener('animationend', 收尾);
    };
    mask.addEventListener('animationend', 收尾);
    setTimeout(收尾, 260);
  }

  /**
   * 分段选择器下面那块滑动的"药丸"：只动 transform/宽高过渡，**不碰任何画布**。
   * 容器还没显示（宽高为 0）时先不同步，等显示后由调用方再同步一次。
   */
  var 分段药丸表 = [];
  /** 选中滑块（"药丸"）通用工厂。
      两处用得上，逻辑一模一样，所以只留一份，免得改了一处忘了另一处：
        · 分段选择器（设计/代码、个人信息/社区）→ .seg-pill，容器 .seg.viewseg / .acct-rail
        · 积木栏分类                   → .bb-cat-pill，容器 .bb-panel
      只动 transform/宽高（合成层友好），不碰画布，不可能影响积木/代码内容。 */
  function 建滑块(容器, 按钮们, 类名) {
    if (!容器 || !按钮们 || !按钮们.length) return null;
    var 药丸 = 容器.querySelector('.' + 类名);
    if (!药丸) { 药丸 = document.createElement('div'); 药丸.className = 类名; 容器.insertBefore(药丸, 容器.firstChild); }
    容器.classList.add('has-pill');
    /* 上一帧滑块是不是已经落在某一条上了 —— 决定这次是"原地淡入"还是"滑过去"。
       没有落点（刚进来 / 刚取消过）时绝不允许滑：那样它会从上次的位置、甚至 0,0 那个角落
       一路划过来（用户 2026-09-26 报的"未选中时点击会凭空划过来，动画不自然"）。
       每次 建滑块 都是新的闭包，所以重建积木栏后自然归零。 */
    var 上次在某一条上 = false;
    /** 量出滑块该待的位置（**内容坐标**）。
        ⚠️ 这里必须把容器的滚动量加回去（2026-09-26 用户报的"把分类栏拉到下面就看不到选中提示了"）：
        绝对定位子元素的包含块是容器的 **padding box**，而滚动容器的 padding box 是**跟着内容滚**的。
        所以 `b.top - a.top`（两个 getBoundingClientRect 相减）得到的是"距可视区顶"的距离，
        滚动之后就比真实内容偏移小了一个 scrollTop —— 滑块会整体上移，滚到底就整块跑出屏幕，
        看起来就像"选中提示消失了"。
        加上 scrollTop/scrollLeft 就还原成内容坐标：滑块于是钉在那一条上，跟着条目一起滚。 */
    function 位置() {
      var 中 = null;
      for (var i = 0; i < 按钮们.length; i++) if (按钮们[i] && 按钮们[i].classList.contains('on')) { 中 = 按钮们[i]; break; }
      if (!中) return null;
      var a = 容器.getBoundingClientRect(), b = 中.getBoundingClientRect();
      // 容器被隐藏时（回首页、切页面、积木栏还没展开）量到的是 0
      if (!a.width || !b.width) return null;
      return {
        左: b.left - a.left + (容器.scrollLeft || 0),
        上: b.top - a.top + (容器.scrollTop || 0),
        宽: b.width, 高: b.height
      };
    }
    function 同步() {
      // 取消选中（一个都没选）：**立刻消失**，不留任何过渡。
      // 走过的弯路：最早是把宽度缩到 0（从右往左收），用户说「还有一层，然后消失」；
      // 后来改成 140ms 淡出，用户第二次截图说"取消瞬间还是有一层灰的"。
      // 结论就是：取消选中应该是**瞬时的**，不需要动画。这里临时关掉过渡再写 opacity。
      var p = 位置();
      if (!p) {
        var 有选中 = false;
        for (var i = 0; i < 按钮们.length; i++) if (按钮们[i] && 按钮们[i].classList.contains('on')) { 有选中 = true; break; }
        if (有选中) {
          // 有选中项但量不到尺寸（容器被隐藏 / 还没排版）→ 记一笔"位置脏了"，
          // 等下次可见时先瞬间归位再正常滑动。
          // 不能直接返回：否则滑块会留在上一次的位置，用户看到的是
          // "页签/滑块在代码、内容却是设计页"（真机报过，2026-09-25）。
          药丸.__脏 = true;
          return;
        }
        药丸.style.transition = 'none';
        药丸.style.opacity = '0';
        void 药丸.offsetWidth;            // 强制回流，确保这一帧就生效（不给浏览器合并的机会）
        药丸.style.transition = '';
        上次在某一条上 = false;            // 记一笔：现在已经没有"落点"了
        return;
      }
      /* 三种运动，别混：
           ① 之前**没有**落点（刚进来 / 刚取消过 / 位置不可知）→ **原地淡入**，不许滑。
              否则滑块会从上次的位置（甚至 0,0 那个角落）一路划过来 ——
              用户 2026-09-26 报的"未选中时点击会凭空划过来"就是这个。
           ② 之前**已经有**落点（从 A 换到 B）→ 滑过去，这是最好看的那一下。
           ③ 一个都没选 → 上面那条，立刻消失。 */
      var 直接出现 = !上次在某一条上 || 药丸.__脏;
      var 变换 = 'translate3d(' + p.左 + 'px,' + p.上 + 'px,0)';
      if (直接出现) {
        // 先"无过渡"地把几何写到位并置透明，强制回流后再淡入 —— 位置一次到位，只有透明度在动。
        药丸.style.transition = 'none';
        药丸.style.width = p.宽 + 'px';
        药丸.style.height = p.高 + 'px';
        药丸.style.transform = 变换;
        药丸.style.opacity = '0';
        void 药丸.offsetWidth;
        药丸.style.transition = '';
        药丸.style.opacity = '1';
      } else {
        药丸.style.width = p.宽 + 'px';
        药丸.style.height = p.高 + 'px';
        药丸.style.transform = 变换;
        药丸.style.opacity = '1';
      }
      药丸.__脏 = false;
      上次在某一条上 = true;
    }
    药丸.__sync = 同步;
    // 容器可能被整块重建（切回代码页会重搭积木栏）：旧药丸一脱离文档就清掉，
    // 否则这张表越攒越大，同步时还会对着一堆已经不在页面上的节点量尺寸。
    for (var k = 分段药丸表.length - 1; k >= 0; k--) {
      if (!分段药丸表[k].isConnected) 分段药丸表.splice(k, 1);
    }
    分段药丸表.push(药丸);
    同步();
    return 药丸;
  }
  /** 积木栏分类栏的选中滑块 */
  function 装分类滑块(容器, 按钮们) { return 建滑块(容器, 按钮们, 'bb-cat-pill'); }
  /** 分段选择器的选中滑块 */
  function 装分段药丸(容器, 按钮) { return 建滑块(容器, 按钮, 'seg-pill'); }
  /* ---- 轨道条目的"按下态"统一在这里管，**不用 CSS 的 `:active`** ----
     为什么（2026-09-26 用户截图报的"取消选中后还留一层灰"）：
       安卓 WebView 上 `:active` 经常"粘住"不清 —— 点分类取消选中后，那一条上会留一层灰底
       一直不下去。实测截图像素取色 = **#EAE9EE**，正好是 `--c-high`；
       而选中滑块是 `--secondary-c` = **#E7DDF8**（淡紫）—— 两个不是一个东西，
       所以别再往滑块/动画那边找原因了。
     做法：委托 pointerdown 给命中项加 `.按住`，pointerup / pointercancel 统一清掉。
     覆盖所有"有选中滑块"的轨道：积木栏分类（.bb-cat）和账号页窄列表（.acct-item）。 */
  (function () {
    function 清按住() {
      var a = document.querySelectorAll('.按住');
      for (var i = 0; i < a.length; i++) a[i].classList.remove('按住');
    }
    document.addEventListener('pointerdown', function (e) {
      var t = e.target;
      var b = (t && t.closest) ? t.closest('.bb-cat, .acct-item') : null;
      if (b) { 清按住(); b.classList.add('按住'); }
    }, true);
    document.addEventListener('pointerup', 清按住, true);
    document.addEventListener('pointercancel', 清按住, true);
    window.addEventListener('blur', 清按住);
  })();
  function 同步分段药丸() {
    for (var i = 0; i < 分段药丸表.length; i++) { try { 分段药丸表[i].__sync(); } catch (e) {} }
  }


  var ICON_EYE_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  var ICON_EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';

  /* 控件元数据（名称/图标/说明）统一来自 comp-spec.js —— 加新控件只改那一张表 */
  var TYPE_META = (function () {
    var m = {};
    Object.keys(FAST_COMPONENTS).forEach(function (k) {
      var s = FAST_COMPONENTS[k];
      m[k] = { label: s.label, ico: s.ico, desc: s.desc };
    });
    return m;
  })();
  var STORE_KEY = '__bb_projects_v2';
  var LEGACY_KEY = '__editorAutosave_v1';
  var OPEN_KEY = '__bb_open_id'; // 正在编辑的工程，用于从运行预览返回时自动恢复

  var state = { itemId: null, project: null, curScreenId: null, selectedCompId: null, ws: null, wsInited: false, view: 'design', inLayout: false, newOrient: 'portrait', runMode: 'start',
    catMode: 'general',  // 代码分类栏上次所在分组：'general' | 'widget'
    catSel: null };      // 代码分类栏上次选中的分类名（回到代码页时恢复）
  var loadingWs = false; // 程序化装载代码时抑制变更监听，避免误存半成品
  var DEFAULT_BLOCK_SCALE = 0.68; // 代码默认缩放（原 0.85 偏大，调小）
  var ZOOM_GLOBAL_KEY = '__bb_block_zoom_v1'; // 跨所有 App 记住代码缩放
  function globalBlockScale() {
    try { var g = parseFloat(localStorage.getItem(ZOOM_GLOBAL_KEY)); if (isFinite(g) && g >= 0.35 && g <= 2.0) return g; } catch (e) {}
    return null;
  }
  function savedBlockScale() {
    var v = state.project && state.project.blockZoom;           // 本 App 自己调过则优先
    if (typeof v === 'number' && v >= 0.35 && v <= 2.0) return v;
    var g = globalBlockScale();                                  // 新建 App 也沿用全局缩放
    return g != null ? g : DEFAULT_BLOCK_SCALE;
  }
  var zoomPersistTimer = null;
  // 记录当前代码缩放并防抖落盘（zoomCenter/滚轮/双指不一定触发 viewport 事件，故多触发点兜底）
  function recordZoom(immediate) {
    if (!state.wsInited || !state.ws || !state.project) return;
    var sc = state.ws.getScale();
    if (isFinite(sc) && sc >= 0.35 && sc <= 2.0) {
      state.project.blockZoom = sc;
      try { localStorage.setItem(ZOOM_GLOBAL_KEY, String(sc)); } catch (e) {} // 全局记忆，新建 App 不再恢复默认
    }
    clearTimeout(zoomPersistTimer);
    if (immediate) { try { persist(); } catch (e) {} }
    else zoomPersistTimer = setTimeout(function () { try { persist(); } catch (e) {} }, 300);
  }

  /* ---------------- Material 3 主题引擎（主题色 + 明暗，近似 M3 tonal palette） ---------------- */
  var THEME_KEY = '__bb_theme_v1';
  var SEEDS = [['#6750A4', '紫'], ['#0B57D0', '蓝'], ['#00696D', '青'], ['#386A20', '绿'],
    ['#9C4100', '橙'], ['#984061', '玫'], ['#B3261E', '红'], ['#7A5900', '金'],
    ['#4F378B', '深紫'], ['#006A6A', '蓝绿'], ['#1D1B20', '墨'], ['#5C5419', '橄榄']];
  function hex2hsl(hex) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, hu = 0, s = 0;
    if (mx !== mn) { var d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) hu = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) hu = (b - r) / d + 2; else hu = (r - g) / d + 4; hu *= 60; }
    return [hu, s * 100, l * 100];
  }
  function hsl(h, s, l) { l = Math.max(0, Math.min(100, l)); return 'hsl(' + Math.round(h) + ' ' + Math.round(s) + '% ' + Math.round(l) + '%)'; }
  function tone(H, S, t) { return hsl(H, S * (1 - Math.abs(t - 50) / 50 * .45), t); } // 两端降彩度
  /** 只旋转色相、保留原色的彩度与明度。 */
  function 换色(hex, 度) { var c = hex2hsl(hex); return hsl(((c[0] + 度) % 360 + 360) % 360, c[1], c[2]); }
  /* ---- M3 基线色：容器色（-c 系列）按"色相旋转基线"生成，而不是用 tone() 硬算 ----
     为什么要单开一条路（2026-09-26 用户报「选中底色不符合 M3 风格」的根因）：
       tone() 走的是 HSL，而 HSL 的饱和度在**浅色端撑不起 M3 需要的色度** ——
       tone(H, S, 90) 算出来的是「灰紫」#E3E1EA，可 M3 基线 secondary-container 是
       #E8DEF8（明显偏紫）。所以全软件所有"选中底色 / 浅色药丸"都发灰，
       代码栏新加的滑块最显眼，用户一眼就看出来了。
     做法：拿 M3 官方基线色（就是 CSS 里那份默认值）当模板，只把**色相**按用户选的种子色旋转，
     彩度/明度原样保留 —— 默认种子（#6750A4，和基线同色相）出来的就是标准 M3 配色，
     换别的主题色也只是整片色相平移，不会又变灰。
     注意：只改 -c（容器）这一族。--primary / --tertiary / surface 那几档维持原算法不动，
     免得动了按钮和整页底色的观感。 */
  var 基线主色相 = 258.6;      // M3 基线 #6750A4 的色相
  var 基线第三色相 = 336;      // M3 基线 #7D5260 的色相
  function getTheme() { try { var t = JSON.parse(localStorage.getItem(THEME_KEY) || 'null'); if (t && t.seed) return t; } catch (e) {} return { seed: '#6750A4', mode: 'light' }; }
  function saveTheme(t) { try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch (e) {} }
  // 系统是否深色：优先问原生（部分安卓 WebView 不回传 prefers-color-scheme），再退回媒体查询
  function systemDark() {
    try { if (window.Native && Native.isSystemDark) { var r = Native.isSystemDark(); return r === true || r === 'true'; } } catch (e) {}
    try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }
  function effMode(mode) { if (mode !== 'auto') return mode; return systemDark() ? 'dark' : 'light'; }
  function applyTheme() {
    var th = getTheme(), dark = effMode(th.mode) === 'dark';
    var hs = hex2hsl(th.seed), H = hs[0], S = Math.max(hs[1], 36), Ht = (H + 58) % 360, St = Math.max(S, 30), N = Math.min(S, 16), V = {};
    var dP = H - 基线主色相, dT = Ht - 基线第三色相;      // 容器色只做色相平移（见 容器浅/基线 那段注释）
    if (!dark) {
      V = { '--primary': tone(H,S,40), '--on-primary': '#fff', '--primary-c': 换色('#EADDFF', dP), '--on-primary-c': 换色('#21005D', dP),
        '--secondary-c': 换色('#E8DEF8', dP), '--on-secondary-c': 换色('#1D192B', dP),
        '--tertiary': tone(Ht,St,40), '--tertiary-c': 换色('#FFD8E4', dT), '--on-tertiary-c': 换色('#31111D', dT),
        '--error': '#B3261E', '--on-error': '#fff', '--error-c': '#F9DEDC', '--on-error-c': '#410E0B',
        '--surface': tone(H,N,98), '--on-surface': tone(H,N,10), '--on-surface-var': tone(H,N,30),
        '--c-lowest': tone(H,N,100), '--c-low': tone(H,N,96), '--c': tone(H,N,94), '--c-high': tone(H,N,92), '--c-highest': tone(H,N,90),
        '--outline': tone(H,N,50), '--outline-var': tone(H,N,88), '--scrim': 'rgba(0,0,0,.32)' };
    } else {
      V = { '--primary': tone(H,S,80), '--on-primary': tone(H,S,20), '--primary-c': 换色('#4F378B', dP), '--on-primary-c': 换色('#EADDFF', dP),
        '--secondary-c': 换色('#4A4458', dP), '--on-secondary-c': 换色('#E8DEF8', dP),
        '--tertiary': tone(Ht,St,80), '--tertiary-c': 换色('#633B48', dT), '--on-tertiary-c': 换色('#FFD8E4', dT),
        '--error': '#F2B8B5', '--on-error': '#601410', '--error-c': '#8C1D18', '--on-error-c': '#F9DEDC',
        '--surface': tone(H,N,6), '--on-surface': tone(H,N,90), '--on-surface-var': tone(H,N,76),
        '--c-lowest': tone(H,N,4), '--c-low': tone(H,N,10), '--c': tone(H,N,15), '--c-high': tone(H,N,20), '--c-highest': tone(H,N,25),
        '--outline': tone(H,N,60), '--outline-var': tone(H,N,30), '--scrim': 'rgba(0,0,0,.5)' };
    }
    var root = document.documentElement;
    Object.keys(V).forEach(function (k) { root.style.setProperty(k, V[k]); });
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  applyTheme();
  // 系统深浅色变化：浏览器媒体查询 或 原生配置变更回调，都会在“跟随系统”时即时换肤
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (getTheme().mode === 'auto') applyTheme(); }); } catch (e) {}
  window.__onSystemThemeChanged = function () { if (getTheme().mode === 'auto') applyTheme(); };

  /* ---------------- M3 自定义取色器（替代安卓系统原生取色框，支持预设 + HSL + HEX） ---------------- */
  function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))); }
  function hslToHex(h, s, l) { // s,l 为 0..100
    s /= 100; l /= 100; h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    function hx(v) { return clamp255((v + m) * 255).toString(16).padStart(2, '0'); }
    return ('#' + hx(r) + hx(g) + hx(b)).toUpperCase();
  }
  // 接受 #rgb / #rrggbb，输出规范大写 #RRGGBB；非法返回 null（杜绝原生 color input 静默变黑）
  function normalizeHex(str) {
    if (str == null) return null;
    var s = String(str).trim();
    if (!s) return null;
    if (s.charAt(0) !== '#') s = '#' + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : null;
  }
  var CP = { h: 262, s: 34, l: 48, cb: null, hexEditing: false };
  var CP_PRESETS = ['#1D1B20', '#49454F', '#6750A4', '#0B57D0', '#00696D', '#386A20',
    '#9C4100', '#984061', '#B3261E', '#C7C9CE', '#F3EDF7', '#FFFFFF'];
  function cpCurrentHex() { return hslToHex(CP.h, CP.s, CP.l); }
  function cpSync() {
    var hex = cpCurrentHex();
    $('cpNew').style.background = hex;
    $('cpH').value = Math.round(CP.h); $('cpS').value = Math.round(CP.s); $('cpL').value = Math.round(CP.l);
    $('cpHv').textContent = Math.round(CP.h) + '°'; $('cpSv').textContent = Math.round(CP.s) + '%'; $('cpLv').textContent = Math.round(CP.l) + '%';
    if (!CP.hexEditing) $('cpHex').value = hex;
  }
  function pickColor(initial, fallback) {
    return new Promise(function (resolve) {
      var init = normalizeHex(initial) || normalizeHex(fallback) || '#6750A4';
      var hv = hex2hsl(init); CP.h = hv[0]; CP.s = hv[1]; CP.l = hv[2];
      CP.cb = resolve; CP.hexEditing = false;
      $('cpHex').value = init; cpSync();
      var cm = document.querySelector('#colorMask .modal'); if (cm) cm.scrollTop = 0;
      $('colorMask').classList.remove('hidden');
    });
  }
  function closeColor(res) { if (CP.cb) { var r = res; CP.cb(r); CP.cb = null; } $('colorMask').classList.add('hidden'); }
  function bindColorPicker() {
    var presets = $('cpPresets'); presets.innerHTML = '';
    CP_PRESETS.forEach(function (hex) {
      var sw = el('button', 'cp-swatch'); sw.type = 'button'; sw.style.background = hex; sw.title = hex;
      sw.addEventListener('click', function () { var v = hex2hsl(hex); CP.h = v[0]; CP.s = v[1]; CP.l = v[2]; cpSync(); });
      presets.appendChild(sw);
    });
    [['cpH', 'h'], ['cpS', 's'], ['cpL', 'l']].forEach(function (pair) {
      $(pair[0]).addEventListener('input', function () { CP[pair[1]] = Number(this.value); cpSync(); });
    });
    $('cpHex').addEventListener('input', function () {
      CP.hexEditing = true;
      var v = normalizeHex(this.value);
      if (v) { var hsv = hex2hsl(v); CP.h = hsv[0]; CP.s = hsv[1]; CP.l = hsv[2];
        $('cpH').value = CP.h; $('cpS').value = CP.s; $('cpL').value = CP.l;
        $('cpHv').textContent = Math.round(CP.h) + '°'; $('cpSv').textContent = Math.round(CP.s) + '%'; $('cpLv').textContent = Math.round(CP.l) + '%';
        $('cpNew').style.background = v;
      }
    });
    $('cpOk').addEventListener('click', function () {
      var v = normalizeHex($('cpHex').value) || cpCurrentHex(); closeColor(v);
    });
    $('cpCancel').addEventListener('click', function () { closeColor(null); });
    $('cpClear').addEventListener('click', function () { closeColor(''); });   // 恢复默认=清除自定义
  }

  /* ---------------- 精美确认弹窗（替代浏览器原生 confirm） ---------------- */
  function confirmDialog(opt) {
    return new Promise(function (resolve) {
      $('confirmTitle').textContent = opt.title || '确认操作';
      var msg = $('confirmMsg'); msg.innerHTML = '';
      if (typeof opt.msg === 'string') msg.textContent = opt.msg; else msg.appendChild(opt.msg);
      var ok = $('confirmOk'), cancel = $('confirmCancel');
      var nonDanger = opt.danger === false;
      ok.textContent = opt.okText || '删除';
      ok.style.background = nonDanger ? 'var(--primary)' : 'var(--error)';
      ok.style.color = nonDanger ? 'var(--on-primary)' : 'var(--on-error)';
      $('confirmIcon').classList.toggle('info', nonDanger);
      $('confirmMask').classList.remove('hidden');
      function done(r) { 关遮罩($('confirmMask')); ok.onclick = null; cancel.onclick = null; resolve(r); }
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
    });
  }

  /* 滑动 vs 点击：在可滚动列表里上下滑动时不触发 click（防止误选其它条目）。
     记录触摸起点，移动超过阈值即判定为拖拽/滑动，本次 click 一律忽略。 */

  /* ================= 触摸弹窗守卫 =================
     真机触摸 tap 的兼容 click 会在 touchend 之后才完成命中检测：若 tap 的抬手动作刚打开了
     全屏弹窗（数字/文本编辑框、云列表创建/管理等），这个迟到的 click 会落到遮罩背景上，
     触发“点遮罩关闭”，表现为弹窗一闪即关、按钮点不动、字段无法编辑。
     这里记录每个遮罩最近一次显示的时间，显示后 600ms 内落在遮罩背景上的 click 一律拦截
     （弹窗内按钮的 target 不是遮罩本身，不受影响；600ms 后点背景关闭的习惯仍然保留）。 */
  (function maskOpenGuard() {
    var shownAt = Object.create(null);
    function keyOf(m) { return m.id || ('anon_' + maskOpenGuard.seed++); }
    function mark(m) {
      if (m && m.classList && m.classList.contains('mask') && !m.classList.contains('hidden')) {
        shownAt[keyOf(m)] = Date.now();
      }
    }
    maskOpenGuard.seed = 1;
    function observe(m) {
      if (!m || m.__maskGuarded) return; m.__maskGuarded = true;
      new MutationObserver(function () { mark(m); }).observe(m, { attributes: true, attributeFilter: ['class'] });
      mark(m);
    }
    document.querySelectorAll('.mask').forEach(observe);
    document.addEventListener('click', function (e) {
      var m = e.target;
      if (!m || m.nodeType !== 1 || !m.classList || !m.classList.contains('mask')) return;
      var t = shownAt[keyOf(m)] || 0;
      if (Date.now() - t < 600) { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); }
    }, true);
    window.__observeMask = observe;
  })();

  /* ================= Blockly 弹窗 M3 化（替代安卓原生 prompt/confirm/alert） ================= */
  var bdState = null;
  function bdFinish(v) {
    var cb = bdState && bdState.cb;
    $('blocklyDialogMask').classList.add('hidden');
    bdState = null;
    if (cb) cb(v);
  }
  function setupBlocklyDialogs() {
    if (!window.Blockly || !Blockly.dialog) return;
    function openModal() { $('blocklyDialogMask').classList.remove('hidden'); }
    function bdPrompt(message, defaultValue, cb) {
      bdState = { cb: cb };
      $('bdMessage').textContent = message || '';
      $('bdField').style.display = '';
      var inp = $('bdInput');
      inp.type = 'text'; inp.value = defaultValue == null ? '' : String(defaultValue);
      $('bdCancel').style.display = ''; $('bdOk').textContent = '确定';
      openModal();
      // 不再全选已有文案：聚焦后把光标放到末尾，避免一输入就覆盖原内容
      setTimeout(function () {
        inp.focus();
        var len = inp.value.length;
        try { inp.setSelectionRange(len, len); } catch (e) { inp.scrollLeft = inp.scrollWidth; }
      }, 60);
    }
    function bdConfirm(message, cb) {
      bdState = { cb: cb };
      $('bdMessage').textContent = message || '';
      $('bdField').style.display = 'none';
      $('bdCancel').style.display = ''; $('bdOk').textContent = '确定';
      openModal();
    }
    function bdAlert(message, cb) {
      bdState = { cb: cb };
      $('bdMessage').textContent = message || '';
      $('bdField').style.display = 'none';
      $('bdCancel').style.display = 'none'; $('bdOk').textContent = '知道了';
      openModal();
    }
    Blockly.dialog.setPrompt(bdPrompt);
    Blockly.dialog.setConfirm(bdConfirm);
    Blockly.dialog.setAlert(bdAlert);
    setupBlocklyDialogs.done = true;
  }
  function bindBlocklyDialogUi() {
    function ok() {
      if (!bdState) return;
      if ($('bdField').style.display === 'none') bdFinish(true);
      else bdFinish($('bdInput').value);
    }
    $('bdOk').addEventListener('click', ok);
    $('bdCancel').addEventListener('click', function () {
      if (!bdState) return;
      bdFinish($('bdField').style.display === 'none' ? false : null);
    });
    $('bdInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
      if (e.key === 'Escape') { e.preventDefault(); bdFinish(null); }
    });
    $('blocklyDialogMask').addEventListener('click', function (e) {
      if (e.target === this && bdState) bdFinish($('bdField').style.display === 'none' ? false : null);
    });
  }

  /* ================= 云表格（SeaTable）创建 / 管理 ================= */
  window.BB_getProjectClouds = function () {
    return (state && state.project && Array.isArray(state.project.clouds)) ? state.project.clouds : [];
  };
  function cloudProviderLabel(p) {
    if (p === 'seatable-io') return 'SeaTable 国际版';
    if (p === 'seatable-custom') return 'SeaTable 自定义';
    return 'SeaTable 中国版';
  }
  function cloudDefaultServer(p) {
    return p === 'seatable-io' ? 'https://cloud.seatable.io' : 'https://cloud.seatable.cn';
  }
  // 编辑器侧 HTTP：App 内走原生桥接（绕开网关重复 CORS 头），无头/浏览器直连 fetch
  /**
   * 原生桥回来的结果按请求号分发。
   * 原来是"每次请求临时换掉 window.__nativeHttpResolve，收到自己的结果再换回去"——
   * 两个请求同时在飞时（进账号页就会：读「账号」表 + 读「我分享的作品」+ 读「社区」表），
   * 先发的那个请求结束时会把这个全局槽**恢复成它进函数前的样子**，
   * 于是一个还没回来的请求就再也没人认领它的结果 —— 界面永远停在"正在加载…"，
   * 直到 15/40 秒超时变成一句网络错误。用户报的"总是获取不到社区作品 / 我分享的作品"
   * 就是这一条（2026-09-25 在 PC 上按原逻辑并发复现：两个请求"按顺序返回"必定卡死后一个）。
   * 改成**一个常驻分发器 + 一张请求号表**，谁的结果回给谁，互不影响。
   */
  var 原生待回 = {};
  window.__nativeHttpResolve = function (rid, json) {
    var f = 原生待回[rid];
    if (typeof f === 'function') f(json);
  };
  /** 中转请求的打包规则（纯函数，不碰网络，方便被回归用例直接验）。
      输入：method / 完整 url / 业务 body；输出：{ url, bodyText }。
      · 中转请求（CLOUD_BASE + '/api…'）：整条相对路径（含查询串）放进 p，
        真正的请求体放进 b，最后整体 JSON 化当请求体发出去。
      · 非中转请求（例如发码接口打函数根路径）：原样返回，绝不改 body。
      ⚠️ 判定必须用 CLOUD_BASE + '/api'，**不能只用 CLOUD_BASE**（2026-09-26 踩的坑）：
        发码接口和云中转**是同一个阿里云函数**（MAIL_BASE === CLOUD_BASE），
        但它打的是函数根路径、body 里直接放 {action:'send'|'verify'}。
        用 indexOf(CLOUD_BASE) === 0 判定的话，发码请求也会被包一层
        {p:'',m:'POST',q:'',b:{action:'send'}}，函数在顶层找不到 action
        → 一律回「未知 action（send / verify）」→ **登录发码整条链全挂**。
        （线上真函数实测：原样 {action:'verify'} → 400「邮箱格式不正确」（认得 action）；
          包一层后 → 400「未知 action（send / verify）」。）
      为什么抽成独立函数：假网络（window.__authSetHttp）在 authHttp 那层就把请求截走了，
      **永远看不到这里做过什么**，所以打包错了任何用例都是绿的。抽出来才能单测这条约定。 */
  function 打包中转请求(method, url, body) {
    var _u = String(url || '');
    var bodyText = (body !== undefined && body !== null) ? JSON.stringify(body) : null;
    if (!(用中转() && _u.indexOf(CLOUD_BASE + '/api') === 0)) return { url: _u, bodyText: bodyText };
    var _m = String(method || 'GET').toUpperCase();
    // 解析出"要发给中转的相对路径 + 查询串"。两种来源：
    //   1) 中转链接() 拼的：/api?p=<相对路径>   ← 已经就是包，无需再包
    //   2) 网关()/dlLinkUrl() 拼的具体路径      ← 由这里统一打包
    var _rel = null, _是自己拼的包 = false;
    if (_u.indexOf('/api?p=') === 0) {
      _rel = _u.slice('/api?p='.length);
      _是自己拼的包 = true;
    } else {
      _rel = _u.slice(CLOUD_BASE.length);
    }
    // 兜底：_rel 里若还带着 /api?p= 或 p= 前缀（历史写法），剥掉
    _rel = String(_rel).replace(/^\/api\?p=/, '').replace(/^p=/, '');
    var _body已打包 = !!(body && typeof body === 'object'
      && typeof body.p === 'string' && typeof body.m === 'string' && ('b' in body));
    if (_body已打包) {
      body.p = String(body.p).replace(/^\/api\?p=/, '').replace(/^p=/, '');
      bodyText = JSON.stringify(body);
    } else if (!_是自己拼的包 && _m !== 'GET' && _m !== 'HEAD') {
      // 具体路径 + 有请求体 → 统一打包（写行/改行/删除/上传走这条）
      bodyText = JSON.stringify({ p: _rel, m: _m, q: '', b: (body === undefined ? null : body) });
    } else if (_是自己拼的包) {
      // 已经拼好 p 的 GET：URL 不用动（路径就在 ?p= 里）
    }
    return { url: _u, bodyText: bodyText };
  }
  function editorCloudHttp(method, url, body, token, opts) {
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    // 走云中转的请求**一律**带口令：只在某一处加容易漏（账号读表就漏过一次，
    // 表现是"账号没写进表格/社区一张卡都没有"），所以在 HTTP 层统一兜住。
    // 这里用 CLOUD_BASE 判定（不是 CLOUD_BASE + '/api'）：发码接口同样需要这个口令头。
    if (用中转() && String(url || '').indexOf(CLOUD_BASE) === 0) h['X-App-Token'] = MAIL_APP_TOKEN;
    // 额外请求头（阿里云函数要 X-App-Token 这类口令）
    if (opts && opts.headers) { for (var hk in opts.headers) { if (opts.headers[hk] != null) h[hk] = opts.headers[hk]; } }
    // SeaTable 用 Token 方案，DeepSeek 用 Bearer；由 opts.bearer 区分，默认维持原行为
    if (token) h['Authorization'] = (opts && opts.bearer ? 'Bearer ' : 'Token ') + token;
    // 允许调用方追加自定义头（如邮箱函数的 X-App-Token）
    if (opts && opts.headers) { for (var hk in opts.headers) h[hk] = opts.headers[hk]; }
    var _包 = 打包中转请求(method, url, body);
    var bodyText = _包.bodyText;
    function interpret(status, txt) {
      // opts.raw：要的是原样文本（例如下载 .fast 作品文件），不做 JSON 解析
      if (opts && opts.raw) {
        if (status < 200 || status >= 300) throw new Error('下载失败 HTTP ' + status);
        return txt;
      }
      var data = null; if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
      var errMsg = data && (data.error_message || data.error_msg || data.detail || data.error);
      // 阿里云函数网关的错误形状是 {Code, Message}（和 SeaTable 的键都不一样），
      // 不兜住的话用户只能看到一句"请求失败 HTTP 403"。欠费停机（"Current user is in debt."）
      // 翻译成看得懂的话 —— 2026-10-27 检查更新/社区同时取不到数据的根因就是这个。
      if (!errMsg && data && data.Message) {
        errMsg = /in debt/i.test(String(data.Message)) ? '云服务欠费停机，请联系开发者' : String(data.Message);
      }
      if (status < 200 || status >= 300 || errMsg) throw new Error(errMsg || ('请求失败 HTTP ' + status));
      return data;
    }
    if (window.Native && Native.httpRequest) {
      return new Promise(function (resolve, reject) {
        var id = 'cc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        var done = false;
        var tmo = (opts && opts.timeoutMs) || 20000;   // AI 生成要慢得多，允许调用方放宽
        var timer = setTimeout(function () {
          if (done) return; done = true; delete 原生待回[id];
          reject(new Error('连接超时，请检查网络'));
        }, tmo);
        原生待回[id] = function (json) {
          if (done) return; done = true; clearTimeout(timer); delete 原生待回[id];
          var r = null; try { r = JSON.parse(json); } catch (e) { reject(new Error('响应解析失败')); return; }
          if (r.error) { reject(new Error(r.error)); return; }
          try { resolve(interpret(r.status || 0, r.body || '')); } catch (e) { reject(e); }
        };
        try { Native.httpRequest(id, method, url, JSON.stringify(h), bodyText || ''); }
        catch (e) { if (done) return; done = true; clearTimeout(timer); delete 原生待回[id]; reject(e); }
      });
    }
    var opt = { method: method, headers: h };
    if (bodyText !== null) opt.body = bodyText;
    return fetch(url, opt).then(function (resp) {
      return resp.text().then(function (txt) { return interpret(resp.status, txt); });
    });
  }
  // 校验凭证：换取 token 并读取表清单
  async function cloudPing(provider, server, uuid, token) {
    var srv = (provider === 'seatable-custom' ? String(server || '').trim().replace(/\/+$/, '') : cloudDefaultServer(provider));
    if (provider === 'seatable-custom' && !srv) throw new Error('请填写服务器地址');
    if (!uuid) throw new Error('请填写表格 UUID');
    if (!token) throw new Error('请填写 API 密钥');
    var d = await editorCloudHttp('GET', srv + '/api/v2.1/dtable/app-access-token/', null, token);
    if (!d || !d.access_token) throw new Error('鉴权失败，请检查 API 密钥');
    var gateway = (d.dtable_server || (srv + '/api-gateway/')).replace(/\/+$/, '');
    var realUuid = d.dtable_uuid || uuid;
    var meta = await editorCloudHttp('GET', gateway + '/api/v2/dtables/' + realUuid + '/metadata/', null, d.access_token);
    var tables = (meta && meta.metadata && meta.metadata.tables || []).map(function (t) { return t.name; });
    return { server: srv, uuid: realUuid, tables: tables };
  }
  // 云表格变更后：刷新画布/浮层下拉，若云列表浮层开着则重建
  function refreshCloudUi() {
    try { refreshCompDropdowns(); } catch (e) {}
    if (!state.wsInited || !state.ws) return;
    try {
      var tb = state.ws.getToolbox && state.ws.getToolbox(), sel = tb && tb.getSelectedItem();
      if (sel && catItemName(sel) === '云列表') {
        tb.clearSelection();
        setTimeout(function () { try { tb.setSelectedItem(sel); } catch (e) {} }, 0);
      }
    } catch (e) {}
  }
  var ccEditingId = null;
  function ccSyncServerVis() {
    $('ccServerField').style.display = $('ccProvider').value === 'seatable-custom' ? '' : 'none';
  }
  function ccSetError(msg) { $('ccError').textContent = msg || ''; }
  function openCloudCreate(editingId) {
    ccEditingId = editingId || null;
    var c = null;
    if (ccEditingId) c = window.BB_getProjectClouds().filter(function (x) { return x.id === ccEditingId; })[0] || null;
    $('ccTitle').textContent = c ? '编辑 SeaTable 云列表' : '创建 SeaTable 云列表';
    $('ccGo').textContent = c ? '保存' : '创建云表格';
    $('ccProvider').value = c ? c.provider : 'seatable-cn';
    if ($('ccProvider')._syncM3Label) $('ccProvider')._syncM3Label();
    $('ccServer').value = c ? (c.server || '') : '';
    $('ccName').value = c ? c.name : '';
    $('ccUuid').value = c ? c.uuid : '';
    $('ccToken').value = c ? c.token : '';
    ccSetError(''); ccSyncServerVis();
    $('cloudCreateMask').classList.remove('hidden');
    setTimeout(function () { (c ? $('ccToken') : $('ccName')).focus(); }, 80);
  }
  function closeCloudCreate() { 关遮罩($('cloudCreateMask')); ccEditingId = null; }
  async function ccSubmit() {
    var f = {
      provider: $('ccProvider').value, server: $('ccServer').value.trim(),
      name: $('ccName').value.trim(), uuid: $('ccUuid').value.trim(), token: $('ccToken').value.trim()
    };
    var btn = $('ccGo');
    if (!f.name) { ccSetError('请给这个云表格起个名字'); $('ccName').focus(); return; }
    if (f.provider === 'seatable-custom' && !/^https?:\/\//.test(f.server)) { ccSetError('服务器地址需以 http:// 或 https:// 开头'); $('ccServer').focus(); return; }
    var dup = window.BB_getProjectClouds().some(function (x) { return x.name === f.name && x.id !== ccEditingId; });
    if (dup) { ccSetError('已存在同名云表格，请换一个名字'); $('ccName').focus(); return; }
    btn.disabled = true; var oldText = btn.textContent; btn.textContent = '校验中…'; ccSetError('');
    try {
      var r = await cloudPing(f.provider, f.server, f.uuid, f.token);
      var clouds = state.project.clouds = state.project.clouds || [];
      if (ccEditingId) {
        var ex = clouds.filter(function (x) { return x.id === ccEditingId; })[0];
        if (ex) { ex.name = f.name; ex.provider = f.provider; ex.server = r.server; ex.uuid = r.uuid; ex.token = f.token; }
        snack('云表格已更新');
      } else {
        clouds.push({ id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: f.name, provider: f.provider, server: r.server, uuid: r.uuid, token: f.token });
        snack('云表格创建成功，共 ' + r.tables.length + ' 个数据表');
      }
      closeCloudCreate(); refreshCloudUi(); autosave();
    } catch (e) {
      ccSetError('创建失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false; btn.textContent = oldText;
    }
  }
  function renderCloudManage() {
    var list = $('cmList'); list.innerHTML = '';
    var clouds = window.BB_getProjectClouds();
    if (!clouds.length) { list.appendChild(el('div', 'cm-empty', '还没有云表格，点下方“创建云表格”开始')); return; }
    clouds.forEach(function (c) {
      var item = el('div', 'cm-item');
      var info = el('div', 'cm-info');
      info.appendChild(el('div', 'cm-name', c.name));
      info.appendChild(el('div', 'cm-meta', cloudProviderLabel(c.provider) + ' · ' + (c.server || '').replace(/^https?:\/\//, '') + ' · ' + String(c.uuid).slice(0, 8)));
      var ops = el('div', 'cm-ops');
      var editBtn = el('button', '', '编辑'); editBtn.type = 'button';
      editBtn.addEventListener('click', function () { $('cloudManageMask').classList.add('hidden'); openCloudCreate(c.id); });
      var delBtn = el('button', 'danger', '删除'); delBtn.type = 'button';
      delBtn.addEventListener('click', async function () {
        var ok = await confirmDialog({ title: '删除云表格', msg: '确定删除云表格“' + c.name + '”吗？相关代码需要重新选择云表格。', okText: '删除' });
        if (!ok) return;
        state.project.clouds = state.project.clouds.filter(function (x) { return x.id !== c.id; });
        renderCloudManage(); refreshCloudUi(); autosave(); snack('已删除');
      });
      ops.appendChild(editBtn); ops.appendChild(delBtn);
      item.appendChild(info); item.appendChild(ops); list.appendChild(item);
    });
  }
  function openCloudManage() { renderCloudManage(); $('cloudManageMask').classList.remove('hidden'); }
  function bindCloudUi() {
    wireM3StaticSelect($('ccProvider'), [
      ['SeaTable 中国版（cloud.seatable.cn）', 'seatable-cn'],
      ['SeaTable 国际版（cloud.seatable.io）', 'seatable-io'],
      ['自定义 SeaTable 服务器', 'seatable-custom']
    ]);
    $('ccProvider').addEventListener('change', ccSyncServerVis);
    $('ccGo').addEventListener('click', ccSubmit);
    $('ccCancel').addEventListener('click', closeCloudCreate);
    $('cloudCreateMask').addEventListener('click', function (e) { if (e.target === this) closeCloudCreate(); });
    $('cmAdd').addEventListener('click', function () { $('cloudManageMask').classList.add('hidden'); openCloudCreate(null); });
    // 注意 id 是 cloudManageDone，不是 cmClose —— 以前这里写成 $('cmClose')，
    // 而 editor.html 里「管理分享」弹窗已经先占用了 cmClose，getElementById 只返回第一个，
    // 于是这个「完成」按钮**从来没有绑上事件**（点了没反应），
    // 而且「管理分享」的「关闭」被绑了两个处理器（2026-09-26 扫描发现）。
    $('cloudManageDone').addEventListener('click', function () { $('cloudManageMask').classList.add('hidden'); });
    $('cloudManageMask').addEventListener('click', function (e) { if (e.target === this) this.classList.add('hidden'); });
  }

  var tapGuard = (function () {
    var sx = 0, sy = 0, dragging = false, down = false;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; dragging = false; down = true;
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (!down) return; var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) dragging = true;
    }, { passive: true, capture: true });
    document.addEventListener('touchend', function () {
      // 留到 click 阶段读取后再复位
      setTimeout(function () { down = false; dragging = false; }, 350);
    }, { passive: true, capture: true });
    return { isDragging: function () { return dragging; } };
  })();
  // 仅当“轻点”（非滑动）时执行
  function onTap(handler) {
    return function (e) { if (tapGuard.isDragging()) { e.preventDefault(); e.stopPropagation(); return; } handler.call(this, e); };
  }

  /* 弹窗打开时锁定背后滚动：任何 .mask 可见时，只允许弹窗本体(.modal)内部滚动，
     阻止背后页面（首页列表/组件列表/代码画布）跟着滑动 */
  (function lockBackgroundScroll() {
    function openMask() { return document.querySelector('.mask:not(.hidden)'); }
    function block(e) {
      var m = openMask(); if (!m) return;
      if (e.target.closest && e.target.closest('.modal')) return;  // 弹窗内部滚动放行
      e.preventDefault();
    }
    document.addEventListener('touchmove', block, { passive: false, capture: true });
    document.addEventListener('wheel', block, { passive: false, capture: true });
  })();

  /* 编辑器侧滑返回：左缘右拖 → 优先关弹窗，其次退出“拖动布局”回到编辑器 */
  (function editorEdgeSwipe() {
    var sx = 0, sy = 0, active = false;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; active = t.clientX <= 26; if (active) { sx = t.clientX; sy = t.clientY; }
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (!active) return; var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy, h = $('edgeHint');
      if (dx > 12 && Math.abs(dx) > Math.abs(dy) && h) { h.classList.add('show'); h.style.transform = 'translateX(' + Math.min(dx - 12, 90) + 'px)'; }
    }, { passive: true, capture: true });
    function finish(e) {
      if (!active) return; active = false;
      var h = $('edgeHint'); if (h) { h.classList.remove('show'); h.style.transform = ''; }
      var t = e.changedTouches ? e.changedTouches[0] : null, dx = t ? t.clientX - sx : 0, dy = t ? t.clientY - sy : 0;
      if (!(dx > 64 && Math.abs(dx) > Math.abs(dy) * 1.4)) return;
      var masks = ['createMask', 'colorMask', 'cloudCreateMask', 'cloudManageMask', 'blocklyDialogMask', 'confirmMask', 'exportMask', 'updLogMask', 'modalMask', 'authMask'];
      for (var i = 0; i < masks.length; i++) { var m = $(masks[i]); if (m && !m.classList.contains('hidden')) { m.classList.add('hidden'); return; } }
      if (state.inLayout) closeLayout();
    }
    document.addEventListener('touchend', finish, { passive: true, capture: true });
    document.addEventListener('touchcancel', function () { active = false; var h = $('edgeHint'); if (h) h.classList.remove('show'); }, { passive: true, capture: true });
  })();

  /* ---------------- 项目工程 ---------------- */
  function blankProject() {
    return {
      fmt: 2,   // 工程数据格式版本：2 = 控件元数据集中在 comp-spec.js
      appName: '我的应用', orientation: 'portrait', version: '1.0', icon: null,
      startScreen: 's1', clouds: [],
      screens: [{ id: 's1', title: '页面1', components: [], blocksXml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>' }]
    };
  }
  function loadStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
    if (!s || !s.items) {
      s = { items: [] };
      // 迁移旧版单工程自动保存
      try {
        var old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        if (old && old.project && old.project.screens) {
          s.items.push({ id: 'p' + Date.now().toString(36), name: old.project.appName || '我的应用',
            updatedAt: Date.now(), project: old.project });
        }
      } catch (e) {}
      saveStore(s);
    }
    return s;
  }
  function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  /** 名字是不是被"别的作品"占了（改作品名时用；忽略大小写与首尾空格） */
  function appNameTakenByOther(name) {
    var n = String(name == null ? '' : name).trim().toLowerCase();
    if (!n) return null;
    var s = loadStore(), 撞 = null;
    s.items.forEach(function (it) {
      if (it.id === state.itemId) return;                       // 自己不算
      if (String(it.name || '').trim().toLowerCase() === n) 撞 = it;
    });
    return 撞;
  }
  function persist() {
    if (!state.itemId || !state.project) return;
    var 输入 = ($('appName').value || '').trim();
    // 改名不许撞别人：撞了就保留原名 + 把输入框退回原名（用户要求）
    if (输入 && appNameTakenByOther(输入)) {
      var 原名 = state.project.appName || '我的应用';
      if ($('appName')) $('appName').value = 原名;
      try { snack('已经有叫「' + 输入 + '」的作品了，名字没改'); } catch (e) {}
    } else if (输入) {
      state.project.appName = 输入;
    }
    var s = loadStore();
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === state.itemId) {
      s.items[i].project = state.project; s.items[i].name = state.project.appName; s.items[i].updatedAt = Date.now();
    }
    saveStore(s);
  }
  var saveTimer = null;
  // 自动保存绝不能关闭分类浮层/下拉/齿轮框：在 mutator 小框里拖代码会触发主工作区变更→
  // autosave→旧逻辑收起小框，表现为“拖动时框突然关闭”。离开代码页时才显式传 closeOverlays=true。
  function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { saveCurrentWs(false); persist(); }, 250); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 首页 ---------------- */
  function showHome() {
    saveCurrentWs(true); persist();
    try { localStorage.removeItem(OPEN_KEY); } catch (e) {}
    $('viewEditor').classList.add('hidden');
    $('viewHelp').classList.add('hidden');
    $('viewAccount').classList.add('hidden');
    var vt = $('viewTips'); if (vt) vt.classList.add('hidden');
    var vh = $('viewHome'); vh.classList.remove('hidden');
    切页(vh, 'back');
    renderHome();
    后台查更新红点();   // 每次回首页都看一眼云端（内部有 10 分钟节流，不会反复拉接口）
  }

  /* ---------------- 使用帮助页（左：与编辑器一致的分类轨道；右：逐代码说明） ---------------- */
  var helpBuilt = false, helpCurrent = null;
  function openHelp() {
    buildHelp();
    $('viewHome').classList.add('hidden');
    var v = $('viewHelp'); v.classList.remove('hidden');
    切页(v, 'fwd');
  }
  /** 当前构建版本号（构建时注入到 script 的 ?v= 上；开发态没有就显示"开发版"） */
  function buildVersion() {
    try {
      var sc = document.querySelector('script[src*="editor.js?v="]');
      var v = sc ? String(sc.getAttribute('src')).split('?v=')[1] : '';
      if (!v || v.indexOf('__BUILD__') === 0) return '开发版';
      return 'v' + v;
    } catch (e) { return ''; }
  }
  function syncHomeVersion() {
    var n = $('homeVersion');
    if (!n) return;
    var v = buildVersion();
    n.textContent = v || '';
    n.title = '当前版本 ' + v;
  }
  function buildHelp() {
    if (helpBuilt) return; helpBuilt = true;
    补充帮助新内容();
    补帮助漏掉的分类();
    var rail = $('helpCats');
    function catButton(group) {
      var b = el('button', 'bb-cat'); b.type = 'button';
      b.style.setProperty('--bb-c', group.colour);
      var icoTxt = (window.BB_CAT_ICON && window.BB_CAT_ICON[group.cat]) || group.cat.slice(0, 1);
      var ico = el('span', 'bb-cat-ico', icoTxt);
      ico.style.background = group.colour + '1F'; ico.style.color = group.colour;
      var lb = el('span', 'bb-cat-lb', group.cat);
      b.appendChild(ico); b.appendChild(lb);
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        helpCurrent = group;
        Array.prototype.forEach.call(rail.querySelectorAll('.bb-cat'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        renderHelpCat(group);
      });
      return b;
    }
    var gp = $('hpGeneralPanel'), wp = $('hpWidgetPanel');
    (window.BB_HELP.general || []).forEach(function (g) { gp.appendChild(catButton(g)); });
    (window.BB_HELP.widget || []).forEach(function (g) { wp.appendChild(catButton(g)); });
    function setMode(mode) {
      rail.classList.remove('bb-mode-general', 'bb-mode-widget');
      rail.classList.add('bb-mode-' + mode);
      // 切换到某组时，若当前选中分类属于另一组，则自动选中该组第一个分类
      var list = mode === 'widget' ? window.BB_HELP.widget : window.BB_HELP.general;
      var inList = list.some(function (g) { return g === helpCurrent; });
      if (!inList && list.length) {
        helpCurrent = list[0];
        var panel = mode === 'widget' ? wp : gp;
        var btns = panel.querySelectorAll('.bb-cat');
        Array.prototype.forEach.call(rail.querySelectorAll('.bb-cat'), function (x) { x.classList.remove('on'); });
        if (btns[0]) btns[0].classList.add('on');
        renderHelpCat(list[0]);
      }
    }
    $('hpBotSw').addEventListener('click', function () { setMode('widget'); });
    $('hpTopSw').addEventListener('click', function () { setMode('general'); });
    // 默认选中“事件”
    var first = rail.querySelector('.bb-cat');
    if (first) first.classList.add('on');
    helpCurrent = window.BB_HELP.general[0];
    renderHelpCat(helpCurrent);
  }
  /* ---------------- 把真实代码块画成"图片"（帮助 / 进阶技巧里用） ----------------
     用一块离屏工作区把 XML 画出来，再把渲染好的 SVG 克隆一份贴到页面上 ——
     这样条目旁边的图就是**真的积木**，不用另做一套图片资源。 */
  var 活图工作区 = [];      // [{ws, 原主}] 当前页面上还"活着"的缩略图工作区（换页时统一 dispose）
  var 离屏台 = null;        // 建工作区用的临时容器：先离屏建好，再连 DOM 一起搬进页面
  var 活图失败 = '';        // 最近一次画不出来的原因（排错/诊断用）
  function 当前主画布() { try { return Blockly.getMainWorkspace ? Blockly.getMainWorkspace() : null; } catch (e) { return null; } }
  function 设主画布(ws) {
    if (!ws) return false;
    try { if (Blockly.setMainWorkspace) { Blockly.setMainWorkspace(ws); return true; } } catch (e) {}
    try { if (Blockly.common && Blockly.common.setMainWorkspace) { Blockly.common.setMainWorkspace(ws); return true; } } catch (e) {}
    return false;
  }
  /* 放掉不再需要的缩略图工作区。
     传了"容器"就只清这个容器里的（页面上还留着的图不能被误杀 —— 以前全局清，
     从进阶技巧返回使用帮助时会把刚画好的帮助图一起放掉，看着就是"有几块白的"）。 */
  function 清活图(容器) {
    var 事件开着 = 事件开着吗();
    try { if (事件开着) Blockly.Events.disable(); } catch (e) {}
    var 留着 = [];
    活图工作区.forEach(function (r) {
      var box = r.box;
      var 该清 = 容器 ? (!box || !box.parentNode || 容器.contains(box)) : (!box || !box.parentNode);
      if (!该清) { 留着.push(r); return; }
      var 是主 = (当前主画布() === r.ws);
      try { r.ws.dispose(); } catch (e) {}
      if (是主 && !设主画布(r.原主)) { try { aiRestoreMainWs(); } catch (e) {} }
    });
    活图工作区 = 留着;
    try { if (事件开着) Blockly.Events.enable(); } catch (e) {}
  }
  function 事件开着吗() { try { return !Blockly.Events.isEnabled || Blockly.Events.isEnabled(); } catch (e) { return false; } }
  function 取离屏台() {
    if (!离屏台 || !离屏台.parentNode) {
      离屏台 = el('div', 'bb-live-stage');
      离屏台.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;height:800px;overflow:hidden;';
      document.body.appendChild(离屏台);
    }
    return 离屏台;
  }
  /** 用真工作区画一段代码：返回一个 div；画不出来返回 null（调用方再兜底）。
   *  为什么不用"克隆 SVG"那套：克隆出去的 SVG 脱离了画布的排版上下文，
   *  字体量出来的宽和画出来的宽会对不上，积木糊在一起、事件帽子还会盖住文字（用户截图反馈的就是这个）。*/
  function 活块缩略图(xml, maxW, 原尺寸, 缩放) {
    var 宽 = Math.max(120, Number(maxW) || 360);
    var 台 = 取离屏台();
    var host = el('div', 'bb-live-host');
    host.style.cssText = 'width:' + 宽 + 'px;height:220px;';
    台.appendChild(host);
    try { registerFastRenderer(); } catch (e) {}
    var opt = {
      renderer: 'fastzelos', theme: Blockly.Themes.Zelos, readOnly: true, sounds: false,
      trashcan: false, move: { scrollbars: false, drag: false, wheel: false },
      zoom: { controls: false, wheel: false, startScale: 1, pinch: false }
    };
    var ws = null;
    var 原主画布 = 当前主画布();      // 记下注入前的主工作区，注入后要还回去
    /**
     * ⚠ 两个必须做的隔离动作（都踩过坑）：
     *  1. 关掉 Blockly 的事件总线再注入/装载 —— 缩略图也是"工作区"，它装载时抛出的
     *     增删事件会被编辑器当成"代码/控件变了"，进而重建分类栏，结果就是**点了分类浮层是空的**
     *     （用户看到的"看完帮助回来积木点不出来了"）。
     *  2. 注入后把"主工作区"指回去 —— 不还回去的话下拉/气泡/快捷键全跑到这张小图上。
     */
    var 事件开着 = 事件开着吗();
    try { if (事件开着) Blockly.Events.disable(); } catch (e) {}
    try { ws = Blockly.inject(host, opt); }
    catch (e1) { delete opt.renderer; try { ws = Blockly.inject(host, opt); } catch (e2) { ws = null; 活图失败 = '工作区注入失败：' + ((e2 && e2.message) || e2); } }
    if (!ws) {
      try { if (事件开着) Blockly.Events.enable(); } catch (e) {}
      try { 台.removeChild(host); } catch (e) {}
      return null;
    }
    活图工作区.push({ ws: ws, 原主: 原主画布 });
    var 旧桩 = window.__compOptions, 旧页 = window.__pageOptions;
    window.__compOptions = function () { return 缩略图组件桩(xml); };   // 控件下拉显示"按钮/文字…"，不要长占位符
    window.__pageOptions = function () { return 缩略图页面桩(xml, 旧页); };
    var created = null;
    try {
      ws.clear();
      补缩略图变量(ws, xml);      // 变量必须先存在，否则块渲染会直接抛错
      var dom = Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">' + xml + '</xml>');
      created = Blockly.Xml.domToWorkspace(dom, ws);
    } catch (e) { created = null; 活图失败 = '装载失败：' + ((e && e.message) || e); }
    window.__compOptions = 旧桩;
    window.__pageOptions = 旧页;
    if (!设主画布(原主画布)) { try { aiRestoreMainWs(); } catch (e) {} }
    try { if (事件开着) Blockly.Events.enable(); } catch (e) {}
    if (!created || !created.length) return null;
    // 量内容：优先用画布 SVG 的真实 bbox（和积木坐标同一套单位，最可靠）
    var bb = null;
    try {
      var cv = ws.getParentSvg() && ws.getParentSvg().querySelector('.blocklyBlockCanvas');
      if (cv) bb = cv.getBBox();
    } catch (e) { bb = null; }
    if (!bb || !isFinite(bb.x) || !(bb.width > 1) || !(bb.height > 1)) {
      try { bb = ws.getBlocksBoundingBox(); } catch (e) { bb = null; }
    }
    if (!bb || !isFinite(bb.x) || !(bb.width > 1)) return null;
    var pad = 16;   // 左边要留出帽子圆钮的位置，不然最顶上那块会被切掉一截
    var k = 原尺寸 ? (Number(缩放) || 1) : Math.min(Number(缩放) || 1, (宽 - pad * 2) / bb.width);
    if (!(k > 0.1)) k = 0.1;
    var w = Math.max(40, Math.round(bb.width * k + pad * 2));
    var h = Math.max(28, Math.round(bb.height * k + pad * 2));
    host.style.width = w + 'px';
    host.style.height = h + 'px';
    try { ws.setScale(k); } catch (e) {}
    try { Blockly.svgResize(ws); } catch (e) {}
    try { ws.scroll(bb.x * k - pad, bb.y * k - pad); } catch (e) {}
    var box = el('div', 'bb-thumb bb-thumb-live' + (原尺寸 ? ' bb-thumb-scroll' : ''));
    box.style.height = h + 'px';
    box.appendChild(host);      // 工作区连 DOM 一起搬进页面，图就出来了
    try { 活图工作区[活图工作区.length - 1].box = box; } catch (e) {}
    return box;
  }
  function 取缩略图工作区() {
    if (缩略图工作区) return 缩略图工作区;
    try {
      缩略图宿主 = document.createElement('div');
      缩略图宿主.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:320px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden;';
      document.body.appendChild(缩略图宿主);
      // 自定义渲染器要先用一次工作区才会注册；帮助页可能在任何工程打开前就进来，
      // 所以这里先显式注册一次（幂等），万一还是不行就退回默认渲染器，保证图能画出来。
      try { registerFastRenderer(); } catch (e) {}
      var opt = {
        renderer: 'fastzelos', theme: Blockly.Themes.Zelos, readOnly: true, sounds: false,
        trashcan: false, move: { scrollbars: false, drag: false, wheel: false },
        zoom: { controls: false, wheel: false, startScale: 1 }
      };
      try { 缩略图工作区 = Blockly.inject(缩略图宿主, opt); }
      catch (e1) {
        delete opt.renderer;
        缩略图工作区 = Blockly.inject(缩略图宿主, opt);
      }
    } catch (e) { 缩略图工作区 = null; }
    return 缩略图工作区;
  }
  /** 缩略图里给"控件下拉"一份假名单：不然会显示"（请先在设计里添加对应组件）"，又长又难看。
   *  传了 xml：把 xml 里用到的其它控件 id 也补进名单。下拉值在名单里找不到时，
   *  这个块渲染会**直接抛错**（整张图画不出来），所以宁可多给几个。 */
  function 缩略图组件桩(xml) {
    var 名单 = [['按钮', 'button1'], ['文字', 'text1'], ['图片', 'image1'], ['列表', 'list1'],
            ['输入框', 'input1'], ['进度条', 'progress1'], ['计时器', 'timer1'], ['卡片', 'card1'],
            ['下拉选择框', 'select1'], ['开关', 'switch1'], ['容器', 'container1'], ['表格', 'table1'], ['图表', 'chart1']];
    var 有 = {};
    名单.forEach(function (o) { 有[o[1]] = 1; });
    String(xml || '').replace(/<field\s+name="COMP"[^>]*>([^<]*)<\/field>/g, function (m, v) {
      v = String(v || '').trim();
      if (v && v !== 'NONE' && !有[v]) { 有[v] = 1; 名单.push([v, v]); }
      return m;
    });
    return 名单;
  }
  /** 缩略图里的"页面"下拉：同样要保证 xml 里用到的页面值都在名单里 */
  function 缩略图页面桩(xml, 真) {
    var 名单 = [];
    try { 名单 = (typeof 真 === 'function' ? (真() || []) : []); } catch (e) { 名单 = []; }
    if (!名单.length) 名单 = [['页面1', 'page1'], ['页面2', 'page2']];
    var 有 = {};
    名单.forEach(function (o) { 有[o[1]] = 1; });
    String(xml || '').replace(/<field\s+name="(PAGE|PAGEID|SCREEN)"[^>]*>([^<]*)<\/field>/g, function (m, f, v) {
      v = String(v || '').trim();
      if (v && v !== 'NONE' && !有[v]) { 有[v] = 1; 名单.push([v, v]); }
      return m;
    });
    return 名单;
  }
  /** 缩略图里的变量：xml 里用到的变量必须先在画布上存在，
   *  否则 FieldVariable 拿不到值会抛 "The text content is null."，整块画不出来。 */
  function 补缩略图变量(ws, xml) {
    try {
      var vm = ws.getVariableMap();
      String(xml || '').replace(/<field\s+name="VAR"[^>]*>([^<]*)<\/field>/g, function (m, 名) {
        var v = String(名 || '').trim();
        if (v && !vm.getVariableByName(v)) { try { ws.createVariable(v); } catch (e) {} }
        return m;
      });
    } catch (e) {}
  }
  /** 取第一段顶层积木（缩略图兜底：整段画不出来时至少画第一段） */
  function 首个顶层块(xml) {
    var s = String(xml || ''), i = s.indexOf('<block');
    if (i < 0) return '';
    var 深度 = 0, j = i;
    while (j < s.length) {
      if (s.lastIndexOf('<block', j) === j) { 深度++; j = s.indexOf('>', j) + 1; continue; }
      if (s.lastIndexOf('</block>', j) === j) { 深度--; j += 8; if (深度 <= 0) return s.slice(i, j); continue; }
      j++;
    }
    return s.slice(i);
  }
  /** 每个块的"带默认值的 XML"：优先从工具箱里抠（工具箱里的块本来就填好了默认值/下拉），
   *  抠不到再用下面这张手写表。这样画出来的积木是**正常的积木**，不是空壳。 */
  var 块默认缓存 = {};
  var 块默认手写 = {
    ev_start: '<block type="ev_start"></block>',
    ev_first_start: '<block type="ev_first_start"></block>',
    ev_click: '<block type="ev_click"><field name="COMP">button1</field></block>',
    ev_itemclick: '<block type="ev_itemclick"><field name="COMP">list1</field></block>',
    ev_change: '<block type="ev_change"><field name="COMP">select1</field></block>',
    ev_swipe: '<block type="ev_swipe"><field name="DIR">up</field></block>',
    act_toast: '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">提示</field></shadow></value>'
      + '<value name="DUR"><shadow type="math_number"><field name="NUM">2</field></shadow></value></block>',
    act_wait: '<block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>',
    act_vibrate: '<block type="act_vibrate"><value name="MS"><shadow type="math_number"><field name="NUM">30</field></shadow></value></block>',
    act_goto: '<block type="act_goto"></block>',
    act_back: '<block type="act_back"></block>',
    act_set_text: '<block type="act_set_text"><field name="COMP">text1</field>'
      + '<value name="VALUE"><shadow type="text"><field name="TEXT">文字</field></shadow></value></block>',
    act_set_progress: '<block type="act_set_progress"><field name="COMP">progress1</field>'
      + '<value name="VALUE"><shadow type="math_number"><field name="NUM">50</field></shadow></value></block>',
    act_timer_start: '<block type="act_timer_start"><field name="COMP">timer1</field>'
      + '<value name="SECS"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>',
    act_hide: '<block type="act_hide"><field name="COMP">card1</field></block>',
    act_show: '<block type="act_show"><field name="COMP">card1</field></block>',
    act_list_add: '<block type="act_list_add"><field name="COMP">list1</field>'
      + '<value name="VALUE"><shadow type="text"><field name="TEXT">新项</field></shadow></value></block>',
    act_http_get: '<block type="act_http_get"><field name="COMP">text1</field>'
      + '<value name="URL"><shadow type="text"><field name="TEXT">https://</field></shadow></value></block>',
    act_pick_image: '<block type="act_pick_image"><field name="COMP">image1</field></block>',
    controls_if: '<block type="controls_if"><value name="IF0"><block type="logic_boolean"><field name="BOOL">TRUE</field></block></value>'
      + '<statement name="DO0"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">成立</field></shadow></value></block></statement></block>',
    controls_repeat_ext: '<block type="controls_repeat_ext"><value name="TIMES"><shadow type="math_number"><field name="NUM">3</field></shadow></value>'
      + '<statement name="DO"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">重复</field></shadow></value></block></statement></block>',
    logic_compare: '<block type="logic_compare"><field name="OP">EQ</field>'
      + '<value name="A"><shadow type="math_number"><field name="NUM">0</field></shadow></value>'
      + '<value name="B"><shadow type="math_number"><field name="NUM">0</field></shadow></value></block>',
    logic_boolean: '<block type="logic_boolean"><field name="BOOL">TRUE</field></block>',
    math_number: '<block type="math_number"><field name="NUM">1</field></block>',
    math_change: '<block type="math_change"><field name="VAR">分数</field>'
      + '<value name="DELTA"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>',
    variables_set: '<block type="variables_set"><field name="VAR">分数</field>'
      + '<value name="VALUE"><shadow type="math_number"><field name="NUM">0</field></shadow></value></block>',
    variables_get: '<block type="variables_get"><field name="VAR">分数</field></block>',
    text: '<block type="text"><field name="TEXT">文本</field></block>',
    procedures_defnoreturn: '<block type="procedures_defnoreturn"><field name="NAME">我的函数</field></block>',
    procedures_defreturn: '<block type="procedures_defreturn"><field name="NAME">算一算</field>'
      + '<value name="RETURN"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>',
    procedures_callnoreturn: '<block type="procedures_callnoreturn"><mutation name="我的函数"></mutation></block>',
    val_swipe_dist: '<block type="val_swipe_dist"></block>',
    val_swipe_dir: '<block type="val_swipe_dir"></block>',
    val_device_info: '<block type="val_device_info"></block>',
    val_get_text: '<block type="val_get_text"><field name="COMP">input1</field></block>',
    val_http_json: '<block type="val_http_json"><value name="TEXT"><shadow type="text"><field name="TEXT"></field></shadow></value>'
      + '<value name="KEY"><shadow type="text"><field name="TEXT">name</field></shadow></value></block>'
  };
  function 抠工具箱块(t) {
    try {
      var all = String(window.buildToolboxXml ? window.buildToolboxXml(null) : '');
      var i = all.indexOf('<block type="' + t + '"');
      if (i < 0) return '';
      var 深度 = 0, j = i;
      while (j < all.length) {
        if (all.lastIndexOf('<block', j) === j) { 深度++; j = all.indexOf('>', j) + 1; continue; }
        if (all.lastIndexOf('</block>', j) === j) { 深度--; j += 8; if (深度 <= 0) return all.slice(i, j); continue; }
        if (all.lastIndexOf('/>', j) === j && 深度 === 1) return all.slice(i, j + 2);
        j++;
      }
      return all.slice(i);
    } catch (e) { return ''; }
  }
  // 帮助里给「控件」配图的条目（容器 / 表格 / 图表）本身不是代码块，
  // 直接按类型名画会报 "Invalid block definition"，这里映射到最相关的真积木。
  var 控件条目块 = { container: ['act_show', 'container1'], scroll: ['act_show', 'scroll1'],
    bottomNav: ['act_show', 'nav1'], table: ['act_set_data', 'table1'], chart: ['act_set_data', 'chart1'] };
  function 块默认XML(t) {
    if (块默认缓存[t] !== undefined) return 块默认缓存[t];
    var out = 抠工具箱块(t);
    if (!out && 控件条目块[t]) {
      var m = 控件条目块[t];
      out = '<block type="' + m[0] + '"><field name="COMP">' + m[1] + '</field></block>';
    }
    if (!out && 块默认手写[t]) out = 块默认手写[t];
    if (!out) out = '<block type="' + t + '"></block>';
    块默认缓存[t] = out;
    return out;
  }

  /** 代码块的中文名（画"示意图"用；画不出真积木时的兜底，保证一定有东西看） */
  var 块名表 = {
    ev_start: '当页面启动时', ev_first_start: '当页面首次启动时', ev_swipe: '当页面被滑动时',
    ev_click: '当组件被点击', ev_itemclick: '当列表项被点击', ev_change: '当值改变时', ev_slider_change: '当滑块改变时',
    act_toast: '弹出提示', act_goto: '跳转页面', act_back: '返回上一页', act_wait: '等待', act_vibrate: '震动',
    act_set_text: '设置文本', act_show: '显示', act_hide: '隐藏', act_enable: '启用', act_disable: '停用',
    act_set_bg: '设置背景', act_set_color: '设置文字颜色', act_set_rot: '旋转', act_opacity: '透明度',
    act_http_get: '读取网址', act_http_post: '提交到网址', act_pick_image: '拍照或选图', act_set_data: '设置数据',
    act_set_pos: '移到指定位置', act_set_size: '设置尺寸', act_set_options: '设置选项',
    act_set_progress: '设置进度', act_timer_start: '开始计时', act_timer_stop: '停止计时', act_timer_countup: '正计时',
    act_list_add: '列表加一项', act_copy: '复制文本', act_exit: '退出应用', act_keep_screen: '保持常亮',
    val_clipboard: '剪贴板文字', act_open_url: '打开网址', act_notify: '发通知',
    act_set_brightness: '设置亮度', cloud_rows: '查询所有行', cloud_add: '新增一行', cloud_update: '更新一行',
    cloud_delete: '删除一行', cloud_field: '取字段', cloud_sql: 'SQL 查询', cloud_count: '行数', cloud_row_by_id: '按 Id 取一行',
    controls_if: '如果…否则…', controls_repeat_ext: '重复 N 次', controls_whileUntil: '重复当…直到', controls_for: '循环变量',
    controls_flow_statements: '跳出循环', logic_compare: '比较', logic_operation: '与 / 或', logic_negate: '取反',
    logic_boolean: '真 / 假', math_number: '数字', math_arithmetic: '加减乘除', math_single: '平方根/绝对值',
    math_change: '变量增加', variables_set: '设为（变量）', variables_get: '变量的值',
    text: '文本', text_join: '拼接文本', text_length: '文本长度', val_cast: '类型转换',
    lists_create_with: '建立列表', lists_length: '列表长度', colour_picker: '颜色', colour_rgb: '合成颜色',
    val_swipe_dist: '滑动距离', val_swipe_dir: '滑动方向', val_device_info: '设备信息', val_get_text: '输入框内容',
    val_random_int: '随机整数', val_random_frac: '随机小数', val_http_json: '取 JSON 字段'
  };
  function 块类色(t) {
    if (/^ev_/.test(t)) return '#FB8C00';
    if (/^act_|^cloud_/.test(t)) return '#1565C0';
    if (/^val_/.test(t)) return '#00796B';
    if (/^controls_/.test(t)) return '#607D8B';
    if (/^logic_/.test(t)) return '#5C6BC0';
    if (/^math_/.test(t)) return '#3F51B5';
    if (/^text|^lists_/.test(t)) return '#795548';
    if (/^colour_|^variables_/.test(t)) return '#EF6C00';
    return '#546E7A';
  }
  /** 画不出真积木时的"示意图"：按 XML 里的块顺序，一块一块画成小牌子（永远不会空白） */
  function 积木示意(xml, 原因) {
    var box = el('div', 'bb-thumb bb-thumb-sketch');
    box.title = '真积木没画出来，这里用示意图代替' + (原因 ? '（' + 原因 + '）' : '');
    var 类型 = [];
    try {
      String(xml || '').replace(/<block\s+type="([^"]+)"/g, function (m, t) { 类型.push(t); return m; });
    } catch (e) {}
    if (!类型.length) return null;
    var 上一条 = null;
    类型.slice(0, 14).forEach(function (t, i) {
      var row = el('div', 'bb-sk-row');
      var pill = el('div', 'bb-sk-pill', 块名表[t] || t);
      pill.style.background = 块类色(t);
      if (i > 0) pill.style.marginLeft = Math.min(28, i * 4) + 'px';
      row.appendChild(pill);
      box.appendChild(row);
      上一条 = t;
    });
    try { if (typeof diagPush === 'function') diagPush('积木示意图', '真积木渲染失败，已用示意图：' + (原因 || '') + ' / ' + 类型.slice(0, 4).join(',')); } catch (e) {}
    return box;
  }
  /**
   * 逐块兜底：整条链子画不出来时，把每一块**单独**画出来，再上下摞成一张图。
   * 为什么这样更稳：单块渲染在真机上一直是好的（帮助页就是单块），整条链子才会挑食。
   */
  function 逐块缩略图(xml, 缩放) {
    var 类型 = [];
    try { String(xml || '').replace(/<block\s+type="([^"]+)"/g, function (m, t) { if (类型.indexOf(t) < 0 || true) 类型.push(t); return m; }); } catch (e) {}
    if (!类型.length) return null;
    var ws = 取缩略图工作区();
    if (!ws) return null;
    var box = el('div', 'bb-thumb bb-thumb-rows');
    box.classList.add('fastzelos-renderer', 'zelos-theme');
    var 旧桩 = window.__compOptions;
    window.__compOptions = 缩略图组件桩;
    var 成功 = 0;
    类型.slice(0, 16).forEach(function (t, i) {
      try {
        ws.clear();
        var dom = Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">' + 块默认XML(t) + '</xml>');
        var created = Blockly.Xml.domToWorkspace(dom, ws);
        if (!created || !created.length) throw new Error('空');
        var 画布 = ws.getParentSvg().querySelector('.blocklyBlockCanvas');
        var bb = 画布.getBBox();
        if (!(bb.width > 1)) throw new Error('量不出尺寸');
        var 克隆 = 画布.cloneNode(true);
        克隆.removeAttribute('transform');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.appendChild(克隆);
        var pad = 6, k = 缩放 || 0.72;
        var w = bb.width + pad * 2, h = bb.height + pad * 2;
        var 目标宽 = Math.round(w * k), 目标高 = Math.max(18, Math.round(h * 目标宽 / w));
        svg.setAttribute('viewBox', (bb.x - pad) + ' ' + (bb.y - pad) + ' ' + w + ' ' + h);
        svg.setAttribute('width', 目标宽 + 'px');
        svg.setAttribute('height', 目标高 + 'px');
        svg.classList.add('bb-thumb-svg');
        var row = el('div', 'bb-rows-item');
        row.style.paddingLeft = Math.min(30, i * 3) + 'px';
        row.appendChild(svg);
        box.appendChild(row);
        成功++;
      } catch (e) {
        var pill = el('div', 'bb-sk-pill', 块名表[t] || t);
        pill.style.background = 块类色(t);
        var row2 = el('div', 'bb-rows-item');
        row2.style.paddingLeft = Math.min(30, i * 3) + 'px';
        row2.appendChild(pill);
        box.appendChild(row2);
      }
    });
    window.__compOptions = 旧桩;
    if (!成功) return null;
    try { diagPush('积木逐块图', '整链画不出，已改用逐块展示（' + 成功 + '/' + 类型.length + ' 块）'); } catch (e) {}
    return box;
  }

  /** 一段 XML → 缩略图节点（原尺寸=按 缩放 显示，装不下就横向滚动；否则等比缩放到 maxW 宽） */
  function 块缩略图(xml, maxW, 原尺寸, 缩放) {
    if (!xml) return null;
    var 活图 = null;
    活图失败 = '';
    try { 活图 = 活块缩略图(xml, maxW, 原尺寸, 缩放); } catch (e) { 活图 = null; 活图失败 = String((e && e.message) || e); }
    if (活图) return 活图;
    return 积木示意(xml, 活图失败 || '真工作区没画出来');
  }
  /** 旧实现（克隆 SVG 再裁剪）：排版上下文会丢，字体宽度对不上，已弃用，只留作对照 */
  function 旧块缩略图(xml, maxW, 原尺寸, 缩放) {
    var 失败原因 = '';
    var ws = 取缩略图工作区();
    if (!ws) return 积木示意(xml, '离屏工作区没建起来');
    if (!xml) return null;
    try {
      try { if (!ws.getVariableMap().getVariableByName('分数')) ws.createVariable('分数'); } catch (e) {}
      var 旧桩 = window.__compOptions;
      window.__compOptions = 缩略图组件桩;      // 让控件下拉显示"按钮/文字…"而不是长占位符
      function 装载(x) {
        ws.clear();
        var dom = Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">' + x + '</xml>');
        return Blockly.Xml.domToWorkspace(dom, ws);
      }
      var created = null;
      try { created = 装载(xml); }
      catch (e1) {
        失败原因 = '加载失败:' + (e1 && e1.message ? e1.message : e1);
        // 兜底一：去掉 mutation（"如果/否则"这类块带 mutation，个别版本加载会挑食）
        try { created = 装载(String(xml).replace(/<mutation[^>]*\/?>(<\/mutation>)?/g, '')); }
        catch (e2) {
          // 兜底二：只画第一段顶层积木，至少让用户看到东西，而不是一片空白
          try { created = 装载(首个顶层块(xml)); } catch (e3) { created = null; }
        }
      }
      window.__compOptions = 旧桩;
      if (!created || !created.length) return 逐块缩略图(xml, 缩放) || 积木示意(xml, 失败原因 || '没建出积木');
      var bb = null;
      try {
        // 离屏工作区没经过"布局/滚动"流程，getBlocksBoundingBox 常常量不出尺寸；
        // 直接用 SVG 的 getBBox（在画布自己的坐标系里量，和积木坐标一致，最可靠）
        var canvas = ws.getParentSvg() && ws.getParentSvg().querySelector('.blocklyBlockCanvas');
        if (canvas && canvas.getBBox) bb = canvas.getBBox();
      } catch (e) { bb = null; }
      if (!bb || !isFinite(bb.x) || !(bb.width > 1) || !(bb.height > 1)) {
        // 兜底一：把各顶层块的宽高加起来（getHeightWidth 不依赖 SVG 测量）
        try {
          var 最大宽 = 0, 总高 = 0;
          created.forEach(function (b) {
            var hw = b.getHeightWidth ? b.getHeightWidth() : null;
            if (!hw) return;
            if (hw.width > 最大宽) 最大宽 = hw.width;
            总高 += hw.height + 8;
          });
          if (最大宽 > 1) bb = { x: 0, y: 0, width: 最大宽, height: 总高 || 40 };
        } catch (e) { bb = null; }
      }
      if (!bb || !(bb.width > 1)) {
        // 兜底二：整条链子画不出来 → 逐块画（单块在真机上一直没问题）
        return 逐块缩略图(xml, 缩放) || 积木示意(xml, 失败原因);
      }
      var src = ws.getParentSvg();
      if (!src) return null;
      var 画布 = src.querySelector('.blocklyBlockCanvas');
      if (!画布) return null;
      var 画布克隆 = 画布.cloneNode(true);
      画布克隆.removeAttribute('transform');       // 去掉滚动/缩放，缩略图从积木本身开始量
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.appendChild(画布克隆);
      var pad = 8, k = 缩放 || 1;
      var w = bb.width + pad * 2, h = bb.height + pad * 2;
      var 目标宽 = 原尺寸 ? Math.round(w * k) : Math.min(maxW, Math.round(w * k));
      var 目标高 = Math.max(20, Math.round(h * 目标宽 / w));
      svg.setAttribute('viewBox', (bb.x - pad) + ' ' + (bb.y - pad) + ' ' + w + ' ' + h);
      svg.setAttribute('width', 目标宽 + 'px');
      svg.setAttribute('height', 目标高 + 'px');
      svg.classList.add('bb-thumb-svg');
      var box = el('div', 'bb-thumb' + (原尺寸 ? ' bb-thumb-scroll' : ''));
      // 关键：渲染器的样式是按 `.fastzelos-renderer.zelos-theme` 作用域写的
      // （包括"文字白色加粗""输入框底色"），克隆出来的 SVG 必须待在这个作用域里，
      // 否则文字变黑、输入框变黑块（用户截图反馈的正是这个）
      box.classList.add('fastzelos-renderer', 'zelos-theme');
      box.appendChild(svg);
      return box;
    } catch (e) { return null; }
  }

  /**
   * 帮助条目 → 对应积木的 XML。
   * 帮助数据里写的是"文字写法"（sig）。这里用关键词把最常见的那些对到真实积木类型上，
   * 对不上就返回空（界面会退回显示文字写法，不会出错）。
   */
  var 帮助块关键词 = [
    // 顺序很关键：越具体的规则越靠前（后面的通用规则不会抢走它们）
    [/当页面首次启动/, 'ev_first_start'], [/当页面启动/, 'ev_start'], [/滑动|上滑|下滑|左滑|右滑/, 'ev_swipe'],
    [/列表项被点击|项被点击/, 'ev_itemclick'], [/被点击/, 'ev_click'], [/值改变|内容改变|选择改变/, 'ev_change'],
    [/跳出循环/, 'controls_flow_statements'], [/循环变量/, 'controls_for'], [/当\/直到|重复 当/, 'controls_whileUntil'],
    [/重复.*次/, 'controls_repeat_ext'], [/如果/, 'controls_if'], [/等待/, 'act_wait'],
    [/将（变量）设为|将\(变量\)设为/, 'variables_set'], [/改变（变量）|改变\(变量\)/, 'math_change'],
    [/（变量）的值|\(变量\)的值/, 'variables_get'],
    [/随机小数/, 'val_random_frac'], [/随机整数/, 'val_random_int'],
    [/数字 0|^数字$/, 'math_number'], [/\+ − × ÷|四则|加减乘除/, 'math_arithmetic'], [/平方根|绝对值/, 'math_single'],
    [/= \/ ≠|< \/ >|比较/, 'logic_compare'], [/与 \/ 或|且|或者/, 'logic_operation'], [/不成立|取反/, 'logic_negate'],
    [/真 \/ 假/, 'logic_boolean'],
    [/拼接/, 'text_join'], [/文本长度/, 'text_length'], [/转换为/, 'val_cast'], [/“文本”/, 'text'],
    [/建立列表|放在一起/, 'lists_create_with'], [/列表长度/, 'lists_length'],
    [/颜色选择器/, 'colour_picker'], [/合成颜色|红（数）绿/, 'colour_rgb'],
    [/所有表格名称/, 'cloud_tables'], [/SQL 查询/, 'cloud_sql'], [/行数/, 'cloud_count'],
    [/取行 Id|取.*Id.*的一行/, 'cloud_row_by_id'], [/新增一行/, 'cloud_add'], [/更新表/, 'cloud_update'],
    [/删除表/, 'cloud_delete'], [/字段 列名|取（一行）的字段/, 'cloud_field'], [/查询表/, 'cloud_rows'],
    [/弹出提示/, 'act_toast'], [/跳转到页面/, 'act_goto'], [/返回上一页/, 'act_back'],
    [/设备/, 'val_device_info'], [/震动/, 'act_vibrate'], [/屏幕亮度/, 'act_set_brightness'], [/常亮/, 'act_keep_screen'],
    [/复制文本|复制/, 'act_copy'], [/退出应用|退出/, 'act_exit'],
    [/剪贴板/, 'val_clipboard'], [/打开网址/, 'act_open_url'], [/发通知/, 'act_notify'],
    [/读取网址|GET/, 'act_http_get'], [/提交到网址|POST/, 'act_http_post'],
    [/拍照|选图/, 'act_pick_image'], [/表格|图表/, 'act_set_data'],
    [/计时器|倒计时/, 'act_timer_start'], [/显示到/, 'act_set_text'],
    [/显示/, 'act_show'], [/隐藏/, 'act_hide'], [/停用/, 'act_disable'], [/启用/, 'act_enable'],
    [/旋转/, 'act_set_rot'], [/透明度/, 'act_opacity'], [/背景色|背景颜色/, 'act_set_bg'], [/文字颜色/, 'act_set_color'],
    [/取文本|输入框的内容/, 'val_get_text']
  ];
  function 帮助条目XML(bk) {
    if (!bk) return '';
    if (bk.t) return 条目块XML(bk.t);
    var 文本 = String(bk.sig || '') + ' ' + String(bk.desc || '');
    for (var i = 0; i < 帮助块关键词.length; i++) {
      if (帮助块关键词[i][0].test(文本)) {
        var t = 帮助块关键词[i][1];
        if (Blockly.Blocks[t]) return 条目块XML(t);
      }
    }
    return '';
  }
  /** 单个块的缩略 XML：变量类的块补上变量名/数值，免得显示"（变量）"这种占位符 */
  function 条目块XML(t) {
    if (块默认手写[t]) return 块默认手写[t];
    if (t === 'math_change') return '<block type="math_change"><field name="VAR">分数</field>'
      + '<value name="DELTA"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>';
    if (t === 'variables_set') return '<block type="variables_set"><field name="VAR">分数</field>'
      + '<value name="VALUE"><shadow type="math_number"><field name="NUM">0</field></shadow></value></block>';
    if (t === 'variables_get') return '<block type="variables_get"><field name="VAR">分数</field></block>';
    return '<block type="' + t + '"></block>';
  }

  /* ---------------- 进阶技巧（独立页面：左侧列表 / 右侧展示） ----------------
     用户要求：入口放在「使用技巧」页右上角，点进去是**新页面**不是弹窗；
     左边是技巧名单，点一条右边就换内容；不要「用这个拼法」按钮；积木要小；内容要真的"进阶"。 */
  function 块(x) { return x; }
  var ADV_TIPS = [
    {
      name: '① 上滑翻页 + 防连点',
      desc: '滑动翻页很容易"一次滑动触发好几页"。这里用"停用 → 等 1 秒 → 启用"做一个简单的锁。',
      notes: ['滑动事件里先判断距离，超过 120 像素才翻页（轻轻一划不算）',
              '翻页动作放在"如果"里面；外面那层等待用来避免连续触发'],
      xml: '<block type="ev_swipe"><field name="DIR">up</field><next>'
        + '<block type="controls_if"><value name="IF0"><block type="logic_compare">'
        +   '<field name="OP">GT</field>'
        +   '<value name="A"><block type="val_swipe_dist"></block></value>'
        +   '<value name="B"><shadow type="math_number"><field name="NUM">120</field></shadow></value>'
        + '</block></value><statement name="DO0">'
        +   '<block type="act_vibrate"><value name="MS"><shadow type="math_number"><field name="NUM">20</field></shadow></value><next>'
        +   '<block type="act_goto"></block></next></block>'
        + '</statement></block>'
        + '<next><block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">0.6</field></shadow></value></block></next>'
        + '</block></next></block>'
    },
    {
      name: '② 登录校验（如果…否则…）',
      desc: '点了登录先检查账号是否为空：空就提示，不空就"加载中→跳转"。这是最典型的表单流程。',
      notes: ['"如果"块要展开出"否则"（点块上的齿轮 + 一次）',
              '"账号"的输入内容用"输入框的内容"取值，和空文本比较',
              '两个分支都接在同一个事件帽子下面'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="controls_if"><mutation else="1"></mutation>'
        +   '<value name="IF0"><block type="logic_compare"><field name="OP">EQ</field>'
        +     '<value name="A"><block type="val_get_text"><field name="COMP">input1</field></block></value>'
        +     '<value name="B"><shadow type="text"><field name="TEXT"></field></shadow></value>'
        +   '</block></value>'
        +   '<statement name="DO0"><block type="act_toast">'
        +     '<value name="MSG"><shadow type="text"><field name="TEXT">请先输入账号</field></shadow></value>'
        +     '<value name="DUR"><shadow type="math_number"><field name="NUM">2</field></shadow></value></block></statement>'
        +   '<statement name="ELSE"><block type="act_toast">'
        +     '<value name="MSG"><shadow type="text"><field name="TEXT">正在登录…</field></shadow></value><next>'
        +     '<block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value><next>'
        +     '<block type="act_goto"></block></next></block></next></block></statement>'
        + '</block></next></block>'
    },
    {
      name: '③ 读接口 → 取字段 → 显示',
      desc: '典型的三步走：先用"读取网址"把 JSON 拿回来看得见，再用"取字段"从里面挑出想要的那一项。',
      notes: ['第一步把整段返回显示到文字控件，方便调试',
              '第二步用"从文本…取字段"包住"控件文本"，把 name 字段取出来',
              '接口换了字段名，只改第二步里的字段就行'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="act_http_get"><field name="COMP">text1</field>'
        +   '<value name="URL"><shadow type="text"><field name="TEXT">https://example.com/api</field></shadow></value><next>'
        + '<block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">0.5</field></shadow></value><next>'
        + '<block type="act_set_text"><field name="COMP">text1</field>'
        +   '<value name="VALUE"><block type="val_http_json">'
        +     '<value name="TEXT"><block type="val_get_text"><field name="COMP">text1</field></block></value>'
        +     '<value name="KEY"><shadow type="text"><field name="TEXT">name</field></shadow></value>'
        +   '</block></value></block></next></block></next></block></next></block>'
    },
    {
      name: '④ 倒计时 + 进度条 + 到点提示',
      desc: '点一下开始：计时器跑 10 秒、进度条先满、10 秒后进度清零并提示完成。',
      notes: ['"开始计时"里的秒数就是倒计时长度（计时器控件要设成倒计时模式）',
              '等待的秒数要和倒计时一致，不然会出现"进度和提示不同步"',
              '用等待做延时最简单；要精确到毫秒就自己在代码里算时间'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="act_set_progress"><field name="COMP">progress1</field>'
        +   '<value name="VALUE"><shadow type="math_number"><field name="NUM">100</field></shadow></value><next>'
        + '<block type="act_timer_start"><field name="COMP">timer1</field>'
        +   '<value name="SECS"><shadow type="math_number"><field name="NUM">10</field></shadow></value><next>'
        + '<block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">10</field></shadow></value><next>'
        + '<block type="act_set_progress"><field name="COMP">progress1</field>'
        +   '<value name="VALUE"><shadow type="math_number"><field name="NUM">0</field></shadow></value><next>'
        + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">时间到</field></shadow></value></block>'
        + '</next></block></next></block></next></block></next></block>'
    },
    {
      name: '⑤ 计数器（变量 + 加法 + 显示）',
      desc: '用一个变量记住点了几次：每点一下 +1，然后把变量显示到文字上。',
      notes: ['变量在左边"变量"分类里新建（例如"次数"）',
              '"把…增加 1"就是数学变化块，DELTA 接数字',
              '显示时用"取得变量"取值再接到"设置文本"'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="math_change"><field name="VAR">次数</field>'
        +   '<value name="DELTA"><shadow type="math_number"><field name="NUM">1</field></shadow></value><next>'
        + '<block type="act_set_text"><field name="COMP">text1</field>'
        +   '<value name="VALUE"><block type="variables_get"><field name="VAR">次数</field></block></value>'
        + '</block></next></block></next></block>'
    },
    {
      name: '⑥ 每 3 秒提醒一次（重复 3 次）',
      desc: '"重复"块里放"提示 + 等待"，就能做定时提醒，而不会把界面卡住。',
      notes: ['重复次数接数字（这里 3 次）',
              '提示和等待都要放进"重复"的嘴里',
              '等待用小数（例如 2.5）也可以'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="controls_repeat_ext">'
        +   '<value name="TIMES"><shadow type="math_number"><field name="NUM">3</field></shadow></value>'
        +   '<statement name="DO"><block type="act_toast">'
        +     '<value name="MSG"><shadow type="text"><field name="TEXT">该休息一下了</field></shadow></value><next>'
        +     '<block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">3</field></shadow></value></block>'
        +   '</next></block></statement></block></next></block>'
    },
    {
      name: '⑦ 卡片来回切换显示/隐藏',
      desc: '一个按钮当开关：先把卡片藏起来，等 1 秒再显示出来，做"翻卡片"效果。',
      notes: ['隐藏/显示都按控件来，容器和卡片都能用',
              '要做真正的开关，就用变量记录"现在是开还是关"再判断'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="act_hide"><field name="COMP">card1</field><next>'
        + '<block type="act_wait"><value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value><next>'
        + '<block type="act_show"><field name="COMP">card1</field><next>'
        + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">欢迎回来</field></shadow></value></block>'
        + '</next></block></next></block></next></block></next></block>'
    },
    {
      name: '⑧ 滑一下就加载更多',
      desc: '向上滑动时往列表里加一项并给个反馈，做简单的"加载更多"。',
      notes: ['列表项用"给列表加一项"追加',
              '加完给个震动/提示，用户才知道生效了',
              '真实项目里通常先请求接口，再把返回的条目逐条加进去'],
      xml: '<block type="ev_swipe"><field name="DIR">up</field><next>'
        + '<block type="act_list_add"><field name="COMP">list1</field>'
        +   '<value name="VALUE"><shadow type="text"><field name="TEXT">新的一项</field></shadow></value><next>'
        + '<block type="act_vibrate"><value name="MS"><shadow type="math_number"><field name="NUM">20</field></shadow></value><next>'
        + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">已加载更多</field></shadow></value></block>'
        + '</next></block></next></block></next></block>'
    },
    {
      name: '⑨ 拍照 → 震动 → 提示（一条完整的交互链）',
      desc: '点一下按钮：打开相机/相册 → 选好图后震动一下 → 再弹一句提示，用户能明显感到"成功了"。',
      notes: ['"拍照或选图"要选图片控件（下拉里只有图片控件）',
              '真机会先要一次照片权限，允许一次之后就不再问',
              '选完图会继续执行后面的动作，所以可以把提示接在后面'],
      xml: '<block type="ev_click"><field name="COMP">button1</field><next>'
        + '<block type="act_pick_image"><field name="COMP">image1</field><next>'
        + '<block type="act_vibrate"><value name="MS"><shadow type="math_number"><field name="NUM">30</field></shadow></value><next>'
        + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">图片已更新</field></shadow></value></block>'
        + '</next></block></next></block></next></block>'
    },
    {
      name: '⑩ 打开就做一次"体检"（读设备信息）',
      desc: '页面一打开就把电量、内存、帧率读回来显示，做成一个小仪表盘，也方便排性能问题。',
      notes: ['设备信息块的下拉里有很多项，一个一个换成你关心的',
              '接三行"设置文本"就能同时显示三项',
              '帧率会每秒刷新一次采样值'],
      xml: '<block type="ev_start"><next>'
        + '<block type="act_set_text"><field name="COMP">text1</field>'
        +   '<value name="VALUE"><block type="val_device_info"></block></value><next>'
        + '<block type="act_set_text"><field name="COMP">text2</field>'
        +   '<value name="VALUE"><block type="val_device_info"></block></value><next>'
        + '<block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">设备信息已就绪</field></shadow></value></block>'
        + '</next></block></next></block></next></block>'
    }
  ];
  var tipsCurrent = 0;
  function openTips() {
    syncHomeVersion && syncHomeVersion();
    $('viewHome').classList.add('hidden');
    $('viewHelp').classList.add('hidden');
    var v = $('viewTips');
    if (v) { v.classList.remove('hidden'); 切页(v, 'fwd'); }
    tipsCurrent = 0;
    渲染技巧列表();
    显示技巧(0);
  }
  function closeTips() {
    var v = $('viewTips'); if (v) v.classList.add('hidden');
    openHelp();
  }
  function 渲染技巧列表() {
    var box = $('tipsList'); if (!box) return;
    box.innerHTML = '';
    ADV_TIPS.forEach(function (t, i) {
      var b = el('button', 'tips-item' + (i === tipsCurrent ? ' on' : ''), t.name);
      b.type = 'button';
      b.addEventListener('click', function () { 显示技巧(i); });
      box.appendChild(b);
    });
  }
  function 显示技巧(i) {
    tipsCurrent = i;
    var t = ADV_TIPS[i]; if (!t) return;
    Array.prototype.forEach.call(document.querySelectorAll('#tipsList .tips-item'), function (b, k) {
      b.classList.toggle('on', k === i);
    });
    var box = $('tipsBody'); if (!box) return;
    清活图($('tipsBody'));   // 只清进阶技巧这一栏里的旧图
    box.innerHTML = '';
    box.appendChild(el('div', 'tips-title', t.name));
    box.appendChild(el('div', 'tips-desc', t.desc));
    // 图就按面板宽度、缩到一半画出来（整条链子一眼看全，不需要滑动，也没有"放大看细节"那一套）
    var 面板宽 = Math.max(220, ($('tipsBody') ? $('tipsBody').clientWidth - 44 : 520));
    var pic = 块缩略图(t.xml, 面板宽, false, 0.5);
    if (pic) box.appendChild(pic);
    if (t.notes && t.notes.length) {
      var ul = el('div', 'tips-notes');
      t.notes.forEach(function (n) { ul.appendChild(el('div', 'tips-note', '· ' + n)); });
      box.appendChild(ul);
    }
    box.scrollTop = 0;
  }

  /**
   * 帮助内容补充（用户反馈：帮助里很多内容没更新）。
   * 不改 blocks.js 里那一大坨数据，而是在渲染前"打补丁"：新增「新功能」一组、
   * 给「事件」补滑屏、给「设备」补拍照选图。
   */
  /* 帮助漏掉的分类（对着工具箱的 13 个分类核对过：缺「网络」和「函数」） */
  function 补帮助漏掉的分类() {
    var H = window.BB_HELP; if (!H || H.__catsPatched) return;
    H.__catsPatched = true;
    H.general = H.general || [];
    function 有(名) { return H.general.some(function (g) { return g.cat === 名; }); }
    if (!有('网络')) H.general.push({ cat: '网络', colour: '#00838F',
      intro: '在代码里直接访问网址：取回内容、提交数据、从 JSON 里取字段。',
      blocks: [
        { t: 'act_http_get', sig: '读取网址…', desc: '向一个 http/https 网址发 GET 请求，把返回内容存下来。', use: '接在事件里，再用「取 JSON 字段」读里面的数据。' },
        { t: 'act_http_post', sig: '提交到网址…', desc: '把内容按 JSON 提交给服务器（表单、上报都能用）。', use: '先用「拼文本」把要提交的内容拼成 JSON。' },
        { t: 'val_http_json', sig: '取 JSON 字段…', desc: '把 JSON 文本里某个字段的值取出来。', use: '接在「读取网址」的结果后面。' }
      ] });
    if (!有('函数')) H.general.push({ cat: '函数', colour: '#7B1FA2',
      intro: '把反复要用的代码做成函数，起个名字，以后一句话就能调用。',
      blocks: [
        { t: 'procedures_defnoreturn', sig: '定义函数', desc: '定义一个函数，里面放要做的事。', use: '定义好以后会出现在「调用」下拉里。' },
        { t: 'procedures_defreturn', sig: '定义函数（有返回值）', desc: '定义一个会算出结果的函数。', use: '用「返回」把结果交回去。' },
        { t: 'procedures_callnoreturn', sig: '调用函数', desc: '执行之前定义好的函数。', use: '下拉里选函数名。' }
      ] });
  }
  function 补充帮助新内容() {
    var H = window.BB_HELP;
    if (!H || H.__patched) return;
    H.__patched = true;
    H.general = H.general || [];
    function 找组(名) {
      for (var i = 0; i < H.general.length; i++) if (H.general[i].cat === 名) return H.general[i];
      return null;
    }
    var 事件组 = 找组('事件');
    if (事件组) {
      事件组.blocks = (事件组.blocks || []).concat([
        { t: 'ev_swipe', sig: '当页面被〔方向〕滑动时 / 执行…',
          desc: '在页面上滑动手指时执行；下拉可选"任意方向 / 向上滑 / 向下滑 / 向左滑 / 向右滑"。',
          use: '滑动手势的起点。位移超过 30 像素才算一次滑动（手指抖一下不算），方向按位移大的那个轴判定。' },
        { t: 'val_swipe_dist', sig: '这次滑动的距离（像素）',
          desc: '最近一次滑动的直线距离，单位像素；没滑过是 0。',
          use: '接到"如果"里做判断（例如滑动距离超过 200 才翻页），或接"设置文本"显示出来。' },
        { t: 'val_swipe_dir', sig: '这次滑动的方向',
          desc: '最近一次滑动的方向：上滑 / 下滑 / 左滑 / 右滑；没滑过是空。',
          use: '接"如果"配合"等于"判断具体方向。' }
      ]);
    }
    var 设备组 = 找组('设备');
    if (设备组) {
      设备组.blocks = (设备组.blocks || []).concat([
        { t: 'act_pick_image', sig: '拍照或选图，显示到〔图片控件〕',
          desc: '打开相机拍照（没有相机就打开相册），选好的图片直接显示到指定图片控件里。',
          use: '把"显示到"换成你的图片控件。真机会优先调用系统相机/相册；选图时要允许一次"照片"权限。' }
      ]);
    }
    var 新组 = {
      cat: '新功能', colour: '#6750A4',
      intro: '这一版新加的能力：容器、表格、图表、网络请求、模板库、历史版本、进阶技巧。',
      blocks: [
        { t: 'container', sig: '容器（把控件装在一起）',
          desc: '真正的分组控件：放进容器的控件会跟着容器一起动，坐标相对于容器，拖出容器就回到页面。',
          use: '先放一个"容器"，再把别的控件卡片上的 ⇲ 点一下装进去；容器里的控件点 ↰ 可以移出。设计、排版、运行三处位置完全一致。' },
        { t: 'scroll', sig: '滚动区（内容比它高时可以上下滑动）',
          desc: '可以装别的控件的容器；里面的内容比它高时，运行时上下滑动查看，不会把页面撑破。',
          use: '先放"滚动区"，再把控件卡片的 ⇲ 装进去；适合长列表、长说明。' },
        { t: 'bottomNav', sig: '底部导航（底部一排按钮）',
          desc: '底部一排按钮，点一下高亮切换；属性里写"导航项（每行一个）"和默认选中第几个。',
          use: '放在页面最下方；配"当〔底部导航〕的值变了"就能在切换时换内容。' },
        { t: 'table', sig: '表格（表头 + 多行数据）',
          desc: '按行按列显示数据；属性面板里写"表头（逗号分隔）"和"每行数据（一行一条）"。',
          use: '固定数据直接写在属性面板；要动态换数据就用代码块"把〔表格〕的数据设为〔文字〕"。' },
        { t: 'chart', sig: '图表（柱状 / 折线 / 饼图）',
          desc: '三种图型，数据一行一条写"名称,数值"（也可以只写数值）。',
          use: '配"把〔图表〕的数据设为〔文字〕"就能用代码刷新图表；颜色取控件的文字颜色。' },
        { t: 'act_set_data', sig: '把〔表格/图表〕的数据设为〔文字〕',
          desc: '用文字描述数据，运行时立刻重画。表格：第一行表头、其余每行一条、逗号分隔；图表：每行"名称,数值"。',
          use: '常接在"读取网址"后面：拿到服务器返回的文字→整理成表格/图表要的格式→设进去。' },
        { t: 'act_http_get', sig: '读取网址（GET）显示到〔控件〕',
          desc: '向一个 http/https 网址发起 GET 请求，把返回的文字显示到指定控件（最多 500 字）。',
          use: '真机走系统网络请求，不受网页跨域限制。取回来的如果是 JSON，用"从文本…取字段"把想要的字段挑出来。' },
        { t: 'act_http_post', sig: '提交到网址（POST）内容…',
          desc: '把内容按 JSON 提交给服务器（做成表单/上报数据用）。',
          use: '常放在"点击提交"下面。服务器要什么格式，就把"内容"拼成什么格式。' },
        { t: 'val_http_json', sig: '从文本〔…〕取字段〔…〕',
          desc: '把 JSON 文本里某个字段的值取出来；取不到就是空。',
          use: '配合"读取网址"：先读回来，再取字段，最后显示或参与判断。' },
        { t: 'val_device_info', sig: '设备信息（帧率/电量/内存/温度…）',
          desc: '下拉选择要读的设备信息：FPS、刷新率、CPU、GPU、内存、电量、温度、网络类型、亮屏尺寸、型号等。',
          use: '接到"设置文本"上做一个小仪表盘；也可以接"如果"做低电量提醒。' }
      ]
    };
    var 已有 = H.general.map(function (g) { return g.cat; });
    if (已有.indexOf('新功能') < 0) H.general.unshift(新组);
  }

  function renderHelpCat(group) {
    清活图($('helpContent')); // 只清帮助正文里的旧图（别误杀其它页面上的）
    var box = $('helpContent'); box.innerHTML = '';
    var head = el('div', 'hp-cat-head');
    var dot = el('span', 'hp-cat-dot'); dot.style.background = group.colour;
    var title = el('span', 'hp-cat-title', group.cat);
    head.appendChild(dot); head.appendChild(title); box.appendChild(head);
    if (group.intro) { var inr = el('div', 'hp-intro', group.intro); box.appendChild(inr); }
    (group.blocks || []).forEach(function (bk) {
      var card = el('div', 'hp-block');
      // 先用真积木画一张图（用户要求：条目要和积木一一对应，这样才看得懂）；
      // 认不出对应哪块积木时，退回显示原来的文字写法
      var 图 = 块缩略图(bk.t ? 块默认XML(bk.t) : 帮助条目XML(bk), 210, false, 0.85);
      if (图) card.appendChild(图);
      else { var sig = el('div', 'hp-sig', bk.sig); sig.style.background = group.colour; card.appendChild(sig); }
      var 文本列 = el('div', 'hp-text');
      var desc = el('div', 'hp-desc', bk.desc); 文本列.appendChild(desc);
      if (bk.use) {
        var use = el('div', 'hp-use');
        var tag = el('span', 'hp-use-tag', '用法'); var ut = el('span', 'hp-use-tx', bk.use);
        use.appendChild(tag); use.appendChild(ut); 文本列.appendChild(use);
      }
      card.appendChild(文本列);
      box.appendChild(card);
      return;
    });
    box.scrollTop = 0;
  }
  function fmtTime(t) {
    var d = new Date(t || Date.now()), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderHome() {
    // 卡片上的「管理」要先跟社区表核对（见 刷新我的社区iD）：读过就直接用缓存，没读过才去读
    刷新我的社区iD();
    var s = loadStore(), box = $('projectList'); box.innerHTML = '';
    var empty = $('homeEmpty');
    // 坏掉的本地作品条目（project 为空）不该让整个首页画不出来 —— 跳过它，别把列表卡死
    s.items = (s.items || []).filter(function (it) { return it && it.project && Array.isArray(it.project.screens); });
    empty.classList.toggle('hidden', s.items.length > 0);
    empty.textContent = s.items.length ? '' : '点击右上角「创建新 App」开始';
    // 排序跟着设置走：auto = 最近改过的在最前；manual = 保持存储里的顺序（长按拖出来的顺序）
    var 排序后 = s.items.slice();
    if (getProjSort() !== 'manual') 排序后.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    排序后.forEach(function (it, 序) {
      var n = it.project.screens.reduce(function (a, x) { return a + x.components.length; }, 0);
      var card = el('div', 'proj-card');
      card.dataset.id = it.id;
      // 右上角分享按钮（绝对定位贴角）；单独绑定并阻止冒泡，免得连带触发卡片的双击打开
      var share = el('button', 'p-share');
      share.type = 'button';
      share.title = '分享这个作品';
      share.setAttribute('aria-label', '分享「' + (it.name || '未命名') + '」');
      share.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 16.1c-.8 0-1.5.3-2 .8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.1c.6.5 1.3.8 2 .8a3 3 0 1 0-3-3c0 .3 0 .5.1.7L8 9.8A3 3 0 1 0 8 14.2l7.1 4.2c-.1.2-.1.4-.1.6a2.9 2.9 0 1 0 3-2.9z"/></svg>';
      share.addEventListener('click', function (e) { e.stopPropagation(); openShareSheet(it.id); });
      card.appendChild(share);
      // 发布过社区的作品，在分享按钮**左边**加一个「管理」；取消过分享的本机不再显示
      if (projectShared(it.project && it.project.shareId)) {
        var mg = el('button', 'p-manage', '管理');
        mg.type = 'button';
        mg.title = '管理社区分享';
        mg.setAttribute('aria-label', '管理「' + (it.name || '未命名') + '」的社区分享');
        mg.addEventListener('click', function (e) { e.stopPropagation(); openCommunityManage(it.id); });
        card.appendChild(mg);
      }
      card.appendChild(el('div', 'pname', it.name || '未命名'));
      card.appendChild(el('div', 'pmeta', it.project.screens.length + ' 个页面 · ' + n + ' 个组件\n更新于 ' + fmtTime(it.updatedAt).replace('\n', ' ')));
      card.querySelector('.pmeta').innerHTML = it.project.screens.length + ' 个页面 · ' + n + ' 个组件<br>更新于 ' + fmtTime(it.updatedAt);
      var ops = el('div', 'pops');
      var open = el('button', null, '打开编辑'), dup = el('button', null, '复制'),
          del = el('button', 'danger', '删除');
      open.addEventListener('click', function () { openItem(it.id); });
      dup.addEventListener('click', function () { duplicateItem(it.id); });
      del.addEventListener('click', function () {
        var msg = el('div'); msg.appendChild(document.createTextNode('确定删除作品「'));
        var nm = el('span', 'confirm-name', it.name || '未命名'); msg.appendChild(nm); msg.appendChild(document.createTextNode('」？'));
        confirmDialog({ title: '删除作品', msg: msg, okText: '删除' }).then(function (ok) { if (ok) deleteItem(it.id); });
      });
      ops.appendChild(open); ops.appendChild(dup);
      // 历史版本：改动大之前系统会自动存一份，"改坏了"可以在这里找回（用户要求：一键回到上次能跑的状态）
      var his = el('button', null, '历史');
      his.addEventListener('click', function (e) { e.stopPropagation(); openHistory(it.id); });
      ops.appendChild(his);
      ops.appendChild(del);
      card.appendChild(ops); card.addEventListener('dblclick', function () { openItem(it.id); });
      错峰(card, 序);
      bindHomeReorder(card, it.id);      // 长按卡片拖动换位置
      box.appendChild(card);
    });
  }

  /* ---------------- 首页：作品排序设置 + 长按拖动换位 ---------------- */
  var PROJ_SORT_KEY = '__bb_proj_sort';        // 'auto'（默认）| 'manual'
  function getProjSort() {
    var v = null; try { v = localStorage.getItem(PROJ_SORT_KEY); } catch (e) {}
    return v === 'manual' ? 'manual' : 'auto';
  }
  function setProjSort(v) {
    try { localStorage.setItem(PROJ_SORT_KEY, v === 'manual' ? 'manual' : 'auto'); } catch (e) {}
    buildSettings();
    if ($('viewHome') && !$('viewHome').classList.contains('hidden')) renderHome();
  }
  /**
   * 长按卡片（约 0.5 秒）后拖动换位置。
   *
   * 2026-10-29 第二次重做（前一版用 FLIP 反复插 DOM，用户反馈"一塌糊涂"）。这次的做法：
   *  · **拖动期间一棵 DOM 都不动**。起拖时把每张卡所在的格子量下来（内容坐标），
   *    之后"让位"全部只是给别的卡写 transform（挂 .proj-shift 的 180ms 过渡），布局一次都不重排。
   *  · 被拖的那张卡留在格子里但 visibility:hidden（照样占位，网格不会重排）；
   *    真正跟手的是一个 fixed 的克隆影子卡，只动 transform。
   *  · 落点 = 手指所在的格子：点在格子里就取那个格子，落在间隙里才按最近的格子算。
   *    格子是静止的几何，所以手指跨过边界时才会换目标一次，不会在分界线上来回抖。
   *  · 手指停在屏幕上下边缘时自动滚屏（rAF 循环），否则被挡住的那几张卡永远拖不过去。
   *  · 松手：先撤过渡 → 把卡片插到最终位置 → 再清 transform。顺序不能反，
   *    反了就会"啪"地跳一下（视觉位置和落点其实是同一个地方）。
   *  · 只写作品顺序，**不改**「自动调整 / 不调整排序」这个设置（用户 2026-10-29 明确要求）。
   */
  function bindHomeReorder(card, id) {
    var 计时 = null, 拖 = false;
    var 起X = 0, 起Y = 0, 抓x = 0, 抓y = 0;
    var 指针X = 0, 指针Y = 0, 滚RAF = 0;
    var 影子 = null, 占位 = null, 槽 = null, 卡们 = null, 拖位 = 0, 目标 = -1;

    function 清计时() { if (计时) { clearTimeout(计时); 计时 = null; } }
    function 拦滚动(e) { if (拖 && e.cancelable) e.preventDefault(); }
    function 列表() { return $('projectList'); }
    function 可滚容器() {
      var n = $('viewHome');
      return (n && n.scrollHeight > n.clientHeight + 4) ? n : null;
    }
    function 是卡(n) {
      return !!(n && n.nodeType === 1 && n.classList && n.classList.contains('proj-card') && n !== 影子);
    }

    /** 起拖：量格子、放影子、铺虚线占位 */
    function 起拖() {
      计时 = null;
      var box = 列表();
      if (!box || 拖) return;
      卡们 = Array.prototype.slice.call(box.children).filter(是卡);
      if (卡们.length < 2) { 卡们 = null; return; }
      拖位 = 卡们.indexOf(card);
      if (拖位 < 0) { 卡们 = null; return; }
      var br = box.getBoundingClientRect();
      槽 = 卡们.map(function (n) {
        var r = n.getBoundingClientRect();
        return { l: r.left - br.left, t: r.top - br.top, w: r.width, h: r.height };
      });
      var r = card.getBoundingClientRect();
      抓x = 起X - r.left; 抓y = 起Y - r.top;
      拖 = true;
      目标 = -1;
      // 原卡留格子里但不画（visibility:hidden），跟手的是克隆影子
      card.classList.add('proj-holding');
      影子 = card.cloneNode(true);
      影子.removeAttribute('data-id');
      影子.className = 'proj-card proj-ghost';
      影子.style.cssText = 'width:' + r.width + 'px;height:' + r.height + 'px';
      影子.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0) scale(1.02)';
      document.body.appendChild(影子);
      占位 = el('div', 'proj-slot');
      占位.style.left = 槽[拖位].l + 'px';
      占位.style.top = 槽[拖位].t + 'px';
      占位.style.width = 槽[拖位].w + 'px';
      占位.style.height = 槽[拖位].h + 'px';
      box.appendChild(占位);
      for (var i = 0; i < 卡们.length; i++) if (卡们[i] !== card) 卡们[i].classList.add('proj-shift');
      指针X = 起X; 指针Y = 起Y;
      // 手指按住卡片时，只有拦下 touchmove 才能阻止页面跟着滚（pointermove 拦不住滚屏）
      document.addEventListener('touchmove', 拦滚动, { passive: false });
      滚一步();
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    }

    /** 手指落点对应的格子（0..n-1）。点在格子里就取那个格子；落在间隙里才按最近的格子算。 */
    function 命中格(x, y) {
      if (!槽 || !槽.length) return -1;
      var box = 列表();
      if (!box) return -1;
      var br = box.getBoundingClientRect();
      var px = x - br.left, py = y - br.top;
      for (var i = 0; i < 槽.length; i++) {
        var s = 槽[i];
        if (px >= s.l && px <= s.l + s.w && py >= s.t && py <= s.t + s.h) return i;
      }
      var 最近 = Infinity, 最好 = 0;
      for (var j = 0; j < 槽.length; j++) {
        var t = 槽[j], dx = px - (t.l + t.w / 2), dy = py - (t.t + t.h / 2);
        var d = dx * dx + dy * dy;
        if (d < 最近) { 最近 = d; 最好 = j; }
      }
      return 最好;
    }

    /** 把占位块和别的卡片挪到"目标格子"对应的位置（只改 transform，不重排布局） */
    function 排位(x, y) {
      if (!拖 || !槽) return;
      var 格 = 命中格(x, y);
      if (格 < 0 || 格 === 目标) return;
      目标 = 格;
      var s = 槽[格];
      if (占位) { 占位.style.left = s.l + 'px'; 占位.style.top = s.t + 'px'; }
      // 其余卡片：原来在 L 里的第 k 张，最终要落到格子 k + (k >= 格 ? 1 : 0)
      var k = 0;
      for (var i = 0; i < 卡们.length; i++) {
        var n = 卡们[i];
        if (n === card) continue;
        var 到 = 槽[k + (k >= 格 ? 1 : 0)], 起 = 槽[i];
        k++;
        if (!到) { n.style.transform = ''; continue; }
        var dx = 到.l - 起.l, dy = 到.t - 起.t;
        n.style.transform = (dx || dy) ? 'translate3d(' + dx + 'px,' + dy + 'px,0)' : '';
      }
    }

    /** 手指贴在屏幕上下边缘就持续滚屏：不然挡住的卡永远拖不过去（用户 2026-10-29 报的） */
    function 滚一步() {
      滚RAF = 0;
      if (!拖) return;
      var sc = 可滚容器();
      if (sc) {
        var 高 = window.innerHeight || document.documentElement.clientHeight;
        var 边 = Math.max(70, Math.min(130, 高 * .16));
        var v = 0;
        if (指针Y < 边) v = -Math.max(6, Math.round((边 - 指针Y) / 边 * 16));
        else if (指针Y > 高 - 边) v = Math.max(6, Math.round((指针Y - (高 - 边)) / 边 * 16));
        if (v) {
          var 先前 = sc.scrollTop;
          sc.scrollTop = 先前 + v;
          if (sc.scrollTop !== 先前) 排位(指针X, 指针Y);   // 滚了才重算落点
        }
      }
      滚RAF = requestAnimationFrame(滚一步);
    }

    function 移动(e) {
      if (!拖) {
        if (Math.abs(e.clientX - 起X) > 9 || Math.abs(e.clientY - 起Y) > 9) 清计时();   // 在滚动列表，不算长按
        return;
      }
      指针X = e.clientX; 指针Y = e.clientY;
      if (影子) 影子.style.transform = 'translate3d(' + (e.clientX - 抓x) + 'px,' + (e.clientY - 抓y) + 'px,0) scale(1.02)';
      排位(e.clientX, e.clientY);
    }

    function 松手() {
      document.removeEventListener('pointermove', 移动);
      document.removeEventListener('pointerup', 松手, true);
      document.removeEventListener('pointercancel', 松手, true);
      document.removeEventListener('touchmove', 拦滚动);
      清计时();
      if (滚RAF) { cancelAnimationFrame(滚RAF); 滚RAF = 0; }
      if (!拖) return;
      拖 = false;
      var box = 列表();
      var 格 = 目标 >= 0 ? 目标 : 拖位;
      var 旧卡们 = 卡们 || [];
      // 顺序很重要：① 撤过渡 / 去掉影子和占位 ② 插到落点 ③ 最后清 transform —— 反了就会"啪"地跳一下
      if (占位 && 占位.parentNode) 占位.remove();
      占位 = null;
      if (影子 && 影子.parentNode) 影子.remove();
      影子 = null;
      for (var i = 0; i < 旧卡们.length; i++) 旧卡们[i].classList.remove('proj-shift');
      card.classList.remove('proj-holding');
      if (box) {
        var 兄弟 = 旧卡们.filter(function (n) { return n !== card; });
        box.insertBefore(card, 兄弟[格] || null);
        for (var j = 0; j < 旧卡们.length; j++) 旧卡们[j].style.transform = '';
        // 按最终 DOM 顺序写回存储（只写顺序，**不动** __bb_proj_sort）
        var 顺序 = [];
        Array.prototype.forEach.call(box.children, function (n) {
          if (是卡(n) && n.dataset.id) 顺序.push(n.dataset.id);
        });
        var s = loadStore(), map = {};
        (s.items || []).forEach(function (it) { map[it.id] = it; });
        var 新 = 顺序.map(function (i2) { return map[i2]; }).filter(Boolean);
        if (s.items && 新.length === s.items.length) { s.items = 新; saveStore(s); }
      }
      卡们 = null; 槽 = null; 目标 = -1;
    }

    card.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button')) return;   // 卡片上的分享/编辑/删除按钮不参与
      if (document.querySelector('.mask:not(.hidden)')) return;
      起X = e.clientX; 起Y = e.clientY;
      清计时();
      计时 = setTimeout(起拖, 480);
      document.addEventListener('pointermove', 移动);
      document.addEventListener('pointerup', 松手, true);
      document.addEventListener('pointercancel', 松手, true);
    });
  }
  // 创建 App：先弹 M3 对话框（应用名 + 竖/横屏），确认后再建工程
  function setNewOrient(o) {
    state.newOrient = o;
    Array.prototype.forEach.call(document.querySelectorAll('#newOrient .ori'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-orient') === o);
    });
  }
  function createItem() {
    var mask = $('createMask'), inp = $('newAppName');
    if (!mask) { // 兜底：弹窗缺失时维持原“直接创建”行为
      var s0 = loadStore(), it0 = { id: 'p' + Date.now().toString(36), name: '我的应用', updatedAt: Date.now(), project: blankProject() };
      s0.items.push(it0); saveStore(s0); openItem(it0.id); return;
    }
    inp.value = '';
    var box = inp.closest('.m3-outlined'); if (box) box.classList.remove('filled', 'focused', 'err');
    createHint('');                       // 清掉上一次的重名提示
    setNewOrient('portrait');
    syncCreateBtn();
    mask.classList.remove('hidden');
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 120);
  }
  /** 作品名是否已存在（去掉首尾空格、忽略大小写）—— 用户要求：创建新 App 不能重名 */
  function appNameExists(name) {
    var n = String(name == null ? '' : name).trim().toLowerCase();
    if (!n) return false;
    var s = loadStore();
    return s.items.some(function (it) { return String(it.name || '').trim().toLowerCase() === n; });
  }
  /** 重名/空名提示（就地显示在输入框下面，不再弹窗打断） */
  function createHint(msg) {
    var e = $('createErr');
    if (e) { e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }
    var box = $('newAppName') && $('newAppName').closest('.m3-outlined');
    if (box) box.classList.toggle('err', !!msg);
  }
  /** 起一个不重复的名字（复制作品、导入作品时用）：名字、名字 2、名字 3… */
  function uniqueAppName(base) {
    var b = String(base || '未命名').trim() || '未命名';
    if (!appNameExists(b)) return b;
    for (var i = 2; i < 200; i++) { var cand = b + ' ' + i; if (!appNameExists(cand)) return cand; }
    return b + ' ' + Date.now().toString(36);
  }
  // 没有输入应用名 / 名字重复时禁止创建
  function syncCreateBtn() {
    var inp = $('newAppName'), go = $('createGo');
    if (!inp || !go) return;
    var v = (inp.value || '').trim();
    var dup = !!v && appNameExists(v);
    go.disabled = !v || dup;
    if (!v) createHint('');
    else if (dup) createHint('已经有一个叫「' + v + '」的作品了，换个名字吧');
    else createHint('');
  }
  function closeCreate() { 关遮罩($('createMask')); }
  function confirmCreate() {
    var name = ($('newAppName').value || '').trim();
    if (!name) { // 空名：拦截并提示，不允许创建
      createHint('给这个 App 起个名字吧');
      $('newAppName').focus(); return;
    }
    if (appNameExists(name)) {          // 重名：直接拦下（用户要求）
      createHint('已经有一个叫「' + name + '」的作品了，换个名字吧');
      $('newAppName').focus();
      return;
    }
    var p = blankProject(); p.appName = name;
    var s = loadStore(), it = { id: 'p' + Date.now().toString(36), name: name, updatedAt: Date.now(), project: p };
    s.items.push(it); saveStore(s);
    $('createMask').classList.add('hidden');
    openItem(it.id);
  }
  function openItem(id) {
    var s = loadStore(), it = null;
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) it = s.items[i];
    if (!it) return;
    state.itemId = id; state.project = it.project;
    if (!Array.isArray(it.project.clouds)) it.project.clouds = [];   // 老工程兼容
    try { localStorage.setItem(OPEN_KEY, id); } catch (e) {}
    // 试运行返回时恢复到运行前正在编辑的页面（一次性消费）；否则打开第一个页面
    var restoreScreen = null;
    try { restoreScreen = localStorage.getItem('__previewReturnScreen'); } catch (e) {}
    var validRestore = restoreScreen && it.project.screens.some(function (s) { return s.id === restoreScreen; });
    state.curScreenId = (validRestore ? restoreScreen : (it.project.screens[0] && it.project.screens[0].id));
    try { localStorage.removeItem('__previewReturnScreen'); } catch (e) {}
    state.selectedCompId = null;
    $('viewHome').classList.add('hidden');
    var _ve = $('viewEditor');
    _ve.classList.remove('hidden');
    切页(_ve, 'fwd');
    同步分段药丸();          // 编辑器刚显示出来，滑块归位（隐藏时量不到宽高）
    requestAnimationFrame(function () { 同步分段药丸(); requestAnimationFrame(同步分段药丸); });

    $('appName').value = it.project.appName || '我的应用';
    state.view = 'design'; state.inLayout = false;
    $('viewDesign').classList.remove('hidden'); $('viewBlocks').classList.add('hidden'); $('viewLayout').classList.add('hidden');
    $('tabDesign').classList.add('on'); $('tabBlocks').classList.remove('on');
    var _bl = $('btnLayout'); if (_bl) _bl.classList.remove('on');
    closeMenus();
    renderTabs(); renderCompList(); syncOrientSeg();
    if (state.wsInited) loadScreenToWs(curScreen());
    requestWsResize();
    // 从试运行返回时恢复到运行前所在页（设计/代码），一次性消费，避免影响正常打开
    try {
      var retView = localStorage.getItem('__previewReturnView');
      if (retView === 'blocks') showView('blocks');
      localStorage.removeItem('__previewReturnView');
    } catch (e) {}
  }
  function duplicateItem(id) {
    var s = loadStore();
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) {
      // 副本名也要唯一，否则一复制就撞名（用户要求：不许重名）
      var nm = uniqueAppName(s.items[i].name + ' 副本');
      var copy = { id: 'p' + Date.now().toString(36), name: nm, updatedAt: Date.now(), project: clone(s.items[i].project) };
      // 复制出来的也是一件新作品：不能继承原件的"已发布"标记（否则副本会冒出「管理」，
      // 点「更新」还会按同一个 作品iD 覆盖掉社区里原件那一条）
      清掉已发布标记(copy.project);
      copy.project.appName = copy.name; s.items.push(copy); saveStore(s); renderHome(); return;
    }
  }
  function deleteItem(id) {
    var s = loadStore(); s.items = s.items.filter(function (x) { return x.id !== id; }); saveStore(s); renderHome();
    try { if (localStorage.getItem(OPEN_KEY) === id) localStorage.removeItem(OPEN_KEY); } catch (e) {}
    try { var h = histAll(); delete h[id]; histSave(h); } catch (e) {}
  }

  /* ---------------- 历史版本（用户要求：一键回到上次能跑的状态） ----------------
     什么时候存：点「运行」、点「导出」、以及手动点首页的「历史 → 现在存一份」。
     存多少：**不限条数**（用户要求），可以自己一条条删；单份超过 4MB 才跳过
     （那是异常大的工程，存下去会把浏览器存储撑爆、反而把整个 App 拖死）。
     注意：只存工程本身，不含任何密钥（密钥从来不进工程）。 */
  var HIST_KEY = '__bb_history_v1';
  var HIST_MAX = 0;                 // 0 = 不限条数
  var HIST_MAX_CHARS = 4000000;
  function histAll() {
    try { var o = JSON.parse(localStorage.getItem(HIST_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function histSave(o) { try { localStorage.setItem(HIST_KEY, JSON.stringify(o)); } catch (e) {} }
  function histList(itemId) { var o = histAll(); return (o[itemId] || []); }
  /** 给某个作品存一份快照（同一个"内容指纹"只存一次，不堆重复） */
  function histSnapshot(itemId, 原因) {
    try {
      if (!itemId) return null;
      // 先把内存里的最新改动写回工程、并且**立刻落盘**：autosave 是防抖的，
      // 不等它落盘就快照，存下来的会是上一版（踩过：恢复出来是空工程）
      if (state.itemId === itemId) { saveCurrentWs(true); persist(); }
      var s = loadStore(), it = null;
      for (var i = 0; i < s.items.length; i++) if (s.items[i].id === itemId) it = s.items[i];
      if (!it) return null;
      var json = JSON.stringify(it.project);
      if (json.length > HIST_MAX_CHARS) return null;          // 异常大的就不存（别把存储撑爆）
      var 指纹 = json.length + ':' + json.slice(0, 300);
      var o = histAll(), arr = o[itemId] || [];
      if (arr.length && arr[0].指纹 === 指纹) return null;    // 和上一份一样，不重复存
      arr.unshift({ ts: Date.now(), 原因: 原因 || '手动', 指纹: 指纹, project: JSON.parse(json) });
      o[itemId] = HIST_MAX > 0 ? arr.slice(0, HIST_MAX) : arr;
      histSave(o);
      return o[itemId][0];
    } catch (e) { return null; }
  }
  /** 删掉某一份历史（用户要求：可以自己删） */
  function histDelete(itemId, index) {
    var o = histAll(), arr = o[itemId] || [];
    if (index < 0 || index >= arr.length) return false;
    arr.splice(index, 1);
    if (arr.length) o[itemId] = arr; else delete o[itemId];
    histSave(o);
    return true;
  }
  /** 恢复某个历史版本（恢复前先把"现在这一份"也存进历史，免得手滑找不回来） */
  function histRestore(itemId, index) {
    var arr = histList(itemId);
    var snap = arr[index];
    if (!snap) return false;
    histSnapshot(itemId, '恢复前');
    var s = loadStore();
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === itemId) {
      s.items[i].project = JSON.parse(JSON.stringify(snap.project));
      s.items[i].updatedAt = Date.now();
      saveStore(s);
      if (state.itemId === itemId) openItem(itemId);          // 正在编辑就立刻切过去
      else renderHome();
      return true;
    }
    return false;
  }
  function histTime(ts) {
    try {
      var d = new Date(ts);
      function p(n) { return (n < 10 ? '0' : '') + n; }
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }
  /** 历史版本面板：列出发过的快照，点一条就恢复 */
  function openHistory(itemId) {
    var old = $('histSheet'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = el('div', 'mask'); wrap.id = 'histSheet';
    var box = el('div', 'modal sheet-modal tpl-modal fill');
    var 关 = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    var x = el('button', 'tpl-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '关闭');
    x.addEventListener('click', function (e) { e.stopPropagation(); 关(); });
    box.appendChild(x);
    box.appendChild(el('div', 'mtitle', '历史版本'));
    var body = el('div', 'mbody');
    var 名 = '';
    try { var s = loadStore(); s.items.forEach(function (it) { if (it.id === itemId) 名 = it.name || ''; }); } catch (e) {}
    body.appendChild(el('div', 'tpl-sub', '「' + 名 + '」——点「运行」或「导出」前会自动存一份（条数不限，可以自己删）'));
    function 画() {
      Array.prototype.slice.call(body.querySelectorAll('.tpl-item, .hist-empty')).forEach(function (n) { n.remove(); });
      var arr = histList(itemId);
      if (!arr.length) {
        var e0 = el('div', 'tpl-sub hist-empty', '还没有历史版本。先点一次「运行」或「导出」，这里就会自动留一份。');
        body.appendChild(e0);
        return;
      }
      arr.forEach(function (snap, i) {
        var row = el('div', 'tpl-item hist-row'); row.setAttribute('data-hist', String(i));
        var main = el('button', 'hist-main'); main.type = 'button';
        main.appendChild(el('div', 'tpl-name', histTime(snap.ts) + '　' + (snap.原因 || '')));
        main.appendChild(el('div', 'tpl-desc', (snap.project.screens || []).length + ' 个页面 · ' +
          (((snap.project.screens || []).reduce(function (n, sc) { return n + ((sc.components || []).length); }, 0))) + ' 个控件' + (i === 0 ? '（最新的一份）' : '')));
        main.addEventListener('click', function () {
          if (!histRestore(itemId, i)) return;
          关();
          snack('已恢复到 ' + histTime(snap.ts) + ' 的版本');
        });
        var del = el('button', 'hist-del', '×');
        del.type = 'button';
        del.title = '删除这一份历史'; del.setAttribute('aria-label', '删除这一份历史');
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          if (histDelete(itemId, i)) { 画(); snack('已删掉这一份历史'); }
        });
        row.appendChild(main); row.appendChild(del);
        body.appendChild(row);
      });
    }
    画();
    var now = el('button', 'tb', '现在存一份');
    now.addEventListener('click', function () { histSnapshot(itemId, '手动'); 画(); snack('已存好一份'); });
    var clr = el('button', 'tb', '清空历史');
    clr.addEventListener('click', function () {
      confirmDialog({ title: '清空历史版本', msg: '确定把这个作品的全部历史版本都删掉吗？（当前作品本身不会动）', okText: '清空' })
        .then(function (ok) { if (!ok) return; var o = histAll(); delete o[itemId]; histSave(o); 画(); snack('历史已清空'); });
    });
    var btns = el('div', 'mbtns'); btns.appendChild(clr); btns.appendChild(now);
    box.appendChild(body); box.appendChild(btns);
    wrap.appendChild(box);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) 关(); });
    document.body.appendChild(wrap);
  }

  /* ---------------- 作品分享 / 导入 ----------------
     分享的不是 APK，而是一个 .fast 文件（本质是 JSON）：里面装着整个工程，
     外加随作品一起用到的本地视频/音频（转成 Base64 一并带走）。
     原生侧 Native.shareProject 负责落盘并唤起系统分享面板（微信/QQ 都能发）。 */
  var FAST_FORMAT = 1;                        // 分享文件格式版本
  var FAST_SHARE_MEDIA_MAX = 8 * 1024 * 1024; // 随作品带走的本地媒体上限（Base64 字符数，约 6MB 原始数据）

  // 扫出工程里引用到的本地媒体文件名（组件里的 media://xxx）
  function collectMediaNames(project) {
    var names = [], seen = {}, m;
    var re = /media:\/\/([A-Za-z0-9_.\-]+)/g;
    var json = JSON.stringify(project || {});
    while ((m = re.exec(json))) { if (!seen[m[1]]) { seen[m[1]] = 1; names.push(m[1]); } }
    return names;
  }

  function shareItem(id) {
    var s = loadStore(), it = null;
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) it = s.items[i];
    if (!it) { snack('找不到这个作品'); return; }

    var payload = {
      fast: FAST_FORMAT, kind: 'project', appName: it.name || '未命名',
      exportedAt: Date.now(), project: it.project, media: {}
    };
    // 本地视频/音频一并打包，接收方能直接播放；超出上限的跳过并如实告知
    var skipped = 0, total = 0;
    collectMediaNames(it.project).forEach(function (n) {
      var b64 = '';
      try { if (window.Native && Native.readMediaBase64) b64 = Native.readMediaBase64(n) || ''; } catch (e) { b64 = ''; }
      if (!b64) { skipped++; return; }
      if (total + b64.length > FAST_SHARE_MEDIA_MAX) { skipped++; return; }
      total += b64.length; payload.media[n] = b64;
    });

    var text = JSON.stringify(payload);
    var fname = (it.name || 'FAST作品') + '.fast';

    if (window.Native && Native.shareProject) {
      try {
        // 只唤起系统分享面板（微信/QQ），不弹我们自己那条提示：原生 shareProject 内部
        // 会往「下载/fast本地app」放一份公共副本（微信读不了 App 私有目录，必须这一份），
        // 但那是分享能成功的必要条件，不用再跟用户解释一遍。
        Native.shareProject(text, fname);
      } catch (e) { modal('分享失败', String((e && e.message) || e)); }
      return;
    }
    // 浏览器/PC 环境：退化为下载 .fast 文件（PC 端自动化测试也走这条分支）
    try {
      window.__lastSharePayload = text;
      var blob = new Blob([text], { type: 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1000);
      snack(skipped ? ('已下载作品文件，有 ' + skipped + ' 个较大的本地文件未包含') : '已下载作品文件');
    } catch (e) { modal('分享失败', String((e && e.message) || e)); }
  }

  /**
   * 导入一份分享的作品。返回 { ok, msg, id, name, media, mediaTotal }。
   * 对内容做严格校验：坏文件只提示，绝不写进作品列表把编辑器搞坏。
   */
  function importFastText(text) {
    var data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') return { ok: false, msg: '这个文件不是有效的 FAST 作品文件（内容无法解析）。' };

    // 两种都认：分享文件 { fast, project }，或直接就是一份工程对象
    var project = (data.project && Array.isArray(data.project.screens)) ? data.project
                : (Array.isArray(data.screens) ? data : null);
    if (!project) return { ok: false, msg: '文件里没有找到作品数据，可能不是 FAST 分享的作品文件。' };
    for (var i = 0; i < project.screens.length; i++) {
      var sc = project.screens[i];
      if (!sc || typeof sc !== 'object' || !Array.isArray(sc.components)) {
        return { ok: false, msg: '作品数据不完整（第 ' + (i + 1) + ' 个页面结构异常）。' };
      }
    }

    // 把随作品带来的本地媒体落回本机私有目录
    var media = (data.media && typeof data.media === 'object') ? data.media : {};
    var mediaTotal = 0, mediaOk = 0;
    Object.keys(media).forEach(function (n) {
      if (typeof media[n] !== 'string' || !media[n]) return;
      mediaTotal++;
      try { if (window.Native && Native.writeMedia && Native.writeMedia(n, media[n])) mediaOk++; } catch (e) {}
    });

    var proj = clone(project);
    // ⚠️ 安全：文件是别人给的，里面的 code 字段可能是手写的任意 JS，
    // 一律按代码块重新生成（详见 洗掉外来代码 的注释）。
    洗掉外来代码(proj);
    // 导入/复制过来的作品**绝不能带着原作者的 作品iD**（工程里那个"已发布到社区"的标记）。
    // 带过来副本就看起来"已经发布过" —— 卡片上冒出一个「管理」，用户点「更新」还会
    // 按这个 iD 覆盖掉**原作者**在社区里的那一条（真机报的 bug）。
    // 副本 = 一件全新的本地作品：要发布它自己会生成一个新的 作品iD。
    清掉已发布标记(proj);
    if (!Array.isArray(proj.clouds)) proj.clouds = [];   // 老工程兼容
    if (!proj.orientation) proj.orientation = 'portrait';
    if (!proj.startScreen && proj.screens[0]) proj.startScreen = proj.screens[0].id;

    var base = String(data.appName || proj.appName || '导入的作品').trim() || '导入的作品';
    var s = loadStore(), name = base, k = 2;
    while (s.items.some(function (x) { return x.name === name; })) { name = base + ' (' + k + ')'; k++; }
    proj.appName = name;

    var item = { id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
                 name: name, updatedAt: Date.now(), project: proj };
    s.items.push(item); saveStore(s); renderHome();
    return { ok: true, id: item.id, name: name, media: mediaOk, mediaTotal: mediaTotal };
  }

  // 顶部「导入作品」按钮 + 隐藏的文件选择框
  function wireImport() {
    var btn = $('btnImport'), inp = $('importFile');
    if (btn && inp) btn.addEventListener('click', function () { inp.value = ''; inp.click(); });
    if (!inp) return;
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r;
        try { r = importFastText(String(rd.result || '')); }
        catch (e) { r = { ok: false, msg: '导入出错：' + String((e && e.message) || e) }; }
        if (!r.ok) {
          modal('导入失败', r.msg);
          // 导入失败时最常见的困惑是"文件到底存哪了"，给一个直达「下载」目录的入口
          modalExtra('打开下载目录', function () {
            if (window.Native && Native.openDownloadFolder) Native.openDownloadFolder();
            else modal('文件在哪', '请在手机「文件管理」里找收到的 .fast 文件。', '知道了', hideModal);
          });
          return;
        }
        var box = el('div');
        box.appendChild(el('div', null, '已导入作品「' + r.name + '」。'));
        if (r.mediaTotal) box.appendChild(el('div', 'dim', '随作品带来 ' + r.mediaTotal + ' 个本地文件，成功恢复 ' + r.media + ' 个。'));
        modal('导入成功', box, '打开编辑', function () { hideModal(); openItem(r.id); });
      };
      rd.onerror = function () { modal('导入失败', '读取文件失败，请重试。'); };
      rd.readAsText(f);
    });
  }

  /* ---------------- 工具 ---------------- */
  function curScreen() {
    for (var i = 0; i < state.project.screens.length; i++)
      if (state.project.screens[i].id === state.curScreenId) return state.project.screens[i];
    return state.project.screens[0];
  }
  function genId(type) {
    var max = 0;
    // 容器里的子控件也要算：只扫顶层的话，把 button1 放进容器后再新建按钮又会叫 button1，
    // 同一个 id 出现两次 → 运行时代码/事件全串。2026-10-29 回归抓到的。
    function 扫(c) {
      if (c.id && c.id.indexOf(type) === 0) { var n = parseInt(c.id.slice(type.length), 10); if (!isNaN(n)) max = Math.max(max, n); }
      if (c.children) { for (var i = 0; i < c.children.length; i++) 扫(c.children[i]); }
    }
    state.project.screens.forEach(function (s) { s.components.forEach(function (c) { 扫(c); }); });
    return type + (max + 1);
  }
  // 控件在代码下拉里的“可读名”：优先用户命名，其次控件上实际显示的文案（如按钮文字 A），
  // 再次才是类型名；重名时追加 id 区分。值始终用 c.id，代码生成不受影响。
  function compPreview(c) {
    if (c.type === 'multiSelect') {
      var 选 = Array.isArray(c.value) ? c.value
        : String(c.value == null ? '' : c.value).split(/[,，、\n]/).filter(function (s) { return s !== ''; });
      return 选.length ? 选.join('、') : '多选下拉';
    }
    if (c.type === 'dateRange') return (c.start || c.end) ? ((c.start || '') + '~' + (c.end || '')) : '日期范围';
    if (c.type === 'colorPicker') return '颜色 ' + String(c.value || '#6750a4');
    return c.text || c.value
      || ((c.type === 'switch' || c.type === 'checkbox') ? (c.checked ? '开' : '关') : '')
      || (c.type === 'slider' ? ('滑块 ' + (validN(c.value) ? c.value : 0)) : '')
      || (c.type === 'progress' ? ('进度 ' + (validN(c.value) ? c.value : 0)) : '')
      || (c.items ? c.items.length + ' 项' : '') || '';
  }
  function compDisplayName(c) {
    if (c.name && String(c.name).trim()) return String(c.name).trim();
    var pv = String(compPreview(c)).trim();
    if (pv) return pv;
    return TYPE_META[c.type].label;
  }
  window.__compOptions = function (types) {
    var sc = window.__codegenScreen || curScreen();
    var rows = sc.components.filter(function (c) { return !types || types.indexOf(c.type) >= 0; });
    var counts = {};
    rows.forEach(function (c) { var n = compDisplayName(c); counts[n] = (counts[n] || 0) + 1; });
    var out = rows.map(function (c) {
      var n = compDisplayName(c);
      if (counts[n] > 1) n = n + '·' + c.id;  // 同名控件追加 id 去重
      return [n, c.id];
    });
    if (!out.length) out.push(['（请先在设计里添加对应组件）', 'NONE']);
    return out;
  };
  window.__pageOptions = function () {
    var out = state.project.screens.map(function (s) { return [s.title || s.id, s.id]; });
    return out.length ? out : [['（无页面）', 'NONE']];
  };

  /* ---------------- 设计：页面与组件列表 ---------------- */
  // 横竖屏 / 通知栏 改为「当前页面」级，存到 screen 上（旧工程缺省时取 portrait / 是）
  function curOrient() { var s = curScreen(); return (s && s.orientation) || 'portrait'; }
  /* 「如何预览」：auto = 跟着当前页面方向；portrait / landscape = 强制（用户要求，2026-10-28）。
     只影响**布局页预览**，不改页面自身的 orientation，也不影响运行/导出。
     存本地（跨工程记住），默认 auto。 */
  var LAYOUT_ORIENT_KEY = '__bb_layout_orient';
  function layoutOrientMode() {
    var v = null; try { v = localStorage.getItem(LAYOUT_ORIENT_KEY); } catch (e) {}
    return (v === 'portrait' || v === 'landscape') ? v : 'auto';
  }
  function setLayoutOrientMode(m) {
    var ok = (m === 'portrait' || m === 'landscape') ? m : 'auto';
    try { localStorage.setItem(LAYOUT_ORIENT_KEY, ok); } catch (e) {}
    syncLayoutOrientMenu();
  }
  /** 布局页实际使用的方向 */
  function layoutOrient() {
    var m = layoutOrientMode();
    return (m === 'portrait' || m === 'landscape') ? m : curOrient();
  }
  /** 布局页「如何预览」下拉里的勾选状态 */
  function syncLayoutOrientMenu() {
    var m = layoutOrientMode();
    Array.prototype.forEach.call(document.querySelectorAll('#layoutOrientMenu .orient-opt'), function (b) {
      var on = b.getAttribute('data-mode') === m;
      b.classList.toggle('on', on);
      var ck = b.querySelector('.run-opt-ck');
      if (ck) ck.textContent = on ? '✓' : '';
    });
    syncPreviewBorderMenu();
  }
  /* 「控件在预览时是否显示边框」：布局页预览里给每个控件描一圈细线，
     方便看清透明/空白控件的实际范围。只影响布局页预览，不进运行/导出。
     存本地，**默认「是」**（用户 2026-10-29 要求：默认看得见范围）。 */
  var PREVIEW_BORDER_KEY = '__bb_preview_border';
  function previewBorderOn() {
    var v = null; try { v = localStorage.getItem(PREVIEW_BORDER_KEY); } catch (e) {}
    return v !== '0';            // 只认显式存下的 '0' 才是关；没存过一律开
  }
  function syncPreviewBorderMenu() {
    var on = previewBorderOn() ? '1' : '0';
    Array.prototype.forEach.call(document.querySelectorAll('#layoutOrientMenu .orient-border'), function (b) {
      var onb = b.getAttribute('data-b') === on;
      b.classList.toggle('on', onb);
      var ck = b.querySelector('.run-opt-ck');
      if (ck) ck.textContent = onb ? '✓' : '';
    });
  }
  function applyPreviewBorder() {
    var st = $('layStage');
    if (st) st.classList.toggle('show-border', previewBorderOn());
  }
  function setPreviewBorder(on) {
    try { localStorage.setItem(PREVIEW_BORDER_KEY, on ? '1' : '0'); } catch (e) {}
    syncPreviewBorderMenu();
    applyPreviewBorder();
  }
  function curShowSB() { var s = curScreen(); return !s || s.showStatusBar !== false; }
  function syncOrientSeg() {
    var o = curOrient();
    Array.prototype.forEach.call(document.querySelectorAll('#moreOrient .orientbtn'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-orient') === o);
    });
    var sb = curShowSB() ? 'yes' : 'no';
    Array.prototype.forEach.call(document.querySelectorAll('#moreStatusBar .orientbtn'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-sb') === sb);
    });
  }
  // 页面切换已改为顶栏「页面 ▾」菜单；这里只负责同步按钮文案与“更多”菜单里的页面名
  function renderTabs() {
    var cur = curScreen();
    var btn = $('btnScreenMenu');
    if (btn) btn.textContent = (cur.title || cur.id) + ' ▾';
    var pt = $('morePageTitle');
    if (pt && document.activeElement !== pt) pt.value = cur.title || '';
    if (state.inLayout) renderLayout();
  }
  /** 时钟控件在「设计/布局」页显示的示例文字（运行时由 runtime.js 自己走秒） */
  function 时钟示例(fmt) {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    if (fmt === 'hms') return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    if (fmt === 'mdhm') return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function compName(c) { return (c.name && c.name.trim()) ? c.name.trim() : (TYPE_META[c.type].label + ' (' + c.id + ')'); }
  function compDesc(c) {
    var base;
    if (c.type === 'switch' || c.type === 'checkbox') base = (c.text || TYPE_META[c.type].label) + '：' + (c.checked ? '已勾选' : '未勾选');
    else if (c.type === 'slider') base = '范围 ' + (c.min || 0) + '~' + (c.max || 100) + '，当前 ' + (validN(c.value) ? c.value : 0);
    else if (c.type === 'progress') base = '进度 ' + (validN(c.value) ? c.value : 0) + ' / ' + (c.max || 100);
    else if (c.type === 'tabs') base = '页签 ' + ((c.items || []).length) + ' 个，当前第 ' + ((Number(c.value) || 0) + 1) + ' 个';
    else if (c.type === 'collapse') base = (c.text || '折叠面板') + '：' + (c.open ? '展开' : '收起');
    else if (c.type === 'rating') base = '评分 ' + (validN(c.value) ? c.value : 0) + ' / ' + (c.max || 5);
    else if (c.type === 'ring') base = '进度 ' + (validN(c.value) ? c.value : 0) + ' / ' + (c.max || 100);
    else if (c.type === 'badge') base = (c.text || '徽章') + '（状态点）';
    else if (c.type === 'clock') base = '时钟 ' + ({ hm: '时:分', hms: '时:分:秒', mdhm: '日期+时:分' }[c.format] || '时:分');
    else if (c.type === 'qr') base = c.value ? '二维码：' + String(c.value).slice(0, 24) : '二维码（还没填内容）';
    else if (c.type === 'multiSelect') {
      var 已选 = Array.isArray(c.value) ? c.value
        : String(c.value == null ? '' : c.value).split(/[,，、\n]/).filter(function (s) { return s !== ''; });
      base = (已选.length ? '已选：' + 已选.join('、') : '还没选') + '（共 ' + ((c.items || []).length) + ' 项）';
    }
    else if (c.type === 'dateRange') base = (c.start || '未设') + ' 至 ' + (c.end || '未设');
    else if (c.type === 'colorPicker') base = '颜色 ' + String(c.value || '#6750a4');
    else if (c.type === 'scroll') base = '滚动区，里面 ' + ((c.children || []).length) + ' 个控件';
    else if (c.type === 'bottomNav') {
      var 导航们 = (c.items || []);
      base = '导航 ' + 导航们.length + ' 项，当前「' + (导航们[Number(c.value) || 0] || 导航们[0] || '') + '」';
    }
    else base = c.text || c.value || (c.items ? '列表：' + c.items.length + ' 项' : (c.hint || TYPE_META[c.type].desc));
    if (c.x != null && c.y != null) base += '（坐标 ' + c.x + ',' + c.y + '）';
    return base;
  }
  function renderCompList() {
    var sc = curScreen(), box = $('compList'); box.innerHTML = '';
    // 空列表不额外放提示文案（保持界面干净）
    function 建卡片(c, 是子控件, 父) {
      var meta = TYPE_META[c.type];
      var hidden = c.visible === false;
      var card = el('div', 'compcard' + (c.id === state.selectedCompId ? ' sel' : '') + (hidden ? ' is-hidden' : '') + (是子控件 ? ' is-child' : ''));
      card.dataset.id = c.id;
      if (是子控件 && 父) card.dataset.parent = 父.id;   // 长按拖动时按所属容器分组
      card.appendChild(el('div', 'ico', meta.ico));
      var main = el('div', 'main');
      main.appendChild(el('div', 't1', compName(c)));
      main.appendChild(el('div', 't2', compDesc(c)));
      var ops = el('div', 'ops');
      if (是子控件 && 父) {
        var out = el('button', 'iconbtn out', '↰');
        out.title = '移出容器'; out.setAttribute('aria-label', '移出容器');
        out.addEventListener('click', function (e) {
          e.stopPropagation();
          if (移出容器(c.id)) { renderCompList(); if (state.inLayout) renderLayout(); autosave(); }
        });
        ops.appendChild(out);
      } else if (!是容器(c)) {
        // 顶层控件：可以"放进容器"（有容器时才显示这个按钮）
        var 容器们 = 所有容器();
        if (容器们.length) {
          var inBtn = el('button', 'iconbtn in', '⇲');
          inBtn.title = '放进容器'; inBtn.setAttribute('aria-label', '放进容器');
          inBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var 做 = function (kid) { if (移入容器(c.id, kid)) { renderCompList(); if (state.inLayout) renderLayout(); autosave(); snack('已放进容器'); } };
            if (容器们.length === 1) { 做(容器们[0].id); return; }
            var opts = 容器们.map(function (k) { return [compName(k), k.id]; });
            try { openM3SelectMenu(inBtn, opts, '', function (v) { 做(v); }); } catch (err) { 做(容器们[0].id); }
          });
          ops.appendChild(inBtn);
        }
      }
      // 卡片上的“显示/隐藏”快捷开关，不必进详情即可隐藏
      var eye = el('button', 'iconbtn eye' + (hidden ? ' off' : ''));
      eye.title = hidden ? '已隐藏，点击显示' : '点击隐藏该控件';
      eye.setAttribute('aria-label', eye.title);
      eye.innerHTML = hidden ? ICON_EYE_OFF : ICON_EYE_ON;
      eye.addEventListener('click', function (e) {
        e.stopPropagation();
        c.visible = hidden ? true : false;
        renderCompList(); if (state.inLayout) renderLayout(); autosave();
      });
      var d = el('button', 'iconbtn', '×');
      d.addEventListener('click', function (e) { e.stopPropagation(); delComp(c.id); });
      ops.appendChild(eye); ops.appendChild(d);
      card.appendChild(main); card.appendChild(ops);
      // 长按卡片拖拽：顶层卡片上下换位 / 拖到容器卡片上放进去；
      // 容器里的子卡片可在兄弟之间换位，拖出父卡片所在区域就放回页面顶层
      bindCardReorder(card, c.id, 是子控件 ? 父 : null);
      card.addEventListener('click', onTap(function (e) {
        e.stopPropagation();
        if (cardReorder.justEnded()) return;   // 长按拖拽松手后的残余 click 不触发选中
        state.selectedCompId = c.id; renderCompList(); renderPropPanel();
      }));
      return card;
    }
    sc.components.forEach(function (c, idx) {
      box.appendChild(建卡片(c, false, null));
      // 容器里的子控件紧跟着列出来（缩进显示），选中/删除都和平常一样
      if (是容器(c) && c.children && c.children.length) {
        c.children.forEach(function (k) { box.appendChild(建卡片(k, true, c)); });
      }
    });
    renderPropPanel();
    refreshCompDropdowns();   // 组件改名/增删/排序/改文字后，同步刷新代码里的控件下拉名称
  }
  function selectedComp() {
    if (!state.selectedCompId) return null;
    var 源 = 找控件(state.selectedCompId);
    return 源 ? 源.c : null;
  }
  // 估算文字在给定字号下的像素宽：中文/全角约 1em，拉丁约 0.58em
  function textPixelWidth(s, fs) {
    s = String(s == null ? '' : s); var w = 0;
    for (var i = 0; i < s.length; i++) { w += (s.charCodeAt(i) >= 0x2e80 ? 1.0 : 0.58) * fs; }
    return w;
  }
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  /* 新建控件的“自身内容尺寸”：按控件类型/文字内容给一个紧凑初始大小。
     字号、内边距、最小宽、固定高统一来自 comp-spec.js 的 nat 字段，
     这里只负责实测文字宽度 —— 新增控件不用再改这个函数。 */
  function naturalSize(type, base) {
    var maxW = designSize().w - 32;
    var nat = FAST_COMP.naturalOf(type);
    if (!nat) return { w: Math.round(Math.min(200, maxW)), h: 44 };
    if (nat.mode === 'text') {
      var txt = String(base[nat.field || 'text'] || '');
      var pad = (base.icon && nat.iconPad) ? nat.iconPad : nat.pad;
      var w = Math.round(clampNum(textPixelWidth(txt, nat.fs || 16) + pad, nat.minW || 56, maxW));
      return nat.h ? { w: w, h: nat.h } : { w: w };
    }
    return { w: Math.round(Math.min(nat.w, maxW)), h: nat.h };
  }
  /** 各类型控件的默认属性：统一来自 comp-spec.js 的 def（手动添加控件与 AI 新增控件共用） */
  var COMPONENT_DEFAULTS = (function () {
    var m = {};
    Object.keys(FAST_COMPONENTS).forEach(function (k) { m[k] = FAST_COMPONENTS[k].def || {}; });
    m.input2 = {};      // 历史遗留 type，留空默认值防止旧数据取不到
    return m;
  })();
  /* ---------------- 容器（真正的父子布局，路线图 1.2） ----------------
     数据：容器自己是普通组件，子控件放在它的 children 里，坐标**相对容器左上角**。
     三处必须一致（不变量）：设计页列表 / 布局页 / 运行时都用同一套相对坐标。
     2026-10-29：「滚动区」也是容器（多一条可上下滑动），所以判断统一走 是容器()。 */
  function 是容器(c) { return !!c && (c.type === 'container' || c.type === 'scroll'); }
  function 找控件(id) {
    var sc = curScreen();
    for (var i = 0; i < sc.components.length; i++) {
      var c = sc.components[i];
      if (c.id === id) return { c: c, list: sc.components, parent: null, index: i };
      if (是容器(c) && c.children) {
        for (var j = 0; j < c.children.length; j++) if (c.children[j].id === id) {
          return { c: c.children[j], list: c.children, parent: c, index: j };
        }
      }
    }
    return null;
  }
  function 所有容器() {
    var sc = curScreen(), out = [];
    sc.components.forEach(function (c) { if (是容器(c)) out.push(c); });
    return out;
  }
  /** 把一个顶层控件放进容器（坐标换算成相对坐标，并按容器大小夹住） */
  function 移入容器(childId, containerId) {
    var 源 = 找控件(childId);
    if (!源 || 源.parent) return false;                     // 找不到 / 已经在容器里
    var 容器 = null;
    所有容器().forEach(function (k) { if (k.id === containerId) 容器 = k; });
    if (!容器 || 容器.id === childId) return false;
    var c = 源.c;
    var 父x = validN(容器.x) ? 容器.x : 0, 父y = validN(容器.y) ? 容器.y : 0;
    c.x = validN(c.x) ? c.x : 16; c.y = validN(c.y) ? c.y : 16;
    c.x = Math.max(0, Math.round(c.x - 父x));            // 屏幕坐标 → 容器内相对坐标
    c.y = Math.max(0, Math.round(c.y - 父y));
    if (!容器.children) 容器.children = [];
    c.x = Math.min(c.x, Math.max(0, (容器.w || 300) - (c.w || 100)));
    c.y = Math.min(c.y, Math.max(0, (容器.h || 180) - (c.h || 40)));
    源.list.splice(源.index, 1);
    容器.children.push(c);
    return true;
  }
  /** 把容器里的子控件放回页面顶层（相对坐标换算回屏幕坐标）
      at：插到顶层列表的第几位（拖动"拉出来"时用，省略则放到最前面，与「移出容器」按钮一致） */
  function 移出容器(childId, at) {
    var 源 = 找控件(childId);
    if (!源 || !源.parent) return false;
    var 父 = 源.parent, c = 源.c;
    c.x = Math.max(0, Math.round((父.x || 0) + (validN(c.x) ? c.x : 0)));
    c.y = Math.max(0, Math.round((父.y || 0) + (validN(c.y) ? c.y : 0)));
    源.list.splice(源.index, 1);
    var sc = curScreen();
    var i = (typeof at === 'number' && isFinite(at)) ? Math.max(0, Math.min(sc.components.length, at)) : 0;
    sc.components.splice(i, 0, c);
    return true;
  }
  function addComponent(type) {
    var sc = curScreen(), base = { id: genId(type), type: type };
    // 默认属性必须**拷一份**：def 里的 children/items 是数组，直接引用会让所有同类控件共用同一个数组
    // （2026-10-29 抓到：新建的第二个容器会带上第一个容器里的全部子控件）
    var def = clone(COMPONENT_DEFAULTS[type] || {});
    Object.keys(def).forEach(function (k) { base[k] = def[k]; });
    var ns = naturalSize(type, base);           // 按自身内容给紧凑初始尺寸，不再一创建就占满整行
    base.w = ns.w; if (ns.h) base.h = ns.h;
    sc.components.unshift(base); state.selectedCompId = base.id;   // 新控件插到最上面
    renderCompList(); if (state.inLayout) renderLayout(); autosave();
  }
  function moveComp(idx, dir) {
    var arr = curScreen().components, j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    var t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    renderCompList(); if (state.inLayout) renderLayout(); autosave();
  }
  /* ================= 控件卡片：长按拖拽排序 ================= */
  var cardReorder = (function () {
    var dragId = null, endedAt = 0;
    return {
      active: function () { return !!dragId; },
      start: function (id) { dragId = id; },
      stop: function () { dragId = null; endedAt = Date.now(); },
      justEnded: function () { return Date.now() - endedAt < 450; }
    };
  })();
  // 长按排序期间禁止列表自身的触摸滚动（由我们接管手势）
  document.addEventListener('touchmove', function (e) {
    if (cardReorder.active() && e.target.closest && e.target.closest('#compList')) e.preventDefault();
  }, { passive: false, capture: true });
  // 分类栏换位期间同理：别让列表自己滚
  document.addEventListener('touchmove', function (e) {
    if (railDragActive && e.target.closest && e.target.closest('#bbCats')) e.preventDefault();
  }, { passive: false, capture: true });
  function bindCardReorder(card, compId, 父) {
    var box = $('compList');
    var armTimer = null, dragging = false, startX = 0, startY = 0, grabY = 0, ph = null, fromIdx = -1, edgeDir = 0, edgeRaf = 0;
    var 落点容器 = null;                       // 顶层卡片：松手时如果指在某个容器上，就放进它
    // 子卡片：父卡片上沿往上 8px、最后一张子卡片下沿再往下 24px，出了这个范围就算"拖出容器"
    var 拖出 = false, 出方向 = 0, 块顶 = 0, 块底 = 0, 父卡 = null;
    function clearArm() { if (armTimer) { clearTimeout(armTimer); armTimer = null; } }
    /* 手指指到哪个容器身上了：指容器卡片本身、或指容器里的子卡片，都算落在这个容器上。
       拖动中的卡片被设了 pointer-events:none，所以这里"摸"到的是它下面的卡片。 */
    function 拖到哪个容器(x, y) {
      var n = document.elementFromPoint(x, y);
      var cc = n && n.closest ? n.closest('.compcard') : null;
      if (!cc || !cc.dataset.id) return null;
      if (cc.dataset.id === compId) return null;
      var 源 = 找控件(cc.dataset.id);
      if (!源) return null;
      if (源.parent) return 源.parent;
      return 是容器(源.c) ? 源.c : null;
    }
    function 标容器高亮(容器) {
      Array.prototype.forEach.call(box.querySelectorAll('.compcard.drop-in'), function (n) { n.classList.remove('drop-in'); });
      if (!容器) return;
      var 卡 = box.querySelector('.compcard[data-id="' + 容器.id + '"]');
      if (卡) 卡.classList.add('drop-in');
    }
    function 标父块(on) { if (父卡) 父卡.classList.toggle('drop-out', !!on); }
    /** 当前容器里的兄弟卡片（不含正在浮动的这张） */
    function 兄弟卡() {
      return Array.prototype.slice.call(box.querySelectorAll('.compcard[data-parent="' + 父.id + '"]:not(.reordering)'));
    }
    /** 按手指位置把占位符挪到 others 里的第 target 位，并用 FLIP 让其他卡片平滑让位 */
    function 排位(e, others) {
      var target = others.length;
      for (var i = 0; i < others.length; i++) {
        var r = others[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { target = i; break; }
      }
      var ref;
      if (target < others.length) ref = others[target];
      else if (父) ref = (others.length ? others[others.length - 1].nextSibling : (父卡 ? 父卡.nextSibling : null)) || card;
      else ref = card;                       // 顶层插到最后：位于浮动的卡片之前
      if (ref === ph) return;                // 已经在这个位置
      others.forEach(function (o) { o.style.transition = 'none'; });
      var first = others.map(function (o) { return o.getBoundingClientRect().top; });
      box.insertBefore(ph, ref || card);
      others.forEach(function (o) { o.style.transform = ''; });
      void box.offsetHeight;   // 强制 reflow，得到去 transform 后的新布局位置
      var last = others.map(function (o) { return o.getBoundingClientRect().top; });
      others.forEach(function (o, i) {
        var d = first[i] - last[i];
        if (Math.abs(d) > 0.5) o.style.transform = 'translateY(' + d + 'px)';
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          others.forEach(function (o) {
            o.style.transition = 'transform .22s cubic-bezier(.2,0,0,1)';
            o.style.transform = '';
          });
        });
      });
    }
    function beginDrag(downE) {
      var 源 = 找控件(compId);
      if (!源) return;
      fromIdx = 源.index;
      dragging = true; cardReorder.start(compId);
      落点容器 = null; 拖出 = false; 出方向 = 0;
      var r = card.getBoundingClientRect();
      grabY = startY - r.top;
      if (父) {
        // 边界在起拖这一刻量好（此时被拖的这张还在原位），拖动中占位符挪来挪去也不会让边界乱跳
        父卡 = box.querySelector('.compcard[data-id="' + 父.id + '"]');
        var pr = 父卡 ? 父卡.getBoundingClientRect() : null;
        块顶 = pr ? pr.top - 8 : 0;
        var 底 = pr ? pr.bottom : 0;
        Array.prototype.forEach.call(box.querySelectorAll('.compcard[data-parent="' + 父.id + '"]'), function (n) {
          var nr = n.getBoundingClientRect();
          if (nr.bottom > 底) 底 = nr.bottom;
        });
        块底 = 底 + 24;
      } else { 父卡 = null; }
      ph = el('div', 'compcard-reph');
      ph.style.height = r.height + 'px';
      card.classList.add('reordering');
      card.style.pointerEvents = 'none';   // 让下面的卡片能被"摸"到，否则永远只摸到拖着的这张
      card.style.width = r.width + 'px';
      card.style.left = r.left + 'px';
      card.style.top = (downE.clientY - grabY) + 'px';
      card.parentNode.insertBefore(ph, card);   // 占位符先接管原位，再把卡片浮起来放到末位
      box.appendChild(card);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
    }
    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button')) return;   // 显隐/删除按钮不触发
      if (document.querySelector('.mask:not(.hidden)')) return;
      dragging = false; edgeDir = 0;
      startX = e.clientX; startY = e.clientY;
      clearArm();
      armTimer = setTimeout(function () { beginDrag(e); }, 300);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    }
    function edgeTick() {
      if (!dragging || !edgeDir) { edgeRaf = 0; return; }
      var 前 = box.scrollTop;
      box.scrollTop += edgeDir * 9;
      var 差 = box.scrollTop - 前;
      if (差) { 块顶 -= 差; 块底 -= 差; }   // 列表滚了，屏幕上量的边界跟着走
      edgeRaf = requestAnimationFrame(edgeTick);
    }
    function onMove(e) {
      if (!dragging) {
        // 长按生效前手指移动超过阈值 => 判定为滚动列表，取消长按
        if (Math.abs(e.clientX - startX) > 9 || Math.abs(e.clientY - startY) > 9) clearArm();
        return;
      }
      e.preventDefault();
      card.style.top = (e.clientY - grabY) + 'px';
      if (父) {
        // 容器里的子卡片：还在父块里就和其他子卡片换位，拖出父块就准备放回页面顶层
        var 上 = e.clientY < 块顶, 下 = e.clientY > 块底;
        var 新拖出 = 上 || 下;
        if (新拖出 !== 拖出) {
          拖出 = 新拖出;
          出方向 = 上 ? -1 : (下 ? 1 : 0);
          标父块(拖出);
          if (ph) ph.style.display = 拖出 ? 'none' : '';
        }
        if (!拖出) 排位(e, 兄弟卡());
      } else {
        // 指在容器身上时不排位，只把容器点亮，松手就放进去
        落点容器 = 拖到哪个容器(e.clientX, e.clientY);
        标容器高亮(落点容器);
        if (落点容器) {
          if (edgeRaf) { cancelAnimationFrame(edgeRaf); edgeRaf = 0; }
          edgeDir = 0;
          return;
        }
        排位(e, Array.prototype.slice.call(box.querySelectorAll('.compcard:not(.reordering):not(.is-child)')));
      }
      var br = box.getBoundingClientRect();
      edgeDir = e.clientY < br.top + 34 ? -1 : (e.clientY > br.bottom - 34 ? 1 : 0);
      if (edgeDir && !edgeRaf) edgeRaf = requestAnimationFrame(edgeTick);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      clearArm();
      if (edgeRaf) { cancelAnimationFrame(edgeRaf); edgeRaf = 0; }
      if (!dragging) return;
      dragging = false;
      标容器高亮(null); 标父块(false);

      // —— 容器里的子卡片 ——
      if (父) {
        if (拖出) {
          var 方向 = 出方向;
          if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
          cardReorder.stop();
          var sc0 = curScreen();
          var 父位置 = sc0.components.indexOf(父);
          var at = (父位置 < 0 ? 0 : 父位置) + (方向 > 0 ? 1 : 0);   // 往上拖放到容器前，往下拖放到容器后
          if (移出容器(compId, at)) {
            renderCompList(); if (state.inLayout) renderLayout(); autosave(); snack('已移出容器');
          } else {
            renderCompList();
          }
          return;
        }
        // 容器内换位：按占位符在兄弟卡片里的先后算新下标
        var to = 0;
        for (var i = 0; i < box.children.length; i++) {
          var n = box.children[i];
          if (n === ph) break;
          if (n.classList && n.classList.contains('compcard') && !n.classList.contains('reordering') &&
              n.dataset.parent === String(父.id)) to++;
        }
        var 子起飞 = null, 子落点 = null;
        try { 子落点 = ph ? ph.getBoundingClientRect() : null; 子起飞 = card.getBoundingClientRect(); } catch (e) {}
        if (子落点 && 子起飞) {
          card.style.transition = 'transform .19s cubic-bezier(.2,0,0,1), opacity .19s ease, box-shadow .19s ease';
          card.style.transform = 'translateY(' + Math.round(子落点.top - 子起飞.top) + 'px) scale(1)';
          card.style.opacity = '1';
          card.style.boxShadow = '0 4px 12px rgba(0,0,0,.12)';
        }
        setTimeout(function () {
          if (to !== fromIdx && fromIdx >= 0 && 父.children) {
            var 挪 = 父.children.splice(fromIdx, 1)[0];
            if (挪) 父.children.splice(Math.min(to, 父.children.length), 0, 挪);
          }
          cardReorder.stop();
          renderCompList(); if (state.inLayout) renderLayout(); autosave();
        }, 190);
        return;
      }

      // —— 顶层卡片：指在容器上 → 放进容器（不走排序） ——
      if (落点容器) {
        var 目标 = 落点容器; 落点容器 = null;
        if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
        cardReorder.stop();
        if (移入容器(compId, 目标.id)) {
          renderCompList(); if (state.inLayout) renderLayout(); autosave(); snack('已放进容器');
        } else {
          renderCompList();
        }
        return;
      }
      // 松手不再"啪"一下跳回去：让卡片从当前位置滑到落点（占位虚线框那儿），落稳再重排列表
      var 落点 = null;
      try { 落点 = ph ? ph.getBoundingClientRect() : null; } catch (e) {}
      var 起飞 = null;
      try { 起飞 = card.getBoundingClientRect(); } catch (e) {}
      if (落点 && 起飞) {
        // 只做竖直方向的落位（横向不动 —— 按位移动会在松手时"向右滑一下"，用户反馈很怪）
        card.style.transition = 'transform .19s cubic-bezier(.2,0,0,1), opacity .19s ease, box-shadow .19s ease';
        card.style.transform = 'translateY(' + Math.round(落点.top - 起飞.top) + 'px) scale(1)';
        card.style.opacity = '1';
        card.style.boxShadow = '0 4px 12px rgba(0,0,0,.12)';
      }
      setTimeout(function () {
        // 只数顶层卡片，容器里的子卡片不参与这个下标（否则顺序会算错位）
        var toIdx = 0;
        for (var i = 0; i < box.children.length; i++) {
          var n = box.children[i];
          if (n === ph) break;
          if (n.classList && n.classList.contains('compcard') && !n.classList.contains('is-child') && !n.classList.contains('reordering')) toIdx++;
        }
        var sc = curScreen();
        if (toIdx >= 0 && toIdx !== fromIdx && fromIdx >= 0) {
          var item = sc.components.splice(fromIdx, 1)[0];
          sc.components.splice(Math.min(toIdx, sc.components.length), 0, item);
        }
        cardReorder.stop();
        renderCompList(); if (state.inLayout) renderLayout(); autosave();
      }, 190);
    }
    card.addEventListener('pointerdown', onDown, true);
  }
  function delComp(id) {
    var 源 = 找控件(id);
    if (源) 源.list.splice(源.index, 1);      // 容器里的子控件也要能删（走同一套查找）
    if (state.selectedCompId === id) state.selectedCompId = null;
    renderCompList(); if (state.inLayout) renderLayout(); autosave();
  }
  function switchScreen(id) {
    // 切页瞬间先显式记下"正在离开的这一页"看到哪儿了（不依赖 saveCurrentWs 的调用顺序）
    try {
      var prev = curScreen();
      if (prev && state.ws && state.wsInited) {
        prev.view = { x: Math.round(state.ws.scrollX || 0), y: Math.round(state.ws.scrollY || 0),
                      scale: state.ws.getScale ? state.ws.getScale() : 1 };
      }
    } catch (e) {}
    saveCurrentWs(true);
    state.curScreenId = id; state.selectedCompId = null;
    renderTabs(); renderCompList();
    if (state.wsInited) loadScreenToWs(curScreen());
    autosave();
    /* 在布局页里换页：方向必须跟着「如何预览」重算一遍，否则会留在上一页的方向上
       （用户报的 bug：横屏预览切到竖屏页面，屏幕还是横的，竖屏内容被横着摆）。
       然后重画舞台并重新 fit（物理旋转是异步的，靠 resize 监听和这里的多帧兜底）。 */
    if (state.inLayout) {
      applyLayoutOrient();
      renderLayout();
      requestAnimationFrame(fitStage);
    }
  }
  function addScreen() {
    saveCurrentWs(true);
    var n = state.project.screens.length + 1, id = 's' + Date.now().toString(36);
    state.project.screens.push({ id: id, title: '页面' + n, components: [], blocksXml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>' });
    switchScreen(id);
  }
  function deleteScreen() {
    var screens = state.project.screens;
    if (screens.length <= 1) { modal('无法删除', '至少要保留一个页面。'); return; }
    var cur = curScreen();
    var msg = el('div'); msg.appendChild(document.createTextNode('确定删除页面「'));
    msg.appendChild(el('span', 'confirm-name', cur.title || cur.id));
    msg.appendChild(document.createTextNode('」及其全部组件和代码？'));
    confirmDialog({ title: '删除页面', msg: msg, okText: '删除' }).then(function (yes) {
      if (!yes) return;
      saveCurrentWs(true);
      var idx = screens.indexOf(cur);
      screens.splice(idx, 1);
      // 其他页面“跳转到页面”代码若指向被删页，改写为第一个页面，避免运行时静默跳不到
      var fallback = screens[0].id;
      screens.forEach(function (s) {
        if (!s.blocksXml) return;
        s.blocksXml = s.blocksXml.replace(new RegExp('(<field name="PAGE">)' + cur.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(</field>)', 'g'), '$1' + fallback + '$2');
      });
      var next = screens[Math.max(0, idx - 1)];
      state.project.startScreen = screens[0].id;
      state.curScreenId = next.id; state.selectedCompId = null;
      renderTabs(); renderCompList();
      if (state.wsInited) loadScreenToWs(next);
      autosave();
    });
  }

  /* ---------------- 属性面板（schema 化：内容/位置大小/样式） ---------------- */
  function ppField(labelText, input) {
    var f = el('div', 'pp-field'); f.appendChild(el('span', null, labelText)); f.appendChild(input); return f;
  }
  function txtInput(value, ph, oninput) {
    var i = el('input'); i.type = 'text'; i.value = value || ''; if (ph) i.placeholder = ph;
    i.addEventListener('input', function () { oninput(i.value); });
    return i;
  }
  function numInput(value, ph, oninput) {
    var i = el('input'); i.type = 'number'; i.value = value == null ? '' : value; if (ph) i.placeholder = ph;
    i.addEventListener('input', function () {
      var raw = (i.value || '').trim();
      if (raw === '') { oninput(null); return; }            // 留空=自动，不影响其它参数
      var n = Number(raw);
      oninput(isFinite(n) ? Math.round(n) : null);          // 非法数字按空处理，避免 NaN 拖垮组件
    });
    return i;
  }
  function areaInput(value, oninput) {
    var a = el('textarea'); a.value = value || '';
    a.addEventListener('input', function () { oninput(a.value); });
    return a;
  }
  function colorInput(value, fallback, oninput) {
    // M3 色块（点击弹自研取色器，不再用系统原生 type=color）+ HEX 文本，二者都可靠生效
    var row = el('div', 'pp-color');
    var chip = el('button', 'cp-chip'); chip.type = 'button';
    function paint() {
      var v = normalizeHex(t.value) || normalizeHex(fallback);
      chip.style.background = v || 'var(--c-high)';
      chip.classList.toggle('empty', !v);
    }
    var t = el('input'); t.type = 'text'; t.value = value || ''; t.placeholder = fallback || '#000000';
    t.addEventListener('input', function () { oninput(t.value); paint(); });
    t.addEventListener('blur', function () {           // 失焦时把合法简写规范成 #RRGGBB
      var v = normalizeHex(t.value);
      if (v) { t.value = v; oninput(v); } paint();
    });
    chip.addEventListener('click', function () {
      pickColor(t.value || fallback).then(function (res) {
        if (res === null) return;                        // 取消：不变
        t.value = res; oninput(res || null); paint();    // '' = 恢复默认（清除）
      });
    });
    paint();
    row.appendChild(chip); row.appendChild(t); return row;
  }
  function segInput(options, value, oninput) {
    var wrap = el('div', 'pp-seg');
    options.forEach(function (op) {
      var b = el('button', (value || options[0][1]) === op[1] ? 'on' : '', op[0]);
      b.addEventListener('click', function () {
        oninput(op[1]); Array.prototype.forEach.call(wrap.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      wrap.appendChild(b);
    });
    return wrap;
  }
  // ===== 防“点击穿透”：浮层菜单项被点中后菜单随即移除，部分安卓 WebView 会把同一次
  // 触摸的收尾 click（ghost click）派发给菜单下方的元素，导致“点菜单项连同下面按钮一起点到”。
  // 菜单项点击时在其坐标布防，短时间内吞掉落在附近的 pointer/click 事件。 =====
  var ghostGuards = [];
  function armGhostGuard(x, y) {
    if (x == null || y == null) return;
    ghostGuards.push({ x: x, y: y, until: Date.now() + 450 });
    if (ghostGuards.length > 8) ghostGuards.shift();
  }
  (function () {
    function hit(e) {
      if (!ghostGuards.length) return false;
      var cx = e.clientX, cy = e.clientY;
      if (cx == null && e.touches && e.touches.length) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
      if (cx == null && e.changedTouches && e.changedTouches.length) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
      var now = Date.now(), hitFlag = false;
      for (var i = ghostGuards.length - 1; i >= 0; i--) {
        var g = ghostGuards[i];
        if (now > g.until) { ghostGuards.splice(i, 1); continue; }
        if (Math.abs(cx - g.x) <= 28 && Math.abs(cy - g.y) <= 28) hitFlag = true;
      }
      return hitFlag;
    }
    ['pointerdown', 'pointerup', 'click', 'touchend'].forEach(function (evName) {
      document.addEventListener(evName, function (e) {
        if (hit(e)) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
      }, true);
    });
  })();

  // ===== 点击穿透兜底（真机 WebView）：浮层（下拉/长按菜单/弹窗）在本次触摸中被关闭或移除时，
  // 立即在全屏盖一层透明“点击捕手”数百毫秒，从命中测试层面吞掉同一手势补发的
  // pointer/touch/mouse/click 收尾事件——不依赖坐标和事件先后顺序，保证点不到浮层下面的按钮。 =====
  function isFloatLayer(node) {
    if (!node || node.nodeType !== 1 || !node.closest) return null;
    return (node.closest('.popover, .modal, .mask, .pp-sel-menu, .menu-list, .blocklyDropDownDiv, '
      + '.blocklyDropdownMenu, [role="dialog"], [id$="Mask"], [id$="Menu"], #ifMutMenu, #ifMutMask, '
      + '#aiBall'));   // 只把悬浮球算浮层。#aiPanel 不算：面板很大，碰一下它就会让防穿透机制乱触发
  }
  function layerIsGone(fl) {
    if (!fl) return true;
    if (!document.body.contains(fl)) return true;
    var cn = fl.className || '';
    if (typeof cn === 'string' && /\bhidden\b/.test(cn)) return true;
    if (fl.offsetParent === null && getComputedStyle(fl).display === 'none') return true;
    return false;
  }
  var floatPressAt = 0;
  document.addEventListener('pointerdown', function (e) {
    if (isFloatLayer(e.target)) floatPressAt = Date.now();
  }, true);
  document.addEventListener('touchstart', function (e) {
    if (isFloatLayer(e.target)) floatPressAt = Date.now();
  }, { capture: true, passive: true });
  function installClickCatcher() {
    var old = document.getElementById('__clickCatcher');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.id = '__clickCatcher';
    d.style.cssText = 'position:fixed;inset:0;left:0;top:0;width:100vw;height:100vh;'
      + 'z-index:1500;background:transparent;touch-action:none;-webkit-tap-highlight-color:transparent';
    var kill = function (e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); };
    ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend',
      'mousedown', 'mouseup', 'click', 'contextmenu', 'dblclick'].forEach(function (nm) {
      d.addEventListener(nm, kill, { capture: true, passive: false });
    });
    document.body.appendChild(d);
    clearTimeout(d.__timer);
    d.__timer = setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 350);
  }
  // 浮层被移除，或被加上 hidden（本次触摸后 800ms 内）→ 立即布防
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (muts) {
      if (!floatPressAt || Date.now() - floatPressAt > 800) return;
      var fire = false;
      for (var i = 0; i < muts.length && !fire; i++) {
        var mt = muts[i];
        if (mt.type === 'childList') {
          mt.removedNodes.forEach(function (nd) { if (isFloatLayer(nd)) fire = true; });
        } else if (mt.type === 'attributes' && mt.attributeName === 'class') {
          if (isFloatLayer(mt.target) && /\bhidden\b/.test(mt.target.className || '')) fire = true;
        }
      }
      if (fire) { floatPressAt = 0; installClickCatcher(); }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  // 确定性兜底：一次落在浮层内的 click 在冒泡到 document 时，菜单项自己的 click 已经执行完，
  // 此时若浮层随即消失/隐藏，立即布防点击捕手并记录坐标守卫，吞掉真机 WebView 补发的 ghost click。
  // 浮层仍在（如齿轮连续点 +）则不布防，不影响连续操作。
  // 注意：不能在 pointerup/touchend 阶段提前布防——那会连菜单项自身的 click 一起吞掉。
  document.addEventListener('click', function (e) {
    var fl = isFloatLayer(e.target);
    if (!fl) return;
    var gx = e.clientX, gy = e.clientY;
    floatPressAt = Date.now();
    // 只有浮层确实因这次点击而关闭，才布防 ghost 守卫与点击捕手。
    // 齿轮 ＋/− 点击后菜单保持打开（用于连续加减），绝不能布防——否则守卫会在命中坐标
    // 吞掉紧接着的快速连点，表现为“快速点加号/减号漏掉一次分支增减”。
    function armIfGone() {
      if (layerIsGone(fl)) {
        if (gx != null) armGhostGuard(gx, gy);
        installClickCatcher();
      }
    }
    if (layerIsGone(fl)) armIfGone();
    else {
      setTimeout(armIfGone, 0);
      setTimeout(armIfGone, 60);
    }
  }, false);
  // pointerdown 落在浮层内即打时间戳，供 MutationObserver 在浮层被移除时布防
  // （覆盖长按菜单等在 pointerup 阶段就关闭、不产生 click 的路径）。
  function markFloatPress(e) {
    if (isFloatLayer(e.target)) floatPressAt = Date.now();
  }
  document.addEventListener('pointerup', markFloatPress, true);
  document.addEventListener('touchend', markFloatPress, { capture: true, passive: true });

  // ===== 应用内 M3 下拉（替代原生 <select>，避免安卓 WebView 弹系统老旧选择框） =====
  function closeM3SelectMenu() {
    if (document._ppSel) {
      var x = document._ppSel;
      if (x.menu && x.menu.parentNode) x.menu.parentNode.removeChild(x.menu);
      document.removeEventListener('pointerdown', x.onDocDown, true);
      document.removeEventListener('contextmenu', x.onCtx, true);
      window.removeEventListener('scroll', x.onScroll, true);
      window.removeEventListener('resize', x.onScroll);
      document._ppSel = null;
    }
  }
  // 在 anchor 旁弹出 M3 选项菜单；options=[[文字,值],…]，current 为当前值，onPick(值,文字)。
  // 不使用全屏遮罩：遮罩会先于按钮收到第二次按下并关闭菜单，按钮 click 又把它重新打开，
  // 表现为“再点一次按钮收不起”。改为 document 捕获阶段判断落点：点锚点自身 => 由按钮
  // click 做 toggle；点菜单内 => 放行；点其他区域 => 关闭。
  function openM3SelectMenu(anchor, options, current, onPick) {
    function norm(v) { return v == null ? '' : String(v); }
    // 同一个按钮再次点击：收起；点的是另一个下拉：关闭旧的后继续打开新的
    if (document._ppSel) {
      var same = document._ppSel.anchor === anchor;
      closeM3SelectMenu();
      if (same) return;
    }
    var cur = norm(current);
    var menu = el('div', 'popover pp-sel-menu');
    menu.style.zIndex = 1300;
    options.forEach(function (op) {
      var v = norm(op[1]);
      var item = el('button', 'menu-item' + (v === cur ? ' on' : ''));
      item.type = 'button';
      item.textContent = op[0];
      item.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        armGhostGuard(ev.clientX, ev.clientY);   // 菜单移除后拦截同位置 ghost click，防穿透
        closeM3SelectMenu();
        onPick(v, op[0]);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    menu.style.visibility = 'hidden';
    var r = anchor.getBoundingClientRect();
    var mw = Math.max(r.width, menu.offsetWidth, 168);
    var mh = menu.offsetHeight;
    menu.style.width = mw + 'px';
    var left = r.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    if (top < 8) top = 8;
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.style.visibility = '';
    function onDocDown(ev) {
      if (menu.contains(ev.target) || (anchor && anchor.contains(ev.target))) return;
      // 点外部关闭：本次触摸也不应穿透到浮层下面的元素（首次点按只负责关闭）
      if (typeof installClickCatcher === 'function') installClickCatcher();
      closeM3SelectMenu();
    }
    function onCtx(ev) { ev.preventDefault(); ev.stopPropagation(); }
    function onScroll() { closeM3SelectMenu(); }
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document._ppSel = { menu: menu, anchor: anchor, onDocDown: onDocDown, onCtx: onCtx, onScroll: onScroll };
  }
  // 把一个静态 <button> 变成 M3 下拉：btn.value 作为当前值，选中后派发 'change'（兼容原 <select> 用法）
  function wireM3StaticSelect(btn, options) {
    function norm(v) { return v == null ? '' : String(v); }
    function labelOf(v) {
      for (var i = 0; i < options.length; i++) if (norm(options[i][1]) === v) return options[i][0];
      return options.length ? options[0][0] : '';
    }
    function syncLabel() {
      var lab = btn.querySelector('.m3s-label');
      if (lab) lab.textContent = labelOf(btn.value);
    }
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      openM3SelectMenu(btn, options, btn.value, function (v) {
        btn.value = v; syncLabel();
        btn.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    syncLabel();
    btn._syncM3Label = syncLabel;
  }
  // 下拉选择（选项较多时用，如按钮风格/艺术字/外观）。options=[[文字,值],…]，'' = 默认
  function selectInput(options, value, oninput) {
    var btn = el('button', 'pp-select pp-sel-btn');
    btn.type = 'button';
    var cur = String(value == null ? '' : value);
    var lab = el('span', 'pp-sel-label');
    btn.appendChild(lab); btn.appendChild(el('span', 'pp-sel-chev'));
    function refresh() {
      for (var i = 0; i < options.length; i++) {
        var v = options[i][1] == null ? '' : String(options[i][1]);
        if (v === cur) { lab.textContent = options[i][0]; return; }
      }
      lab.textContent = options.length ? options[0][0] : '';
    }
    refresh();
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      openM3SelectMenu(btn, options, cur, function (v, txt) {
        cur = v; lab.textContent = txt; oninput(v === '' ? '' : v);
      });
    });
    return btn;
  }
  function sec(title) { return el('div', 'pp-sec', title); }

  // 属性字段构建（右侧属性栏与布局视图底部控制台共用）
  // afterEdit：每次改值后的轻量刷新；rebuild：需要整体重建（换图/复位）时调用
  function fillPropFields(host, c, afterEdit, rebuild, showVis) {
    var mark = function (fn) { return function (v) { fn(v); autosave(); afterEdit && afterEdit(); }; };

    host.appendChild(sec('基础'));
    host.appendChild(ppField('组件名称', txtInput(c.name || '', TYPE_META[c.type].label + ' (' + c.id + ')', mark(function (v) { c.name = v; }))));

    /* 内容 */
    host.appendChild(sec('内容'));
    if (c.type === 'text') host.appendChild(ppField('显示文字', areaInput(c.value, mark(function (v) { c.value = v; }))));
    if (c.type === 'button') {
      host.appendChild(ppField('按钮文字', txtInput(c.text, '按钮', mark(function (v) { c.text = v; }))));
      host.appendChild(ppField('按钮图标（emoji，可空）', txtInput(c.icon, '如 ✓、🔍', mark(function (v) { c.icon = v; }))));
    }
    if (c.type === 'input') {
      host.appendChild(ppField('输入框类型', selectInput([
        ['普通文本（默认）', ''], ['密码（打点显示）', 'password'], ['数字键盘', 'number'],
        ['电话键盘', 'tel'], ['邮箱键盘', 'email']
      ], c.inputType, mark(function (v) { c.inputType = v || ''; }))));
      host.appendChild(ppField('提示文字（灰色占位）', txtInput(c.hint, '请输入', mark(function (v) { c.hint = v; }))));
      host.appendChild(ppField('默认内容（可空）', txtInput(c.value, '', mark(function (v) { c.value = v; }))));
    }
    if (c.type === 'list') host.appendChild(ppField('列表项（每行一个）', areaInput((c.items || []).join('\n'), mark(function (v) { c.items = v.split('\n'); }))));
    if (c.type === 'table') {
      host.appendChild(ppField('表头（用逗号分隔）', txtInput((c.columns || []).join(','), '名称,数量',
        mark(function (v) { c.columns = v.split(',').map(function (s) { return s.trim(); }); }))));
      host.appendChild(ppField('每行数据（一行一条，单元格用逗号）',
        areaInput((c.rows || []).map(function (r) { return (r || []).join(','); }).join('\n'),
          mark(function (v) { c.rows = v.split('\n').filter(function (s) { return s.trim() !== ''; })
            .map(function (line) { return line.split(',').map(function (s) { return s.trim(); }); }); }))));
    }
    if (c.type === 'chart') {
      host.appendChild(ppField('图表类型', selectInput([['柱状图', 'bar'], ['折线图', 'line'], ['饼图', 'pie']],
        c.chartType || 'bar', mark(function (v) { c.chartType = v || 'bar'; }))));
      host.appendChild(ppField('数据（一行一条，写「名称,数值」或只写数值）',
        areaInput((c.chartData || []).map(function (p) { return (p.label ? p.label + ',' : '') + p.value; }).join('\n'),
          mark(function (v) {
            c.chartData = v.split('\n').filter(function (s) { return s.trim() !== ''; }).map(function (line, i) {
              var 段 = line.split(/[,，]/).map(function (s) { return s.trim(); });
              if (段.length >= 2) return { label: 段[0], value: Number(段[1]) || 0 };
              return { label: String(i + 1), value: Number(段[0]) || 0 };
            });
          }))));
    }
    if (c.type === 'select' || c.type === 'radio') {
      host.appendChild(ppField('选项（每行一个）', areaInput((c.items || []).join('\n'), mark(function (v) { c.items = v.split('\n'); }))));
      host.appendChild(ppField('默认选中（填选项文字）', txtInput(c.value, (c.items || [])[0] || '', mark(function (v) { c.value = v; }))));
    }
    if (c.type === 'date') host.appendChild(ppField('默认日期（如 2025-01-01，可空）', txtInput(c.value, '2025-01-01', mark(function (v) { c.value = v; }))));
    if (c.type === 'time') host.appendChild(ppField('默认时间（如 08:30，可空）', txtInput(c.value, '08:30', mark(function (v) { c.value = v; }))));
    if (c.type === 'multiSelect') {
      host.appendChild(ppField('选项（每行一个）', areaInput((c.items || []).join('\n'), mark(function (v) {
        c.items = v.split('\n').filter(function (s) { return s.trim() !== ''; });
      }))));
      var 已选 = Array.isArray(c.value) ? c.value : String(c.value == null ? '' : c.value).split(/[,，、\n]/).filter(function (s) { return s !== ''; });
      host.appendChild(ppField('默认选中（每行一个已选项）', areaInput(已选.join('\n'), mark(function (v) {
        c.value = v.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
      }))));
    }
    if (c.type === 'dateRange') {
      var drRow = el('div', 'pp-row2');
      drRow.appendChild(ppField('开始日期（如 2025-01-01）', txtInput(c.start, '2025-01-01', mark(function (v) { c.start = v; }))));
      drRow.appendChild(ppField('结束日期（如 2025-01-31）', txtInput(c.end, '2025-01-31', mark(function (v) { c.end = v; }))));
      host.appendChild(drRow);
    }
    if (c.type === 'colorPicker') {
      host.appendChild(ppField('默认颜色', colorInput(c.value, '#6750a4', mark(function (v) { c.value = v; }))));
    }
    if (c.type === 'stepper') {
      host.appendChild(ppField('前面的说明文字', txtInput(c.text, '数量', mark(function (v) { c.text = v; }))));
      host.appendChild(ppField('初始值', numInput(c.value, 1, mark(function (v) { c.value = v; }))));
      host.appendChild(ppField('最小值', numInput(c.min, 0, mark(function (v) { c.min = v; }))));
      host.appendChild(ppField('最大值', numInput(c.max, 99, mark(function (v) { c.max = v; }))));
    }
    if (c.type === 'timer') {
      host.appendChild(ppField('显示的初始文字', txtInput(c.text, '00:00', mark(function (v) { c.text = v; }))));
    }
    if (c.type === 'card') {
      host.appendChild(ppField('卡片标题（可空）', txtInput(c.text, '卡片', mark(function (v) { c.text = v; }))));
    }
    if (c.type === 'imgbtn') {
      host.appendChild(ppField('按钮文字（可空）', txtInput(c.text, '按钮', mark(function (v) { c.text = v; }))));
    }
    if (c.type === 'image') {
      host.appendChild(ppField('占位说明', txtInput(c.alt, '图片', mark(function (v) { c.alt = v; }))));
      var upBtn = el('button', 'small', c.src ? '更换图片' : '上传图片');
      var finp = el('input'); finp.type = 'file'; finp.accept = 'image/*'; finp.className = 'hidden';
      finp.addEventListener('change', function () { pickImage(finp, function (url) { c.src = url; autosave(); rebuild && rebuild(); }); });
      upBtn.addEventListener('click', function () { finp.click(); });
      var row = el('div', 'pp-row2'); var f = el('div', 'pp-field'); f.appendChild(upBtn); f.appendChild(finp); row.appendChild(f);
      if (c.src) { var clr = el('button', 'small', '移除图片'); clr.addEventListener('click', mark(function () { c.src = null; rebuild && rebuild(); })); var f2 = el('div', 'pp-field'); f2.appendChild(clr); row.appendChild(f2); }
      host.appendChild(row);
    }

    if (c.type === 'switch' || c.type === 'checkbox') {
      host.appendChild(ppField('标签文字', txtInput(c.text || '', c.type === 'switch' ? '开关' : '复选项', mark(function (v) { c.text = v; }))));
      host.appendChild(ppField('初始状态', segInput([['未勾选', false], ['已勾选', true]], !!c.checked, mark(function (v) { c.checked = v; }))));
    }
    if (c.type === 'slider') {
      var slRow = el('div', 'pp-row2');
      slRow.appendChild(ppField('最小值', numInput(c.min, '0', mark(function (v) { c.min = v; }))));
      slRow.appendChild(ppField('最大值', numInput(c.max, '100', mark(function (v) { c.max = v; }))));
      host.appendChild(slRow);
      host.appendChild(ppField('默认数值', numInput(c.value, '0', mark(function (v) { c.value = v; }))));
    }
    if (c.type === 'progress') {
      var pgRow = el('div', 'pp-row2');
      pgRow.appendChild(ppField('最大值', numInput(c.max, '100', mark(function (v) { c.max = v; }))));
      pgRow.appendChild(ppField('当前进度', numInput(c.value, '0', mark(function (v) { c.value = v; }))));
      host.appendChild(pgRow);
    }
    if (c.type === 'tabs') {
      host.appendChild(ppField('页签（每行一个）', areaInput((c.items || []).join('\n'), mark(function (v) {
        c.items = v.split('\n').filter(function (s) { return s.trim() !== ''; });
      }))));
      host.appendChild(ppField('默认选中第几个（从 1 开始）', numInput(validN(c.value) ? (Number(c.value) + 1) : 1, '1', mark(function (v) {
        var n = Math.max(1, Math.round(Number(v) || 1));
        c.value = n - 1;                                  // 存的是序号（从 0 开始）
      }))));
    }
    if (c.type === 'collapse') {
      host.appendChild(ppField('标题文字', txtInput(c.text, '点我展开', mark(function (v) { c.text = v; }))));
      host.appendChild(ppField('展开后的内容', areaInput(c.body, mark(function (v) { c.body = v; }))));
      host.appendChild(ppField('初始状态', segInput([['收起', false], ['展开', true]], !!c.open, mark(function (v) { c.open = v; }))));
    }
    if (c.type === 'bottomNav') {
      host.appendChild(ppField('导航项（每行一个）', areaInput((c.items || []).join('\n'), mark(function (v) {
        c.items = v.split('\n').filter(function (s) { return s.trim() !== ''; });
        c.value = Math.max(0, Math.min(c.items.length - 1, Number(c.value) || 0));
      }))));
      host.appendChild(ppField('默认选中第几个（从 1 开始）', numInput(validN(c.value) ? (Number(c.value) + 1) : 1, '1', mark(function (v) {
        c.value = Math.max(1, Math.round(Number(v) || 1)) - 1;   // 存的是序号（从 0 开始）
      }))));
    }
    if (c.type === 'rating') {
      var rtRow = el('div', 'pp-row2');
      rtRow.appendChild(ppField('最多几颗星', numInput(c.max, '5', mark(function (v) { c.max = v; }))));
      rtRow.appendChild(ppField('初始星级', numInput(c.value, '0', mark(function (v) { c.value = v; }))));
      host.appendChild(rtRow);
    }
    if (c.type === 'ring') {
      var rgRow = el('div', 'pp-row2');
      rgRow.appendChild(ppField('最大值', numInput(c.max, '100', mark(function (v) { c.max = v; }))));
      rgRow.appendChild(ppField('当前值', numInput(c.value, '0', mark(function (v) { c.value = v; }))));
      host.appendChild(rgRow);
    }
    if (c.type === 'badge') {
      host.appendChild(ppField('徽章文字', txtInput(c.text, '新', mark(function (v) { c.text = v; }))));
      host.appendChild(ppField('圆点颜色', colorInput(c.dot, '#e5484d', mark(function (v) { c.dot = v; }))));
    }
    if (c.type === 'clock') {
      host.appendChild(ppField('显示格式', selectInput([
        ['14:05（时:分）', 'hm'], ['14:05:09（时:分:秒）', 'hms'], ['10月29日 14:05', 'mdhm']
      ], c.format || 'hm', mark(function (v) { c.format = v || 'hm'; }))));
    }
    if (c.type === 'qr') {
      host.appendChild(ppField('二维码内容（网址或一段文字）', areaInput(c.value, mark(function (v) { c.value = v; }))));
      if (String(c.value || '').length > 213) {
        var 超长 = el('div', 'pp-field'); 超长.style.color = '#c62828';
        超长.textContent = '内容超过 213 字节，二维码放不下，请换短一点的网址';
        host.appendChild(超长);
      }
    }
    if (c.type === 'video' || c.type === 'audio') {
      var isVid = c.type === 'video';
      host.appendChild(ppField(isVid ? '视频地址（网络链接，留空用本地）' : '音频地址（网络链接，留空用本地）',
        txtInput(c.src, isVid ? 'https://example.com/video.mp4' : 'https://example.com/audio.mp3', mark(function (v) { c.src = v; }))));
      var upBtn = el('button', 'small', isVid ? '选择本地视频' : '选择本地音频');
      upBtn.addEventListener('click', function () {
        if (!window.Native || !Native.pickMedia) { snack('本地上传需在安卓 App 内使用'); return; }
        state.pendingMediaCompId = c.id;
        Native.pickMedia(isVid ? 'video' : 'audio');
      });
      var upf = el('div', 'pp-field'); upf.appendChild(upBtn); host.appendChild(upf);
    }
    if (c.type === 'web') host.appendChild(ppField('网页网址（https://）', txtInput(c.url, 'https://example.com', mark(function (v) { c.url = v; }))));

    /* 位置与大小 */
    host.appendChild(sec('位置与大小（留空=自动排列）'));
    var posRow = el('div', 'pp-row2');
    posRow.appendChild(ppField('X 距左(px)', numInput(c.x, '自动', mark(function (v) { c.x = v; }))));
    posRow.appendChild(ppField('Y 距顶(px)', numInput(c.y, '自动', mark(function (v) { c.y = v; }))));
    host.appendChild(posRow);
    var sizeRow = el('div', 'pp-row2');
    sizeRow.appendChild(ppField('宽度(px)', numInput(c.w, '自适应', mark(function (v) {
      c.w = v;
      applyCenterLock(c);            // 居中锁着的话，改宽度立刻重新居中
    }))));
    if (c.type !== 'list') sizeRow.appendChild(ppField('高度(px)', numInput(c.h, '自适应', mark(function (v) { c.h = v; }))));
    host.appendChild(sizeRow);
    // 居中锁：打开以后无论怎么改宽度，控件中心点永远在画布中线（用户要求）
    var ctrBtn = el('button', 'small', c.cx ? '✔ 已水平居中（点一下取消）' : '水平居中（锁住中线）');
    ctrBtn.addEventListener('click', mark(function () {
      c.cx = !c.cx;
      if (c.cx) {
        if (!validN(c.x) && !validN(c.y)) {
          /**
           * **自动排列**的控件（刚建、还没拖过）：x/y 都是 null。
           * 以前这里直接 `c.y = 0` → 一点"水平居中"就跳到画布顶部（用户反馈）。
           * 注意不能用 `c.align` 来实现居中 —— 那是**文字对齐**（见控件样式里 textAlign 的用法），
           * 点了不会有任何位置变化（用户反馈"没反应"）。
           * 正解：先按自动流估算它此刻所在的 y，再转成绝对定位居中，视觉上原地不动。
           */
          c.y = estimateAutoY(c);
        }
        applyCenterLock(c);
      }
      rebuild && rebuild();
    }));
    var cb = el('div', 'pp-field'); cb.appendChild(ctrBtn); host.appendChild(cb);
    var resetPos = el('button', 'small', '恢复自动排列');
    resetPos.addEventListener('click', mark(function () { c.x = c.y = c.w = c.h = null; c.cx = false; rebuild && rebuild(); }));
    var rp = el('div', 'pp-field'); rp.appendChild(resetPos); host.appendChild(rp);

    /* 样式 */
    host.appendChild(sec('样式'));
    var fsRow = el('div', 'pp-row2');
    fsRow.appendChild(ppField('字号(px)', numInput(c.fs, '默认', mark(function (v) { c.fs = v; }))));
    fsRow.appendChild(ppField('圆角(px)', numInput(c.radius, '默认', mark(function (v) { v = (v === '' || v === null) ? '' : v; c.radius = v; }))));
    host.appendChild(fsRow);
    // 旋转：所有控件都能转（配合下面的"旋转"代码块，运行时也能改）
    var rotRow = el('div', 'pp-row2');
    rotRow.appendChild(ppField('旋转角度(°)', numInput(c.rot, '0', mark(function (v) { c.rot = (v === '' || v === null) ? null : v; }))));
    rotRow.appendChild(ppField('透明度(0~100)', numInput(c.opacity, '默认', mark(function (v) { c.opacity = (v === '' || v === null) ? null : v; }))));
    host.appendChild(rotRow);
    host.appendChild(ppField('文字颜色', colorInput(c.color, c.type === 'button' ? '#ffffff' : '#1f2329', mark(function (v) { c.color = v; }))));
    if (c.type === 'button' || c.type === 'input' || c.type === 'list' || c.type === 'select'
      || c.type === 'switch' || c.type === 'checkbox' || c.type === 'slider' || c.type === 'progress'
      || c.type === 'tabs' || c.type === 'collapse' || c.type === 'ring'
      || c.type === 'badge' || c.type === 'bottomNav' || c.type === 'scroll') {
      var bgFallback = (c.type === 'button' || c.type === 'switch' || c.type === 'checkbox' || c.type === 'slider'
        || c.type === 'progress' || c.type === 'ring') ? '#6750a4'
        : '#ffffff';
      host.appendChild(ppField(c.type === 'ring' ? '进度条颜色' : '背景颜色', colorInput(c.bg, bgFallback, mark(function (v) { c.bg = v; }))));
    }
    if (c.type === 'select') {
      // 下拉选择框：样式 + 调色（用户要求"多加几个样式，并且能调色"）
      host.appendChild(ppField('下拉样式', selectInput([
        ['M3 填充（默认）', ''], ['描边', 'outline'], ['下划线', 'underline'],
        ['胶囊', 'pill'], ['无边框', 'plain'], ['卡片浮起', 'card']
      ], c.variant, mark(function (v) { c.variant = v || ''; }))));
      host.appendChild(ppField('选项文字颜色', colorInput(c.color, '#1f2329', mark(function (v) { c.color = v; }))));
      host.appendChild(ppField('下拉小箭头颜色', colorInput(c.caretColor, '#6750a4', mark(function (v) { c.caretColor = v; }))));
    }
    host.appendChild(ppField('对齐方式', segInput([['左', 'left'], ['中', 'center'], ['右', 'right']], c.align, mark(function (v) { c.align = v; }))));
    host.appendChild(ppField('加粗', segInput([['正常', false], ['加粗', true]], c.bold, mark(function (v) { c.bold = v; }))));
    var decRow = el('div', 'pp-row2');
    decRow.appendChild(ppField('斜体', segInput([['正常', false], ['斜体', true]], !!c.italic, mark(function (v) { c.italic = v; }))));
    decRow.appendChild(ppField('下划线', segInput([['无', false], ['有', true]], !!c.underline, mark(function (v) { c.underline = v; }))));
    host.appendChild(decRow);
    host.appendChild(ppField('字间距(px)', numInput(c.spacing, '默认', mark(function (v) { c.spacing = v; }))));
    // 个性化外观：按钮风格 / 文字艺术字 / 容器外观
    if (c.type === 'button') {
      host.appendChild(ppField('按钮风格', selectInput([
        ['实心（默认）', ''], ['磨砂玻璃', 'glass'], ['描边', 'outline'],
        ['幽灵（纯文字）', 'ghost'], ['渐变', 'gradient'], ['全圆角胶囊', 'capsule'], ['立体阴影', 'shadow']
      ], c.btnStyle, mark(function (v) { c.btnStyle = v || ''; }))));
    }
    if (c.type === 'text') {
      host.appendChild(ppField('艺术字', selectInput([
        ['普通', ''], ['描边', 'stroke'], ['阴影', 'shadow'], ['霓虹发光', 'neon'],
        ['渐变彩色', 'gradient'], ['立体浮雕', 'emboss']
      ], c.artStyle, mark(function (v) { c.artStyle = v || ''; }))));
    }
    if (c.type === 'input' || c.type === 'list' || c.type === 'image'
      || c.type === 'video' || c.type === 'audio' || c.type === 'web') {
      host.appendChild(ppField('外观', selectInput([
        ['普通', ''], ['磨砂玻璃', 'glass'], ['描边', 'outline'], ['立体阴影', 'shadow']
      ], c.skin, mark(function (v) { c.skin = v || ''; }))));
    }
    // “初始可见”仅保留在拖动布局控制台；设计页已把隐藏开关放到卡片眼睛上，故详情面板不再显示
    if (showVis !== false)
      host.appendChild(ppField('初始可见', segInput([['显示', true], ['隐藏', false]], c.visible === false ? false : true, mark(function (v) { c.visible = v; }))));
    host.appendChild(ppField('透明度（0全透~100不透明）', numInput(validN(c.opacity) ? c.opacity : 100, '100', mark(function (v) { c.opacity = v; }))));

    var acts = el('div', 'pp-actions');
    var del = el('button', 'danger', '删除该组件');
    del.addEventListener('click', function () { delComp(c.id); });
    acts.appendChild(del); host.appendChild(acts);
  }

  function renderPropPanel() {
    var panel = $('propPanel'), c = selectedComp();
    if (!c) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden'); panel.innerHTML = '';
    var head = el('div', 'pp-head');
    head.appendChild(el('h4', null, '编辑 · ' + compName(c)));
    var x = el('button', 'pp-close', '✕');
    x.title = '关闭';
    x.addEventListener('click', function () { state.selectedCompId = null; renderCompList(); });
    head.appendChild(x); panel.appendChild(head);
    var body = el('div', 'pp-body');
    panel.appendChild(body);
    fillPropFields(body, c, function () {
      var idx = curScreen().components.indexOf(c);
      var cards = $('compList').querySelectorAll('.compcard');
      if (cards[idx]) { var t1 = cards[idx].querySelector('.t1'), t2 = cards[idx].querySelector('.t2'); if (t1) t1.textContent = compName(c); if (t2) t2.textContent = compDesc(c); }
      var hh = panel.querySelector('.pp-head h4'); if (hh) hh.textContent = '编辑 · ' + compName(c);
    }, renderPropPanel, false);
  }

  /* 选择图片 → **先裁剪** → 再压缩为 dataURL（最长边上限 256，控制工程体积）
     2026-10-28 用户需求：选完图要能自己裁一块。
     以前是"整张塞进画布再等比缩小"，想只要照片中间那块只能先拿别的软件裁好再传。 */
  function pickImage(input, cb) {
    var f = input.files && input.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () { openCropper(img, cb); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }

  /* ---------------- 裁剪弹窗 ----------------
     规格（2026-10-28 用户定）：**固定大小的正方形**，不许拉角改形状/大小；
     只能拖动、缩放图片来调整方块里露出的那块（和头像裁剪一个手感）。
     不引第三方库：舞台里一张绝对定位的 <img>，方块固定居中，框外那层半透明黑用 box-shadow 铺。
     坐标一律按**显示像素**算，确认时再乘（naturalWidth / 显示宽）映射回原图。 */
  function openCropper(img, cb) {
    var 旧 = $('cropMask'); if (旧 && 旧.parentNode) 旧.parentNode.removeChild(旧);

    var mask = el('div', 'mask crop-mask'); mask.id = 'cropMask';
    var box = el('div', 'crop-box');
    var stage = el('div', 'crop-stage');
    var ph = el('img'); ph.src = img.src;
    var sq = el('div', 'crop-sq');
    stage.appendChild(ph); stage.appendChild(sq);
    var btns = el('div', 'crop-btns');
    var bNo = el('button', 'tb', '取消'), bYes = el('button', 'tb primary', '完成');
    bNo.type = 'button'; bYes.type = 'button';
    btns.appendChild(bNo); btns.appendChild(bYes);
    box.appendChild(el('div', 'crop-title', '裁剪图片'));
    box.appendChild(stage);
    box.appendChild(el('div', 'crop-tip', '拖动图片、双指或滚轮缩放，方块里就是保留的部分'));
    box.appendChild(btns);
    mask.appendChild(box);
    document.body.appendChild(mask);

    var 台 = null;                 // 舞台尺寸
    var 方 = 0;                    // 方块边长（固定，不随图片变）
    var 倍 = 1, 最小倍 = 1;        // 倍 = 显示像素 / 原图像素（最小倍保证图片盖满方块）
    var 偏 = { x: 0, y: 0 };       // 图片中心相对方块中心的位移
    var 指 = {}, 拖 = null, 捏 = null;

    function 量台() {
      // 用 clientWidth/Height 而不是 getBoundingClientRect：弹窗进场有 pop 缩放动画，
      // rect 量到的是被缩过的尺寸，方块会跟着变小且此后不再修正。
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return false;
      台 = { w: w, h: h };
      方 = Math.max(40, Math.round(Math.min(w, h) * 0.82));
      最小倍 = Math.max(方 / img.naturalWidth, 方 / img.naturalHeight);
      return true;
    }
    function 夹偏() {
      var w = img.naturalWidth * 倍, h = img.naturalHeight * 倍;
      var mx = Math.max(0, (w - 方) / 2), my = Math.max(0, (h - 方) / 2);
      偏.x = Math.min(mx, Math.max(-mx, 偏.x));
      偏.y = Math.min(my, Math.max(-my, 偏.y));
    }
    function 布局() {
      var w = img.naturalWidth * 倍, h = img.naturalHeight * 倍;
      夹偏();
      ph.style.width = w + 'px'; ph.style.height = h + 'px';
      ph.style.left = ((台.w - w) / 2 + 偏.x) + 'px';
      ph.style.top = ((台.h - h) / 2 + 偏.y) + 'px';
      sq.style.width = 方 + 'px'; sq.style.height = 方 + 'px';
      sq.style.left = ((台.w - 方) / 2) + 'px';
      sq.style.top = ((台.h - 方) / 2) + 'px';
    }
    function 初始() {
      if (!量台()) return false;
      倍 = 最小倍; 偏 = { x: 0, y: 0 };
      布局();
      return true;
    }
    function 缩放(到) {
      var lo = 最小倍, hi = 最小倍 * 6;      // 最多放大 6 倍，够挑细节了
      倍 = Math.min(hi, Math.max(lo, 到));
      布局();
    }
    function 位(e) {
      var r = stage.getBoundingClientRect();
      // 进场动画期间 rect 是被 transform 缩过的：按"布局尺寸 / 视觉尺寸"换回布局坐标
      var kx = (台 && r.width) ? 台.w / r.width : 1;
      var ky = (台 && r.height) ? 台.h / r.height : 1;
      return { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * ky };
    }
    function 指距() {
      var ids = Object.keys(指);
      if (ids.length < 2) return 0;
      var a = 指[ids[0]], b = 指[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    // 事件统一挂舞台：手指落在图片上还是方块上都冒泡到这里（两者都 pointer-events:none）
    function 按下(e) {
      if (!台 && !初始()) return;
      指[e.pointerId] = 位(e);
      var ids = Object.keys(指);
      if (ids.length >= 2) { 捏 = { d: 指距(), 倍: 倍 }; 拖 = null; }
      else { 拖 = { sx: 指[e.pointerId].x, sy: 指[e.pointerId].y, ox: 偏.x, oy: 偏.y }; 捏 = null; }
      try { stage.setPointerCapture(e.pointerId); } catch (x) { }
      e.preventDefault();
    }
    function 移动(e) {
      if (!台 || !指[e.pointerId]) return;
      指[e.pointerId] = 位(e);
      if (Object.keys(指).length >= 2 && 捏 && 捏.d > 0) {
        缩放(捏.倍 * (指距() / 捏.d));
      } else if (拖) {
        偏 = { x: 拖.ox + (指[e.pointerId].x - 拖.sx), y: 拖.oy + (指[e.pointerId].y - 拖.sy) };
        布局();
      }
      e.preventDefault();
    }
    function 松开(e) {
      delete 指[e.pointerId];
      var ids = Object.keys(指);
      if (ids.length === 0) { 拖 = null; 捏 = null; }
      else if (ids.length === 1) {
        拖 = { sx: 指[ids[0]].x, sy: 指[ids[0]].y, ox: 偏.x, oy: 偏.y }; 捏 = null;
      }
    }
    function 滚(e) {
      if (!台) return;
      缩放(倍 * Math.exp(-e.deltaY * 0.0012));
      e.preventDefault();
    }
    function 尺寸变了() { if (!台) return; var 前 = 方; 量台(); if (方 !== 前) { 倍 = Math.max(倍, 最小倍); } 布局(); }
    function 关(收尾) {
      window.removeEventListener('resize', 尺寸变了);
      document.removeEventListener('pointermove', 移动);
      document.removeEventListener('pointerup', 松开);
      document.removeEventListener('pointercancel', 松开);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      if (收尾) 收尾();
    }

    stage.addEventListener('pointerdown', 按下);
    stage.addEventListener('wheel', 滚, { passive: false });
    document.addEventListener('pointermove', 移动);
    document.addEventListener('pointerup', 松开);
    document.addEventListener('pointercancel', 松开);
    window.addEventListener('resize', 尺寸变了);
    bNo.addEventListener('click', function () { 关(); });   // 取消不回调：调用方什么都不改
    bYes.addEventListener('click', function () {
      if (!台) { 关(); return; }
      // 方块 → 原图：两边同长，所以裁出来的天然是正方形
      var sw = Math.min(方 / 倍, img.naturalWidth, img.naturalHeight);
      var cx = img.naturalWidth / 2 - 偏.x / 倍;
      var cy = img.naturalHeight / 2 - 偏.y / 倍;
      var sx = Math.min(Math.max(0, cx - sw / 2), img.naturalWidth - sw);
      var sy = Math.min(Math.max(0, cy - sw / 2), img.naturalHeight - sw);
      // 出口统一压到 256 以内（和以前一样控制工程体积），只缩不放大
      var 缩 = Math.min(1, 256 / sw);
      var side = Math.max(1, Math.round(sw * 缩));
      var cv = document.createElement('canvas'); cv.width = side; cv.height = side;
      cv.getContext('2d').drawImage(img, sx, sy, sw, sw, 0, 0, side, side);
      var url = cv.toDataURL('image/png');
      关(function () { cb(url); });
    });

    初始();
    if (!台) requestAnimationFrame(function () { if (!初始() && !台) requestAnimationFrame(初始); });
    // 图片刚挂上去可能还没解码出尺寸：等 load 再量一次（decode 完 naturalWidth 才可靠）
    if (!img.complete || !img.naturalWidth) ph.onload = function () { if (!台) 初始(); };
  }


  /* ---------------- 自定义渲染器 fastzelos ---------------------------------------
     形态语言：语句代码 = 左边一条直线、右端整端半圆（D 形）；上下堆叠边铺平无卡扣；
     半包围（C 形）代码脊柱与底边纤细、臂端圆润；值代码保持药丸/圆槽。 ---------------- */
  var FAST_RENDERER_REGISTERED = false;
  function registerFastRenderer() {
    if (FAST_RENDERER_REGISTERED || !window.Blockly || !Blockly.zelos) return;
    var z = Blockly.zelos;
    var P = Blockly.utils.svgPaths;
    var T = Blockly.blockRendering.Types;
    var R_CAP = 20;        // 右端半圆角半径（= 单行语句块半高，上下弧正好相接）
    var R_INSIDE = 8;      // C 形开口内凹角半径（小而圆，臂更纤细）
    var NOTCH_W = 8;       // 语句连接齿宽（视觉已铺平，仅保留布局所需小尺寸，C 形脊柱随之变细）
    var CORNER_KEEP_H = 8; // 右端圆角在顶/底行保留的高度（块高维持原值，半圆与内容同心）
    class FastConstants extends z.ConstantProvider {
      init() {
        super.init();
        this.CORNER_RADIUS = R_CAP;                       // 外角半径（右圆角 measurable 取此值）
        this.INSIDE_R = R_INSIDE;
        this.NOTCH_WIDTH = NOTCH_W;
        this.NOTCH_OFFSET_LEFT = 12;
        this.STATEMENT_INPUT_PADDING_LEFT = 8;
        this.BOTTOM_ROW_AFTER_STATEMENT_MIN_HEIGHT = 8;  // C 形底臂厚度 = 侧边脊柱厚度（8）
        this.EMPTY_STATEMENT_INPUT_HEIGHT = 24;           // 空开口高度（= zelos 标准 6*GRID_UNIT，保证开口不塌陷）
        this.NOTCH = this.makeNotch();
        this.INSIDE_CORNERS = this.makeInsideCorners();
        this.OUTSIDE_CORNERS = this.makeOutsideCorners();
        // 派生常量：zelos 在 init 末尾按内凹角推导，主题应用后可能被置空，必须显式重设（探针标定值）
        this.STATEMENT_INPUT_NOTCH_OFFSET = 16;
        // 事件帽：完全平顶（高度0），左端凸出圆钮交给 drawLeft_ 绘制
        this.START_HAT_HEIGHT = 0;
        this.START_HAT = this.makeStartHat();
      }
      setDynamicProperties_(theme) {
        super.setDynamicProperties_(theme);
        this.STATEMENT_INPUT_NOTCH_OFFSET = 16;
      }
      // 铺平语句连接“卡扣”：凹凸曲线换成沿边缘的水平直线，视觉无卡扣
      makeNotch() {
        var n = super.makeNotch();
        n.pathLeft = P.lineOnAxis('h', n.width);
        n.pathRight = P.lineOnAxis('h', -n.width);
        return n;
      }
      // 内凹角用独立的小半径，不跟随外角大圆角
      makeInsideCorners() {
        var r = this.INSIDE_R;
        function a(flags, dx, dy) { return P.arc('a', '0 0,' + flags, r, P.point(dx, dy)); }
        return {
          width: r, height: r, rightWidth: r, rightHeight: r,
          pathTop: a(0, -r, r), pathBottom: a(0, r, r),
          pathTopRight: a(1, -r, r), pathBottomRight: a(1, r, r)
        };
      }
      // 外角：左侧完全直角（空路径）；右侧整端半圆
      makeOutsideCorners() {
        var r = R_CAP;
        var topRight = P.arc('a', '0 0,1', r, P.point(r, r));
        var bottomRight = P.arc('a', '0 0,1', r, P.point(-r, r));
        return { topLeft: '', topRight: topRight, bottomRight: bottomRight, bottomLeft: '', rightHeight: r, leftHeight: 0 };
      }
      // 值连接外形按 check 区分（Scratch 规范）：布尔值=六边形 <>，数字/文本/列表/无 check=圆角 ()。
      // zelos 原生 shapeFor 已实现该映射（Boolean→HEXAGONAL，Number/String/其他→ROUNDED），直接复用。
    }
    // 语句代码（无输出口）左角一律为方角；帽子曲线由 Hat 元素自行绘制
    class FastTopRow extends z.TopRow {
      hasLeftSquareCorner(b) { return b.outputConnection ? super.hasLeftSquareCorner(b) : true; }
    }
    class FastBottomRow extends z.BottomRow {
      hasLeftSquareCorner(b) { return b.outputConnection ? super.hasLeftSquareCorner(b) : true; }
    }
    /*
     * controls_if（如果/否则如果/否则）与 repeat/while 等 C 形代码完全共用
     * FastConstants：铺平的连接齿、细脊柱、小圆角臂端。
     *
     * 历史教训：不能让 controls_if “测量用原生 Zelos 常量、绘制用 Fast 常量”——
     * Drawer 的圆角/齿形路径取自 renderer 的常量，而 measurable 的齿宽/角宽取自
     * RenderInfo 的常量，两套常量混用会导致：
     *   1) 顶边/底边/口袋底仍画出原生拼图卡扣；
     *   2) 左下角路径少走圆角宽度，z 闭合时拉出一条向左倾斜的斜边；
     *   3) 原生等宽对齐让第一行的长条件把所有分支撑成等宽。
     * 现在测量与绘制统一走 FastConstants，分支宽度改由 fastIfMeasure_() 逐单元计算。
     */

    class FastRenderInfo extends z.RenderInfo {
      constructor(renderer, block) {
        super(renderer, block);
        // 所有语句代码统一使用 Fast 行类型（左角方角、右角 D 形半圆），
        // controls_if 不再例外，保证顶/底边与 C 形脊柱几何同源、不再左倾。
        this.topRow = new FastTopRow(this.constants_);
        this.bottomRow = new FastBottomRow(this.constants_);
      }
      // 右端半圆只占横向空间，纵向不把行撑高（块高维持原值，半圆与内容同心）
      shrinkRightCorners() {
        [this.topRow.elements, this.bottomRow.elements].forEach(function (els) {
          for (var i = 0; i < els.length; i++) {
            if (T.isRightRoundedCorner(els[i])) els[i].height = CORNER_KEEP_H;
          }
        });
      }
      populateTopRow_() {
        super.populateTopRow_();
        this.shrinkRightCorners();
        // 帽块：标题行压到和普通单行代码一样扁；行首留出凸出圆钮的让位间距，
        // 使所有帽块文字起点对齐、不被圆钮挡住（不再依赖标签里手工敲空格）。
        if (this.block_.hat === 'cap') {
          this.topRow.height -= 12;
        }
      }
      populateBottomRow_() { super.populateBottomRow_(); this.shrinkRightCorners(); }
      measure() {
        if (this.block_.type === 'controls_if') {
          this.fastIfMeasure_();
          return;
        }
        super.measure();
        // 帽块：measure 后、align 前把行首圆钮让位 spacer 撑到 26 并重算行宽，
        // 这样 super.align 算块宽时会把让位算进去，长标题文字不会被右端圆头截断。
        if (this.block_.hat === 'cap') this.reserveHatKnob_();
      }
      /* controls_if 阶梯布局：每个分支（如果 / 否则如果 / 否则）是一个独立“单元”，
         单元右缘只由【本单元条件行（含已接入的布尔代码）】与【本单元口袋里堆叠的
         语句代码】决定；上面分支接了长布尔块，不会再把下面分支横条/口袋撑宽。
         顶行 D 形帽、口袋细脊柱、底部细托臂与 repeat/while 完全一致。 */
      fastIfMeasure_() {
        var C = this.constants_;
        this.createRows_();
        this.addElemSpacing_();
        this.addRowSpacing_();
        // 先跑 Zelos 的条件行让位（布尔槽不与连接齿区重叠），随后逐行自然测量。
        this.adjustXPosition_();
        var rows = this.rows;
        for (var i = 0; i < rows.length; i++) rows[i].measure();

        var PAD_L = C.STATEMENT_INPUT_PADDING_LEFT;          // 细脊柱宽 8
        var NOTCH_OFF = C.NOTCH_OFFSET_LEFT;                // 语句 measurable 齿偏移 12
        var INSIDE_W = C.INSIDE_CORNERS.rightWidth || C.INSIDE_CORNERS.width; // 内圆角 8
        var MIN_EDGE = C.STATEMENT_INPUT_SPACER_MIN_WIDTH;  // 空口袋最小宽 160

        function stackWidthOf(stmtRow) {
          var inp = stmtRow.getLastInput();
          var first = inp && inp.connectedBlock;
          var w = 0;
          for (var b = first; b; b = b.getNextBlock()) {
            w = Math.max(w, b.getHeightWidth().width);
          }
          return w;
        }

        // 1) 按输入名把行归并为单元 {header: IFk/ELSEHDR 行, stmt: DOk/ELSE 行}
        var units = [];
        var rowEdge = new Map();
        var rowUnit = new Map();
        function unitAt(ix) {
          while (units.length <= ix) units.push({ header: null, stmt: null, stackW: 0, isElse: false });
          return units[ix];
        }
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          if (T.isSpacer(row) || T.isTopOrBottomRow(row)) continue;
          var conn = typeof row.getLastInput === 'function' ? row.getLastInput() : null;
          var name = conn && conn.input ? conn.input.name : null;
          var mm;
          if (row.hasStatement) {
            if (name === 'ELSE') {
              var eu = null;
              for (var e = 0; e < units.length; e++) if (units[e].isElse && !units[e].stmt) { eu = units[e]; break; }
              if (!eu) { eu = { header: null, stmt: null, stackW: 0, isElse: true }; units.push(eu); }
              eu.stmt = row;
            } else if ((mm = /^DO(\d+)$/.exec(name))) {
              unitAt(+mm[1]).stmt = row;
            }
          } else if (name === 'ELSEHDR') {
            units.push({ header: row, stmt: null, stackW: 0, isElse: true });
          } else if (name && (mm = /^IF(\d+)$/.exec(name))) {
            unitAt(+mm[1]).header = row;
          } else if (!name) {
            // dummy 输入行（无连接 measurable）即“否则”横条 ELSEHDR
            var hu = null;
            for (var e2 = 0; e2 < units.length; e2++) if (units[e2].isElse && !units[e2].header) { hu = units[e2]; break; }
            if (!hu) { hu = { header: row, stmt: null, stackW: 0, isElse: true }; units.push(hu); }
            else hu.header = row;
          }
        }
        if (!units.length) { super.measure(); return; }

        // 2) 逐单元计算两类右缘
        //  headerEdge（条件横条）：只由本单元条件行（含已接入的布尔代码）决定，最小 160；
        //    口袋里再宽的语句代码也不会撑宽条件横条（修复空条件“否则如果”被拉长）。
        //  pocketEdge（语句口袋托臂）：空口袋固定 160；一旦口袋里接了代码（含嵌套 C 块、
        //    宽语句块），托臂按 脊柱8 + 子块宽 + 内圆角16 向右加长，使托臂尖端包住子块
        //    右端 8px，消除子块悬在父轮廓外形成的“缝”；这是口袋自己的托臂，不影响条件横条。
        for (var u2 = 0; u2 < units.length; u2++) {
          var un = units[u2];
          un.stackW = un.stmt ? stackWidthOf(un.stmt) : 0;
          var headerNat = un.header ? un.header.width : 0;
          un.headerEdge = Math.max(headerNat, MIN_EDGE);
          // 重要：statement 里的子代码允许像普通 Blockly C 形代码一样
          // 向右伸出父代码轮廓。不要用子代码宽度反向撑大 pocket/else 横条。
          // 左侧单独“如果 + 设置屏幕亮度”就是正确参照：父代码宽度保持
          // 自己的最小/条件宽度，子代码可以超出父轮廓。
          // 之前这里把 stackW 加进 pocketEdge，导致不同拼法时出现长条、
          // 台阶和上下错位。
          // 口袋托臂/地板宽度必须与条件横条【解耦】：宽布尔代码（如“并且”）只
          // 撑宽它所在的那一条条件横条（headerEdge），口袋一律回到统一的紧凑主干
          // 宽度 MIN_EDGE。否则宽头会把本分支口袋地板延伸到下方更窄的“否则如果/
          // 否则”横条右侧，在口袋子代码的正下方留下悬空水平细条与白缝。
          un.pocketEdge = MIN_EDGE;
          // 单元对块总宽的贡献仍要容纳可能更宽的条件横条，避免宽布尔头被裁切。
          un.edge = Math.max(un.headerEdge, un.pocketEdge);
        }
        // 顶行（D 形半圆帽）属于第 0 单元
        units[0].headerEdge = Math.max(units[0].headerEdge, this.topRow.width);
        units[0].edge = Math.max(units[0].edge, units[0].headerEdge);
        // “否则”标签横条没有布尔条件，语义上属于上下两个口袋的分隔条：
        // 宽度与相邻口袋取齐（max 上一口袋、本口袋），避免在窄标签两侧露出凹口。
        for (var ue = 0; ue < units.length; ue++) {
          var ueUnit = units[ue];
          if (ueUnit.isElse && ueUnit.header) {
            // ELSE 标签只服从自身最小宽度/自身内容，不继承上方 statement
            // 子代码的宽度；否则宽子代码会把 ELSE 横条错误地撑长。
            ueUnit.headerEdge = Math.max(ueUnit.headerEdge, MIN_EDGE);
            ueUnit.edge = ueUnit.headerEdge;
          }
        }

        function growRow(row, target) {
          var delta = target - row.width;
          if (delta <= 0) return;
          var ls = row.getLastSpacer && row.getLastSpacer();
          if (ls) {
            ls.width += delta;
            row.width += delta;
            row.widthWithConnectedBlocks += delta;
          } else {
            row.width = target;
            row.widthWithConnectedBlocks = target;
          }
        }

        // 3) 顶行 / 条件标题行收到各自 headerEdge
        growRow(this.topRow, units[0].headerEdge);
        for (var u3 = 0; u3 < units.length; u3++) {
          var un3 = units[u3];
          if (un3.header) {
            growRow(un3.header, un3.headerEdge);
            rowEdge.set(un3.header, un3.headerEdge);
            rowUnit.set(un3.header, u3);
          }
        }

        // 4) 语句口袋行：行宽（口部/地板横线）= pocketEdge - 内圆角8
        this.statementEdge = PAD_L;
        for (var u4 = 0; u4 < units.length; u4++) {
          var un4 = units[u4];
          if (!un4.stmt) continue;
          un4.stmt.statementEdge = PAD_L;
          var sinp = un4.stmt.getLastInput();
          var targetRowW = un4.pocketEdge - INSIDE_W;     // 父代码自身口袋宽度
          // 子代码宽度不参与父轮廓宽度；它本身可以自然伸出 pocket。
          var targetElemW = Math.max(0, targetRowW - PAD_L);
          if (sinp.width < targetElemW) sinp.width = targetElemW;
          sinp.height = Math.max(sinp.height, un4.stmt.height);
          un4.stmt.width = targetRowW;
          un4.stmt.widthWithConnectedBlocks = Math.max(targetRowW, un4.stmt.widthWithConnectedBlocks || targetRowW);
          rowEdge.set(un4.stmt, un4.pocketEdge);
        }

        // 5) 底行跟随最后一个口袋的托臂外缘（宽子块下方也有完整托底）
        var lastUnit = units.length ? units[units.length - 1] : null;
        var lastEdge = lastUnit && lastUnit.stmt ? lastUnit.pocketEdge : MIN_EDGE;
        growRow(this.bottomRow, lastEdge);

        // 6) 间隔行宽度取相邻外缘的较大值（仅影响命中区域，台阶路径由绘制层逐行画）
        var topEdge0 = units[0].headerEdge;
        var edgeOf = (rw) => rw === this.topRow ? topEdge0
          : rw === this.bottomRow ? lastEdge : (rowEdge.has(rw) ? rowEdge.get(rw) : null);
        for (var r2 = 0; r2 < rows.length; r2++) {
          var sp = rows[r2];
          if (!T.isSpacer(sp)) continue;
          var ePrev = edgeOf(rows[r2 - 1]);
          var eNext = edgeOf(rows[r2 + 1]);
          sp.width = Math.max(ePrev || 0, eNext || 0, sp.width || 0);
        }

        var maxEdge = units[0].edge;
        for (var u5 = 1; u5 < units.length; u5++) maxEdge = Math.max(maxEdge, units[u5].edge);
        this.width = maxEdge;
        this.widthWithChildren = maxEdge;
        // 行→外缘映射（标题行=headerEdge，口袋行=pocketEdge），供 FastDrawer 画台阶
        this.__ifRowEdge = rowEdge;
        this.__ifRowUnit = rowUnit;
        this.__ifEdges = units.map(function (un5) { return un5.edge; });
        this.__ifPocketEdges = units.map(function (un6) { return un6.pocketEdge; });
        this.__ifTopEdge = topEdge0;
        this.__ifBottomEdge = lastEdge;
        // 落定 y/x/元素位置（zelos finalize 对语句块的 output 特判均为 no-op）
        this.finalize_();
        this.width = Math.max(this.width, maxEdge);
        this.widthWithChildren = Math.max(this.widthWithChildren, maxEdge);
      }
      // 帽块：圆钮在左端凸出（独立 SVG，不占行内布局），给第一个含文字/控件的内容行
      // 行首 spacer 补固定让位，使文字不被白圆播放钮挡住（圆钮大小保持不变）。
      reserveHatKnob_() {
        if (this.block_.hat !== 'cap') return;
        var rs = this.rows;
        for (var i = 0; i < rs.length; i++) {
          var row = rs[i];
          if (T.isTopOrBottomRow(row) || !row.elements) continue;
          var els = row.elements;
          var hasContent = false;
          for (var k = 0; k < els.length; k++) {
            if (T.isField(els[k]) || T.isIcon(els[k])) { hasContent = true; break; }
          }
          if (!hasContent) continue;
          for (var j = 0; j < els.length; j++) {
            if (T.isSpacer(els[j])) {
              var want = 36;
              if (els[j].width < want) {
                els[j].width = want;
                if (row.measure) row.measure();   // 重算行宽，块宽对齐时才能算够
              }
              return;
            }
          }
          return;
        }
      }
      // controls_if 的分支宽度由 fastIfMeasure_() 逐单元决定；
      // finalize/align 保持 Zelos 原生，避免破坏 StatementInput 的 C 形几何。
      finalize_() {
        super.finalize_();
      }
      alignRowElements_() {
        super.alignRowElements_();
      }
    }
    // 轮廓绘制：消除右半圆外的竖线毛刺、统一堆叠连接点、C 形细底臂
    class FastDrawer extends z.Drawer {
      // 上连接点 x = NOTCH_OFFSET_LEFT；下连接点默认取齿 measurable 左缘（窄齿后偏小），
      // 两者不一致会让每向下叠一块就向左错位，这里强制对齐到同一 x。
      // controls_if 与其它语句代码完全一致，不再走原生偏移（原生齿宽 36 会造成错齿/左倾）。
      positionNextConnection_() {
        super.positionNextConnection_();
        var br = this.info_.bottomRow;
        if (br.connection) {
          br.connection.connectionModel.setOffsetInBlock(this.constants_.NOTCH_OFFSET_LEFT, br.baseline);
        }
      }
      // 复刻 common.drawTop_，但去掉结尾的 v(topRow.height)：右半圆半径(24)大于圆角行
      // 预留高度(8)，那段竖线会画在圆弧之外，在每个块的右下方戳出一小段“毛刺”。
      drawTop_() {
        if (this.block_.outputConnection || this.block_.hat === 'cap') return super.drawTop_();
        var topRow = this.info_.topRow, els = topRow.elements;
        this.positionPreviousConnection_();
        var d = P.moveBy(topRow.xPos, this.info_.startY);
        for (var i = 0, e; (e = els[i]); i++) {
          if (T.isLeftRoundedCorner(e)) d += this.constants_.OUTSIDE_CORNERS.topLeft;
          else if (T.isRightRoundedCorner(e)) d += this.constants_.OUTSIDE_CORNERS.topRight;
          else if (T.isPreviousConnection(e)) d += e.shape.pathLeft;
          else if (T.isHat(e)) d += e.shape.path;
          else if (T.isSpacer(e)) d += P.lineOnAxis('h', e.width);
        }
        this.outlinePath_ += d;
      }
      drawRightSideRow_(row) {
        // controls_if right outline (ASCII comments to avoid encoding issues):
        //  - header rows (IFk/ELSEHDR) run straight down at their headerEdge;
        //  - statement rows use native Zelos drawing (mouth/floor at measured pocketEdge);
        //  - every spacer next to a statement pocket draws a rounded step between the
        //    edge above (eTop) and the edge below (eBot), in four directions:
        //      follows statement, narrow->wide: floor continues right as a shelf,
        //                                       convex corner at the wide edge;
        //      follows statement, wide->narrow: close floor at the wide edge,
        //                                       shelf left to the lower edge;
        //      precedes statement, narrow->wide: shelf right along the header bottom,
        //                                       convex corner at the wide edge;
        //      precedes statement, wide->narrow: convex corner at the upper edge,
        //                                       shelf left to the mouth edge.
        //    Boolean conditions therefore only widen their own header bar, while pocket
        //    arms grow to wrap wide / nested statement children (no dangling seam).
        if (this.block_.type === 'controls_if' && this.info_.__ifRowEdge) {
          var rowsAll = this.info_.rows;
          var ix = rowsAll.indexOf(row);
          var edgeMap = this.info_.__ifRowEdge;
          var topEdge = this.info_.__ifTopEdge;
          var bottomEdge = this.info_.__ifBottomEdge;
          var self = this;
          function edgeOf(rw) {
            if (!rw) return null;
            if (rw === self.info_.topRow) return topEdge;
            if (rw === self.info_.bottomRow) return bottomEdge;
            return edgeMap.has(rw) ? edgeMap.get(rw) : null;
          }
          if (T.isSpacer(row)) {
            var prev = ix > 0 ? rowsAll[ix - 1] : null;
            var next = ix >= 0 && ix + 1 < rowsAll.length ? rowsAll[ix + 1] : null;
            var eTop = edgeOf(prev);
            var eBot = edgeOf(next);
            if (prev && next && prev.hasStatement && eTop != null && eBot != null) {
              // spacer follows a statement pocket; native floor line ends at (eTop-8, y).
              // 这里圆角向下伸入的是下方【实体横条】，固定 r8 略微越过间隔会与横条融成平滑
              // 大圆角；切勿按间隔高度缩小半径，否则横条右上角会出现小台阶凸起。
              var d1;
              if (eBot > eTop + 0.5) {
                // narrow pocket -> wider header below: floor runs straight right
                d1 = P.lineOnAxis('H', eBot - 8)
                  + P.arc('a', '0 0,1', 8, P.point(8, 8));
              } else {
                // close floor at the (wider/equal) pocket edge, then shelf left
                d1 = P.arc('a', '0 0,1', 8, P.point(8, 8))
                  + P.lineOnAxis('H', eBot);
              }
              this.outlinePath_ += d1;
              return;
            }
            if (next && next.hasStatement && eTop != null && eBot != null) {
              // spacer precedes a statement pocket (mouth line is drawn by the row below)
              var yC = row.yPos, yD = next.yPos, dhB = Math.max(0, yD - yC);
              var rB = Math.min(8, dhB);
              var d2;
              if (eBot > eTop + 0.5) {
                // narrow header -> wider pocket: shelf right along the header bottom, corner at wide edge
                d2 = P.lineOnAxis('H', eBot - 8)
                  + (dhB > rB ? P.lineOnAxis('V', yD - rB) : '')
                  + P.arc('a', '0 0,1', rB, P.point(rB, rB));
              } else {
                // wide/equal header -> narrow/equal pocket: drop to mouth top, convex corner, shelf left
                d2 = (dhB > rB ? P.lineOnAxis('V', yD - rB) : '')
                  + P.arc('a', '0 0,1', rB, P.point(-rB, rB))
                  + P.lineOnAxis('H', eBot - 8);
              }
              this.outlinePath_ += d2;
              return;
            }
            return super.drawRightSideRow_(row);
          }
          if (!row.hasStatement && edgeMap.has(row)) {
            // header row: vertical only; all horizontal steps live on adjacent spacers
            this.outlinePath_ += P.lineOnAxis('V', row.yPos + row.height);
            return;
          }
          return super.drawRightSideRow_(row);
        }
        if (this.block_.outputConnection || this.block_.statementInputCount || T.isSpacer(row)) {
          return super.drawRightSideRow_(row);
        }
      }
      // 每次渲染后，给事件帽块左端叠加独立圆钮（与"当开始被点击"一致：
      // 同色外圆 + 白色小圆 + 同色播放三角）。用独立 SVG 元素避开主 path 的 evenodd 填充。
      draw() {
        this.__lastEdge = null;   // 阶梯台阶游标每次重绘重置
        super.draw();
        var b = this.block_;
        var g = b.getSvgRoot ? b.getSvgRoot() : b.svgRoot_;
        // 直接子节点查找，避免穿透到嵌套子块 g
        function directChild(gEl, cls) {
          for (var k = 0; k < gEl.childNodes.length; k++) {
            var cn = gEl.childNodes[k];
            if (cn.nodeType === 1 && cn.getAttribute && cn.getAttribute('class') === cls) return cn;
          }
          return null;
        }
        if (b.hat === 'cap' && !b.outputConnection && g) {
          var SVGNS = 'http://www.w3.org/2000/svg';
          var knob = directChild(g, 'hat-knob');
          var R = 30;                       // 圆钮半径保持原大小不变
          var cx = -6;                      // 圆心横向位置保持原值
          // 圆比方框高：圆心上移到标题横条中心偏上，圆顶凸出块顶、圆底凸出横条底，
          // 不再与矩形等高（矩形体已由 topRow.height-=12 砍矮）。
          var cy = 24;
          if (!knob) {
            knob = document.createElementNS(SVGNS, 'g');
            knob.setAttribute('class', 'hat-knob');
            var outer = document.createElementNS(SVGNS, 'circle');
            outer.setAttribute('class', 'hat-knob-outer');
            var ring = document.createElementNS(SVGNS, 'circle');
            ring.setAttribute('class', 'hat-knob-ring');
            var tri = document.createElementNS(SVGNS, 'polygon');
            tri.setAttribute('class', 'hat-knob-tri');
            knob.appendChild(outer);
            knob.appendChild(ring);
            knob.appendChild(tri);
            // 插到主填充路径之后、文字层之前
            var mainPath = directChild(g, 'blocklyPath');
            if (mainPath && mainPath.nextSibling) g.insertBefore(knob, mainPath.nextSibling);
            else g.appendChild(knob);
          }
          var color = b.getColour();
          var o = knob.querySelector('.hat-knob-outer');
          o.setAttribute('cx', cx); o.setAttribute('cy', cy); o.setAttribute('r', R);
          o.setAttribute('fill', color); o.removeAttribute('stroke');
          var ring = knob.querySelector('.hat-knob-ring');
          ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', R * 0.62);
          ring.setAttribute('fill', '#ffffff'); ring.removeAttribute('stroke');
          // 同色播放三角，居中于圆心，指向右（视觉重心略偏右补偿三角视差）
          var t = knob.querySelector('.hat-knob-tri');
          var xL = -R * 0.16, xR = R * 0.20, yH = R * 0.28;
          t.setAttribute('points', (cx + xL) + ',' + (cy - yH) + ' ' + (cx + xL) + ',' + (cy + yH) + ' ' + (cx + xR) + ',' + cy);
          t.setAttribute('fill', color);
        }
      }
      drawLeft_() {
        super.drawLeft_();
      }
      // C 形代码底臂与侧边脊柱等厚（8），臂端小圆角。
      // controls_if 使用同一套细托臂路径（最后一个单元的外缘），不再走原生粗底。
      drawBottom_() {
        var info = this.info_, b = this.block_;
        if (!b.statementInputCount) return super.drawBottom_();
        var baseline = info.bottomRow.baseline;
        var rArm = 4;   // 端圆角半径 ≈ 底臂厚度的一半
        this.positionNextConnection_();
        var tail = '';
        var els = info.bottomRow.elements;
        for (var j = els.length - 1, el; (el = els[j]); j--) {
          if (T.isNextConnection(el)) tail += el.shape.pathRight;
          else if (T.isLeftSquareCorner(el)) tail += P.lineOnAxis('H', info.bottomRow.xPos);
          else if (T.isLeftRoundedCorner(el)) tail += this.constants_.OUTSIDE_CORNERS.bottomLeft;
          else if (T.isRightRoundedCorner(el)) tail += P.arc('a', '0 0,1', rArm, P.point(-rArm, rArm));
          else if (T.isSpacer(el)) tail += P.lineOnAxis('h', -el.width);
        }
        this.outlinePath_ += P.lineOnAxis('V', baseline - rArm) + tail;
      }
    }
    class FastRenderer extends z.Renderer {
      makeConstants_() { return new FastConstants(); }
      makeRenderInfo_(block) { return new FastRenderInfo(this, block); }
      makeDrawer_(block, info) { return new FastDrawer(block, info); }
    }
    Blockly.blockRendering.register('fastzelos', FastRenderer);
    FAST_RENDERER_REGISTERED = true;
  }

  /* 稳定的双指缩放：内置 pinch 在真机上会与单指拖块/平移手势竞争，两指状态切换时画面在
     缩放与平移间来回跳（“闪来闪去”）。这里在 document 捕获阶段统一接管多指：第二指落下即
     取消 Blockly 当前手势，随后的多指移动全部由我们以双指中点为锚缩放，并屏蔽 Blockly 的移动；
     单指完全不干预（拖块、平移画布照旧）。 */
  function setupCustomPinch(ws) {
    if (ws.__pinchBound) return; ws.__pinchBound = true;
    var host = $('blocklyDiv');
    var pts = new Map();
    var pinch = null;
    function inControl(n) {
      return n && n.closest && (n.closest('#bbZoom') || n.closest('#bbCats') ||
        n.closest('.blocklyFlyout') || n.closest('.blocklyToolboxDiv') || n.closest('.mask'));
    }
    function pos(e) { var r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function midp(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    function onDown(e) {
      if (state.view !== 'blocks' || inControl(e.target)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts.set(e.pointerId, pos(e));
      if (pts.size === 2 && !pinch) {
        try { ws.cancelCurrentGesture(); } catch (err) {}   // 终止第一指可能正在进行的拖块/平移
        var v = Array.from(pts.values());
        pinch = { d: dist(v[0], v[1]), m: midp(v[0], v[1]) };
        try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) {}
      }
    }
    function onMove(e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, pos(e));
      if (pinch && pts.size >= 2) {
        e.preventDefault(); e.stopImmediatePropagation();   // 屏蔽 Blockly 的平移/拖块，避免打架
        var v = Array.from(pts.values());
        var nd = dist(v[0], v[1]), nm = midp(v[0], v[1]);
        if (pinch.d > 1) {
          var ratio = nd / pinch.d;
          var speed = (ws.options.zoomOptions && ws.options.zoomOptions.scaleSpeed) || 1.03;
          var amount = Math.log(ratio) / Math.log(speed);
          if (isFinite(amount) && Math.abs(amount) > 1e-6) {
            try { ws.zoom(nm.x, nm.y, amount); } catch (err) {}
          }
        }
        pinch.d = nd; pinch.m = nm;
      }
    }
    function onUp(e) {
      if (!pts.has(e.pointerId)) return;
      var wasPinch = !!pinch;
      pts.delete(e.pointerId);
      if (pinch && pts.size < 2) {
        pinch = null;
        if (wasPinch) { try { recordZoom(); } catch (err) {} }
      }
    }
    document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    document.addEventListener('pointermove', onMove, { capture: true, passive: false });
    document.addEventListener('pointerup', onUp, { capture: true, passive: true });
    document.addEventListener('pointercancel', onUp, { capture: true, passive: true });
  }

  /* ---------------- 长按：代码/空白 上下文小菜单（复制·粘贴·删除·撤销） ---------------- */
  var blockClipboard = null;   // 代码剪贴板（XML 文本）
  function bindBlockLongPress(ws) {
    if (ws.__longPressBound) return; ws.__longPressBound = true;
    var host = $('blocklyDiv');
    var lpTimer = null, lpCtx = null, lpX = 0, lpY = 0;
    var LONG_MS = 460, MOVE_TOL = 14;
    var pasteX = 0, pasteY = 0;

    function blockFromNode(node) {
      var g = node && node.closest ? node.closest('.blocklyDraggable') : null;
      if (!g || g.closest('.blocklyFlyout') || g.closest('.blocklyToolboxDiv')) return null;
      var all = ws.getAllBlocks(false);
      for (var i = 0; i < all.length; i++) { try { if (all[i].getSvgRoot() === g) return all[i]; } catch (e) {} }
      return null;
    }
    function isEmptyBg(node) {
      if (!node || !node.closest) return false;
      if (node.closest('.blocklyDraggable,.blocklyFlyout,.blocklyToolboxDiv,.blocklyZoom,.blocklyTrash,.blocklyBubbleCanvas,.blocklyWidgetDiv,.blocklyTooltipDiv,.blocklyDropDownDiv')) return false;
      return !!node.closest('#blocklyDiv svg, .blocklyMainBackground, .blocklyBlockCanvas, .blocklyWorkspace');
    }
    // 数量：含自身 + 往下整条链 + 半包围内部递归的全部代码；
    // 不计 shadow 值块（如“重复 10 次”里内置的数字 10），否则半包围会多算 1 个
    function realBlocks(list) { return list.filter(function (x) { return !x.isShadow(); }); }
    function countBlocks(b) { try { return realBlocks(b.getDescendants(false)).length; } catch (e) { return 1; } }
    function totalBlocks() { return realBlocks(ws.getAllBlocks(false)).length; }
    function clearTimer() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }

    /* 手指旁的小浮层菜单 */
    var mask, menu;
    function buildUI() {
      if (menu) return;
      mask = el('div', 'hidden');
      mask.style.cssText = 'position:fixed;inset:0;z-index:960;background:transparent';
      menu = el('div', 'popover hidden');
      menu.style.zIndex = 961;
      document.body.appendChild(mask); document.body.appendChild(menu);
      // 点遮罩空白处关闭；contextmenu（安卓长按会触发）只拦截，绝不能用来关闭，否则菜单一闪即退
      mask.addEventListener('pointerdown', function (e) { e.preventDefault(); closeMenu(); });
      mask.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    }
    function closeMenu() { if (mask) mask.classList.add('hidden'); if (menu) menu.classList.add('hidden'); lpCtx = null; }
    function beginPosition(x, y) {
      menu.innerHTML = '';
      menu.style.visibility = 'hidden';
      mask.classList.remove('hidden'); menu.classList.remove('hidden');
      return function place() {
        var mw = menu.offsetWidth || 200, mh = menu.offsetHeight || 160;
        var left = x + 12, top = y + 12;
        if (left + mw > window.innerWidth - 8) left = x - mw - 12;
        if (top + mh > window.innerHeight - 8) top = y - mh - 12;
        menu.style.left = Math.max(8, Math.round(left)) + 'px';
        menu.style.top = Math.max(8, Math.round(top)) + 'px';
        menu.style.visibility = '';
      };
    }
    function addItem(text, cb, opt) {
      var b = el('button', 'menu-item' + (opt && opt.danger ? ' danger' : ''), text);
      b.type = 'button';
      if (opt && opt.disabled) { b.disabled = true; b.style.opacity = '.38'; b.style.pointerEvents = 'none'; }
      else b.addEventListener('click', function (ev) {
        armGhostGuard(ev.clientX, ev.clientY);   // 防菜单项点击穿透到下层代码/按钮
        closeMenu(); cb();
      });
      menu.appendChild(b);
    }
    function canUndo() { return (ws.undoStack_ || []).length > 0; }
    function canRedo() { return (ws.redoStack_ || []).length > 0; }

    function openBlockMenu(b, x, y) {
      var place = beginPosition(x, y);
      var n = countBlocks(b);
      addItem('复制以下代码（' + n + ' 个）', function () { copyBlock(b, false); });
      addItem('复制此单个代码', function () { copyBlock(b, true); });
      addItem('删除以下代码（' + n + ' 个）', function () { delBlock(b, false); }, { danger: true });
      addItem('删除此单个代码', function () { delBlock(b, true); }, { danger: true });
      place();
    }
    function openEmptyMenu(x, y) {
      pasteX = x; pasteY = y;
      var place = beginPosition(x, y);
      var n = totalBlocks();
      addItem('粘贴代码', doPaste, { disabled: !blockClipboard });
      addItem('复制全部代码（' + n + ' 个）', copyAll, { disabled: n === 0 });
      addItem('删除全部代码（' + n + ' 个）', delAll, { danger: true, disabled: n === 0 });
      addItem('撤销上一步', function () { try { ws.undo(false); autosave(); } catch (e) {} }, { disabled: !canUndo() });
      addItem('还原上一步', function () { try { ws.undo(true); autosave(); } catch (e) {} }, { disabled: !canRedo() });
      place();
    }

    /* 剪贴板 */
    function stripInner(dom) {
      ['next', 'statement'].forEach(function (tag) {
        var nodes = dom.getElementsByTagName(tag);
        for (var k = nodes.length - 1; k >= 0; k--) nodes[k].parentNode.removeChild(nodes[k]);
      });
    }
    function copyBlock(b, single) {
      try { ws.hideChaff(); } catch (e) {}
      var dom = B.Xml.blockToDom(b);
      if (single) stripInner(dom);
      blockClipboard = B.Xml.domToText(dom);
      snack(single ? '已复制此代码' : ('已复制 ' + countBlocks(b) + ' 个代码'));
    }
    function copyAll() {
      var xml = B.utils.xml.createElement('xml');
      ws.getTopBlocks(false).forEach(function (b) { xml.appendChild(B.Xml.blockToDom(b)); });
      blockClipboard = B.Xml.domToText(xml);
      snack('已复制全部 ' + totalBlocks() + ' 个代码');
    }
    function wsCoordFromClient(x, y) {
      try { return B.utils.svgMath.screenToWsCoordinates(ws, new B.utils.Coordinate(x, y)); }
      catch (e) { return new B.utils.Coordinate(x, y); }
    }
    // 粘贴前清除所有块 id，避免与原块 id 冲突导致 domToBlock 失败（Blockly 会自动重新分配）
    function stripIds(dom) {
      function clear(node) { if (node && node.tagName && /^(block|shadow)$/.test(node.tagName.toLowerCase())) node.removeAttribute('id'); }
      clear(dom);
      ['block', 'shadow'].forEach(function (tag) {
        var nodes = dom.getElementsByTagName ? dom.getElementsByTagName(tag) : [];
        for (var i = 0; i < nodes.length; i++) clear(nodes[i]);
      });
    }
    function doPaste() {
      if (!blockClipboard) return;
      try { ws.hideChaff(); } catch (e) {}
      var dom;
      try { dom = B.utils.xml.textToDom(blockClipboard); } catch (e) { snack('粘贴失败'); return; }
      migrateEventHatXml(dom);
      stripIds(dom);
      var dest = wsCoordFromClient(pasteX, pasteY);
      var pasted = [];
      // 把“创建代码 + 移动到手指位置”打包成一个撤销组，撤销一次即可整体移除粘贴的代码
      var pasteGroup = 'paste_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      B.Events.setGroup(pasteGroup);
      try {
        try {
          if (dom.tagName && dom.tagName.toLowerCase() === 'xml') {
            pasted = B.Xml.domToWorkspace(dom, ws) || [];
          } else {
            var one = B.Xml.domToBlock(dom, ws); pasted = one ? [one] : [];
          }
        } catch (e) { snack('粘贴失败'); return; }
        if (pasted.length) {
          var first = pasted[0];
          var p0 = first.getRelativeToSurfaceXY ? first.getRelativeToSurfaceXY() : { x: 0, y: 0 };
          var dx = dest.x - p0.x, dy = dest.y - p0.y;
          pasted.forEach(function (b) { try { b.moveBy(dx, dy); } catch (e) {} });
          try { first.select(); } catch (e) {}
        }
      } finally {
        B.Events.setGroup(false);
      }
      autosave(); snack('已粘贴');
    }
    function delBlock(b, single) {
      var n = single ? 1 : countBlocks(b);
      try { ws.hideChaff(); } catch (e) {}
      // 关键：删除（含愈合堆栈产生的 disconnect/connect move）必须打成同一个撤销组，
      // 否则撤销时只回退 delete 事件、被删代码会以孤立顶层块还原并和下方代码叠在一起。
      var group = 'del_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      B.Events.setGroup(group);
      try {
        try { b.dispose(!!single); } catch (e) { try { b.dispose(false); } catch (e2) {} }
      } finally {
        B.Events.setGroup(false);
      }
      autosave(); snack(single ? '已删除此代码' : '已删除 ' + n + ' 个代码');
    }
    function delAll() {
      confirmDialog({ title: '删除全部代码', msg: '确定清空当前页面的全部代码吗？此操作可在空白菜单中撤销。', okText: '删除' })
        .then(function (yes) { if (yes) { ws.clear(); autosave(); snack('已清空全部代码'); } });
    }

    /* 长按手势 */
    host.addEventListener('pointerdown', function (e) {
      if (state.view !== 'blocks') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 双指缩放：第二指落下（非主指针）时立即取消长按计时；菜单已弹出则关闭，
      // 否则捏合过程超过长按阈值会误弹菜单
      if (!e.isPrimary) { clearTimer(); lpCtx = null; if (mask && !mask.classList.contains('hidden')) closeMenu(); return; }
      // 点在块的功能图标（如“如果”的齿轮）上，不触发长按菜单
      if (e.target && e.target.closest && e.target.closest('.blocklyIconGroup, .blockly-icon-mutator')) { lpCtx = null; return; }
      buildUI();
      var b = blockFromNode(e.target);
      if (b && !b.isInFlyout && !b.isShadow()) lpCtx = { kind: 'block', b: b };
      else if (isEmptyBg(e.target)) lpCtx = { kind: 'empty' };
      else { lpCtx = null; return; }
      lpX = e.clientX; lpY = e.clientY;
      clearTimer();
      lpTimer = setTimeout(function () {
        if (!lpCtx) return;
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
        try { ws.cancelCurrentGesture && ws.cancelCurrentGesture(); } catch (e) {}
        if (lpCtx.kind === 'block') openBlockMenu(lpCtx.b, lpX, lpY);
        else openEmptyMenu(lpX, lpY);
      }, LONG_MS);
    }, true);
    host.addEventListener('pointermove', function (e) {
      if (lpTimer && lpCtx && (Math.abs(e.clientX - lpX) > MOVE_TOL || Math.abs(e.clientY - lpY) > MOVE_TOL)) {
        clearTimer(); lpCtx = null;
      }
    }, true);
    function onEnd() { clearTimer(); }
    host.addEventListener('pointerup', onEnd, true);
    host.addEventListener('pointercancel', onEnd, true);
    // 第二指可能落在 host 之外（分类栏/缩放按钮上），document 捕获阶段兜底取消长按
    document.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary) { clearTimer(); lpCtx = null; if (mask && !mask.classList.contains('hidden')) closeMenu(); }
    }, true);
    host.addEventListener('pointermove', function (e) {
      if (e.isPrimary === false) { clearTimer(); lpCtx = null; }
    }, true);
    // 阻止安卓长按弹出系统上下文菜单（也避免它干扰自定义长按菜单）
    host.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
  }

  /* ---------------- 旧工程迁移：事件帽块去掉半包围后，DO 语句槽转为下方 next 链 ----------------
     旧版“当…时”事件块是帽子 + C 形语句槽（DO）；新版改为帽子 + 下方凸头堆叠。
     加载/粘贴旧 XML 时把 <statement name="DO"> 内的代码链改挂到 <next>，保证代码不丢失。 */
  function migrateEventHatXml(dom) {
    if (!dom || !dom.getElementsByTagName) return dom;
    function tag(n) { return n && n.nodeType === 1 ? n.tagName.toLowerCase() : ''; }
    function firstChildTag(node, t) {
      for (var c = node.firstChild; c; c = c.nextSibling) { if (tag(c) === t) return c; }
      return null;
    }
    function nextTail(blockEl) {
      var nx = firstChildTag(blockEl, 'next');
      if (!nx) return null;
      var tail = nx.firstChild; while (tail && tag(tail) !== 'block') tail = tail.nextSibling;
      while (tail) {
        var n2 = firstChildTag(tail, 'next');
        var nb = n2 && n2.firstChild; while (nb && tag(nb) !== 'block') nb = nb.nextSibling;
        if (!nb) return tail;
        tail = nb;
      }
      return null;
    }
    var blocks = dom.getElementsByTagName('block');
    for (var i = 0; i < blocks.length; i++) {
      var blk = blocks[i];
      var type = blk.getAttribute('type') || '';
      if (!(window.isEventHatType && window.isEventHatType(type))) continue;
      var stmt = null;
      for (var c = blk.firstChild; c; c = c.nextSibling) {
        if (tag(c) === 'statement' && c.getAttribute('name') === 'DO') { stmt = c; break; }
      }
      if (!stmt) continue;
      var inner = stmt.firstChild; while (inner && tag(inner) !== 'block') inner = inner.nextSibling;
      blk.removeChild(stmt);
      if (!inner) continue;
      var tail = nextTail(blk);
      if (tail) {
        var nx2 = blk.ownerDocument.createElementNS(blk.namespaceURI, 'next');
        nx2.appendChild(inner);
        tail.appendChild(nx2);
      } else {
        var nx = blk.ownerDocument.createElementNS(blk.namespaceURI, 'next');
        nx.appendChild(inner);
        blk.appendChild(nx);
      }
    }
    return dom;
  }
  window.migrateEventHatXml = migrateEventHatXml;

  /* ---------------- 浮层（flyout）宽度守卫：真机字体/缩放时序下代码可能被右缘裁切 ----------------
     Blockly 按首次测量的代码宽度 + 固定边距计算浮层宽度，并在工作区 setScale 后不重算；
     安卓 WebView 字体渲染时序、双指放大后都会出现“代码比浮层宽、右端被盖住”。
     这里在每次浮层 reflow 后用真实 DOM 边界复核：左/右越界就整体右移代码并加宽浮层。 */
  function patchFlyoutGuard(ws) {
    var fl = ws.getFlyout && ws.getFlyout();
    if (!fl || fl.__guarded) return fl && fl.__compensate;
    fl.__guarded = true;
    function compensate() {
      var 结果 = { dx: 0, dw: 0 };
      if (fl.__compensating) return 结果;
      fl.__compensating = true;
      try {
        if (!fl.isVisible || !fl.isVisible()) return 结果;
        var fws = fl.getWorkspace();
        var scale = fws.scale;
        if (!scale) return 结果;
        var svg = fl.svgGroup_;
        if (!svg) return 结果;
        var fr = svg.getBoundingClientRect();
        if (!fr.width) return 结果;
        var blocks = fws.getTopBlocks(false);
        var maxL = 0, maxR = 0;
        blocks.forEach(function (b) {
          if (b.isInsertionMarker && b.isInsertionMarker()) return;
          var root = b.getSvgRoot && b.getSvgRoot();
          if (!root) return;
          var r = root.getBoundingClientRect();
          if (!r.width) return;
          if (r.left < fr.left) maxL = Math.max(maxL, fr.left - r.left);
          if (r.right > fr.right) maxR = Math.max(maxR, r.right - fr.right);
        });
        var padCss = 10;
        var dx = maxL > padCss ? Math.ceil((maxL + padCss) / scale) : 0;
        if (dx) {
          blocks.forEach(function (b) {
            b.moveBy(dx, 0);
            try { var rc = fl.rectMap_ && fl.rectMap_.get ? fl.rectMap_.get(b) : null; if (rc) fl.moveRectToBlock_(rc, b); } catch (e) {}
          });
          (fl.buttons_ || []).forEach(function (btn) { try { if (btn.moveBy) btn.moveBy(dx, 0); } catch (e) {} });
          maxR += dx * scale;
          结果.dx = dx;
        }
        var dw = maxR > padCss ? Math.ceil((maxR + padCss) / scale) : 0;
        if (dw) { fl.width_ += dw * scale; fl.position(); 结果.dw = dw; }
      } catch (e) {} finally { fl.__compensating = false; }
      return 结果;
    }
    fl.__compensate = compensate;
    var orig = fl.reflowInternal_.bind(fl);
    fl.reflowInternal_ = function () {
      orig();
      /* 关键：补偿要在"这一帧画出来之前"就做完。
         否则用户看到的是：浮层先出现 → 下一帧整体挪一下/变宽 = "闪一下"
         （用户反馈：重新进入作品后第一次点分类、第二次点分类都会闪）。 */
      for (var i = 0; i < 4; i++) {
        var r = compensate();
        if (!r || (!r.dx && !r.dw)) break;
      }
      // 字体/尺寸晚到的兜底（这时通常已经没有要补的了）
      requestAnimationFrame(function () { compensate(); });
      setTimeout(function () { compensate(); }, 80);
      setTimeout(function () { compensate(); }, 320);
    };
    // 字体异步加载完成后再复核一次
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(compensate, 120); }).catch(function () {}); } catch (e) {}
    return compensate;
  }
  function reflowFlyoutSoon() {
    try {
      if (!state.wsInited || !state.ws) return;
      var fl = state.ws.getFlyout && state.ws.getFlyout();
      if (fl && fl.isVisible && fl.isVisible()) { fl.reflow(); if (fl.__compensate) requestAnimationFrame(fl.__compensate); }
    } catch (e) {}
  }

  /* ---------------- 代码齿轮统一改为 +/− 小框：controls_if 分支、text_join 文本项、lists_create_with 列表项 ---------------- */
  function bindIfBranchEditor(ws) {
    if (ws.__ifMutBound) return; ws.__ifMutBound = true;
    var host = $('blocklyDiv');
    var mask, menu, curBlock = null, curKind = null;
    // 各代码齿轮的小框配置：count 取当前数量，apply 设置数量，min 下限，title 文案
    var GEAR_KINDS = {
      controls_if: {
        title: '分支设置', min: 0,
        count: function (b) { return (b.elseifCount_ || 0) + (b.elseCount_ ? 1 : 0); },
        apply: function (b, n) { applyBranch(b, n); }
      },
      text_join: {
        title: '文本项目数', min: 1,
        count: function (b) { return b.itemCount_ || 0; },
        apply: function (b, n) { applyItemCount(b, n); }
      },
      lists_create_with: {
        title: '列表项目数', min: 0,
        count: function (b) { return b.itemCount_ || 0; },
        apply: function (b, n) { applyItemCount(b, n); }
      },
      val_group: {
        title: '组合项目数', min: 2,
        count: function (b) { return b.itemCount_ || 2; },
        apply: function (b, n) { applyItemCount(b, n); }
      }
    };

    function blockOfIcon(icon) {
      var g = icon.closest('.blocklyDraggable');
      if (!g) return null;
      var all = ws.getAllBlocks(false);
      for (var i = 0; i < all.length; i++) { try { if (all[i].getSvgRoot() === g) return all[i]; } catch (e) {} }
      return null;
    }

    // 当前“扩展数” n：0=纯如果；1=如果+否则；每多 1 就在“否则”前插入一个“否则如果”
    function branchCount(block) {
      return (block.elseifCount_ || 0) + (block.elseCount_ ? 1 : 0);
    }
    function applyBranch(block, n) {
      n = Math.max(0, n | 0);
      // 这个版本 controls_if 用 JSON extraState（{elseIfCount,hasElse}）记录 mutation
      var oldState = block.saveExtraState ? block.saveExtraState() : null;
      if (!oldState) oldState = { elseIfCount: block.elseifCount_ || 0, hasElse: !!block.elseCount_ };
      // 规则：加 1 个 => 如果 + 否则；加 2 个 => 如果 + 否则如果 + 否则；依次类推
      var newState = { elseIfCount: Math.max(0, n - 1), hasElse: n >= 1 };
      var oldVal = JSON.stringify(oldState);
      var newVal = JSON.stringify(newState);
      if (oldVal === newVal) return;   // 状态没变化就不动（避免打开菜单凭空多出“否则”）
      // 同一组：mutation 事件 + 重建输入产生的子事件打包，撤销/重做一次完成
      var group = 'ifmut_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      B.Events.setGroup(group);
      try {
        B.Events.fire(new B.Events.BlockChange(block, 'mutation', null, oldVal, newVal));
        // 先保存各分支已连接的代码，再改数量、重建输入，最后重连——
        // 不能直接 loadExtraState/updateShape_，那会把未删除分支里的代码也顶出
        block.elseifCount_ = newState.elseIfCount;
        block.elseCount_ = newState.hasElse ? 1 : 0;
        if (typeof block.rebuildShape_ === 'function') block.rebuildShape_();
        else block.updateShape_();
        block.render();
      } finally {
        B.Events.setGroup(false);
      }
      try { autosave(); } catch (e) {}
    }
    // text_join / lists_create_with：extraState 为 {itemCount}，loadExtraState 内部 updateShape_
    function applyItemCount(block, n) {
      var oldState = block.saveExtraState ? block.saveExtraState() : null;
      if (!oldState) oldState = { itemCount: block.itemCount_ || 0 };
      var newState = { itemCount: Math.max(0, n | 0) };
      if ((oldState.itemCount | 0) === newState.itemCount) return;
      var group = 'gearmut_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      B.Events.setGroup(group);
      try {
        B.Events.fire(new B.Events.BlockChange(block, 'mutation', null, JSON.stringify(oldState), JSON.stringify(newState)));
        block.loadExtraState(newState);
        block.render();
      } finally {
        B.Events.setGroup(false);
      }
      try { autosave(); } catch (e) {}
    }

    function buildUI() {
      if (menu) return;
      mask = el('div', 'hidden');
      mask.style.cssText = 'position:fixed;inset:0;z-index:960;background:transparent';
      menu = el('div', 'popover hidden');
      menu.id = 'ifMutMenu';
      menu.style.zIndex = 961;
      menu.innerHTML =
        '<div class="ifMut-title" id="ifMutTitle">分支设置</div>' +
        '<div class="ifMut-row">' +
        '<button type="button" class="ifMut-btn" id="ifMutMinus">−</button>' +
        '<div class="ifMut-num" id="ifMutNum">0</div>' +
        '<button type="button" class="ifMut-btn" id="ifMutPlus">＋</button>' +
        '</div>';
      document.body.appendChild(mask); document.body.appendChild(menu);
      mask.addEventListener('pointerdown', function (e) { e.preventDefault(); closeMenu(); });
      mask.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
      menu.querySelector('#ifMutPlus').addEventListener('click', function () {
        if (!curBlock || !curKind) return;
        var kd = GEAR_KINDS[curKind];
        kd.apply(curBlock, kd.count(curBlock) + 1);
        refresh();
      });
      menu.querySelector('#ifMutMinus').addEventListener('click', function () {
        if (!curBlock || !curKind) return;
        var kd = GEAR_KINDS[curKind];
        var n = kd.count(curBlock);
        if (n > kd.min) kd.apply(curBlock, n - 1);
        refresh();
      });
    }
    function refresh() {
      if (!curBlock || !curKind) return;
      var kd = GEAR_KINDS[curKind];
      var n = kd.count(curBlock);
      menu.querySelector('#ifMutNum').textContent = String(n);
      // 已到下限时 − 置灰
      menu.querySelector('#ifMutMinus').disabled = n <= kd.min;
    }
    function closeMenu() { if (mask) mask.classList.add('hidden'); if (menu) menu.classList.add('hidden'); curBlock = null; curKind = null; }
    function openMenu(block, kind, anchor) {
      buildUI();
      curBlock = block; curKind = kind;
      var kd = GEAR_KINDS[kind];
      menu.querySelector('#ifMutTitle').textContent = kd.title;
      menu.style.visibility = 'hidden';
      mask.classList.remove('hidden'); menu.classList.remove('hidden');
      var r = anchor.getBoundingClientRect();
      var mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 150;
      var left = r.left, top = r.bottom + 6;
      if (left + mw > window.innerWidth - 8) left = r.right - mw;
      if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
      menu.style.left = Math.max(8, Math.round(left)) + 'px';
      menu.style.top = Math.max(8, Math.round(top)) + 'px';
      menu.style.visibility = '';
      // 仅打开小框查看，不改动代码；只有用户点 ＋/− 才改变分支
      refresh();
    }

    // 拦截齿轮图标：阻止默认 mutator，改弹 +/− 小框。
    // 关键体验：按住齿轮【拖动代码】时不得弹窗，也不能阻断 Blockly 原生拖动手势；
    // 只有按住后基本不移动的【轻点】，在抬手时才弹出 +/− 小框。
    var GEAR_TAP_SLOP = 10;   // 自算的轻点/拖动兜底阈值(px)；最终以 Blockly 手势判定为准
    var gearPress = null;     // {x,y,block,kind,icon,moved}
    function gearTargetFromEvent(e) {
      var el = e.target && e.target.closest ? e.target.closest('.blockly-icon-mutator') : null;
      if (!el) return null;
      var block = blockOfIcon(el);
      if (!block || !GEAR_KINDS[block.type]) return null;
      // el 是齿轮 DOM（仅用于菜单定位），block.mutator 才是 Blockly 齿轮图标实例
      return { el: el, block: block, mi: block.mutator };
    }
    // 这些代码的齿轮已统一改为 +/− 小框：永久屏蔽 Blockly 原生 mutator 气泡，
    // 使 Blockly 手势可以正常走完（含拖动结束与手势清理），又不会冒出原生小窗。
    function suppressNativeMutator(mi) {
      if (!mi || mi.__nativeGearSuppressed) return;
      mi.__nativeGearSuppressed = true;
      var orig = mi.setBubbleVisible ? mi.setBubbleVisible.bind(mi) : null;
      mi.setBubbleVisible = function (v) {
        if (v) return;             // 打开原生气泡的请求：忽略
        return orig ? orig(false) : undefined;  // 关闭请求（切换/销毁时）照常
      };
    }
    function onGearDown(e) {
      var g = gearTargetFromEvent(e);
      if (!g) return;
      // pointerdown 之后浏览器还会补发兼容的 mousedown：只在首个事件建立一次按压
      if (e.type === 'mousedown' && gearPress) return;
      gearPress = { x: e.clientX, y: e.clientY, block: g.block, kind: g.block.type, el: g.el, moved: false };
      suppressNativeMutator(g.mi);
      // 这里刻意【不】preventDefault/stopPropagation：放行给 Blockly，
      // 轻点时由 onGearUp 接管弹窗，移动时 Blockly 能正常拖动整块代码。
    }
    function onGearMove(e) {
      if (!gearPress) return;
      var dx = e.clientX - gearPress.x, dy = e.clientY - gearPress.y;
      if (dx * dx + dy * dy > GEAR_TAP_SLOP * GEAR_TAP_SLOP) gearPress.moved = true;
    }
    function onGearUp(e) {
      var p = gearPress;
      if (!p) return;
      // pointerup 与兼容 mouseup 只处理一次
      if (e.type === 'mouseup' && p.handledByPointer) return;
      if (e.type === 'pointerup') p.handledByPointer = true;
      gearPress = null;
      // 以 Blockly 手势自身的“已越过拖动半径”为准，自算位移仅作兜底：
      // 只要本次是拖动就不弹窗（Blockly 自行 endDrag）；纯轻点才打开 +/− 小框。
      var dragged = p.moved;
      try {
        var ges = ws.getGesture ? ws.getGesture(e) : null;
        if (ges && ges.hasExceededDragRadius) dragged = true;
      } catch (err) {}
      if (dragged) return;
      e.preventDefault();
      openMenu(p.block, p.kind, p.el);
    }
    function onGearCancel() { gearPress = null; }
    host.addEventListener('pointerdown', onGearDown, true);
    host.addEventListener('mousedown', onGearDown, true);
    document.addEventListener('pointermove', onGearMove, { capture: true, passive: true });
    document.addEventListener('pointerup', onGearUp, true);
    document.addEventListener('mouseup', onGearUp, true);
    document.addEventListener('pointercancel', onGearCancel, true);
    // 兜底吞掉齿轮上的 click：轻点已在 pointerup 弹自定义框；拖动后浏览器若补发 click，
    // 也不能让它触发任何原生 mutator 行为。
    host.addEventListener('click', function (e) {
      var icon = e.target && e.target.closest ? e.target.closest('.blockly-icon-mutator') : null;
      if (icon) {
        var b2 = blockOfIcon(icon);
        if (b2 && GEAR_KINDS[b2.type]) { e.preventDefault(); e.stopPropagation(); }
      }
    }, true);
    host.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
  }

  /* ---------------- Blockly（加固：尺寸观测 + 多重 resize 兜底，杜绝空白） ---------------- */
  /* ---------------- 变量自动回收 ----------------
     Blockly 的函数参数也是"变量"。删掉函数定义后，这些变量仍留在 variableMap 里，
     于是「变量」分类里会一直挂着一堆没人用的圆块（用户反馈的 bug）。
     规则：凡是"没有任何变量块在用、也不是某个函数定义的参数"的变量，就删掉。 */
  var pruneTimer = 0;
  // 拖进对话框后的"复位看护"：块 id -> {x,y,parentId,until,tries}
  var pendingRestore = {};
  var viewSaveTimer = 0;
  function pruneUnusedVars() {
    var ws = state.ws;
    if (!ws || !ws.getAllVariables || !ws.getAllBlocks) return 0;
    // 拖动/手势进行中不动变量表：删变量会让正在移动的块找不到引用
    // （Blockly 会抛 "The block associated with the block move event could not be found"）
    try { if (ws.isDragging && ws.isDragging()) return 0; } catch (e) {}
    try { if (document.querySelector('.blocklyDragging')) return 0; } catch (e) {}
    var used = {};
    try {
      ws.getAllBlocks(false).forEach(function (b) {
        if (!b || !b.type) return;
        if (b.type === 'variables_get' || b.type === 'variables_set' || b.type === 'math_change') {
          try {
            var f = b.getField && b.getField('VAR');
            var v = f && f.getVariable && f.getVariable();
            if (v) used[v.getId()] = 1;
          } catch (e) {}
        }
        // 函数定义的参数（getVarModels 在 procedures_def* 上有）
        if (b.type.indexOf('procedures_def') === 0) {
          try {
            var list = b.getVarModels ? b.getVarModels() : [];
            (list || []).forEach(function (v) { if (v) used[v.getId()] = 1; });
          } catch (e) {}
          // 调用块通过名字引用，一旦定义没了调用块也就没意义，这里不管
        }
      });
    } catch (e) { return 0; }
    // 函数参数（按名字兜一层）：只要还有某个函数定义带这个参数名，就不能删
    try {
      var procs = (window.Blockly && Blockly.Procedures && Blockly.Procedures.allProcedures) ? Blockly.Procedures.allProcedures(ws) : [[], []];
      (procs[0] || []).concat(procs[1] || []).forEach(function (p) {
        ((p && p[1]) || []).forEach(function (n) { used['name:' + n] = 1; });
      });
    } catch (e) {}
    var removed = 0;
    try {
      ws.getAllVariables().slice().forEach(function (v) {
        if (v && used['name:' + v.name]) return;
        if (!v || used[v.getId()]) return;
        try { ws.deleteVariableById(v.getId()); removed++; } catch (e) {}
      });
    } catch (e) {}
    if (removed) { try { renderTabs && renderTabs(); } catch (e) {} }
    return removed;
  }
  function initWorkspace() {
    aiRegisterPasteMenu();       // 幂等：把「粘贴 AI 复制的代码」挂到画布菜单上（workspace + block 两个 scope）
    aiWirePasteShortcut();       // 画布上 Ctrl/Cmd+V 也能粘（一次粘全部）
    if (state.wsInited) return;
    registerFastRenderer();
    // 浮层（代码展示页）横/竖滚动条全局细化；主画布滚动条已用 CSS 隐藏
    try { if (B.Scrollbar && 'scrollbarThickness' in B.Scrollbar) B.Scrollbar.scrollbarThickness = 5; } catch (e) {}
    // 按工程实际用到的控件类型生成工具箱：没有该类控件就不显示对应分类
    var usedTypes = new Set();
    ((state.project && state.project.screens) || []).forEach(function (s) { (s.components || []).forEach(function (c) { if (c && c.type) usedTypes.add(c.type); }); });
    var opts = {
      toolbox: window.buildToolboxXml(usedTypes), renderer: 'fastzelos', theme: B.Themes.Zelos,
      // 网格点颜色：以前写死 '#e3e6ea'（浅灰），深色画布上会显得刺眼。
      // 改成半透明中性灰 —— 浅色底和深色底都读得出来，不用跟着主题改。
      grid: { spacing: 28, length: 1, colour: 'rgba(128,128,128,.22)', snap: false },
      undo: true,        // 明确打开撤销栈（AI 落地 / 插入 / 拖入复位都按一步记录）
      comments: false,   // 去掉代码块右上角那个「?」注释图标（用户要求删除）
      zoom: { controls: true, wheel: true, startScale: savedBlockScale(), maxScale: 2.0, minScale: 0.35, pinch: false },
      trashcan: false, move: { scrollbars: true, drag: true }, sounds: false, media: 'blockly/media/',
      modalInputs: true   // 数字/文本字段一律走 Blockly.dialog（已替换为 M3 弹窗），杜绝安卓原生 prompt
    };
    state.ws = B.inject('blocklyDiv', opts);
    try { if (B.Events) B.Events.recordUndo = true; } catch (e) {}   // 明确开启撤销记录
    // 诊断探针：统计 Events.disable/enable 的配对情况，并记下"是谁把它关掉的"
    try {
      if (B.Events && B.Events.disable && !B.Events.__fastWrapped) {
        var _dis = B.Events.disable, _ena = B.Events.enable, _cnt = 0;
        B.Events.disable = function () {
          _cnt++; window.__evCount = _cnt;
          if (_cnt === 1) { try { window.__evWho = String((new Error()).stack || '').split('\n').slice(1, 6).join(' | '); } catch (e) {} }
          return _dis.apply(B.Events, arguments);
        };
        B.Events.enable = function () { _cnt--; window.__evCount = _cnt; return _ena.apply(B.Events, arguments); };
        B.Events.__fastWrapped = true;
        window.__evCount = 0;
      }
    } catch (e) {}
    try { diagPush('init', '工作区就绪 撤销栈=' + (state.ws.undoStack_ ? state.ws.undoStack_.length : 'n/a')); } catch (e) {}
    state.wsInited = true;
    // 删掉函数后，它的参数变量会一直留在「变量」分类里（Blockly 不会自动回收）——
    // 用户反馈："给函数加了参数，删除函数后那些圆块还在"。这里挂一个延迟清理。
    try {
      state.ws.addChangeListener(function (ev) {
        if (!ev) return;
        // 视角一变就随手记进当前页面：只在"离开页面"时才存的话，中途任何一次重载
        // （切页/转屏/面板开合引发的 resize）都会把用户刚拖到的位置弄丢（用户反馈的切页 bug）。
        if (ev.type === 'viewport_change') {
          if (viewSaveTimer) clearTimeout(viewSaveTimer);
          viewSaveTimer = setTimeout(function () {
            viewSaveTimer = 0;
            // 这里不拦「还原中」：还原写回的就是同一个值，存下来也无害；
            // 拦掉反而会丢掉用户在还原窗口期内的手动拖动。
            try {
              var s = curScreen();
              if (s && state.ws) {
                s.view = { x: Math.round(state.ws.scrollX || 0), y: Math.round(state.ws.scrollY || 0),
                           scale: state.ws.getScale ? state.ws.getScale() : 1 };
              }
            } catch (e) {}
          }, 250);
          return;
        }
        // 拖进对话框：用 Blockly 的拖拽事件拿到"抓的是哪一块"（比按坐标命中判定可靠）
        if (ev.type === 'drag' && ev.isStart) {
          try {
            var gb = ev.blockId ? state.ws.getBlockById(ev.blockId) : null;
            if (gb) {
              window.__dragInProbe.dragStart++;
              window.__dragInProbe.grabbed = gb.type;
              window.__dragInGrabbed = gb;      // 只记"抓的是哪一块"，快照仍在 pointerdown 时做
            }
          } catch (e7) {}
        }
        // 复位看护：块被挪走就按回去（拖进对话框后的 2 秒内）
        if (ev.type === 'move' || ev.type === 'drag') {
          try {
            // 看护：这串代码（或它下面任何一块）在窗口期内被挪动/重接，就按快照整段还原
            var ids = Object.keys(pendingRestore);
            for (var ii = 0; ii < ids.length; ii++) {
              var key = ids[ii], pr = pendingRestore[key];
              if (!pr) continue;
              if (Date.now() > pr.until || pr.tries > 12) { delete pendingRestore[key]; continue; }
              var 涉及 = false;
              try {
                if (ev.blockId && pr.snap.ids && pr.snap.ids.indexOf(ev.blockId) >= 0) 涉及 = true;
                if (ev.oldParentId && pr.snap.ids && pr.snap.ids.indexOf(ev.oldParentId) >= 0) 涉及 = true;
                if (ev.newParentId && pr.snap.ids && pr.snap.ids.indexOf(ev.newParentId) >= 0) 涉及 = true;
              } catch (e6) {}
              if (!涉及) continue;
              pr.tries++;
              setTimeout(function () {
                try { if (state.__tryRestoreSnapshot) state.__tryRestoreSnapshot(pr.snap); } catch (e8) {}
              }, 120);
            }
          } catch (e5) {}
        }
        if (ev.type !== 'delete' && ev.type !== 'create' && ev.type !== 'change') return;
        if (pruneTimer) clearTimeout(pruneTimer);
        pruneTimer = setTimeout(function () { pruneTimer = 0; pruneUnusedVars(); }, 250);
      });
    } catch (e) {}
    try { wireDiag(); } catch (e) {}            // 诊断日志：捕获异常，设置里可一键导出
    try { wireCanvasDismiss(); } catch (e) {}   // 用户碰画布：取消视角补套 + 收起提示气泡
    // 兜底：把代码块上那个「?」注释图标彻底去掉（有些块/旧工程可能已经带着它）
    try {
      state.ws.getAllBlocks(false).forEach(function (b) {
        try { if (b.setCommentText) b.setCommentText(null); } catch (e) {}
        try {
          var ic = b.getIcon && b.getIcon(Blockly.icons && Blockly.icons.CommentIcon && Blockly.icons.CommentIcon.TYPE);
          if (ic && b.removeIcon) b.removeIcon(ic);
        } catch (e) {}
      });
      var rm = document.querySelectorAll('#blocklyDiv .blocklyCommentIcon, #blocklyDiv [class*="commentIcon"]');
      Array.prototype.forEach.call(rm, function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    } catch (e) {}
    try { aiWireCanvasDragIn(); } catch (e) {}   // 工作区重建后重新接上"拖进对话框"
    window.blocklyWs = state.ws;   // 调试/自动化测试句柄（只读使用，不影响功能）
    // 包装中心缩放：无论来自自定义按钮还是内部调用，缩放后都持久化（该方法不触发 viewport 事件）
    (function wrapZoom() {
      var ws = state.ws, orig = ws.zoomCenter ? ws.zoomCenter.bind(ws) : null;
      if (orig) ws.zoomCenter = function (dir) { var r = orig(dir); recordZoom(); return r; };
    })();
    setupCustomPinch(state.ws);   // 稳定的双指缩放（替代内置 pinch，避免真机缩放/平移手势竞争闪烁）
    bindBlockLongPress(state.ws); // 长按代码弹出复制/删除菜单
    bindIfBranchEditor(state.ws); // “如果”齿轮改为 +/− 分支小框
    // 分类浮层使用原生 autoClose：点选代码、把代码拖出、点画布空白都会关闭浮层并让出画布；
    // 可滚动的分类里，在代码上竖向拖动是滚动浮层，横向拖向画布才是取出代码（Blockly 原生判定）。
    try { var fl = state.ws.getFlyout && state.ws.getFlyout(); if (fl) fl.autoClose = true; } catch (e) {}
    patchFlyoutGuard(state.ws);   // 浮层宽度守卫：防止代码被右缘裁切
    // 工作区缩放（按钮/滚轮/双指）后，浮层若打开则按新缩放重新布局并补偿宽度
    state.ws.addChangeListener(function (ev) {
      try { if (ev && ev.type === 'viewport') reflowFlyoutSoon(); } catch (e) {}
    });
    bindDeleteOnDrag(state.ws);
    // “跳转到页面”代码拖出时，默认目标若落在当前页（=跳自己，运行时点了没反应），
    // 自动改成第一个其他页面；只有一个页面时保持默认。加载已保存工程/切页（loadingWs）不篡改。
    state.ws.addChangeListener(function (ev) {
      try {
        if (loadingWs || ev.type !== B.Events.BLOCK_CREATE) return;
        if (ev.workspaceId !== state.ws.id) return;   // 浮层/拖影等其他工作区的事件不处理
        var ids = ev.ids || (ev.blockId ? [ev.blockId] : []);
        ids.forEach(function (bid) {
          var b = state.ws.getBlockById(bid);
          if (!b || b.type !== 'act_goto' || b.isInFlyout) return;
          var cur = curScreen(), v = b.getFieldValue('PAGE');
          if (v && v !== 'NONE' && v !== cur.id) return;   // 已指向别的页面则不动
          var other = (state.project.screens || []).filter(function (s) { return s.id !== cur.id; });
          if (other.length) b.setFieldValue(other[0].id, 'PAGE', true);
        });
      } catch (e) {}
    });
    buildCategoryRail(state.ws);   // 自定义 M3 分类轨道（替代原生分类列，杜绝点按/滑动误判导致的“打不开”）
    // 云列表：动态分类浮层（创建/管理按钮 + 按已登记云表格生成代码）
    try {
      setupBlocklyDialogs();   // 安卓 WebView 下数字/文本编辑默认走原生 prompt，这里替换为 M3 弹窗
      state.ws.registerToolboxCategoryCallback('BB_CLOUD', function () { return window.BB_cloudFlyout(state.ws); });
      state.ws.registerButtonCallback('BB_CLOUD_CREATE', function () {
        try { state.ws.hideChaff(); } catch (e) {}
        try { state.ws.getToolbox().clearSelection(); } catch (e) {}
        openCloudCreate(null);
      });
      state.ws.registerButtonCallback('BB_CLOUD_MANAGE', function () {
        try { state.ws.hideChaff(); } catch (e) {}
        try { state.ws.getToolbox().clearSelection(); } catch (e) {}
        openCloudManage();
      });
    } catch (e) { console.error('cloud category register', e); }
    // 注意：AI 生成的代码**不再**占用左侧抽屉的分类（用户反馈左侧已经太臃肿）。
    // 现在是在 AI 面板自己的代码画布上按住往外拖，见 wireAiPreviewDrag()。
    // 点代码画布空白处：收起分类浮层、下拉，并关闭“如果/否则”等蓝色齿轮弹出的设置框(mutator 气泡)
    function closeMutatorBubbles(ws) {
      try {
        ws.getAllBlocks(false).forEach(function (b) {
          try { if (b.mutator && b.mutator.bubbleIsVisible && b.mutator.bubbleIsVisible()) b.mutator.setBubbleVisible(false); } catch (e) {}
        });
      } catch (e) {}
    }
    state.ws.closeMutatorBubbles = function () { closeMutatorBubbles(state.ws); };
    $('blocklyDiv').addEventListener('pointerdown', function (e) {
      // 浮层/工具箱/齿轮气泡本体(含其内部工作区与拖动表面)/下拉/缩放钮/齿轮图标自身不处理
      // （齿轮保留原生开-关切换）；mutator 小框内的一切拖动都不能触发关闭
      if (e.target.closest && e.target.closest('.blocklyToolboxDiv,.blocklyFlyout,.blocklyBubble,.blocklyBubbleCanvas,.blocklyMutatorBackground,.blocklyBlockDragSurface,.blocklyWidgetDiv,.blocklyDropDownDiv,.blocklyZoom,.blocklyIconGroup')) return;
      // 双保险：触点落在任意已打开气泡的屏幕范围内，也不关闭（真机上个别元素 closest 可能漏判）
      var insideBubble = false;
      try {
        Array.prototype.forEach.call(document.querySelectorAll('.blocklyBubbleCanvas'), function (g) {
          var r = g.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) insideBubble = true;
        });
      } catch (err) {}
      if (insideBubble) return;
      try { state.ws.hideChaff(); } catch (err) {}
      clearRailActive();
      closeMutatorBubbles(state.ws);
    }, true);
    // 代码任何结构性变更都自动保存（选择/视口等 UI 事件除外），杜绝试运行返回后代码丢失
    state.ws.addChangeListener(function (e) {
      if (loadingWs || (e && e.isUiEvent)) return;
      autosave();
    });
    // 缩放比例持久化：滚轮/双指/缩放按钮改变视口后，防抖写入工程，重进/切页面不再复位
    var zoomSaveTimer = null;
    state.ws.addChangeListener(function (e) {
      if (!e || e.type !== 'viewport_change' || loadingWs) return;
      clearTimeout(zoomSaveTimer);
      zoomSaveTimer = setTimeout(function () {
        if (!state.project || !state.ws) return;
        var sc = state.ws.getScale();
        if (isFinite(sc) && sc >= 0.35 && sc <= 2.0 && Math.abs((state.project.blockZoom || DEFAULT_BLOCK_SCALE) - sc) > 0.001) {
          state.project.blockZoom = sc;
          try { localStorage.setItem(ZOOM_GLOBAL_KEY, String(sc)); } catch (e) {}
          autosave();
        }
      }, 250);
    });
    // 滚轮 / 双指缩放后持久化（冒泡阶段，Blockly 处理完已更新 scale）
    $('blocklyDiv').addEventListener('wheel', function () { recordZoom(); }, { passive: true });
    $('blocklyDiv').addEventListener('pointerup', function () { recordZoom(); }, { passive: true });
    $('blocklyDiv').addEventListener('pointercancel', function () { recordZoom(); }, { passive: true });
    loadScreenToWs(curScreen());
    // 容器尺寸变化即同步画布（旋转、显示切换、键盘弹起都覆盖）
    if (window.ResizeObserver) new ResizeObserver(function () { safeResize(); }).observe($('blocklyDiv'));
    window.addEventListener('resize', requestWsResize);
    window.addEventListener('orientationchange', function () { setTimeout(requestWsResize, 120); setTimeout(requestWsResize, 400); });
  }
  function safeResize() {
    if (!state.ws) return;
    var d = $('blocklyDiv');
    if (!d || d.clientWidth < 2 || d.clientHeight < 2) return; // 容器还没布局好，等下一次
    try { state.ws.resize(); } catch (e) {}
  }
  var resizeTimer = null;
  /**
   * 尺寸变化后**重新套用当前页面记住的视角**。
   * Blockly 的 resize 会把画布重新居中/回弹，如果不管，用户"切到别的页面再切回来"
   * 或者转个屏，看到的位置就没了（用户反馈过）。这里在 resize 之后把该页视角再按回去。
   */
  /* 视角"补套"可能被取消：用户一旦开始操作画布，就不能再由后台把视角按回去
     （否则表现就是"拖动时闪一下/被拽回去"）。 */
  var viewHoldToken = 0;
  function cancelViewHold() { viewHoldToken++; }
  /**
   * 程序化"套用视角"时临时屏蔽 hideChaff。
   *
   * 这是"一点代码按钮积木栏就闪一下"的**真正原因**：Blockly 的 `setScale()` / `scroll()`
   * 内部自己会调 `hideChaff()`，而 hideChaff 会把左侧代码浮层关掉 —— 于是
   * "进代码页 → 恢复选中的分类（浮层打开）→ 套用上次视角（浮层被关）" 就成了闪一下。
   * 套用视角是我们的程序行为，不该关掉用户正看着的浮层，所以在这一小段里屏蔽它。
   */
  function 套用视角(fn) {
    var ws = state.ws;
    if (!ws || typeof ws.hideChaff !== 'function') { fn(); return; }
    var 原 = ws.hideChaff;
    ws.hideChaff = function () {};
    try { fn(); } finally { ws.hideChaff = 原; }
  }
  function reapplyScreenViewSoon() {
    if (!state.wsInited || !state.ws) return;
    var s = curScreen();
    if (!s || !s.view || !isFinite(s.view.x) || !isFinite(s.view.y)) return;
    var v = s.view;
    var my = ++viewHoldToken;
    var apply = function () {
      if (my !== viewHoldToken) return;    // 用户已经动过画布了，别再按回去
      套用视角(function () {
        try { state.ws.setScale(v.scale || 1); state.ws.scroll(v.x, v.y); } catch (e) {}
      });
    };
    [0, 90, 260, 520, 1200].forEach(function (t) { setTimeout(apply, t); });
  }
  /* 用户碰画布时：立刻取消「视角补套」，并收起 Blockly 的工具提示 / 注释气泡 / 右键菜单。
     真机上点完代码块会弹出黄色提示气泡，而 Blockly 自己的 hideChaff 由于自定义 pointer
     处理没被触发，气泡就一直挂着（用户反馈：点空白区域关不掉）。 */
  function wireCanvasDismiss() {
    var host = document.getElementById('blocklyDiv');
    if (!host || host.__dismissWired) return;
    host.__dismissWired = true;
    var dismiss = function (e) {
      cancelViewHold();
      // 点在**左侧分类栏 / 代码浮层**上时不要收起任何东西：用户点的就是选择栏，
      // 一收就把浮层关了（用户反馈"积木选择栏我一点它就关了"）。
      try {
        var t = e && e.target;
        if (t && t.closest && (t.closest('.blocklyFlyout') || t.closest('.blocklyToolboxDiv'))) return;
      } catch (err) {}
      // 只收"提示气泡" —— 绝对不调 hideChaff：它的参数一旦为 false（或省略）就会
      // 把左侧代码选择栏一起关掉（用户反馈"积木选择栏我一点它就关了"就是这个引起的）。
      try { if (window.Blockly && Blockly.Tooltip && Blockly.Tooltip.hide) Blockly.Tooltip.hide(); } catch (e) {}
      var tip = document.querySelector('.blocklyTooltipDiv');
      if (tip) tip.style.display = 'none';
      window.__dismissCalled = (window.__dismissCalled || 0) + 1;
    };
    host.addEventListener('pointerdown', dismiss, true);
    host.addEventListener('wheel', function () { cancelViewHold(); }, { capture: true, passive: true });
    host.addEventListener('touchstart', function () { cancelViewHold(); }, { capture: true, passive: true });
  }
  function requestWsResize() {
    safeResize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { safeResize(); reapplyScreenViewSoon(); }, 60);
    setTimeout(function () { safeResize(); reapplyScreenViewSoon(); }, 220);
  }
  /* 工具箱“分类行”滑动 vs 轻点：
     Blockly 在 pointerdown 时就会选中分类，导致上下滑动分类列时误开别的分类。
     这里只拦截【左侧分类行】(.blocklyToolboxCategory)：
       - 按下先拦住 Blockly 的选中；
       - 移动超过阈值 => 判定为滑动（交给浏览器原生滚动），始终不选中；
       - 未移动就抬手 => 判定为轻点，直接用 Toolbox API 选中该分类。
     右侧代码浮层(.blocklyFlyout)与画布完全不干预；浮层另设 autoClose=false，
     保证浮层滚动不闪、代码可正常拖出、拖出后浮层常驻。 */
  function guardToolboxScroll() {
    var root = $('blocklyDiv'); if (!root || root.__tbGuarded) return;
    root.__tbGuarded = true;
    var active = false, moved = false, row = null, pid = -1, sx = 0, sy = 0;
    var TAP_SLOP = 9;
    function catRow(t) { return t && t.closest ? t.closest('.blocklyToolboxCategory') : null; }

    root.addEventListener('pointerdown', function (e) {
      var r = catRow(e.target);
      if (!r) { active = false; return; }          // 非分类行：画布/浮层/代码一律放行
      active = true; moved = false; row = r; pid = e.pointerId; sx = e.clientX; sy = e.clientY;
      e.stopPropagation();                          // 先拦住 Blockly 的“按下即选”
    }, true);

    root.addEventListener('pointermove', function (e) {
      if (!active || e.pointerId !== pid) return;
      if (Math.abs(e.clientX - sx) > TAP_SLOP || Math.abs(e.clientY - sy) > TAP_SLOP) moved = true;
    }, true);

    function selectCategory(target) {
      try {
        var tb = state.ws && state.ws.getToolbox && state.ws.getToolbox();
        if (!tb) return false;
        var item = null;
        if (tb.getToolboxItems) {
          var list = tb.getToolboxItems();
          for (var i = 0; i < list.length; i++) { if (list[i] && list[i].htmlDiv_ === target) { item = list[i]; break; } }
        }
        if (!item && target.id && tb.getToolboxItemById) item = tb.getToolboxItemById(target.id);
        if (item && (!item.isSelectable || item.isSelectable())) {
          // 再次点击已展开的分类 => 收起浮层；否则展开
          if (tb.getSelectedItem() === item) tb.clearSelection(); else tb.setSelectedItem(item);
          return true;
        }
      } catch (err) {}
      return false;
    }
    function finish() {
      if (!active) return;
      var target = row; active = false; row = null;
      if (!moved && target && target.isConnected) selectCategory(target);  // 干净轻点：选中分类
    }
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', function () { active = false; row = null; }, true);
  }

  /* 自定义 M3 分类轨道：分「控件代码 / 常规代码」两组，常驻折叠箭头；
     直接用 Toolbox API 选中分类（真实 click，无按下即选/滑动误判），杜绝偶发“打不开”。 */
  function catItemName(it) { try { return it.getName_ ? it.getName_() : (it.name_ || ''); } catch (e) { return ''; } }
  function catItemColour(it) {
    var c = it && it.colour_;
    if (!c) return '#6750a4';
    if (typeof c === 'string') return c;
    return c.primary || c.base || c.colour || '#6750a4';
  }
  function chevSvg(dir) {
    var d = dir === 'up' ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6';
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  }
  /** 摘掉分类高亮。传了 `保留` 就把那一条留着（"从 A 切到 B"时用，滑块才能滑过去而不是重新出现）。 */
  function clearRailActive(保留) {
    var rail = document.getElementById('bbCats');
    if (rail) Array.prototype.forEach.call(rail.querySelectorAll('.bb-cat.on'), function (b) {
      if (保留 && b === 保留) return;          // 保留新的那一条，别把它也摘了
      b.classList.remove('on');
      var lb = b.querySelector('.bb-cat-lb');
      if (lb) { lb.style.removeProperty('--bb-marquee'); lb.classList.remove('bb-scroll'); }   // 取消选中：跑马灯立即停
    });
    /* ⚠️ 滑块必须在这里同步，不能只在"点分类"那一条路径里同步（2026-09-26 修）。
       取消选中其实有**两条**路径：
         1) 点分类自己 → 按钮的 click 处理里会叫 同步分段药丸()；
         2) 点空白 / 拖出去，Blockly 自己关掉浮层 → 走下面那个 pointerup 监听，
            它只调 clearRailActive()。
       第 2 条以前不通知滑块，于是**点空白取消后灰底一直留在那一条上**（用户截图报的）。
       放在这里就是"谁清高亮谁负责通知"，以后加新路径也不会再漏。 */
    同步分段药丸();
  }
  /**
   * 选中项文字放不下时，让它从左往右缓慢滚动显示全名（用户要求：
   * "下拉选择框"这种长名字被截成"下拉选…"，选中后应当滚动显示完整）。
   * 位移量 = 文字宽度 - 可用宽度，写进 CSS 变量，动画只在 .on 上跑。
   *
   * 注意：刚点开时块可能还没排完版（宽度为 0），量出来会是 0 —— 那就永远不滚动。
   * 所以先量一次，再在下一帧/120ms 后补量（只对选中项算，代价很小）。
   */
  function railMarquee(b) {
    var 算 = function () {
      try {
        var lb = b && b.querySelector && b.querySelector('.bb-cat-lb');
        if (!lb || !b.isConnected || !b.classList.contains('on')) return;
        /* 不用"按钮宽度 - 图标 - 内边距"这种估算法（字号/内边距一变就不准），
           直接量标签自己：临时裁成 hidden → scrollWidth 是真实文字宽、clientWidth 是实际可见宽。
           （选中项 CSS 里是 overflow:visible，那种状态下 scrollWidth 会退化成 clientWidth，量不出溢出。） */
        var 原溢出 = lb.style.overflow;
        lb.style.overflow = 'hidden';
        var 文字 = lb.scrollWidth;
        var 可见 = lb.clientWidth || lb.offsetWidth;
        lb.style.overflow = 原溢出;
        if (可见 <= 4) return;                       // 还没排好版，等下一帧再量
        var 溢出 = Math.max(0, 文字 - 可见);
        lb.classList.toggle('bb-scroll', 溢出 > 2);
        lb.style.setProperty('--bb-marquee', (-溢出) + 'px');
      } catch (e) {}
    };
    算();
    requestAnimationFrame(算);
    setTimeout(算, 120);
  }

  // 离开代码页时：关闭分类浮层、控件下拉(BlocklyDropDownDiv 挂在 body，切视图不会自动关)、齿轮设置框
  function closeBlocksOverlays() {
    if (!state.wsInited || !state.ws) return;
    try { state.ws.hideChaff(); } catch (e) {}
    try { var tb = state.ws.getToolbox && state.ws.getToolbox(); if (tb && tb.clearSelection) tb.clearSelection(); } catch (e) {}
    try { state.ws.closeMutatorBubbles && state.ws.closeMutatorBubbles(); } catch (e) {}
    clearRailActive();
  }
  // 控件改名/增删/改文字后，画布与浮层里所有“控件/页面下拉”按 id 重新取最新显示名（value 存的是 id，仅文字需刷新）
  function refreshCompDropdowns() {
    if (!state.wsInited || !state.ws) return;
    function reroot(ws) {
      if (!ws || !ws.getAllBlocks) return;
      try {
        ws.getAllBlocks(false).forEach(function (b) {
          (b.inputList || []).forEach(function (inp) {
            (inp.fieldRow || []).forEach(function (f) {
              if (f && typeof f.getOptions === 'function') {
                // 关键：先以 useCache=false 重新执行动态 generator，刷新 Blockly 缓存的选项，
                // 否则 doValueUpdate_ 会沿用旧缓存文本（控件改名后显示不更新）。
                try { f.getOptions(false); } catch (e) {}
                try { if (typeof f.doValueUpdate_ === 'function') f.doValueUpdate_(f.getValue()); } catch (e) {}
                try { if (typeof f.forceRerender === 'function') f.forceRerender(); } catch (e) {}
                try { if (typeof f.updateTextNode_ === 'function') f.updateTextNode_(); } catch (e) {}
              }
            });
          });
        });
      } catch (e) {}
    }
    reroot(state.ws);
    try { var fl = state.ws.getFlyout && state.ws.getFlyout(); if (fl && fl.getWorkspace) reroot(fl.getWorkspace()); } catch (e) {}
  }
  // 分类栏换位（用户要求：长按积木列表能换位，松手记住顺序）
  // 顺序存在本机，下次打开还是自己排的顺序；新出现的分类自动排在最后。
  var RAIL_ORDER_KEY = '__bb_cat_order_v1';
  var railJustDragged = 0;      // 刚换完位就不要再当普通点击（否则会顺手展开/收起分类）
  var railDragActive = false;   // 换位中：暂时接管上下滑动，否则列表会跟着滚
  function railOrderSaved() {
    try { return JSON.parse(localStorage.getItem(RAIL_ORDER_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function railOrderApply(mode, names) {
    var saved = railOrderSaved()[mode] || [];
    var out = [];
    saved.forEach(function (n) { if (names.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n); });
    names.forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
    return out;
  }
  function railOrderSave(mode, names) {
    try { var o = railOrderSaved(); o[mode] = names; localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(o)); } catch (e) {}
  }
  /**
   * 长按 300ms 抬起某一项 → 上下拖动整列换位 → 松手落地。
   * 用 transform 位移（不改文档流）实现"其余项平滑让位"，落地再真正重排 DOM。
   */
  function bindRailReorder(panel, mode) {
    var arm = null, cand = null, dragEl = null, startY = 0, step = 0, from = -1, to = -1;
    function list() { return Array.prototype.slice.call(panel.querySelectorAll('.bb-cat')); }
    function clearArm() { if (arm) { clearTimeout(arm); arm = null; } }
    function reset() {
      list().forEach(function (b) {
        b.classList.remove('bb-drag', 'bb-shift');
        b.style.removeProperty('--bb-dy'); b.style.removeProperty('--bb-shift');
      });
      dragEl = null; cand = null; from = -1; to = -1; railDragActive = false;
    }
    function detach() {
      clearArm();
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    }
    function begin() {
      if (!cand) return;
      var arr = list();
      from = arr.indexOf(cand);
      if (from < 0) { reset(); return; }
      var r0 = cand.getBoundingClientRect();
      var r1 = arr[from + 1] ? arr[from + 1].getBoundingClientRect() : null;
      step = r1 ? (r1.top - r0.top) : (r0.height + 8);
      if (!(step > 0)) step = r0.height + 8;
      dragEl = cand; to = from; railDragActive = true;
      dragEl.classList.add('bb-drag');
      dragEl.style.setProperty('--bb-dy', '0px');
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
    }
    function onMove(e) {
      if (!dragEl) {
        // 长按生效前手指已经滑动 => 说明用户是在滚动列表，不当成长按
        if (Math.abs(e.clientY - startY) > 9) { detach(); reset(); }
        return;
      }
      e.preventDefault();
      var dy = e.clientY - startY;
      dragEl.style.setProperty('--bb-dy', dy + 'px');
      var arr = list();
      var idx = Math.max(0, Math.min(arr.length - 1, from + Math.round(dy / step)));
      if (idx === to) return;
      to = idx;
      arr.forEach(function (b, i) {
        if (b === dragEl) return;
        var d = 0;
        if (from < to && i > from && i <= to) d = -step;
        else if (from > to && i >= to && i < from) d = step;
        if (d) { b.classList.add('bb-shift'); b.style.setProperty('--bb-shift', d + 'px'); }
        else { b.classList.remove('bb-shift'); b.style.removeProperty('--bb-shift'); }
      });
    }
    function onUp() {
      detach();
      if (!dragEl) { reset(); return; }
      var arr = list();
      // 先记下"眼睛看到的位置"（getBoundingClientRect 已经含了位移），
      // 落位后再用 FLIP 从原视觉位置滑到新位置 —— 直接清位移类会跳一下，不自然。
      // 注意：重排会打乱数组顺序，所以位置要按**元素**记，不能按下标。
      var 位置 = new Map();
      arr.forEach(function (b) { 位置.set(b, b.getBoundingClientRect().top); });
      if (to >= 0 && to !== from) {
        var moved = arr.splice(from, 1)[0];
        arr.splice(to, 0, moved);
        arr.forEach(function (b) { panel.appendChild(b); });
        railOrderSave(mode, arr.map(function (b) { return b.title; }));
        railJustDragged = Date.now();
      }
      arr.forEach(function (b) {
        b.classList.remove('bb-drag', 'bb-shift');
        b.style.removeProperty('--bb-dy'); b.style.removeProperty('--bb-shift');
        b.style.transition = 'none'; b.style.transform = '';
      });
      void panel.offsetHeight;                       // 强制重排，拿到新位置
      // 重排把条目顺序改了 → 选中滑块也得跟着挪，否则它会留在旧位置（用户看就是"提示跟丢了"）。
      // 这里先同步一次（DOM 顺序已经变了，量到的是最终位置），动画结束再补一次兜底。
      同步分段药丸();
      arr.forEach(function (b) {
        var d = 位置.get(b) - b.getBoundingClientRect().top;
        if (Math.abs(d) > 0.5) b.style.transform = 'translateY(' + Math.round(d) + 'px)';
      });
      void panel.offsetHeight;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          arr.forEach(function (b) {
            b.style.transition = 'transform .24s cubic-bezier(.2,0,0,1)';
            b.style.transform = '';
          });
          setTimeout(function () {   // 动画完把内联样式清掉，交回 CSS 管
            arr.forEach(function (b) { b.style.transition = ''; b.style.transform = ''; });
            同步分段药丸();
          }, 300);
        });
      });
      dragEl = null; cand = null; from = -1; to = -1; railDragActive = false;
    }
    panel.addEventListener('pointerdown', function (e) {
      var b = e.target.closest && e.target.closest('.bb-cat');
      if (!b) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (document.querySelector('.mask:not(.hidden)')) return;
      cand = b; dragEl = null; from = -1; to = -1;
      startY = e.clientY;
      clearArm();
      arm = setTimeout(begin, 300);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    }, true);
  }
  function buildCategoryRail(ws) {
    var host = $('viewBlocks');
    var tb = ws.getToolbox && ws.getToolbox(); if (!tb || !tb.getToolboxItems) return;
    var items = tb.getToolboxItems();
    var byName = {};
    items.forEach(function (it) { var n = catItemName(it); if (n) byName[n] = it; });
    /** 恢复"上次选中的分类"（重建和不重建两条路都要走） */
    function 恢复选中(rail) {
      if (!state.catSel || !byName[state.catSel]) return;
      var sel = byName[state.catSel];
      try {
        if (sel && (!sel.isSelectable || sel.isSelectable())) {
          tb.setSelectedItem(sel);
          var btns = rail.querySelectorAll('.bb-cat');
          for (var bi = 0; bi < btns.length; bi++) if (btns[bi].title === state.catSel) { btns[bi].classList.add('on'); railMarquee(btns[bi]); }
        }
      } catch (e) {}
    }
    /* 分类清单没变就**绝不重建**：以前每次进代码页都 remove + 新建整个分类栏，
       结果是侧栏空一帧、浮层"关掉再打开" —— 用户看到的就是"积木栏闪一下"。
       只有真的有分类新增/消失（工程里控件类型变了）时才重建。 */
    var 名表 = ((window.BB_GROUPS && window.BB_GROUPS.general) || []).map(function (n) { return byName[n] ? '1' : '0'; }).join('') +
               '#' + ((window.BB_GROUPS && window.BB_GROUPS.widget) || []).map(function (n) { return byName[n] ? '1' : '0'; }).join('');
    var 现有 = document.getElementById('bbCats');
    if (现有 && 现有.dataset && 现有.dataset.sig === 名表) {
      恢复选中(现有);
      return;
    }
    var old = document.getElementById('bbCats'); if (old) old.remove();
    var oldZoom = document.getElementById('bbZoom'); if (oldZoom) oldZoom.remove();
    var tb = ws.getToolbox && ws.getToolbox(); if (!tb || !tb.getToolboxItems) return;
    var items = tb.getToolboxItems();
    var byName = {};
    items.forEach(function (it) { var n = catItemName(it); if (n) byName[n] = it; });

    var rail = el('div', ''); rail.id = 'bbCats';
    rail.dataset.sig = 名表;   // 记下这份分类清单，下次清单没变就直接复用
    rail.classList.add('bb-mode-' + (state.catMode === 'widget' ? 'widget' : 'general'));   // 记住上次所在分组

    // 单个分类按钮（横向长方形 M3 条目）；直接走 Toolbox API 选中，真实 click，杜绝偶发打不开
    function makeCatButton(n) {
      var it = byName[n]; if (!it) return null;
      var colour = catItemColour(it);
      var b = el('button', 'bb-cat'); b.type = 'button'; b.title = n;
      b.style.setProperty('--bb-c', colour);
      var ico = el('span', 'bb-cat-ico', (window.BB_CAT_ICON && window.BB_CAT_ICON[n]) || n.slice(0, 1));
      ico.style.background = colour + '1F'; ico.style.color = colour;
      var lb = el('span', 'bb-cat-lb', n);
      b.appendChild(ico); b.appendChild(lb);
      b.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        // 刚长按换完位：这一次的"点击"不算数，免得顺手把分类展开/收起
        if (Date.now() - railJustDragged < 400) return;
        try {
          var isSel = tb.getSelectedItem() === it;
          // ⚠️ 顺序很重要：**先把新的标上 `.on`，再清旧的**。
          // 原来是先 clearRailActive()（把所有 .on 都摘掉）再加新的 ——
          // 那一瞬间"一个都没选中"，滑块收到了"隐藏"的信号，于是接着那次同步就变成
          // "从旧位置凭空滑过来"（用户 2026-09-26 报的"未选中时点击会凭空划过来"）。
          // 先标新的、再清旧的（保留新的那一条），滑块全程都知道"我还在某一条上"，就能正常滑过去。
          if (isSel) {
            clearRailActive();
            tb.clearSelection();
            state.catSel = null;
          } else {
            b.classList.add('on');
            clearRailActive(b);          // 保留 b：只摘掉其它条目的高亮
            tb.setSelectedItem(it);
            state.catSel = n;
            railMarquee(b);
          }
          同步分段药丸();          // 分类选中/取消都让滑块跟着走（不再硬切）
          // 记住当前所在分组（控件/常规），切到设计页再回来仍停留在该分组
          state.catMode = rail.classList.contains('bb-mode-widget') ? 'widget' : 'general';
        } catch (err) {}
      });
      return b;
    }
    function makePanel(cls, names, mode) {
      var panel = el('div', 'bb-panel ' + cls);
      // 用用户上次排好的顺序（没排过就用默认顺序）
      names = railOrderApply(mode, names);
      names.forEach(function (n) { var b = makeCatButton(n); if (b) panel.appendChild(b); });
      bindRailReorder(panel, mode);
      return panel;
    }

    // 常驻切换槽：组名 + 箭头同处一条；槽内文案表示“箭头将展开的目标分组”。
    // 常规态底部为“控件代码 + 向上”（向上拉出控件栏），控件态顶部为“常规代码 + 向下”（向下拉回常规栏）。
    var topWrap = el('div', 'bb-switch-wrap bb-top-wrap');
    var topSw = el('button', 'bb-switch'); topSw.type = 'button'; topSw.setAttribute('aria-label', '切回常规代码');
    topSw.innerHTML = '<span class="bb-sw-tx">常规代码</span>' + chevSvg('down'); topWrap.appendChild(topSw);
    var botWrap = el('div', 'bb-switch-wrap bb-bot-wrap');
    var botSw = el('button', 'bb-switch'); botSw.type = 'button'; botSw.setAttribute('aria-label', '查看控件代码');
    botSw.innerHTML = '<span class="bb-sw-tx">控件代码</span>' + chevSvg('up'); botWrap.appendChild(botSw);

    var viewport = el('div', 'bb-rail-viewport');
    var generalPanel = makePanel('bb-panel-general', (window.BB_GROUPS && window.BB_GROUPS.general) || [], 'general');
    var widgetPanel = makePanel('bb-panel-widget', (window.BB_GROUPS && window.BB_GROUPS.widget) || [], 'widget');
    // 工程里一个控件都没有时，控件栏不显示任何控件分类，改为给出引导提示
    if (!widgetPanel.querySelector('.bb-cat')) {
      var empty = el('div', 'bb-empty-hint');
      empty.innerHTML = '<div class="bb-empty-ico">＋</div><div class="bb-empty-tx">还没有控件</div>' +
        '<div class="bb-empty-sub">先到「设计」页<br>添加按钮、文字等控件</div>';
      widgetPanel.appendChild(empty);
    }
    viewport.appendChild(widgetPanel); viewport.appendChild(generalPanel);
    rail.appendChild(topWrap); rail.appendChild(viewport); rail.appendChild(botWrap);
    host.appendChild(rail);
    // 分类选中滑块：两个面板各自装一个，被选中的那条背景"滑"过去（不再硬切）
    (function () {
      var g = Array.prototype.slice.call(generalPanel.querySelectorAll('.bb-cat'));
      var w = Array.prototype.slice.call(widgetPanel.querySelectorAll('.bb-cat'));
      if (g.length) 装分类滑块(generalPanel, g);
      if (w.length) 装分类滑块(widgetPanel, w);
    })();

    // 重建分类栏后（从设计页切回代码页）恢复上次选中的分类
    恢复选中(rail);

    function setMode(mode) {
      var cur = rail.classList.contains('bb-mode-widget') ? 'widget' : 'general';
      state.catMode = mode;
      if (cur === mode) return;
      try { tb.clearSelection(); } catch (e) {}
      clearRailActive();
      state.catSel = null;
      rail.classList.remove('bb-mode-general', 'bb-mode-widget');
      rail.classList.add('bb-mode-' + mode);
      var p = mode === 'widget' ? widgetPanel : generalPanel;
      setTimeout(function () { try { p.scrollTop = 0; } catch (e) {} }, 12);
    }
    botSw.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); setMode('widget'); });
    topSw.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); setMode('general'); });

    // 浮层因拖出代码/点空白自动关闭后，同步取消轨道高亮
    document.addEventListener('pointerup', function () {
      setTimeout(function () {
        try {
          if (!tb.getSelectedItem()) {
            clearRailActive();
            // 用户自己关掉的（点空白/再点一次分类）：也要把"记住的分类"清掉，
            // 否则切走再回来又会自动把浮层打开（用户反馈：点空白关了，回来又自己开了）
            state.catSel = null;
          }
        } catch (e) {}
      }, 60);
    }, true);

    // M3 缩放控件（替代老旧的原生放大镜位图）：整理代码 / 放大 / 复位 / 缩小
    var zoom = el('div', ''); zoom.id = 'bbZoom';
    var tidy = el('button', 'bb-z'); tidy.type = 'button'; tidy.title = '整理代码';
    tidy.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 6h13M7 12h13M7 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/></svg>';
    tidy.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      try {
        ws.cleanUp();
        // cleanUp 把代码排到工作区起点后，整体往右、下挪一点，避免紧贴分类栏/顶边。
        // 注意：**只挪那些已经被 cleanUp 摆到起点(x≈0)的代码** —— 以前是无条件挪，
        // 于是每点一次"整理"就再挪一次，代码一路往右下跑（用户反馈）。
        try {
          ws.getTopBlocks(false).forEach(function (b) {
            var xy = b.getRelativeToSurfaceXY();
            if (Math.abs(xy.x) < 0.5) b.moveBy(40, 28);
          });
        } catch (eM) {}
        // 贴左上排列：滚动到 (0,0)，让代码紧靠分类栏右缘/画布顶部
        try { ws.scroll(0, 0); } catch (err) { try { ws.scrollCenter(); } catch (e2) {} }
        autosave(); snack('已整理代码');
      } catch (err) {}
    });
    var plus = el('button', 'bb-z'); plus.type = 'button'; plus.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    var minus = el('button', 'bb-z'); minus.type = 'button'; minus.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    plus.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); 套用视角(function () { ws.zoomCenter(1); }); recordZoom(); });
    minus.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); 套用视角(function () { ws.zoomCenter(-1); }); recordZoom(); });

    zoom.appendChild(tidy);
    // 用户要求：去掉右下角那个"粘贴"按钮（粘贴入口保留在画布长按菜单里）
    window.__aiSyncPasteBtn = function () {};
    zoom.appendChild(plus); zoom.appendChild(minus);
    host.appendChild(zoom);
  }
  function bindDeleteOnDrag(ws) {
    var draggingBlock = null, armed = false, lastX = 0, lastY = 0, zone = $('delZone');
    function tbRect() { var t = document.querySelector('.blocklyToolboxDiv'); return t ? t.getBoundingClientRect() : null; }
    function overToolbox(x, y) { var r = tbRect(); return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
    function clearHint() { armed = false; if (zone) zone.classList.remove('on'); }
    document.addEventListener('pointermove', function (e) {
      lastX = e.clientX; lastY = e.clientY;
      if (!draggingBlock) return;
      var over = overToolbox(lastX, lastY);
      if (over !== armed) { armed = over; zone.classList.toggle('on', over); }
    }, true);
    // 兜底：指针在窗口外松开/手势被取消时，提示也必须消失
    window.addEventListener('pointerup', clearHint, true);
    window.addEventListener('pointercancel', clearHint, true);
    ws.addChangeListener(function (e) {
      if (e.type !== B.Events.BLOCK_DRAG || !e.blockId) return;
      if (e.isStart) { draggingBlock = ws.getBlockById(e.blockId); return; }
      // 拖放结束：无论代码是否还在（Blockly 可能已原生删除它），都必须先撤掉删除提示
      var wasArmed = armed, hit = overToolbox(lastX, lastY);
      draggingBlock = null; clearHint();
      var b = ws.getBlockById(e.blockId);
      // 代码仍存在且确实释放在左侧栏上 => 主动删除；已被 Blockly 原生删除则不再处理
      if (b && wasArmed && hit) setTimeout(function () {
        // 与长按删除同一原因：打成撤销组，保证撤销后连接/位置完整恢复
        var g = 'del_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        B.Events.setGroup(g);
        try { try { b.dispose(true); } finally { B.Events.setGroup(false); } } catch (err) { B.Events.setGroup(false); }
        autosave();
      }, 0);
    });
    // 再兜底：拖动中的代码若被任何路径删除（原生删除/剪切），提示立即消失
    ws.addChangeListener(function (e) {
      if (draggingBlock && (e.type === B.Events.BLOCK_DELETE || e.type === B.Events.BLOCK_DRAG && !e.isStart)) clearHint();
    });
  }
  function saveCurrentWs(closeOverlays) {
    if (!state.wsInited || !state.ws) return;
    // **先**记下"看到哪儿了"再做别的：recordZoom / 收起浮层都可能触发 resize 把画布重新居中，
    // 那时再抓就抓到居中后的位置了（实测就是这个顺序问题让"切页记住位置"失效）。
    if (true) {
      try {
        var s0 = curScreen();
        if (s0) s0.view = { x: Math.round(state.ws.scrollX || 0), y: Math.round(state.ws.scrollY || 0),
                            scale: state.ws.getScale ? state.ws.getScale() : 1 };
      } catch (e) {}
    }
    try { if (closeOverlays) closeBlocksOverlays(); } catch (e) {}
    try { recordZoom(true); } catch (e) {}   // 离开代码页/运行/导出前一并保存缩放（失败也不能挡住下面的保存）
    try { curScreen().blocksXml = B.utils.xml.domToText(B.Xml.workspaceToDom(state.ws)); } catch (e) {}
  }
  function loadScreenToWs(s) {
    if (!state.wsInited || !state.ws) return;
    loadingWs = true;
    // 试运行返回时带回运行前视口，加载后精确还原；否则正常居中
    var vpRestore = null;
    try { var v = localStorage.getItem('__previewViewport'); if (v) { vpRestore = JSON.parse(v); } } catch (e) {}
    try {
      state.ws.clear();
      clearRailActive();
      state.ws.setScale(vpRestore ? vpRestore.scale : savedBlockScale());
      var dom = B.utils.xml.textToDom(s.blocksXml || '<xml xmlns="https://developers.google.com/blockly/xml"></xml>');
      migrateEventHatXml(dom);
      // 顺手治好以前被 AI 面板"只读预览"写脏的作品：那些代码带着 movable/editable/deletable="false"，
      // 在画布里是拖不动的（用户反馈"AI 生成的代码根本拖不动、一拖整个画布跟着跑"）。
      aiUnfreezeXml(dom);
      B.Xml.domToWorkspace(dom, state.ws);
      // 优先级：这个页面自己记住的视角 > 试运行带回来的视口 > 居中。
      // （以前试运行的 __previewViewport 优先，一旦它没被及时清掉，切页面时就永远按它走、
      //   于是"每页各自记住位置"失效——实测踩过。）
      var 有自记 = !!(s.view && isFinite(s.view.x) && isFinite(s.view.y));
      if (有自记) {
        state.__skipScrollCenter = true;
        state.__restoringView = true;
        setTimeout(function () { state.__restoringView = false; }, 1400);
        var v = s.view;
        var myTok = ++viewHoldToken;
        var doRestoreScreen = function () {
          if (myTok !== viewHoldToken) return;   // 用户一动画布就不再补套（避免拖动时被拽回去）
          套用视角(function () {
            try { state.ws.setScale(v.scale || 1); state.ws.scroll(v.x, v.y); } catch (e) {}
          });
        };
        try { localStorage.removeItem('__previewViewport'); } catch (e) {}
        // 装载/resize 都是异步的，补几次（幂等）——否则后面一次 resize 的居中会把位置抢走
        requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(doRestoreScreen, 120); }); });
        // 装载/resize 是一串异步操作，补到布局彻底稳定之后（幂等，位置对了再写一次也无害）
        [260, 520, 900, 1500, 2400].forEach(function (t) { setTimeout(doRestoreScreen, t); });
      } else if (vpRestore) {
        try { localStorage.removeItem('__previewViewport'); } catch (e) {}
        state.__skipScrollCenter = true;
        // 代码装载与 showView 的 resize 都是异步的，延迟到它们全部完成后再精确定位，
        // 否则会被后续 scrollCenter/resize 覆盖
        var doRestore = function () {
          套用视角(function () {
            try { state.ws.setScale(vpRestore.scale); state.ws.scroll(vpRestore.x, vpRestore.y); } catch (e) {}
          });
        };
        requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(doRestore, 120); }); });
      } else {
        state.ws.scrollCenter();
      }
    } catch (e) { console.error('loadWs', e); try { state.ws.clear(); } catch (x) {} }
    // Blockly 的创建事件是异步派发的（单个 setTimeout(0)），用双宏任务确保装载事件全部派发完再解除抑制，
    // 避免“跳转代码默认目标”等新建监听器篡改从工程里加载出来的代码
    finally { setTimeout(function () { setTimeout(function () { loadingWs = false; }, 0); }, 0); }
    requestWsResize();
    reflowFlyoutSoon();   // setScale 不会触发浮层重排，手动补一次，防止裁切
  }
  function genCode(screen) {
    var ws = new B.Workspace(); window.__codegenScreen = screen;
    try {
      var dom = B.utils.xml.textToDom(screen.blocksXml || '<xml/>');
      migrateEventHatXml(dom);
      B.Xml.domToWorkspace(dom, ws);
      // 仅事件帽子块作为入口生成；散落代码不执行
      return (window.generateEventCode ? window.generateEventCode(ws) : (B.JavaScript.workspaceToCode(ws) || '')) || '';
    } catch (e) { console.error('genCode', e); return ''; }
    finally { ws.dispose(); window.__codegenScreen = null; }
  }
  function buildOutput() {
    saveCurrentWs(true);
    var p = clone(state.project);
    p.appName = ($('appName').value || '我的应用').trim();
    p.startScreen = p.screens[0].id;
    p.screens.forEach(function (s) { s.code = genCode(s); });
    return p;
  }
  /**
   * 外来作品（别人分享的 .fast、社区下载的）一律把 `code` **按代码块重新生成一遍**。
   *
   * 为什么必须做（2026-09-26 漏洞扫描发现的真问题，属于高危）：
   *   运行时是 `new Function('RT', sc.code || '')(RT)`（runtime.js 1578 行）——
   *   直接执行页面里那段字符串。而 `.fast` 里是带着 `code` 字段的，
   *   **分享者可以把它改成任意 JS**：别人一「运行」就在对方手机上执行了分享者的代码。
   *   而这个 WebView 里挂着原生桥（能读写文件、装应用、发网络请求），后果不止是弹窗。
   *   正版作品里的 `code` 本来就是编辑器从代码块生成的**缓存**，
   *   所以这里按 `blocksXml` 重算一遍：合法作品行为完全不变，夹带私货的当场被洗掉。
   *   `genCode` 自带兜底：代码块解析不了就返回空串 —— 宁可什么都不跑，也不跑来路不明的代码。
   *
   * 注意：AI 那条线本来就不写 `screen.code`（全代码里只有 buildOutput 会写，见审计脚本），
   * 这里堵的是"别人给你的作品文件"这条路。
   */
  function 洗掉外来代码(proj) {
    try {
      ((proj && proj.screens) || []).forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        var 净 = '';
        try { 净 = genCode(s) || ''; } catch (e) { 净 = ''; }
        s.code = 净;
      });
    } catch (e) {}
    return proj;
  }

  /* ---------------- 视图切换（设计 / 代码）；拖动布局是独立全屏界面 ---------------- */
  function showView(which) {
    state.view = which;
    $('viewDesign').classList.toggle('hidden', which !== 'design');
    $('viewBlocks').classList.toggle('hidden', which !== 'blocks');
    $('tabDesign').classList.toggle('on', which === 'design');
    $('tabBlocks').classList.toggle('on', which === 'blocks');
    // 滑块位置**只由视图状态决定**：当场同步一次，下一帧再同步一次。
    // 只同步一次不够：切换当帧容器可能还没量到宽高，滑块就留在上一次的位置，
    // 表现是"页签/滑块在代码、下面却是设计页的控件列表"（用户真机截到过）。
    同步分段药丸();
    requestAnimationFrame(function () { 同步分段药丸(); });
    if (which === 'blocks') {
      initWorkspace();
      // 新增/删除控件类型后，按工程实际用到的控件刷新工具箱（没有该类控件就隐藏对应分类）
      var usedTypes = new Set();
      ((state.project && state.project.screens) || []).forEach(function (s) { (s.components || []).forEach(function (c) { if (c && c.type) usedTypes.add(c.type); }); });
      try {
        if (state.ws) {
          // 工具箱内容没变就别再 updateToolbox —— 它会把工具箱重置、浮层被迫关一次，
          // 于是"关掉再打开"看上去就是闪一下（用户反馈点「代码」就闪）
          var tbXml = window.buildToolboxXml(usedTypes);
          if (tbXml !== state.tbXmlLast) { state.tbXmlLast = tbXml; state.ws.updateToolbox(tbXml); }
          buildCategoryRail(state.ws);
        }
      } catch (e) {}
      refreshCompDropdowns();   // 把控件改名/增删后的最新名称同步到代码下拉
      // 工作区从隐藏切到显示后，zelos 字段文本节点需在“可见 + resize 完成”后再刷新一次才稳定（多帧兜底）
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { requestWsResize(); refreshCompDropdowns(); setTimeout(refreshCompDropdowns, 90); });
      });
    } else {
      closeBlocksOverlays();    // 离开代码页：收起分类浮层/控件下拉/齿轮框，避免残留在设计页
    }
  }

  /* 进入独立全屏布局界面：保存代码，按项目方向物理旋转，让竖屏项目真正竖屏 */
  function openLayout() {
    if (!state.project) return;
    saveCurrentWs(true);
    state.inLayout = true;
    var bl = $('btnLayout'); if (bl) bl.classList.add('on');
    closeMenus();
    $('viewLayout').classList.remove('hidden');
    if (window.Native && Native.setLayoutChrome) Native.setLayoutChrome(true);   // 与运行时一致的系统栏/安全区
    // 布局页始终隐藏通知栏（通知栏开关只在试运行/打包APK时生效）
    state.layoutOriented = null;              // 每次进来都按「如何预览」重新定方向
    applyLayoutOrient();
    if (window.Native && Native.setStatusBar) Native.setStatusBar(false);
    renderLayout();
    watchStageResize();     // 可用区尺寸一变就重算舞台（控制台展开/收起、旋转、窗口变化）
    // 物理旋转是异步的，多帧 + 旋转后的 resize 都会再 fit 并捕获真机设计尺寸（见全局 resize 监听）
    requestAnimationFrame(function () { requestAnimationFrame(fitStage); setTimeout(fitStage, 260); setTimeout(fitStage, 480); setTimeout(fitStage, 800); });
  }
  /* 返回编辑器：恢复横屏，隐藏布局屏 */
  function closeLayout() {
    state.inLayout = false;
    state.layoutOriented = null;
    var bl = $('btnLayout'); if (bl) bl.classList.remove('on');
    closeSheet();
    closeMenus();
    $('viewLayout').classList.add('hidden');
    if (window.Native && Native.setLayoutChrome) Native.setLayoutChrome(false);  // 恢复编辑器全屏沉浸
    if (window.Native && Native.setOrientation) Native.setOrientation('landscape');
      // 回到设计页要按**最新坐标**重画一遍（以前要再点一下控件才更新）
      try { renderCompList(); } catch (e) {}
      try { renderPropPanel(); } catch (e) {}
    requestAnimationFrame(requestWsResize);
  }

  /**
   * 按「如何预览」把布局页的物理方向转到位。
   * · auto         → 用当前页面自己的方向（换页要重新算，这是用户报的那个 bug）
   * · 竖屏 / 横屏   → 强制，即使页面设的是另一边
   * 方向没变就不重复下发，免得真机上转两次。
   */
  function applyLayoutOrient() {
    if (!state.inLayout) return;
    var o = layoutOrient();
    if (state.layoutOriented === o) return;
    state.layoutOriented = o;
    try { if (window.Native && Native.setOrientation) Native.setOrientation(o); } catch (e) {}
  }

  /* 系统返回键：逐级返回（弹层 → 代码浮层 → 布局控制台 → 布局页 → 编辑器 → 我的应用），
     只有停在“我的应用”首页时才交还给原生退出，避免一按返回就整个退出。 */
  function maskVisible(id) { var n = $(id); return n && !n.classList.contains('hidden'); }
  window.__rtSystemBack = function () {
    // 1) 各种模态弹窗
    if (maskVisible('colorMask')) { closeColor(null); return true; }
    if (maskVisible('cloudCreateMask')) { closeCloudCreate(); return true; }
    if (maskVisible('cloudManageMask')) { $('cloudManageMask').classList.add('hidden'); return true; }
    if (maskVisible('blocklyDialogMask')) { $('bdCancel').click(); return true; }
    if (maskVisible('confirmMask')) { var cc = $('confirmCancel'); if (cc) cc.click(); return true; }
    if (maskVisible('modalMask')) { hideModal(); return true; }
    if (maskVisible('exportMask')) { $('exportMask').classList.add('hidden'); return true; }
    if (maskVisible('updLogMask')) { $('updLogMask').classList.add('hidden'); return true; }
    // 设置是独立整页，返回键当作"退出设置"（回到打开它的那一页）
    // 诊断信息页压在设置上面，要先关它（关闭后回到设置，不回家）
    if ($('viewDiag') && !$('viewDiag').classList.contains('hidden')) { closeDiagPage(); return true; }
    if ($('viewSettings') && !$('viewSettings').classList.contains('hidden')) { closeSettings(); return true; }
    // 2) 代码：下拉/齿轮设置框/分类浮层
    if (state.view === 'blocks' && state.ws) {
      var flyoutOpen = false;
      try { var fl = state.ws.getFlyout && state.ws.getFlyout(); flyoutOpen = !!(fl && fl.isVisible && fl.isVisible()); } catch (e) {}
      if (flyoutOpen) {
        try { state.ws.hideChaff(); } catch (e) {}
        try { state.ws.closeMutatorBubbles && state.ws.closeMutatorBubbles(); } catch (e) {}
        try { var tb = state.ws.getToolbox && state.ws.getToolbox(); if (tb && tb.clearSelection) tb.clearSelection(); } catch (e) {}
        return true;
      }
    }
    // 3) 顶栏/布局页的下拉菜单
    if ($('screenMenu') && !$('screenMenu').classList.contains('hidden')) { closeMenus(); return true; }
    if ($('moreMenu') && !$('moreMenu').classList.contains('hidden')) { closeMenus(); return true; }
    if ($('layPageMenu') && !$('layPageMenu').classList.contains('hidden')) { closeMenus(); return true; }
    // 4) 拖动布局：先收控制台，再退出布局页
    if (state.inLayout) {
      if ($('laySheet') && $('laySheet').classList.contains('open')) { closeSheet(); return true; }
      closeLayout(); return true;
    }
    // 5) 编辑器内：返回“我的应用”
    if (!$('viewEditor').classList.contains('hidden')) { showHome(); return true; }
    // 6) 已在首页：交还给原生（退出 App）
    return false;
  };
  // 顶部页面下拉按钮文案
  function updateLayPageBtn() {
    var b = $('layPageBtn'); if (b) b.textContent = (curScreen().title || curScreen().id) + ' ▾';
  }

  /* ---------------- 拖动布局视图 ---------------- */
  var layout = { dragId: null };
  function validN(v) { return typeof v === 'number' && isFinite(v); }
  /* 参考“设计画布”逻辑尺寸（兜底）。真机进入拖动布局时会按【本机实际可用宽高比】捕获一份
     project.design（与运行时壳避让状态栏/导航栏后的可用区完全一致），编辑器布局与运行时都用它，
     做到上下左右严格对齐、底部不再莫名留缝。 */
  var DESIGN = { portrait: { w: 390, h: 827 }, landscape: { w: 827, h: 390 } };
  /**
   * 水平居中锁：组件的 `cx` 为真时，x 永远由 (画布宽 - 宽)/2 算出来 ——
   * 改了宽度也会跟着重新居中（用户要求"让控件中心点永远位于中间"）。
   * 注意 x 是**左边缘**，不是中心点，所以居中必须减掉宽度的一半。
   */
  function centeredX(w) {
    var d = designSize();
    var ww = validN(w) ? w : 0;
    return Math.max(0, Math.round((d.w - ww) / 2));
  }
  function applyCenterLock(c) {
    if (!c || !c.cx) return false;
    var w = validN(c.w) ? c.w : defaultSize(c).w;
    c.x = centeredX(w);
    return true;
  }

  /**
   * 估算一个"自动排列"控件此刻所在的 y（按运行时的自动流：padding 16 + 逐个高度 + gap 14）。
   * 用途：把它转成绝对定位时，先落在它本来就在的位置上，视觉上不跳。
   * 绝对定位的控件不占流，累加时要跳过。
   */
  function estimateAutoY(c) {
    var sc = curScreen(); if (!sc) return 0;
    var comps = (sc.components || []);
    var y = 16, gap = 14;
    for (var i = 0; i < comps.length; i++) {
      var x = comps[i];
      if (x === c) return Math.max(0, Math.round(y));
      if (x.hidden) continue;
      if (validN(x.x) || validN(x.y)) continue;             // 绝对定位的不占自动流
      var h = validN(x.h) ? x.h : defaultSize(x).h;
      y += (h || 40) + gap;
    }
    return Math.max(0, Math.round(y));
  }
  function designSize(o) {
    o = o || curOrient();
    var base = o === 'landscape' ? DESIGN.landscape : DESIGN.portrait;
    var p = state.project && state.project.design;
    if (p && p.orientation === o &&
        validN(p.w) && validN(p.h) && p.w >= 240 && p.h >= 240) {
      return { w: Math.round(p.w), h: Math.round(p.h) };
    }
    return base;
  }
  // 依据布局页真实可用区（原生已按系统栏/挖孔留白）捕获设计画布尺寸；返回是否发生变化
  function captureDesign() {
    if (!state.inLayout || !state.project) return false;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!(vw > 50) || !(vh > 50)) return false;
    var landscape = curOrient() === 'landscape';
    if (landscape ? !(vw > vh) : !(vh > vw)) return false;   // 方向还没转到位，不捕获
    var w, h;
    if (landscape) { h = 390; w = Math.round(390 * vw / vh); }
    else { w = 390; h = Math.round(390 * vh / vw); }
    w = Math.max(280, Math.min(w, 1600)); h = Math.max(320, Math.min(h, 1600));
    var p = state.project.design;
    if (p && p.orientation === curOrient() && p.w === w && p.h === h) return false;
    state.project.design = { orientation: curOrient(), w: w, h: h };
    autosave();
    return true;
  }
  function stageScale() { var k = parseFloat($('layStage') && $('layStage').dataset.scale); return isFinite(k) && k > 0 ? k : 1; }
  /**
   * 舞台 = **设计画布本身**（390×827 这种），再等比缩放到可用区里居中显示。
   *
   * 这里原来写的是"舞台直接铺满外层可用区、不缩放"，后果很致命：设计画布 390 宽、
   * 舞台却是整块屏幕（电脑上 1280、手机上也可能因为方向/比例不一致而对不上），
   * 组件按设计像素摆上去就只占左上角一块，**所见和运行时/导出的根本不是一回事**
   * （用户："布局这里有致命问题"）。现在严格按设计尺寸做舞台 + contain 缩放：
   *   · 看到的边界就是手机屏幕边界，拖到边就是拖到底；
   *   · 坐标仍是设计像素（item.style.left 等），与运行时一一对应；
   *   · dataset.scale 记录真实缩放比，指针坐标换算（getBoundingClientRect 除以 k）依旧成立。
   */
  function fitStage() {
    var wrap = document.querySelector('#viewLayout .lay-stage-wrap'), stage = $('layStage'), shell = $('layShell');
    if (!wrap || !stage || !shell || !state.inLayout) return;
    if (wrap.clientWidth < 2 || wrap.clientHeight < 2) return;   // 旋转动画中容器还没好，等 resize
    var changed = captureDesign();                              // 用真机可用区刷新设计画布尺寸
    var pageO = curOrient();                                    // 页面自己的方向 → 决定**画面**怎么排
    var pityO = layoutOrient();                                 // 「如何预览」→ 决定**预览框**什么方向
    var frameLand = pityO === 'landscape';
    shell.classList.toggle('portrait', !frameLand);
    shell.classList.toggle('landscape', frameLand);
    shell.classList.toggle('forced', pityO !== pageO);            // 方向不一样才把设备框画出来
    // 画面方向始终按页面自己标（强制预览不改页面方向，也不改画面排版）
    stage.classList.toggle('portrait', pageO !== 'landscape');
    stage.classList.toggle('landscape', pageO === 'landscape');
    var frame = designSize(pityO);                               // 预览框（设备）尺寸
    var content = designSize(pageO);                             // 页面设计画布尺寸
    // 设备框等比 contain 到可用区（留一点边距，别贴着边）
    var pad = 8;
    var kf = Math.min((wrap.clientWidth - pad * 2) / frame.w, (wrap.clientHeight - pad * 2) / frame.h);
    if (!(kf > 0) || !isFinite(kf)) kf = 1;
    kf = kf * layZoom();     // 「刚好放下」的基准比例 × 用户缩放
    // 画面等比缩进设备框里居中：方向不同（如竖框看横屏页）就上下/左右留边
    var kc = kf * Math.min(frame.w / content.w, frame.h / content.h);
    shell.style.width = frame.w + 'px';
    shell.style.height = frame.h + 'px';
    shell.dataset.scale = String(kf);
    shell.style.transformOrigin = 'top left';
    shell.style.transform = 'scale(' + kf + ')';
    stage.style.width = content.w + 'px';
    stage.style.height = content.h + 'px';
    // 居中必须按**缩放后**的画面尺寸算：画面自己的 transform 是 scale(kc/kf)，
    // 若仍用 content.w/h 去减（设计像素），强制翻转时会整体偏左上（2026-10-28 用户截图报的）。
    var cw = content.w * (kc / kf), ch = content.h * (kc / kf);
    stage.style.left = Math.round((frame.w - cw) / 2) + 'px';
    stage.style.top = Math.round((frame.h - ch) / 2) + 'px';
    stage.dataset.scale = String(kc);                            // 指针坐标换算用**画面**缩放比
    stage.style.transformOrigin = 'top left';
    stage.style.transform = 'scale(' + (kc / kf) + ')';
    // 设备框缩放后视觉尺寸 = 框尺寸 × kf；先居中，再叠加用户平移
    var zw = frame.w * kf, zh = frame.h * kf;
    var px = Number(state.layPanX) || 0, py = Number(state.layPanY) || 0;
    var left = (wrap.clientWidth - zw) / 2 + px, top = (wrap.clientHeight - zh) / 2 + py;
    left = zw <= wrap.clientWidth ? (wrap.clientWidth - zw) / 2 : Math.max(wrap.clientWidth - zw, Math.min(0, left));
    top = zh <= wrap.clientHeight ? (wrap.clientHeight - zh) / 2 : Math.max(wrap.clientHeight - zh, Math.min(0, top));
    shell.style.marginLeft = Math.round(left) + 'px';
    shell.style.marginTop = Math.round(top) + 'px';
    if (changed) renderLayStage();                              // 画布尺寸变化后重新摆放所有组件
  }
  /* ---------------- 布局页：双指缩放 + 单指平移 ----------------
     舞台平时是"等比缩放到刚好放下"，控件小的时候（比如 20×20 的按钮）很难对准。
     现在：双指捏合放大/缩小（相对"刚好放下"的 0.5× ~ 4×），放大后单指拖空白处平移，
     双击空白处回到"刚好放下"。控件坐标换算一律走 stageScale()/getBoundingClientRect，
     所以**缩放之后拖控件依然准**，设计/运行时/导出三处坐标也不会错位。 */
  // 双指缩放的是**控件**、不是画布（用户要求）；画布整体缩放已取消，这里恒为 1
  function layZoom() { return 1; }
  function setLayZoom(z) {
    state.layZoom = Math.max(0.5, Math.min(4, z));
    fitStage();
    return state.layZoom;
  }
  function resetLayZoom() { state.layZoom = 1; state.layPanX = 0; state.layPanY = 0; fitStage(); }
  /* ---------------- 布局页：双指缩放**控件**（不是画布 / 页面） ----------------
     两指按住某个控件往外撑 = 等比放大它，往里收 = 缩小（最小 16px，不超出画布），
     松手写回工程并刷新属性面板 —— 设计页/运行时/导出三处尺寸依然一致。 */
  function wireStageZoom() { return; }   // 双指缩放已按用户要求取消（改成控件右下角的圆弧手柄）
  function 旧wireStageZoom() {
    var wrap = document.querySelector('#viewLayout .lay-stage-wrap');
    if (!wrap || wrap.__zoomWired) return;
    wrap.__zoomWired = true;
    var 点 = {}, d0 = 0, w0 = 0, h0 = 0, 目标 = null, raf = 0;
    function 数() { var n = 0, k; for (k in 点) n++; return n; }
    function 距离() {
      var a = [], k;
      for (k in 点) a.push(点[k]);
      if (a.length < 2) return 0;
      var dx = a[0].x - a[1].x, dy = a[0].y - a[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function 排(fn) { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; fn(); }); }
    function 找组件(id) {
      if (!id) return null;
      var sc = curScreen(); if (!sc) return null;
      var 全部 = [];
      (sc.components || []).forEach(function (c) { 全部.push(c); if (c.children) c.children.forEach(function (k) { 全部.push(k); }); });
      for (var i = 0; i < 全部.length; i++) if (全部[i].id === id) return 全部[i];
      return null;
    }
    function 找控件(e, 用中点) {
      var t = e.target;
      if (!用中点 && t && t.closest) { var it = t.closest('.litem'); if (it) return it; }
      var a = [], k; for (k in 点) a.push(点[k]);
      if (a.length >= 2 && document.elementFromPoint) {
        var m = document.elementFromPoint((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
        if (m && m.closest) { var it2 = m.closest('.litem'); if (it2) return it2; }
      }
      return null;
    }
    wrap.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      点[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (数() < 2 || 目标) return;
      var it = 找控件(e, false) || 找控件(e, true);
      if (!it) return;                                  // 空白处两指：什么都不做（不缩放页面）
      var c = 找组件(it.dataset.id);
      if (!c) return;
      目标 = { item: it, c: c };
      d0 = 距离() || 1; w0 = it.offsetWidth; h0 = it.offsetHeight;
      state.__pinching = true;                          // 拖拽逻辑看到它就不要再挪这个控件
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.cancelable) e.preventDefault();
    });
    wrap.addEventListener('pointermove', function (e) {
      if (点[e.pointerId]) 点[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (!目标 || 数() < 2 || !(d0 > 0)) return;
      var k = 距离() / d0, dsz = designSize();
      var nw = Math.max(16, Math.min(dsz.w, Math.round(w0 * k)));
      var nh = Math.max(16, Math.min(dsz.h, Math.round(h0 * k)));
      var 当前 = 目标;
      排(function () {
        if (!state.inLayout || !当前) return;    // 手指已经抬起来了就别再改
        当前.c.w = nw; 当前.c.h = nh; 当前.c.cx = false;
        当前.item.style.width = nw + 'px';
        当前.item.style.height = nh + 'px';
      });
    });
    function 抬起(e) {
      delete 点[e.pointerId];
      if (数() < 2) d0 = 0;
      if (数() > 0) return;
      state.__pinching = false;
      if (!目标) return;
      var c = 目标.c, id = c.id;
      目标 = null;
      state.selectedCompId = id;
      try { persist(); } catch (err) {}
      try { renderLayStage(); renderLaySheet(); } catch (err) {}
      // 重渲染是异步的（rAF 里摆位）：等它摆完再把手柄贴到新的右下角
      setTimeout(function () {
        try {
          var it = $('layStage') && $('layStage').querySelector('.litem[data-id="' + c.id + '"]');
          var hh = $('layStage') && $('layStage').querySelector('.li-rs[data-for="' + c.id + '"]');
          if (it && hh) 摆手柄(hh, it);
        } catch (err) {}
      }, 60);

    }
    wrap.addEventListener('pointerup', 抬起);
    wrap.addEventListener('pointercancel', 抬起);
  }
  function renderLayout() {
    if (!$('viewLayout')) return;
    fitStage();
    applyPreviewBorder();                                 // 「预览时显示边框」的开关每次进布局页都对齐一次
    wireStageZoom();
    wireLayFabDrag();
    起手柄跟跑();
    var sheet = $('laySheet');
    sheet.classList.remove('open');                       // 进入时默认收起，仅 FAB 展开
    $('viewLayout').classList.remove('console-open');
    $('layFab').classList.add('hidden');
    updateLayPageBtn();
    renderLayStage();
    renderLaySheet();
  }
  // 顶部页面下拉按钮文案（旧的横向滑动页签已移除，统一走下拉）
  // 绝对定位但未填宽高时的“纯类型默认尺寸”：统一由 comp-spec.js 提供
  // （runtime.js 的 defaultBox 取同一份，避免设计页与运行时尺寸走偏）
  function defaultSize(c) {
    return FAST_COMP.sizeOf(c.type);
  }
  // 把 #RRGGBB 调亮(amt>0)/调暗(amt<0)，用于按钮渐变；支持 3 位简写，非法输入回退紫色
  function shadeHex(hex, amt) {
    var s = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-f]{6}$/i.test(s)) s = '6750a4';
    var n = parseInt(s, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function mix(c0) { c0 = amt >= 0 ? Math.round(c0 + (255 - c0) * amt) : Math.round(c0 * (1 + amt)); return Math.max(0, Math.min(255, c0)); }
    function h(c0) { var v = mix(c0).toString(16); return v.length < 2 ? '0' + v : v; }
    return '#' + h(r) + h(g) + h(b);
  }
  function layVisual(c) {
    var d = document.createElement('div');
    if (validN(c.rot) && Number(c.rot) !== 0) { d.style.transform = 'rotate(' + Number(c.rot) + 'deg)'; d.style.transformOrigin = 'center center'; }
    var txt = c.type === 'button' ? (c.text || '按钮')
      : c.type === 'input' ? ((c.inputType === 'password' && c.value) ? '••••••' : (c.hint || '请输入'))
      : c.type === 'text' ? (c.value || '文字')
      : c.type === 'switch' ? (c.text || '开关')
      : c.type === 'checkbox' ? (c.text || '复选项')
      : c.type === 'slider' ? ''
      : c.type === 'progress' ? ''
      : c.type === 'image' ? ''
      : (c.type === 'video' || c.type === 'audio' || c.type === 'web') ? (c.name || (TYPE_META[c.type] && TYPE_META[c.type].label) || '控件')
      : ((c.items && c.items[0]) || '列表');
    if (c.type === 'list') {
      (c.items || []).slice(0, 4).forEach(function (it) { var r = el('div', 'li-row', it || ' '); d.appendChild(r); });
    } else if (c.type === 'image' && c.src) {
      var im = el('img'); im.src = c.src; d.appendChild(im);
    } else if (c.type === 'video' || c.type === 'audio' || c.type === 'web') {
      d.className = 'lv-media';
      var mico = el('span', 'lv-media-ico', c.type === 'video' ? '▶' : (c.type === 'audio' ? '♪' : 'W'));
      d.appendChild(mico);
      d.appendChild(el('span', 'lv-media-tx', txt));
    } else if (c.type === 'select') {
      d.className = 'lv-row lv-between' + (c.variant ? (' lv-select--' + c.variant) : '');
      if (c.bg) d.style.background = c.bg;
      if (c.color) d.style.color = c.color;
      d.appendChild(el('span', 'lv-label', (c.items && c.items[0]) || '选项'));
      var caret = el('span', 'lv-caret', '▾');
      if (c.caretColor) caret.style.color = c.caretColor;
      d.appendChild(caret);
    } else if (c.type === 'radio') {
      (c.items || []).slice(0, 4).forEach(function (it, i) {
        var r = el('div', 'lv-row');
        r.appendChild(el('i', 'lv-radio' + (i === 0 ? ' on' : '')));
        r.appendChild(el('span', 'lv-label', it || ' '));
        d.appendChild(r);
      });
    } else if (c.type === 'date' || c.type === 'time') {
      d.className = 'lv-field';
      d.appendChild(el('span', 'lv-label', c.type === 'date' ? '年 / 月 / 日' : '时 : 分'));
    } else if (c.type === 'stepper') {
      d.className = 'lv-row lv-between';
      d.appendChild(el('span', 'lv-label', c.text || '数量'));
      var st = el('div', 'lv-step');
      st.appendChild(el('i', 'lv-step-b', '−'));
      st.appendChild(el('span', 'lv-step-v', String(c.value == null ? 1 : c.value)));
      st.appendChild(el('i', 'lv-step-b', '+'));
      d.appendChild(st);
    } else if (c.type === 'imgbtn') {
      d.className = 'lv-media';
      d.appendChild(el('span', 'lv-media-ico', '🖼'));
      d.appendChild(el('span', 'lv-media-tx', c.text || '图片按钮'));
    } else if (c.type === 'timer') {
      d.className = 'lv-field lv-timer';
      d.appendChild(el('span', 'lv-label', c.text || '00:00'));
    } else if (c.type === 'canvas') {
      d.className = 'lv-canvas';
      d.appendChild(el('span', 'lv-label', '画布'));
    } else if (c.type === 'container') {
      d.className = 'lv-container';
    } else if (c.type === 'scroll') {
      d.className = 'lv-container lv-scroll';
    } else if (c.type === 'bottomNav') {
      d.className = 'lv-bottomnav';
      var 导航项 = (c.items && c.items.length) ? c.items : ['首页', '消息', '我的'];
      var 导航选 = Math.max(0, Math.min(导航项.length - 1, Number(c.value) || 0));
      // 横排容器本身是真实子元素：布局页只搬子元素，类名留在它身上才不丢排版
      var 导航条 = el('div', 'lv-navbar');
      导航项.slice(0, 5).forEach(function (it, i) {
        导航条.appendChild(el('span', 'lv-nav' + (i === 导航选 ? ' on' : ''), String(it == null ? '' : it)));
      });
      d.appendChild(导航条);
    } else if (c.type === 'table') {
      d.className = 'lv-table';
      var tb = el('table');
      var th = el('tr');
      (c.columns || ['列1', '列2']).forEach(function (cn) { th.appendChild(el('th', null, cn || ' ')); });
      tb.appendChild(th);
      (c.rows || []).slice(0, 4).forEach(function (row) {
        var tr = el('tr');
        (row || []).forEach(function (cell) { tr.appendChild(el('td', null, cell == null ? '' : String(cell))); });
        tb.appendChild(tr);
      });
      d.appendChild(tb);
    } else if (c.type === 'chart') {
      d.className = 'lv-chart';
      var 图 = el('div', 'lv-chart-bars');
      var vals = (c.chartData || []).map(function (p) { return Number(p.value) || 0; });
      var mx = Math.max.apply(null, vals.concat([1]));
      (c.chartData || []).slice(0, 8).forEach(function (p, i) {
        var col = el('div', 'lv-chart-col');
        var bar = el('i', 'lv-chart-bar');
        bar.style.height = Math.max(4, Math.round((Number(p.value) || 0) / mx * 100)) + '%';
        if (c.color) bar.style.background = c.color;
        col.appendChild(bar);
        col.appendChild(el('span', 'lv-chart-lb', p.label || ''));
        col.setAttribute('data-type', c.chartType || 'bar');
        图.appendChild(col);
      });
      d.appendChild(图);
    } else if (c.type === 'card') {
      d.className = 'lv-card';
      d.appendChild(el('span', 'lv-label', c.text || '卡片'));
    } else if (c.type === 'divider') {
      d.className = 'lv-divider';
    } else if (c.type === 'spacer') {
      d.className = 'lv-spacer';
    } else if (c.type === 'tabs') {
      d.className = 'lv-tabs';
      var 页签项 = (c.items && c.items.length) ? c.items : ['页签一', '页签二'];
      var 页签选 = Math.max(0, Math.min(页签项.length - 1, Number(c.value) || 0));
      页签项.slice(0, 5).forEach(function (it, i) {
        d.appendChild(el('span', 'lv-tab' + (i === 页签选 ? ' on' : ''), it || ('页签' + (i + 1))));
      });
    } else if (c.type === 'collapse') {
      d.className = 'lv-collapse' + (c.open ? ' open' : '');
      var 折头 = el('div', 'lv-collapse-h');
      折头.appendChild(el('span', 'lv-label', c.text || '点我展开'));
      折头.appendChild(el('span', 'lv-collapse-a', '▾'));
      d.appendChild(折头);
      if (c.open) d.appendChild(el('div', 'lv-collapse-b', c.body || '这里是内容'));
    } else if (c.type === 'rating') {
      d.className = 'lv-rating';
      if (c.color) d.style.setProperty('--star-on', c.color);
      var 星数 = Math.max(1, Number(c.max) || 5);
      var 星值 = Math.max(0, Math.min(星数, Number(c.value) || 0));
      for (var 星 = 0; 星 < 星数; 星++) d.appendChild(el('span', 'lv-star' + (星 < 星值 ? ' on' : ''), '★'));
    } else if (c.type === 'ring') {
      d.className = 'lv-ring-wrap';
      var 环最大 = Math.max(1, Number(c.max) || 100);
      var 环值 = Math.max(0, Math.min(环最大, Number(c.value) || 0));
      var 环百分比 = 环最大 ? (环值 / 环最大 * 100) : 0;
      var 环 = el('div', 'lv-ring');
      // 尺寸写死成像素：拖动布局的舞台只搬“子元素”，百分比会失去参照物
      环.style.width = (validN(c.w) ? c.w : 120) + 'px';
      环.style.height = (validN(c.h) ? c.h : 120) + 'px';
      环.style.background = 'conic-gradient(' + (c.bg || '#6750a4') + ' 0 ' + 环百分比 + '%, #e7e3ec ' + 环百分比 + '% 100%)';
      环.appendChild(el('i', 'lv-ring-in'));
      环.appendChild(el('span', 'lv-ring-t', Math.round(环百分比) + '%'));
      d.appendChild(环);
    } else if (c.type === 'badge') {
      d.className = 'lv-badge';
      var 徽点 = el('i', 'lv-badge-dot');
      徽点.style.background = c.dot || '#e5484d';
      d.appendChild(徽点);
      d.appendChild(el('span', 'lv-label', c.text || '徽章'));
    } else if (c.type === 'clock') {
      d.className = 'lv-clock';
      d.appendChild(el('span', 'lv-label', 时钟示例(c.format)));
    } else if (c.type === 'qr') {
      d.className = 'lv-qr';
      var 码边 = Math.max(40, Math.min(validN(c.w) ? c.w : 150, validN(c.h) ? c.h : 150));
      var 码盒 = el('div', 'lv-qr-box');
      码盒.style.width = 码边 + 'px'; 码盒.style.height = 码边 + 'px';
      try {
        码盒.innerHTML = (window.FAST_QR && c.value) ? window.FAST_QR.svg(c.value, 码边, c.color || '#000000', c.bg || '#ffffff') : '';
      } catch (e) { 码盒.innerHTML = ''; }
      if (!码盒.firstChild) 码盒.appendChild(el('span', 'lv-qr-ph', '二维码'));
      d.appendChild(码盒);
    } else if (c.type === 'multiSelect') {
      d.className = 'lv-select lv-multi';
      var 多选值 = Array.isArray(c.value) ? c.value
        : String(c.value == null ? '' : c.value).split(/[,，、\n]/).filter(function (s) { return s !== ''; });
      d.appendChild(el('span', 'lv-label', 多选值.length ? 多选值.join('、') : '请选择'));
      d.appendChild(el('span', 'lv-caret', '▾'));
    } else if (c.type === 'dateRange') {
      d.className = 'lv-daterange';
      d.appendChild(el('span', 'lv-date', c.start || '开始日期'));
      d.appendChild(el('span', 'lv-dr-sep', '至'));
      d.appendChild(el('span', 'lv-date', c.end || '结束日期'));
    } else if (c.type === 'colorPicker') {
      d.className = 'lv-color';
      var 色块 = el('i', 'lv-color-sw');
      色块.style.background = c.value || '#6750a4';
      d.appendChild(色块);
      d.appendChild(el('span', 'lv-label', String(c.value || '#6750a4')));
      d.appendChild(el('span', 'lv-caret', '▾'));
    } else if (c.type === 'switch') {
      d.className = 'lv-row lv-between';
      d.appendChild(el('span', 'lv-label', txt));
      var sw = el('div', 'lv-sw' + (c.checked ? ' on' : '')); sw.appendChild(el('i', 'lv-knob')); d.appendChild(sw);
    } else if (c.type === 'checkbox') {
      d.className = 'lv-row';
      var ck = el('div', 'lv-ck' + (c.checked ? ' on' : ''), '✓'); d.appendChild(ck);
      d.appendChild(el('span', 'lv-label', txt));
    } else if (c.type === 'slider') {
      d.className = 'lv-rng-wrap';
      var pct = Math.max(0, Math.min(100, ((validN(c.value) ? c.value : 0) - (c.min || 0)) / ((c.max || 100) - (c.min || 0) || 1) * 100));
      var rt = el('div', 'lv-rng'); var rk = el('i', 'lv-rng-knob'); rk.style.left = pct + '%'; rt.appendChild(rk); d.appendChild(rt);
    } else if (c.type === 'progress') {
      d.className = 'lv-prog-wrap';
      var pmax = c.max || 100, pv = Math.max(0, Math.min(pmax, validN(c.value) ? c.value : 0));
      var pf = el('div', 'lv-prog'); var pff = el('i', 'lv-prog-fill'); pff.style.width = (pmax ? (pv / pmax * 100) : 0) + '%'; if (c.bg) pff.style.background = c.bg;
      pf.appendChild(pff); d.appendChild(pf);
    } else if (c.type === 'text') {
      // 文字用真实子元素 .v-text 承载，艺术字（渐变裁剪/霓虹等）才能作用于真实文本节点
      d.appendChild(el('span', 'v-text', txt));
    } else d.textContent = txt;
    // 文字样式目标：text 控件作用在内层 .v-text；其余控件作用在 d 本体
    var th = c.type === 'text' ? d.querySelector('.v-text') : d;
    if (validN(c.fs)) th.style.fontSize = c.fs + 'px';
    if (c.color) th.style.color = c.color;
    if (c.bg && c.type !== 'progress' && c.type !== 'slider' && c.type !== 'switch' && c.type !== 'checkbox' && c.type !== 'ring') d.style.background = c.bg;
    if (validN(c.radius)) d.style.borderRadius = c.radius + 'px';
    if (c.bold) th.style.fontWeight = '700';
    if (c.align) { th.style.textAlign = c.align; if (c.type !== 'text') d.style.textAlign = c.align; }
    if (validN(c.opacity)) d.style.opacity = (Math.max(0, Math.min(100, c.opacity)) / 100).toFixed(3);
    if (c.italic) th.style.fontStyle = 'italic';
    if (c.underline) th.style.textDecoration = 'underline';
    if (validN(c.spacing)) th.style.letterSpacing = c.spacing + 'px';
    if (c.btnStyle) {
      d.classList.add('btn-' + c.btnStyle);
      if ((c.btnStyle === 'outline' || c.btnStyle === 'ghost') && !c.color) d.style.color = '#6750a4';
      if (c.btnStyle === 'gradient') {
        var gbase = c.bg || '#6750a4';
        d.style.setProperty('--g1', shadeHex(gbase, 0.14));
        d.style.setProperty('--g2', shadeHex(gbase, -0.24));
      }
    }
    if (c.artStyle) {
      th.classList.add('art-' + c.artStyle);
      if (c.artStyle === 'neon' && !c.color) th.style.color = '#00bcd4';
    }
    if (c.skin) d.classList.add('skin-' + c.skin);
    return d;
  }
  var layRenderToken = 0;
  /* 控件右下角的圆弧手柄：按住拖 = 随意改宽高（设计像素，最小 16，不超出画布/容器） */
  /* 布局页的悬浮控制按钮：长按 400ms 后可以拖到任意位置（位置记住） */
  function wireLayFabDrag() {
    var fab = $('layFab'); if (!fab || fab.__dragWired) return;
    fab.__dragWired = true;
    var active = false, dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    try {
      var p = JSON.parse(localStorage.getItem('__bb_layfab_v1') || 'null');
      if (p && typeof p.r === 'number' && typeof p.b === 'number') { fab.style.right = p.r + 'px'; fab.style.bottom = p.b + 'px'; }
    } catch (e) {}
    function down(e) {
      active = true; dragging = false;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(fab.style.right) || 0; oy = parseFloat(fab.style.bottom) || 0;
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function move(e) {
      if (!active) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < 6) return;     // 6px 以内算"点一下"，不算拖
        dragging = true; fab.__justDragged = true; fab.classList.add('dragging');
      }
      var v = $('viewLayout'), r = v.getBoundingClientRect();
      var nr = Math.max(6, Math.min(r.width - 64, ox - dx));
      var nb = Math.max(6, Math.min(r.height - 64, oy - dy));
      fab.style.right = Math.round(nr) + 'px';
      fab.style.bottom = Math.round(nb) + 'px';
      e.preventDefault();
    }
    function up() {
      if (!active) return;
      active = false;
      if (!dragging) return;
      dragging = false; fab.classList.remove('dragging');
      setTimeout(function () { fab.__justDragged = false; }, 80);
      try {
        localStorage.setItem('__bb_layfab_v1', JSON.stringify({
          r: Math.round(parseFloat(fab.style.right) || 0), b: Math.round(parseFloat(fab.style.bottom) || 0)
        }));

      } catch (e) {}
    }
    fab.addEventListener('pointerdown', down);
    fab.addEventListener('pointermove', move);
    fab.addEventListener('pointerup', up);
    fab.addEventListener('pointercancel', up);
    fab.addEventListener('click', function (e) {
      if (fab.__justDragged) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  function 加缩放手柄(item, c, 父) {
    if (!item) return;
    var 已有 = $('layStage') && $('layStage').querySelector('.li-rs[data-for="' + c.id + '"]');
    if (已有) { 摆手柄(已有, item); return; }   // 重渲染后把老手柄摆到新位置
    var stage = $('layStage');
    if (!stage) return;
    var h = el('span', 'li-rs');
    h.dataset.for = c.id;
    stage.appendChild(h);          // 挂到舞台上（挂控件里会被 overflow 裁掉 → 看不见圆弧）
    摆手柄(h, item);               // 一建出来就摆到控件右下角
    h.title = '拖动改大小';
    var sx = 0, sy = 0, w0 = 0, h0 = 0, active = false, pid = null;
    function down(e) {
      if (state.__pinching) return;
      active = true; pid = e.pointerId; sx = e.clientX; sy = e.clientY;
      var 活0 = ($('layStage') && $('layStage').querySelector('.litem[data-id="' + c.id + '"]')) || item;
      w0 = 活0.offsetWidth; h0 = 活0.offsetHeight;
      摆手柄(h, 活0);
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); e.stopPropagation();
    }
    function 找活() {   // 重渲染会把元素换掉，每次都重新找一遍（否则圆弧会跑到 0,0 上"消失"）
      var n = $('layStage') && $('layStage').querySelector('.litem[data-id="' + c.id + '"]');
      return n || item;
    }
    function move(e) {
      if (!active || e.pointerId !== pid) return;
      var 活 = 找活();
      var k = stageScale() || 1, dsz = designSize(), maxW, maxH;
      if (父) {
        maxW = validN(父.w) ? 父.w : (parseFloat(活.parentNode.style.width) || 300);
        maxH = validN(父.h) ? 父.h : (parseFloat(活.parentNode.style.height) || 180);
      } else { maxW = dsz.w; maxH = dsz.h; }
      var nw = Math.max(16, Math.min(maxW, Math.round(w0 + (e.clientX - sx) / k)));
      var nh = Math.max(16, Math.min(maxH, Math.round(h0 + (e.clientY - sy) / k)));
      c.w = nw; c.h = nh; c.cx = false;
      活.style.width = nw + 'px'; 活.style.height = nh + 'px';
      摆手柄(h, 活);
      e.preventDefault(); e.stopPropagation();
    }
    function up(e) {
      if (!active || e.pointerId !== pid) return;
      active = false;
      try { persist(); } catch (err) {}
      try { renderLayStage(); renderLaySheet(); } catch (err) {}
      // 重渲染是异步的（rAF 里摆位）：等它摆完再把手柄贴到新的右下角
      setTimeout(function () {
        try {
          var it = $('layStage') && $('layStage').querySelector('.litem[data-id="' + c.id + '"]');
          var hh = $('layStage') && $('layStage').querySelector('.li-rs[data-for="' + c.id + '"]');
          if (it && hh) 摆手柄(hh, it);
        } catch (err) {}
      }, 60);

    }
    h.addEventListener('pointerdown', down);
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  }
  /** 控件已经不在舞台上了，就把它留下的圆弧手柄收掉 */
  function 清孤立手柄() {
    var st = $('layStage'); if (!st) return;
    Array.prototype.slice.call(st.querySelectorAll(':scope > .li-rs')).forEach(function (h) {
      if (!st.querySelector('.litem[data-id="' + h.dataset.for + '"]')) h.remove();
    });
  }
  /* 圆弧手柄"跟跑"：只要在布局页，就每帧把它贴到选中控件的右下角。
     为什么不用事件去跟：控件拖动、自动排列转绝对、属性改尺寸、控制台开合……路径太多，
     漏一条用户就会看到"圆弧不见了/拖不动"。每帧贴一次最省心。 */
  var 跟跑中 = false;
  function 手柄跟跑() {
    if (!state.inLayout) { 跟跑中 = false; return; }
    try {
      var st = $('layStage');
      var h = st && st.querySelector(':scope > .li-rs');
      if (h) {
        var it = st.querySelector('.litem[data-id="' + h.dataset.for + '"]');
        if (it) 摆手柄(h, it); else h.remove();
      }
    } catch (e) {}
    requestAnimationFrame(手柄跟跑);
  }
  function 起手柄跟跑() { if (!跟跑中) { 跟跑中 = true; requestAnimationFrame(手柄跟跑); } }
  /** 把圆弧手柄摆到控件的右下角（舞台坐标系，缩放后也准） */
  function 摆手柄(h, item) {
    var st = $('layStage'); if (!h || !st || !item) return;
    var k = stageScale() || 1;
    var ir = item.getBoundingClientRect(), sr = st.getBoundingClientRect();
    var 尺 = 24;   // 和 CSS 里手柄边长一致：贴到控件右下角的**内侧**，圆弧正好切在边框角上
    h.style.left = Math.round((ir.right - sr.left) / k - 尺) + 'px';
    h.style.top = Math.round((ir.bottom - sr.top) / k - 尺) + 'px';
  }
  function renderLayStage() {
    var sc = curScreen(), stage = $('layStage'), flow = $('layFlow');
    // 清掉旧的可拖动项，保留 flow
    Array.prototype.slice.call(stage.querySelectorAll('.litem')).forEach(function (n) { n.remove(); });
    flow.innerHTML = '';
    var dsz = designSize();
    // 1) 隐藏 flow 复刻运行时 #flow：只有“自动排列”组件占位（绝对定位组件在运行时不占流，
    //    这里也绝不能占位，否则后续自动组件的 Y 坐标会与运行时不一致）
    var mirrors = {};
    sc.components.forEach(function (c) {
      var isAbs = validN(c.x) || validN(c.y);
      if (isAbs) return;
      var m = layVisual(c);
      // 保留 layVisual 自带的 lv-* 布局类（开关/复选/滑块/进度的横向布局靠它），再追加镜像类
      m.classList.add('lmirror', 't-' + c.type);
      var ds = defaultSize(c);
      m.style.width = (validN(c.w) ? c.w : dsz.w - 32) + 'px';
      if (c.type === 'list') {
        // 列表：显式高度优先（与运行时 c.h 一致）；未设时按行高 48 撑开，空列表 56
        m.style.minHeight = (validN(c.h) ? c.h : ((c.items && c.items.length) ? 48 * c.items.length : 56)) + 'px';
      } else if (c.type === 'text') {
        m.style.minHeight = (validN(c.h) ? c.h : 28) + 'px';
      } else {
        m.style.minHeight = (validN(c.h) ? c.h : ds.h) + 'px';
      }
      flow.appendChild(m); mirrors[c.id] = m;
    });
    // 2) 等一帧布局完成后放置项（坐标/尺寸都是设计像素，与运行时一一对应）。
    //    用 token 保证多次调度（fitStage/旋转/属性变更）只有最后一次提交，杜绝幽灵节点。
    var token = ++layRenderToken;
    requestAnimationFrame(function () {
      if (token !== layRenderToken) return;
      var sr = stage.getBoundingClientRect(), k = stageScale();
      if (sr.width < 2 || !(k > 0)) { setTimeout(renderLayStage, 60); return; }   // 舞台还没布局好，稍后重试
      Array.prototype.slice.call(stage.querySelectorAll('.litem')).forEach(function (n) { n.remove(); });
      sc.components.slice().reverse().forEach(function (c) {
        var item = el('div', 'litem t-' + c.type + (c.id === state.selectedCompId ? ' sel' : '') + (c.visible === false ? ' is-hidden' : ''));
        item.dataset.id = c.id;
        var visual = layVisual(c);
        // 把视觉样式（字号/颜色/背景/圆角/加粗/对齐/透明度/文字装饰）从中间节点带到可拖动项，避免预览丢样式
        var vs = visual.style;
        ['fontSize', 'color', 'background', 'borderRadius', 'fontWeight', 'textAlign', 'opacity',
         'fontStyle', 'textDecoration', 'letterSpacing', 'transform'].forEach(function (p) { if (vs[p]) item.style[p] = vs[p]; });
        ['--g1', '--g2', '--star-on'].forEach(function (rv) {
          var gv = visual.style.getPropertyValue(rv); if (gv) item.style.setProperty(rv, gv);
        });
        // 个性化特效类（按钮风格/艺术字/容器外观）同步到可拖动项
        ['btn-glass', 'btn-outline', 'btn-ghost', 'btn-gradient', 'btn-capsule', 'btn-shadow',
         'skin-glass', 'skin-outline', 'skin-shadow',
         'art-stroke', 'art-shadow', 'art-neon', 'art-gradient', 'art-emboss'].forEach(function (cl) {
          if (visual.classList.contains(cl)) item.classList.add(cl);
        });
        while (visual.firstChild) item.appendChild(visual.firstChild);
        item.appendChild(el('span', 'li-tag', compName(c) + (c.visible === false ? '（已隐藏）' : '')));
        var ds = defaultSize(c);
        var auto = mirrors[c.id], ar = auto ? auto.getBoundingClientRect() : null;
        var arx = ar ? (ar.left - sr.left) / k : 0, ary = ar ? (ar.top - sr.top) / k : 0;
        var arw = ar ? ar.width / k : ds.w, arh = ar ? ar.height / k : ds.h;
        var isAbs = validN(c.x) || validN(c.y);
        var x, y, w, h;
        if (isAbs) {
          // 绝对定位：原点=画布边框(0,0)，与运行时 #screen 一致；缺省轴按 0（画布边缘）
          x = validN(c.x) ? c.x : 0; y = validN(c.y) ? c.y : 0;
          w = validN(c.w) ? c.w : ds.w; h = validN(c.h) ? c.h : ds.h;
          if (c.cx) { x = Math.round((dsz.w - w) / 2); c.x = x; }   // 居中锁：渲染时也保证在中点
        } else {
          // 自动排列：完全采用镜像测量，保证和运行时一致
          x = arx; y = ary; w = arw; h = arh;
        }
        item.style.left = Math.round(x) + 'px'; item.style.top = Math.round(y) + 'px';
        item.style.width = Math.round(w) + 'px'; item.style.height = Math.round(Math.max(h, c.type === 'text' ? 24 : 8)) + 'px';
        if (validN(c.radius)) item.style.borderRadius = c.radius + 'px';
        bindLitemDrag(item, c);
          if (c.id === state.selectedCompId) 加缩放手柄(item, c);
        stage.appendChild(item);
        // 容器 / 滚动区：把子控件嵌在里面画出来（相对坐标，和运行时完全一样）
        if (是容器(c) && c.children && c.children.length) {
          item.classList.add('has-kids');
          c.children.forEach(function (k) {
            var ci = el('div', 'litem litem-kid t-' + k.type + (k.id === state.selectedCompId ? ' sel' : ''));
            ci.dataset.id = k.id;
            var cv = layVisual(k);
            ['fontSize', 'color', 'background', 'borderRadius', 'fontWeight', 'textAlign', 'opacity',
             'fontStyle', 'textDecoration', 'letterSpacing', 'transform'].forEach(function (p) { if (cv.style[p]) ci.style[p] = cv.style[p]; });
            while (cv.firstChild) ci.appendChild(cv.firstChild);
            ci.appendChild(el('span', 'li-tag', compName(k)));
            var kds = defaultSize(k);
            ci.style.left = Math.round(validN(k.x) ? k.x : 0) + 'px';
            ci.style.top = Math.round(validN(k.y) ? k.y : 0) + 'px';
            ci.style.width = Math.round(validN(k.w) ? k.w : kds.w) + 'px';
            ci.style.height = Math.round(Math.max(validN(k.h) ? k.h : kds.h, k.type === 'text' ? 24 : 8)) + 'px';
            if (validN(k.radius)) ci.style.borderRadius = k.radius + 'px';
            bindLitemDrag(ci, k, c);
              if (k.id === state.selectedCompId) 加缩放手柄(ci, k, c);
            item.appendChild(ci);
          });
        }
      });
    });
  }
  function bindLitemDrag(item, c, 父) {
    var sx = 0, sy = 0, moved = false, active = false, pid = null;
    var lx = 0, ly = 0;                              // 最后一次指针位置（松手时判落点用）
    var 落点容器 = null;
    var 拖0x = 0, 拖0y = 0, 尺寸w = 0, 尺寸h = 0;      // 起拖时控件在舞台坐标系里的位置/尺寸
    var 在父内 = !!父, 父节点 = null;                  // 容器里的子控件：现在挂不挂在父容器上
    var wasAuto = !(validN(c.x) || validN(c.y));   // 自动排列组件被拖后转绝对定位，但保持当前形状不变
    /* 指针底下是哪个容器：摸之前先把被拖的这块临时"隐身"，否则永远只摸到自己 */
    function 指到的容器(x, y) {
      if (父) return null;                          // 已经在容器里的不搬家
      item.style.pointerEvents = 'none';
      var n = document.elementFromPoint(x, y);
      item.style.pointerEvents = '';
      var li = n && n.closest ? n.closest('.litem') : null;
      if (!li || !li.dataset.id || li.dataset.id === c.id) return null;
      var 源 = 找控件(li.dataset.id);
      if (!源) return null;
      if (源.parent) return 源.parent;
      return 是容器(源.c) ? 源.c : null;
    }
    function 高亮容器(容器) {
      var st = $('layStage');
      if (!st) return;
      Array.prototype.forEach.call(st.querySelectorAll('.litem.drop-in'), function (n) { n.classList.remove('drop-in'); });
      if (!容器) return;
      var li = st.querySelector('.litem[data-id="' + 容器.id + '"]');
      if (li) li.classList.add('drop-in');
    }
    function down(e) {
      if (state.__pinching) return;                       // 缩放中第二根手指不要再启动拖动
      // 容器里的子控件：**别让这一下冒泡到父容器**，否则父容器也会开始拖动并抢走指针捕获，
      // 结果是"拖子控件，动的却是整个容器"（2026-10-29 抓到的）
      if (父) e.stopPropagation();
      try { item.setPointerCapture(e.pointerId); } catch (err) {}
      pid = e.pointerId; sx = e.clientX; sy = e.clientY;
      lx = e.clientX; ly = e.clientY; 落点容器 = null;
      var stageEl = $('layStage'), k = stageScale();
      var sr = stageEl.getBoundingClientRect(), ir = item.getBoundingClientRect();
      拖0x = (ir.left - sr.left) / k; 拖0y = (ir.top - sr.top) / k;
      尺寸w = item.offsetWidth; 尺寸h = item.offsetHeight;
      if (父) {
        父节点 = (item.parentNode && item.parentNode.classList && item.parentNode.classList.contains('litem'))
          ? item.parentNode : stageEl.querySelector('.litem[data-id="' + 父.id + '"]');
        在父内 = !!(父节点 && item.parentNode === 父节点);
      }
      moved = false; active = true; item.classList.add('dragging'); e.preventDefault();
    }
    function move(e) {
      if (state.__pinching) { active = false; item.classList.remove('dragging'); return; }   // 双指缩放期间不许挪控件
      if (!active || e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        if (!moved && wasAuto && !父) {
          // 关键：开始自由拖动的瞬间，把屏幕上所有“自动排列”控件按当前画面位置/尺寸一次性固化为
          // 绝对定位（含被拖控件自己）。这样拖走其中一个时，其余控件原地不动、不再突然补位；
          // 运行时所有控件都按同一组坐标渲染，与现在所见完全一致。
          var stage0 = $('layStage'), sr0 = stage0.getBoundingClientRect(), k0 = stageScale();
          var byId = {};
          Array.prototype.forEach.call(stage0.querySelectorAll('.litem'), function (n) { byId[n.dataset.id] = n; });
          curScreen().components.forEach(function (cp) {
            if (validN(cp.x) || validN(cp.y)) return;          // 已是绝对定位，保持
            var n = byId[cp.id]; if (!n) return;
            var r = n.getBoundingClientRect();
            cp.x = Math.round((r.left - sr0.left) / k0);
            cp.y = Math.round((r.top - sr0.top) / k0);
            cp.w = Math.round(r.width / k0);
            cp.h = Math.round(r.height / k0);
          });
          wasAuto = false;
        }
        moved = true;
      }
      if (!moved) return;
      var k = stageScale(), stageEl = $('layStage');
      var sw = stageEl.offsetWidth, sh = stageEl.offsetHeight;   // 按舞台实际尺寸限制，拖不出舞台
      var nx = Math.max(0, Math.min(sw - 尺寸w, 拖0x + dx / k));
      var ny = Math.max(0, Math.min(sh - 尺寸h, 拖0y + dy / k));
      // 容器里的子控件：还在父框里就按相对坐标限制；手指拖出父框 8px 以上 → 脱离父框跟手走，松手就移出
      if (父 && 父节点) {
        var pr = 父节点.getBoundingClientRect();
        var sr = stageEl.getBoundingClientRect();
        var 出界 = e.clientX < pr.left - 8 || e.clientX > pr.right + 8 || e.clientY < pr.top - 8 || e.clientY > pr.bottom + 8;
        var p0x = (pr.left - sr.left) / k, p0y = (pr.top - sr.top) / k;
        /* 拖出父框时**不能把子控件挪到别的节点上**：元素一旦离开文档，浏览器会立刻收回指针捕获，
           后面的 pointermove / pointerup 就收不到了 —— 用户看到的就是"拖出去松手没反应"。
           改成让父框临时不再裁剪（overflow:visible）并抬高层级，子控件就能"露"到框外，DOM 结构始终不动。 */
        if (出界 === 在父内) {
          在父内 = !出界;
          父节点.classList.toggle('drop-out', !在父内);
          父节点.style.overflow = 在父内 ? '' : 'visible';
          父节点.style.zIndex = 在父内 ? '' : '30';
          item.style.zIndex = 在父内 ? '' : '31';
        }
        if (在父内) {
          var rx = Math.max(0, Math.min(父节点.offsetWidth - 尺寸w, nx - p0x));
          var ry = Math.max(0, Math.min(父节点.offsetHeight - 尺寸h, ny - p0y));
          item.style.left = Math.round(rx) + 'px'; item.style.top = Math.round(ry) + 'px';
        } else {
          // 父框外：坐标还是相对父框的（负值很正常），松手时再加回父框原点就是舞台坐标
          item.style.left = Math.round(nx - p0x) + 'px'; item.style.top = Math.round(ny - p0y) + 'px';
        }
        try { var 子手 = $('layStage') && $('layStage').querySelector('.li-rs[data-for="' + c.id + '"]'); if (子手) 摆手柄(子手, item); } catch (e3) {}
        e.preventDefault();
        return;
      }
      item.style.left = Math.round(nx) + 'px'; item.style.top = Math.round(ny) + 'px';
      lx = e.clientX; ly = e.clientY;
      // 拖到容器框上就点亮它，松手直接放进去（放进去后坐标由容器接管）
      落点容器 = 指到的容器(lx, ly);
      高亮容器(落点容器);
        try { var 手 = $('layStage') && $('layStage').querySelector('.li-rs[data-for="' + c.id + '"]'); if (手) 摆手柄(手, item); } catch (e2) {}
      e.preventDefault();
    }
    function up(e) {
      if (!active || (e && e.pointerId !== pid)) return;
      active = false; pid = null; item.classList.remove('dragging');
      高亮容器(null);
      if (父节点) {
        父节点.classList.remove('drop-out');
        父节点.style.overflow = ''; 父节点.style.zIndex = '';   // 撤掉拖动时的临时裁剪/层级
      }
      item.style.zIndex = '';
      if (moved) {
        // —— 容器里的子控件：框内改位置 / 拖到框外就移出容器 ——
        if (父 && 父节点) {
          if (!validN(c.w)) c.w = Math.round(尺寸w);
          if (!validN(c.h)) c.h = Math.round(尺寸h);
          if (!在父内) {
            // 子控件的 left/top 一直是"相对父框"的，先加回父框原点换算成舞台坐标
            var pr1 = 父节点.getBoundingClientRect(), sr1 = $('layStage').getBoundingClientRect(), k1 = stageScale();
            var 舞台x = Math.round((parseFloat(item.style.left) || 0) + (pr1.left - sr1.left) / k1);
            var 舞台y = Math.round((parseFloat(item.style.top) || 0) + (pr1.top - sr1.top) / k1);
            移出容器(c.id);
            c.x = Math.max(0, 舞台x); c.y = Math.max(0, 舞台y);
            c.cx = false;
            state.selectedCompId = c.id;
            $('layFab').classList.remove('hidden');
            autosave(); renderLayStage(); renderLaySheet();
            snack('已移出容器');
            return;
          }
          c.x = Math.round(parseFloat(item.style.left)); c.y = Math.round(parseFloat(item.style.top));
          c.cx = false;
          state.selectedCompId = c.id;
          $('layFab').classList.remove('hidden');
          autosave(); renderLayStage(); renderLaySheet();
          return;
        }
        c.x = Math.round(parseFloat(item.style.left)); c.y = Math.round(parseFloat(item.style.top));
        c.cx = false;        // 手动拖动 = 主动放弃"居中锁"（否则拖完又被拉回中间，像拖不动）
        // 松手时压在容器框上 → 收进容器，坐标落在手指位置（减容器原点变成相对坐标）
        var 目标 = 落点容器; 落点容器 = null;
        if (目标) {
          var sr = $('layStage').getBoundingClientRect(), k2 = stageScale();
          var cw = validN(c.w) ? c.w : Math.round(item.offsetWidth / k2);
          var ch = validN(c.h) ? c.h : Math.round(item.offsetHeight / k2);
          c.w = cw; c.h = ch;
          c.x = Math.max(0, Math.round((lx - sr.left) / k2 - cw / 2));
          c.y = Math.max(0, Math.round((ly - sr.top) / k2 - ch / 2));
          if (移入容器(c.id, 目标.id)) {
            state.selectedCompId = c.id;
            $('layFab').classList.remove('hidden');
            autosave(); renderLayStage(); renderLaySheet();
            snack('已放进容器');
            return;
          }
          c.x = Math.round(parseFloat(item.style.left)); c.y = Math.round(parseFloat(item.style.top));
        }
        state.selectedCompId = c.id;
        $('layFab').classList.remove('hidden');
        autosave();
        // 该组件已脱离自动流，其余自动组件会在运行时重新排列；重排舞台让预览立刻与运行时一致
        renderLayStage();
        renderLaySheet();
        return;
      }
      state.selectedCompId = c.id;
      清孤立手柄();
      Array.prototype.forEach.call($('layStage').querySelectorAll('.litem'), function (n) {
        n.classList.toggle('sel', n.dataset.id === c.id);
        var 旧手柄 = $('layStage').querySelector('.li-rs[data-for="' + n.dataset.id + '"]');
        if (n.dataset.id === c.id) { if (!旧手柄) 加缩放手柄(n, c); }
        else if (旧手柄) 旧手柄.remove();
      });
      renderLaySheet();
      // 只选中、不自动弹出控制台；由右下角 FAB 手动展开
      $('layFab').classList.remove('hidden');
    }
    item.addEventListener('pointerdown', down);
    item.addEventListener('pointermove', move);
    item.addEventListener('pointerup', up);
    item.addEventListener('pointercancel', up);
  }
  function renderLaySheet() {
    var c = selectedComp(), title = $('laySheetTitle'), body = $('laySheetBody');
    title.textContent = c ? compName(c) : '未选中组件';
    body.innerHTML = '';
    if (!c) return;
    fillPropFields(body, c, function () {
      // 改属性后：标题同步、舞台实时更新（不重建选中态）
      title.textContent = compName(c);
      renderLayStage();
    }, function () { renderLayStage(); renderLaySheet(); });
  }
  /**
   * 重新按"当前可用区"摆舞台。
   *
   * 坑：右侧属性面板开关时，外层可用区宽度是**带动画（240ms）变化的** ——
   * 只在下一帧量一次的话，量到的还是动画前的宽度；而动画结束后又没人再量，
   * 舞台就永久停在"另一半"的尺寸上（用户截图：关掉面板后画布缩成左上角一小块）。
   * 所以这里在几个时间点各校一次，并配合 ResizeObserver 兜底。
   */
  function fitStageSoon() {
    if (window.requestAnimationFrame) requestAnimationFrame(fitStage);
    setTimeout(fitStage, 60);
    setTimeout(fitStage, 200);
    setTimeout(fitStage, 320);      // CSS 过渡 240ms，结束后再校一次
  }
  function openSheet() {
    if (!selectedComp()) return;
    $('laySheet').classList.add('open');
    $('viewLayout').classList.add('console-open');
    $('layFab').classList.add('hidden');
    fitStageSoon();
  }
  function closeSheet() {
    $('laySheet').classList.remove('open');
    $('viewLayout').classList.remove('console-open');
    $('layFab').classList.toggle('hidden', !selectedComp());
    fitStageSoon();
  }
  /** 可用区尺寸一变就重算舞台（旋转、控制台展开/收起、窗口变化都覆盖） */
  function watchStageResize() {
    var wrap = document.querySelector('#viewLayout .lay-stage-wrap');
    if (!wrap || wrap.__aiStageWatched) return;
    wrap.__aiStageWatched = true;
    try {
      if (window.ResizeObserver) {
        var t = null;
        new ResizeObserver(function () {
          if (t) clearTimeout(t);
          t = setTimeout(function () { if (state.inLayout) fitStage(); }, 40);
        }).observe(wrap);
      }
    } catch (e) {}
  }
  function bindLayoutChrome() {
    // 左上角返回编辑器（按钮已删，用系统返回手势）
    var lb = $('layBack'); if (lb) lb.addEventListener('click', closeLayout);
    // 右下角 FAB：点击才展开控制台
    $('layFab').addEventListener('click', function () { renderLaySheet(); openSheet(); });
    // 控制台右上角 ✕ 收起
    $('laySheetClose').addEventListener('click', closeSheet);
    // 顶部页面下拉：切换/新建/删除页面
    var pb = $('layPageBtn');
    if (pb) pb.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('layPageMenu');
      // 布局页是全屏层且 overflow:hidden —— 菜单留在里面会被裁掉（横屏尤其明显）。
      // 挪到 body 下用 fixed 定位，就能真正悬浮在布局页之上。
      try { if (menu && menu.parentNode !== document.body) document.body.appendChild(menu); } catch (err) {}
      buildLayPageMenu();
      toggleMenu(menu, pb);
    });
    // 返回编辑器（以前这个按钮在 HTML 里丢了，进来就出不去）
    var lb = $('layBack');
    if (lb) lb.addEventListener('click', function (e) { e.stopPropagation(); closeLayout(); });
    // 点布局页空白处取消选中（用户 2026-10-29 要求）。
    // 用 pointerdown 而不是 click：拖控件松手时也可能在空白处产生一次 click，会误取消刚拖的那一个。
    var lv = $('viewLayout');
    if (lv) lv.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.litem, .li-rs, button, .lay-sheet, .lay-topbar, input, select, textarea, .menu')) return;
      if (!state.selectedCompId) return;
      state.selectedCompId = null;
      Array.prototype.slice.call($('layStage').querySelectorAll('.li-rs')).forEach(function (h) { h.remove(); });
      Array.prototype.forEach.call($('layStage').querySelectorAll('.litem.sel'), function (n) { n.classList.remove('sel'); });
      $('layFab').classList.add('hidden');
      renderLaySheet();
    });
  }
  function buildLayPageMenu() {
    var menu = $('layPageMenu'); menu.innerHTML = '';
    var list = el('div', 'menu-list');           // 页面很多时仅此处滚动，操作行常驻
    state.project.screens.forEach(function (s) {
      var b = el('button', 'menu-item' + (s.id === state.curScreenId ? ' on' : ''), (s.title || s.id));
      b.addEventListener('click', function () { closeMenus(); switchScreen(s.id); });
      list.appendChild(b);
    });
    menu.appendChild(list);
    var sep = el('div', 'menu-sep'); menu.appendChild(sep);
    var add = el('button', 'menu-item', '＋ 新建页面');
    add.addEventListener('click', function () { closeMenus(); addScreen(); });
    var del = el('button', 'menu-item danger', '删除当前页面');
    del.addEventListener('click', function () { closeMenus(); deleteScreen(); });
    menu.appendChild(add); menu.appendChild(del);
  }

  /* ---------------- 弹层 ---------------- */
  var snackTimer = null;
  function snack(msg) {
    var bar = $('snackbar'); if (!bar) return;
    bar.textContent = msg; bar.classList.add('show');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(function () { bar.classList.remove('show'); }, 2600);
  }
  function modal(title, body, okText, onOk) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = '';
    if (typeof body === 'string') $('modalBody').textContent = body; else $('modalBody').appendChild(body);
    var ok = $('modalOk');
    if (okText) { ok.classList.remove('hidden'); ok.textContent = okText; ok.onclick = onOk; } else ok.classList.add('hidden');
    var ex = $('modalExtra'); ex.classList.add('hidden'); ex.onclick = null; ex.textContent = '备用';
    $('modalMask').classList.remove('hidden');
  }
  /** 配置左下角备用按钮 */
  function modalExtra(text, fn) {
    var ex = $('modalExtra');
    ex.textContent = text; ex.onclick = fn; ex.classList.remove('hidden');
  }
  function hideModal() { 关遮罩($('modalMask')); }

  /* ---------------- 顶栏下拉菜单（popover） ---------------- */
  function closeMenus() {
    ['screenMenu', 'moreMenu', 'layPageMenu', 'runMenu', 'layoutOrientMenu'].forEach(function (id) { var m = $(id); if (m) m.classList.add('hidden'); });
  }
  function positionMenu(menu, anchor) {
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth || 200, mh = menu.offsetHeight || 120;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 8;
    // 水平：默认与按钮左对齐，溢出则右对齐，再整体钳制进视口
    var left = r.left;
    if (left + mw > vw - gap) left = r.right - mw;
    left = Math.max(gap, Math.min(left, vw - mw - gap));
    // 垂直：优先在按钮下方，下方不够则翻到上方
    var top = r.bottom + 4;
    if (top + mh > vh - gap) top = Math.max(gap, r.top - mh - 4);
    menu.style.right = 'auto';
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }
  function toggleMenu(menu, anchor) {
    var willOpen = menu.classList.contains('hidden');
    closeMenus();
    if (willOpen) {
      // 先以不可见状态参与布局以便测量尺寸，定位后再显现，避免一帧错位/溢出
      menu.style.visibility = 'hidden';
      menu.classList.remove('hidden');
      positionMenu(menu, anchor);
      menu.style.visibility = '';
    }
  }
  function buildScreenMenu() {
    var list = $('screenMenuList'); list.innerHTML = '';
    state.project.screens.forEach(function (s) {
      var b = el('button', 'menu-item' + (s.id === state.curScreenId ? ' on' : ''), (s.title || s.id));
      b.addEventListener('click', function () { closeMenus(); switchScreen(s.id); });
      list.appendChild(b);
    });
  }

  /* ---------------- 设置（独立整页：常规 / AI / 反馈，用户 2026-10-29 要求） ---------------- */
  var 设置来源 = 'home';          // 从哪儿打开的：'home' | 'editor'，返回时回到原处
  var UI_ANIM_KEY = '__bb_ui_anim';
  function uiAnimOn() {
    var v = null; try { v = localStorage.getItem(UI_ANIM_KEY); } catch (e) {}
    return v !== '0';             // 默认开
  }
  function applyUiAnim() {
    try { document.body.classList.toggle('no-anim', !uiAnimOn()); } catch (e) {}
  }
  function setUiAnim(on) {
    try { localStorage.setItem(UI_ANIM_KEY, on ? '1' : '0'); } catch (e) {}
    applyUiAnim(); buildSettings();
  }
  var 上次设置分类 = 'general';    // 关掉设置再进来，回到上次看的那一栏（标签和内容才不会对不上）
  function setSettingsCat(cat) {
    if (!cat) cat = 'general';
    上次设置分类 = cat;
    ['general', 'ai', 'feedback'].forEach(function (k) {
      var pane = $('setPane' + (k === 'general' ? 'General' : (k === 'ai' ? 'Ai' : 'Feedback')));
      if (pane) pane.classList.toggle('hidden', k !== cat);
      var b = document.querySelector('#setRail .acct-item[data-cat="' + k + '"]');
      if (b) b.classList.toggle('on', k === cat);
    });
    同步分段药丸();               // 左侧分类的滑块跟着走
  }
  function buildSettings() {
    var th = getTheme(), seedRow = $('seedRow');
    if (!seedRow) return;
    seedRow.innerHTML = '';
    SEEDS.forEach(function (s) {
      var b = el('button', 'seed-swatch' + (s[0].toLowerCase() === th.seed.toLowerCase() ? ' on' : ''));
      b.style.background = s[0]; b.title = s[1]; b.type = 'button';
      b.addEventListener('click', function () { var t = getTheme(); t.seed = s[0]; saveTheme(t); applyTheme(); buildSettings(); });
      seedRow.appendChild(b);
    });
    Array.prototype.forEach.call($('modeSeg').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === th.mode);
      b.onclick = function () { var t = getTheme(); t.mode = b.getAttribute('data-mode'); saveTheme(t); applyTheme(); buildSettings(); };
    });
    // 作品如何排序（默认自动调整）
    var 排序 = getProjSort(), sortSeg = $('setSort');
    if (sortSeg) Array.prototype.forEach.call(sortSeg.children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-sort') === 排序);
      b.onclick = function () { setProjSort(b.getAttribute('data-sort')); };
    });
    // 界面动画
    var 动 = uiAnimOn(), animSeg = $('setAnim');
    if (animSeg) Array.prototype.forEach.call(animSeg.children, function (b) {
      b.classList.toggle('on', (b.getAttribute('data-anim') === 'on') === 动);
      b.onclick = function () { setUiAnim(b.getAttribute('data-anim') === 'on'); };
    });
    var sv = $('setVer');
    if (sv) sv.textContent = '当前版本：' + buildVersion();
  }
  function openSettings(cat) {
    设置来源 = ($('viewEditor') && !$('viewEditor').classList.contains('hidden')) ? 'editor' : 'home';
    buildSettings();
    setSettingsCat(cat || 上次设置分类);
    // 打开设置时把"模型/深度思考"两个控件的显示同步一次 ——
    // 否则上次选了 flash，这里还显示 HTML 里写死的 v4-pro（显示和实际不一致）
    try { aiSyncThinkUI(); } catch (e) {}
    // 打开设置时把 Key 的当前状态显示出来（让用户能确认到底认到了什么）
    try {
      var stt = $('aiKeyStatus');
      var cur = aiKeyRead();
      // 输入框也要同步成「本机存的那份」：否则自动打开设置时输入框是空的，
      // 随后点别处触发 blur，就会用空值盖掉真 Key（曾经把 Key 清掉过）。
      var ki = $('aiKey');
      if (ki && cur && ki.value !== cur) ki.value = cur;
      if (stt) stt.textContent = cur ? ('已保存到本机：' + aiKeyMask(cur)) : '还没有填 Key';
    } catch (e) {}
    var v = $('viewSettings');
    if (v) {
      v.classList.remove('hidden');
      同步分段药丸();   // 页面刚显示出来才能量到尺寸；不重算的话滑块会停在上次那一栏（用户 2026-10-29 报的）
      切页(v, 'fwd');
      requestAnimationFrame(function () { try { 同步分段药丸(); } catch (e) {} });
    }
  }
  function closeSettings() {
    var v = $('viewSettings');
    if (!v || v.classList.contains('hidden')) return;
    v.classList.add('hidden');
    if (设置来源 === 'editor') { var e = $('viewEditor'); if (e) e.classList.remove('hidden'); }
    else { var h = $('viewHome'); if (h) h.classList.remove('hidden'); }
  }

  /* ---------------- 运行 / 导出 ----------------
     mode: 'start' = 从第一个页面（工程起始页）运行；'current' = 从编辑器当前打开的页面运行 */
  // 运行方式（由 ▾ 菜单选择，决定主按钮点下去怎么跑）；持久化记住用户习惯
  var RUN_MODE_KEY = '__bb_run_mode_v1';
  function getRunMode() {
    var m = 'start';
    try { m = localStorage.getItem(RUN_MODE_KEY) || 'start'; } catch (e) {}
    return m === 'current' ? 'current' : 'start';
  }
  function setRunMode(m) {
    state.runMode = (m === 'current' ? 'current' : 'start');
    try { localStorage.setItem(RUN_MODE_KEY, state.runMode); } catch (e) {}
    applyRunMode();
    snack(state.runMode === 'current' ? '当前页面运行' : '从头开始运行');
  }
  function applyRunMode() {
    state.runMode = getRunMode();
    var cur = state.runMode === 'current';
    var ico = $('runMainIco'); if (ico) ico.textContent = cur ? '▶' : '⏮';
    var btn = $('btnRun'); if (btn) btn.title = cur ? '当前页面运行' : '从头开始运行';
    var a = $('runFromStart'), b = $('runCurrent');
    if (a) a.classList.toggle('on', !cur);
    if (b) b.classList.toggle('on', cur);
  }
  /* 通知栏权限（用户方案）：
     进软件 / 点运行都**先检查**，只有在"没有权限"时才弹窗 —— 有权限时什么都不弹。
     先弹系统授权框（Native.askNotif）；系统框不会再弹了（用户拒过）才给"去设置"的弹窗。 */
  var 本次已请求权限 = false;
  /* 自动化测试桩：sessionStorage 里放 {"allowed":false,"asked":0} 就能模拟"没有通知权限"，
     刷新也有效（真机上没有这个键，走下面的原生接口） */
  function 通知测试桩() { try { var t = sessionStorage.getItem('__bbNotifStub'); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function 通知真的可用() {
    var 桩 = 通知测试桩();
    if (桩) return 桩.allowed === true;
    try { if (window.Native && Native.notifAllowed) return Native.notifAllowed() === true; } catch (e) {}
    return true;   // 网页/电脑上没有系统权限这回事，不拦
  }
  function 请求通知权限(显示设置弹窗) {
    var 桩 = 通知测试桩();
    if (桩) {
      桩.asked = (桩.asked || 0) + 1;
      try { sessionStorage.setItem('__bbNotifStub', JSON.stringify(桩)); } catch (e) {}
      本次已请求权限 = true;
      if (显示设置弹窗) openNotifBlocked();
      return;
    }
    var 能要 = false;
    try { 能要 = !!(window.Native && Native.askNotif); } catch (e) {}
    if (能要) { try { Native.askNotif(); } catch (e) {} 本次已请求权限 = true; }
    if (显示设置弹窗 || !能要) openNotifBlocked();
  }
  /* 运行前的「怎么结束」提示（用户 2026-10-28 要求）：
     点「运行」先说清楚 —— 要结束时下滑通知栏、点「终止」，不要再靠侧滑返回
     （侧滑返回已在 runtime.js 里关掉，见 __rtSystemBack）。
     勾「不再提示」后写进本机，以后点运行直接进。
     只在真机（有通知栏卡片）上弹：电脑/浏览器里没有通知栏，说了也没用，反而是干扰。 */
  var RUN_TIP_KEY = '__bb_runTipNever_v1';
  function 运行提示已关() {
    try { return localStorage.getItem(RUN_TIP_KEY) === '1'; } catch (e) { return false; }
  }
  function 要弹运行提示() {
    if (运行提示已关()) return false;
    try { return !!(window.Native && Native.startRunNotice); } catch (e) { return false; }
  }
  function 运行前提示(mode) {
    if (!要弹运行提示()) { doRun(mode); return; }
    var body = el('div', 'run-tip');
    body.appendChild(el('div', 'run-tip-line', '点击运行后，若要结束请下滑通知栏，点击终止即可。'));
    var lab = el('label', 'run-tip-never');
    var cb = document.createElement('input'); cb.type = 'checkbox';
    lab.appendChild(cb);
    lab.appendChild(el('span', '', '不再提示'));
    body.appendChild(lab);
    modal('运行提示', body, '开始运行', function () {
      if (cb.checked) { try { localStorage.setItem(RUN_TIP_KEY, '1'); } catch (e) {} }
      hideModal();
      doRun(mode);
    });
  }
  function onRun(mode) {
    if (通知真的可用()) { 运行前提示(mode); return; }   // 有权限 → （首次）说明怎么结束，然后运行
    if (!本次已请求权限) { 请求通知权限(false); return; }   // 没权限 → 弹系统授权框，本次拒绝运行
    openNotifBlocked();                                // 系统框弹过了还不行为 → 给"去设置"
  }
  function openNotifBlocked() {
    var m = $('notifMask'); if (!m) { doRun('start'); return; }
    m.classList.remove('hidden');
  }
  function closeNotifBlocked() { 关遮罩($('notifMask')); }
  function wireNotifBlocked() {
    var m = $('notifMask'); if (!m) return;
    m.addEventListener('click', function (e) { if (e.target === this) closeNotifBlocked(); });
    if ($('notifCancel')) $('notifCancel').addEventListener('click', closeNotifBlocked);
    if ($('notifGo')) $('notifGo').addEventListener('click', function () {
      try { if (window.Native && Native.openNotifSettings) Native.openNotifSettings(); } catch (e) {}
      closeNotifBlocked();
    });
  }
  /* 首次运行提示（"运行时在通知栏显示卡片？"）已废弃：现在改成没权限时弹系统授权框，
     2026-10-27 把残留的死代码清了（弹窗 HTML、runTipNever 勾选框都已不存在）。 */
  function doRun(mode) {
    var p = buildOutput();      // 内部已 saveCurrentWs，把当前代码写回工程
    persist();                  // 关键：跳转前把工程（含代码）写入 localStorage，返回重载后不丢
    histSnapshot(state.itemId, '运行前');   // 试运行前自动留一份（试崩了能一键回到这里）
    try { localStorage.setItem('__previewProject', JSON.stringify(p)); } catch (e) {}
    // 记住运行前所在页（设计/代码）与所在页面，试运行 history.back 重载后恢复到原处
    try {
      localStorage.setItem('__previewReturnView', state.view || 'design');
      localStorage.setItem('__previewReturnScreen', state.curScreenId || '');
      if (mode === 'current') localStorage.setItem('__previewStartScreen', state.curScreenId || '');
      else localStorage.removeItem('__previewStartScreen');
    } catch (e) {}
    // 记住运行前代码视口，试运行返回后恢复，避免代码整体移位
    try {
      if (state.ws) {
        localStorage.setItem('__previewViewport', JSON.stringify({ x: state.ws.scrollX, y: state.ws.scrollY, scale: state.ws.scale }));
      }
    } catch (e) {}
    // 标记“本次离开是试运行”：仅同进程会话内有效（sessionStorage）。
    // 进程被杀后冷启动该标记消失，编辑器不再自动重开工程，而是停在“所有 App”首页。
    try { sessionStorage.setItem('__fromPreview', '1'); } catch (e) {}
    // 试运行与导出壳保持一致：显示系统栏并按其留白，这样预览/导出/拖动布局三者的可用区完全相同
    if (window.Native && Native.setLayoutChrome) Native.setLayoutChrome(true);
    /**
     * 方向**只能在这里定一次**，而且必须和运行时算出来的是同一个值。
     * 以前这里用"项目方向 p.orientation"，运行时又用"起始页方向 startSc.orientation" ——
     * 两个值不一样时，就出现"先转成竖屏、进了运行时再转成横屏"的抖动
     * （用户："设置横屏，运行时先竖屏再横屏"）。现在两边统一成"起始页方向，回退项目方向"。
     */
    if (window.Native && Native.setOrientation) Native.setOrientation(previewOrient(mode));
    location.href = 'runtime.html';
  }

  /**
   * 试运行时"该请求什么方向"。运行时（runtime.js 的 loadProject）用的是同一个口径：
   * 起始页方向 → 回退项目方向。两处必须一致，否则会出现二次旋转（先竖后横）。
   */
  function previewOrient(mode) {
    var p = state.project || {};
    var screens = p.screens || [];
    var sid = (mode === 'current') ? (state.curScreenId || '')
                                   : (p.startScreen || (screens[0] && screens[0].id) || '');
    var sc0 = null;
    screens.forEach(function (s) { if (s.id === sid) sc0 = s; });
    return (sc0 && sc0.orientation) || p.orientation || 'portrait';
  }

  /* ---------------- 检查更新：读取内置 SeaTable“更新”表，选版本下载安装 ----------------
     凭据同样不进包（见下面账号那段的说明）：走云中转，表 UUID 由 u= 参数指定，服务端白名单只认这一张。 */
  var UPDATE_CFG = {
    server: 'https://cloud.seatable.cn',
    uuid: '5ded0202-5402-4176-bde2-69a5f7c14af6',
    token: '',        // ⚠️ 永远不要往这里填 token；直连路径仅供本地调试，正式包只走中转
    table: '更新'
  };
  var updateLatest = null;   // 只缓存"最新版本"那一行 —— 界面不再列版本列表
  /** 本地构建号："v1.0.116.113" → "1.0.116.113"；开发态（没有构建号）返回空串 */
  function 本地版本号() {
    var v = buildVersion();
    return /^v?\d+\.\d+\.\d+\.\d+$/.test(v) ? v.replace(/^v/, '') : '';
  }
  /** 按点分数字比大小：a>b 返回 1，相等 0，a<b 返回 -1（缺失位按 0 算） */
  function 比版本(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var n = parseInt(x[i], 10) || 0, m = parseInt(y[i], 10) || 0;
      if (n !== m) return n > m ? 1 : -1;
    }
    return 0;
  }
  /** 更新表按行顺序 1A 2B 3C 往下排列，所以"最新的那一行"就是最后一行 */
  function 取最新版本(list) { return (list && list.length) ? list[list.length - 1] : null; }
  function 校验更新提示(ver, 本地) {
    var m = String(ver || '').match(/(\d+\.\d+\.\d+\.\d+)/);
    var mine = (本地 === undefined) ? 本地版本号() : String(本地 || '');
    if (!m) return '最新版本';
    if (!mine) return '云端最新版本 ' + m[1];
    var 比 = 比版本(m[1], mine);
    if (比 === 0) return '你已经在用最新版 ' + m[1] + '（也可以再装一次）';
    if (比 > 0) return '发现新版本 ' + m[1] + '（当前 ' + mine + '）';
    // 云端比本地旧：开发者还没上传新包。明确说出来，别让用户以为是新版本点下去降级。
    return '云端最新是 ' + m[1] + '，比你当前的 ' + mine + ' 还旧（开发者还没上传新包）';
  }
  /** 更新按钮右上角红点：只在云端有新版本时亮；点开「检查更新」后熄灭 */
  function 设更新红点(on) {
    var d = $('updDot');
    if (d) d.classList.toggle('hidden', !on);
    var b = $('btnUpdate');
    if (b) b.title = on ? '检查更新（发现新版本）' : '检查更新';
  }
  /** 云端这一版是不是比本机新（本机是开发态/没有构建号时一律不算） */
  function 有新版本(ver) {
    var m = String(ver || '').match(/(\d+\.\d+\.\d+\.\d+)/);
    var mine = 本地版本号();
    if (!m || !mine) return false;
    return 比版本(m[1], mine) > 0;
  }
  /** 从「更新」表取最新那一行（打开弹窗与后台点亮红点共用这一条路） */
  async function 拉更新最新行() {
    var d, gateway, uuid, resp;
    if (用中转()) {
      d = await editorCloudHttp('GET', 中转链接('/api/v2.1/dtable/app-access-token/'), null, null, { headers: 中转头() });
      if (!d || !d.access_token) throw new Error('鉴权失败');
      resp = await editorCloudHttp('GET', 中转链接('/api/v2/dtables/' + UPDATE_CFG.uuid + '/rows/?table_name=' + encodeURIComponent(UPDATE_CFG.table) + '&u=' + UPDATE_CFG.uuid), null, null, { headers: 中转头() });
    } else {
      d = await editorCloudHttp('GET', UPDATE_CFG.server + '/api/v2.1/dtable/app-access-token/', null, (UPDATE_CFG.token || null));
      if (!d || !d.access_token) throw new Error('鉴权失败');
      gateway = (d.dtable_server || UPDATE_CFG.server + '/api-gateway/').replace(/\/+$/, '');
      uuid = d.dtable_uuid || UPDATE_CFG.uuid;
      resp = await editorCloudHttp('GET', gateway + '/api/v2/dtables/' + uuid + '/rows/?table_name=' + encodeURIComponent(UPDATE_CFG.table), null, d.access_token);
    }
    var list = (resp && resp.rows) || [];
    return list.length ? (取最新版本(list) || null) : null;
  }
  var 更新红点上次查 = 0;      // 上次查云端的时间戳，用来节流
  var 更新红点已看过 = '';     // 用户点开「检查更新」看到的那一版：同一版不再亮红点
  var 更新红点查询中 = false;  // 防止并发重复请求
  /**
   * 背景查更新：有新版本就亮红点；查不到（欠费 / 断网）就静悄悄算了。
   * 以前是「开机查一次，之后再也不查」—— 用户开了很久再回首页就永远看不到红点。
   * 现在开机查一次、每次回首页也查一次，但 10 分钟内不重复查（省流量、也不给云端添压力）；
   * 用户点开过一次「检查更新」后，同一个版本不再亮红点（看过了就不烦人）。
   */
  async function 后台查更新红点() {
    if (更新红点查询中) return;
    var 现在 = Date.now();
    if (更新红点上次查 && 现在 - 更新红点上次查 < 10 * 60 * 1000) return;
    更新红点上次查 = 现在;
    更新红点查询中 = true;
    try {
      var r = await 拉更新最新行();
      var ver = (r && r['0000']) || '';
      设更新红点(!!(r && 有新版本(ver) && ver !== 更新红点已看过));
    } catch (e) {
      设更新红点(false);
    }
    更新红点查询中 = false;
  }
  /* ---- 检查更新 → 更新日志 ----
     云端「更新」表只有版本号 + 附件，没有正文列，所以正文写死在这里最省事。
     发版时只在数组最前面加一条（新的在上、旧的在下），不用动云端表结构。 */
  var CHANGELOG = [
    { v: '1.0.116.139', d: '2026-10-29', t: [
      '首页作品拖动重做：拖动时布局一动不动，卡片只做位移动画，不再乱跳、不再抖',
      '修：设置里点「查看 / 导出诊断信息」会退到首页 —— 现在是独立整页，返回只回设置'
    ] },
    { v: '1.0.116.138', d: '2026-10-29', t: [
      '首页长按拖动：不再顺手改掉「自动调整 / 不调整排序」这个设置',
      '拖动松手后不再整页闪一下',
      '卡片拖到屏幕上下边缘会自动滚屏，底下的作品也能拖过去',
      '拖动跟手和卡片让位重做，不再乱跳',
      '修：从设置返回再进，左侧标签和右侧内容对不上',
      '修：设置里点「查看 / 导出诊断信息」没反应',
      '设置页重新排版：左栏、卡片宽度与间距按手机重新调过',
      '「更新日志」按钮挪到「联系开发者」左边',
      '换头像：去掉几个默认色块头像，只留相册选图'
    ] },
    { v: '1.0.116.137', d: '2026-10-29', t: [
      '预览边框默认改成「显示」',
      '修：预览选「不显示边框」时，容器、徽章仍带着边框',
      '布局页点空白处可取消选中',
      '首页作品卡支持长按拖动调整顺序',
      '去掉首页「所有 App」那行字',
      '设置改为整页：左侧分类（常规 / AI / 反馈），新增「作品如何排序」「界面动画」',
      '检查更新右上角新增「更新日志」'
    ] },
    { v: '1.0.116.136', d: '2026-10-29', t: [
      '容器控件默认透明（和运行时一致）',
      '预览菜单新增「是否显示边框」开关',
      '预览菜单文案与横竖屏选项顺序调整'
    ] },
    { v: '1.0.116.135', d: '2026-10-29', t: [
      '新建控件默认尺寸整体收小，不再一放就占满画面',
      '容器 / 滚动区里的控件可长按拖动换位置，也能拖出来',
      '修：新建的容器会带上别的容器里的子控件',
      '回首页时会重新检查更新（10 分钟最多一次）'
    ] },
    { v: '1.0.116.134', d: '2026-10-29', t: [
      '控件可以拖进容器 / 滚动区',
      '通知权限支持三种状态',
      '布局页按钮去掉多余阴影'
    ] },
    { v: '1.0.116.133', d: '2026-10-29', t: [
      '检查更新：有新版本时首页按钮亮红点',
      '布局页顶部按钮改为连体样式'
    ] }
  ];
  function openUpdateLog() {
    var box = $('updLogList');
    if (!box) return;
    box.innerHTML = '';
    CHANGELOG.forEach(function (it, i) {
      var card = el('div', 'updlog-item');
      var head = el('div', 'updlog-head');
      head.appendChild(el('span', 'updlog-ver', 'v' + it.v));
      head.appendChild(el('span', 'updlog-date', it.d));
      card.appendChild(head);
      var body = el('div', 'updlog-body');
      body.textContent = (it.t || []).join('\n');   // .updlog-body 是 pre-wrap，直接换行最省事
      card.appendChild(body);
      box.appendChild(错峰(card, i));
    });
    $('updLogMask').classList.remove('hidden');
  }
  async function openUpdateDialog() {
    $('updateMask').classList.remove('hidden');
    $('updateStatus').textContent = '正在检查更新…';
    $('updateList').innerHTML = '';
    updateLatest = null;
    $('updateGo').disabled = true;
    设更新红点(false);   // 用户已经点开看了，红点使命结束
    try {
      var r = await 拉更新最新行();
      if (!r) { $('updateStatus').textContent = '暂无更新包'; return; }
      updateLatest = r;
      var ver = r['0000'] || '最新版本';
      更新红点已看过 = String(r['0000'] || '');   // 这一版已经点开看过了，别再亮红点打扰
      var files = r['etRB'] || [];
      var fname = files[0] ? files[0].name : '';
      var card = el('div', 'upd-item sel');
      card.appendChild(el('span', 'upd-ver', ver));
      card.appendChild(el('span', 'upd-file', fname));
      $('updateList').appendChild(card);
      $('updateStatus').textContent = 校验更新提示(ver);
      $('updateGo').disabled = false;
    } catch (e) {
      $('updateStatus').textContent = '检查失败：' + (e.message || '网络错误');
    }
  }
  async function doUpdate() {
    var r = updateLatest;   // 只会是最新版本那一行（界面已经不提供选择）
    if (!r) return;
    var files = r['etRB'] || [];
    if (!files[0] || !files[0].url) { snack('该版本没有安装包'); return; }
    var url = files[0].url, name = files[0].name || ('update_' + Date.now() + '.apk');
    $('updateGo').disabled = true;
    try {
      // 附件 url 形如 .../asset/<uuid>/files/2026-09/xxx.apk，取出 /asset/<uuid>/ 之后的 file_path
      var m = url.match(/\/asset\/[^/]+\/(.+)$/);
      var filePath = m ? m[1] : '';
      if (!filePath) throw new Error('无法解析文件路径');
      // 用 app Token 换临时直链（seafhttp/files/...），否则直接 GET 只会下到登录页 HTML
      $('updateStatus').textContent = '正在获取下载地址…';
      var enc = encodeURI(decodeURIComponent(filePath));   // 保留 / 分隔符，只编码文件名部分
      var direct;
      if (用中转()) {
        // ⚠️ 这里**不能**用 中转链接('/api/download?path=…')（2026-09-26 修）：
        // 那样会拼成 `/api?p=/api/download?path=…`，中转把它当普通路径转发，
        // 而 `/api/download` 不在中转的白名单里 → 403 path not allowed，
        // 用户看到的就是"检查更新下不了包"。正确写法是直接拼 /api/download 并带口令
        // （和社区图片 dlLinkUrl 一个形状）。
        // `u=` 指定这个附件属于「更新」库：中转按库选对应的 SeaTable 令牌换下载链接，
        // 不传就会用账号库的令牌，那个令牌对「更新」库没权限 → 403。
        direct = CLOUD_BASE + '/api/download?path=' + enc +
                 '&u=' + encodeURIComponent(UPDATE_CFG.uuid) +
                 '&t=' + encodeURIComponent(MAIL_APP_TOKEN);
      } else {
        var linkResp = await editorCloudHttp('GET', UPDATE_CFG.server + '/api/v2.1/dtable/app-download-link/?path=' + enc, null, (UPDATE_CFG.token || null));
        direct = linkResp && linkResp.download_link;
      }
      if (!direct) throw new Error('未取得下载链接');
      $('updateStatus').textContent = '正在下载安装包…';
      window.__updCid = 'upd_' + Date.now();
      Native.downloadApk(window.__updCid, direct, name);
    } catch (e) {
      $('updateStatus').textContent = '下载失败：' + (e.message || '网络错误');
      $('updateGo').disabled = false;
    }
  }

  var exportIcon = null;
  function openExport() {
    var p = buildOutput();
    // 用户要求：就算一个控件都没有也能导出（空工程拿去装、后面再加东西是常见用法），
    // 所以这里不再拦截；只在界面上提示一句"当前页面没有控件"。
    var total = p.screens.reduce(function (a, s) { return a + s.components.length; }, 0);
    exportIcon = p.icon || null;
    $('expVersion').value = p.version || '1.0';
    var 空提示 = $('expEmptyHint');
    if (空提示) 空提示.classList.toggle('hidden', total > 0);
    renderIconPreview();
    $('exportMask').classList.remove('hidden');
  }
  function renderIconPreview() {
    var pv = $('iconPreview');
    if (exportIcon) { pv.style.backgroundImage = 'url(' + exportIcon + ')'; pv.textContent = ''; }
    else { pv.style.backgroundImage = ''; pv.textContent = ($('appName').value || '我').slice(0, 1); }
  }
  function doExport() {
    histSnapshot(state.itemId, '导出前');   // 导出前自动留一份（导出的是能跑的版本，改坏了能回来）
    var p = buildOutput();
    p.version = ($('expVersion').value || '1.0').trim();
    p.icon = exportIcon;
    state.project.version = p.version; state.project.icon = exportIcon;
    saveCurrentWs(true); persist();   // 导出前确保代码与工程已落盘
    $('exportMask').classList.add('hidden');
    if (!window.Native || !Native.exportApk) { modal('导出说明', '需要在安卓 App 内运行才能生成 APK。'); return; }
    modal('正在生成', '正在编译并签名 APK，请稍候…');
    $('modalOk').classList.add('hidden');
    Native.exportApk(JSON.stringify(p), p.appName, p.orientation || 'portrait', exportIcon || '', p.version);
  }
  /* ---------------- 𝑭𝒍𝒖𝒙（AI 助手，DeepSeek） ----------------
     设计要点：
     1) 只生成"当前页面"的代码，不跨页；
     2) 结果先给用户看，点「插入到画布」才落到工作区；不点就什么都没发生；
     3) 代码清单不是手写的，而是从工具箱自动提取 —— 以后加代码，AI 自动就会了；
     4) 校验：AI 只能用清单里出现过的 block type，别的直接丢掉，不许污染画布。
     5) 安全：代码文字字段已被正确转义（见 pc-sim/cdp-test.mjs 的注入回归测试），
        且这条路径完全不碰 screen.code，不存在任意代码执行的问题。 */
  var AI_KEY_STORE = '__bb_ai_key_v1';   // 浏览器兜底（真机走 Native.getAiKey/setAiKey）
  /* 模型**固定**为 DeepSeek-V4.1 flash（用户 2026-10-28 要求：删掉模型选择器，只用这一个）。
     深度思考是另一个轴，仍然可以单独开关：thinking={type:'enabled'|'disabled'}。
     注：DeepSeek 把 deepseek-chat 这个名字映射到 flash，所以这里直接写真实模型名。 */
  var AI_MODEL = 'deepseek-flash';
  var AI_MODEL_LABEL = 'DeepSeek-V4.1 flash';
  var AI_THINK_KEY = '__bb_ai_think_v2';
  /* 用户要求"什么限制都不要设"：额度拉满、超时形同虚设。
     真正的解法是**流式请求**（见 aiChatStream）：只要还有数据在来就不会超时，
     所以下面这两个数只是兜底 —— 真卡死了才用得上。 */
  var AI_MAX_TOKENS = 64000;
  var AI_TIMEOUT_MS = 600000;            // 非流式的兜底（10 分钟）
  var AI_STREAM_IDLE_MS = 600000;        // 流式：10 分钟没有任何增量才算卡死
  function aiModel() { return AI_MODEL; }
  function aiThinkOn() {
    var v = null; try { v = localStorage.getItem(AI_THINK_KEY); } catch (e) {}
    return v === null ? true : v === '1';
  }
  function aiSetThink(on) {
    try { localStorage.setItem(AI_THINK_KEY, on ? '1' : '0'); } catch (e) {}
    aiSyncThinkUI();
  }
  function aiMaxTokens() { return AI_MAX_TOKENS; }
  /** 真正发出去的模型参数（测试用它断言"两个轴互不影响"） */
  function aiRequestParams() {
    return { model: aiModel(), thinking: { type: aiThinkOn() ? 'enabled' : 'disabled' },
             max_tokens: AI_MAX_TOKENS, timeoutMs: AI_TIMEOUT_MS };
  }
  /** 深度思考按钮跟着状态走（模型固定，不再有第二处显示要同步） */
  function aiSyncThinkUI() {
    var on = aiThinkOn();
    var btn = $('aiThink');
    if (btn) {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.textContent = on ? '🧠' : '💤';
      btn.title = on ? '深度思考：开（会先推理再回答，慢一点但更懂你）' : '深度思考：关（直接回答，快）';
    }
  }
  function aiModelLabel() { return AI_MODEL_LABEL; }

  var AI_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  var AI_BALL_POS = '__bb_ai_ball_pos_v1';
  var aiCatalogCache = null;
  var aiPreviewWs = null;
  // 用户手动平移/缩放之后，别再让「自动适应」把画布拽走（用户反馈：滑动空白处会闪到其他位置）
  var aiPreviewUserMoved = false;
  // 预览手势的当前状态（给测试用：能看出"按下那一下走了哪条分支"）
  /**
   * 平移换算（纯函数）：屏幕位移 (dx,dy) → Blockly 的 scroll 参数。
   *
   * 从 Blockly 源码确认：`scroll(a,b)` 内部就是 `this.scrollX = a`，参数**就是像素 scrollX 本身**，
   * 而内容层 translate = scrollX + absoluteLeft —— 所以 scrollX 越大内容越靠右，
   * 手指右移 dx 就是 scrollX + dx。这与 Blockly 自己的 WorkspaceDragger 完全一致：
   *   drag(delta) { this.workspace.scroll(startScroll.x + delta.x, startScroll.y + delta.y); }
   */
  function panScrollFrom(baseX, baseY, dx, dy) {
    return { x: baseX + dx, y: baseY + dy };
  }
  var aiGest = { down: 0, hit: '', dragging: false, panning: false, moves: 0, apply: 0, err: '', pts: 0 };
  var aiPendingDom = null;               // 最近一次生成、待插入的代码 XML
  var aiPendingComps = null;             // 最近一次生成、待应用的控件改动

  function aiKeyRead() {
    try { if (window.Native && Native.getAiKey) { var k = Native.getAiKey(); if (k) return k; } } catch (e) {}
    try {
      var v = localStorage.getItem(AI_KEY_STORE);
      if (v) return v;
    } catch (e) {}
    // 兜底：设置里那份输入框还没失焦时（手机上打完直接切走很常见），直接取它当前的值。
    // 以前只认"已保存"的那份，于是刚粘贴完就去生成会被判定成"没有 Key"。
    try {
      var el = document.getElementById('aiKey');
      if (el && el.value) return String(el.value).trim();
    } catch (e) {}
    return '';
  }
  /** key 的显示形态：sk-2f…a470（35 字符）—— 让用户一眼确认"到底认到了什么" */
  function aiKeyMask(k) {
    k = String(k || '').trim();
    if (!k) return '';
    var head = k.slice(0, 5), tail = k.length > 10 ? k.slice(-4) : '';
    return head + '…' + tail + '（' + k.length + ' 字符）';
  }
  function aiKeyWrite(k) {
    k = (k || '').trim();
    try { if (window.Native && Native.setAiKey) Native.setAiKey(k); } catch (e) {}
    try { if (k) localStorage.setItem(AI_KEY_STORE, k); else localStorage.removeItem(AI_KEY_STORE); } catch (e) {}
  }

  /**
   * 从工具箱里提取"可用代码清单"：每个 block type 取工具箱里的第一份完整骨架
   * （含字段名与默认值），这样 AI 拿到的是准确可照抄的模板，而不是靠猜。
   */
  function aiCatalog() {
    if (aiCatalogCache) return aiCatalogCache;
    var out = [];
    try {
      var xmlText = window.buildToolboxXml ? window.buildToolboxXml(null) : '';
      if (xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        var nodes = doc.getElementsByTagName('block');
        var seen = {};
        var ser = new XMLSerializer();
        for (var i = 0; i < nodes.length; i++) {
          var t = nodes[i].getAttribute('type');
          if (!t || seen[t]) continue;
          seen[t] = 1;
          var s = ser.serializeToString(nodes[i]);
          s = s.replace(/ xmlns="[^"]*"/g, '').replace(/\s+/g, ' ');
          out.push(s);
        }
      }
    } catch (e) { console.error('生成代码清单失败', e); }
    aiCatalogCache = out.join('\n');
    return aiCatalogCache;
  }

  /** 当前页面已有的代码类型摘要（给 AI 当上下文，只报类型不报内容，省 token） */
  function aiScreenSummary() {
    try {
      var ws = state.ws;
      if (!ws) return '（画布尚未就绪）';
      var tops = ws.getTopBlocks(false);
      if (!tops.length) return '（这个页面目前还没有任何代码）';
      var list = tops.map(function (b) {
        var names = [];
        var walk = function (x) { names.push(x.type); x.getChildren(false).forEach(walk); };
        walk(b);
        return names.join(' → ');
      });
      return list.join('\n');
    } catch (e) { return '（读取失败）'; }
  }

  var aiSystemCache = null;
  function aiSystemPrompt() {
    var compTypes = Object.keys(TYPE_META).map(function (t) { return t + '（' + TYPE_META[t].label + '）'; }).join('、');
    var sys = '你是 Flux（FAST 安卓代码编程 App 里的 AI 助手）。别人问你是谁，就说你是 Flux。\n'
      + '用户用一句话描述想要的效果，你可以帮他改**控件**、也可以生成**代码**。\n\n'
      + '只输出 JSON，不要任何多余文字，格式：\n'
      + '{"reply":"给用户看的简短中文说明","components":[...],"blocks":"<xml .../>","fixes":[...],"ask":{...}}\n\n'
      + 'components 是可选数组，用来增删改"当前页面"的控件：\n'
      + '  {"op":"add","type":"button","props":{"text":"登录"}}          新增控件\n'
      + '  {"op":"update","id":"button1","props":{"text":"登录"}}        修改已有控件的属性\n'
      + '  {"op":"remove","id":"text2"}                                  删除已有控件\n'
      + '  {"op":"update","id":"button1","props":{"x":70,"y":600}}       调排版（位置/大小）\n'
      + 'blocks 是可选字符串，放要生成的代码 XML。\n'
      + 'fixes 是可选数组，用来**替换用户已有的某段代码**（"我这儿运行不对，帮我改"就走它）：\n'
      + '  {"index":0,"reason":"弹提示那行挡在了等待前面","blocks":"<xml ...>修复后的完整代码</xml>"}\n'
      + '  · index 的段号含义见上下文（用户拖进对话框的代码 / 画布上的第 N 段）。\n'
      + '  · blocks 必须是**整段可替换的完整 XML**（含事件帽子代码），不是片段、不是补丁。\n'
      + '  · **要删掉某一段**就用 {"index":0,"delete":true,"reason":"这段是多余的"}（不需要 blocks）。\n'
      + '  · 用户描述"运行不对/不生效/顺序错"这类问题时优先用 fixes；要新增功能才用 blocks。\n'
      + '  · 上下文里有【最近运行报错】时：那是真机/试运行真实抛出的错，**先明确说出是哪一页、第几段的哪个动作**，\n'
      + '    再给出那一段的 fixes；不要泛泛而谈，也不要让用户自己去找。\n'
      + '两者都可以给；只做其中一件事时，另一个留空即可。\n\n'
      + '硬性规则：\n'
      + '0. **用词**：这个 App 里一律把"积木"称作"**代码**"。你的回复里**不要出现"积木"两个字**，\n'
      + '   说"代码 / 代码块 / 这段代码 / 代码画布"。用户历史里用了"积木"，你也按"代码"回他。\n'
      + '1. 控件 type 只能用：' + compTypes + '。\n'
      + '2. 控件属性名只能用下面这些，别的一律会被丢掉：\n'
      + '   · 内容类：name、text、value、hint、alt、checked、min、max、items、url、src\n'
      + '   · 排版类：x、y、w、h、align、fs、spacing\n'
      + '   · 外观类：bold、color、bg、radius\n'
      + '3. **排版就是靠 x/y/w/h 做的，你完全能做，不要说"我没有布局属性、做不到"**：\n'
      + '   · x/y 是"距画布左边/上边"的像素，原点在左上角；w/h 是宽高像素；都取整数。\n'
      + '   · align 只能是 left / center / right（文字与内容的对齐方式）；fs 是字号；spacing 是字间距。\n'
      + '   · color / bg 只认 #RRGGBB（如 "#6750a4"）；radius 是圆角像素；bold 是 true/false。\n'
      + '   · 传 null 表示"恢复自动排列 / 自适应"，例如 {"x":null,"y":null}。\n'
      + '   · 要**水平居中**就写 "x":"center"（app 会按画布宽度算准），别自己算数字 —— 算错就偏。\n'
      + '   · 要**整宽**（左右各留 24 边距）就写 "w":"full"。\n'
      + '   · 用户说"居中、靠右、放到底部、往上挪一点、两个框挨紧点、标题大一点、标题加粗"这类要求，\n'
      + '     就按上面"当前页面控件"清单里给的画布尺寸和每个控件当前的位置大小，**算好具体数值**给他。\n'
      + '   · 只说"排得好看点"这种模糊要求时，给一套整齐的竖向排版：左边距一致（如 x=24）、\n'
      + '     宽度按画布宽度留边（如 画布宽-48）、控件之间纵向间距一致（如 72~88 像素），从上往下排。\n'
      + '4. name 和 text 是两回事，别搞混：\n'
      + '   · name 是"组件名称"——属性面板第一栏、控件列表里显示的那个名字，只给你和用户看的；\n'
      + '   · text / value 是控件上真正显示给用户看的内容。\n'
      + '   用户说"名字叫 111""命名为 111""叫 111 的那个"指的是 name；\n'
      + '   说"文字是 111""显示 111""上面写 111"才是 text。拿不准时优先按 name 处理。\n'
      + '   · **只改 name 时不要顺手把 text 也改掉**；只改 text 时也别动 name（两者独立）。\n'
      + '5. update / remove 的 id 必须来自下面"已有控件"清单里的真实 id，不要自己编。\n'
      + '6. blocks 里只能使用下面清单中出现过的 block type，字段名必须照抄。\n'
      + '7. 生成代码时**必须**用 <xml xmlns="https://developers.google.com/blockly/xml"> 包住，不要只给一个裸的 <block>。\n'      + '   · **代码必须真的写进 blocks 字段**；只在 reply 里用文字描述代码（"第1组…第2组…"）用户是拿不到的。\\n'
      + '8. 事件代码（如 v_xxx_click）要连同骨架里的 <field> 一起照抄，否则会绑到错误的控件上。\n'
      + '9. 只处理"当前页面"，不要涉及其它页面。\n'
      + '10. 做不到就返回空的 components 和空的 blocks，并在 reply 里说明原因。\n'
      + '11. 用户在追问或要求微调时，结合上面的对话历史理解他的指代。\n'
      + '12. **拿不准用户到底想要什么时，不要瞎猜也不要硬做**：把 components 和 blocks 都留空，改成问一句：\n'
      + '    {"reply":"我不太确定你的意思","ask":{"question":"你是指下面哪个？","options":["把标题文字改大","加一个返回按钮"]}}\n'
      + '    · options 给 2~5 个，每个不超过 16 个字，而且必须能**直接当成用户的下一条指令**（用户点一下你就照做）。\n'
      + '    · 只在真的存在两种以上合理解释、猜错代价明显时才问（比如"帮我改一下那个""把它弄好看点"）；\n'
      + '      能合理推断出来的就直接做，别问废话。\n'
      + '    · 如果用户这轮是在回答你上一次的追问，就按他的选择直接做，不要再问一遍。\n\n'
      + '可用代码清单（每行都是一份可直接照抄的完整骨架）：\n' + aiCatalog();
    aiSystemCache = sys;
    return aiSystemCache;
  }

  /* ---------------- AI 对话记录（可保存、可新建、带上下文） ----------------
     每条对话把历史消息存在本机 localStorage 里，下次打开还在。
     发给模型时带上最近若干轮，所以它能记住上文（"再大一点""改成蓝色"这种指代才成立）。
     系统提示里只放"不变的规则 + 代码清单"，每轮完全一致 —— 这样能吃到 DeepSeek 的
     prompt 缓存；会变的东西（当前页面的控件/代码）挂在最后一条用户消息里。 */
  var AI_CHATS_KEY = '__bb_ai_chats_v2';
  var aiChatsStore = null;

  /**
   * 运行时出错上报：运行时（试运行 / 导出后的 App）会把报错写进同一份诊断日志，
   * 带上"哪一页 / 第几段 / 哪个动作"。这里读出来给 AI，让它直接定位到那一段。
   */
  function aiRuntimeIssues(limit) {
    var out = [];
    try {
      var a = JSON.parse(localStorage.getItem('__bb_diag_v1') || '[]');
      if (!Array.isArray(a)) a = [];
      var 错 = a.filter(function (r) {
        return r && /代码执行失败|运行时错误|运行时Promise|^error$|^promise$/.test(String(r.k || ''));
      });
      错 = 错.slice(-(limit || 6));
      错.forEach(function (r) {
        var x = r.x || {}, 位置 = [];
        if (x.title || x.screen) 位置.push('页面=' + (x.title || x.screen));
        if (x.seg != null && x.seg !== '') 位置.push('第 ' + x.seg + ' 段');
        if (x.api) 位置.push('动作=' + x.api);
        out.push('- [' + r.t + '] ' + (位置.length ? 位置.join('、') + ' ' : '') + String(r.m || '').slice(0, 200));
      });
    } catch (e) {}
    return out;
  }
  /** 「看报错」按钮要发出去的那句话（单独抽出来，便于回归用例断言，不联网） */
  function aiDiagnoseText() {
    var 报错 = aiRuntimeIssues(3);
    if (!报错.length) {
      return '运行时没有记录到报错。请把当前页面的代码整体看一遍，找出可能"点了没反应 / 没生效"的地方，'
           + '并给出需要改的那一段（用 fixes）。';
    }
    return '试运行报错了，运行日志如下（运行时自动上报）：\n' + 报错.join('\n')
         + '\n请直接说清是哪一页、第几段出的问题，并用 fixes 给出那一段的修复版本。';
  }
  /**
   * 上下文压缩：只把**最近几轮**原文发出去，更早的折成一段要点摘要；
   * 每条历史回复也截个长度上限。目的：别把整段 XML 反复塞回去（省 token）。
   */
  function aiCompressHistory(hist, keep) {
    // 预算：最近 4 条（约两轮）原文 + 摘要。系统提示里已经带了整份代码清单（会随新增代码块变长），
    // 所以这里留的原文不能多 —— 之前是 6 条 × 700 字，加 3 个通用动作块后整包就顶到原文的 82%。
    keep = keep || 4;
    var MAX_REPLY = 500;
    var arr = (hist || []).filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant'); });
    var 摘要 = [], out = [];
    arr.forEach(function (m, i) {
      var 最近 = i >= arr.length - keep;
      var t = String(m.content == null ? '' : m.content).replace(/\s+/g, ' ').trim();
      if (最近) {
        out.push({ role: m.role, content: t.length > MAX_REPLY ? t.slice(0, MAX_REPLY) + '…（过长已截断）' : t });
        return;
      }
      // 老消息只留"要点"：去掉 JSON/XML 噪声，取开头一小段
      var 干净 = t.replace(/\{[\s\S]*$/, '').replace(/<[\s\S]*$/, '').trim() || t;
      摘要.push((m.role === 'user' ? '用户：' : '我：') + 干净.slice(0, 70));
    });
    if (摘要.length) {
      out.unshift({ role: 'user', content: '【早前对话摘要（' + 摘要.length + ' 条已压缩，只保留要点）】\n' + 摘要.slice(-12).join('\n') });
    }
    return out;
  }

  /** 组装发给模型的消息：系统提示 + 最近若干轮历史；动态上下文挂在最后一条用户消息上 */
  function aiBuildMessages(chat) {
    var msgs = [{ role: 'system', content: aiSystemPrompt() }];
    var hist = aiCompressHistory(chat && chat.messages ? chat.messages : [], 4);
    hist.forEach(function (m, i) {
      if (m.role !== 'user' && m.role !== 'assistant') return;
      var content = m.content;
      if (m.role === 'user' && i === hist.length - 1) {
        var 报错 = aiRuntimeIssues(6);
        content = '【当前页面控件】\n' + aiComponentSummary()
                + '\n\n【当前页面已有代码】\n' + aiScreenSummary()
                // 修复闭环：把用户拖进来的代码（优先）或画布上的代码连同 XML 给模型，
                // 它才能指出第几段有问题、并给出整段替换版本
                + aiStagedContext()
                + (aiStaged.length ? '' : aiPageBlocksContext())
                + (报错.length ? ('\n\n【最近运行报错（运行时自动上报，最新在后）】\n' + 报错.join('\n')
                    + '\n用户就是要修这个问题：**先直接说清是哪一页、第几段的哪个动作出的错**，'
                    + '再用 fixes 给出那一段的修复版本；不要只说"可能是…"。') : '')
                + '\n\n【用户要求】\n' + content;
      }
      msgs.push({ role: m.role, content: content });
    });
    return msgs;
  }

  function aiLoadChats() {
    if (aiChatsStore) return aiChatsStore;
    try { aiChatsStore = JSON.parse(localStorage.getItem(AI_CHATS_KEY) || 'null'); } catch (e) { aiChatsStore = null; }
    if (!aiChatsStore || !Array.isArray(aiChatsStore.list)) aiChatsStore = { activeId: null, list: [] };
    if (aiChatsStore.activeId && !aiChatsStore.list.some(function (c) { return c.id === aiChatsStore.activeId; })) {
      aiChatsStore.activeId = null;
    }
    if (!aiChatsStore.activeId) aiChatsStore.activeId = aiChatsStore.list.length ? aiChatsStore.list[0].id : null;
    if (!aiChatsStore.activeId) aiNewChat(true);
    return aiChatsStore;
  }
  function aiSaveChats() { try { localStorage.setItem(AI_CHATS_KEY, JSON.stringify(aiChatsStore)); } catch (e) {} }
  function aiCurChat() {
    var s = aiLoadChats();
    for (var i = 0; i < s.list.length; i++) if (s.list[i].id === s.activeId) return s.list[i];
    return null;
  }
  function aiNewChat(silent) {
    var s = aiLoadChats();
    // 已经在一个**空白对话**里了就别再新建 —— 以前可以一直点，堆出一串空对话（用户反馈）
    var cur = null;
    for (var i = 0; i < s.list.length; i++) if (s.list[i].id === s.activeId) cur = s.list[i];
    if (cur && (!cur.messages || !cur.messages.length)) {
      if (!silent) { snack('当前已经是新对话'); aiSyncNewChatBtns(); }
      return cur;
    }
    var c = { id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
              title: '新对话', ts: Date.now(), messages: [] };
    s.list.unshift(c);
    s.activeId = c.id;
    aiSaveChats();
    if (!silent) { aiRenderChats(); aiRenderLog(); aiClearAiResult(); aiSyncNewChatBtns(); }
    return c;
  }

  /** 当前是空白对话时，把"新建对话"两个入口置灰（点了也没意义） */
  function aiSyncNewChatBtns() {
    var c = aiCurChat();
    var empty = !!(c && (!c.messages || !c.messages.length));
    [$('aiNewChat'), $('aiNewChat2')].forEach(function (b) {
      if (!b) return;
      b.disabled = empty;
      b.classList.toggle('off', empty);
      b.title = empty ? '当前已经是新对话' : '新建对话';
      b.setAttribute('aria-disabled', empty ? 'true' : 'false');
    });
  }
  function aiDeleteChat(id) {
    var s = aiLoadChats();
    s.list = s.list.filter(function (c) { return c.id !== id; });
    if (s.activeId === id) s.activeId = s.list.length ? s.list[0].id : null;
    if (!s.activeId) { aiChatsStore = s; aiNewChat(true); }
    aiSaveChats(); aiRenderChats(); aiRenderLog(); aiClearAiResult();
  }
  /**
   * 侧边栏：盖住面板**整块**（连底部输入框一起），从左边"向右弹出"。
   * 用 open 类做位移动画（transform 过渡最丝滑），收起时先播动画再 display:none。
   */
  var aiListHideTimer = null;
  function aiPositionChatList() {
    var list = $('aiChatList');
    if (!list) return;
    list.style.top = '0px';
    list.style.bottom = '0px';     // 整块面板高度（含输入框那行）
  }
  function aiShowChatList(on) {
    var l = $('aiChatList');
    if (!l) return;
    if (aiListHideTimer) { clearTimeout(aiListHideTimer); aiListHideTimer = null; }
    if (on) {
      aiPositionChatList();
      aiRenderChats();
      l.classList.remove('hidden');
      void l.offsetWidth;          // 强制回流，保证 transform 过渡真的跑起来（否则直接跳到位）
      l.classList.add('open');
    } else {
      l.classList.remove('open');
      aiListHideTimer = setTimeout(function () { l.classList.add('hidden'); }, 280);
    }
  }
  function aiIsChatListOpen() {
    var l = $('aiChatList');
    return !!(l && !l.classList.contains('hidden') && l.classList.contains('open'));
  }
  function aiToggleChatList(force) {
    var want = (typeof force === 'boolean') ? force : !aiIsChatListOpen();
    aiShowChatList(want);
  }

  function aiRenderChats() {
    var box = $('aiChats');
    if (!box) return;
    box.innerHTML = '';
    var s = aiLoadChats();
    s.list.forEach(function (c) {
      var it = el('div', 'ai-chat-item' + (c.id === s.activeId ? ' on' : ''));
      it.appendChild(el('span', 't', c.title || '新对话'));
      var x = el('button', 'x', '✕');
      x.type = 'button';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); aiDeleteChat(c.id); });
      it.appendChild(x);
      it.addEventListener('click', function () {
        s.activeId = c.id; aiSaveChats(); aiRenderChats(); aiRenderLog(); aiClearAiResult();
      });
      box.appendChild(it);
    });
  }
  function aiRenderLog(opts) {
    var box = $('aiLog');
    if (!box) return;
    // 记住滚动位置：用户翻上去看历史时，重渲染不许把他拽到底部（用户反馈过"折叠思考内容
    // 居然强制滚到最底"）。只有"本来就在底部附近"或明确要求滚动时才滚到底。
    var body = document.querySelector('#aiPanel .ai-body');
    var keepTop = null, wasAtEnd = true;
    if (body) {
      keepTop = body.scrollTop;
      wasAtEnd = (body.scrollHeight - body.scrollTop - body.clientHeight) < 12;
    }
    box.innerHTML = '';
    var c = aiCurChat();
    if (!c) return;
    (c.messages || []).forEach(function (m) {
      if (m.role !== 'user' && m.role !== 'assistant') return;
      var d = el('div', 'ai-msg ' + (m.role === 'user' ? 'user' : 'ai'));
      d.appendChild(el('div', 'who', m.role === 'user' ? '你' : 'AI'));
      d.appendChild(el('div', 'bubble', m.content));
      // 思考过程：只留一行"想了多少字"，不再给展开按钮、也不显示内容（用户要求）
      if (m.reasoning) {
        d.appendChild(el('div', 'ai-reason-count', '💭 思考了 ' + String(m.reasoning).length + ' 个字'));
      }
      box.appendChild(d);
    });
    if (body) {
      if (opts && opts.noScroll) body.scrollTop = keepTop;
      else if (wasAtEnd) aiScrollLogToEnd();
      else body.scrollTop = keepTop;      // 用户在看上面，保持不动
    } else aiScrollLogToEnd();
    aiSyncNewChatBtns();   // 空白对话时把「新建对话」置灰
  }
  function aiReasonLabel(m) {
    return '💭 思考了 ' + String(m.reasoning || '').length + ' 个字';
  }

  /** 滚到对话最底部。发完消息、AI 回完、切对话、返回时都要滚（用户反馈不自动滚）。 */
  function aiScrollLogToEnd() {
    var body = document.querySelector('#aiPanel .ai-body');
    if (body) body.scrollTop = body.scrollHeight;
    var log = $('aiLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  /* ---------------- 流式对话：实时看思考过程，且不再"复杂一点就 timeout" ----------------
     非流式请求必须等模型把话说完才返回，长回答（尤其是深度思考）就会撞读超时
     （用户真机："稍微复杂一点就直接 timeout"），思考过程也只能等生成完才看得到。
     改成流式后：数据一直在来 ⇒ 不会被判超时（原生那边读超时直接设成无限），
     而且每个 token 都能即时刷到面板上。
     两条通道：
       · 手机：Native.httpStreamStart（原生 HttpURLConnection，绕开 CORS，读超时=无限）
       · PC/浏览器：fetch + ReadableStream（PC 回归测试走这条） */
  var aiStreamSeq = 0;
  var aiStreams = {};                 // id -> { acc, onDelta, end }
  var aiLiveTimer = null;
  var aiLiveUserScrolled = false;     // 用户自己往下翻过就不许再自动滚（用户反馈"没法向下滑"）

  /** 把一段 SSE 文本喂进累加器（服务端每行一个 data: {...}，最后 data: [DONE]） */
  function aiSseFeed(acc, text) {
    acc.buf += String(text || '');
    var idx;
    while ((idx = acc.buf.indexOf('\n')) >= 0) {
      var line = acc.buf.slice(0, idx).trim();
      acc.buf = acc.buf.slice(idx + 1);
      if (!line || line.charAt(0) === ':') continue;
      if (line.indexOf('data:') !== 0) continue;
      var payload = line.slice(5).trim();
      if (payload === '[DONE]') { acc.done = true; continue; }
      try {
        var j = JSON.parse(payload);
        var ch = j.choices && j.choices[0];
        var d = ch && ch.delta;
        if (d) {
          if (d.reasoning_content) acc.reasoning += d.reasoning_content;
          if (d.content) acc.content += d.content;
        }
        if (ch && ch.finish_reason) acc.finish = ch.finish_reason;
        if (j.error) acc.error = String(j.error.message || j.error);
      } catch (e) { /* 半截行：忽略（下一段会重新给完整行） */ }
    }
  }

  function aiLiveShow() {
    var w = $('aiLiveWrap'); if (w) w.classList.remove('hidden');
    aiLiveUserScrolled = false;      // 新一轮重新允许自动跟随
  }
  function aiLiveHide() {
    var w = $('aiLiveWrap'); if (w) w.classList.add('hidden');
    var b = $('aiLiveBody'); if (b) b.textContent = '';
    if (aiLiveTimer) { clearTimeout(aiLiveTimer); aiLiveTimer = null; }
  }
  /** 实时刷新"正在思考"那一块（节流：模型每秒能吐几十个增量，别把界面刷爆） */
  function aiLiveRender(acc) {
    if (aiLiveTimer) return;
    aiLiveTimer = setTimeout(function () {
      aiLiveTimer = null;
      var head = $('aiLiveHead'), body = $('aiLiveBody');
      if (!head || !body) return;
      var hasC = acc.content.length > 0, hasR = acc.reasoning.length > 0;
      // 这一块只谈"思考"：**不要**再带上"正文 M 字" ——
      // 它是原来显示思考内容的地方，一旦出现正文字数，看起来就像"思考里显示的是正文"
      // （用户反馈："为什么思考内容还在，只是被替换成了正文"）。正文有自己的气泡。
      // 推理正文一个字都不显示（用户要求：任何地方都别把思考内容摊开）。
      head.textContent = (hasC ? '✍️ 正在生成…' : '💭 正在思考…')
        + (hasR ? '（已思考 ' + acc.reasoning.length + ' 字）' : '');
      body.style.display = 'none';
      body.textContent = '';
    }, 120);
  }

  // 原生流式回调（Java 侧 evaluateJavascript 调这两个）
  window.__nativeStreamChunk = function (id, text) {
    var s = aiStreams[id]; if (!s) return;
    s.touch();
    aiSseFeed(s.acc, text);
    if (s.onDelta) s.onDelta(s.acc);
  };
  window.__nativeStreamEnd = function (id, errJson) {
    var s = aiStreams[id]; if (!s) return;
    var err = '';
    try { err = errJson ? (JSON.parse(errJson).error || '') : ''; } catch (e) { err = String(errJson || ''); }
    s.end(err);
  };

  function aiStreamNative(json, headers, acc, onDelta) {
    return new Promise(function (resolve, reject) {
      var id = 'ai' + (++aiStreamSeq) + '_' + Date.now();
      var idle = null, settled = false;
      function touch() {
        clearTimeout(idle);
        idle = setTimeout(function () { finish('等太久没有任何回应了（可能网络断了）'); }, AI_STREAM_IDLE_MS);
      }
      function finish(err) {
        if (settled) return;
        settled = true;
        clearTimeout(idle);
        delete aiStreams[id];
        try { if (Native.httpStreamAbort) Native.httpStreamAbort(id); } catch (e) {}
        if (err) reject(new Error(err)); else resolve(acc);
      }
      aiStreams[id] = { acc: acc, onDelta: onDelta, end: finish, touch: touch };
      aiAbortRegister(function () { finish('用户终止了这次生成'); });
      touch();
      try {
        Native.httpStreamStart(id, 'POST', AI_ENDPOINT, JSON.stringify(headers), json);
      } catch (e) {
        finish('原生流式请求启动失败：' + (e && e.message ? e.message : e));
      }
    });
  }

  async function aiStreamFetch(json, headers, acc, onDelta) {
    // 可终止：用户点「终止」时 abort 掉这个请求（真的断，不继续烧 token）
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    if (ctl) aiAbortRegister(function () { try { ctl.abort(); } catch (e) {} });
    var resp = await fetch(AI_ENDPOINT, { method: 'POST', headers: headers, body: json, signal: ctl ? ctl.signal : undefined });
    if (!resp.ok) {
      var txt = ''; try { txt = await resp.text(); } catch (e) {}
      throw new Error('HTTP ' + resp.status + ' ' + String(txt).slice(0, 200));
    }
    if (!resp.body || !resp.body.getReader) {           // 老浏览器：退回整包
      var all = await resp.text();
      aiSseFeed(acc, all);
      if (onDelta) onDelta(acc);
      return acc;
    }
    var reader = resp.body.getReader(), dec = new TextDecoder('utf-8');
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      aiSseFeed(acc, dec.decode(r.value, { stream: true }));
      if (onDelta) onDelta(acc);
    }
    return acc;
  }

  /**
   * 组装请求体（抽出来是为了能离线测「结构化输出契约」还在不在：
   * response_format=json_object 让模型必须返回 JSON，脏返回会明显减少；
   * thinking 跟着深度思考开关走）。
   */
  function aiRequestBody(msgs) {
    return {
      model: aiModel(), messages: msgs, temperature: 0.2, max_tokens: aiMaxTokens(),
      stream: true, response_format: { type: 'json_object' },
      thinking: { type: aiThinkOn() ? 'enabled' : 'disabled' }
    };
  }

  /** 发一次对话请求：优先流式，流式不可用才退回原来那条非流式通道 */
  async function aiChatOnce(msgs, key, onDelta) {
    var acc = { buf: '', content: '', reasoning: '', finish: '', done: false, error: '' };
    var body = aiRequestBody(msgs);
    var json = JSON.stringify(body);
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
    var useNative = !!(window.Native && Native.httpStreamStart);
    if (useNative) {
      await aiStreamNative(json, headers, acc, onDelta);
    } else if (typeof fetch === 'function' && typeof TextDecoder === 'function') {
      try {
        await aiStreamFetch(json, headers, acc, onDelta);
      } catch (e) {
        // 浏览器这条路走不通（CORS/环境不支持）→ 退回非流式，别把功能丢了
        delete body.stream;
        var res = await editorCloudHttp('POST', AI_ENDPOINT, body, key, { bearer: true, timeoutMs: AI_TIMEOUT_MS });
        var m = res && res.choices && res.choices[0] && res.choices[0].message;
        acc.content = m ? String(m.content || '') : '';
        acc.reasoning = m ? String(m.reasoning_content || '') : '';
        acc.finish = (res && res.choices && res.choices[0] && res.choices[0].finish_reason) || '';
        if (onDelta) onDelta(acc);
      }
    } else {
      delete body.stream;
      var res2 = await editorCloudHttp('POST', AI_ENDPOINT, body, key, { bearer: true, timeoutMs: AI_TIMEOUT_MS });
      var m2 = res2 && res2.choices && res2.choices[0] && res2.choices[0].message;
      acc.content = m2 ? String(m2.content || '') : '';
      acc.reasoning = m2 ? String(m2.reasoning_content || '') : '';
      acc.finish = (res2 && res2.choices && res2.choices[0] && res2.choices[0].finish_reason) || '';
      if (onDelta) onDelta(acc);
    }
    return acc;
  }
  /** 清掉上一轮的结果（切换对话时用），别让旧预览挂在新对话上 */
  function aiClearAiResult() {
    aiPendingDom = null; aiPendingComps = null;
    var a = $('aiPreviewWrap'); if (a) a.classList.add('hidden');
    var b = $('aiCompWrap'); if (b) b.classList.add('hidden');
    var bo = $('aiCompOps'); if (bo) bo.classList.add('hidden');
    aiAskHide();                   // 换对话/新建对话时，上一次的追问也要收掉
    aiSetStatus('');
  }

  /**
   * 把"看起来像 JSON 但解析不了"的文本尽量救回来。模型最常犯的三个毛病：
   *   1) 字符串里写了**真实换行**（生成代码 XML 时几乎必犯）—— JSON 里必须写成 \n；
   *   2) 末尾多了个逗号（{"a":1,}）；
   *   3) 话太多被 max_tokens 截断，括号没收口。
   * 都在这里补上；实在救不回来才报错。用户真机反馈过"生成失败：AI 返回的内容不是合法 JSON"。
   */
  function aiRepairJson(src) {
    var s = String(src || '');
    // 1) 转义字符串字面量里的裸控制字符（已经转义好的 \n 不动）
    var out = '', inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr && (ch === '\n' || ch === '\r' || ch === '\t')) { out += (ch === '\t' ? '\\t' : '\\n'); continue; }
      out += ch;
    }
    s = out;
    // 2) 对象/数组末尾多余的逗号
    s = s.replace(/,\s*([}\]])/g, '$1');
    // 3) 数一数还没闭合的括号（顺便看字符串有没有断在半路）
    var stack = [], inS = false, esc2 = false;
    for (var j = 0; j < s.length; j++) {
      var c = s.charAt(j);
      if (esc2) { esc2 = false; continue; }
      if (c === '\\') { esc2 = true; continue; }
      if (c === '"') { inS = !inS; continue; }
      if (inS) continue;
      if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    if (inS) s += '"';
    s = s.replace(/[,:]\s*$/, '');          // 截断在半截 key/逗号上
    while (stack.length) s += stack.pop();
    return s;
  }

  /** 解析 AI 返回的 JSON：代码块、前后废话、裸换行、尾逗号、被截断，都尽量救回来 */
  function aiParse(text) {
    var raw = String(text || '').trim();
    var cands = [];
    var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cands.push(fence[1].trim());
    var i = raw.indexOf('{'), j = raw.lastIndexOf('}');
    if (i >= 0 && j > i) cands.push(raw.slice(i, j + 1));
    if (i >= 0) cands.push(raw.slice(i));      // 截断：从第一个 { 一直到结尾
    cands.push(raw);
    for (var k = 0; k < cands.length; k++) {
      try {
        var o = JSON.parse(cands[k]);
        if (o && typeof o === 'object') return o;
      } catch (e) {}
      try {
        var r = JSON.parse(aiRepairJson(cands[k]));
        if (r && typeof r === 'object') { r.__aiRepaired = true; return r; }
      } catch (e2) {}
    }
    var err = new Error('AI 返回的内容不是合法 JSON');
    err.aiRaw = raw;
    throw err;
  }

  /** 重试时追加的"硬提醒"：模型最容易在这里犯格式错 */
  var AI_STRICT_NUDGE = '\n\n【重试提醒】你上一次的回复不是合法 JSON（或者正文是空的）。'
    + '这一次请**只输出一个 JSON 对象**：不要解释、不要 markdown 代码块；'
    + '字符串里不要出现真实换行（代码 XML 请写成一整行，换行写成 \\n），引用文字里的引号写成 \\"。';

  /** 把技术性错误翻成用户能照着做的话 */
  function aiFriendlyError(e) {
    var m = String((e && e.message) || e || '');
    if (/不是合法 JSON/.test(m)) {
      return new Error('AI 回的内容不是合法 JSON（我已自动重试过一次）。再发一次通常就好了；'
        + '要是老这样，把「深度思考」关掉、用 flash 再试。');
    }
    if (/没有返回内容|推理/.test(m)) {
      return new Error('AI 这次"想"太久、把配额用光了，正文是空的（已自动重试一次）。'
        + '把要求说得短一点，或关掉「深度思考」用 flash 再试。');
    }
    return e;
  }

  /**
   * 校验 AI 给的 XML：只允许清单里存在的 block type，其它一律剔除。
   * 这一步是"AI 不许污染画布"的关口 —— 模型编出不存在的代码是常事。
   */
  /**
   * 从模型的原始返回里"抢救"出代码 XML。
   * 常见失败：模型把 XML 裹在说明文字里、包在 ``` 代码围栏里、或直接给了一段带注释的片段。
   * 以前这种一律当"没有可用的内容"，用户看到的就是"没能生成可用的内容"（截图反馈）。
   * 这里按标签配对把顶层的 <block> 抠出来，再补一层 <xml>。
   */
  function aiExtractTopBlocks(s) {
    var out = [], depth = 0, start = -1, m;
    var re = /<block\b[^>]*?(\/?)>|<\/block>/g;
    while ((m = re.exec(s))) {
      if (m[0] === '</block>') {
        depth--;
        if (depth <= 0) { if (start >= 0) out.push(s.slice(start, re.lastIndex)); depth = 0; start = -1; }
      } else if (m[1] === '/') {
        if (depth === 0) out.push(m[0]);
      } else {
        if (depth === 0) start = m.index;
        depth++;
      }
    }
    return out;
  }
  function aiSalvageXml(raw) {
    var s = String(raw || '');
    if (!s) return '';
    var m = /<xml[\s\S]*<\/xml>/i.exec(s);
    if (m) return m[0];
    var tops = aiExtractTopBlocks(s);
    if (!tops.length) return '';
    return '<xml xmlns="https://developers.google.com/blockly/xml">' + tops.join('') + '</xml>';
  }
  function aiValidateXml(xmlText) {
    var s = String(xmlText || '').trim();
    if (!s) return null;
    var doc = null;
    try { doc = new DOMParser().parseFromString(s, 'text/xml'); } catch (e) { doc = null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) throw new Error('AI 生成的代码格式无法解析');

    // 白名单：工具箱里出现过的类型
    var allowed = {};
    try {
      var cat = aiCatalog();
      var re = /type="([^"]+)"/g, m;
      while ((m = re.exec(cat))) allowed[m[1]] = 1;
    } catch (e) {}
    // Blockly 内置的取值代码也在工具箱里出现过，若仍缺则补上常用几个
    ['text', 'math_number', 'logic_boolean', 'logic_compare', 'logic_operation', 'controls_if'].forEach(function (t) { allowed[t] = 1; });

    var dropped = [];
    var nodes = doc.getElementsByTagName('block');
    for (var i = nodes.length - 1; i >= 0; i--) {
      var t = nodes[i].getAttribute('type');
      if (!t || !allowed[t]) { dropped.push(t || '(空类型)'); nodes[i].parentNode.removeChild(nodes[i]); }
    }
    var remain = doc.getElementsByTagName('block').length;
    if (!remain) throw new Error('AI 生成的代码里没有可用的类型' + (dropped.length ? '（丢弃了：' + dropped.join('、') + '）' : ''));

    // 结构修复：模型经常把"值类代码"（有输出、没有上接头）塞进 <next> / <statement> 里，
    // Blockly 会直接抛 "Next block does not have previous statement"，整段预览渲染失败
    // （用户截图反馈："代码渲染失败：Next block does not have previous statement."）。
    // 这里把塞错位置的块**提到根上**当成独立一段，而不是让整段生成失败。
    var 结构修复 = aiRepairXmlStructure(doc);

    // 模型经常返回"裸的 <block>"（不带 <xml> 外壳）。而 Blockly 的 domToWorkspace
    // 遍历的是根节点的**子元素**：根若本身就是 <block>，它的子元素是 <next>/<value>，
    // 于是一个代码都建不出来 —— 表现为"校验通过、预览却空白"（实测踩过）。
    // 这里统一补一层 <xml>，两种情况都能用。
    var root = doc.documentElement;
    if (root && String(root.nodeName).toLowerCase() !== 'xml') {
      var wrapper = doc.createElement('xml');
      wrapper.appendChild(root);      // 把原根挂到新外壳下（会自动从 document 上摘下来）
      doc.appendChild(wrapper);
    }
    return { doc: doc, dropped: dropped, 修复: 结构修复 };
  }

  /* ---- 结构修复：判定一个类型能不能"接在别人后面 / 放进值槽" ---- */
  var aiTypeCapCache = {};
  var aiHeadlessWsCache = null;
  function aiHeadlessWorkspace() {
    if (aiHeadlessWsCache) return aiHeadlessWsCache;
    try { aiHeadlessWsCache = new Blockly.Workspace(); } catch (e) { aiHeadlessWsCache = null; }
    return aiHeadlessWsCache;
  }
  function aiTypeCaps(type) {
    if (aiTypeCapCache[type]) return aiTypeCapCache[type];
    var caps = { 可接后: false, 有输出: false, 已知: false };
    try {
      var head = aiHeadlessWorkspace();
      if (head) {
        var b = head.newBlock(type);
        if (b) {
          try { if (b.initSvg) b.initSvg(); } catch (e) {}
          caps.已知 = true;
          caps.可接后 = !!b.previousConnection;
          caps.有输出 = !!b.outputConnection;
          try { b.dispose(false); } catch (e) {}
        }
      }
    } catch (e) {}
    aiTypeCapCache[type] = caps;
    return caps;
  }
  /**
   * 把塞错槽位的块提到根上：
   *  · <next> / <statement> 里的块若没有"上接头"（纯值块），提出来；
   *  · <value> 里的块若没有输出（语句块），提出来。
   * 最多来回几轮直到稳定。返回修好的块数。
   */
  function aiRepairXmlStructure(doc) {
    if (!doc || !doc.documentElement) return 0;
    function 根壳() {
      var r = doc.documentElement;
      if (r && String(r.nodeName).toLowerCase() !== 'xml') {
        var w = doc.createElement('xml');
        w.appendChild(r);
        doc.appendChild(w);
        r = w;
      }
      return r;
    }
    var 修 = 0;
    for (var pass = 0; pass < 6; pass++) {
      var changed = false;
      var 壳 = 根壳();
      var list = [];
      var blocks = doc.getElementsByTagName('block');
      for (var i = 0; i < blocks.length; i++) list.push(blocks[i]);
      list.forEach(function (b) {
        var parent = b.parentNode;
        if (!parent || !parent.nodeName) return;
        var tag = String(parent.nodeName).toLowerCase();
        if (tag !== 'next' && tag !== 'statement' && tag !== 'value') return;
        var caps = aiTypeCaps(b.getAttribute('type') || '');
        if (!caps.已知) return;
        var 放错 = (tag === 'value') ? !caps.有输出 : !caps.可接后;
        if (!放错) return;
        try { 壳.appendChild(b); 修++; changed = true; } catch (e) {}   // appendChild 会自动从原父节点摘下
      });
      if (!changed) break;
    }
    return 修;
  }

  /**
   * 把"主工作区"指回编辑器画布。
   * 坑：Blockly.inject 注入预览区时会顺手把主工作区改成预览区，之后编辑器的下拉、
   * 齿轮气泡、快捷键都会跑到预览区上去。而 Blockly 的 UMD 构建里
   * `Blockly.setMainWorkspace` 并不一定导出（实测就没有），所以这里逐个兜底。
   */
  function aiRestoreMainWs() {
    var ws = state.ws;
    if (!ws) return;
    try { if (Blockly.setMainWorkspace) { Blockly.setMainWorkspace(ws); return; } } catch (e) {}
    try { if (Blockly.common && Blockly.common.setMainWorkspace) { Blockly.common.setMainWorkspace(ws); return; } } catch (e) {}
    try { if (ws.markFocused) ws.markFocused(); } catch (e) {}
  }

  /** 把校验过的代码渲染到"专门的代码画布"里（整屏，可拖动、可缩放、可改） */
  /**
   * 把一组顶层代码从 (x, y) 开始**依次竖排**，每块之间留 gap。
   * 以前插入时只按序号错开 8 像素，AI 一次给多组代码就会几乎完全叠在一起（用户反馈）。
   */
  function aiStackBlocks(blocks, x, y, gap) {
    var cy = y, g = (gap == null ? 16 : gap);
    (blocks || []).forEach(function (b) {
      if (!b || !b.moveBy) return;
      var xy = b.getRelativeToSurfaceXY ? b.getRelativeToSurfaceXY() : { x: 0, y: 0 };
      b.moveBy(x - xy.x, cy - xy.y);
      var hw = b.getHeightWidth ? b.getHeightWidth() : null;
      var h = (hw && hw.height) ? hw.height : 40;
      // 取"实测高度"和 118px 的较大值：真机上刚渲染时量到的高度可能远小于实际，
      // 那样多组代码就会叠在一起（用户反馈"代码组数多了会重叠"）。宁可间距大一点，也不能叠。
      cy += Math.max(h, 140) + g;
    });
  }

  function aiRenderPreview(doc) {
    var host = $('aiPreview');
    if (!host) return;
    // 宿主还没布局好（尺寸为 0）时**不要注入** —— 真机上"面板刚展开就点开代码画布"会走到
    // 这一步，Blockly 在 0 尺寸容器上注入可能直接失败（然后就一直是"画布无法初始化"）。
    // 等布局好了再试，最多等 20 次（约 1.2 秒）。
    if (!aiPreviewWs && (host.offsetWidth < 8 || host.offsetHeight < 8)) {
      host.__aiWait = (host.__aiWait || 0) + 1;
      if (host.__aiWait <= 20) { setTimeout(function () { aiRenderPreview(doc); }, 60); return; }
    }
    host.__aiWait = 0;
    if (!aiPreviewWs) {
      /**
       * 注入参数**要和主画布对齐**（尤其是 media / sounds）：预览以前没传 media，
       * Blockly 会退回它自带的在线地址去取图片和声音 —— 真机上那条请求不通时，
       * 注入就可能直接失败，界面只剩一句"画布无法初始化"（用户截图反馈）。
       * 这里本地化 media、关掉声音，先试完整配置，不行再用最小配置兜底重试。
       */
      var fullOpts = {
        // 只读：这块画布只用来"看"，里面的代码拖不动、改不了（用户要求）。
        // 想拿走代码，就在这块画布上**按住代码往外拖**到页面画布上 —— 见 wireAiPreviewDrag()。
        // readOnly 只挡住"块自身的拖动/编辑/快捷键"，工作区的 pointerdown 和缩放手势
        // 仍然保留，所以这块画布还能**双指缩放**、也能**按住空白处拖动平移**（用户要求）。
        readOnly: true, renderer: 'fastzelos', theme: Blockly.Themes.Zelos,
        media: 'blockly/media/', sounds: false,
        zoom: { controls: false, wheel: true, pinch: true, startScale: 0.9, minScale: 0.2, maxScale: 3 },
        // 双指缩放交给 Blockly；**平移自己实现**（wireAiPreviewDrag 里的 panning 分支）——
        // readOnly 下 Blockly 自己的工作区拖拽不稳，而且会和"按代码往外拖"打架。
        move: { scrollbars: true, drag: false, wheel: false },
        trashcan: false
      };
      var err1 = '';
      try {
        host.innerHTML = '';                       // 清掉上次失败留下的残骸，保证是干净容器
        aiPreviewWs = Blockly.inject(host, fullOpts);
        try { aiPreviewWs.__injectedOpts = fullOpts; } catch (e) {}   // 留个记号：测试用它验证参数
      } catch (e) { err1 = String((e && e.message) || e); aiPreviewWs = null; }
      if (!aiPreviewWs) {
        // 兜底：最小配置再试一次（哪怕拿不到主题/渲染器，也先让用户能看到代码）
        try {
          host.innerHTML = '';
          aiPreviewWs = Blockly.inject(host, { readOnly: true, comments: false, media: 'blockly/media/', sounds: false });
          window.__aiPreviewDegraded = err1;
        } catch (e2) {
          aiPreviewWs = null;
          window.__aiPreviewInitError = err1 + ' ／ 兜底也失败：' + String((e2 && e2.message) || e2);
        }
      }
      if (aiPreviewWs) {
        // 坑：Blockly.inject 会把"主工作区"指到刚注入的这个画布上，之后编辑器的
        // 下拉/齿轮气泡/快捷键都会跑到它上面去。注入完立刻改回来，并守住后续的
        // focus 切换（Blockly 自己也在容器上挂了 focusin 来切主工作区）。
        aiRestoreMainWs();
        try { host.addEventListener('focusin', aiRestoreMainWs); } catch (e) {}
        aiGuardCanvasEvents();   // 必须放在 inject 之后：让 Blockly 的处理先跑，再掐断外传
        wireAiPreviewDrag();     // 只需接一次：监听挂在 #aiPreview 宿主上，不随重渲染丢
      }
    }
    if (!aiPreviewWs) {
      // 失败原因**显示出来**（以前只有干巴巴一句"画布无法初始化"，连排查线索都没有）
      host.textContent = '画布无法初始化：' + (window.__aiPreviewInitError || '未知原因');
      return;
    }
    if (window.__aiPreviewDegraded) {
      // 兜底配置拿到了画布：能用，但主题/渲染器退化了，把原因留在状态栏里
      try { console.warn('预览画布用了兜底配置，原错误：' + window.__aiPreviewDegraded); } catch (e) {}
    }
    aiPreviewWs.clear();
    try {
      Blockly.Xml.domToWorkspace(doc.documentElement, aiPreviewWs);
      /**
       * 预览里**竖排摆开** + 缩放到刚好放进框里。
       *
       * 两个坑都在真机上才现形（PC 渲染快，测不出来）：
       *  · 刚 domToWorkspace 完，块的 getHeightWidth() 还量不到（真机要几百毫秒），
       *    这时竖排会算出 0 高度 —— 所有块叠在一起（用户截图里就是那样）；
       *  · 隐藏/刚显示时容器尺寸是 0，缩放会算成极小值。
       * 所以这套动作要在多个时间点重复做：先按当前量到的尺寸排一次，渲染完成后再校正几次。
       * 两步都是幂等的（每次都从固定起点重排/重算）。
       */
      var restackAndFit = function () {
        /**
         * 用户一旦开始操作（拖/滑/缩放），**既不要重排代码、也不要动视角** ——
         * 重排会让代码在松手后突然换位置（用户截图：缩放中一个样、松手后又一个样），
         * 视角自适应则会把他刚滑到的位置拽走。
         * 注入后的前几次（0/80/250ms）会完成竖排校正，用户来不及在这之前操作。
         */
        if (aiPreviewUserMoved) return;
        try {
          if (!aiPreviewWs) return;
          aiStackBlocks(aiPreviewWs.getTopBlocks(true), 20, 20, 20);
        } catch (e) {}
        try { aiFitPreview(); } catch (e) {}
      };
      restackAndFit();
      [80, 250, 600, 1200, 2000].forEach(function (t) { setTimeout(restackAndFit, t); });
    } catch (e) {
      window.__aiLastPreviewError = String((e && e.message) || e);
      host.textContent = '代码渲染失败：' + (e && e.message ? e.message : e);
    }
  }

  /** 把预览里的代码缩放到刚好放进预览框并居中（force=true 时忽略"用户已手动调过视角"） */
  function aiFitPreview(force) {
    if (!aiPreviewWs) return;
    if (aiPreviewUserMoved && !force) return;   // 用户自己在看某个位置，别抢他的视角
    var hostEl = $('aiPreview');
    // 预览区被隐藏（面板关着）时尺寸是 0，这会儿校正会算出极小的比例，
    // 等面板再打开代码就变得特别小。隐藏时直接跳过（实测踩过：缩放被压到 0.15）。
    if (!hostEl || !hostEl.offsetWidth || !hostEl.offsetHeight) return;
    try { Blockly.svgResize && Blockly.svgResize(aiPreviewWs); } catch (e) {}
    var box = null;
    try { box = aiPreviewWs.getBlocksBoundingBox(); } catch (e) {}
    // 基准必须用**容器的像素尺寸**，不能用 m.viewWidth/viewHeight ——
    // 那两个值是"工作区单位"，会随当前缩放反向变化：scale=0.5 时 viewWidth 是容器的两倍，
    // 于是下一次算出来的比例更大，反复算就越来越大。用户反馈的
    // "每拖出去一个代码，画布里的代码就越大"就是这么来的（每次拖拽后都要重算几次缩放）。
    var availW = hostEl.clientWidth - 28, availH = hostEl.clientHeight - 28;
    if (box && box.width > 0 && box.height > 0 && availW > 20 && availH > 20) {
      var s = Math.min(availW / box.width, availH / box.height);
      s = Math.max(0.2, Math.min(1.0, s));   // 上限 1.0：不要为了"填满"把代码放大到失真
      try { aiPreviewWs.setScale(s); aiPreviewWs.scrollCenter(); } catch (e) {}
    } else {
      try {
        aiPreviewWs.zoomToFit && aiPreviewWs.zoomToFit();
        if (aiPreviewWs.getScale && aiPreviewWs.getScale() > 1) aiPreviewWs.setScale(1);
      } catch (e) {}
    }
    aiRestoreMainWs();   // 渲染过程也可能再切一次主工作区，收尾时再正一次
  }
  function aiSetStatus(text, isErr) {
    var el = $('aiStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  }

  /* ---------------- AI 不确定时的"选择框" ----------------
     用户反馈：AI 有时候不太理解意思。与其让它瞎猜（猜错要撤销、更烦），不如让它反问一句、
     给几个按钮让用户点。约定：模型返回 {"ask":{"question":"…","options":["…","…"]}}。
     选了就直接当作用户的下一条消息发出去，少一次点按。 */
  var aiPendingAsk = null;

  function aiAskHide() {
    aiPendingAsk = null;
    var w = $('aiAskWrap'); if (w) w.classList.add('hidden');
    var o = $('aiAskOpts'); if (o) o.innerHTML = '';
  }

  /** 校验模型给的 ask：问题得有意义，选项 2~5 个、每个不超过 40 字。不合格就当没问 */
  function aiValidateAsk(a) {
    if (!a || typeof a !== 'object') return null;
    var q = String(a.question || a.q || a.text || '').trim().slice(0, 200);
    var raw = Array.isArray(a.options) ? a.options : (Array.isArray(a.choices) ? a.choices : []);
    var opts = raw.map(function (x) { return String(x == null ? '' : x).trim().slice(0, 40); })
                  .filter(function (x) { return !!x; });
    // 去重（模型偶尔会重复给同一条）
    var seen = {}, uniq = [];
    opts.forEach(function (t) { if (!seen[t]) { seen[t] = 1; uniq.push(t); } });
    if (!q || uniq.length < 2) return null;
    return { question: q, options: uniq.slice(0, 5) };
  }

  function aiRenderAsk(ask) {
    var w = $('aiAskWrap'), q = $('aiAskQ'), box = $('aiAskOpts');
    if (!w || !q || !box) return;
    if (!ask) { aiAskHide(); return; }
    aiPendingAsk = ask;
    q.textContent = aiDeJargon(ask.question);
    box.innerHTML = '';
    ask.options.forEach(function (t) {
      var b = el('button', 'ai-ask-opt', t);
      b.addEventListener('click', function () {
        aiAskHide();
        var inp = $('aiInput');
        if (!inp) return;
        inp.value = t;
        aiGenerate();          // 点一下就等于把这句话发出去
      });
      box.appendChild(b);
    });
    w.classList.remove('hidden');
    aiScrollLogToEnd();
  }

  /**
   * 处理模型返回的那坨 JSON：控件改动 → 代码预览 → 不确定时的选择框。
   * 抽成独立函数是为了让自动化测试能离线喂一段 JSON 走完整条链路（不联网也能回归）。
   */
  function aiHandleResponse(content, chat, reasoning) {
    var obj = aiParse(content);

    // 控件改动：列成清单等用户确认（控件没法画出来预览）
    var compRes = aiValidateComponents(obj.components);
    aiPendingComps = compRes.actions.length ? compRes.actions : null;
    aiRenderCompActions(compRes.actions);

    // 代码：渲染成可视预览，可拖可插
    var checked = null;
    window.__aiLastRaw = content;                    // 诊断用：模型原样返回
    window.__aiLastXml = String(obj.blocks || obj.xml || '');
    window.__aiLastPreviewError = null;
    try { checked = aiValidateXml(obj.blocks || obj.xml || ''); } catch (e) { checked = null; window.__aiLastXmlError = String(e && e.message || e); }
    // 校验没过：再尝试从**整段原始返回**里把 XML 抢救出来（模型常把代码裹在说明文字/代码围栏里，
    // 以前这种一律显示"没能生成可用的内容"——用户截图反馈"我让他给我两组代码他给不了"）。
    if (!checked) {
      var 抢救 = aiSalvageXml(content);
      if (抢救) {
        try {
          checked = aiValidateXml(抢救);
          if (checked) { checked.抢救 = true; window.__aiSalvaged = true; }
        } catch (e2) { window.__aiSalvageError = String(e2 && e2.message || e2); }
      }
    }
    if (checked) {
      aiPendingDom = checked.doc;
      $('aiPreviewWrap').classList.remove('hidden');
      aiRenderPreview(checked.doc);
    } else {
      aiPendingDom = null;
      $('aiPreviewWrap').classList.add('hidden');
    }

    // 不确定就问：给几个选项让用户点，比猜错强
    var ask = aiValidateAsk(obj.ask);
    aiRenderAsk(ask);

    // 修复方案（AI 针对拖进来的那段/画布上第 N 段给出的替换版本）
    var fixes = aiValidateFixes(obj.fixes);
    aiRenderFixes(fixes);

    var gotSomething = !!(aiPendingDom || aiPendingComps || ask || (fixes && fixes.length));
    var msg = aiDeJargon(String(obj.reply || '').trim())
      || (ask ? '我想先跟你确认一下' : (gotSomething ? '做好了，看看下面的改动' : '这次没能生成可用的代码'));
    var droppedN = compRes.dropped.length + (checked ? checked.dropped.length : 0);
    if (droppedN) msg += '（有 ' + droppedN + ' 项不可用的内容已忽略）';
    /**
     * 状态栏只放**一句状态**，绝不再放 AI 的整段回复。
     * 以前这里 `aiSetStatus(msg)` 把 reply 全文又显示了一遍，而同一段话已经在聊天气泡里 ——
     * 于是面板上下出现两段一模一样的文字（用户截图反馈"上面与下面内容一样"）。
     */
    var 状态短语 = ask ? aiDeJargon(String(ask.question || '我想先跟你确认一下'))
      : (aiPendingDom ? '已生成代码，点「打开代码画布」看看'
      : (aiPendingComps ? '有控件改动，确认后点「应用这些改动」'
      : '这次没能生成可用的内容'));
    if (droppedN) 状态短语 += '（有 ' + droppedN + ' 项不可用的内容已忽略）';
    aiSetStatus(状态短语, !gotSomething);
    // 追问也要记进对话：下一轮模型才知道自己问过什么
    var recorded = msg + (ask ? '\n（我在问用户：' + aiDeJargon(ask.question) + '　选项：' + ask.options.map(aiDeJargon).join(' / ') + '）' : '');
    if (chat) {
      var line = { role: 'assistant', content: recorded };
      // 思考过程一起存下来，聊天记录里可以折叠展开看（用户要求）
      var rt = String(reasoning || '').trim();
      // 自检：推理与正文如果开头一模一样，说明通道/服务端把它们串了 ——
      // 留个证据（真机看不了 console，只能这样取证）
      try {
        var _ct = String(content || '').trim();
        if (_ct && rt && _ct.slice(0, 30) === rt.slice(0, 30)) {
          window.__aiMixUp = { 正文开头: _ct.slice(0, 40), 思考开头: rt.slice(0, 40) };
        }
      } catch (e) {}
      if (rt) line.reasoning = rt.slice(0, 20000);
      chat.messages.push(line);
      if (chat.messages.length > 40) chat.messages = chat.messages.slice(-40);
      aiSaveChats(); aiRenderLog();
    }
    return { ask: ask, comps: (aiPendingComps || []).length, blocks: !!aiPendingDom,
             dropped: droppedN, repaired: !!obj.__aiRepaired, reasoning: String(reasoning || '').length };
  }

  /* ---------------- 生成中可终止（用户要求：发送按钮变红色「终止」，点了就停下） ----------------
     终止要真的断掉请求：浏览器这条路用 AbortController（原生流式用 httpStreamAbort）。
     只把 UI 复位、请求还在跑，那叫"假终止"，还会继续烧 token。 */
  var aiBusy = false;            // 正在生成
  var aiAborted = false;         // 这一轮被用户终止了
  var aiAbortHooks = [];         // 当前这一轮"怎么断"
  function aiAbortRegister(fn) { aiAbortHooks.push(fn); }
  function aiAbortClear() { aiAbortHooks = []; aiAborted = false; }
  function aiAbortHooksReset() { aiAbortHooks = []; }   // 只清"怎么断"，不动"已被终止"这个状态
  function aiStopGenerate() {
    if (!aiBusy) return;
    aiAborted = true;
    aiAbortHooks.slice().forEach(function (f) { try { f(); } catch (e) {} });
    aiAbortHooks = [];
    aiSetStatus('已终止生成');
    aiLiveHide();
    aiSetBusy(false);
  }
  /** 生成中把「生成」变成红色「终止」；结束后变回来 */
  function aiSetBusy(on) {
    aiBusy = !!on;
    var btn = $('aiSend');
    if (!btn) return;
    btn.classList.toggle('ai-stop', !!on);
    btn.textContent = on ? '终止' : '生成';
    btn.title = on ? '终止这次生成' : '生成';
    btn.disabled = false;        // 生成中也要能点（点了就是终止）
  }

  async function aiGenerate() {
    if (aiBusy) { aiStopGenerate(); return; }   // 生成中再点 = 终止
    var input = $('aiInput');
    var text = input ? String(input.value || '').trim() : '';
    if (!text) { aiSetStatus('先说说你想做什么', true); return; }
    var key = aiKeyRead();
    if (!key) {
      aiSetStatus('还没有填 DeepSeek 的 API Key，已经把设置打开了，填进去就能用', true);
      // 直接把设置打开：以前只提示一句，用户还得自己去找入口（用户反馈"没办法识别 key"）
      try { openSettings(); } catch (e) {}
      return;
    }

    var chat = aiCurChat();
    if (!chat) { chat = aiNewChat(true); }
    chat.messages.push({ role: 'user', content: text });
    if (!chat.title || chat.title === '新对话') chat.title = text.slice(0, 14);
    chat.ts = Date.now();
    aiSaveChats(); aiRenderChats(); aiRenderLog();
    if (input) input.value = '';

    aiAbortClear();
    aiSetBusy(true);
    aiSetStatus('正在生成…（点「终止」可以停下）');
    aiPendingDom = null;
    aiPendingComps = null;
    aiAskHide();
    $('aiPreviewWrap').classList.add('hidden');
    $('aiCompWrap').classList.add('hidden');
    $('aiCompOps').classList.add('hidden');
    aiLiveShow();
    aiLiveRender({ buf: '', content: '', reasoning: '', finish: '', done: false, error: '' });

    try {
      // 最多试两次：模型偶尔会回一段不是 JSON 的话、或者推理把配额吃光导致正文为空
      // （用户真机都撞到过）。这两类都是"再试一次多半就好"，不该直接把失败甩给用户。
      var MAX_TRY = 2, lastErr = null, done = false;
      for (var attempt = 1; attempt <= MAX_TRY && !done; attempt++) {
        if (aiAborted) break;
        if (attempt > 1) aiSetStatus('第一次没成，正在重试…（点「终止」可以停下）');
        var msgs = aiBuildMessages(chat);
        if (attempt > 1 && msgs.length) {
          var last = msgs[msgs.length - 1];
          msgs[msgs.length - 1] = { role: last.role, content: String(last.content) + AI_STRICT_NUDGE };
        }
        // 流式：思考过程实时刷到面板上；只要还有数据在来就不会超时（这就是"不设限"的正解）
        aiAbortHooksReset();   // 每次都重新登记"怎么断这次请求"
        var live = await aiChatOnce(msgs, key, function (a) { aiLiveRender(a); });
        if (aiAborted) break;
        var content = String(live.content || '');
        var reasoning = String(live.reasoning || '');
        var fin = String(live.finish || '');
        if (!content) {
          // 推理把配额吃光/正文为空：再试一次。
          window.__aiLastEmptyReasoning = reasoning;
          lastErr = new Error(reasoning ? 'AI 的推理太长，正文被截断了' : 'AI 没有返回内容');
          continue;
        }
        try {
          // 解析 + 控件改动清单 + 代码预览 + （不确定时的）选择框，都在这里
          var info = aiHandleResponse(content, chat, reasoning);
          if (fin === 'length' || info.repaired) {
            aiSetStatus(($('aiStatus') ? $('aiStatus').textContent : '') + '（AI 这次话被截断了，内容可能不完整）', false);
          }
          // 万一推理和正文被串了（真机上没法看 console），在界面上留一句能截图的证据
          if (window.__aiMixUp) {
            aiSetStatus(($('aiStatus') ? $('aiStatus').textContent : '') + '（提示：这次"思考"和"正文"内容疑似相同，已记录）', false);
          }
          done = true;
        } catch (e) {
          window.__aiLastBadJson = content;      // 诊断用：留着看模型到底回了什么
          lastErr = e;
        }
      }
      if (!done && !aiAborted) throw aiFriendlyError(lastErr);
    } catch (e) {
      if (aiAborted) aiSetStatus('已终止生成');
      else aiSetStatus('生成失败：' + (e && e.message ? e.message : e), true);
    } finally {
      var 被终止 = aiAborted;
      aiAbortClear();
      aiSetBusy(false);
      if (被终止) aiSetStatus('已终止生成');
      aiLiveHide();
    }
  }

  /** 屏幕坐标 → 画布工作区坐标（拖拽落点用） */
  function aiScreenToWs(clientX, clientY) {
    try {
      var f = Blockly.utils && Blockly.utils.svgMath && Blockly.utils.svgMath.screenToWsCoordinates;
      if (f && state.ws) return f(state.ws, { x: clientX, y: clientY });
    } catch (e) {}
    try {
      var svg = state.ws.getParentSvg();
      var r = svg.getBoundingClientRect();
      var pt = svg.createSVGPoint();
      pt.x = clientX - r.left; pt.y = clientY - r.top;
      var p = pt.matrixTransform(state.ws.getCanvas().getCTM().inverse());
      return { x: p.x, y: p.y };
    } catch (e) { return null; }
  }

  /**
   * 去掉 XML 里被"只读工作区"污染出来的 movable/editable/deletable="false"。
   *
   * 这是个真机上很阴的 bug：面板里的预览画布是 readOnly 的，而 Blockly 的 workspaceToDom
   * 会老老实实按**当前能不能动**写属性 —— 只读区里 isMovable() 为 false，于是导出的 XML
   * 里每一块都带着 movable="false" editable="false" deletable="false"。这些 XML 再灌进
   * 主画布时，Blockly 是认这些属性的，结果就是：AI 生成的代码插进去以后**拖不动**，
   * 手指按在代码上等于按在空白处 —— 整个画布跟着手指跑（用户反馈的正是这个）。
   *
   * 编辑器里没有"锁住某个代码"这种功能，所以这些属性只可能是被只读区写脏的，一律清掉。
   */
  function aiUnfreezeXml(root) {
    if (!root) return root;
    try {
      var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var i = 0; i < all.length; i++) {
        ['movable', 'editable', 'deletable'].forEach(function (k) {
          if (all[i].getAttribute && all[i].getAttribute(k) === 'false') all[i].removeAttribute(k);
        });
      }
      if (root.removeAttribute) {
        ['movable', 'editable', 'deletable'].forEach(function (k) {
          if (root.getAttribute(k) === 'false') root.removeAttribute(k);
        });
      }
    } catch (e) {}
    return root;
  }

  /**
   * 拿到"能用的代码工作区"。**用户可能是在设计页点插入的** ——
   * 那时代码工作区还没创建（state.ws 为 null），直接 domToWorkspace 会崩在
   * `Cannot read properties of null (reading 'RTL')`（用户真机截图里的报错）。
   * 这里发现工作区没就绪就自己切到代码页（showView('blocks') 会顺手初始化），
   * 用户看到的效果就是"代码被放到了代码页上"。
   */
  function aiReadyWorkspace() {
    if (state.ws && state.ws.getTopBlocks) return state.ws;
    try { showView('blocks'); } catch (e) {}
    try { if (!state.ws || !state.ws.getTopBlocks) initWorkspace(); } catch (e) {}
    return (state.ws && state.ws.getTopBlocks) ? state.ws : null;
  }

  /**
   * 插入点：**当前视口中心**，如果那儿已经有代码就依次往下让位。
   *
   * 以前是"视口左上角 + 30"，所以每次插入都落在同一个固定位置（用户反馈：
   * "插入代码到画布永远只放在一个固定位置"）。现在插到用户正看着的地方，
   * 并自动避开已有代码，插完立刻看得到。
   */
  function aiInsertSpotFor(ws, w, h) {
    var m = null;
    try { m = ws.getMetrics(); } catch (e) {}
    var bw = w || 220, bh = h || 90;
    // metrics 还没就绪时（刚切到代码页/正在布局）viewWidth 可能是 0，
    // 直接算会得到负数落点，块就被丢到画布外了 —— 用保底视口尺寸。
    var okM = !!(m && m.viewWidth > 4 && m.viewHeight > 4);
    var vx = okM ? m.viewLeft : 20, vw = okM ? m.viewWidth : 340;
    var vy = okM ? m.viewTop : 20, vh = okM ? m.viewHeight : 420;
    var x = Math.max(20, Math.round(vx + vw / 2 - bw / 2));
    var y = Math.max(20, Math.round(vy + vh / 2 - bh / 2));
    var boxes = [];
    try {
      ws.getTopBlocks(false).forEach(function (b) {
        var xy = b.getRelativeToSurfaceXY(), hw = b.getHeightWidth();
        boxes.push({ x: xy.x, y: xy.y, w: hw.width || 0, h: hw.height || 0 });
      });
    } catch (e) {}
    var 压住 = function (bx, by) {
      for (var i = 0; i < boxes.length; i++) {
        var o = boxes[i];
        if (bx < o.x + o.w + 12 && o.x < bx + bw + 12 && by < o.y + o.h + 12 && o.y < by + bh + 12) return true;
      }
      return false;
    };
    var guard = 0;
    while (guard++ < 60 && 压住(x, y)) y += 110;
    return { x: x, y: Math.max(0, y) };
  }

  /**
   * 给 XML 里的顶层代码**写好坐标**（插进去之前就定好位置）。
   *
   * 为什么不在插完再搬：真机上刚 domToWorkspace 的块还没渲染，那时候 moveBy 经常不生效，
   * 块就留在 XML 自带的老坐标上 —— 用户看到的"插入永远只放在一个固定位置"就是这么来的。
   * 先写进 XML，Blockly 建块时就落在正确位置；随后再按真实高度精修间距。
   */
  function aiPlaceXmlBlocks(dom, x, y, gap) {
    try {
      var root = dom && dom.documentElement;
      if (!root) return 0;
      var tops = [];
      for (var i = 0; i < root.childNodes.length; i++) {
        var n = root.childNodes[i];
        if (n.nodeType === 1 && n.tagName && String(n.tagName).toLowerCase() === 'block') tops.push(n);
      }
      var cy = y, g = (gap == null ? 16 : gap);
      tops.forEach(function (b) {
        b.setAttribute('x', String(Math.round(x)));
        b.setAttribute('y', String(Math.round(cy)));
        // 高度未知时先按 120 递进（渲染完 aiStackBlocks 会用真实高度再排一次）
        var h = 150;
        try {
          var hf = b.querySelector && b.querySelector('field[name="TEXT"]');
          if (hf) h = 100;
        } catch (e) {}
        cy += h + g;
      });
      return tops.length;
    } catch (e) { return 0; }
  }
  /**
   * 把代码放到位（给了屏幕坐标就落在那个点上，否则落在视口中心并避开已有代码）。
   *
   * `domOverride`：这次要插的东西。**拖拽只插"那一串"**，但绝不能因此改掉 aiPendingDom ——
   * 预览画布就是用 aiPendingDom 渲染的，一旦被替换成那一串，预览里就只剩刚拖走的那点代码了
   * （用户反馈："我拉出什么代码，那里显示就剩下什么代码了"）。
   */
  function aiInsertAtInner(clientX, clientY, domOverride) {
    var dom = domOverride || aiPendingDom;
    if (!dom) return 0;
    var ws = aiReadyWorkspace();
    if (!ws) throw new Error('代码工作区没准备好，请先打开「代码」页');
    aiUnfreezeXml(dom.documentElement);               // 保证插进去的代码是能拖能改的
    var at = (clientX != null) ? aiScreenToWs(clientX, clientY) : null;
    if (!at) {
      // 没给坐标（点按钮插入）：放当前视口中心，并避开已有代码 —— 不要固定落在一个点上
      at = aiInsertSpotFor(ws, 220, 90);
    }
    // **先把坐标写进 XML**，再建块。真机上"插进去再搬"经常不生效（块留在 XML 自带的老坐标上），
    // 用户看到的就是"插入永远只放在一个固定位置"。
    aiPlaceXmlBlocks(dom, at.x, at.y, 16);
    var created = Blockly.Xml.domToWorkspace(dom.documentElement, ws);
    var n = created ? created.length : 0;
    if (!n) return 0;
    window.__aiLastInsertAt = { x: at.x, y: at.y };   // 诊断用：这次插到哪儿了
    // 渲染完成后按**真实高度**再排一次（XML 里用的是估算高度）
    aiStackBlocks(created, at.x, at.y, 24);
    // 刚插进去的块在真机上要过一会儿才量得出高度，竖排可能退化成"叠在一起" —— 补几次重排。
    // 注意：这些补排是**视觉修正**，不能进撤销栈（否则"插一次要撤销两下"），所以期间关掉事件。
    [80, 260, 700].forEach(function (t) {
      setTimeout(function () {
        try {
          var 原状 = B.Events.isEnabled ? B.Events.isEnabled() : true;
          if (原状 && B.Events.disable) B.Events.disable();
          try { aiStackBlocks(created, at.x, at.y, 24); } finally { if (原状 && B.Events.enable) B.Events.enable(); }
        } catch (e) {}
      }, t);
    });
    return n;
  }

  function aiInsert() {
    if (!aiPendingDom) { aiSetStatus('还没有可插入的代码', true); return; }
    try {
      var n = aiInsertAt(null, null);
      autosave();
      aiSetStatus('已插入 ' + n + ' 组代码，拖到合适的位置即可');
    } catch (e) {
      aiSetStatus('插入失败：' + (e && e.message ? e.message : e), true);
    }
  }
  void aiInsert;   // 保留为无参插入的便捷入口（面板按钮现在走 aiCanvasInsert）

  /**
   * 预览页打开期间，**临时关掉主画布的触摸缩放**。
   *
   * 用户反馈的"放大穿透"就是这么来的：双指缩放时第二根手指常常落在预览框外面
   * （也就是后面的页面画布上），页面画布收到那一指就自己开始缩放 ——
   * 光靠 stopPropagation 拦不住（那一指的 target 本来就在主画布上）。
   * 关掉主画布的 pinch 之后，两指跨区也只影响预览。返回对话页/关面板时恢复。
   */
  function aiSetMainWsPinch(on) {
    try {
      var ws = state.ws;
      if (!ws || !ws.options) return;
      if (!ws.options.zoomOptions) ws.options.zoomOptions = {};
      ws.options.zoomOptions.pinch = !!on;
    } catch (e) {}
  }

  function aiShowCanvasPage(show) {
    var chat = $('aiChatPage'), cv = $('aiCanvasPage');
    if (!chat || !cv) return;
    if (show) { chat.classList.add('hidden'); cv.classList.remove('hidden'); }
    else { cv.classList.add('hidden'); chat.classList.remove('hidden'); }
    aiSetMainWsPinch(!show);      // 看预览时不许主画布跟着缩放
    // 看代码画布时把底部输入框收掉，画布能多占一大块（用户要求）
    var p = $('aiPanel');
    if (p) p.classList.toggle('ai-canvas-mode', !!show);
  }

  /** 预览画布的缩放（按钮/手势都走它） */
  function aiZoomBy(factor) {
    try {
      if (!aiPreviewWs) return;
      aiPreviewUserMoved = true;          // 用户自己调过视角，别再自动适应
      var s = (aiPreviewWs.getScale ? aiPreviewWs.getScale() : 1) * factor;
      s = Math.max(0.2, Math.min(3, s));
      aiPreviewWs.setScale(s);
      aiPreviewWs.scrollCenter();
    } catch (e) {}
  }

  /** 回到「自动适应窗口」（用户手动拖歪/放大之后一键复位） */
  function aiFitNow() {
    aiPreviewUserMoved = false;
    try { Blockly.svgResize && Blockly.svgResize(aiPreviewWs); } catch (e) {}
    aiFitPreview(true);
  }

  function aiOpenCanvas() {
    if (!aiPendingDom) { aiSetStatus('还没有生成的代码', true); return; }
    // 先显示再渲染：隐藏时容器尺寸是 0，Blockly 注入进去量不到大小
    aiShowCanvasPage(true);
    aiRenderPreview(aiPendingDom);
    setTimeout(function () {
      try { Blockly.svgResize && Blockly.svgResize(aiPreviewWs); } catch (e) {}
      aiFitPreview();
    }, 80);
  }

  function aiCanvasBack() {
    aiShowCanvasPage(false);
    setTimeout(aiScrollLogToEnd, 0);   // 回到对话页并滚到最新
  }

  /** 把画布上的代码（含用户在画布里拖开调整过的）插入到页面画布 */
  function aiCanvasInsert() {
    if (!aiPreviewWs) { snack('还没有生成的代码'); return; }
    try {
      // 预览区是只读的，workspaceToDom 会写上 movable="false" 之类的属性 ——
      // 必须在插入前清掉，否则插进去的代码是"冻住"的（拖不动、按上去等于按空白）
      if (!aiPreviewWs.getTopBlocks(true).length) { snack('画布上没有可插入的代码'); return; }
      var dom = Blockly.Xml.workspaceToDom(aiPreviewWs);
      aiUnfreezeXml(dom);
      // 以预览为准（用户在预览里看到的就是要插的）；但上面已确认预览非空，
      // 不会出现"把待插入内容清空"的情况
      aiPendingDom = { documentElement: dom };
      var n = aiInsertAt(null, null);
      autosave();
      aiShowCanvasPage(false);
      aiClosePanel();
      snack(n ? ('已放入画布 ' + n + ' 组') : '画布上没有可插入的代码');
    } catch (e) { snack('插入失败：' + (e && e.message ? e.message : e)); }
  }

  /**
   * 复制代码：全部 XML 进系统剪贴板（可贴到聊天/文档），
   * 同时留一份给画布右键菜单里的「粘贴 AI 复制的代码」。
   *
   * 为什么不用 `Blockly.clipboard.copy()`：它会把"来源工作区"记成**预览画布**，
   * 之后用户在主画布粘贴时，块会落进只读的预览里（或者干脆粘不出来）——
   * 用户报的"复制后在画布粘贴是灰的"就是这么来的。自己给一个永远可用的入口最稳。
   */
  function aiCanvasCopy() {
    if (!aiPreviewWs) return;
    try {
      var tops = aiPreviewWs.getTopBlocks(true);
      if (!tops.length) { snack('画布上没有可复制的代码'); return; }
      var s = new XMLSerializer().serializeToString(Blockly.Xml.workspaceToDom(aiPreviewWs));
      // 复制到系统剪贴板：原生优先；浏览器里 navigator.clipboard 可能被拒（headless/无权限），
      // 一旦有未处理的 Promise 拒绝就会变成 JS 报错，所以这里必须 catch 并兜底。
      var 复制成功 = false;
      if (window.Native && Native.copyText) { try { Native.copyText(s); 复制成功 = true; } catch (e) {} }
      if (!复制成功 && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          var pr = navigator.clipboard.writeText(s);
          if (pr && pr.catch) pr.catch(function () {});
          复制成功 = true;
        } catch (e) {}
      }
      if (!复制成功) {
        try {
          var ta = document.createElement('textarea');
          ta.value = s; ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          if (document.execCommand) document.execCommand('copy');
          ta.parentNode.removeChild(ta);
        } catch (e) {}
      }
      window.__aiCopiedXml = s;
      window.__aiCopiedBlocks = tops.length;
      /**
       * **打通两个剪贴板**：画布长按菜单里的「粘贴代码」看的是上面那个 `blockClipboard`，
       * 而 AI 面板的「复制」以前只写 __aiCopiedXml —— 两边不通，用户在 AI 面板复制完
       * 回到画布长按，看到的就是灰掉的「粘贴代码」（用户反馈"点击复制后去画布粘贴无效"）。
       */
      try { blockClipboard = s; } catch (e) {}
      if (window.__aiSyncPasteBtn) window.__aiSyncPasteBtn();   // 画布右下角的粘贴按钮亮起来
      // 顺便让 Blockly **自带的「粘贴」不灰**：需要一个"来源是主画布"的可复制对象。
      // 直接 copy(预览里的块) 会把来源记成只读预览，用户在主画布粘贴会粘不出来。
      try {
        var first = tops[0];
        if (Blockly.clipboard && Blockly.clipboard.copy && first && first.toCopyData && state.ws) {
          Blockly.clipboard.copy({
            workspace: state.ws,
            toCopyData: function () { try { return first.toCopyData(); } catch (e) { return null; } }
          });
        }
      } catch (e) {}
      snack('已复制 ' + tops.length + ' 组代码');
    } catch (e) { snack('复制失败：' + (e && e.message ? e.message : e)); }
  }

  /** 粘贴我们复制过的那份代码（画布右键菜单里的入口，永远不置灰） */
  function aiPasteCopiedInner() {
    var s = window.__aiCopiedXml;
    if (!s) { snack('还没有复制过代码'); return; }
    try {
      var xml = Blockly.utils.xml.textToDom(s);
      aiUnfreezeXml(xml);
      var ws = aiReadyWorkspace();
      if (!ws) { snack('代码工作区还没准备好'); return; }
      var created = Blockly.Xml.domToWorkspace(xml, ws);
      var at = aiInsertSpotFor(ws, 220, 90);
      aiStackBlocks(created, at.x, at.y, 24);
      autosave();
      snack('已粘贴 ' + created.length + ' 组代码');
      if (window.__aiSyncPasteBtn) window.__aiSyncPasteBtn();
    } catch (e) { snack('粘贴失败：' + (e && e.message ? e.message : e)); }
  }

  /**
   * 把「粘贴 AI 复制的代码」注册到画布菜单里（只注册一次）。
   *
   * 两个 scope 都要注册：手机上长按**空白处**是 workspace 菜单，长按**代码上**是 block 菜单 ——
   * 只注册 workspace 时，用户按在代码上长按就找不到这一项（"复制后粘贴无效"的来源之一）。
   */
  function aiRegisterPasteMenu() {
    try {
      if (window.__aiPasteMenuDone) return;
      var reg = Blockly.ContextMenuRegistry && Blockly.ContextMenuRegistry.registry;
      if (!reg || !reg.register) return;
      window.__aiPasteMenuDone = true;
      ['workspace', 'block'].forEach(function (scope) {
        reg.register({
          id: 'aiPasteCopiedBlocks_' + scope,
          scopeType: scope,
          displayText: function () { return '粘贴 AI 复制的代码'; },
          preconditionFn: function () { return window.__aiCopiedXml ? 'enabled' : 'disabled'; },
          callback: function () { aiPasteCopied(); },
          weight: 8
        });
      });
    } catch (e) {}
  }

  /**
   * 拦截画布上的 Ctrl/Cmd+V：只要我们用「复制」存过代码，就粘**全部**（Blockly 自带的一次只粘一块，
   * 而且它只认自己内部的剪贴板）。没有存过就不拦，交给 Blockly 自己。
   */
  function aiWirePasteShortcut() {
    if (window.__aiPasteKeyDone) return;
    window.__aiPasteKeyDone = true;
    document.addEventListener('keydown', function (e) {
      var k = e.key || '';
      if (!(k === 'v' || k === 'V') || !(e.ctrlKey || e.metaKey)) return;
      if (!window.__aiCopiedXml) return;
      // 只在"焦点在代码画布区域"时接管（别抢别处的粘贴）
      var t = e.target;
      var inWs = false;
      try {
        var div = $('blocklyDiv');
        inWs = !!(div && t && (div === t || div.contains(t)));
      } catch (err) {}
      if (!inWs) return;
      e.preventDefault();
      e.stopPropagation();
      aiPasteCopied();
    }, true);
  }

  /**
   * 拦住代码框里的事件，别让它"穿透"到后面的页面画布去 —— 用户反馈在框里双指缩放，
   * 结果放大的是后面那块画布。Blockly 自己也绑在这个容器上，所以用冒泡阶段拦截：
   * 让它的处理先跑完，再把事件掐在这里不往外传。
   */
  function aiGuardCanvasEvents() {
    var host = $('aiPreview');
    if (!host) return;
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel',
     'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup',
     'gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      host.addEventListener(t, function (e) { e.stopPropagation(); }, false);
    });
    // 面板本身也拦一道：手指滑出预览框但还在面板内时，别让事件冒到 document/主画布
    var panel = $('aiPanel');
    if (panel && !panel.__aiGuard) {
      panel.__aiGuard = true;
      ['touchmove', 'wheel'].forEach(function (t) {
        panel.addEventListener(t, function (e) {
          var cv = $('aiCanvasPage');
          if (cv && !cv.classList.contains('hidden')) e.stopPropagation();
        }, false);
      });
    }
  }





  /**
   * 打开面板：从悬浮球的圆形**逐渐拉成**面板的圆角矩形。
   * 之前是给面板做 scale，看起来像"弹出来"；现在直接对 left/top/width/height/border-radius
   * 做过渡，球的位置和大小就是起点，所以是真的"变形"。
   */
  /* ---------------- 面板可以按住顶栏拖动（用户要求） ----------------
     面板绝对定位在编辑器外壳里，坐标按外壳算。拖动时把它从"right/bottom 锚定"改成
     "left/top + 固定宽高"，这样才能自由摆放；位置尺寸存本机，下次打开还在（并夹回可视区）。
     双击顶栏 = 回到默认位置。 */
  var AI_PANEL_BOX = '__bb_ai_panel_box_v1';
  var AI_PANEL_HINT = '__bb_ai_panel_hint_v1';
  function aiPanelBox() {
    try {
      var v = JSON.parse(localStorage.getItem(AI_PANEL_BOX) || 'null');
      if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.w) && isFinite(v.h) && v.w > 80 && v.h > 80) return v;
    } catch (e) {}
    return null;
  }
  function aiSavePanelBox(b) { try { localStorage.setItem(AI_PANEL_BOX, JSON.stringify(b)); } catch (e) {} }
  /** 摆到"该在的位置"：拖过就用拖过的（夹回可视区），没拖过就交还给 CSS 默认锚定 */
  function aiApplyPanelBox(p) {
    if (!p) p = $('aiPanel');
    if (!p) return;
    var b = aiPanelBox(), host = $('viewEditor');
    if (!b || !host) {
      p.style.left = ''; p.style.top = ''; p.style.right = ''; p.style.bottom = '';
      p.style.width = ''; p.style.height = ''; p.style.borderRadius = '';
      return;
    }
    var hr = host.getBoundingClientRect();
    var w = Math.min(b.w, Math.max(160, hr.width)), h = Math.min(b.h, Math.max(200, hr.height));
    var x = Math.max(-w + 90, Math.min(b.x, Math.max(0, hr.width - 90)));
    var y = Math.max(0, Math.min(b.y, Math.max(0, hr.height - 44)));
    p.style.right = 'auto'; p.style.bottom = 'auto';
    p.style.left = Math.round(x) + 'px'; p.style.top = Math.round(y) + 'px';
    p.style.width = Math.round(w) + 'px'; p.style.height = Math.round(h) + 'px';
    p.style.borderRadius = '';
  }
  function aiWirePanelDrag() {
    var p = $('aiPanel'), head = p && p.querySelector('.ai-head');
    if (!head || head.__aiDragWired) return;
    head.__aiDragWired = true;
    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, box = null;
    head.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button,select,input,option')) return;  // 顶栏里的控件不是把手
      var host = $('viewEditor'); if (!host) return;
      var pr = p.getBoundingClientRect(), hr = host.getBoundingClientRect();
      box = { x: pr.left - hr.left, y: pr.top - hr.top, w: pr.width, h: pr.height };
      sx = e.clientX; sy = e.clientY; ox = box.x; oy = box.y;
      dragging = true; moved = false;
      p.style.transition = 'none';
      p.style.right = 'auto'; p.style.bottom = 'auto';
      p.style.width = box.w + 'px'; p.style.height = box.h + 'px';
      try { head.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.cancelable) e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 4) return;
      moved = true;
      var host = $('viewEditor'); if (!host) return;
      var hr = host.getBoundingClientRect();
      var x = ox + (e.clientX - sx), y = oy + (e.clientY - sy);
      x = Math.max(-box.w + 90, Math.min(x, Math.max(0, hr.width - 90)));
      y = Math.max(0, Math.min(y, Math.max(0, hr.height - 44)));
      p.style.left = Math.round(x) + 'px';
      p.style.top = Math.round(y) + 'px';
      if (e.cancelable) e.preventDefault();
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;                     // 只是点了一下顶栏，不算拖
      var host = $('viewEditor');
      if (host) {
        var pr = p.getBoundingClientRect(), hr = host.getBoundingClientRect();
        aiSavePanelBox({ x: Math.round(pr.left - hr.left), y: Math.round(pr.top - hr.top),
                         w: Math.round(pr.width), h: Math.round(pr.height) });
      }
      var hinted = null; try { hinted = localStorage.getItem(AI_PANEL_HINT); } catch (e) {}
      if (!hinted) {
        try { localStorage.setItem(AI_PANEL_HINT, '1'); } catch (e) {}
        
      }
    }
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    // 双击顶栏"归位"这个判定按用户要求关掉了（容易误触发，也不知道自己动了什么）
  }

  /**
   * 取悬浮球的**正常几何**（面板开合动画的起点/终点都用它）。
   *
   * 坑：面板打开时球带着 `morphing-out`（`transform: scale(.5)`），这时 `getBoundingClientRect()`
   * 量到的是**缩了一半**的尺寸（52 → 26）。以前关闭动画直接把这个 rect 当终点，于是面板
   * 先缩到 26×26、比球还小，松手后球又恢复 52 —— 用户看到的"先缩过头、再放大一下"。
   * 正确做法：尺寸用 offsetWidth/offsetHeight（不受 transform 影响），
   * 位置用 rect 的中心反推（scale 是绕中心缩放的，中心不变）。
   */
  function aiBallBox() {
    var ball = $('aiBall');
    if (!ball) return null;
    var r = ball.getBoundingClientRect();
    var w = ball.offsetWidth || r.width, h = ball.offsetHeight || r.height;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, centerX: cx, centerY: cy };
  }

  function aiOpenPanel() {
    var p = $('aiPanel'), ball = $('aiBall'), host = $('viewEditor');
    if (!p) return;
    aiClosing = false;   // 取消可能还在跑的关闭动画状态
    aiPositionChatList();   // 侧边栏范围跟着这次的面板尺寸走
    var hr = host ? host.getBoundingClientRect() : { left: 0, top: 0 };

    // 先按正常状态量一次面板的静止几何（拖过的话就是拖过的那个位置/尺寸）
    p.style.transition = 'none';
    p.style.transform = 'none';
    p.style.opacity = '1';
    p.classList.remove('hidden');
    p.classList.remove('morphing');
    aiApplyPanelBox(p);
    var pr = p.getBoundingClientRect();

    if (ball && pr.width > 10) {
      var br = aiBallBox() || ball.getBoundingClientRect();
      // 起点：球那个圆（用"正常几何"，不受 morphing-out 缩放影响）
      p.style.left = (br.left - hr.left) + 'px';
      p.style.top = (br.top - hr.top) + 'px';
      p.style.right = 'auto'; p.style.bottom = 'auto';
      p.style.width = br.width + 'px';
      p.style.height = br.height + 'px';
      p.style.borderRadius = '50%';
      p.classList.add('morphing');           // 里面的内容先隐形，变大后再淡入
      void p.offsetWidth;                    // 强制回流，让起点先生效
      p.style.transition = 'left .36s cubic-bezier(.22,.61,.36,1), top .36s cubic-bezier(.22,.61,.36,1), '
                         + 'width .36s cubic-bezier(.22,.61,.36,1), height .36s cubic-bezier(.22,.61,.36,1), '
                         + 'border-radius .36s ease';
      p.style.left = (pr.left - hr.left) + 'px';
      p.style.top = (pr.top - hr.top) + 'px';
      p.style.width = pr.width + 'px';
      p.style.height = pr.height + 'px';
      p.style.borderRadius = '';
      ball.classList.add('morphing-out');
      setTimeout(function () { p.classList.remove('morphing'); }, 170);
      setTimeout(function () {                 // 动画结束，交还给"该在的位置"（拖过就保持拖过的）
        p.style.transition = 'none';
        aiApplyPanelBox(p);
      }, 400);
    }

    // （标题旁边那行说明字已按用户要求去掉，元素不在了）
    aiRenderChats();
    aiRenderLog();
    // 打开面板（尤其是从球展开的那 0.4 秒里）内容尺寸还在变，滚到底要多补几次，
    // 否则用户看到的是"停在中间"（用户反馈：有时打开没滚到最底部）
    aiScrollLogToEnd();
    requestAnimationFrame(function () { aiScrollLogToEnd(); });
    setTimeout(aiScrollLogToEnd, 80);
    setTimeout(aiScrollLogToEnd, 220);
    setTimeout(aiScrollLogToEnd, 460);
    aiShowCanvasPage(false);
    if (!aiKeyRead()) aiSetStatus('先去「设置」里填一个 DeepSeek API Key，然后就能用了', true);
    else if (!$('aiStatus').textContent) aiSetStatus('想做什么？用一句话描述，我给你搭好代码。');
  }

  /**
   * 关闭面板：**变回那个圆球**（用户要这个动画）。
   *
   * 之前踩过的坑：直接把面板宽高动画到球那个圆形 —— 面板底色是白的，缩到最后就是一个"白球"，
   * 再"啪"地换成紫色悬浮球，看着很怪。现在还是在做"缩成球"，但**同时把底色过渡到球的紫色**，
   * 所以缩到最后那个圆球本身就是紫色的，和悬浮球严丝合缝地接上，中间不会再出现白球。
   */
  var aiClosing = false;
  function aiClosePanel() {
    var p = $('aiPanel'), ball = $('aiBall'), host = $('viewEditor');
    if (!p || p.classList.contains('hidden') || aiClosing) return;
    aiClosing = true;
    aiShowCanvasPage(false);
    var hr = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    var finish = function () {
      p.classList.add('hidden');
      p.classList.remove('morphing');
      p.style.transition = 'none';
      aiApplyPanelBox(p);          // 收完回到"该在的位置"（拖过就保持拖过的）
      p.style.transform = 'none'; p.style.opacity = '1'; p.style.backgroundColor = '';
      p.style.borderColor = ''; p.style.boxShadow = '';   // 复位描边/阴影（下次打开还是正常面板）
      if (ball) {
        ball.style.transition = 'none';
        ball.classList.remove('morphing-out');
        clearTimeout(ball.__aiBackTimer);
        ball.__aiBackTimer = setTimeout(function () { ball.style.transition = ''; }, 60);
      }
      aiClosing = false;
    };
    if (ball && host) {
      var pr = p.getBoundingClientRect();
      // 终点必须是球的**正常几何**：此刻球带着 morphing-out，直接量 rect 会得到 26×26，
      // 面板就会先缩过头、比球还小（用户反馈"先缩到比悬浮球还小，再放大回来"）。
      var br = aiBallBox() || ball.getBoundingClientRect();
      if (pr.width > 10) {
        // 起点：把当前几何写成显式数值（left 本来是 auto，从 auto 过渡是不生效的）
        p.style.transition = 'none';
        p.classList.remove('morphing');
        p.style.left = (pr.left - hr.left) + 'px';
        p.style.top = (pr.top - hr.top) + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto';
        p.style.width = pr.width + 'px';
        p.style.height = pr.height + 'px';
        p.style.borderRadius = '';                 // 起点=当前圆角矩形
        p.style.backgroundColor = '';              // 起点=面板底色
        void p.offsetWidth;                        // 强制回流：让起点生效
        var ballColor = '';
        try { ballColor = getComputedStyle(ball).backgroundColor || ''; } catch (e) {}
        // 终点：球的几何 + 球的颜色（颜色在后半段才变，前半段还是面板的样子）。
        // 注意：面板自带 1px 描边和阴影，缩到 26px 时那圈浅色描边就是用户看到的"白边"——
        // 所以描边颜色和阴影也一起过渡掉，最后交回 finish() 复位。
        p.style.transition = 'left .3s cubic-bezier(.22,.61,.36,1), top .3s cubic-bezier(.22,.61,.36,1), '
                           + 'width .3s cubic-bezier(.22,.61,.36,1), height .3s cubic-bezier(.22,.61,.36,1), '
                           + 'border-radius .3s ease, background-color .18s ease .12s, border-color .18s ease .12s, '
                           + 'box-shadow .2s ease';
        p.classList.add('morphing');               // 里面的内容先隐形，别跟着挤成一团
        p.style.left = (br.left - hr.left) + 'px';
        p.style.top = (br.top - hr.top) + 'px';
        p.style.width = br.width + 'px';
        p.style.height = br.height + 'px';
        p.style.borderRadius = '50%';
        if (ballColor) { p.style.backgroundColor = ballColor; p.style.borderColor = ballColor; }
        p.style.boxShadow = 'none';                // 缩成球的过程中不要再有面板那圈投影
        ball.classList.add('morphing-out');        // 球先藏着，收完这一瞬再换成实心的
        setTimeout(finish, 330);
        return;
      }
    }
    finish();
  }

  /** 悬浮球：可拖动，位置记在本地；拖动阈值区分「点一下打开」和「拖动」 */
  function wireAiBall() {
    var ball = $('aiBall');
    if (!ball) return;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(AI_BALL_POS) || 'null'); } catch (e) {}
    if (saved && isFinite(saved.x) && isFinite(saved.y)) {
      ball.style.left = saved.x + 'px'; ball.style.top = saved.y + 'px';
      ball.style.right = 'auto'; ball.style.bottom = 'auto';
    }
    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    ball.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      var r = ball.getBoundingClientRect();
      ox = r.left; oy = r.top;
      try { ball.setPointerCapture && ball.setPointerCapture(e.pointerId); } catch (err) {}   // 合成事件下会抛，容错
      e.preventDefault();
    });
    ball.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;   // 阈值内不算拖动
      moved = true;
      var host = $('viewEditor').getBoundingClientRect();
      var x = Math.min(Math.max(0, ox + dx - host.left), host.width - ball.offsetWidth);
      var y = Math.min(Math.max(0, oy + dy - host.top), host.height - ball.offsetHeight);
      ball.style.left = x + 'px'; ball.style.top = y + 'px';
      ball.style.right = 'auto'; ball.style.bottom = 'auto';
    });
    ball.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        try { localStorage.setItem(AI_BALL_POS, JSON.stringify({ x: parseInt(ball.style.left, 10), y: parseInt(ball.style.top, 10) })); } catch (err) {}
      } else {
        // 先布防"点击捕手"：真机 WebView 会在这次触摸后补发一次 ghost click，
        // 球如果盖住了导出之类的按钮，那一下就会穿透过去点到按钮（用户反馈）。
        if (typeof installClickCatcher === 'function') installClickCatcher();
        aiOpenPanel();     // 没拖动 = 点了一下
      }
    });
    ball.addEventListener('pointercancel', function () { dragging = false; });
  }

  /**
   * 判断某个屏幕点是否落在页面画布上。
   * ignorePanel=true 时不再因为"被 AI 面板压着"而判否 —— 拖拽期间面板会淡到很透明，
   * 用户是看得见下面那块画布的，手机上面板几乎盖满屏，不这样做根本没地方松手。
   */
  function aiPointOnCanvas(x, y, ignorePanel) {
    var d = $('blocklyDiv');
    if (!d) return false;
    var r = d.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    if (ignorePanel) return true;
    var p = $('aiPanel');
    if (p && !p.classList.contains('hidden')) {
      var pr = p.getBoundingClientRect();
      if (x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom) return false;
    }
    return true;
  }

  /** 拖拽时那个跟手的提示块上写什么：优先写第一块代码的内容，让用户知道手里拿的是什么 */
  function aiGhostLabel() {
    try {
      var b = aiPreviewWs && aiPreviewWs.getTopBlocks(true)[0];
      if (b && b.toString) {
        // toString(0) 不截断，自己截：Blockly 自带的截断会带上"..."，再被我切一刀就花了
        var s = String(b.toString(0)).replace(/\s+/g, ' ').trim();
        if (s) return '▦ ' + (s.length > 12 ? s.slice(0, 12) + '…' : s);
      }
    } catch (e) {}
    return '▦ 松手放到画布';
  }

  /**
   * 命中测试：屏幕坐标 (x,y) 落在预览画布的哪一块代码上？
   * 用户要求"**在代码上**拖动才拉出代码，拖空白处不要拉"，所以按下时必须先问这个。
   * 先按 DOM 元素找（Blockly 的代码 group 上带 data-id，最准），再按矩形兜底。
   */
  function aiPreviewBlockAt(x, y) {
    if (!aiPreviewWs) return null;
    var b = null;
    try {
      var el = document.elementFromPoint(x, y);
      // 注意：readOnly 工作区里 Blockly 会摘掉 .blocklyDraggable 类，只有 data-id 一直在
      var g = el && el.closest ? el.closest('[data-id]') : null;
      var id = g && g.getAttribute ? g.getAttribute('data-id') : '';
      b = id ? aiPreviewWs.getBlockById(id) : null;
    } catch (e) {}
    if (!b) {
      var tops = aiPreviewWs.getTopBlocks(true);
      for (var i = 0; i < tops.length; i++) {
        var g2 = tops[i].getSvgRoot && tops[i].getSvgRoot();
        if (!g2) continue;
        var r = g2.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { b = tops[i]; break; }
      }
    }
    if (!b) return null;
    // 点到**影子块**（输入框里那个默认小代码）时，往上取它所属的真实块 ——
    // 影子块不能作为顶层单独插出去，否则主画布直接报
    // "Shadow block cannot be a top-level block"（真机/测试都踩到过）。
    try {
      var guard = 0;
      while (b && b.isShadow && b.isShadow() && guard++ < 50) {
        var pb = b.getParent && b.getParent();
        if (!pb) break;
        b = pb;
      }
      if (b && b.isShadow && b.isShadow()) return null;
    } catch (e) {}
    return b;
  }

  /** 从这块开始、沿 next 往下的一串代码（用户要的"这块 + 它下方的代码"） */
  function aiBlockChain(root) {
    var out = [], b = root, guard = 0;
    while (b && guard++ < 200) { out.push(b); b = b.getNextBlock ? b.getNextBlock() : null; }
    return out;
  }

  /** 把一串代码导出成可插入的 XML（根必须是 <xml>，否则 domToWorkspace 一个都建不出来） */
  function aiChainXml(root) {
    try {
      var xml = Blockly.utils.xml.createElement('xml');
      xml.appendChild(Blockly.Xml.blockToDom(root));
      aiUnfreezeXml(xml);
      return { documentElement: xml, chainLen: aiBlockChain(root).length };
    } catch (e) { return null; }
  }

  /**
   * 把预览区里的代码**原样克隆**成一张跟着手指走的图。
   * 用户明确要求："要看到跟随一堆代码拖动，不要就拖一个提示出来"。
   * 只克隆**被按住的那一串**（那块 + 下方连接的代码），而不是预览里的全部。
   */
  function aiDragImageBuild(startX, startY, roots) {
    var list = (roots && roots.length) ? roots : (aiPreviewWs ? aiPreviewWs.getTopBlocks(true) : []);
    var rects = [], i;
    for (i = 0; i < list.length; i++) {
      var g = list[i] && list[i].getSvgRoot && list[i].getSvgRoot();
      if (!g || !g.getBoundingClientRect) continue;
      var r = g.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) rects.push({ g: g, r: r });
    }
    if (!rects.length) return null;
    var L = Math.min.apply(null, rects.map(function (o) { return o.r.left; }));
    var T = Math.min.apply(null, rects.map(function (o) { return o.r.top; }));
    var R = Math.max.apply(null, rects.map(function (o) { return o.r.right; }));
    var B = Math.max.apply(null, rects.map(function (o) { return o.r.bottom; }));
    var fullW = R - L, fullH = B - T;
    // 太大就等比缩一下，别把屏幕全挡住
    var k = Math.min(1, Math.min(window.innerWidth * 0.62, 430) / fullW, (window.innerHeight * 0.5) / fullH);
    var box = el('div', 'ai-dragimg');
    box.style.width = (fullW * k) + 'px';
    box.style.height = (fullH * k) + 'px';
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', fullW * k);
    svg.setAttribute('height', fullH * k);
    svg.setAttribute('viewBox', '0 0 ' + (fullW * k) + ' ' + (fullH * k));
    rects.forEach(function (o) {
      var bbox = null;
      try { bbox = o.g.getBBox(); } catch (e) {}
      if (!bbox || !bbox.width) return;
      var kk = o.r.width / bbox.width;                 // 这块在预览里被缩放的倍数
      var clone = o.g.cloneNode(true);
      clone.removeAttribute('transform');
      var wrap = document.createElementNS(NS, 'g');
      var dx = (o.r.left - L) * k, dy = (o.r.top - T) * k;
      wrap.setAttribute('transform', 'translate(' + dx + ',' + dy + ') scale(' + (k * kk) + ') '
        + 'translate(' + (-bbox.x) + ',' + (-bbox.y) + ')');
      wrap.appendChild(clone);
      svg.appendChild(wrap);
    });
    box.appendChild(svg);
    document.body.appendChild(box);
    return { el: box, w: fullW * k, h: fullH * k,
             grabX: (startX - L) * k, grabY: (startY - T) * k };
  }

  /**
   * 从 AI 面板的代码画布上把代码拖到页面画布上（用户要求的主路径）。
   * Blockly 不支持两个普通工作区之间互拖，所以这里自己接管指针：
   * 按住在预览上拖动 -> 面板淡出 -> **一整摞真代码**跟着手指走 -> 松手落在页面画布上就插进去。
   * 面板内的代码是只读的（拖不动、改不了），只有"往外拖"这一条路。
   */
  function wireAiPreviewDrag() {
    var host = $('aiPreview');
    if (!host || host.__aiDragWired) return;      // 只接一次
    host.__aiDragWired = true;
    var dragging = false, moved = false, sx = 0, sy = 0, ghost = null, img = null;
    var dragRoot = null;                          // 被按住的那块代码（拖的就是它 + 下方那一串）
    // 空白处拖动 = 平移画布（用户要求"画布也可以拖动"）。自己算，不依赖 Blockly 的手势。
    var panning = false, px0 = 0, py0 = 0, panX0 = 0, panY0 = 0, panK = 1;
    var panTx0 = 0, panTy0 = 0, panK0 = 1;   // 手势开始时的 translate/scale（落地基准）
    /**
     * 平移：**每帧直接调 Blockly 的 scroll**（和主画布拖动完全同一机制）。
     *
     * 走过一次弯路：想用 CSS transform 做"不闪的预览、松手再落地"，结果 CSS 那层
     * 在实际环境里没生效（画面不动），松手才跳一次，而且落地换算还差一个常量 ——
     * 用户看到的就是"方向反了、而且是闪过去的"。
     * 主画布拖动不闪、方向也对，因为它就是 scroll。这里照做：每帧一次（scheduleApply 已合并），
     * 不加任何中间层，位置全程正确、也就没有"落地跳位"这回事。
     */

    function onPanMove(e) {
      if (!panning || !aiPreviewWs) { aiGest.err = 'onPanMove 提前返回 panning=' + panning + ' ws=' + !!aiPreviewWs; return; }
      aiGest.apply++;
      var s = panScrollFrom(panX0, panY0, e.clientX - px0, e.clientY - py0);
      try { aiPreviewWs.scroll(s.x, s.y); aiGest.err = 'scroll(' + Math.round(s.x) + ',' + Math.round(s.y) + ')'; } catch (err) { aiGest.err = 'scroll 抛错: ' + err; }
      if (e.stopPropagation) e.stopPropagation();
    }
    /** 平移落地：把 CSS 上的临时位移写进 Blockly（松手时一次） */
    function panCommit(e) {
      // 平移已经每帧实时落地，这里只做收尾（清掉可能残留的 CSS 预览）
      var svg = previewSvg();
      if (svg && svg.style) { svg.style.transform = ''; svg.style.transformOrigin = ''; }
    }
    function stopPan() {
      panning = false; aiGest.panning = false;   // 事件由常驻分发器统一收（见下面的 onPointerMoveWin/onPointerUpWin）
    }
    function startPan(e) {
      if (!aiPreviewWs) return false;
      panning = true; aiGest.panning = true;
      px0 = e.clientX; py0 = e.clientY;
      panX0 = aiPreviewWs.scrollX || 0; panY0 = aiPreviewWs.scrollY || 0;
      panK = aiPreviewWs.getScale ? (aiPreviewWs.getScale() || 1) : 1;
      var t0 = currentCanvasTransform();
      panTx0 = t0.tx; panTy0 = t0.ty; panK0 = t0.k;    // 落地基准
      aiPreviewUserMoved = true;          // 用户自己在看某个位置，别再自动适应
      return true;
    }

    function killGhost() {
      if (ghost) { try { ghost.remove(); } catch (e) {} ghost = null; }
      if (img && img.el) { try { img.el.remove(); } catch (e) {} img = null; }
      try { document.body.classList.remove('ai-dragging'); } catch (e) {}
    }
    function onMove(e) {
      if (!dragging) return;
      if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 8) return;   // 阈值内不算拖
      if (!moved) {
        moved = true;
        // 跟手的是**真的代码图**：只克隆被按住的那一块 + 它下面连着的一串（用户明确要求）
        img = aiDragImageBuild(sx, sy, dragRoot ? aiBlockChain(dragRoot) : null);
        if (img) document.body.appendChild(img.el);
        else ghost = (function () { var g = el('div', 'ai-ghost', aiGhostLabel()); document.body.appendChild(g); return g; })();
        document.body.classList.add('ai-dragging');   // 面板淡下去，露出下面那块画布
      }
      if (img) {
        img.el.style.left = (e.clientX - img.grabX) + 'px';
        img.el.style.top = (e.clientY - img.grabY) + 'px';
        // 松手必须落在**页面画布**上才算数：拖回对话框 = 反悔，不插
        var onCanvas = aiPointOnCanvas(e.clientX, e.clientY, false);
        img.el.classList.toggle('over', onCanvas);
        img.el.classList.toggle('cancel', !onCanvas);
      } else if (ghost) {
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
        ghost.classList.toggle('over', aiPointOnCanvas(e.clientX, e.clientY, false));
      }
      if (e.cancelable) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();   // 拖拽期间别让 Blockly 拿去滚预览
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      var wasMoved = moved;
      var root = dragRoot;
      killGhost();
      moved = false; dragRoot = null;
      if (!wasMoved) return;                          // 没拖动 = 普通点击，交给 Blockly 自己处理
      // 只有落在页面画布上才插进去；拖回对话框/面板上就是"反悔了"，什么都不做
      if (!aiPointOnCanvas(e.clientX, e.clientY, false)) {
        var 在代码页 = false;
        try { 在代码页 = !$('viewBlocks').classList.contains('hidden'); } catch (e) {}
        aiSetStatus(在代码页 ? '已取消 —— 松手要落在左边的代码画布上才会放进去'
                            : '已取消 —— 先切到「代码」页，再把它拖到画布上（或者直接点「插入到画布」）', false);
        return;
      }
      try {
        // 只插"按住的那一块 + 它下方连着的一串"。**注意不要把 aiPendingDom 换掉** ——
        // 预览画布就是拿它渲染的，换掉之后预览里就只剩刚拖走的那点代码（用户反馈）。
        var chain = root ? aiChainXml(root) : null;
        var n = aiInsertAt(e.clientX, e.clientY, chain);
        autosave();
        // 用户要求：拖进去之后**别关对话框** —— 面板留在代码画布页，可以接着拖下一串
        snack('已放入画布');
      } catch (err) {
        aiSetStatus('拖放失败：' + (err && err.message ? err.message : err), true);
      }
    }
    // ── 手势总控（单指按代码=拖出去；单指按空白=平移；双指=缩放） ──
    //
    // 为什么整段自己实现：真机上 Blockly 的双指缩放在只读预览里不生效，而没被
    // preventDefault 的触摸会"穿透"到后面的页面画布、甚至触发 WebView 自己的页面缩放
    // （用户反馈："在对话框画布放大缩小没反应，但把后面的画布给放大缩小了"）。
    // 所以预览里的指针/触摸事件**一律吃掉**，缩放自己按双指距离算。
    var pts = {};                 // pointerId -> {x, y}
    var pinchD0 = 0, pinchS0 = 1;
    var pinchTarget = 0, pinchMx = 0, pinchMy = 0, pinchS1 = 1;   // 缩放落地用
    var pinchTx0 = 0, pinchTy0 = 0;                              // 缩放开始时的 translate（锚点补偿）

    function ptCount() { var n = 0, k; for (k in pts) if (pts.hasOwnProperty(k)) n++; return n; }
    function ptList() { var a = [], k; for (k in pts) if (pts.hasOwnProperty(k)) a.push(pts[k]); return a; }
    function dist2(a, b) { return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2)); }

    /**
     * 预览的 SVG 元素 —— 手势过程中我们只改它的 **CSS transform**。
     *
     * 为什么不每帧调 Blockly 的 scroll/setScale：那两个会触发 Blockly 的完整重排
     * （scroll 内部还会 hideChaff），一秒钟几十次，真机上看起来就是"闪"。
     * 主画布拖动时之所以不闪，就是因为它动的是画布的 transform，而不是每帧重排。
     * 这里照抄同一招：**手势期间纯 CSS（GPU 合成），松手时再落到 Blockly 上，落地一次**。
     */
    /**
     * 读当前内容层的 transform（Blockly 写成 `translate(tx,ty) scale(k)`）。
     * 手势期间我们要写 CSS transform —— 而 **CSS transform 会覆盖 SVG 的 transform 属性**，
     * 所以必须把原有的 translate/scale 一起写上，否则会丢掉缩放：
     * 表现就是"拖动时代码突然变大，松手又正常"（用户反馈）。
     */
    function currentCanvasTransform() {
      var g = previewSvg();
      var tx = 0, ty = 0, k = 1;
      try {
        // **Blockly 10 是用 CSS 的 style.transform 设置工作区层的**，SVG 的 transform 属性是空的 ——
        // 只读属性会永远得到 (0,0,1)，据此反推偏移就会算出完全错误的目标（表现：一按下就跳）。
        var css = (g && g.style && g.style.transform) ? g.style.transform : '';
        var attr = (g && g.getAttribute) ? (g.getAttribute('transform') || '') : '';
        var s = css || attr;
        var m = /translate\(\s*(-?[\d.]+)\s*px?[ ,]+(-?[\d.]+)\s*px?\s*\)/.exec(s);
        if (m) { tx = parseFloat(m[1]) || 0; ty = parseFloat(m[2]) || 0; }
        var m2 = /scale\(\s*(-?[\d.]+)/.exec(s);
        if (m2) k = parseFloat(m2[1]) || 1;
      } catch (e) {}
      return { tx: tx, ty: ty, k: k };
    }
    function setCanvasCss(dx, dy, kMul) {
      var g = previewSvg();
      if (!g || !g.style) return;
      var t = currentCanvasTransform();
      var k = t.k * (kMul || 1);
      g.style.transformOrigin = '0 0';
      g.style.transform = 'translate(' + (t.tx + (dx || 0)) + 'px,' + (t.ty + (dy || 0)) + 'px) scale(' + k + ')';
    }
    function previewSvg() {
      var h = $('aiPreview');
      if (!h) return null;
      // **只移动/缩放内容层**（blocklyBlockCanvas），不要动整个 svg：
      // 动整个 svg 会把画布底色一起拉走，露出容器的灰色（用户截图："把白色拉走了漏出灰色"）。
      // 主画布拖动时动的也是内容层，所以它不会露底。
      return h.querySelector('g.blocklyBlockCanvas') || h.querySelector('svg.blocklySvg');
    }

    /**
     * 把"目标 translate/scale"落地到 Blockly。
     *
     * Blockly 的内容层是 `translate(scrollX + absoluteLeft, scrollY + absoluteTop) scale(k)`
     * （源码 translateLayers 就是这么写的）—— **scrollX 并不等于 translate**：
     * 直接拿 scrollX 当 translate 落地会整体偏一个常量，表现就是"松手后闪到别处"。
     * 这里从当前 transform 反推出 absoluteLeft/Top，再据此设置 scroll，自洽、不依赖常量。
     */
    function commitCanvas(targetTx, targetTy, targetK) {
      if (!aiPreviewWs) return;
      try {
        if (targetK && aiPreviewWs.getScale && Math.abs((aiPreviewWs.getScale() || 1) - targetK) > 0.002) {
          aiPreviewWs.setScale(targetK);
        }
        var t = currentCanvasTransform();                     // setScale 之后的 translate
        var absX = t.tx - (aiPreviewWs.scrollX || 0);         // = absoluteLeft
        var absY = t.ty - (aiPreviewWs.scrollY || 0);
        aiPreviewWs.scroll(targetTx - absX, targetTy - absY);   // 像素语义
      } catch (e) {}
    }

    /** 双指缩放：手势期间用 CSS scale（以两指中点为原点），松手落地 */
    function aiPinchApply() {
      if (!aiPreviewWs) return;
      var two = ptList();
      if (two.length < 2) return;
      var d = dist2(two[0], two[1]);
      if (d < 4) return;
      // 基准没建立时（第二指 pointerdown 的时序在真机上不一定可靠）就用第一次移动的距离当基准，
      // 否则整个缩放会"完全没反应"（回归里抓到 d0=0 就是这个）。
      if (!pinchD0) {
        pinchD0 = d;
        pinchS0 = aiPreviewWs.getScale ? (aiPreviewWs.getScale() || 1) : 1;
        return;
      }
      var target = Math.max(0.2, Math.min(3, pinchS0 * (d / pinchD0)));
      var hostEl = $('aiPreview');
      if (!hostEl) return;
      var rect = hostEl.getBoundingClientRect();
      var mx = (two[0].x + two[1].x) / 2 - rect.left;
      var my = (two[0].y + two[1].y) / 2 - rect.top;
      // 以两指中点为锚：屏幕位置 = scrollX + 工作区坐标 × k，缩放前后中点下的工作区坐标不变。
      var s0 = aiPreviewWs.getScale ? (aiPreviewWs.getScale() || 1) : 1;
      var wx = (mx - (aiPreviewWs.scrollX || 0)) / s0;
      var wy = (my - (aiPreviewWs.scrollY || 0)) / s0;
      try {
        aiPreviewWs.setScale(target);
        aiPreviewWs.scroll(mx - wx * target, my - wy * target);   // 像素语义，不要取负
      } catch (err) {}
      pinchTarget = target; pinchMx = mx; pinchMy = my; pinchS1 = target;
      aiPreviewUserMoved = true;
    }

    /** 缩放落地：把 CSS 上的临时缩放真正写进 Blockly（只在松手时做一次） */
    function aiPinchCommit() {
      // 缩放已实时落地，这里只做收尾（清掉可能残留的 CSS 预览）
      var svg = previewSvg();
      if (svg && svg.style) { svg.style.transform = ''; svg.style.transformOrigin = ''; }
      pinchTarget = 0;
      aiPreviewUserMoved = true;
    }

    /** 放弃当前的单指操作（拖代码 / 平移画布），双指缩放要接管时调用 */
    function abortDrag() {
      dragging = false; moved = false; dragRoot = null; aiGest.dragging = false;
      stopPan();
      killGhost();
    }

    /**
     * 所有位移/缩放**每帧只算一次**（rAF 合并）。
     * 以前每个 pointermove 都直接 setScale+scroll，一秒钟几十次重排 ——
     * 真机上看起来就是"闪"（用户反馈：双指缩放和正常滑动都会闪）。
     */
    var framePending = false, lastEv = null;
    function scheduleApply() {
      if (framePending) return;
      framePending = true;
      var done = false;
      var run = function () {
        if (done) return;
        done = true;
        framePending = false;
        if (!lastEv) return;
        if (ptCount() >= 2) { aiPinchApply(); return; }   // 双指优先
        if (dragging) onMove(lastEv);
        else if (panning) onPanMove(lastEv);
      };
      // rAF 负责"每帧只算一次"（不闪），setTimeout 兜底 ——
      // 后台标签页/headless 里 rAF 可能完全不触发，只挂 rAF 就会"拖不动/滑不动"。
      if (window.requestAnimationFrame) window.requestAnimationFrame(run);
      setTimeout(run, 20);
    }

    function onPointerDown(e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (e.cancelable) e.preventDefault();          // 别让浏览器/后面的画布拿去用
      if (e.stopPropagation) e.stopPropagation();
      if (ptCount() >= 2) {
        abortDrag();                                 // 双指优先：放弃单指的拖拽/平移
        var two = ptList();
        var d = dist2(two[0], two[1]);
        pinchD0 = d > 4 ? d : 0;
        pinchS0 = (aiPreviewWs && aiPreviewWs.getScale) ? (aiPreviewWs.getScale() || 1) : 1;
        aiPreviewUserMoved = true;
        return;
      }
      aiGest.down++;
      // 注意：这里**不能**因为"当前没有待插入的代码"就直接 return。
      // 以前那行 `if (!aiPendingDom) return;` 会把整块画布的平移一起掐掉 ——
      // 画布上有代码、但不处于"待插入"状态时（看过代码、插过一次、换过对话…），
      // 用户看到的就是"代码画布滑不动"。平移只看有没有按在代码上，和待插入状态无关。
      var hit = aiPreviewBlockAt(e.clientX, e.clientY);
      if (!hit) { aiGest.hit = '空白（平移）'; startPan(e); return; }   // 空白处：平移画布
      if (!aiPendingDom) { aiGest.hit = '代码（不可拖出：没有待插入的代码）'; return; }   // 按在代码上、但没有可插入内容 → 不拖
      aiGest.hit = '代码（拖出去）';
      dragRoot = hit;                                // 按在代码上：拖出去
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
      aiGest.dragging = true;
    }

    function onPointerMoveWin(e) {
      aiGest.moves++; aiGest.pts = ptCount();
      if (pts[e.pointerId]) { pts[e.pointerId].x = e.clientX; pts[e.pointerId].y = e.clientY; }
      if (ptCount() >= 2) {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        // 双指缩放**立刻算**，不走 rAF 合并 —— 后台标签页/headless 里 rAF 可能不触发，
        // 那就变成"双指完全没反应"（回归里 pinch 调用数为 0 就是这个）。
        aiPinchApply();
        return;
      }
      if (dragging || panning) {
        lastEv = e;
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        scheduleApply();
      }
    }

    function onPointerUpWin(e) {
      var had = ptCount();
      delete pts[e.pointerId];
      if (had >= 2 && ptCount() < 2) {
        pinchD0 = 0; pinchTx0 = 0; pinchTy0 = 0;    // 复位锚点基准
        aiPinchCommit();          // 双指结束：把 CSS 上的缩放落到 Blockly（只这一次）
      }
      if (dragging) onUp(e);
      else if (panning) { panCommit(e); stopPan(); }   // 平移结束：落地一次
    }

    /**
     * pointerdown 挂在 **window 捕获阶段**，而不是宿主上。
     * 宿主上的监听在真机/合成事件下经常收不到（事件目标可能是里面的 SVG，或者事件被直接
     * 派发到宿主上），收不到的表现就是"代码拖不动、画布也滑不动"（回归诊断：按下计数为 0）。
     * 这里统一收，再用"目标/坐标是否落在预览框内"过滤。
     */
    window.addEventListener('pointerdown', function (e) {
      var hostEl = $('aiPreview');
      if (!hostEl) return;
      var t = e.target, inside = false;
      try { inside = (t === hostEl) || !!(hostEl.contains && hostEl.contains(t)); } catch (err) {}
      if (!inside) {
        try {
          var r = hostEl.getBoundingClientRect();
          inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        } catch (err2) {}
      }
      if (!inside) return;
      onPointerDown(e);
    }, true);
    window.addEventListener('pointermove', onPointerMoveWin, true);
    window.addEventListener('pointerup', onPointerUpWin, true);
    window.addEventListener('pointercancel', onPointerUpWin, true);
    // 触摸通道也一并吃掉：真机 WebView 的页面缩放手势走的是 touch 事件
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) {
      host.addEventListener(t, function (e) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }, { passive: false, capture: true });
    });
  }

  /* ---------------- AI 的控件操作 ----------------
     控件没法像代码那样"画出来预览"，所以这里把将要做的改动列成清单，用户确认后再应用。
     和代码一样：AI 只能用已知的控件类型和属性名，别的一律丢掉。 */
  // name 是"组件名称"（属性面板第一栏、列表里显示的那个名字），和显示文字 text 是两回事，
  // 早先漏了它，导致用户说"名字叫111"时 AI 只能猜成按钮文字。
  // AI 能改的控件属性 = 内容类 + **排版/外观类**。
  // 早先只放开了内容类，用户让 AI"帮我调一下排版"时它只能回"我没有位置、大小、间距、对齐
  // 这类属性，所以没法帮你调排版"（真机反馈）—— 属性面板里明明有这些字段，这里一并放开。
  var AI_COMP_PROPS = ['name', 'text', 'value', 'hint', 'alt', 'checked', 'min', 'max', 'items', 'url', 'src',
                       'start', 'end', 'dot', 'format',
                       'x', 'y', 'w', 'h', 'align', 'fs', 'spacing', 'bold', 'color', 'bg', 'radius', 'rot', 'opacity', 'inputType', 'variant', 'caretColor'];
  // 数值型属性的合理区间（设计像素）。null 是合法值，含义是"恢复自动排列 / 自适应"。
  var AI_NUM_RANGE = {
    x: [-4000, 4000], y: [-4000, 4000], w: [24, 2000], h: [16, 2000],
    fs: [8, 96], spacing: [-4, 40], radius: [0, 200]
  , rot: [-360, 360], opacity: [0, 100] };
  // 属性在"将要改动"清单里显示的中文名：列给用户确认时要像人话
  var AI_PROP_LABEL = {
    name: '组件名称', text: '文字', value: '值', hint: '提示', alt: '说明', checked: '选中',
    min: '最小值', max: '最大值', items: '列表项', url: '网址', src: '媒体',
    x: 'X距左', y: 'Y距顶', w: '宽度', h: '高度', align: '对齐', fs: '字号',
    spacing: '字间距', bold: '加粗', color: '文字颜色', bg: '背景颜色', radius: '圆角',
    rot: '旋转角度', opacity: '透明度', inputType: '输入框类型', variant: '下拉样式', caretColor: '箭头颜色',
    start: '开始日期', end: '结束日期', dot: '圆点颜色', format: '时间格式'
  };

  // 占位符：模型说"居中"时不用自己算数字（算错就偏，用户真机反馈过"弄得有点偏右"）
  var AI_CENTER = '__m3_center__';
  var AI_FULL = '__m3_full__';
  var AI_CENTER_TOKENS = ['center', 'middle', 'centre', '居中', '水平居中', '正中'];
  var AI_FULL_TOKENS = ['full', 'fill', '整宽', '铺满', '全宽', '满宽'];

  /** 颜色：只认 #RGB / #RRGGBB；空字符串=用回默认色；null=非法（丢掉这条） */
  function aiHex(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/^#?[0-9a-fA-F]{3}$/.test(s) || /^#?[0-9a-fA-F]{6}$/.test(s)) return '#' + s.replace(/^#/, '').toLowerCase();
    return null;
  }
  /** 洗一个属性值：数值夹区间、对齐/布尔认中英文、颜色认十六进制。undefined=这条不可用 */
  function aiCleanProp(k, v) {
    // "居中"/"整宽"这类词直接换成占位符，由应用时按画布宽度算准 —— 模型不用做算术
    if (k === 'x' && typeof v === 'string' && AI_CENTER_TOKENS.indexOf(v.trim().toLowerCase()) >= 0) return AI_CENTER;
    if (k === 'w' && typeof v === 'string' && AI_FULL_TOKENS.indexOf(v.trim().toLowerCase()) >= 0) return AI_FULL;
    if (Object.prototype.hasOwnProperty.call(AI_NUM_RANGE, k)) {
      if (v === null || v === '' || v === 'auto' || v === '自动' || v === '自适应') return null;
      var n = Number(v);
      if (!isFinite(n)) return undefined;
      var r = AI_NUM_RANGE[k];
      return Math.max(r[0], Math.min(r[1], Math.round(n)));
    }
    if (k === 'align') {
      var a = String(v == null ? '' : v).toLowerCase();
      if (a === '左' || a === 'left') return 'left';
      if (a === '中' || a === 'center' || a === 'centre' || a === '居中') return 'center';
      if (a === '右' || a === 'right') return 'right';
      return undefined;
    }
    if (k === 'bold' || k === 'checked') {
      if (typeof v === 'boolean') return v;
      var b = String(v == null ? '' : v).toLowerCase();
      if (b === 'true' || b === '1' || b === '是' || b === '加粗' || b === '选中') return true;
      if (b === 'false' || b === '0' || b === '否' || b === '正常' || b === '不选中') return false;
      return undefined;
    }
    if (k === 'color' || k === 'bg') { var hx = aiHex(v); return hx === null ? undefined : hx; }
    if (k === 'min' || k === 'max') { var m = Number(v); return isFinite(m) ? m : undefined; }
    if (k === 'items') {
      if (!Array.isArray(v)) return undefined;
      return v.slice(0, 60).map(function (x) { return String(x).slice(0, 120); });
    }
    if (v == null) return '';
    return String(v).slice(0, (k === 'url' || k === 'src') ? 600 : 300);
  }

  function aiCompProps(src, dropped) {
    var out = {};
    if (!src || typeof src !== 'object') return out;
    Object.keys(src).forEach(function (k) {
      if (AI_COMP_PROPS.indexOf(k) < 0) { if (dropped) dropped.push('不认识的属性 ' + k); return; }
      var v = aiCleanProp(k, src[k]);
      if (v === undefined) { if (dropped) dropped.push('属性 ' + k + ' 的值不可用'); return; }
      out[k] = v;
    });
    return out;
  }

  var AI_COMP_LABEL = { add: '新增', update: '修改', remove: '删除' };

  /** 给 AI 看的当前页面控件清单（带 id 和**当前排版**，方便它引用并计算该往哪挪） */
  function aiComponentSummary() {
    try {
      var sc = curScreen();
      var d = designSize();
      var head = '画布（设计像素）=' + d.w + '×' + d.h + '，原点在左上角（x 向右、y 向下）。';
      if (!sc || !sc.components || !sc.components.length) return head + '\n（这个页面还没有任何控件）';
      return head + '\n' + sc.components.map(function (c) {
        var extra = [];
        if (c.name) extra.push('名称=' + JSON.stringify(c.name));
        if (c.text != null) extra.push('文字=' + JSON.stringify(c.text));
        else if (c.value != null) extra.push('值=' + JSON.stringify(c.value));
        if (c.hint != null) extra.push('提示=' + JSON.stringify(c.hint));
        if (c.alt != null) extra.push('说明=' + JSON.stringify(c.alt));
        if (c.checked != null) extra.push('选中=' + c.checked);
        if (c.url) extra.push('网址=' + JSON.stringify(c.url));
        if (c.src) extra.push('媒体=' + JSON.stringify(c.src));
        if (Array.isArray(c.items)) extra.push('项数=' + c.items.length);
        // 排版：AI 得先"看见"现在是怎么摆的，才谈得上调位置/大小/对齐
        extra.push('位置=' + ((validN(c.x) && validN(c.y))
          ? '(' + Math.round(c.x) + ',' + Math.round(c.y) + ')' : '自动'));
        extra.push('大小=' + (validN(c.w) ? Math.round(c.w) : '自适应')
                           + '×' + (validN(c.h) ? Math.round(c.h) : '自适应'));
        if (c.align) extra.push('对齐=' + c.align);
        if (validN(c.fs)) extra.push('字号=' + c.fs);
        return '  ' + c.id + '  [' + c.type + ']  ' + extra.join(' ');
      }).join('\n');
    } catch (e) { return '（读取失败）'; }
  }

  /** 校验 AI 给的控件操作：类型/属性必须在白名单里，update/remove 必须指向真实存在的控件 */
  function aiValidateComponents(list) {
    var actions = [], dropped = [];
    if (!Array.isArray(list)) return { actions: actions, dropped: dropped };
    var comps = (curScreen() && curScreen().components) || [];
    list.forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var op = String(a.op || '').toLowerCase();
      if (op === 'add' || op === '新增') {
        var type = String(a.type || '');
        if (!TYPE_META[type]) { dropped.push('不认识的控件类型 ' + (type || '(空)')); return; }
        actions.push({ op: 'add', type: type, props: aiCompProps(a.props, dropped) });
        return;
      }
      if (op !== 'update' && op !== 'remove' && op !== '修改' && op !== '删除') { dropped.push('不认识的操作 ' + op); return; }
      var isRemove = (op === 'remove' || op === '删除');
      var id = String(a.id || '');
      var found = null;
      comps.forEach(function (c) { if (c.id === id) found = c; });
      if (!found) { dropped.push('找不到控件 ' + (id || '(空)')); return; }
      if (isRemove) { actions.push({ op: 'remove', id: id, type: found.type }); return; }
      var props = aiCompProps(a.props, dropped);
      if (!Object.keys(props).length) return;
      actions.push({ op: 'update', id: id, type: found.type, props: props });
    });
    return { actions: actions, dropped: dropped };
  }

  /** "将要改动"清单里属性的写法：用中文名，null 显示成"自动" */
  function aiDescribeProps(p) {
    var keys = Object.keys(p || {});
    if (!keys.length) return '';
    return '（' + keys.map(function (k) {
      return (AI_PROP_LABEL[k] || k) + '=' + (p[k] === null ? '自动' : JSON.stringify(p[k]));
    }).join('，') + '）';
  }

  /* ================= AI 修复闭环 =================
     用户的两条需求：
       A. 运行时发现问题但不知道是哪段代码：让 AI 找出来后给出替换方案，确认即替换；
       B. 直接把画布上的代码**拖进对话框**（本体代码留在画布），可以拖多段、可以删掉不要的，
          然后描述问题，AI 改完给方案，确认后替换画布上对应的那段。
     实现：暂存区 aiStaged（每段是完整 XML + 来源块 id）+ fixes 数组 + 一键替换。 */

  var aiStaged = [];      // [{ key, xml, label, fromId }]
  var aiPendingFixes = null;

  /** 一段代码的短标签（拿第一个文本类字段 + block type） */
  function aiBlockLabel(b) {
    var txt = '';
    // 优先用 Blockly 自己的可读摘要（例如"弹出提示 你好 显示 秒 2"），比 raw type 友好得多
    try { if (b && b.toString) txt = String(b.toString(26) || '').replace(/\s+/g, ' ').trim(); } catch (e) { txt = ''; }
    if (!txt) {
      try {
        if (b && b.getFieldValue) {
          ['TEXT', 'MSG', 'NAME', 'VALUE', 'COLOR'].forEach(function (f) {
            if (txt) return;
            try { var v = b.getFieldValue(f); if (v != null && String(v).trim()) txt = String(v).trim(); } catch (e) {}
          });
        }
      } catch (e) {}
    }
    if (!txt) txt = (b && b.type) || '代码';
    return txt.length > 22 ? (txt.slice(0, 22) + '…') : txt;
  }

  /** 把画布上的一段代码复制进暂存区（本体代码不动） */
  function aiStageAddBlock(b) {
    window.__stageTried = (window.__stageTried || 0) + 1;
    if (!b) { window.__stageErr = '块为空'; return false; }
    try {
      var xml = Blockly.utils.xml.createElement('xml');
      xml.appendChild(Blockly.Xml.blockToDom(b));
      aiStaged.push({ key: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                      xml: Blockly.Xml.domToText(xml), label: aiBlockLabel(b), fromId: b.id });
      aiStageRender();
      snack('已放进对话框'); diagPush('drag-in', '把代码放进对话框');
      return true;
    } catch (e) { window.__stageErr = String(e && e.message || e); snack('放进对话框失败：' + (e && e.message ? e.message : e)); return false; }
  }

  function aiStageRender() {
    var box = $('aiStaged');
    if (!box) return;
    box.innerHTML = '';
    if (!aiStaged.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var head = el('div', 'ai-staged-head');
    head.appendChild(el('span', 't', '拖进来的代码（' + aiStaged.length + ' 段）'));
    var clear = el('button', 'ai-staged-clear', '清空');
    clear.addEventListener('click', function (e) { e.stopPropagation(); aiStaged = []; aiStageRender(); });
    head.appendChild(clear);
    box.appendChild(head);
    var row = el('div', 'ai-staged-row');
    aiStaged.forEach(function (it) {
      var chip = el('div', 'ai-staged-chip');
      chip.appendChild(el('span', 't', it.label));
      var x = el('button', 'x', '✕');
      x.title = '移除这一段';
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        aiStaged = aiStaged.filter(function (k) { return k !== it; });
        aiStageRender();
      });
      chip.appendChild(x);
      row.appendChild(chip);
    });
    box.appendChild(row);
  }

  /** 拖进对话框时给模型看的上下文 */
  function aiStagedContext() {
    if (!aiStaged.length) return '';
    var out = '\n\n【用户从画布拖进对话框的代码：共 ' + aiStaged.length + ' 段（本体代码仍留在画布上）】\n';
    aiStaged.forEach(function (it, i) {
      out += '--- 第 ' + i + ' 段 ---\n' + String(it.xml).slice(0, 2400) + '\n';
    });
    out += '用户认为问题就出在这些代码里。请**逐段给出"修复后的完整代码"**，用 fixes 返回：\n'
         + '  {"fixes":[{"index":0,"reason":"一句话说明改了什么","blocks":"<xml ...>完整替换版本</xml>"}]}\n'
         + '  · index 就是上面的段号（从 0 开始）；只给需要改的段，不改的不要出现。\n'
         + '  · blocks 必须是**整段可替换的完整 XML**（含事件帽子代码），不要给片段或补丁。\n'
         + '  · 用户说"删掉这段/这段多余"时，用 {"index":0,"delete":true,"reason":"..."}（不需要 blocks）。\n'
         + '  · 如果不确定问题在哪，就在 reply 里说明并给一句 ask 让用户补充。\n';
    return out;
  }

  /** 用户没拖代码时，也把画布上的代码分段给 AI，让它能"指出第几段有问题" */
  function aiPageBlocksContext() {
    var ws = state.ws;
    if (!ws || !ws.getTopBlocks) return '';
    var tops = [];
    try {
      ws.getTopBlocks(true).forEach(function (b) { if (!(b.isShadow && b.isShadow())) tops.push(b); });
    } catch (e) { return ''; }
    if (!tops.length) return '';
    var out = '\n\n【画布上的代码（"第 N 段"就是从 0 开始的序号）】\n';
    tops.slice(0, 10).forEach(function (b, i) {
      var xml = Blockly.utils.xml.createElement('xml');
      xml.appendChild(Blockly.Xml.blockToDom(b));
      out += '--- 第 ' + i + ' 段' + (b.disabled ? '（已停用）' : '') + ' ---\n' + Blockly.Xml.domToText(xml).slice(0, 1600) + '\n';
    });
    out += '如果问题出在某一段（或某几段），请给出**替换方案**：\n'
         + '  {"fixes":[{"index":0,"reason":"一句话说明改了什么","blocks":"<xml ...>完整替换版本</xml>"}]}\n'
         + '  · index 用上面的段号；只给需要改的段，不改的不要出现。\n'
         + '  · 不确定是哪一段时，用 reply 说明你的判断，并可用 ask 让用户补充现象。\n';
    return out;
  }

  /**
   * 用词兜底：App 里统一叫"代码"。提示词里已经要求模型别说"积木"，
   * 但历史对话/模型偶发仍会带出来，所以**显示与入库前再统一替换一次**，保证用户看不到"积木"。
   */
  function aiDeJargon(s) { return String(s == null ? '' : s).replace(/积木/g, '代码'); }
  /** 校验模型返回的 fixes（支持两种动作：替换 / 删除） */
  function aiValidateFixes(raw) {
    if (!raw || !raw.length) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < 8; i++) {
      var f = raw[i];
      if (!f || typeof f !== 'object') continue;
      var idx = Number(f.index);
      if (!isFinite(idx) || idx < 0) continue;
      var 要删 = (f.delete === true || f.del === true || f.remove === true);
      if (要删) {
        // 删除：不需要 blocks
        out.push({ index: Math.round(idx), reason: String(f.reason || '').trim(), del: true, doc: null });
        continue;
      }
      var checked = null;
      try { checked = aiValidateXml(f.blocks || f.xml || ''); } catch (e) { checked = null; }
      if (!checked) continue;
      out.push({ index: Math.round(idx), reason: String(f.reason || '').trim(), del: false, doc: checked.doc });
    }
    return out;
  }

  /** 展示"修复方案"卡片（列出每段改了什么 + 一个确认替换按钮） */
  function aiRenderFixes(fixes) {
    aiPendingFixes = (fixes && fixes.length) ? fixes : null;
    var wrap = $('aiFixWrap'), list = $('aiFixList');
    if (!wrap || !list) return;
    list.innerHTML = '';
    var ops = aiFixOps;
    if (!aiPendingFixes) { wrap.classList.add('hidden'); if (ops) ops.classList.add('hidden'); return; }
    if (ops) ops.classList.remove('hidden');
    aiPendingFixes.forEach(function (f) {
      var li = el('li', 'ai-fix-item');
      var where = aiStaged[f.index] ? ('拖进来的第 ' + (f.index + 1) + ' 段')
                                    : ('画布第 ' + (f.index + 1) + ' 段');
      li.appendChild(el('b', 'w', where));
      li.appendChild(el('span', 'r', (f.del ? '删除这一段' : '替换为修复版本') + (f.reason ? ('：' + f.reason) : '')));
      list.appendChild(li);
    });
    wrap.classList.remove('hidden');
  }

  /** 一键替换：把 fix 对应的那段代码换成 AI 给的版本（位置沿用原来那段） */
  /**
   * 把一整段操作合成"一步撤销"。
   * Blockly 的撤销是按事件分组的：不分组时，AI 一次应用（先删旧段、再放新段）会产生好几步，
   * 用户按一次撤销只回退一半，看着像"撤不干净"。这里把整段包成一组。
   */
  /* 一层薄包装：把"一次 AI 落地/插入/粘贴/拖入复位"合成一步撤销 */
  function aiApplyFixes() { return asOneUndoStep(aiApplyFixesInner); }
  function aiInsertAt(a, b, c) { return asOneUndoStep(function () { return aiInsertAtInner(a, b, c); }); }
  function aiPasteCopied() { return asOneUndoStep(aiPasteCopiedInner); }
  /* ---------------- 诊断日志（真机出问题时一键导出，不用用户口述） ----------------
     记：页面级异常、被 promise 吞掉的错误、console.error、以及我们自己的关键动作。
     存最近 200 条到 localStorage，这样"试运行/导出"页面的报错在切回编辑器后也能看到。 */
  var DIAG_KEY = '__bb_diag_v1';
  var diagLog = [];
  function diagLoad() {
    try { var a = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]'); if (Array.isArray(a)) diagLog = a; } catch (e) { diagLog = []; }
  }
  function diagPush(kind, msg) {
    try {
      diagLog.push({ t: new Date().toISOString().slice(11, 23), k: String(kind || ''), m: String(msg == null ? '' : msg).slice(0, 600) });
      if (diagLog.length > 200) diagLog = diagLog.slice(-200);
      localStorage.setItem(DIAG_KEY, JSON.stringify(diagLog));
    } catch (e) {}
  }
  window.__diag = diagPush;   // 运行时/其它页面也能往这里写
  function diagText() {
    var head = [];
    try {
      head.push('FAST 诊断信息');
      head.push('时间: ' + new Date().toString());
      head.push('页面: ' + location.href);
      head.push('屏幕: ' + window.innerWidth + 'x' + window.innerHeight + ' dpr=' + (window.devicePixelRatio || 1));
      head.push('UA: ' + (navigator.userAgent || ''));
      head.push('Blockly: ' + (window.Blockly ? 'ok' : '缺失') + '  代码页: ' + (state && state.view));
      var scr = (state && state.project && state.project.screens) || [];
      head.push('工程: 页面 ' + scr.length + ' 个，控件 ' + (((state.project || {}).screens || []).reduce(function (n, s) { return n + ((s.components || []).length); }, 0)) + ' 个');
      try { head.push('主画布: ' + JSON.stringify({ x: Math.round(state.ws.scrollX || 0), y: Math.round(state.ws.scrollY || 0), scale: state.ws.getScale ? state.ws.getScale() : 1 })); } catch (e) {}
      head.push('AI: 模型=' + (window.EditorApp && EditorApp.__aiModel ? EditorApp.__aiModel() : '?') + ' 深度思考=' + (aiThinkOn ? aiThinkOn() : '?'));
      // 版本号：从 script 的 ?v= 里取（构建时注入）
      var sc = document.querySelector('script[src*="editor.js?v="]');
      head.push('版本(build): ' + (sc ? String(sc.getAttribute('src')).split('?v=')[1] : '未知'));
    } catch (e) {}
    var body = diagLog.map(function (r) {
      var x = r.x || {}, 位置 = [];
      if (x.title || x.screen) 位置.push('页面=' + (x.title || x.screen));
      if (x.seg != null && x.seg !== '') 位置.push('第 ' + x.seg + ' 段');
      if (x.api) 位置.push('动作=' + x.api);
      return r.t + '  [' + r.k + '] ' + (位置.length ? '(' + 位置.join('、') + ') ' : '') + r.m;
    });
    return head.join('\n') + '\n\n--- 最近记录（新在后） ---\n' + (body.length ? body.join('\n') : '（暂无）') + '\n';
  }
  function wireDiag() {
    diagLoad();
    window.addEventListener('error', function (ev) {
      try { diagPush('error', (ev && ev.message ? ev.message : 'error') + ' @ ' + ((ev && ev.filename) || '?') + ':' + ((ev && ev.lineno) || '?')); } catch (e) {}
    });
    window.addEventListener('unhandledrejection', function (ev) {
      try { var r = ev && ev.reason; diagPush('promise', (r && (r.message || r)) || 'unhandled'); } catch (e) {}
    });
    try {
      var ce = console.error;
      console.error = function () { try { diagPush('console', Array.prototype.map.call(arguments, function (a) { return (a && a.message) ? a.message : String(a); }).join(' ')); } catch (e) {} return ce.apply(console, arguments); };
    } catch (e) {}
    wireDiagBtn();
  }
  /** 「查看 / 导出诊断信息」的点击绑定。
      以前这个绑定写在 wireDiag()（只有打开工程、初始化画布时才跑）——
      所以从首页直接进设置点它是没反应的（用户 2026-10-29 报的）。现在 init 里也会调一次，重复调用无副作用。 */
  function wireDiagBtn() {
    var btn = $('btnDiag');
    if (!btn || btn.__diagWired) return;
    btn.__diagWired = true;
    btn.addEventListener('click', function () {
      var txt = '';
      try { txt = diagText(); } catch (e) { txt = '诊断信息读取失败：' + ((e && e.message) || e); }
      openDiagPage(txt);
    });
  }
  /** 诊断信息：独立整页（用户 2026-10-29 报的两个问题 ——
      ① 点它会"自己返回首页"，其实那是先把设置关掉再弹窗，看着像被踢出去；
      ② 弹窗太小还得在弹窗里滚。现在改成整页：设置原样留在下面，返回只回设置，不回家。） */
  function openDiagPage(txt) {
    var pre = $('diagPre');
    if (pre) pre.textContent = txt;
    var st = $('viewSettings');
    if (st) st.classList.add('hidden');
    var v = $('viewDiag');
    if (v) { v.classList.remove('hidden'); 切页(v, 'fwd'); }
  }
  function closeDiagPage() {
    var v = $('viewDiag');
    if (!v || v.classList.contains('hidden')) return false;
    v.classList.add('hidden');
    var st = $('viewSettings');
    if (st) { st.classList.remove('hidden'); 切页(st, 'back'); 同步分段药丸(); }
    return true;
  }
  function asOneUndoStep(fn) {
    var grouped = false;
    try { if (window.Blockly && Blockly.Events && Blockly.Events.setGroup) { Blockly.Events.setGroup(true); grouped = true; } } catch (e) {}
    try { return fn(); }
    finally { if (grouped) { try { Blockly.Events.setGroup(false); } catch (e) {} } }
  }
  function aiApplyFixesInner() {
    var fixes = aiPendingFixes;
    if (!fixes || !fixes.length) { snack('没有可替换的修复方案'); return 0; }
    var ws = aiReadyWorkspace();
    if (!ws) { snack('代码工作区没准备好'); return 0; }
    var 成功 = 0, 失败 = 0;
    fixes.forEach(function (f) {
      try {
        var target = null;
        var st = aiStaged[f.index];
        if (st && st.fromId && ws.getBlockById) target = ws.getBlockById(st.fromId);
        if (!target) {
          var tops = ws.getTopBlocks(true).filter(function (b) { return !(b.isShadow && b.isShadow()); });
          target = tops[f.index] || null;
        }
        var at = null;
        if (target) {
          try { var xy = target.getRelativeToSurfaceXY(); at = { x: xy.x, y: xy.y }; } catch (e) { at = null; }
          target.dispose(true);          // 连下方一串一起删掉
        }
        if (f.del) {                      // 只要删除：删完就结束这一段
          if (target) 成功++; else 失败++;
          return;
        }
        aiUnfreezeXml(f.doc.documentElement);
        var created = Blockly.Xml.domToWorkspace(f.doc.documentElement, ws);
        if (created && created.length) {
          if (at) aiStackBlocks(created, at.x, at.y, 16);
          成功++;
        } else { 失败++; }
      } catch (e) { 失败++; }
    });
    if (成功) {
      // 替换掉的暂存段就没用了，清掉，避免下次又按旧内容改
      aiStaged = [];
      aiStageRender();
      aiRenderFixes(null);
      autosave();
    }
    snack(成功 ? ('已替换 ' + 成功 + ' 段代码') : '替换失败');
    return 成功;
  }

  /** 把"从画布拖进对话框"接上：按下记录是哪一段，松手时若落在面板里就复制进暂存区 */
  function aiWireCanvasDragIn() {
    var host = document.getElementById('blocklyDiv');
    if (!host || host.__aiDragInWired) return;
    host.__aiDragInWired = true;
    var dragBlock = null, startSnap = null, sx = 0, sy = 0, movedFar = false;
    window.__dragInProbe = { down: 0, hit: 0, dragStart: 0, grabbed: '' };

    /**
     * 把一段代码放回原位。
     * 注意：Blockly 自己的拖拽收尾（吸附/连接/边界回弹）是在我们这个捕获阶段**之后**才跑的，
     * 所以必须在它跑完之后再复位 —— 以前在 pointerup 里立刻 moveBy，随后就被它覆盖了，
     * 表现就是"拖进对话框后没回到原来的位置"（用户反馈）。这里多补几次，幂等。
     */
    /**
     * 造一份"整段快照"：这串代码（含它下面挂着的所有块）的 XML + 全部块 id + 顶层位置。
     *
     * 为什么要快照而不是只记住"最上面那块"：拖一串里**下面**的某一块时，Blockly 会把这串
     * 拆开、把那块重连到别处，链子的形状就变了；只把最上面那块挪回去，看着就是"没归位"
     * （用户反馈："接了事件帽的，但拖了下面的，没有归位"）。
     * 有了快照就可以整段重建，形状和位置都能精确还原。
     */
    function makeSnapshot(top) {
      try {
        var xy = top.getRelativeToSurfaceXY();
        // 收集这串里的**所有**块 id：输入里的块 + <next> 链上的块都要（漏了就会留下半截链子）
        var ids = [], seen = {};
        (function walk(b) {
          if (!b || !b.id || seen[b.id]) return;
          seen[b.id] = 1; ids.push(b.id);
          try { if (b.getChildren) b.getChildren(false).forEach(walk); } catch (e) {}
          try { if (b.nextConnection && b.nextConnection.targetBlock) walk(b.nextConnection.targetBlock()); } catch (e) {}
        })(top);
        var dom = Blockly.Xml.blockToDom(top);
        // blockToDom 默认**不带坐标**，重建后会跑到默认位置 (10,10) —— 必须自己补上
        try { dom.setAttribute('x', String(Math.round(xy.x))); dom.setAttribute('y', String(Math.round(xy.y))); } catch (e) {}
        var xml = Blockly.utils.xml.createElement('xml');
        xml.appendChild(dom);
        return { ids: ids, xml: Blockly.Xml.domToText(xml), x: xy.x, y: xy.y, topId: top.id };
      } catch (e) { return null; }
    }
    /**
     * 安全还原：Blockly 还在拖拽时绝不能删块重建（会把画布搅乱），
     * 所以忙就稍后再试。返回 true 表示这次真的动过。
     */
    function tryRestoreSnapshot(snap, attempt) {
      attempt = attempt || 0;
      var busy = false;
      try { busy = !!(state.ws && state.ws.isDragging && state.ws.isDragging()); } catch (e) {}
      try { if (document.querySelector('.blocklyDragging')) busy = true; } catch (e) {}
      if (busy && attempt < 8) { setTimeout(function () { tryRestoreSnapshot(snap, attempt + 1); }, 120); return false; }
      return restoreSnapshot(snap);
    }
    // 作用域提醒：工作区那边的"复位看护"（initWorkspace 里）看不到这里的函数，
    // 所以挂一份引用出去，否则看护一触发就是 ReferenceError（拖进对话框后不会归位）。
    state.__tryRestoreSnapshot = tryRestoreSnapshot;
    /** 快照还原（包一层：整段还原 = 一步撤销） */
    function restoreSnapshot(snap) { return asOneUndoStep(function () { return restoreSnapshotInner(snap); }); }
    /** 快照还原：把这次拖拽涉及的所有块删掉，再按快照重建并放回原位置。 */
    function restoreSnapshotInner(snap) {
      if (!snap || !snap.xml || !state.ws) return false;
      var ws = state.ws;
      try {
        // 已经完好？位置对、结构也还是一串 —— 直接跳过（避免反复重建）
        var root = ws.getBlockById(snap.topId);
        if (root && !root.getParent()) {
          var xy0 = root.getRelativeToSurfaceXY();
          var 位置对 = Math.abs(xy0.x - snap.x) < 2 && Math.abs(xy0.y - snap.y) < 2;
          if (位置对) {
            // 光"块都还在"不够：被拆开的块也还在（只是掉成了独立的一段）。
            // 必须每个 id 都还**连在这串上**才算完好 —— 否则就会跳过还原（踩过这个坑）。
            var 串没散 = snap.ids.every(function (id) {
              if (id === snap.topId) return true;
              var b = ws.getBlockById(id);
              return !!(b && b.getParent && b.getParent());
            });
            if (串没散) return false;
          }
        }
      } catch (e) {}
      try { if (Blockly.Events && Blockly.Events.disable) Blockly.Events.disable(); } catch (e) {}
      try {
        snap.ids.forEach(function (id) {
          var b = ws.getBlockById(id);
          if (b) { try { b.dispose(true); } catch (e) {} }
        });
        var dom = Blockly.utils.xml.textToDom(snap.xml);
        aiUnfreezeXml(dom);
        var created = Blockly.Xml.domToWorkspace(dom, ws);
        var top = (created && created.length) ? created[0] : null;
        if (top) {
          var xy = top.getRelativeToSurfaceXY();
          top.moveBy(snap.x - xy.x, snap.y - xy.y);
        }
      } catch (e) {}
      try { if (Blockly.Events && Blockly.Events.enable) Blockly.Events.enable(); } catch (e) {}
      try { autosave(); } catch (e) {}
      return true;
    }

    host.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      window.__dragInProbe.down++;
      window.__dragInGrabbed = null;
      pendingRestore = {};    // 用户一碰画布，之前的「复位看护」一律作废（否则切后台回来拖画布会闪回）
      var exact = aiCanvasBlockAt(e.clientX, e.clientY, true);   // 手指按住的那一块
      var topBlock = aiCanvasBlockAt(e.clientX, e.clientY);      // 它所在的整串顶端（还原用）
      if (exact) window.__dragInProbe.hit++;
      dragBlock = exact; sx = e.clientX; sy = e.clientY; movedFar = false;
      startSnap = makeSnapshot(topBlock || exact);               // 快照按整串记
      pendingRestore = {};
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!dragBlock) return;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) movedFar = true;
    }, true);
    document.addEventListener('pointerup', function (e) {
      var b = window.__dragInGrabbed || dragBlock;     // 优先用 Blockly 告知的"被抓的块"
      var st = startSnap;
      var 在面板 = aiPointerOverPanel(e.clientX, e.clientY);
      window.__dragInProbe.up = (window.__dragInProbe.up || 0) + 1;
      window.__dragInProbe.有块 = !!b; window.__dragInProbe.在面板 = 在面板;
      window.__dragInProbe.有快照 = !!st; window.__dragInProbe.移动过 = movedFar;
      dragBlock = null; startSnap = null;
      window.__dragInGrabbed = null;
      if (!b) return;
      if (!在面板) return;
      // 拖进对话框：复制一份进暂存区；画布上那段必须**回到原位**（本体代码保持不变）。
      // Blockly 的拖拽收尾在我们之后跑，所以复位要等它跑完，并补几次（幂等）。
      aiStageAddBlock(b);
      // 整段按快照还原：Blockly 的收尾可能比我们晚很多，还可能在"拖了下面那块"时把链子拆开重接，
      // 所以定时补几次 + 登记看护（随后 2 秒内只要这串被改动就再还原一次）。
      [140, 300, 600, 1000, 1600, 2200].forEach(function (t) {
        setTimeout(function () { tryRestoreSnapshot(st); }, t);
      });
      if (st && st.topId) {
        pendingRestore[st.topId] = { snap: st, until: Date.now() + 2200, tries: 0 };
      }
    }, true);
    document.addEventListener('pointercancel', function () { dragBlock = null; startSnap = null; }, true);
  }

  /** 屏幕坐标落在画布的哪一段顶层代码上 */
  /** 屏幕坐标下命中的块（keepExact=true 时**不**上升到链子顶端，就是手指按住的那一块） */
  function aiCanvasBlockAt(x, y, keepExact) {
    try {
      var el = document.elementFromPoint(x, y);
      var g = el && el.closest ? el.closest('[data-id]') : null;
      var id = g && g.getAttribute ? g.getAttribute('data-id') : '';
      var ws = state.ws;
      var b = (id && ws && ws.getBlockById) ? ws.getBlockById(id) : null;
      if (!b) return null;
      // 影子块不能当"独立的一段"，先升到它所属的真实块
      try {
        if (b.isShadow && b.isShadow() && b.getParent) { var pb = b.getParent(); if (pb) b = pb; }
      } catch (e) {}
      if (keepExact) return b;
      var top = b, guard = 0;
      while (top && top.getParent && top.getParent() && guard++ < 200) top = top.getParent();
      return top;
    } catch (e) { return null; }
  }

  function aiPointerOverPanel(x, y) {
    try {
      var p = $('aiPanel');
      if (!p || p.classList.contains('hidden')) return false;
      var r = p.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    } catch (e) { return false; }
  }

  function aiRenderCompActions(actions) {
    var ul = $('aiCompList'), wrap = $('aiCompWrap'), ops = $('aiCompOps');
    if (!ul || !wrap) return;
    ul.innerHTML = '';
    actions.forEach(function (a) {
      var li = el('li', a.op);
      li.appendChild(el('span', 'op', AI_COMP_LABEL[a.op] || a.op));
      var label = (TYPE_META[a.type] && TYPE_META[a.type].label) || a.type;
      if (a.op === 'add') li.appendChild(document.createTextNode(label + aiDescribeProps(a.props)));
      else if (a.op === 'remove') li.appendChild(document.createTextNode(label + ' ' + a.id));
      else li.appendChild(document.createTextNode(a.id + '（' + label + '）→ ' + aiDescribeProps(a.props).replace(/^（|）$/g, '')));
      ul.appendChild(li);
    });
    wrap.classList.toggle('hidden', actions.length === 0);
    // 「应用这些改动」和「打开代码画布」现在是同一层级的动作行，一起显示/隐藏
    if (ops) ops.classList.toggle('hidden', actions.length === 0);
  }

  /**
   * 把一串属性落到控件上。**先放尺寸、再算居中** —— 'x':'center' 要拿"最终的宽度"来算，
   * 如果按对象里键的先后顺序先算了 x，宽度还没改，算出来就是偏的（真机反馈过"居中偏右"）。
   */
  function aiApplyProps(c, props) {
    var keys = Object.keys(props || {});
    var centers = [];
    if (Object.prototype.hasOwnProperty.call(props || {}, 'x') && props.x !== AI_CENTER) c.cx = false;  // 手填坐标=放弃居中锁
    keys.forEach(function (k) {
      if (k === 'w' || k === 'h') aiApplyProp(c, k, props[k]);
    });
    keys.forEach(function (k) {
      if (k === 'w' || k === 'h') return;
      if (k === 'x' && props[k] === AI_CENTER) { centers.push(props[k]); return; }
      aiApplyProp(c, k, props[k]);
    });
    centers.forEach(function (v) { aiApplyProp(c, 'x', v); });   // 这时候宽度已经定下来了
  }

  /**
   * 落一个属性到控件上。'x':'center' / 'w':'full' 这两个占位符在这里按**画布宽度**算准 ——
   * 与其让模型自己做 (画布宽-控件宽)/2 的算术（它算错过，用户反馈"居中偏右"），不如这里算。
   * 写成 "center" 还会打上**居中锁**（c.cx），以后改宽度会自动重新居中。
   */
  function aiApplyProp(c, k, v) {
    var d = designSize();
    if (k === 'x' && v === AI_CENTER) {
      c.cx = true;
      c.x = centeredX(validN(c.w) ? c.w : naturalSize(c.type, c).w);
      return;
    }
    if (k === 'w' && v === AI_FULL) { c.w = Math.max(24, Math.round(d.w - 48)); applyCenterLock(c); return; }
    c[k] = v;
    if (k === 'w' || k === 'h') applyCenterLock(c);          // 改宽高后重新居中（中心点永远在中间）
    if (k === 'x') c.cx = false;                             // 手填了 x = 放弃居中锁
  }

  /** 应用控件改动。走的是和手动添加/删除同一套数据操作，改完照常重绘与自动保存。 */
  function aiApplyComponents() {
    if (!aiPendingComps || !aiPendingComps.length) return 0;
    var sc = curScreen(), done = 0;
    aiPendingComps.forEach(function (a) {
      try {
        if (a.op === 'add') {
          var base = { id: genId(a.type), type: a.type };
          // 和 addComponent 一样：默认属性要拷贝，别让同类控件共用一个 children/items 数组
          var def = clone(COMPONENT_DEFAULTS[a.type] || {});
          Object.keys(def).forEach(function (k) { base[k] = def[k]; });
          // 先给默认尺寸，再盖 AI 的 props —— 顺序不能反：反了 AI 指定的宽高会被默认值冲掉
          var ns = naturalSize(a.type, base);
          base.w = ns.w; if (ns.h) base.h = ns.h;
          aiApplyProps(base, a.props);
          sc.components.unshift(base);
          state.selectedCompId = base.id;
          done++;
        } else if (a.op === 'remove') {
          var before = sc.components.length;
          sc.components = sc.components.filter(function (c) { return c.id !== a.id; });
          if (sc.components.length !== before) done++;
        } else if (a.op === 'update') {
          sc.components.forEach(function (c) {
            if (c.id !== a.id) return;
            aiApplyProps(c, a.props);
            done++;
          });
        }
      } catch (e) { console.error('应用控件改动失败', e); }
    });
    try {
      renderCompList();
      if (state.inLayout) renderLayout();
      autosave();
    } catch (e) {}
    return done;
  }

  /* ---------------- 模板库（路线图 1.2）：一键把"整页骨架"搭出来（控件 + 代码） ----------------
     做法：模板只声明"要哪些控件 + 要什么代码"，代码用真实块搭一遍再导出 XML
     （手写 XML 很容易和块定义对不上，改块定义就会静默错）。 */
  function 找语句槽(b) {
    var 槽 = null, 目标 = (B.ConnectionType && B.ConnectionType.NEXT_STATEMENT) || 3;
    try {
      (b.inputList || []).forEach(function (i) {
        if (槽 || !i.connection) return;
        if (i.connection.type === 目标) 槽 = i.connection;
      });
    } catch (e) {}
    return 槽;
  }
  function 模板XML(段列表) {
    var ws = new B.Workspace();
    function 设字段(b, f) { Object.keys(f || {}).forEach(function (k) { try { b.setFieldValue(String(f[k]), k); } catch (e) {} }); }
    try {
      var xml = B.utils.xml.createElement('xml');
      段列表.forEach(function (段) {
        var 帽 = ws.newBlock(段.t);
        设字段(帽, 段.f);
        var 槽 = 找语句槽(帽), 前一个 = null;
        (段.做 || []).forEach(function (d) {
          var 子 = ws.newBlock(d.t);
          设字段(子, d.f);
          Object.keys(d.值 || {}).forEach(function (输入名) {
            var v = d.值[输入名];
            var 值块 = ws.newBlock(v.t);
            设字段(值块, v.f);
            try { 子.getInput(输入名).connection.connect(值块.outputConnection); } catch (e) {}
          });
          try {
            if (!前一个) { if (槽) 槽.connect(子.previousConnection); }
            else 前一个.nextConnection.connect(子.previousConnection);
          } catch (e) {}
          前一个 = 子;
        });
        xml.appendChild(B.Xml.blockToDom(帽));
      });
      return B.Xml.domToText(xml);
    } catch (e) { console.error('模板XML', e); return ''; }
    finally { try { ws.dispose(); } catch (e) {} }
  }
  /** 模板代码：ids 是刚才建出来的控件 id（按 key 取），用到哪个控件就传哪个 */
  function 值块文字(s) { return { t: 'text', f: { TEXT: s } }; }
  var TEMPLATES = [
    {
      id: 'login', name: '登录页', desc: '标题 + 账号 + 密码 + 登录按钮，点击弹提示并震动',
      build: function (ids) {
        return { components: [
          { key: '标题', type: 'text',    props: { x: 24, y: 40,  w: 260, h: 40, value: '欢迎回来', fs: 22, bold: true } },
          { key: '账号', type: 'input',   props: { x: 24, y: 110, w: 260, h: 52, hint: '手机号 / 邮箱' } },
          { key: '密码', type: 'input',   props: { x: 24, y: 180, w: 260, h: 52, hint: '密码', inputType: 'password' } },
          { key: '登录', type: 'button',  props: { x: 24, y: 260, w: 260, h: 52, text: '登录' } }
        ], code: [
          { t: 'ev_click', f: { COMP: ids['登录'] }, 做: [
            { t: 'act_toast', f: {}, 值: { MSG: 值块文字('登录成功') } },
            { t: 'act_vibrate', f: {}, 值: { MS: { t: 'math_number', f: { NUM: 30 } } } }
          ] }
        ] };
      }
    },
    {
      id: 'list', name: '列表页', desc: '标题 + 三条数据的列表，点某项弹出选中内容',
      build: function (ids) {
        return { components: [
          { key: '标题', type: 'text', props: { x: 24, y: 30, w: 260, h: 36, value: '今日任务', fs: 20, bold: true } },
          { key: '列表', type: 'list', props: { x: 24, y: 90, w: 280, h: 220, items: ['买牛奶', '写作业', '跑步 20 分钟'] } }
        ], code: [
          { t: 'ev_itemclick', f: { COMP: ids['列表'] }, 做: [
            { t: 'act_toast', f: {}, 值: { MSG: { t: 'val_selected_item', f: { COMP: ids['列表'] } } } }
          ] }
        ] };
      }
    },
    {
      id: 'timer', name: '秒表页', desc: '计时器 + 开始/停止按钮',
      build: function (ids) {
        return { components: [
          { key: '计时器', type: 'timer',  props: { x: 40, y: 60,  w: 200, h: 56, text: '00:00' } },
          { key: '开始', type: 'button', props: { x: 24, y: 170, w: 120, h: 52, text: '开始' } },
          { key: '停止', type: 'button', props: { x: 170, y: 170, w: 120, h: 52, text: '停止' } }
        ], code: [
          { t: 'ev_click', f: { COMP: ids['开始'] }, 做: [{ t: 'act_timer_countup', f: { COMP: ids['计时器'] } }] },
          { t: 'ev_click', f: { COMP: ids['停止'] }, 做: [{ t: 'act_timer_stop', f: { COMP: ids['计时器'] } }] }
        ] };
      }
    },
    {
      id: 'form', name: '报名表', desc: '姓名输入 + 同意开关 + 提交按钮',
      build: function (ids) {
        return { components: [
          { key: '标题', type: 'text',    props: { x: 24, y: 30,  w: 260, h: 36, value: '活动报名', fs: 20, bold: true } },
          { key: '姓名', type: 'input',   props: { x: 24, y: 90,  w: 260, h: 52, hint: '你的名字' } },
          { key: '同意', type: 'switch',  props: { x: 24, y: 165, w: 240, h: 40, text: '同意活动规则' } },
          { key: '提交', type: 'button',  props: { x: 24, y: 235, w: 260, h: 52, text: '提交报名' } }
        ], code: [
          { t: 'ev_click', f: { COMP: ids['提交'] }, 做: [
            { t: 'act_toast', f: {}, 值: { MSG: 值块文字('报名已提交') } }
          ] }
        ] };
      }
    },
    {
      id: 'about', name: '关于页', desc: '卡片 + 说明文字 + 分隔线 + 联系按钮',
      build: function (ids) {
        return { components: [
          { key: '卡片', type: 'card',   props: { x: 20, y: 40,  w: 290, h: 140, text: 'FAST 制作的第一个 App' } },
          { key: '文字', type: 'text',   props: { x: 24, y: 200, w: 280, h: 60, value: '这是一个用 FAST 拖出来的页面。', fs: 15 } },
          { key: '线',   type: 'divider', props: { x: 24, y: 280, w: 280, h: 2 } },
          { key: '联系', type: 'button', props: { x: 24, y: 320, w: 280, h: 52, text: '联系我们' } }
        ], code: [
          { t: 'ev_click', f: { COMP: ids['联系'] }, 做: [
            { t: 'act_toast', f: {}, 值: { MSG: 值块文字('感谢使用 FAST') } }
          ] }
        ] };
      }
    }
  ];
  /**
   * 套用模板：控件走 AI 那条通道加进去（自动 id / 默认属性 / 一起参与撤销），
   * 代码用"真实块搭一遍再导出"的方式生成 XML，最后整段插入画布 —— 全程**一步撤销**。
   */
  function applyTemplate(tplId) {
    var tpl = null;
    TEMPLATES.forEach(function (t) { if (t.id === tplId) tpl = t; });
    if (!tpl) return null;
    var sc = curScreen();
    var 前数 = sc.components.length;
    var ids = {};
    var 结果 = { 控件: 0, 代码: 0 };
    asOneUndoStep(function () {
      // ① 先造控件，拿到真实 id（模板代码要靠它）
      var 骨架 = tpl.build({});
      if (骨架.components && 骨架.components.length) {
        aiPendingComps = 骨架.components.map(function (c) { return { op: 'add', type: c.type, props: c.props || {} }; });
        aiApplyComponents();
        aiPendingComps = null;
        var 新 = sc.components.slice(0, sc.components.length - 前数);   // unshift 进来，顺序是反的
        var 反 = 新.slice().reverse();
        反.forEach(function (c, i) {
          var key = 骨架.components[i] && 骨架.components[i].key;
          if (key) ids[key] = c.id;
        });
        结果.控件 = 新.length;
      }
      // ② 用真实 id 生成代码并插进画布
      var 第二遍 = tpl.build(ids);
      var xml = 模板XML(第二遍.code || []);
      if (xml) {
        var checked = aiValidateXml(xml);
        if (checked) { aiInsertAtInner(null, null, checked.doc); 结果.代码 = (第二遍.code || []).length; }
      }
    });
    renderCompList(); if (state.inLayout) renderLayout();
    autosave();
    return 结果;
  }
  /** 模板库面板：列出模板，点一条就搭出来。关闭按钮做成"悬浮在列表右上角"的小圆钮（用户要求） */
  function openTemplates() {
    var old = $('tplSheet'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = el('div', 'mask'); wrap.id = 'tplSheet';
    var box = el('div', 'modal sheet-modal tpl-modal fill');
    var 关 = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    var x = el('button', 'tpl-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '关闭模板库');
    x.title = '关闭';
    x.addEventListener('click', function (e) { e.stopPropagation(); 关(); });
    box.appendChild(x);
    box.appendChild(el('div', 'mtitle', '模板库'));
    var body = el('div', 'mbody');
    body.appendChild(el('div', 'tpl-sub', '选一个模板，控件和代码一次搭好（插进来的代码可以一步撤销）'));
    TEMPLATES.forEach(function (t) {
      var row = el('button', 'tpl-item'); row.type = 'button'; row.setAttribute('data-tpl', t.id);
      row.appendChild(el('div', 'tpl-name', t.name));
      row.appendChild(el('div', 'tpl-desc', t.desc));
      row.addEventListener('click', function () {
        var r = applyTemplate(t.id);
        关();
        if (r) snack('已套用「' + t.name + '」：' + r.控件 + ' 个控件' + (r.代码 ? ' + ' + r.代码 + ' 段代码' : ''));
      });
      body.appendChild(row);
    });
    box.appendChild(body);
    wrap.appendChild(box);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) 关(); });
    document.body.appendChild(wrap);
  }

  /* ---------------- 调试体验：把"运行时报错的那一段"标回画布上 ----------------
     运行时出错时会把 段号/页面/动作 写进诊断日志（见 runtime.js 的 diagPush）。
     回到编辑器后我们读出来：如果就是当前这一页，就把那一段高亮 + 居中显示，
     用户不用自己一段段找。同一段只提示一次（记在 __bb_seg_seen）。 */
  var SEG_SEEN_KEY = '__bb_seg_seen';
  function 找段块(seg) {
    try {
      var ws = state.ws;
      if (!ws || !ws.getTopBlocks) return null;
      var tops = ws.getTopBlocks(true).filter(function (b) { return !(b.isShadow && b.isShadow()); });
      return tops[seg] || null;
    } catch (e) { return null; }
  }
  /** 高亮画布上第 seg 段（给块套一圈醒目描边，2.6 秒后自动褪掉） */
  function 高亮段(seg) {
    var b = 找段块(seg);
    if (!b) return false;
    try {
      var root = b.getSvgRoot && b.getSvgRoot();
      if (root) {
        root.classList.add('bb-seg-flash');
        setTimeout(function () { try { root.classList.remove('bb-seg-flash'); } catch (e) {} }, 2600);
      }
    } catch (e) {}
    try { if (state.ws.centerOnBlock) state.ws.centerOnBlock(b.id); } catch (e) {}
    try { if (state.ws.highlightBlock) state.ws.highlightBlock(b.id); } catch (e) {}
    return true;
  }
  /** 回到编辑器后调用：最近一次运行时报错如果是当前页的，就把那段标出来（每段只提示一次） */
  function showRuntimeErrorOnce() {
    try {
      var 报错 = aiRuntimeIssues(1);
      if (!报错.length) return false;
      var a = JSON.parse(localStorage.getItem('__bb_diag_v1') || '[]');
      var 末 = null;
      for (var i = a.length - 1; i >= 0 && !末; i--) {
        if (a[i] && /代码执行失败|运行时错误|运行时Promise/.test(String(a[i].k || ''))) 末 = a[i];
      }
      if (!末 || !末.x || 末.x.seg == null) return false;
      var 页 = String(末.x.screen || '');
      if (页 && state.curScreenId && 页 !== state.curScreenId) return false;   // 不是当前页，别乱标
      var 记号 = String(末.t || '') + '#' + 末.x.seg;
      if (localStorage.getItem(SEG_SEEN_KEY) === 记号) return false;
      try { localStorage.setItem(SEG_SEEN_KEY, 记号); } catch (e) {}
      if (state.view !== 'blocks') showView('blocks');
      var ok = 高亮段(Number(末.x.seg));
      if (ok) snack('上次运行第 ' + 末.x.seg + ' 段出错了，已经帮你标出来');
      return ok;
    } catch (e) { return false; }
  }
  function wireRuntimeErrorHint() {
    // 打开工程后、以及从运行/导出返回时各查一次（都只提示一次）
    [400, 1200, 2400].forEach(function (t) { setTimeout(showRuntimeErrorOnce, t); });
    try {
      window.addEventListener('pageshow', function () { setTimeout(showRuntimeErrorOnce, 600); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(showRuntimeErrorOnce, 600); });
    } catch (e) {}
  }

  function wireAi() {
    wireAiBall();
    var close = $('aiClose'), send = $('aiSend');
    if (close) close.addEventListener('click', aiClosePanel);
    if (send) send.addEventListener('click', aiGenerate);
    // 「看报错」：把运行时日志变成一句话直接发出去（没报错就让 AI 整体查一遍）
    var diagBtn = $('aiDiagBtn');
    if (diagBtn) diagBtn.addEventListener('click', function () {
      if (aiBusy) { aiSetStatus('正在生成中，等这次结束（或点「终止」）再看报错', true); return; }
      var inp = $('aiInput');
      if (inp) inp.value = aiDiagnoseText();
      aiGenerate();
    });
    var applyComp = $('aiCompApply');
    if (applyComp) applyComp.addEventListener('click', function () {
      var n = aiApplyComponents();
      if (!n) { aiSetStatus('没有可应用的控件改动', true); return; }
      aiPendingComps = null;
      $('aiCompWrap').classList.add('hidden');
    $('aiCompOps').classList.add('hidden');
      aiSetStatus('已应用 ' + n + ' 项控件改动');
      snack('已应用 ' + n + ' 项控件改动');
    });
    // 代码画布页：打开 / 返回 / 插入 / 复制
    var openCv = $('aiOpenCanvas'), backCv = $('aiCanvasBack'), insCv = $('aiCanvasInsert'),
        copyCv = $('aiCanvasCopy');
    if (openCv) openCv.addEventListener('click', aiOpenCanvas);
    if (backCv) backCv.addEventListener('click', aiCanvasBack);
    if (insCv) insCv.addEventListener('click', aiCanvasInsert);
    if (copyCv) copyCv.addEventListener('click', aiCanvasCopy);
    // 点聊天区域就收起侧边栏（原来点了没反应，用户反馈）
    var body = document.querySelector('#aiPanel .ai-body');
    if (body) body.addEventListener('click', function () {
      if (aiIsChatListOpen()) aiShowChatList(false);      // 走动画收起
    });
    var inp = $('aiInput');
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aiGenerate(); }
    });
    // 把画布上的代码拖进对话框（复制进暂存区，本体代码不动）
    aiWireCanvasDragIn();
    aiStageRender();
    var fixBtn = $('aiFixApply');
    if (fixBtn) fixBtn.addEventListener('click', function () { aiApplyFixes(); });

    // 设置里的 API Key
    var keyInput = $('aiKey'), keyBtn = $('aiKeyTest');
    function keyHint() {
      var v = (keyInput && keyInput.value || '').trim();
      var st = $('aiKeyStatus');
      if (!st) return;
      if (!v) { st.textContent = aiKeyRead() ? ('已保存：' + aiKeyMask(aiKeyRead())) : '还没有填 Key'; return; }
      st.textContent = '已保存到本机：' + aiKeyMask(v);
    }
    if (keyInput) {
      var k0 = aiKeyRead();
      var keyTouched = false;      // 用户这次真的动过输入框才允许 blur 写回
      keyInput.value = k0 ? k0 : '';
      // **边打边存**（以前只在 change 时存：手机上打完直接切走/点生成时，Key 其实还没保存，
      // 于是助手一直说"先去设置里填 Key"）。字符串很小，不需要防抖，直接写。
      keyInput.addEventListener('input', function () {
        keyTouched = true;
        aiKeyWrite(keyInput.value);
        keyHint();
      });
      keyInput.addEventListener('change', function () {
        keyTouched = true;
        aiKeyWrite(keyInput.value);
        aiSetStatus('');
        keyHint();
      });
      // blur 只在"这次真的编辑过"时才写：否则输入框里可能是空的旧值，
      // 一次误触失焦就会把已保存的 Key 用空值盖掉（真的发生过）。
      keyInput.addEventListener('blur', function () {
        if (!keyTouched) { keyHint(); return; }
        aiKeyWrite(keyInput.value);
        keyHint();
      });
    }
    if (keyBtn) keyBtn.addEventListener('click', async function () {
      var st = $('aiKeyStatus');
      var k = (keyInput && keyInput.value || '').trim();
      if (!k) { if (st) st.textContent = '请先填入 API Key'; return; }
      aiKeyWrite(k);
      keyBtn.disabled = true;
      if (st) st.textContent = '正在测试…';
      try {
        // max_tokens 要给够：v4-pro 是推理模型，推理内容也占配额，给 5 会正文为空
        var res = await editorCloudHttp('POST', AI_ENDPOINT,
          { model: aiModel(), messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 300, stream: false },
          k, { bearer: true, timeoutMs: AI_TIMEOUT_MS });
        var ok = res && res.choices && res.choices[0];
        var isReasoner = !!(ok && res.choices[0].message && res.choices[0].message.reasoning_content);
        if (st) st.textContent = ok ? ('✅ 连接正常，可以使用了（' + aiModel() + (isReasoner ? '，推理模型' : '') + '）')
                                   : '⚠️ 有响应但格式不对';
      } catch (e) {
        if (st) st.textContent = '❌ ' + (e && e.message ? e.message : e);
      } finally { keyBtn.disabled = false; }
    });

    // 对话侧边栏
    var menu = $('aiMenu');
    if (menu) menu.addEventListener('click', aiToggleChatList);
    var listClose = $('aiChatListClose');
    if (listClose) listClose.addEventListener('click', function () { aiToggleChatList(); });
    // 代码画布的缩放按钮（真机上双指缩放不一定顺手，给一组看得见的）
    var zi = $('aiZoomIn'), zo = $('aiZoomOut');
    if (zi) zi.addEventListener('click', function () { aiZoomBy(1.25); });
    if (zo) zo.addEventListener('click', function () { aiZoomBy(0.8); });
    [$('aiNewChat'), $('aiNewChat2')].forEach(function (b) {
      if (b) b.addEventListener('click', function () { aiNewChat(); });
    });

    // 深度思考开关（模型固定，没有下拉要接了）
    aiSyncThinkUI();

    // 深度思考开关（顶栏那个 🧠）
    var think = $('aiThink');
    if (think) think.addEventListener('click', function () {
      aiSetThink(!aiThinkOn());
      snack(aiThinkOn() ? '深度思考已开' : '深度思考已关');
    });

    // 顶栏拖动面板
    aiWirePanelDrag();
    // 面板尺寸/窗口变化时，侧边栏的范围（到输入框上沿）要跟着重算
    window.addEventListener('resize', function () { aiPositionChatList(); });
    // 实时思考那块：用户自己往下翻之后就不要再自动滚（否则滑不动）
    var liveBody = $('aiLiveBody');
    if (liveBody && !liveBody.__aiScrollWired) {
      liveBody.__aiScrollWired = true;
      liveBody.addEventListener('scroll', function () {
        aiLiveUserScrolled = (liveBody.scrollHeight - liveBody.scrollTop - liveBody.clientHeight) > 14;
      }, { passive: true });
    }
    aiAskHide();

    aiRenderChats();
    aiRenderLog();
  }

  window.EditorApp = {
    // 仅供自动化测试驱动内部逻辑（编辑器整体在闭包里，外部拿不到这些函数）
    /** 测试用：中转请求的打包规则（改错会让写行/发码整条链挂，必须能单测）。
        返回 { url, bodyText }：bodyText 才是真正发出去的东西。 */
    __packProxy: function (method, url, body) { return 打包中转请求(method, url, body); },
    /** 测试用：当前的中转基地址（发码接口和它同址，别用 CLOUD_BASE 就判定成中转请求） */
    __cloudBase: function () { return CLOUD_BASE; },
    __mailBase: function () { return MAIL_BASE; },
    /** 测试用：导入一份 .fast 文本（这是"外来作品"的入口，安全加固必须能被验到） */
    __importFast: function (text) { return importFastText(String(text || '')); },
    /** 测试用：读本机某件作品的每个页面的 code（用来确认导入后 code 被按代码块重算过） */
    __itemScreens: function (id) {
      var st = loadStore(), it = null;
      (st.items || []).forEach(function (x) { if (x.id === id) it = x; });
      if (!it) return null;
      return (it.project.screens || []).map(function (sc) {
        return { id: sc.id, code: String(sc.code || ''), blocksXml: String(sc.blocksXml || '').slice(0, 80) };
      });
    },
    /** 测试用：程序自己生成的代码长什么样（对照用） */
    __genCode: function (blocksXml) { return genCode({ blocksXml: blocksXml }); },
    /** 测试用：检查更新只取"最新一行"+提示文案（纯函数，不联网） */
    __updatePick: function (rows) { return 取最新版本(rows) || null; },
    __updateHint: function (ver, mine) { return 校验更新提示(ver, mine); },
    /** 测试用：点亮/熄灭「检查更新」上的红点，返回当前是否可见 */
    __updateDot: function (on) { 设更新红点(!!on); var d = $('updDot'); return !!d && !d.classList.contains('hidden'); },
    __aiCatalog: function () { return aiCatalog(); },    __aiScreenSummary: function () { return aiScreenSummary(); },
    /** 测试用：从脏返回里抢救 XML */
    __aiSalvageXml: function (s) { return aiSalvageXml(s); },
    __aiValidateXml: function (xml) {
      try {
        var r = aiValidateXml(xml);
        return { ok: !!r, dropped: r ? r.dropped : [], 修复: r ? (r.修复 || 0) : 0,
                 根节点: (r && r.doc && r.doc.documentElement) ? String(r.doc.documentElement.nodeName) : '' };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    },
    __aiKeyWrite: function (k) { aiKeyWrite(k); },
    __aiKeyRead: function () { return aiKeyRead(); },
    __aiValidateComponents: function (list) {
      var r = aiValidateComponents(list);
      return { actions: r.actions, dropped: r.dropped };
    },
    __aiApplyComponents: function (list) {
      aiPendingComps = aiValidateComponents(list).actions;
      var n = aiApplyComponents();
      aiPendingComps = null;
      return n;
    },
    __aiCompSummary: function () { return aiComponentSummary(); },
    // 测试用：把一段代码 XML 直接当成"AI 刚生成的结果"渲染进面板，不调用网络。
    // 拖动是核心交互，得能离线回归。
    __aiSeed: function (xml) {
      var checked = aiValidateXml(xml || '');
      if (!checked) return null;
      aiPendingDom = checked.doc;
      $('aiPreviewWrap').classList.remove('hidden');
      aiRenderPreview(checked.doc);
      var tops = 0;
      var root = checked.doc.documentElement;
      for (var i = 0; i < root.childNodes.length; i++) {
        var nd = root.childNodes[i];
        if (nd.nodeType === 1 && String(nd.nodeName).toLowerCase() === 'block') tops++;
      }
      return { 顶层代码数: tops, 丢弃数: (checked.dropped || []).length };
    },
    // 面板内画布的"只读 + 能往外拖"状态：给自动化测试用
    __aiDragInfo: function () {
      var host = $('aiPreview');
      var opt = (aiPreviewWs && aiPreviewWs.options) || {};
      var tops = 0;
      try {
        var root = aiPendingDom && aiPendingDom.documentElement;
        if (root) {
          for (var i = 0; i < root.childNodes.length; i++) {
            var nd = root.childNodes[i];
            if (nd.nodeType === 1 && String(nd.nodeName).toLowerCase() === 'block') tops++;
          }
        }
      } catch (e) {}
      return {
        画布只读: !!opt.readOnly,
        块可拖动: !!(aiPreviewWs && aiPreviewWs.getTopBlocks(false)[0] && aiPreviewWs.getTopBlocks(false)[0].isMovable()),
        块可编辑: !!(aiPreviewWs && aiPreviewWs.getTopBlocks(false)[0] && aiPreviewWs.getTopBlocks(false)[0].isEditable()),
        接了拖出手势: !!(host && host.__aiDragWired),
        工具箱里有AI分类: (String(window.buildToolboxXml(null) || '')).indexOf('BB_AI') >= 0,
        待插入的顶层代码数: tops
      };
    },
    __aiComps: function () {
      var sc = curScreen();
      return ((sc && sc.components) || []).map(function (c) {
        // 连排版一起给出来：测试要断言"AI 改的位置/大小真的落到控件上了"；
        // 容器里的子控件也一起（children），这样测试能看到真实的父子结构
        return { id: c.id, type: c.type, name: c.name || '', text: c.text, value: c.value,
                 x: c.x, y: c.y, w: c.w, h: c.h, align: c.align, fs: c.fs, spacing: c.spacing,
                 bold: c.bold, color: c.color, bg: c.bg, radius: c.radius, cx: !!c.cx,
                 rot: c.rot, opacity: c.opacity, inputType: c.inputType, variant: c.variant, caretColor: c.caretColor,
                 columns: c.columns, rows: c.rows, chartType: c.chartType, chartData: c.chartData,
                 children: (c.children || []).map(function (k) {
                   return { id: k.id, type: k.type, name: k.name || '', text: k.text, value: k.value,
                            x: k.x, y: k.y, w: k.w, h: k.h };
                 }) };
      });
    },
    __aiModel: function () { return aiModel(); },
    /** 深度思考开关：测试用（读状态 / 拨开关） */
    __aiThink: function () { return { 开: aiThinkOn(), 模型: aiModel(), 最大token: aiMaxTokens() }; },
    __aiSetThink: function (on) { aiSetThink(!!on); return aiThinkOn(); },
    /** 真正发出去的请求参数：用来断言"模型"和"思考"确实是两根独立的轴 */
    __aiParams: function () { return aiRequestParams(); },
    /** 面板位置（拖顶栏用）：读/清 */
    __aiPanelBox: function () { return aiPanelBox(); },
    __aiDesignSize: function () { return designSize(); },
    /** 测试用：把当前页面导出成"试运行用的工程"写进 localStorage（等价于点一次「运行」但不跳转） */
    __exportPreview: function () {
      try {
        var p = buildOutput();
        persist();
        localStorage.setItem('__previewProject', JSON.stringify(p));
        return { 页面数: (p.screens || []).length, 设计: p.design || null };
      } catch (e) { return { 错误: String(e && e.message || e) }; }
    },
    /**
     * 测试用：点「运行」时会请求的原生方向，以及运行时会怎么算。
     * 两边必须一致（不一致就会"先竖屏再横屏"）。
     */
    __previewOrient: function (mode) {
      var p = state.project || {};
      var screens = p.screens || [];
      var m = mode || 'start';
      var sid = (m === 'current') ? (state.curScreenId || '')
                                  : (p.startScreen || (screens[0] && screens[0].id) || '');
      var sc0 = null;
      screens.forEach(function (s) { if (s.id === sid) sc0 = s; });
      return { 模式: m, 起始页: sid, 起始页方向: (sc0 && sc0.orientation) || '',
               项目方向: p.orientation || '', 当前页方向: (curScreen() || {}).orientation || '',
               编辑器会请求: previewOrient(m) };
    },
    /** 测试用：把当前页面的 blocksXml 换成给定 XML 并重新载入（验证"冻住的代码会被治好"） */
    __aiSetScreenBlocks: function (xml) {
      var sc = curScreen(); if (!sc) return false;
      sc.blocksXml = String(xml || '');
      return true;
    },
    __reloadWs: function () { try { loadScreenToWs(curScreen()); return true; } catch (e) { return false; } },
    __aiClearPanelBox: function () { try { localStorage.removeItem('__bb_ai_panel_box_v1'); } catch (e) {} aiApplyPanelBox($('aiPanel')); return aiPanelBox(); },
    /** 离线喂一段"模型返回的 JSON"，走完整条处理链路（不联网也能回归选择框/清单/预览） */
    __aiHandleRaw: function (raw, reasoning) { return aiHandleResponse(String(raw == null ? '' : raw), null, reasoning); },
    /** 只测解析器：真机反馈过"AI 返回的内容不是合法 JSON"，这里要能兜住各种脏输出 */
    __aiParseTry: function (t) {
      try {
        var o = aiParse(String(t == null ? '' : t));
        return { ok: true, 修补过: !!o.__aiRepaired, keys: Object.keys(o),
                 blocks: String(o.blocks || ''), reply: String(o.reply || '') };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
    /** 往当前对话里塞一条带"思考过程"的 AI 回复（测试折叠展开用） */
    __aiAddReasoningMsg: function (content, reasoning) {
      var c = aiCurChat(); if (!c) return null;
      c.messages.push({ role: 'assistant', content: aiDeJargon(String(content || '')), reasoning: String(reasoning || '') });
      aiSaveChats(); aiRenderLog();
      return c.messages.length;
    },
    /** 错误提示文案（测试确认用户看到的是"能照着做"的话，不是术语） */
    __aiFriendlyError: function (m) { return aiFriendlyError(new Error(String(m))).message; },
    __aiStrictNudge: function () { return AI_STRICT_NUDGE; },
    __aiAsk: function () { return aiPendingAsk; },
    /** 拖动诊断：为什么没出现跟手的代码图 */
    __aiDragState: function () {
      var host = $('aiPreview');
      return { 有待插入代码: !!aiPendingDom, 接了手势: !!(host && host.__aiDragWired),
               预览工作区: !!aiPreviewWs,
               预览顶层块: aiPreviewWs ? aiPreviewWs.getTopBlocks(true).length : -1,
               画布页可见: !!(function () { var c = $('aiCanvasPage'); return c && !c.classList.contains('hidden'); })(),
               面板开着: !!(function () { var p = $('aiPanel'); return p && !p.classList.contains('hidden'); })(),
               host尺寸: host ? [host.offsetWidth, host.offsetHeight] : null,
               跟手图: !!document.querySelector('.ai-dragimg'), 提示条: !!document.querySelector('.ai-ghost') };
    },
    __aiNewChat: function () { return aiNewChat().id; },
    __aiChats: function () {
      var s = aiLoadChats();
      return { activeId: s.activeId,
               list: s.list.map(function (c) { return { id: c.id, title: c.title, n: (c.messages || []).length }; }) };
    },
    __aiActiveMessages: function () { var c = aiCurChat(); return c ? c.messages.slice() : []; },
    __aiBuildMessages: function () {
      return aiBuildMessages(aiCurChat()).map(function (x) {
        return { role: x.role, len: String(x.content).length, head: String(x.content).slice(0, 60) };
      });
    },
    /** 系统提示里有没有某段内容（测试用：确认"AI 有排版能力"这句真的写进去了） */
    __aiPromptHas: function (needle) { return aiSystemPrompt().indexOf(String(needle)) >= 0; },
    /** 测试用：手动触发一次预览缩放校正（验证"反复算不会越来越大"） */
    /** 测试用：打开/关闭设置弹窗（顺便验证"打开时会把模型名同步一次"） */
    __openSettings: function (cat) { openSettings(cat); return !$('viewSettings').classList.contains('hidden'); },
    __closeSettings: function () { try { closeSettings(); closeMenus(); } catch (e) {} return true; },
    /** 测试用：等价于点「插入到画布」（用待插入内容插到主画布），返回这次插了几组 */
    __aiInsertPending: function () {
      var ws = state.ws;
      var seen = {};
      if (ws && ws.getTopBlocks) ws.getTopBlocks(false).forEach(function (b) { seen[b.id] = 1; });
      aiInsert();
      var 新增 = [];
      if (state.ws && state.ws.getTopBlocks) {
        state.ws.getTopBlocks(false).forEach(function (b) {
          if (seen[b.id]) return;
          try { var xy = b.getRelativeToSurfaceXY(); 新增.push([Math.round(xy.x), Math.round(xy.y)]); } catch (e) {}
        });
      }
      return { 新增组数: 新增.length, 坐标: 新增 };
    },    /** 测试用：右键菜单里的「粘贴 AI 复制的代码」有没有注册好 */
    __aiPasteMenuReady: function () {
      try {
        var reg = Blockly.ContextMenuRegistry && Blockly.ContextMenuRegistry.registry;
        return !!(reg && reg.getItem && (reg.getItem('aiPasteCopiedBlocks_workspace') || reg.getItem('aiPasteCopiedBlocks_block')));
      } catch (e) { return false; }
    },
    /** 测试用：执行一次「粘贴 AI 复制的代码」 */
    __aiPasteCopied: function () { aiPasteCopied(); return true; },
    /** 测试用：复制是否真的留下了内容 */
    /** 测试用：画布长按菜单里「粘贴代码」的状态（是否置灰）——它看的是编辑器自己的 blockClipboard */
    /** 测试用：立刻刷新画布右下角的粘贴按钮状态 */
    /** 测试用：把预览视图复位（重排 + 适应窗口），让后续用例能找到代码 */
    /** 测试用：走「水平居中（锁住中线）」按钮的同一条逻辑 */
    __aiToggleCenter: function (id) {
      var comps = (curScreen() || {}).components || [];
      var c = null;
      for (var i = 0; i < comps.length; i++) if (comps[i].id === id) c = comps[i];
      if (!c) return false;
      c.cx = !c.cx;
      if (c.cx) {
        if (!validN(c.x) && !validN(c.y)) c.align = 'center';
        else applyCenterLock(c);
      } else if (c.align === 'center' && !validN(c.x)) {
        c.align = 'left';
      }
      try { renderCompList(); } catch (e) {}
      renderLayStage && state.inLayout && renderLayStage();
      autosave();
      return true;
    },    __aiResetPreviewView: function () {
      if (!aiPreviewWs) return false;
      try { aiStackBlocks(aiPreviewWs.getTopBlocks(true), 20, 20, 20); } catch (e) {}
      aiFitNow();
      return true;
    },    /** 测试用：预览手势状态（按下走了哪条分支、是否在拖/平移） */
    /** 测试用：暂存区（拖进对话框的代码）状态 */
    /** 测试用：暂存区里的原始 XML（检查有没有混进不该有的块） */
    /** 测试用：当前会发出去的请求体（验证结构化输出/额度/思考开关的契约） */
    __aiBody: function () { return aiRequestBody([{ role: 'user', content: 'x' }]); },
    /** 测试用：真正会发给模型的消息（验证运行报错是否带上了、历史是否被压缩） */
    __aiMessages: function (msgs) { return aiBuildMessages({ messages: msgs || ((aiCurChat() || {}).messages || []) }); },
    /** 测试用：「看报错」按钮会发的那句话 */
    __aiDiagnoseText: function () { return aiDiagnoseText(); },
    /** 测试用：生成中/结束的按钮状态机（不联网也能验证） */
    __aiSetBusy: function (on) { aiSetBusy(!!on); return aiBusy; },
    __aiStopGenerate: function () { aiStopGenerate(); return aiBusy; },
    /** 测试用：历史版本（存 / 列 / 恢复 / 打开面板） */
    __aiHistory: function () { return histList(state.itemId).map(function (h) { return { ts: h.ts, 原因: h.原因 }; }); },
    __aiHistorySnapshot: function (r) { var s = histSnapshot(state.itemId, r || '测试'); return !!s; },
    __aiHistoryRestore: function (i) { return histRestore(state.itemId, i); },
    __aiHistoryDelete: function (i) { return histDelete(state.itemId, i); },
    /** 测试用：进阶技巧清单（名称 + XML，用来验证每条都能解析） */
    __aiTips: function () { return ADV_TIPS.map(function (t) { return { name: t.name, desc: t.desc, xml: t.xml }; }); },
    __aiOpenTips: function () { openTips(); },
    /** 测试用：把一段 XML 画成缩略图（验证"每条技巧都画得出来"） */
    __aiThumb: function (xml) { return 块缩略图(xml, 0, true); },
    // 排错用：直接试画一段代码，把失败原因带出来（缩略图画不出来时看这个）
    __thumbProbe: function (xml) {
      var 旧失败 = 活图失败; 活图失败 = '';
      try {
        var 图 = 活块缩略图(xml, 0, true, 0.72);
        return { ok: !!图, 原因: 图 ? '' : (活图失败 || '没量出积木大小') };
      } catch (e) {
        return { ok: false, 原因: String((e && e.message) || e), 栈: String((e && e.stack) || '').split('\n').slice(0, 3).join(' | ').slice(0, 260) };
      } finally { if (!活图失败) 活图失败 = 旧失败; }
    },
    __aiOpenHistory: function () { openHistory(state.itemId); },
    /** 测试用：当前正在编辑的作品 id */
    __aiItemId: function () { return state.itemId; },
    /** 测试用：把"最近一次运行时报错的那一段"标出来 */
    __aiShowRuntimeError: function () { return showRuntimeErrorOnce(); },
    __aiHighlightSeg: function (n) { return 高亮段(Number(n)); },
    /** 测试用：模板库清单 / 套用模板（离线可测） */
    __aiTemplates: function () { return TEMPLATES.map(function (t) { return { id: t.id, name: t.name, desc: t.desc }; }); },    __aiApplyTemplate: function (id) { return applyTemplate(id); },
    __aiTemplateXml: function (id) {
      var tpl = null; TEMPLATES.forEach(function (t) { if (t.id === id) tpl = t; });
      if (!tpl) return '';
      var 骨架 = tpl.build({ 登录: 'x', 列表: 'x', 计时器: 'x', 开始: 'x', 停止: 'x', 提交: 'x', 联系: 'x' });
      return 模板XML(骨架.code || []);
    },
    /** 测试用：读取诊断日志里的运行报错条目 */
    __aiRuntimeIssues: function (n) { return aiRuntimeIssues(n); },
    /** 测试用：完整系统提示词（验证用词/自称等约束真的写进去了） */
    __aiSystemPrompt: function () { return aiSystemPrompt(); },
    __aiStagedXml: function () { return aiStaged.map(function (it) { return it.xml; }).join('\n'); },
    /** 测试用：把指定块放进暂存区（等价于按住它拖进对话框那一步），返回放进去的 XML */
    __aiStageGrab: function (id) {
      var b = (state.ws && state.ws.getBlockById) ? state.ws.getBlockById(id) : null;
      if (!b) return null;
      aiStageAddBlock(b);
      return aiStaged.length ? aiStaged[aiStaged.length - 1].xml : null;
    },
    __aiStaged: function () { return aiStaged.map(function (it) { return { key: it.key, label: it.label, 长度: String(it.xml).length, fromId: it.fromId || null }; }); },
    /** 测试用：把画布上第 n 段放进暂存区（等价于用户把它拖进对话框） */
    __aiStageFromCanvas: function (n) {
      var ws = state.ws; if (!ws) return false;
      var tops = ws.getTopBlocks(true).filter(function (b) { return !(b.isShadow && b.isShadow()); });
      var b = tops[n || 0]; if (!b) return false;
      return aiStageAddBlock(b);
    },
    /** 测试用：清空暂存区 */
    __aiStageClear: function () { aiStaged = []; aiStageRender(); return true; },
    /** 测试用：当前待确认的修复方案 */
    __aiPendingFixes: function () {
      return aiPendingFixes ? aiPendingFixes.map(function (f) { return { index: f.index, reason: f.reason }; }) : null;
    },
    /** 测试用：执行"确认替换" */
    __aiApplyFixes: function () { return aiApplyFixes(); },    /** 测试用：控件类型表（label 等），用来核对界面按钮是否覆盖全部类型 */
    /** 测试用：清理没用的变量（函数被删后参数变量要回收），返回清理个数 */
    __aiPruneVars: function () { return pruneUnusedVars(); },
    /** 测试用：当前工作区里的变量名列表 */
    __aiVars: function () {
      try { return (state.ws ? state.ws.getAllVariables() : []).map(function (v) { return v.name; }); } catch (e) { return []; }
    },    /** 测试用：页面列表 / 新建 / 切换 */
    /** 测试用：页面列表（没有工程时返回空数组，别让调用方抛错） */
    __aiScreens: function () {
      var ps = (state.project && state.project.screens) || [];
      return ps.map(function (s) { return { id: s.id, title: s.title, 有视角: !!s.view, view: s.view || null }; });
    },
    __aiAddScreen: function () { addScreen(); return state.curScreenId; },
    __aiSwitchScreen: function (id) { switchScreen(id); return state.curScreenId; },
    /** 测试用：拿当前工程对象 / 直接设图标（给"发布到社区"这条链做真机级联调） */
    __proj: function () { return state.project || null; },
    __setIcon: function (dataUrl) { if (state.project) { state.project.icon = dataUrl || null; try { persist(); } catch (e) {} } return !!(state.project && state.project.icon); },
    /** 测试用：当前主画布视口 */
    __aiMainView: function () {
      var ws = state.ws;
      if (!ws) return null;
      return { x: Math.round(ws.scrollX || 0), y: Math.round(ws.scrollY || 0), scale: ws.getScale ? ws.getScale() : 1 };
    },    /** 测试用：主工作区句柄（有些用例在首页跑，Blockly.getMainWorkspace() 可能为空） */
    __aiWs: function () { return state.ws || null; },    __aiTypeMeta: function () { return TYPE_META; },    __aiGestureState: function () {
      return { 按下次数: aiGest.down, 分支: aiGest.hit, 拖拽中: aiGest.dragging, 平移中: aiGest.panning,
               收到移动: aiGest.moves, 执行平移: aiGest.apply, 指针数: aiGest.pts, 最近动作: aiGest.err,
               有待插入: !!aiPendingDom, 预览就绪: !!aiPreviewWs };
    },    /** 测试用：平移换算（屏幕位移 → scroll 参数），用来直接验证"跟手"方向 */
    /** 测试用：直接把预览缩放到指定比例（真实输入测试需要腾出空白区） */
    __aiSetPreviewScale: function (k, center) {
      try {
        if (!aiPreviewWs) return false;
        aiPreviewWs.setScale(k);
        if (center) aiPreviewWs.scrollCenter();   // 居中：四周都留出可拖动空间
        aiPreviewUserMoved = true;
        return true;
      } catch (e) { return false; }
    },    __aiPanScroll: function (baseX, baseY, dx, dy) { return panScrollFrom(baseX, baseY, dx, dy); },    __aiSyncPasteBtnNow: function () { if (window.__aiSyncPasteBtn) window.__aiSyncPasteBtn(); return true; },    __aiMenuState: function () {
      var has = false;
      try { has = !!blockClipboard; } catch (e) { has = null; }
      return { 剪贴板有内容: has, 剪贴板长度: (function () { try { return blockClipboard ? String(blockClipboard).length : 0; } catch (e) { return -1; } })(),
               粘贴项灰: !has };
    },    __aiCopiedInfo: function () { return window.__aiCopiedXml ? { 长度: String(window.__aiCopiedXml).length, 组数: window.__aiCopiedBlocks || 0 } : null; },    /** 测试用：预览画布的缩放比例 */
    __aiPreviewScale: function () {
      try { return aiPreviewWs && aiPreviewWs.getScale ? aiPreviewWs.getScale() : null; } catch (e) { return null; }
    },
    /** 测试用：Blockly 剪贴板里有没有东西（决定画布里的「粘贴」是否可用） */
    __aiClipboardHasData: function () {
      try {
        if (!Blockly.clipboard) return null;
        var d = Blockly.clipboard.getLastCopyData ? Blockly.clipboard.getLastCopyData() : null;
        return !!d;
      } catch (e) { return null; }
    },
    /** 测试用：预览的平移按钮/手势是否跟手（返回某个块在屏幕上的位置） */
    __aiPreviewBlockScreenPos: function () {
      try {
        var tops = aiPreviewWs.getTopBlocks(true);
        if (!tops.length) return null;
        var r = tops[0].getSvgRoot().getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top) };
      } catch (e) { return null; }
    },    /** 测试用：当前对话的消息摘要（用于断言"推理正文一个字都没显示出来"） */
    __aiChatMessages: function () {
      var c = aiCurChat();
      if (!c) return [];
      return (c.messages || []).map(function (m) {
        return { role: m.role, content: String(m.content || ''), reasoning: String(m.reasoning || '') };
      });
    },
    /** 测试用：串位自检结果（推理被当成正文、或反之） */
    __aiMixUp: function () { return window.__aiMixUp || null; },    /** 测试用：主画布当前的触摸缩放开关（看预览时必须是关的，否则会"放大穿透"） */
    __aiMainPinch: function () {
      try { return !!(state.ws && state.ws.options && state.ws.options.zoomOptions && state.ws.options.zoomOptions.pinch); }
      catch (e) { return null; }
    },
    /** 测试用：当前是不是停在"代码画布"页 */
    __aiOnCanvasPage: function () {
      var cv = $('aiCanvasPage');
      return !!(cv && !cv.classList.contains('hidden'));
    },
    /** 测试用：把预览里的块全部叠到一点（模拟真机渲染慢时的叠加） */
    __aiPilePreviewBlocks2: function () { return window.EditorApp.__aiPilePreviewBlocks(); },    __aiRestackPreview: function () {
      if (!aiPreviewWs) return false;
      try { aiStackBlocks(aiPreviewWs.getTopBlocks(true), 20, 20, 20); } catch (e) { return false; }
      try { aiFitPreview(); } catch (e) {}
      return true;
    },
    /** 测试用：把预览里的顶层块全部挪到同一点（模拟"渲染慢导致竖排失效"的叠加状态） */
    __aiPilePreviewBlocks: function () {
      if (!aiPreviewWs) return 0;
      var tops = aiPreviewWs.getTopBlocks(true), n = 0;
      tops.forEach(function (b) {
        try { var xy = b.getRelativeToSurfaceXY(); b.moveBy(20 - xy.x, 20 - xy.y); n++; } catch (e) {}
      });
      return n;
    },    /** 测试用：预览工作区实际的注入参数（确认和主画布对齐：本地 media、关声音） */
    __aiPreviewOptions: function () {
      if (!aiPreviewWs) return null;
      var o = aiPreviewWs.__injectedOpts || aiPreviewWs.options || {};
      var z = o.zoom || (aiPreviewWs.options && aiPreviewWs.options.zoomOptions) || {};
      return { media: o.media, sounds: !!o.sounds, readOnly: !!o.readOnly,
               renderer: o.renderer, pinch: !!(z && z.pinch) };
    },    __aiFitPreview: function () { try { aiFitPreview(); return true; } catch (e) { return false; } },
    /** 测试用：预览工作区当前的滚动位置（验证画布能拖动平移） */
    __aiPreviewView: function () {
      if (!aiPreviewWs) return null;
      var m = null;
      try { m = aiPreviewWs.getMetrics(); } catch (e) {}
      return { scrollX: Math.round(aiPreviewWs.scrollX || 0), scrollY: Math.round(aiPreviewWs.scrollY || 0),
               scale: aiPreviewWs.getScale ? aiPreviewWs.getScale() : 0,
               内容: m ? [Math.round(m.scrollWidth), Math.round(m.scrollHeight)] : null,
               视口: m ? [Math.round(m.viewWidth), Math.round(m.viewHeight)] : null };
    },    __aiPreviewZoom: function () {
      if (!aiPreviewWs) return null;
      var o = (aiPreviewWs.options && aiPreviewWs.options.zoomOptions) || {};
      return { pinch: !!o.pinch, wheel: !!o.wheel, scale: aiPreviewWs.getScale ? aiPreviewWs.getScale() : 0 };
    },
    __aiPreviewInfo: function () {
      var host = $('aiPreview');
      return {
        hasWs: !!aiPreviewWs,
        wsBlocks: aiPreviewWs ? aiPreviewWs.getAllBlocks(false).length : -1,
        hostW: host ? host.offsetWidth : -1,
        hostH: host ? host.offsetHeight : -1,
        svg: host ? host.querySelectorAll('svg').length : -1,
        draggable: host ? host.querySelectorAll('.blocklyDraggable').length : -1,
        gTags: host ? host.querySelectorAll('g').length : -1
      };
    },
    onExportResult: function (ok, path, err, downloadUri) {
      if (ok) {
        var fname = path.split('/').pop();
        var box = el('div');
        var line = el('div', 'dim'); line.style.wordBreak = 'break-all';
        line.textContent = '已保存到手机「下载/fast本地app/' + fname + '」。点「安装」直接安装；若失败，可点「打开下载目录」手动点 APK 安装。';
        box.appendChild(line);
        modal('导出成功', box, '安装', function () {
          try { Native.installApk(path, downloadUri || ''); } catch (e) {}
          hideModal();
        });
        modalExtra('打开下载目录', function () {
          if (window.Native && Native.openDownloadFolder) Native.openDownloadFolder();
          else modal('安装方式', '请用系统「文件管理」进入 下载/fast本地app 目录，点击该 APK 安装。', '知道了', hideModal);
        });
      } else modal('导出失败', err || '未知错误');
    },
    // 本地上传视频/音频完成：原生把文件拷入私有目录后回调文件名，把它记成组件的 media:// 引用
    onMediaPicked: function (name) {
      if (!name) { snack('未选择文件或选择失败'); return; }
      var cid = state.pendingMediaCompId; state.pendingMediaCompId = null;
      if (!cid) return;
      var found = null, screens = (state.project && state.project.screens) || state.screens || [];
      screens.forEach(function (s) { (s.components || []).forEach(function (c) { if (c.id === cid) found = c; }); });
      if (!found) return;
      found.src = 'media://' + name;
      autosave(); renderPropPanel(); renderCompList();
      snack('已添加：' + name);
    },
    // 检查更新：APK 下载完成，准备调系统安装器
    onApkDownloaded: function (cbId, path, err) {
      if (err) { var st = $('updateStatus'); if (st) st.textContent = '下载失败：' + err; var g = $('updateGo'); if (g) g.disabled = false; return; }
      var st = $('updateStatus'); if (st) st.textContent = '下载完成，准备安装…';
      try { if (window.Native && Native.installApk) Native.installApk(path, ''); } catch (e) {}
      setTimeout(function () { var m = $('updateMask'); if (m) m.classList.add('hidden'); }, 500);
    }
  };

  /* ================= 账号：邮箱验证码登录 =================
     没有"注册"这一步：验证码通过后查一下邮箱 ——
       · 表里已有 → 直接登录
       · 表里没有 → 自动建档（昵称取邮箱前缀）再登录
     账号存在 SeaTable 的「账号」表（用户邮箱 / 账号名），不发密码、不存密码。
     发码/验码走阿里云 FC 函数（部署说明见 aliyun-fc-mail/README-部署说明.md）。 */
  /* ===== 凭据一律不留在这里（2026-09-25 修）=====
     以前这里硬编码着 SeaTable 的 API Token 和基础表 UUID，而 editor.js 会被打进 APK ——
     等于谁拿到安装包都能抠出来读写整张「账号」表和「社区」表。现在：
       · 账号/社区/更新 的请求全部走上面的云中转（CLOUD_BASE），密钥只存在服务端；
       · 下面这两个常量只作为**本地直连**（没配中转时的开发用）的兜底，正式包必须为空；
       · build.ps1 里有一条断言：APK 里只要出现凭据字符串，直接构建失败。
     注意：这两个变量不能删（代码里还有引用），留空即可。 */
  var AUTH_UUID = '';          // 由服务端决定，客户端不再需要
  var AUTH_TOKEN = '';         // ⚠️ 永远不要往这里填 token
  var AUTH_SRV = 'https://cloud.seatable.cn';
  var AUTH_TABLE = '账号';
  var AUTH_COL = { email: '用户邮箱', name: '账号名' };
  var USER_KEY = '__bb_user_v1';
  var MAIL_BASE = 'https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run';
  var MAIL_APP_TOKEN = 'ed50ad9e7f07e67991695576b724984f89bd61d2';   // 与函数环境变量 APP_TOKEN 一致
  /* ================= 云中转 =================
     账号/社区/更新的所有云请求都走这个中转，SeaTable 的密钥只存在服务端，
     **APK 里一个凭据都没有**（以前 AUTH_TOKEN 硬编码在这里，谁拿到 APK 都能读写整张表）。
     留空时自动退回"直连 SeaTable"，方便本地/离线开发；正式打包必须填。
     中转只放行账号/社区/更新用得到的几个接口，且会强制把表 UUID 换成服务端白名单里的，越不过去。

     为什么用阿里云 FC 而不是 Cloudflare：workers.dev 在**中国大陆被 DNS 污染 + 线路拦截**
     （实测解析到 Cloudflare 真实 IP 但 HTTPS/HTTP 全超时），你和用户都连不上。
     现在这个地址就是发验证码那个函数（已把中转逻辑合并进去），国内直连没问题。 */
  var CLOUD_BASE = MAIL_BASE;
  function 用中转() { return !!CLOUD_BASE; }
  /** 云中转的请求头：中转和发验证码用同一个口令（函数里的 APP_TOKEN） */
  function 中转头() { return { 'X-App-Token': MAIL_APP_TOKEN }; }
  /**
   * 统一拼"云请求地址"。
   * 关键：走中转时**必须**用它，不能拿 c.srv 直接拼 —— c.srv 是 SeaTable 真地址
   * （dtable_server），直接拼出来的 URL 会绕过中转。之前就是这样：换令牌走了中转，
   * 读表却直连 SeaTable，结果社区一张卡都没有、登录还会重复建档。
   * 直连模式（没配 CLOUD_BASE）时返回原来的绝对地址。
   */
  function 网关(rel) {
    if (用中转()) return 中转链接(rel);
    return AUTH_SRV + rel;
  }
  /** 相对路径 → 中转地址。
     把**整条**（路径 + 查询串）放进 `p`，`q` 留空，且**不做 URL 编码**：
       1) 不编码的理由：中转收到的是 JSON 里的字符串，编码不会被自动还原，
          若客户端编码、中转不解码，白名单就认不出路径 → 403 path not allowed
          （2026-09-25 用户报的"发布到社区失败"根因）。用不编码的写法，
          新旧两版中转都能正确处理 —— 用户不用再重新部署函数。
       2) 查询串一起放进 p 的理由：以前把查询串塞在 q 里，它带的 & 会和中转自己的参数打架。
       3) 里面出现中文（表名"账号/社区"）也没关系：中转会按 UTF-8 百分号编码后发给 SeaTable。

     2026-09-26 补记（重要，别再踩）：上面第 2 条当时只解决了一半。
     函数那边原先用 parse_qs 解外层查询串，「p=…&limit=1000&convert_keys=true」里的
     第一个 & 会被当成参数分隔符，p 被**截断**成 "…?table_name=社区"，
     limit / convert_keys 全丢 → 行按列 key 回来（0000 / 020Y 四位乱码）
     → 卡片全显示「未命名 / 作者：匿名」。
     对照实测：直达路径 /api/v2/dtables/… 正常，走 /api?p=… 就丢参数。
     已在函数 v6 修掉（_raw_p：p 按"=之后到结尾"命令式取，不再过 parse_qs）。
     客户端这里**故意保持不编码** —— 两端同时改会变成双重解码，只改函数最稳。 */
  function 中转链接(rel) {
    var s = rel.charAt(0) === '/' ? rel : '/' + rel;
    return CLOUD_BASE + '/api?p=' + s;
  }
  /** SeaTable 返回的绝对地址 → 换成走中转的地址（保留 ?query） */
  function 走中转(url) {
    if (!用中转()) return url;
    var s = String(url || '');
    if (/^https?:\/\//i.test(s)) {
      var rest = s.replace(/^https?:\/\/[^/]+/i, '');
      return 中转链接(rest);
    }
    return 中转链接(s);
  }
  var authCtx = null;          // {srv, uuid, acc, ws, exp} 访问令牌缓存
  var authBusy = false;
  var authTestHttp = null;     // 自动化测试钩子：window.__authSetHttp(fn)
  var mailChallenge = null;    // 发码成功后函数返回的签名令牌
  var mailCountdown = 0, mailTimer = null;
  window.__authSetHttp = function (fn) { authTestHttp = fn || null; authCtx = null; };
  /* 读行必须显式要「中文列名」。
     SeaTable 的 rows 接口**默认按列 key 返回**（用户邮箱 = "0000"、账号名 = "020Y" 这种四位乱码），
     不带这个参数读回来的行里根本没有中文列名，所有 row['用户邮箱'] 全是 undefined ——
     表现就是：登录时查不到已注册邮箱（每次都新建一行）、社区列表空、我分享的作品空。
     2026-09-25 拿真表逐条验证过：加 convert_keys=true 才返回中文列名，返回结构其它部分不变。 */
  var ROWS_TAIL = '&limit=1000&convert_keys=true';

  function authHttp(method, url, body, token, opts) {
    opts = opts || {};
    // 走云中转时统一带上口令；同时**不把 SeaTable 的访问令牌发出去**（中转服务端自己有密钥）
    if (用中转()) {
      var h = {};
      for (var k in (opts.headers || {})) h[k] = opts.headers[k];
      h['X-App-Token'] = MAIL_APP_TOKEN;
      opts = { timeoutMs: opts.timeoutMs, raw: opts.raw, bearer: false, headers: h, _rel: opts._rel };
      token = null;
    }
    if (authTestHttp) return authTestHttp(method, url, body, token, opts);
    return editorCloudHttp(method, url, body, token, opts);
  }
  function authEndpoint() {
    if (authCtx && authCtx.exp > Date.now()) return Promise.resolve(authCtx);
    // 走中转时：中转自己拿密钥换令牌（客户端一个凭据都不需要）
    var 换令牌URL = 用中转() ? 中转链接('/api/v2.1/dtable/app-access-token/')
                             : AUTH_SRV + '/api/v2.1/dtable/app-access-token/';
    return authHttp('GET', 换令牌URL, null, 用中转() ? null : (AUTH_TOKEN || null), { timeoutMs: ROWS_TIMEOUT_MS, headers: 用中转() ? 中转头() : null }).then(function (d) {
      if (!d || !d.access_token) throw new Error('连不上账号服务，稍后再试');
      authCtx = {
        // srv 只保留给"直连模式"用；走中转时所有请求都用 网关() 拼到中转地址上
        srv: 用中转() ? CLOUD_BASE.replace(/\/+$/, '') : (d.dtable_server || (AUTH_SRV + '/api-gateway/')).replace(/\/+$/, ''),
        uuid: d.dtable_uuid || AUTH_UUID,
        acc: d.access_token,
        ws: d.workspace_id || '',
        exp: Date.now() + 600000
      };
      return authCtx;
    });
  }
  function authRows() {
    return authEndpoint().then(function (c) {
      var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/?table_name=' + encodeURIComponent(AUTH_TABLE) + ROWS_TAIL);
      return authHttp('GET', url, null, c.acc, { bearer: true }).then(function (d) { return (d && d.rows) || []; });
    });
  }
  function authFind(rows, email) {
    var em = String(email || '').trim().toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][AUTH_COL.email];
      if (v && String(v).trim().toLowerCase() === em) return rows[i];
    }
    return null;
  }
  /** 表里没有这个邮箱 → 自动建档（昵称取邮箱前缀） */
  function authCreateUser(email) {
    return authEndpoint().then(function (c) {
      var row = {};
      row[AUTH_COL.email] = email;
      row[AUTH_COL.name] = email.split('@')[0];
      var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/');
      return authHttp('POST', url, { table_name: AUTH_TABLE, rows: [row] }, c.acc, { bearer: true })
        .then(function (d) {
          // 列名写错时 SeaTable 会返回插入 0 行，必须当成失败
          var n = d && (d.inserted_row_count || (d.rows && d.rows.length) || 0);
          if (!n) throw new Error('账号没写进表格，稍后再试');
          return { email: email, name: row[AUTH_COL.name] };
        });
    });
  }
  /** 验证码通过 → 有就登录、没有就自动建档 */
  function authByCode(email, code) {
    return mailVerify(email, code).then(function () {
      return authRows().then(function (rows) {
        var row = authFind(rows, email);
        // 用表里的邮箱写法当登录态，免得大小写不同被当成两个账号
        if (row) return { email: String(row[AUTH_COL.email] || email).trim(), name: row[AUTH_COL.name] || email.split('@')[0] };
        return authCreateUser(email);
      });
    });
  }

  /* ---- 验证码：阿里云 FC 函数经 QQ 邮箱下发 ----
     一律走 authHttp：生产环境它就是 editorCloudHttp（行为完全一样），
     但自动化测试能整体替换掉网络层 —— 否则用例会真的去调发信函数，把真验证码发出去。 */
  function mailHeaders() { return { 'X-App-Token': MAIL_APP_TOKEN }; }
  function mailSend(email) {
    return authHttp('POST', MAIL_BASE, { action: 'send', email: email }, null,
      { headers: mailHeaders(), timeoutMs: 20000 }).then(function (d) {
        if (!d || !d.challenge) throw new Error('验证码发送失败，稍后再试');
        mailChallenge = d.challenge;
        return d;
      });
  }
  function mailVerify(email, code) {
    if (!mailChallenge) return Promise.reject(new Error('请先点「获取验证码」'));
    return authHttp('POST', MAIL_BASE,
      { action: 'verify', email: email, code: code, challenge: mailChallenge }, null,
      { headers: mailHeaders(), timeoutMs: 20000 }).then(function (d) {
        if (d && d.ok === false) throw new Error('验证码不对或已过期');
        return d;
      });
  }
  function setSendBtn(left) {
    var b = $('authSendCode'); if (!b) return;
    if (left > 0) { b.disabled = true; b.textContent = left + ' 秒'; }
    else { b.disabled = false; b.textContent = '获取验证码'; }
  }
  function startCountdown(sec) {
    mailCountdown = sec; setSendBtn(mailCountdown);
    if (mailTimer) clearInterval(mailTimer);
    mailTimer = setInterval(function () {
      mailCountdown--;
      setSendBtn(mailCountdown);
      if (mailCountdown <= 0) { clearInterval(mailTimer); mailTimer = null; }
    }, 1000);
  }
  function resetMailUi() {
    if (mailTimer) { clearInterval(mailTimer); mailTimer = null; }
    mailCountdown = 0; setSendBtn(0);
  }
  function doSendCode() {
    var b = $('authSendCode');
    if (!b || b.disabled) return;
    var email = String(($('authEmail') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authSetErr('邮箱格式不对'); return; }
    authSetErr('');
    b.disabled = true; b.textContent = '发送中…';
    mailSend(email).then(function () {
      authSetErr('');
      startCountdown(60);
      try { $('authCode').focus(); } catch (e) {}
    }).catch(function (e) {
      resetMailUi();
      authSetErr((e && e.message) || '验证码发送失败，稍后再试');
    });
  }

  function authEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function currentUser() {
    try {
      var t = localStorage.getItem(USER_KEY);
      if (!t) return null;
      var u = JSON.parse(t);
      return (u && u.email) ? u : null;
    } catch (e) { return null; }
  }
  function saveUser(u) {
    // 换了人（登录/退出/换邮箱）→ 之前跟社区表核对出来的"我发的作品iD"整套作废，
    // 否则会把上一个账号的分享算成当前账号的，「管理」按钮就串了
    var 换人了 = true;
    try { var 旧 = currentUser(); 换人了 = String((旧 && 旧.email) || '') !== String((u && u.email) || ''); } catch (e) {}
    try { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); } catch (e) {}
    if (换人了) { try { 重置我的社区iD(); } catch (e) {} }
  }
  window.BB_currentUser = currentUser;   // 以后「作品存到账号」用得到
  function authSetErr(msg) {
    var e = $('authErr'); if (!e) return;
    if (msg) { e.textContent = msg; e.classList.remove('hidden'); } else { e.textContent = ''; e.classList.add('hidden'); }
  }
  function syncAuthUi() {
    var u = currentUser(), b = $('btnUser');
    if (b) {
      b.classList.toggle('on', !!(u && u.email));
      b.title = (u && u.email) ? ('账号：' + (u.name || u.email)) : '账号：未登录';
    }
    var me = $('authMe');
    if (me) {
      if (u && u.email) {
        me.innerHTML = '<div class="auth-me-name">' + authEsc(u.name || u.email) + '</div>' +
          '<div class="auth-me-mail">' + authEsc(u.email) + '</div>';
        me.classList.remove('hidden');
      } else { me.innerHTML = ''; me.classList.add('hidden'); }
    }
    var form = $('authForm'); if (form) form.classList.toggle('hidden', !!u);
    var go = $('authGo'); if (go) go.classList.toggle('hidden', !!u);
    var out = $('authOut'); if (out) out.classList.toggle('hidden', !u);
    var ti = $('authTitle'); if (ti) ti.textContent = u ? '我的账号' : '登录';
    authSetErr('');
  }
  function openAuth() {
    syncAuthUi();
    $('authMask').classList.remove('hidden');
    if (!currentUser()) { try { $('authEmail').focus(); } catch (e) {} }
  }
  function closeAuth() {
    $('authMask').classList.add('hidden');
    authSetErr('');
    try { $('authCode').value = ''; } catch (e) {}
  }
  function doAuth() {
    if (authBusy) return;
    var email = String(($('authEmail') || {}).value || '').trim();
    var code = String(($('authCode') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authSetErr('邮箱格式不对'); return; }
    if (!/^\d{6}$/.test(code)) { authSetErr('请填邮箱收到的 6 位验证码'); return; }
    if (!mailChallenge) { authSetErr('请先点「获取验证码」'); return; }
    var go = $('authGo');
    authBusy = true; authSetErr('');
    if (go) { go.disabled = true; go.textContent = '登录中…'; }
    authByCode(email, code).then(function (u) {
      saveUser(u);
      try { $('authCode').value = ''; } catch (e) {}
      syncAuthUi();
      setTimeout(closeAuth, 200);
    }).catch(function (e) {
      authSetErr((e && e.message) || '登录失败，稍后再试');
    }).then(function () {
      authBusy = false;
      if (go) { go.disabled = false; go.textContent = '登录'; }
    });
  }
  function wireAuth() {
    if (!$('btnUser')) return;
    // 未登录 → 原来的登录框；已登录 → 进全新的「账号」整页
    $('btnUser').addEventListener('click', openAccount);
    if ($('authGo')) $('authGo').addEventListener('click', doAuth);
    if ($('authSendCode')) $('authSendCode').addEventListener('click', doSendCode);
    $('authCancel').addEventListener('click', closeAuth);
    $('authOut').addEventListener('click', function () { saveUser(null); syncAuthUi(); });
    $('authMask').addEventListener('click', function (e) { if (e.target === this) closeAuth(); });
    if ($('authEmail')) $('authEmail').addEventListener('input', function () { mailChallenge = null; authSetErr(''); });
    ['authEmail', 'authCode'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doAuth(); }
        if (e.key === 'Escape') { e.preventDefault(); closeAuth(); }
      });
      el.addEventListener('input', function () { authSetErr(''); });
    });
    syncAuthUi();
  }

  /* ================= 社区 =================
     两张表：账号（一个邮箱永远只有一行）、社区（一次分享 = 一行）。
     列名必须一模一样地抄（写错列名 SeaTable 会"插入 0 行"而不报错，这是踩过的坑）。
     图片/文件列：先走 SeaTable 的上传接口拿到附件，再按官方格式写进列 ——
       · image 列：['/workspace/<id>/files/2026-09/xxx.png', ...]（字符串数组）
       · file  列：[{ name, size, type, url }, ...]（对象数组）
     这两条是照官方 SDK 文档写的；接口万一改了，改这里的两处数组格式即可。 */
  var COMM_TABLE = '社区';
  var COMM_COL = {
    user: '用户名', file: '作品', image: '作品图', open: '是否开源',
    name: '作品名', sid: '作品iD', email: '用户邮箱'
  };
  var ACCT_COL = { email: '用户邮箱', name: '账号名', avatar: '头像', ids: '作品iD', files: '作品' };
  var UPLOAD_DIR = 'files/2026-09';       // 作品文件统一放这里
  var IMG_DIR = 'images/2026-09';         // 图片统一放这里（和文件目录分开，SeaTable 也是这么分的）
  var RUN_HOW_KEY = '__bb_runhow_v1';     // 「如何结束运行」的「不再提示」（独立 key，跟别的提示互不影响）
  var BACK_TO_KEY = '__bb_back_to_v1';    // 运行结束后该回到哪儿（'community' = 回账号页的社区那一栏）
  var UNSHARED_KEY = '__bb_unshared_v1';  // 本机记住"已取消分享"的作品iD 列表
  var ID_SEP = String.fromCharCode(1);    // 作品iD 在本地列表里的分隔符（避免和文件名里的逗号打架）

  /* ---- 值归一化：SeaTable 读回来的值可能是字符串 / 字符串数组 / 对象数组，一律拉平 ---- */
  function asArr(v) {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      var t = v.trim();
      if (t.charAt(0) === '[') { try { var j = JSON.parse(t); if (Array.isArray(j)) return j; } catch (e) {} }
      return [v];
    }
    return [v];
  }
  function strOf(v) {
    if (v == null) return '';
    if (typeof v === 'object') return String(v.name || v.url || v.text || '');
    return String(v);
  }
  function fileList(v) { return asArr(v).filter(function (x) { return x && typeof x === 'object'; }); }
  function imgList(v) {
    return asArr(v).map(function (x) {
      if (x && typeof x === 'object') return { name: String(x.name || ''), url: String(x.url || '') };
      var s = String(x || '');
      return { name: s.split('/').pop(), url: s };
    }).filter(function (x) { return !!(x.url || x.name); });
  }
  function firstPath(v) { var a = imgList(v); return a.length ? (a[0].url || a[0].name) : ''; }
  // 「是否开源」是单选列，用户建表时的选项是中文；判断时「是」「开源」「true」都算开源
  function isOpen(v) { var s = strOf(v).trim(); return s === '是' || s === '开源' || s.toLowerCase() === 'true'; }
  function nowStr() { return fmtTime(Date.now()); }
  /**
   * 把"这件作品已经发布到社区"的本地标记全部清掉。
   * 用在**导入 / 复制**出来的副本上：副本不该继承原作者的 作品iD，
   * 否则卡片上会冒出一个「管理」，用户点「更新」还会覆盖掉原作者在社区里的那一条。
   * （唯一的标记就是工程里的 shareId；本机那份"已取消分享"名单是按 iD 存的，iD 清了就够不着。）
   */
  function 清掉已发布标记(proj) {
    if (!proj || typeof proj !== 'object') return proj;
    try { delete proj.shareId; } catch (e) { proj.shareId = ''; }
    return proj;
  }
  /** 作品iD：第一次发布时生成，存进作品数据跟着作品走，改名不影响 */
  function newShareId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  function shareIdOfProject(p) {
    if (p && p.shareId) return String(p.shareId);
    var id = newShareId();
    if (p) p.shareId = id;
    return id;
  }
  /** 分享时间：优先 SeaTable 的 _ctime，没有就从 作品iD 里的时间戳兜底 */
  function sidTime(sid) {
    var n = parseInt(String(sid || '').split('-')[0], 10);
    return (n && n > 1e11 && n < 4e12) ? n : Date.now();
  }
  function timeOfRow(r) {
    var t = r && (r._ctime || r._mtime || r.ctime);
    if (t) {
      if (typeof t === 'number') return t;
      var s = String(t).replace(/(\.\d+)?\+00:00$/, 'Z').replace(' ', 'T');
      var d = new Date(s);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return sidTime(r && r[COMM_COL.sid]);
  }
  /**
   * 列里存的附件地址 → 相对路径（files/2026-09/x.fast、images/2026-09/x.png）。
   * SeaTable 的下载接口只认相对路径：带 /workspace/… 或 /asset/… 前缀都报 "path not found"（真表验过）。
   * 老数据可能存的是裸文件名或完整路径，这里统一拉平，两种都能用。
   */
  function assetRel(v) {
    var s = String(firstPath(v) || '').trim();
    if (!s) return '';
    if (/^data:/i.test(s)) return s;
    s = s.replace(/^https?:\/\/[^/]+/i, '');      // 去掉站点前缀
    s = s.replace(/^\/workspace\/[^/]+/i, '');    // 去掉 /workspace/<id>
    s = s.replace(/^\/asset\/[^/]+/i, '');        // 去掉 /asset/<uuid>
    return s.replace(/^\/+/, '');
  }
  var __assetLinks = {};   // 相对路径 → 可显示的公开地址（同一张图不重复问）
  /**
   * 拿一个能直接显示的地址。SeaTable 的附件是私有的：
   * /workspace/… 和 /asset/… 直接取都是 404/网页，唯一稳的路是 app-download-link，
   * 它会回一个 seafhttp 的公开地址，图片和文件都能从这里拿到（真表验过，图片 200 image/png）。
   */
  function assetLink(v) {
    var rel = assetRel(v);
    if (!rel) return Promise.resolve('');
    if (/^data:/i.test(rel) || /^https?:\/\//i.test(rel)) return Promise.resolve(rel);
    if (__assetLinks[rel]) return __assetLinks[rel];
    // 走中转：直接问中转要文件本身（中转自己带密钥），包里不用拿 token、也不暴露 seafhttp 直链。
    // 这里用 dlLinkUrl 拿到的就是完整地址，**不要**再套一层网关拼装。
    if (用中转()) {
      __assetLinks[rel] = Promise.resolve(dlLinkUrl(rel));
      return __assetLinks[rel];
    }
    __assetLinks[rel] = authHttp('GET', dlLinkUrl(rel), null, AUTH_TOKEN || null).then(function (d) {
      if (!d || !d.download_link) throw new Error('取不到附件地址');
      var u = String(d.download_link);
      if (!/[?&]token=/.test(u)) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(AUTH_TOKEN);
      return u;
    }).catch(function () { return ''; });
    return __assetLinks[rel];
  }
  /** 附件下载地址。
      **必须带 `t=` 口令**：`<img>` 直接加载没法加自定义请求头，不带口令中转会回 401
      —— 表现就是社区卡片"全都不显示图片"（2026-09-25 真机 + 本地都复现过）。
      另外这里回的是完整 URL，调用方不能再拿它去拼网关（会变成 /api?…&p=/api/download）。 */
  function dlLinkUrl(rel) {
    if (用中转()) {
      return CLOUD_BASE + '/api/download?path=' + encodeURIComponent(rel) + '&t=' + encodeURIComponent(MAIL_APP_TOKEN);
    }
    return AUTH_SRV + '/api/v2.1/dtable/app-download-link/?path=' + encodeURIComponent(rel);
  }
  /** 把附件铺成一块背景图（拿不到就退回文字，不留空白） */
  function 设封面(node, v, 兜底字) {
    if (!node) return;
    node.style.backgroundImage = '';
    if (兜底字 != null) node.textContent = 兜底字;
    if (!assetRel(v)) return;
    assetLink(v).then(function (u) {
      if (!u) return;
      node.style.backgroundImage = 'url("' + u + '")';
      node.textContent = '';
    });
  }
  /** 取字符串的第一个「字」（emoji 这类是双码元，直接 slice(0,1) 会截出乱码方块） */
  function 首字(s) {
    var t = String(s == null ? '' : s);
    try { var a = Array.from(t); if (a.length) return a[0]; } catch (e) {}
    return t.slice(0, 1);
  }
  /**
   * 头像值"看起来能不能用"：data 图片、http(s) 地址，或者带目录的图片附件路径。
   * 空值 / 纯文字 / 裸文件名 / 明显是别的列串过来的东西，一律当**没有头像**处理
   * —— 用户真机截图里头像位置就是一个破图，根子就是历史脏值还硬铺上去。
   */
  function 头像值可用(v) {
    var rel = assetRel(v);
    if (!rel) return false;
    if (/^data:image\//i.test(rel)) return true;
    if (/^https?:\/\//i.test(rel)) return true;
    return rel.indexOf('/') >= 0 && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(rel);
  }
  /** 这张图真的能打开吗（拿不到一律当打不开；data URL 直接算能打开） */
  function 图片能打开(u) {
    return new Promise(function (res) {
      if (/^data:/i.test(u) || typeof Image !== 'function') { res(true); return; }
      var img = new Image(), done = false;
      var timer = setTimeout(function () { if (!done) { done = true; res(false); } }, 8000);
      img.onload = function () { if (!done) { done = true; clearTimeout(timer); res(true); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(timer); res(false); } };
      try { img.src = u; } catch (e) { if (!done) { done = true; clearTimeout(timer); res(false); } }
    });
  }
  /**
   * 头像专用：铺头像，并且**保证有占位兜底**。
   * 和普通封面不同（封面铺不上就是一块底色，头像铺不上在用户眼里就是"破图"）：
   *   1) 值不像附件地址 → 当没有头像；
   *   2) app-download-link 取不到（历史脏值指向不存在的路径）→ 当没有头像；
   *   3) 地址拿到了、图其实打不开 → 也退回占位，绝不把坏图铺上去。
   */
  function 设头像(node, v, 兜底字) {
    if (!node) return;
    function 占位() { node.style.backgroundImage = ''; if (兜底字 != null) node.textContent = 兜底字; }
    占位();
    if (!头像值可用(v)) return;
    assetLink(v).then(function (u) {
      if (!u) return;
      图片能打开(u).then(function (ok) {
        if (!ok) return;
        node.style.backgroundImage = 'url("' + u + '")';
        node.textContent = '';
      });
    }).catch(function () { 占位(); });
  }
  /** 本机记住的"已取消分享" */
  function unsharedIds() { try { return JSON.parse(localStorage.getItem(UNSHARED_KEY) || '[]') || []; } catch (e) { return []; } }
  function setUnshared(sid, on) {
    var a = unsharedIds().filter(function (x) { return x !== sid; });
    if (on) a.push(sid);
    try { localStorage.setItem(UNSHARED_KEY, JSON.stringify(a)); } catch (e) {}
  }
  function isUnshared(sid) { return unsharedIds().indexOf(String(sid || '')) >= 0; }
  function runHowSeen() { try { return localStorage.getItem(RUN_HOW_KEY) === '1'; } catch (e) { return true; } }
  function setRunHowSeen(v) { try { if (v) localStorage.setItem(RUN_HOW_KEY, '1'); else localStorage.removeItem(RUN_HOW_KEY); } catch (e) {} }
  /** 取出并清掉「运行结束后回哪儿」的标记（'community' = 回账号页的社区那一栏） */
  function 消费运行来源() {
    var v = '';
    try { v = sessionStorage.getItem(BACK_TO_KEY) || ''; sessionStorage.removeItem(BACK_TO_KEY); } catch (e) { v = ''; }
    // 从社区运行回来的：顺手把「试运行」标记也收掉。
    // 社区那次运行也会落 __fromPreview（和编辑器试运行同一套标记），但它的返回路径是
    // "回社区那一栏"、不是"重开上次编辑的工程"，留着它只会让下一次冷启动逻辑误判。
    if (v === 'community') { try { sessionStorage.removeItem('__fromPreview'); } catch (e) {} }
    return v;
  }

  /* ---- 行读写（一律走 authHttp，测试里 window.__authSetHttp 能整体替换掉网络层） ---- */
  /**
   * 读表统一超时 40 秒。
   * 原来走默认的 20 秒：真机在地铁/弱网下经常来不及，界面上就是「连接超时，请检查网络」，
   * 而其实同一份数据 25 秒就回来了（用户真机报的"我分享到社区的作品 加载失败：连接超时"）。
   */
  var ROWS_TIMEOUT_MS = 40000;
  /**
   * 网络动作失败**自动重试一次**。
   * 手机上大多数失败都是超时/断网这类抖动，重试一次基本就好；
   * 仍然失败才把错误抛给界面，并且带上"是哪一步"（步名），别让用户看到一句光秃秃的网络错误。
   */
  function 重试一次(fn, 步名) {
    return fn().catch(function (e1) {
      return fn().catch(function (e2) {
        var m = (e2 && e2.message) || e2 || '网络错误';
        throw new Error((步名 ? 步名 + '：' : '') + m);
      });
    });
  }
  function tblRows(tbl) {
    return 重试一次(function () {
      return authEndpoint().then(function (c) {
        var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/?table_name=' + encodeURIComponent(tbl) + ROWS_TAIL);
        return authHttp('GET', url, null, c.acc, { bearer: true, timeoutMs: ROWS_TIMEOUT_MS })
          .then(function (d) { return (d && d.rows) || []; });
      });
    }, '读取表格');
  }
  function tblInsert(tbl, row) {
    return authEndpoint().then(function (c) {
      var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/');
      return authHttp('POST', url, { table_name: tbl, rows: [row] }, c.acc, { bearer: true }).then(function (d) {
        // 列名写错时 SeaTable 返回"插入 0 行"，必须当成失败（踩过的坑，见上面登录那段）
        var n = d && (d.inserted_row_count || (d.rows && d.rows.length) || 0);
        if (!n) throw new Error('没写进表格，稍后再试');
        // 真接口回的是 first_row，不是 rows（真表验过）
        var fr = (d && d.first_row) || (d && d.rows && d.rows[0]) || null;
        var rid = (fr && (fr._id || fr.id)) || '';
        return { id: rid, row: row };
      });
    });
  }
  function tblUpdate(tbl, rowId, row) {
    return authEndpoint().then(function (c) {
      var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/');
      // 改行和新增行走的是同一个地址，但形状完全不一样（真表逐条验过）：
      //   新增 POST { table_name, rows: [ { 列名: 值 } ] }
      //   修改 PUT  { table_name, updates: [ { row_id, row: { 列名: 值 } } ] }
      //     · 用 rows             → 400 missing updates field（用户截图报的就是这个）
      //     · 用 _id 当行号        → 400 invalid row_id field（必须是 row_id）
      //     · 值不嵌在 row 里      → 200 success 但**一个字都不改**（只动 _mtime），
      //       最坑的一种：界面显示"更新成功"，刷新一看还是老数据。所以列必须放进 row。
      var 改 = {};
      for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k) && k !== '_id') 改[k] = row[k];
      return authHttp('PUT', url, { table_name: tbl, updates: [{ row_id: rowId, row: 改 }] }, c.acc, { bearer: true });
    });
  }
  /**
   * 一次 PUT 改多行（形状同 tblUpdate，只是 updates 里有多个）。
   * 用在"账号改名后把社区里该作者的作品一起改名"这种批量场景：
   * 逐行 PUT 会发 N 个请求，行数一多就慢且容易被限流。
   */
  function tblUpdateMany(tbl, list) {
    if (!list || !list.length) return Promise.resolve();
    return authEndpoint().then(function (c) {
      var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/');
      var updates = list.map(function (x) {
        var 改 = {};
        for (var k in x.row) if (Object.prototype.hasOwnProperty.call(x.row, k) && k !== '_id') 改[k] = x.row[k];
        return { row_id: x.rowId, row: 改 };
      });
      return authHttp('PUT', url, { table_name: tbl, updates: updates }, c.acc, { bearer: true });
    });
  }
  function tblDelete(tbl, rowId) {
    return authEndpoint().then(function (c) {
      var url = 网关('/api/v2/dtables/' + c.uuid + '/rows/');
      // 删行接口要的是 row_ids（不是 rows）：写成 rows 时 SeaTable 既不报错也不删，
      // 表现就是「删除分享」看着成功了、刷新一下那一条还在。
      return authHttp('DELETE', url, { table_name: tbl, row_ids: row_ids_(rowId) }, c.acc, { bearer: true });
    });
  }
  function row_ids_(id) { return Array.isArray(id) ? id.filter(Boolean) : [id]; }

  /* ---- 附件上传：拿上传链接 → multipart 传文件 → 拼出可显示/可写回列的地址 ---- */
  function b64bytes(b64) {
    var bin = '';
    try { bin = atob(String(b64 || '')); } catch (e) { return null; }
    if (!bin.length) return null;
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }
  function bytesLatin1(u8) {
    var s = '', CH = 8192;
    for (var i = 0; i < u8.length; i += CH) {
      var end = Math.min(u8.length, i + CH);
      for (var j = i; j < end; j++) s += String.fromCharCode(u8[j]);
    }
    return s;
  }
  function u8cat(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], o); o += list[i].length; }
    return out;
  }
  /* 无头/浏览器直连 fetch；有原生桥就把整个 multipart 体按 Latin-1 交给原生（Java 侧按字节还原） */
  function uploadRawPost(url, headers, ct, bodyU8) {
    // 自动化测试钩子：装了假网络（window.__authSetHttp）就让上传也走它。
    // 否则上传会绕过 authHttp 直接打真服务器 —— 用例既看不到传了什么，还可能真传上去。
    if (authTestHttp) return Promise.resolve(authTestHttp('POST', url, bytesLatin1(bodyU8), null, { headers: headers }));
    // 走中转：交给 editorCloudHttp 统一打包（把 multipart 体当字符串放进 b），
    // 不要在这里自己拼 /api 地址 —— 那样会被再套一层，变成 p=/api 被拒（踩过）。
    // 注意：URL 用 中转链接('/api') 明确指到中转的 /api，
    // 并在 headers 里打标记，让 editorCloudHttp **不要再包一层**。
    if (用中转() && /^https?:\/\//i.test(String(url))) {
      var _upRel = String(url).replace(/^https?:\/\/[^/]+/i, '');
      // 走中转的 POST：body 里已经是 {p,m,q,b} 的形状，用 opts._rel 告诉
      // editorCloudHttp"别再包一层"（否则会变成 p=/api 被拒）。
      return authHttp('POST', 中转链接('/api'), {
        p: _upRel, m: 'POST', q: '', b: bytesLatin1(bodyU8), ct: ct
      }, null, { timeoutMs: 60000, _rel: '/api' });
    }
    if (window.Native && Native.httpRequest) {
      return new Promise(function (resolve, reject) {
        var id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; delete 原生待回[id]; reject(new Error('上传超时，请检查网络')); } }, 60000);
        // 和 editorCloudHttp 共用同一张请求号表：一次发布要传图标 + 作品文件两个附件，
        // 各自临时占用全局回调槽时，先传完的那个会把槽还给"它进函数前的样子"，
        // 另一个就永远收不到结果（上传功能里一模一样的老 bug）。
        原生待回[id] = function (json) {
          if (done) return; done = true; clearTimeout(timer); delete 原生待回[id];
          var r = null; try { r = JSON.parse(json); } catch (e) { reject(new Error('上传失败')); return; }
          if (r.error) { reject(new Error(r.error)); return; }
          var raw = null; try { raw = JSON.parse(r.body || 'null'); } catch (e) { raw = null; }
          if (r.status < 200 || r.status >= 300 || raw == null) { reject(new Error('上传失败 HTTP ' + r.status)); return; }
          resolve(raw);
        };
        try { Native.httpRequest(id, 'POST', url, JSON.stringify(headers), bytesLatin1(bodyU8)); }
        catch (e) { if (done) return; done = true; clearTimeout(timer); delete 原生待回[id]; reject(e); }
      });
    }
    return fetch(url, { method: 'POST', headers: headers, body: new Blob([bodyU8], { type: ct }) }).then(function (resp) {
      return resp.text().then(function (txt) {
        var d = null; try { d = JSON.parse(txt); } catch (e) { d = null; }
        if (!resp.ok || d == null) throw new Error('上传失败 HTTP ' + resp.status);
        return d;
      });
    });
  }
  var __upCache = {};
  /**
   * 上传一个附件（图片或作品文件），返回可写进列的地址。
   *   spec = { dataUrl } 或 { bytes, name, mime }
   *   返回 { url, name, size, type }；url 为 /workspace/... 形式时按 SeaTable 官方写法可直接写进 image 列。
   */
  function dtableUpload(spec) {
    var bytes = null, mime = '', fname = '';
    if (spec && spec.dataUrl) {
      var du = String(spec.dataUrl);
      var m = /^data:([^;,]+)[^,]*,([\s\S]*)$/.exec(du);
      if (!m) return Promise.reject(new Error('图片数据不对'));
      mime = m[1] || 'image/png';
      // 是不是 base64 要看 dataURL 自己的声明（"…;base64,…"），**不是**看载荷里有没有 "base64" 这几个字。
      // 之前就是写成看载荷，结果 base64 图永远解出 0 字节 → 被当成"没有要上传的内容"悄悄失败：
      // 表现是「分享到社区」的图标和「换头像」都传不上去，图片列一直是空的。
      bytes = /;base64/i.test(du) ? b64bytes(m[2]) : null;
      if (!bytes || !bytes.length) {
        var raw = '';
        try { raw = decodeURIComponent(m[2]); } catch (e) { raw = m[2]; }
        bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
      }
      fname = 'icon_' + Date.now() + (mime.indexOf('png') >= 0 ? '.png' : (mime.indexOf('jpeg') >= 0 ? '.jpg' : '.img'));
    } else if (spec && spec.bytes) {
      bytes = spec.bytes; mime = spec.mime || 'application/octet-stream'; fname = spec.name || ('file_' + Date.now());
    }
    if (!bytes || !bytes.length) return Promise.reject(new Error('没有要上传的内容'));
    var isImg = mime.indexOf('image/') === 0;
    return authEndpoint().then(function (c) {
      var dir = isImg ? IMG_DIR : UPLOAD_DIR;
      // 必须用 网关()：走中转时拼到中转上，直连时才拼主站。
      // 这里以前写的是 AUTH_SRV + …，发布作品时会**直连 SeaTable**（浏览器被 CORS 挡下 → Failed to fetch；
      // App 里则是漏了密钥/权限，报 Permission denied）——用户报的"发布到社区失败"就是这一条。
      var url = 网关('/api/v2.1/dtable/app-upload-link/');
      return authHttp('GET', url, null, AUTH_TOKEN || null).then(function (lk) {
        if (!lk || !lk.upload_link) throw new Error('取不到上传地址');
        // 图片和文件要分开放：官方给的 img_relative_path / file_relative_path 就是这两个目录
        var rel = isImg ? (lk.img_relative_path || lk.relative_path || dir) : (lk.file_relative_path || lk.relative_path || dir);
        var up = String(lk.upload_link);
        if (!/[?&]ret-json=1/.test(up)) up += (up.indexOf('?') >= 0 ? '&' : '?') + 'ret-json=1';
        var B = '----fastup' + Math.random().toString(36).slice(2, 12);
        var head = '--' + B + '\r\nContent-Disposition: form-data; name="parent_dir"\r\n\r\n' + (lk.parent_path || '') + '\r\n' +
          '--' + B + '\r\nContent-Disposition: form-data; name="relative_path"\r\n\r\n' + rel + '\r\n' +
          '--' + B + '\r\nContent-Disposition: form-data; name="file"; filename="' + fname + '"\r\n' +
          'Content-Type: ' + mime + '\r\n\r\n';
        var body = u8cat([new TextEncoder().encode(head), bytes, new TextEncoder().encode('\r\n--' + B + '--\r\n')]);
        return uploadRawPost(up, { 'Content-Type': 'multipart/form-data; boundary=' + B }, 'multipart/form-data; boundary=' + B, body)
          .then(function (d) {
            var f = Array.isArray(d) ? d[0] : (d && d.name ? d : null);
            var nm = (f && (f.name || f.filename)) || fname;
            var u = (f && f.url) ? String(f.url) : '';
            if (!u) u = assetPath(lk, rel, nm, c);
            var p = assetRel(u);
            __upCache[p] = { url: u, name: nm, size: (f && (f.size || 0)) || bytes.length, type: isImg ? 'image' : 'file' };
            return __upCache[p];
          });
      });
    });
  }
  /**
   * 传完文件后，要写进列里的地址。
   * 官方示例（developer.seatable.com/javascript/files）给的就是这个拼法，2026-09-25 拿真表逐条验证过：
   *   /workspace/<workspace_id><parent_path>/<relative_path>/<文件名>
   * 例如 /workspace/600134/asset/<uuid>/images/2026-09/icon_1.png
   * 注意上传接口（ret-json=1）只回 {id, name, size}，**没有 url**，所以必须自己拼。
   */
  function assetPath(lk, rel, name, c) {
    var wsid = lk.workspace_id || (c && c.ws) || '';
    var base = String(lk.parent_path || ('/asset/' + ((c && c.uuid) || ''))).replace(/\/+$/, '');
    return (wsid ? '/workspace/' + wsid : '') + base + '/' + String(rel || '').replace(/^\/+/, '') + '/' + name;
  }

  /* ---- 社区列表 / 我分享的 ---- */
  /**
   * 进/切到「社区」这一栏时，会连着触发几次 renderCommunity（切栏一次、点标签一次）。
   * 每次都真读表 + 先清空再重画 —— 用户看到的就是列表"闪两下"（2026-09-25 真机反馈）。
   * 这里做两件事：
   *   1) 极短时间内的重复调用直接**复用刚读到的数据**，不再读第二次表；
   *   2) 已经有内容时不清空，直接原地重画，避免"白一下再回来"。
   */
  var COMM_SOFT_MS = 1200;          // 这段时间内重复进社区 = 同一次进入
  function renderCommunity(opts) {
    opts = opts || {};
    var box = $('acctComm'), empty = $('acctCommEmpty'), more = $('acctMore');
    if (!box) return;
    // 上一次加载失败过、这次是"重新进页面/点了刷新" → 先清掉错误重来。
    // （以前这里直接 return，于是一次失败就永远卡在错误页：点「刷新」也没反应。）
    if (opts.refresh) commState.error = '';
    // 正在读的时候又点了「刷新」：记一笔，这次读完立刻再读一次。
    // （按钮一被点就进忙碌态并禁用，见 刷新按钮忙()；重复点击不该被无声吞掉。）
    if (commState.loading) { if (opts.refresh) commState.pending = true; return; }
    // 刚刚读过（就是同一次"进社区"）→ 直接重画，不再读表，避免闪第二下。
    // 注意：**显式点「刷新」必须真的重读**（opts.refresh 时跳过这段缓存）。
    if (!opts.refresh && !opts.force && commState.open && !commState.error && commState.at && (Date.now() - commState.at) < COMM_SOFT_MS) {
      drawCommunity();
      return;
    }
    if (commState.open && commState.error) {
      box.innerHTML = '';
      if (empty) { empty.textContent = commState.error; empty.classList.remove('hidden'); }
      if (more) more.classList.add('hidden');
      return;
    }
    commState.loading = true;
    刷新按钮忙(true);
    // **已经读到过数据**时不要显示"正在加载…"：那会让人眼前的卡片先消失再回来（闪一下）。
    // 只有第一次（当前栏是空的）才需要加载态。
    var 已有内容 = !!(box.children && box.children.length) || (commState.rows && commState.rows.length);
    if (!commState.open && !已有内容) { box.innerHTML = ''; if (empty) { empty.textContent = '正在加载…'; empty.classList.remove('hidden'); } }
    else if (empty) { empty.classList.add('hidden'); }
    tblRows(COMM_TABLE).then(function (rows) {
      commState.loading = false; 刷新按钮忙(false);
      commState.open = true; commState.error = '';
      commState.at = Date.now();
      // 社区列表已经读回来了：顺手核对一遍"哪些是我发的"（首页卡片上那个「管理」靠它判断），
      // 省掉一次重复读表
      var _u = currentUser();
      我的社区iD = 挑我的社区iD(rows, _u ? String(_u.email || '').trim().toLowerCase() : '');
      我的社区iD已核对 = !!_u;
      renderHome();
      commState.rows = (rows || []).slice().sort(function (a, b) { return timeOfRow(b) - timeOfRow(a); });   // 最新在上
      commState.shown = Math.min(commState.shown || 0, commState.rows.length) || Math.min(8, commState.rows.length);
      if (commState.shown < 8) commState.shown = Math.min(8, commState.rows.length);
      // 读的过程中用户又点过刷新 → 立刻按最新数据再读一次
      if (commState.pending) { commState.pending = false; renderCommunity({ refresh: true }); return; }
      drawCommunity();
    }).catch(function (e) {
      commState.loading = false; 刷新按钮忙(false);
      commState.open = true;
      commState.error = '社区加载失败：' + ((e && e.message) || '网络错误');
      commState.pending = false;
      drawCommunity();
    });
  }
  function drawCommunity() {
    var box = $('acctComm'), empty = $('acctCommEmpty'), more = $('acctMore');
    if (!box || !empty || !more) return;
    if (commState.error) { box.innerHTML = ''; empty.textContent = commState.error; empty.classList.remove('hidden'); more.classList.add('hidden'); return; }
    var list = commState.rows.slice(0, commState.shown);
    // 内容没变就别重建 DOM：切栏时这个函数会被触发两次（切栏 + 一个 rAF），
    // 每次 children 全删全加会让列表在慢设备上"闪一下"（2026-09-25 真机反馈）。
    // ⚠️ 指纹必须把**卡片上真正画出来的内容**都算进去（2026-10-27 用户报的"改名后后台是新的、App 还是原名"，
    // 以及 2026-10-28 报的"改回不开源后社区还显示开源"）：
    // 以前只比 作品iD/作品名/条数（后来补了作者名），但「是否开源」「封面图」变了不动指纹 →
    // 这里判定"内容没变"直接 return，新读回来的行根本没被画出来，卡片一直停在旧状态（只有重启 App 才会好）。
    // 卡片实际渲染的就是：封面图 / 作品名 / 是否开源 / 作者 / 时间 —— 这五项 + 作品iD 都得进指纹。
    var 指纹 = list.map(function (r) {
      return [strOf(r[COMM_COL.sid]), strOf(r[COMM_COL.name]), strOf(r[COMM_COL.user]),
        strOf(r[COMM_COL.open]), firstPath(r[COMM_COL.image]), timeOfRow(r)].join('\u0002');
    }).join('\u0001') + '#' + list.length;
    if (commState.指画过 === 指纹 && box.children.length) { return; }
    commState.指画过 = 指纹;
    // 错峰动画只在该栏**本次进入的第一次**绘制时播；之后的重画（点标签、发完作品刷新）
    // 再重播一遍会变成"又闪一次"，用户看到的就是闪两下。
    var 播错峰 = !commState.drew;
    commState.drew = true;
    box.innerHTML = '';
    list.forEach(function (r, 序) {
      var c = 社区卡片(r);
      if (播错峰) 错峰(c, 序);
      box.appendChild(c);
    });
    empty.textContent = list.length ? '' : '社区里还没有作品';
    empty.classList.toggle('hidden', list.length > 0);
    more.classList.toggle('hidden', commState.shown >= commState.rows.length);
  }
  function 社区卡片(r) {
    var card = el('div', 'comm-card');
    var cover = el('div', 'comm-cover');
    设封面(cover, r[COMM_COL.image], String(r[COMM_COL.name] || '作品').slice(0, 1));
    card.appendChild(cover);
    var info = el('div', 'comm-info');
    var nm = el('div', 'comm-name', String(r[COMM_COL.name] || '未命名'));
    if (isOpen(r[COMM_COL.open])) nm.appendChild(el('span', 'comm-tag', '开源'));
    info.appendChild(nm);
    info.appendChild(el('div', 'comm-sub', '作者：' + (strOf(r[COMM_COL.user]) || '匿名')));
    info.appendChild(el('div', 'comm-sub', fmtTime(timeOfRow(r))));
    card.appendChild(info);
    // 两个按钮放进右边的信息列里 —— 整张卡是「左小图标 + 右详细信息」的横排小卡
    var ops = el('div', 'comm-ops');
    var save = el('button', 'tb', '保存本地'); save.type = 'button';
    // 未开源 → 不能存本地（置灰）；运行不分开不开源，都能点
    save.disabled = !isOpen(r[COMM_COL.open]);
    save.addEventListener('click', function () { 保存社区作品(r); });
    var run = el('button', 'tb primary', '运行'); run.type = 'button';
    run.addEventListener('click', function () { 运行社区作品(r); });
    ops.appendChild(save); ops.appendChild(run);
    info.appendChild(ops);
    return card;
  }
  /* 「我分享到社区的作品」：
       · 账号行里的 作品iD 清单为空 → 直接空状态（用户刚把社区里的测试作品删光，这是正常场景，不该报网络错）
       · 有清单 → **一次**把社区表读回来，按 作品iD 匹配渲染（不按 ID 逐个请求）
       · 读失败 → 先拿上次成功的那份缓存顶上（离线也能看），再给一个「重试」按钮；不白屏一句错
       · 自愈：清单里在社区表已经不存在的 ID，从账号行清掉（连带对不上的 作品 文件），别留幽灵条目 */
  var MINE_CACHE_KEY = '__bb_mine_v1';
  function 读我的缓存() {
    try { var o = JSON.parse(localStorage.getItem(MINE_CACHE_KEY) || 'null'); return (o && Array.isArray(o.list)) ? o.list : null; } catch (e) { return null; }
  }
  function 写我的缓存(list) { try { localStorage.setItem(MINE_CACHE_KEY, JSON.stringify({ at: Date.now(), list: list })); } catch (e) {} }
  function 画我的分享(list, 备注) {
    var box = $('acctMine'); if (!box) return;
    box.innerHTML = '';
    // 最新分享的排最上面（用户 2026-09-26 要求）。
    // 账号表里的「作品iD」是按当初分享的先后追加的，不排就是"最老的在最上"。
    // 排序放在这里而不是数据源头：正常路径和「读失败用本地缓存顶上」那条路都过这里，
    // 连旧版本存下来的缓存也会被排对。口径和社区列表一致（按分享时间倒序）。
    list = (list || []).slice().sort(function (a, b) {
      return (timeOfRow(b.crow) - timeOfRow(a.crow)) || (sidTime(b.sid) - sidTime(a.sid));
    });
    if (备注) box.appendChild(el('div', 'acct-empty', 备注));
    if (!list.length) { if (!备注) box.appendChild(el('div', 'acct-empty', '还没有分享到社区的作品')); return; }
    list.forEach(function (x, 序) {
      var row = 我的分享行(x.sid, x.file, x.crow);
      if (!box.__drew) 错峰(row, 序);      // 同一次进入只播一次，避免重画时又闪一下
      box.appendChild(row);
    });
    box.__drew = true;
  }
  function 我的分享加重试按钮(msg) {
    var box = $('acctMine'); if (!box) return;
    var 缓 = 读我的缓存();
    画我的分享(缓 || [], msg + (缓 ? '（下面是上次看到的内容）' : ''));
    var b = el('button', 'tb', '重试'); b.type = 'button';
    b.id = 'acctMineRetry';
    b.addEventListener('click', function () { renderMine(); });
    box.appendChild(b);
  }
  /** 账号行里那些社区表已经没有的 作品iD：写回账号行（连带清掉对不上的 作品 文件），本机也记成"已取消分享" */
  function 清理幽灵分享(幽灵, row) {
    if (!row || !row._id || !幽灵.length) return;
    var ids = idList(row[ACCT_COL.ids]);
    var files = fileList(row[ACCT_COL.files]);
    var 新ids = [], 新files = [];
    ids.forEach(function (sid, i) {
      if (幽灵.indexOf(sid) >= 0) return;
      新ids.push(sid);
      if (files[i]) 新files.push(files[i]);
    });
    var fields = {};
    fields[ACCT_COL.ids] = 新ids.join(', ');
    fields[ACCT_COL.files] = 新files;
    tblUpdate(AUTH_TABLE, row._id, fields).then(function () {
      幽灵.forEach(function (sid) { setUnshared(sid, true); });
    }).catch(function () { /* 清不掉也不影响这次显示，下次进页面再试 */ });
  }
  function renderMine() {
    var box = $('acctMine'); if (!box) return;
    var u = currentUser(); if (!u) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    box.appendChild(el('div', 'acct-empty', '正在加载…'));
    tblRows(AUTH_TABLE).then(function (rows) {
      var row = authFind(rows, u.email);
      // 用 idList 而不是 asArr：账号表一个邮箱永远只有一行，清单可能被写成 "a, b" 这种逗号串
      var ids = row ? idList(row[ACCT_COL.ids]) : [];
      var files = row ? fileList(row[ACCT_COL.files]) : [];
      if (!ids.length) { box.innerHTML = ''; 写我的缓存([]); 画我的分享([]); return; }   // 空清单 = 空状态，不报错
      return tblRows(COMM_TABLE).then(function (crows) {
        var byId = {};
        (crows || []).forEach(function (r) { var k = strOf(r[COMM_COL.sid]).trim(); if (k) byId[k] = r; });
        var 活的 = [], 幽灵 = [];
        ids.forEach(function (sid, i) {
          if (byId[sid]) 活的.push({ sid: sid, file: files[i] || null, crow: byId[sid] });
          else 幽灵.push(sid);
        });
        写我的缓存(活的);
        画我的分享(活的);
        if (幽灵.length) 清理幽灵分享(幽灵, row);
      });
    }).catch(function (e) {
      我的分享加重试按钮('加载失败：' + ((e && e.message) || '网络错误'));
    });
  }
  function 我的分享行(sid, file, crow) {
    var row = el('div', 'mine-row');
    var cover = el('div', 'mine-cover');
    if (crow) 设封面(cover, crow[COMM_COL.image]);
    row.appendChild(cover);
    var col = el('div', 'mine-col');
    col.appendChild(el('div', 'mine-name', String((crow && crow[COMM_COL.name]) || (file && file.name) || '作品')));
    col.appendChild(el('div', 'mine-meta', '分享于 ' + fmtTime(crow ? timeOfRow(crow) : sidTime(sid)) +
      ' · ' + ((crow && isOpen(crow[COMM_COL.open])) ? '开源' : '未开源')));
    row.appendChild(col);
    var ops = el('div', 'mine-ops');
    var mg = el('button', 'tb', '管理'); mg.type = 'button';
    mg.addEventListener('click', function () { 打开管理(sid, $('acctName') ? ($('acctName').value || '') : '', $('acctMail') ? $('acctMail').textContent : ''); });
    var del = el('button', 'tb danger-text', '删除分享'); del.type = 'button';
    del.addEventListener('click', function () { 删除分享(sid, function () { 退出管理(); renderMine(); }); });
    ops.appendChild(mg); ops.appendChild(del);
    row.appendChild(ops);
    return row;
  }

  /* ---- 社区作品的下载 / 运行 / 存本地 ---- */
  /**
   * 把一件社区作品的 .fast 取回来。
   * 分两步，各自**放宽超时 + 失败重试一次**，并且失败时说的是"哪一步"——
   * 真机报过"社区作品有时候打不开"，就是这里一步超时整条链子就废了，界面还只给一句网络错误。
   */
  /** 取回一段**原样文本**（作品 .fast / 附件）。
      走中转时：GET 一次就好，中转内部自己换下载地址 —— 少一次往返、也不会超时。
      直连时：先换 dlLinkUrl 拿临时直链，再取文本（原来那两步走）。
      注意：走中转时**不能用 authHttp 的 JSON 解析**（作品文件是文本，按 JSON 解会失败），
      所以这里用 raw:true；装了测试替身网络时也走它，用例才能拦住这次请求。 */
  function 取文本(rel, 步名) {
    if (用中转()) {
      var u = dlLinkUrl(rel);
      var 取 = function () { return authHttp('GET', u, null, null, { raw: true, timeoutMs: ROWS_TIMEOUT_MS }); };
      return 重试一次(取, 步名);
    }
    return 重试一次(function () {
      return authHttp('GET', dlLinkUrl(rel), null, AUTH_TOKEN || null, { timeoutMs: ROWS_TIMEOUT_MS }).then(function (d) {
        if (!d || !d.download_link) throw new Error('没拿到下载地址');
        var u = String(d.download_link);
        if (!/[?&]token=/.test(u)) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(AUTH_TOKEN);
        return 重试一次(function () {
          return authHttp('GET', u, null, null, { raw: true, timeoutMs: ROWS_TIMEOUT_MS });
        }, 步名);
      });
    }, '取作品下载地址');
  }
  function downloadWork(r) {
    var path = assetRel(r[COMM_COL.file]);   // 下载接口只认相对路径（真表验过）
    if (!path) return Promise.reject(new Error('这个作品没有文件'));
    return 取文本(path, '下载作品文件').then(function (txt) {
      var data = null;
      if (typeof txt === 'string') { try { data = JSON.parse(txt); } catch (e) { data = null; } }
      else data = txt;
      var proj = (data && data.project && Array.isArray(data.project.screens)) ? data.project
               : ((data && Array.isArray(data.screens)) ? data : null);
      if (!proj) throw new Error('作品文件已经损坏，读不出内容');
      return { proj: proj, raw: data };
    });
  }
  /* 社区卡片的「保存本地」：先弹二选一 —— 存到手机 / 在编辑器生成一个副本。
     两条路都先把作品下下来，区别只在下下来之后怎么落：一个只落盘、一个导进本地作品列表。 */
  var 待存社区行 = null;
  function 保存社区作品(r) {
    if (!isOpen(r[COMM_COL.open])) { snack('这个作品没有开源，不能保存'); return; }
    待存社区行 = r;
    var m = $('commSaveMask');
    if (!m) { 存到手机(r); return; }     // 弹窗不在（老页面缓存）→ 退回"直接存手机"
    m.classList.remove('hidden');
  }
  function 关闭保存社区() { 关遮罩($('commSaveMask')); }
  /**
   * 选项一「保存到手机」：把 .fast 原样写进手机公共「下载/fast本地app」。
   * 走的是作品卡片「保存在本地」同一个原生方法 saveProject —— 只落盘、不唤起分享面板，
   * 提示也由原生只 toast 一次（JS 这边不再 snack，免得又是两条一样的提示）。
   */
  function 存到手机(r) {
    关闭保存社区();
    modal('正在保存', '正在下载作品…');
    downloadWork(r).then(function (d) {
      var text = JSON.stringify({ fast: FAST_FORMAT, kind: 'project',
        appName: String(r[COMM_COL.name] || ''), exportedAt: Date.now(), project: d.proj, media: {} });
      var fname = (String(r[COMM_COL.name] || '').trim() || 'FAST作品') + '.fast';
      hideModal();
      if (window.Native && Native.saveProject) {
        try { Native.saveProject(text, fname); }
        catch (e) { modal('保存失败', String((e && e.message) || e)); }
        return;
      }
      // 老版本 APK 还没有 saveProject：借用分享通道落盘（会顺带弹分享面板）
      if (window.Native && Native.shareProject) {
        try { Native.shareProject(text, fname); snack('已保存到「下载/fast本地app」'); }
        catch (e) { modal('保存失败', String((e && e.message) || e)); }
        return;
      }
      try {
        window.__lastSharePayload = text;
        var blob = new Blob([text], { type: 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fname;
        document.body.appendChild(a); a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1000);
        snack('已保存作品文件');
      } catch (e) { modal('保存失败', String((e && e.message) || e)); }
    }).catch(function (e) { hideModal(); modal('保存失败', (e && e.message) || '网络错误'); });
  }
  /** 选项二「在编辑器生成一个副本」：走现成的导入 .fast 逻辑，生成一份能打开、能编辑的本地作品 */
  function 生成编辑器副本(r) {
    关闭保存社区();
    modal('正在导入', '正在下载作品…');
    downloadWork(r).then(function (d) {
      hideModal();
      var res = importFastText(JSON.stringify({ fast: FAST_FORMAT, kind: 'project', appName: String(r[COMM_COL.name] || ''), project: d.proj }));
      if (!res.ok) { modal('生成副本失败', res.msg || '这个作品存不下来'); return; }
      snack('已保存为「' + res.name + '」');
    }).catch(function (e) { hideModal(); modal('生成副本失败', (e && e.message) || '网络错误'); });
  }
  function 运行社区作品(r) {
    if (runHowSeen()) { doRunCommunity(r); return; }
    pendingRunRow = r;
    var m = $('runHowMask'), cb = $('runHowNever');
    if (!m) { doRunCommunity(r); return; }
    if (cb) { cb.classList.remove('on'); cb.setAttribute('aria-checked', 'false'); }
    m.classList.remove('hidden');
  }
  var pendingRunRow = null;
  function doRunCommunity(r) {
    var m = $('runHowMask'); if (m) m.classList.add('hidden');
    modal('正在打开', '正在下载作品…');
    downloadWork(r).then(function (d) {
      // ⚠️ 安全：这是从社区下载的**别人的**作品，里面的 code 字段可能是手写的任意 JS。
      // 运行时会 new Function(sc.code) 直接执行它，所以先按代码块重新生成一遍再交给运行时。
      洗掉外来代码(d.proj);
      try { localStorage.setItem('__previewProject', JSON.stringify(d.proj)); } catch (e) {}
      try { localStorage.removeItem('__previewStartScreen'); } catch (e) {}
      // 和编辑器里 doRun() 落**同一套**标记：`__previewProject`（运行时靠它认出这是试运行）
      // + `__fromPreview`（sessionStorage：这次离开是试运行）。少设后者，运行时就不算试运行，
      // 通知栏那套「终止运行」也起不来（回归用例⑥就是这么红的）。
      try { sessionStorage.setItem('__fromPreview', '1'); } catch (e) {}
      // 再单独记一条"是从社区点进来的"：回来后由 消费运行来源() 优先送回社区那一栏，
      // 而不是像编辑器试运行那样把上次编辑的工程重新打开。
      try { sessionStorage.setItem(BACK_TO_KEY, 'community'); } catch (e) {}
      // 和编辑器里点「运行」同一条路：方向和外壳显隐都一样
      if (window.Native && Native.setLayoutChrome) Native.setLayoutChrome(true);
      var scId = d.proj.startScreen || (d.proj.screens[0] && d.proj.screens[0].id) || '';
      var sc0 = null;
      (d.proj.screens || []).forEach(function (s) { if (s.id === scId) sc0 = s; });
      if (window.Native && Native.setOrientation) Native.setOrientation((sc0 && sc0.orientation) || d.proj.orientation || 'portrait');
      try { $('modalMask').classList.add('hidden'); } catch (e) {}
      location.href = 'runtime.html';
    }).catch(function (e) {
      try { $('modalMask').classList.add('hidden'); } catch (e2) {}
      modal('运行失败', (e && e.message) || '网络错误');
    });
  }

  /* ---- 发布 / 更新 / 删除分享 ---- */
  function projectOf(id) {
    var s = loadStore();
    for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) return s.items[i];
    return null;
  }
  function saveProjectIcon(id, icon) {
    var s = loadStore();
    s.items.forEach(function (it) {
      if (it.id !== id) return;
      it.project.icon = icon || null;
      it.updatedAt = Date.now();
    });
    saveStore(s);
    // 正在编辑这个作品时，内存里的工程也要同步 —— 统一图标：分享改了，导出也用新的
    if (state.itemId === id && state.project) state.project.icon = icon || null;
  }
  /**
   * 把首次生成的作品iD 存回作品数据。
   * 必须存！否则每次发布都重新生成一个新 iD → 社区表里同一件作品会一行一行往上堆
   * （用户报的"更新作品时社区表里又多出了几行"就是这么来的），「管理」也找不到对应那一行。
   */
  function saveProjectShareId(id, sid) {
    if (!id || !sid) return;
    var s = loadStore(), hit = false;
    s.items.forEach(function (it) {
      if (it.id !== id) return;
      if (it.project.shareId === sid) { hit = true; return; }
      it.project.shareId = sid;
      it.updatedAt = Date.now();
      hit = true;
    });
    if (hit) saveStore(s);
    if (state.itemId === id && state.project) state.project.shareId = sid;
  }
  function openCommunityShare(id) {
    var it = projectOf(id); if (!it) { snack('找不到这个作品'); return; }
    // 未登录不能发布：先去登录框（浏览/运行社区作品不需要登录）
    if (!currentUser()) { snack('请先登录，登录后才能分享到社区'); openAuth(); return; }
    shareWorkId = id; 管理分享Id = '';
    var cs = $('commShareMask'); if (!cs) return;
    var icon = it.project.icon || '';
    $('csName').value = it.project.appName || it.name || '';
    setOpenSeg('csOpen', 'no');
    setWorkIconPreview('csIcon', icon);
    csMsg('csMsg', '');
    cs.classList.remove('hidden');
  }
  function csMsg(id, msg) {
    var e = $(id); if (!e) return;
    if (msg) { e.textContent = msg; e.classList.remove('hidden'); } else { e.textContent = ''; e.classList.add('hidden'); }
  }
  function closeCommunityShare() { var m = $('commShareMask'); if (m) m.classList.add('hidden'); }
  function setOpenSeg(id, val) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' .orientbtn'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-open') === val);
    });
  }
  function getOpenSeg(id) {
    var on = document.querySelector('#' + id + ' .orientbtn.on');
    return (on && on.getAttribute('data-open')) === 'yes';
  }
  function setWorkIconPreview(id, icon) {
    var b = $(id); if (!b) return;
    if (icon) { b.style.backgroundImage = 'url("' + icon + '")'; b.textContent = ''; }
    else { b.style.backgroundImage = ''; b.textContent = '上传图标'; }
  }
  function doPublishCommunity() {
    var it = projectOf(shareWorkId); if (!it) { csMsg('csMsg', '找不到这个作品'); return; }
    var name = String($('csName').value || '').trim();
    if (!name) { csMsg('csMsg', '请填作品名称'); return; }
    // 图标必须是自己上传的：没有就不给发布（原地提示，不弹窗）
    if (!(it.project && it.project.icon)) { csMsg('csMsg', '请先上传应用图标'); return; }
    var u = currentUser(); if (!u) { closeCommunityShare(); openAuth(); return; }
    var open = getOpenSeg('csOpen');
    var go = $('csGo'); if (go) { go.disabled = true; go.textContent = '发布中…'; }
    csMsg('csMsg', '正在上传…');
    var p = clone(it.project);
    p.appName = name;
    p.icon = p.icon || null;
    var pjson = JSON.stringify({ fast: FAST_FORMAT, kind: 'project', appName: name, exportedAt: Date.now(), project: p, media: {} });
    var sid = shareIdOfProject(p);
    // 立刻把 作品iD 落进本地作品数据：万一后面某一步失败重试，也必须复用同一个 iD（不然又会多一行）
    saveProjectShareId(shareWorkId, sid);
    var fu = null, iu = null;
    // 图标：作品里有就用作品里的（统一图标），没有就跳过
    var iconUp = p.icon ? dtableUpload({ dataUrl: p.icon }).catch(function () { return null; }) : Promise.resolve(null);
    iconUp.then(function (r) { iu = r; return dtableUpload({ bytes: new TextEncoder().encode(pjson), name: name + '.fast', mime: 'application/octet-stream' }); })
      .then(function (r) {
        fu = r;
        var row = {};
        row[COMM_COL.user] = u.name || u.email;
        row[COMM_COL.file] = [fu];
        row[COMM_COL.image] = iu ? [iu.url] : [];
        row[COMM_COL.open] = open ? '是' : '否';
        row[COMM_COL.name] = name;
        row[COMM_COL.sid] = sid;
        row[COMM_COL.email] = u.email;
        return 写社区行(sid, row);          // 已有这一条就覆盖，没有才新增
      })
      .then(function () { return 同步账号行(u, sid, fu, iu, p); })
      .then(function () {
        setUnshared(sid, false);
        saveProjectIcon(shareWorkId, p.icon);
        刷新我的社区iD(true);        // 刚发出去一条 → 重新核对，「管理」按钮马上出现
        closeCommunityShare();
        snack('已分享到社区');
        renderHome();
        renderMine();
      })
      .catch(function (e) { csMsg('csMsg', (e && e.message) || '发布失败，稍后再试'); })
      .then(function () { if (go) { go.disabled = false; go.textContent = '发布'; } });
  }
  /**
   * 社区表里同一个 作品iD **只能有一行**。
   * 先按 作品iD 找：找到就 PUT 覆盖那一行，找不到才新增；顺手把历史遗留的重复行清掉
   * （用户报过"更新完社区里又多出几行"——那是更新被写成了新增）。
   */
  function 写社区行(sid, row) {
    return tblRows(COMM_TABLE).then(function (rows) {
      var 同id = [];
      (rows || []).forEach(function (x) { if (strOf(x[COMM_COL.sid]).trim() === sid) 同id.push(x); });
      var 主 = 同id[0];
      var 多余 = 同id.slice(1).map(function (x) { return x._id; }).filter(Boolean);
      var 收尾 = function (r) {
        if (!多余.length) return r;
        return tblDelete(COMM_TABLE, 多余).then(function () { return r; }).catch(function () { return r; });
      };
      if (主 && 主._id) {
        var fields = {};
        for (var k in row) {
          if (Object.prototype.hasOwnProperty.call(row, k) && k !== COMM_COL.sid) fields[k] = row[k];
        }
        return tblUpdate(COMM_TABLE, 主._id, fields).then(function () { return 收尾({ 新增: false }); });
      }
      return tblInsert(COMM_TABLE, row).then(function (d) { return 收尾({ 新增: true, id: d.id }); });
    });
  }
  /**
   * 账号表一个邮箱**永远只有一行**：只改那一行，绝不新增。
   * 这一行里的 作品iD / 作品 按同一个 作品iD 对齐（重发/更新只替换，不再追加），
   * 免得「作品iD 有 3 个、作品文件只有 1 个」这种错位。
   */
  function 同步账号行(u, sid, fu, iu, p) {
    return tblRows(AUTH_TABLE).then(function (rows) {
      var row = authFind(rows, u.email);
      if (!row || !row._id) throw new Error('账号信息不完整，重新登录一次再试');
      var ids = idList(row[ACCT_COL.ids]);
      var files = fileList(row[ACCT_COL.files]).slice();
      var 记录 = { name: fu.name, size: fu.size, type: fu.type || 'file', url: fu.url };
      var idx = ids.indexOf(sid);
      if (idx < 0) { ids.push(sid); files.push(记录); }
      else if (idx < files.length) files[idx] = 记录;
      else files.push(记录);
      var fields = {};
      fields[ACCT_COL.ids] = ids.join(', ');
      fields[ACCT_COL.files] = files;
      // 这里**绝不能**写 头像：作品图标（作品图/导出用的）和账号头像是两回事，
      // 之前顺手把作品图标当头像写进去，用户在「分享到社区」换图标时头像被一起改了。
      // 头像只有 设账号头像() 一条路能改。
      return tblUpdate(AUTH_TABLE, row._id, fields);
    });
  }
  /** 作品iD 列表：用控制字符分隔，避免和文件名里的逗号打架 */
  function 追加作品Id(v, sid) {
    var a = idList(v);
    if (a.indexOf(sid) < 0) a.push(sid);
    return a.join(', ');
  }
  function 移除作品Id(v, sid) {
    return idList(v).filter(function (x) { return x !== sid; }).join(', ');
  }
  /**
   * 读 作品iD 清单。
   * ⚠ 存进去的是 `join(', ')`（逗号），但老实现只按控制字符切 ——
   * 于是「发过 2 件作品」时账号行读回来是 **一整个 'sid1, sid2' 当成了一个 iD**：
   * 匹配不上社区行 → 列表里冒出幽灵条目，自愈逻辑还会把两个 iD 一起清掉（分享记录全丢）。
   * 这里两种分隔符都切开（作品iD 本身是 `时间戳-随机串`，永远不含逗号，切开是安全的）。
   */
  function idList(v) {
    return asArr(v).map(strOf).join(ID_SEP)
      .split(ID_SEP).join(',')
      .split(',')
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }
  function 追加作品文件(v, f) {
    var a = fileList(v).slice();
    var dup = a.some(function (x) { return String(x.name || '') === String(f.name || ''); });
    if (!dup) a.push({ name: f.name, size: f.size, type: f.type || 'file', url: f.url });
    return a;
  }
  function 移除作品文件(v, name) { return fileList(v).filter(function (x) { return String(x.name || '') !== String(name || ''); }); }

  var shareWorkId = '', 管理分享Id = '';
  function openCommunityManage(id) {
    var it = projectOf(id); if (!it) { snack('找不到这个作品'); return; }
    var sid = String(it.project.shareId || '');
    if (!sid) { snack('这个作品还没有分享过'); return; }
    if (!currentUser()) { modal('需要先登录', '登录之后才能管理分享。'); return; }
    shareWorkId = id; 管理分享Id = sid;
    $('cmName').value = it.project.appName || it.name || '';
    setOpenSeg('cmOpen', 'no');
    setWorkIconPreview('cmIcon', it.project.icon || '');
    csMsg('cmMsg', '');
    $('commManageMask').classList.remove('hidden');
    // 把社区那一行的真实状态拉回来（是否开源 / 作品名以线上为准）
    tblRows(COMM_TABLE).then(function (rows) {
      var row = null;
      (rows || []).forEach(function (r) { if (strOf(r[COMM_COL.sid]).trim() === sid) row = r; });
      if (!row) return;
      管理分享Id = sid;
      if (row[COMM_COL.name]) $('cmName').value = strOf(row[COMM_COL.name]);
      setOpenSeg('cmOpen', isOpen(row[COMM_COL.open]) ? 'yes' : 'no');
    }).catch(function () {});
  }
  function closeCommunityManage() { 关遮罩($('commManageMask')); }
  function 退出管理() { closeCommunityManage(); }
  function doUpdateCommunity() {
    var it = projectOf(shareWorkId);
    var sid = 管理分享Id || (it && it.project.shareId) || '';
    if (!it || !sid) { csMsg('cmMsg', '找不到这条分享'); return; }
    var name = String($('cmName').value || '').trim();
    if (!name) { csMsg('cmMsg', '请填作品名称'); return; }
    var open = getOpenSeg('cmOpen');
    var go = $('cmGo'); if (go) { go.disabled = true; go.textContent = '更新中…'; }
    csMsg('cmMsg', '正在更新…');
    var p = clone(it.project);
    p.appName = name;
    p.icon = p.icon || null;
    var pjson = JSON.stringify({ fast: FAST_FORMAT, kind: 'project', appName: name, exportedAt: Date.now(), project: p, media: {} });
    var icon = p.icon || '';
    var u = currentUser();
    var fu = null;
    // 图标有就一起换掉；没有就只改名字/开源/作品文件
    (icon ? dtableUpload({ dataUrl: icon }).catch(function () { return null; }) : Promise.resolve(null))
      .then(function (r) {
        return dtableUpload({ bytes: new TextEncoder().encode(pjson), name: name + '.fast', mime: 'application/octet-stream' })
          .then(function (f) { return { image: r, file: f }; });
      })
      .then(function (o) {
        fu = o.file;
        var row = {};
        row[COMM_COL.user] = (u && (u.name || u.email)) || '';
        row[COMM_COL.file] = [o.file];
        row[COMM_COL.open] = open ? '是' : '否';
        row[COMM_COL.name] = name;
        row[COMM_COL.sid] = sid;
        if (u) row[COMM_COL.email] = u.email;
        if (o.image) row[COMM_COL.image] = [o.image.url];
        // 同一个 作品iD 只覆盖那一行，不再新增
        return 写社区行(sid, row);
      })
      .then(function () {
        if (icon) saveProjectIcon(shareWorkId, icon);
        if (u) return 同步账号行(u, sid, fu, null, p);
        return null;
      })
      .then(function () {
        closeCommunityManage();
        snack('已更新分享');
        renderHome(); renderMine();
        if (commState.open) renderCommunity({ refresh: true });
      }).catch(function (e) { csMsg('cmMsg', (e && e.message) || '更新失败，稍后再试'); })
      .then(function () { if (go) { go.disabled = false; go.textContent = '更新'; } });
  }
  function 删除分享(sid, done) {
    sid = String(sid || '');
    confirmDialog({ title: '删除分享', msg: '确定把这条分享从社区删掉吗？（本地作品会保留）', okText: '删除' }).then(function (ok) {
      if (!ok) return;
      tblRows(COMM_TABLE).then(function (rows) {
        var row = null;
        (rows || []).forEach(function (x) { if (strOf(x[COMM_COL.sid]).trim() === sid) row = x; });
        return row && row._id ? tblDelete(COMM_TABLE, row._id) : null;
      }).then(function () {
        return tblRows(AUTH_TABLE).then(function (rows) {
          var u = currentUser();
          var row = authFind(rows, u && u.email);
          if (!row || !row._id) return null;
          var idx = idList(row[ACCT_COL.ids]).indexOf(sid);
          var files = fileList(row[ACCT_COL.files]).slice();
          var gone = (idx >= 0 && idx < files.length) ? files[idx] : null;
          var fields = {};
          fields[ACCT_COL.ids] = 移除作品Id(row[ACCT_COL.ids], sid);
          fields[ACCT_COL.files] = gone ? 移除作品文件(row[ACCT_COL.files], gone.name) : files;
          return tblUpdate(AUTH_TABLE, row._id, fields);
        });
      }).then(function () {
        setUnshared(sid, true);   // 本机记住"已取消分享"，卡片上的「管理」按钮隐藏；本地作品保留
        刷新我的社区iD(true);      // 社区里那条没了 → 重新核对
        snack('已删除分享');
        renderHome();
        if (typeof done === 'function') done();
        if (commState.open) renderCommunity({});
      }).catch(function (e) { modal('删除失败', (e && e.message) || '网络错误'); });
    });
  }
  /* ---- 「管理」按钮该不该显示 ----
     光看作品数据里的 作品iD 不够稳：导入/复制会把原作者的 作品iD 一起带过来，
     副本看上去就"已经发布过"。所以必须再拿**社区表**核对一次：
     只有存在一条「用户邮箱 == 当前登录邮箱 且 作品iD == 这件作品的iD」的记录，
     才说明"这一条确实是我发的"，才显示「管理」。未登录、或还没核对出来，一律不显示。 */
  var 我的社区iD = {};            // 已确认属于我的 作品iD 集合
  var 我的社区iD已核对 = false;    // 有没有真的跟社区表核对过一次
  var 我的社区iD核对中 = false;
  /** 从一批社区行里挑出"我发的"那些 作品iD */
  function 挑我的社区iD(rows, mail) {
    var set = {};
    (rows || []).forEach(function (r) {
      if (String(strOf(r[COMM_COL.email])).trim().toLowerCase() !== mail) return;
      var sid = String(strOf(r[COMM_COL.sid])).trim();
      if (sid) set[sid] = 1;
    });
    return set;
  }
  /**
   * 跟社区表核对一次（一个会话只读一次；发布 / 删除 / 换账号后 force 重读）。
   * 读不到就按"核对过但什么都没有"处理 —— 宁可先不显示「管理」，
   * 也绝不能让别人的作品冒出「管理」（点更新会覆盖原作者那一行）。
   */
  function 刷新我的社区iD(force) {
    if (我的社区iD核对中) return;
    if (我的社区iD已核对 && !force) return;
    var u = currentUser();
    if (!u) { 我的社区iD = {}; 我的社区iD已核对 = false; return; }
    var mail = String(u.email || '').trim().toLowerCase();
    我的社区iD核对中 = true;
    tblRows(COMM_TABLE).then(function (rows) {
      我的社区iD = 挑我的社区iD(rows, mail);
      我的社区iD已核对 = true;
    }).catch(function () {
      我的社区iD = {}; 我的社区iD已核对 = true;   // 读不到就保守不显示，且别无限重试
    }).then(function () {
      我的社区iD核对中 = false;
      try { renderHome(); } catch (e) {}
    });
  }
  /** 换账号 / 退出登录：把核对结果作废，下次要用重新读 */
  function 重置我的社区iD() { 我的社区iD = {}; 我的社区iD已核对 = false; 我的社区iD核对中 = false; }
  /** 这个作品是不是"我确实发布到社区过"：本机删过分享的不算；没跟社区表核对过的一律不算 */
  function projectShared(sid) {
    sid = String(sid || '').trim();
    if (!sid) return false;
    if (!currentUser()) return false;
    if (isUnshared(sid)) return false;            // 本机记的"已取消分享"
    if (!我的社区iD已核对) return false;            // 还没跟社区表核对过 → 保守不显示
    return !!我的社区iD[sid];
  }

  /* ---- 卡片分享弹窗 ---- */
  var shareCardId = '';
  function openShareSheet(id) {
    var it = projectOf(id); if (!it) { snack('找不到这个作品'); return; }
    shareCardId = id;
    var sn = $('shareName');
    if (sn) sn.textContent = it.project.appName || it.name || '未命名';
    $('shareMask').classList.remove('hidden');
  }
  function closeShareSheet() { 关遮罩($('shareMask')); }
  function 保存本地作品(id) {
    var it = projectOf(id); if (!it) { snack('找不到这个作品'); return; }
    var payload = { fast: FAST_FORMAT, kind: 'project', appName: it.name || '未命名', exportedAt: Date.now(), project: it.project, media: {} };
    var skipped = 0, total = 0;
    collectMediaNames(it.project).forEach(function (n) {
      var b64 = '';
      try { if (window.Native && Native.readMediaBase64) b64 = Native.readMediaBase64(n) || ''; } catch (e) { b64 = ''; }
      if (!b64) { skipped++; return; }
      if (total + b64.length > FAST_SHARE_MEDIA_MAX) { skipped++; return; }
      total += b64.length; payload.media[n] = b64;
    });
    var text = JSON.stringify(payload);
    var fname = (it.name || 'FAST作品') + '.fast';
    // 「保存在本地」= 只落盘，**不唤起分享面板**。
    // 原生侧 saveProject 只往公共「下载/fast本地app」写一份，不调 launchShare；
    // 提示也由原生 toast 出（JS 这边不再 snack，否则会连着弹两条一样的）。
    if (window.Native && Native.saveProject) {
      try { Native.saveProject(text, fname); }
      catch (e) { modal('保存失败', String((e && e.message) || e)); }
      return;
    }
    // 老版本 APK 还没有 saveProject：只能借用分享通道落盘（会顺带弹分享面板），
    // 文件确实存下来了，用户升级到新版后这条就不再走。
    if (window.Native && Native.shareProject) {
      try { Native.shareProject(text, fname); snack('已保存到「下载/fast本地app」'); }
      catch (e) { modal('保存失败', String((e && e.message) || e)); }
      return;
    }
    try {
      window.__lastSharePayload = text;
      var blob = new Blob([text], { type: 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1000);
      snack('已保存作品文件');
    } catch (e) { modal('保存失败', String((e && e.message) || e)); }
  }
  function 分享到社交平台(id) { shareItem(id); }

  /* ---- 选图（换头像 / 上传应用图标共用一套） ----
     应用图标（分享到社区 / 管理分享）**只保留用户自己上传那一套**：
     不再给预设色块、也没有「恢复默认」——没上传就不让发布（见 doPublishCommunity）。
     头像的默认色块头像也删了（用户 2026-10-29 要求）：只剩「从相册选」和「恢复默认」。 */
  var pickTarget = '';
  function openPick(target) {
    pickTarget = target;
    var 上传图标 = (target === 'share' || target === 'manage');
    var t = $('pickTitle');
    if (t) t.textContent = 上传图标 ? '上传应用图标' : '更换头像';
    var grid = $('pickGrid'); if (!grid) return;
    grid.innerHTML = '';
    grid.classList.add('hidden');     // 预设头像 / 预设图标都不给，只走相册
    if ($('pickClear')) $('pickClear').classList.toggle('hidden', 上传图标);
    $('pickMask').classList.remove('hidden');
  }
  function closePick() { 关遮罩($('pickMask')); }
  function pickKeepDefault() {
    // 「恢复默认」只留给头像（应用图标只能自己上传，没有"默认"这一说）
    if (pickTarget === 'account') 设账号头像('');
    closePick();
  }
  function pickFromAlbum() { var f = $('pickImgFile'); if (f) { f.value = ''; f.click(); } }
  function doPickFile(input) {
    pickImage(input, function (url) {
      if (pickTarget === 'account') { 设账号头像(url); closePick(); return; }
      var id = shareWorkId; if (!id) { closePick(); return; }
      saveProjectIcon(id, url);
      if (pickTarget === 'share') { var p = $('csIcon'); if (p) setWorkIconPreview('csIcon', url); }
      else if (pickTarget === 'manage') { var q = $('cmIcon'); if (q) setWorkIconPreview('cmIcon', url); }
      closePick();
    });
  }
  /** 头像：写回「账号.头像」（账号表只有一行，只更新它） */
  var AVATAR_MAX = 100 * 1024;   // 头像约 100KB（dataURL 字符串长度，base64 算下来差不多）
  /** 超过 100KB 就按 JPEG 逐档降质重编码（选照片当头像时常见，不压会把表格撑大） */
  function 压缩头像(dataUrl) {
    if (String(dataUrl || '').length <= AVATAR_MAX) return Promise.resolve(dataUrl);
    return new Promise(function (resolve) {
      // 任何一步出问题都必须给出结果（退回原图），否则整个 promise 悬着、
      // 头像会「点了没反应」——这种静默失败最难查。
      var 收工 = function (v) { resolve(v || dataUrl); };
      var img = new Image();
      img.onload = function () {
        var out = dataUrl;
        try {
          var side = Math.max(img.width, img.height), k = Math.min(1, 256 / side);
          var w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // JPEG 没有透明通道，先铺白底
          ctx.drawImage(img, 0, 0, w, h);
          var q = 0.85;
          out = cv.toDataURL('image/jpeg', q);
          while (out.length > AVATAR_MAX && q > 0.3) { q -= 0.15; out = cv.toDataURL('image/jpeg', q); }
        } catch (e) { out = dataUrl; }
        收工(out);
      };
      img.onerror = function () { 收工(dataUrl); };
      try { img.src = dataUrl; } catch (e) { 收工(dataUrl); }
    });
  }
  function 设账号头像(icon) {
    var av = $('acctAvatar');
    if (av) { if (icon) { av.style.backgroundImage = 'url("' + icon + '")'; av.textContent = ''; } else { av.style.backgroundImage = ''; av.textContent = '头像'; } }
    if (!icon) return;
    var u = currentUser(); if (!u) return;
    var up = (icon.indexOf('data:') === 0)
      ? 压缩头像(icon).then(function (d) { return dtableUpload({ dataUrl: d }); }).catch(function () { return null; })
      : Promise.resolve({ url: icon });
    up.then(function (r) {
      if (!r) return null;
      // 「账号.头像」是 image 列：官方格式是**字符串数组**，元素是上传接口给的附件路径
      //   例如 ['/workspace/600134/asset/<uuid>/images/2026-09/xxx.png']
      // 上传没回路径（或回了个显示不出来的东西）就别往表里写，宁可当"没换成功"。
      var url = String((r && r.url) || '').trim();
      if (!url || !/^(\/|https?:|data:)/i.test(url)) throw new Error('图片没传成功，稍后再试');
      return tblRows(AUTH_TABLE).then(function (rows) {
        var row = authFind(rows, u.email);
        if (!row || !row._id) return null;
        var fields = {}; fields[ACCT_COL.avatar] = [url];
        return tblUpdate(AUTH_TABLE, row._id, fields);
      });
    }).then(function () { snack('头像已更新'); })
      .catch(function (e) { modal('头像没换成功', (e && e.message) || '网络错误'); });
  }
  function renderAccount() {
    var u = currentUser();
    if (!u) { openAuth(); return; }
    var av = $('acctAvatar');
    if (av) { av.style.backgroundImage = ''; av.textContent = 首字(u.name || u.email || '我'); }
    if ($('acctName')) $('acctName').value = u.name || '';
    if ($('acctMail')) $('acctMail').textContent = u.email || '';
    csMsg('acctErr', '');
    // 头像和当前账号名从表里拉一遍（换了设备也能看到）
    tblRows(AUTH_TABLE).then(function (rows) {
      var row = authFind(rows, u.email);
      if (!row) return;
      设头像(av, row[ACCT_COL.avatar], 首字(strOf(row[ACCT_COL.name]) || u.name || u.email || '我'));
      var nm = strOf(row[ACCT_COL.name]);
      if (nm) { if ($('acctName')) $('acctName').value = nm; if (u.name !== nm) { u.name = nm; saveUser(u); syncAuthUi(); } }
      var em = strOf(row[ACCT_COL.email]);
      if (em && $('acctMail')) $('acctMail').textContent = em;
    }).catch(function () {});
    renderMine();
    if (commState.open) renderCommunity({});
  }
  function 打开管理(sid, name, mail) {
    shareWorkId = '';
    管理分享Id = String(sid || '');
    // 从「我分享的」进来时，先找一下本地作品里哪件的 shareId 是它，用来更新图标/名称
    var s = loadStore();
    s.items.forEach(function (it) { if (String(it.project.shareId || '') === 管理分享Id) shareWorkId = it.id; });
    $('cmName').value = name || '';
    setOpenSeg('cmOpen', 'no');
    csMsg('cmMsg', '');
    $('commManageMask').classList.remove('hidden');
    if (!shareWorkId) { if ($('cmIcon')) setWorkIconPreview('cmIcon', ''); }
    else { var it = projectOf(shareWorkId); setWorkIconPreview('cmIcon', (it && it.project.icon) || ''); }
    tblRows(COMM_TABLE).then(function (rows) {
      var row = null;
      (rows || []).forEach(function (r) { if (strOf(r[COMM_COL.sid]).trim() === 管理分享Id) row = r; });
      if (!row) return;
      if (row[COMM_COL.name]) $('cmName').value = strOf(row[COMM_COL.name]);
      setOpenSeg('cmOpen', isOpen(row[COMM_COL.open]) ? 'yes' : 'no');
    }).catch(function () {});
  }

  /* ---- 进 / 出账号页 ---- */
  function openAccount() {
    if (!currentUser()) { openAuth(); return; }
    $('viewHome').classList.add('hidden');
    $('viewEditor').classList.add('hidden');
    $('viewHelp').classList.add('hidden');
    var v = $('viewTips'); if (v) v.classList.add('hidden');
    // 账号页**不加整页过渡**：它里面「个人信息/社区」有自己的内容切换，
    // 整页再淡入一次会和内容刷新叠成"闪两下"（2026-09-25 真机反馈）。
    var a = $('viewAccount'); if (a) a.classList.remove('hidden');
    showAcctPane('info');
    renderAccount();
  }
  function leaveAccount() {
    var a = $('viewAccount'); if (a) a.classList.add('hidden');
    showHome();
  }
  function showAcctPane(which) {
    var info = $('acctPaneInfo'), comm = $('acctPaneComm');
    if (info) info.classList.toggle('hidden', which !== 'info');
    if (comm) comm.classList.toggle('hidden', which !== 'comm');
    var b1 = $('acctNavInfo'), b2 = $('acctNavComm');
    if (b1) b1.classList.toggle('on', which === 'info');
    if (b2) b2.classList.toggle('on', which === 'comm');
    // 刷新按钮钉在顶栏右上角，只有社区栏才显示（2026-10-27 用户要求）
    var rf = $('acctRefresh'); if (rf) rf.classList.toggle('hidden', which !== 'comm');
    同步分段药丸();          // 个人信息/社区 的滑块跟着走
    // 进「社区」这一栏：**先把上次读到的列表画出来**（有就画，不显示"正在加载…"），
    // 再在后台刷新 —— 否则切换瞬间是一句"正在加载…"，一两百毫秒后才换成卡片，
    // 用户看到的就是"切换社区闪一下"（2026-09-25 真机反馈）。
    if (which === 'comm') {
      commState.drew = false;
      if (commState.rows && commState.rows.length) drawCommunity();
      renderCommunity({ refresh: true });   // 后台刷新，失败也能自己恢复
    }
    if (which === 'info') { var mb = $('acctMine'); if (mb) mb.__drew = false; }            // 回到个人信息，错峰重播一次
  }
  var commState = { rows: [], shown: 0, open: false, loading: false, error: '', pending: false };
  /** 刷新时按钮要有反应：转成「刷新中…」并禁用，读完再恢复（不然用户以为点了没反应） */
  function 刷新按钮忙(on) {
    var b = $('acctRefresh'); if (!b) return;
    b.disabled = !!on;
    b.textContent = on ? '刷新中…' : '刷新';
  }

  /* ---- 更换邮箱：先给新邮箱发验证码，验证通过才写回 ---- */
  var newMailChallenge = null, newMailTimer = null, newMailLeft = 0;
  function setNewMailBtn(left) {
    var b = $('mailSend'); if (!b) return;
    if (left > 0) { b.disabled = true; b.textContent = left + ' 秒'; }
    else { b.disabled = false; b.textContent = '获取验证码'; }
  }
  function openMailChange() {
    if (!currentUser()) { openAuth(); return; }
    newMailChallenge = null;
    if (newMailTimer) { clearInterval(newMailTimer); newMailTimer = null; }
    newMailLeft = 0; setNewMailBtn(0);
    if ($('mailNew')) $('mailNew').value = '';
    if ($('mailCode')) $('mailCode').value = '';
    csMsg('mailErr', '');
    $('mailMask').classList.remove('hidden');
  }
  function closeMailChange() { 关遮罩($('mailMask')); }
  function doSendNewMail() {
    var b = $('mailSend'); if (!b || b.disabled) return;
    var em = String(($('mailNew') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { csMsg('mailErr', '邮箱格式不对'); return; }
    var u = currentUser();
    if (u && em.toLowerCase() === String(u.email || '').toLowerCase()) { csMsg('mailErr', '这就是现在的邮箱'); return; }
    b.disabled = true; b.textContent = '发送中…';
    mailSend(em).then(function () {
      newMailChallenge = mailChallenge;
      csMsg('mailErr', '');
      newMailLeft = 60; setNewMailBtn(60);
      if (newMailTimer) clearInterval(newMailTimer);
      newMailTimer = setInterval(function () {
        newMailLeft--; setNewMailBtn(newMailLeft);
        if (newMailLeft <= 0) { clearInterval(newMailTimer); newMailTimer = null; }
      }, 1000);
    }).catch(function (e) {
      setNewMailBtn(0);
      csMsg('mailErr', (e && e.message) || '验证码发送失败，稍后再试');
    });
  }
  function doChangeMail() {
    var u = currentUser(); if (!u) { closeMailChange(); openAuth(); return; }
    var em = String(($('mailNew') || {}).value || '').trim();
    var code = String(($('mailCode') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { csMsg('mailErr', '邮箱格式不对'); return; }
    if (!newMailChallenge) { csMsg('mailErr', '请先点「获取验证码」'); return; }
    if (!/^\d{6}$/.test(code)) { csMsg('mailErr', '请填邮箱收到的 6 位验证码'); return; }
    var bak = mailChallenge;
    mailChallenge = newMailChallenge;   // mailVerify 用的是这个变量
    var go = $('mailGo'); if (go) { go.disabled = true; go.textContent = '更换中…'; }
    mailVerify(em, code).then(function () {
      return tblRows(AUTH_TABLE).then(function (rows) {
        var row = authFind(rows, u.email);
        if (!row || !row._id) throw new Error('账号信息不完整，重新登录一次再试');
        /* 新邮箱必须是"没人用"的（大小写不同算同一个）。
           不查这一步的话，两个账号会抢同一个邮箱：后改名的人把邮箱写过去，
           原主人再登录时也按邮箱找到这行 —— 等着抢账号。 */
        var 占了 = (rows || []).some(function (r) {
          if (!r || r._id === row._id) return false;
          return strOf(r[ACCT_COL.email]).trim().toLowerCase() === em.toLowerCase();
        });
        if (占了) throw new Error('这个邮箱已经有账号了，换一个吧');
        var fields = {}; fields[ACCT_COL.email] = em;
        return tblUpdate(AUTH_TABLE, row._id, fields);   // 作品不迁移：只改账号行的邮箱
      });
    }).then(function () {
      u.email = em; saveUser(u); syncAuthUi();
      if ($('acctMail')) $('acctMail').textContent = em;
      closeMailChange();
      snack('邮箱已更换');
    }).catch(function (e) { csMsg('mailErr', (e && e.message) || '更换失败，稍后再试'); })
      .then(function () { mailChallenge = bak; if (go) { go.disabled = false; go.textContent = '确认更换'; } });
  }
  /**
   * 改名后，把社区表里该作者已发布作品的「用户名」一起刷新。
   *
   * 以前只改账号表，社区行里还留着旧名字 —— 结果就是：
   * 后端账号表是新的、App 社区卡片显示的还是原名，
   * 只有用户点「更新」重新发布那一件时，那一行才会带上新名字（用户实测到的现象）。
   */
  function 同步社区作者名(nm) {
    var u = currentUser(); if (!u || !nm) return Promise.resolve();
    var mail = String(u.email || '').trim().toLowerCase();
    if (!mail) return Promise.resolve();
    return tblRows(COMM_TABLE).then(function (rows) {
      var 改 = [];
      (rows || []).forEach(function (r) {
        if (!r || !r._id) return;
        if (String(strOf(r[COMM_COL.email])).trim().toLowerCase() !== mail) return;
        if (strOf(r[COMM_COL.user]) === nm) return;      // 已经是新名字，不用动
        var o = {}; o[COMM_COL.user] = nm;
        改.push({ rowId: r._id, row: o });
      });
      return tblUpdateMany(COMM_TABLE, 改).then(function () {
        // 服务端改完还要把**当前会话里已经读回来的那份数据**跟着改掉并重画 ——
        // 社区栏可能正开着，它画的是 commState.rows，不跟着改的话屏幕上还是旧名字。
        (commState.rows || []).forEach(function (r) {
          if (String(strOf(r[COMM_COL.email])).trim().toLowerCase() === mail) r[COMM_COL.user] = nm;
        });
        if (commState.open) drawCommunity();
      });
    }).catch(function () {
      // 静默：改名本身已经成功，这里失败不影响用户；下次发布/更新那一件会自动带上新名字
    });
  }
  /** 换账号名：重名不给改（大小写不同不算重复，精确比较） */
  function doSaveAccountName() {
    var u = currentUser(); if (!u) { openAuth(); return; }
    var nm = String(($('acctName') || {}).value || '').trim();
    if (!nm) { csMsg('acctErr', '账号名不能为空'); return; }
    if (nm === String(u.name || '')) { csMsg('acctErr', ''); snack('账号名没有变化'); return; }
    tblRows(AUTH_TABLE).then(function (rows) {
      var dup = rows.some(function (r) {
        var v = strOf(r[ACCT_COL.name]).trim();
        return v && v === nm && String(strOf(r[ACCT_COL.email])).trim().toLowerCase() !== String(u.email).toLowerCase();
      });
      if (dup) throw new Error('已经有叫「' + nm + '」的账号了，换个名字吧');
      var row = authFind(rows, u.email);
      if (!row || !row._id) throw new Error('账号信息不完整，重新登录一次再试');
      var fields = {}; fields[ACCT_COL.name] = nm;
      return tblUpdate(AUTH_TABLE, row._id, fields).then(function () { return nm; });
    }).then(function (n) {
      u.name = n; saveUser(u); syncAuthUi();
      csMsg('acctErr', '');
      snack('账号名已保存');
      同步社区作者名(n);        // 社区里已发布作品的作者名跟着改（不阻塞这次保存）
    }).catch(function (e) { csMsg('acctErr', (e && e.message) || '保存失败，稍后再试'); });
  }

  function wireCommunity() {
    if ($('btnAccountBack')) $('btnAccountBack').addEventListener('click', leaveAccount);
    if ($('btnAccountOut')) $('btnAccountOut').addEventListener('click', function () {
      // 退出登录要二次确认（防误触）；账号里的东西都还在表里，重新登录就能回来
      confirmDialog({ title: '退出登录', msg: '确定退出当前账号吗？', okText: '退出' }).then(function (ok) {
        if (!ok) return;
        saveUser(null); syncAuthUi();
        var a = $('viewAccount'); if (a) a.classList.add('hidden');
        showHome();
      });
    });
    if ($('acctNavInfo')) $('acctNavInfo').addEventListener('click', function () { showAcctPane('info'); });
    if ($('acctNavComm')) $('acctNavComm').addEventListener('click', function () { showAcctPane('comm'); });
    if ($('acctRefresh')) $('acctRefresh').addEventListener('click', function () { commState.shown = 8; renderCommunity({ refresh: true }); });
    if ($('acctMore')) $('acctMore').addEventListener('click', function () { commState.shown += 8; drawCommunity(); });
    if ($('acctAvatar')) $('acctAvatar').addEventListener('click', function () { openPick('account'); });
    if ($('acctNameSave')) $('acctNameSave').addEventListener('click', doSaveAccountName);
    if ($('acctMailBtn')) $('acctMailBtn').addEventListener('click', openMailChange);

    // 卡片分享弹窗
    if ($('shareClose')) $('shareClose').addEventListener('click', closeShareSheet);
    if ($('shareMask')) $('shareMask').addEventListener('click', function (e) { if (e.target === this) closeShareSheet(); });
    if ($('shareToComm')) $('shareToComm').addEventListener('click', function () { var id = shareCardId; closeShareSheet(); openCommunityShare(id); });
    if ($('shareToSocial')) $('shareToSocial').addEventListener('click', function () { var id = shareCardId; closeShareSheet(); 分享到社交平台(id); });
    if ($('shareToLocal')) $('shareToLocal').addEventListener('click', function () { var id = shareCardId; closeShareSheet(); 保存本地作品(id); });

    // 分享到社区弹窗
    if ($('csCancel')) $('csCancel').addEventListener('click', closeCommunityShare);
    if ($('commShareMask')) $('commShareMask').addEventListener('click', function (e) { if (e.target === this) closeCommunityShare(); });
    if ($('csIcon')) $('csIcon').addEventListener('click', function () { openPick('share'); });
    if ($('csGo')) $('csGo').addEventListener('click', doPublishCommunity);
    if ($('csOpen')) $('csOpen').addEventListener('click', function (e) {
      var b = e.target.closest('.orientbtn'); if (!b) return;
      setOpenSeg('csOpen', b.getAttribute('data-open'));
    });

    // 管理分享弹窗
    if ($('cmClose')) $('cmClose').addEventListener('click', closeCommunityManage);
    if ($('commManageMask')) $('commManageMask').addEventListener('click', function (e) { if (e.target === this) closeCommunityManage(); });
    if ($('cmIcon')) $('cmIcon').addEventListener('click', function () { openPick('manage'); });
    if ($('cmGo')) $('cmGo').addEventListener('click', doUpdateCommunity);
    if ($('cmDel')) $('cmDel').addEventListener('click', function () {
      var sid = 管理分享Id || ((projectOf(shareWorkId) || { project: {} }).project || {}).shareId || '';
      closeCommunityManage();
      删除分享(sid, function () { renderMine(); });
    });
    if ($('cmOpen')) $('cmOpen').addEventListener('click', function (e) {
      var b = e.target.closest('.orientbtn'); if (!b) return;
      setOpenSeg('cmOpen', b.getAttribute('data-open'));
    });

    // 社区「保存本地」的二选一弹窗
    if ($('commSavePhone')) $('commSavePhone').addEventListener('click', function () {
      var r = 待存社区行; 待存社区行 = null;
      if (r) 存到手机(r); else 关闭保存社区();
    });
    if ($('commSaveCopy')) $('commSaveCopy').addEventListener('click', function () {
      var r = 待存社区行; 待存社区行 = null;
      if (r) 生成编辑器副本(r); else 关闭保存社区();
    });
    if ($('commSaveCancel')) $('commSaveCancel').addEventListener('click', function () { 待存社区行 = null; 关闭保存社区(); });
    if ($('commSaveMask')) $('commSaveMask').addEventListener('click', function (e) {
      if (e.target === this) { 待存社区行 = null; 关闭保存社区(); }
    });

    // 运行提示（独立 key）
    if ($('runHowOk')) $('runHowOk').addEventListener('click', function () {
      var cb = $('runHowNever');
      if (cb && cb.classList.contains('on')) setRunHowSeen(true);
      var r = pendingRunRow; pendingRunRow = null;
      var m = $('runHowMask'); if (m) m.classList.add('hidden');
      if (r) doRunCommunity(r);
    });
    if ($('runHowNever')) $('runHowNever').addEventListener('click', function () {
      var on = !this.classList.contains('on');
      this.classList.toggle('on', on);
      this.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if ($('runHowMask')) $('runHowMask').addEventListener('click', function (e) {
      if (e.target === this) { pendingRunRow = null; this.classList.add('hidden'); }
    });

    // 换邮箱
    if ($('mailSend')) $('mailSend').addEventListener('click', function () { doSendNewMail(); });
    if ($('mailGo')) $('mailGo').addEventListener('click', doChangeMail);
    if ($('mailCancel')) $('mailCancel').addEventListener('click', closeMailChange);
    if ($('mailMask')) $('mailMask').addEventListener('click', function (e) { if (e.target === this) closeMailChange(); });
    if ($('mailNew')) $('mailNew').addEventListener('input', function () { newMailChallenge = null; csMsg('mailErr', ''); });

    // 选图弹窗
    if ($('pickCancel')) $('pickCancel').addEventListener('click', closePick);
    if ($('pickMask')) $('pickMask').addEventListener('click', function (e) { if (e.target === this) closePick(); });
    if ($('pickClear')) $('pickClear').addEventListener('click', pickKeepDefault);
    if ($('pickFile')) $('pickFile').addEventListener('click', pickFromAlbum);
    if ($('pickImgFile')) $('pickImgFile').addEventListener('change', function () { doPickFile(this); });
  }

  function init() {
    if (window.Native && Native.setOrientation) Native.setOrientation('landscape');
    $('btnNewApp').addEventListener('click', createItem);
    wireImport();   // 顶部「导入作品」按钮 + 隐藏的文件选择框
    wireAuth();     // 顶部「账号」按钮 + 登录 / 注册弹窗
    wireCommunity(); // 账号页（个人信息 / 社区）+ 作品分享弹窗 + 管理分享
    wireNotifBlocked();
    // 首次进软件：**没有通知权限才**弹系统授权框；有权限就什么都不弹
    setTimeout(function () { try { if (!通知真的可用()) 请求通知权限(false); } catch (e) {} }, 700);
    wireAi();       // AI 悬浮球 + 面板 + 设置里的 API Key
    try { wireRuntimeErrorHint(); } catch (e) {}   // 运行时报错的那一段，回来自动标出来
    $('createGo').addEventListener('click', confirmCreate);
    $('createCancel').addEventListener('click', closeCreate);
    $('newAppName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (!this.value.trim()) return; confirmCreate(); }
      if (e.key === 'Escape') { e.preventDefault(); closeCreate(); }
    });
    $('newAppName').addEventListener('input', function () {
      syncCreateBtn();
      if ((this.value || '').trim()) { var b2 = this.closest('.m3-outlined'); if (b2) b2.classList.remove('err'); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('#newOrient .ori'), function (b) {
      b.addEventListener('click', function () { setNewOrient(b.getAttribute('data-orient')); });
    });
    $('createMask').addEventListener('click', function (e) { if (e.target === this) closeCreate(); });
    // M3 描边输入框：焦点/有内容时标签上浮（用类名兜底部分 WebView :focus 伪类不灵敏）
    Array.prototype.forEach.call(document.querySelectorAll('.m3-outlined .m3-input'), function (inp) {
      var box = inp.closest('.m3-outlined');
      function syncFilled() { box.classList.toggle('filled', !!(inp.value && inp.value.length)); }
      inp.addEventListener('focus', function () { box.classList.add('focused'); });
      inp.addEventListener('blur', function () { box.classList.remove('focused'); });
      inp.addEventListener('input', syncFilled);
      syncFilled();
    });
    $('btnHome').addEventListener('click', showHome);
    $('btnHelp').addEventListener('click', openHelp);
    var 技巧入口 = $('btnHelpTips');
    if (技巧入口) 技巧入口.addEventListener('click', function (e) { e.stopPropagation(); openTips(); });
    var 技巧返回 = $('btnTipsBack');
    if (技巧返回) 技巧返回.addEventListener('click', function (e) { e.stopPropagation(); closeTips(); });
    syncHomeVersion();
    $('btnHelpBack').addEventListener('click', showHome);
    $('btnUpdate').addEventListener('click', openUpdateDialog);
    $('updateCancel').addEventListener('click', function () { $('updateMask').classList.add('hidden'); });
    $('updateGo').addEventListener('click', doUpdate);
    // 联系开发者：关闭检查更新窗口，弹出联系窗口
    $('updateContact').addEventListener('click', function () {
      $('updateMask').classList.add('hidden');
      $('contactMask').classList.remove('hidden');
    });
    $('contactClose').addEventListener('click', function () { $('contactMask').classList.add('hidden'); });
    $('contactMask').addEventListener('click', function (e) { if (e.target === this) this.classList.add('hidden'); });
    $('contactCopy').addEventListener('click', function () {
      var id = 'dashen1949';
      try {
        if (window.Native && Native.copyText) Native.copyText(id);
        else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id);
        else {
          var ta = document.createElement('textarea');
          ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta);
        }
        snack('账号已复制');
      } catch (e) { snack('复制失败，请手动记下账号'); }
    });
    // 改作品名：输入过程中先不拦（否则"我的应用2"打到一半就被挡），
    // 但撞名的值**绝不许写进工程**；输完（失焦/回车）再退回上一个好名字并提示
    $('appName').addEventListener('input', function () {
      if (!state.project) return;
      var v = this.value;
      if (v && appNameTakenByOther(v)) return;      // 撞名：先不采纳，等 change 统一处理
      state.project.appName = v;
      autosave();
    });
    $('appName').addEventListener('change', function () {
      var 想改 = (this.value || '').trim();
      var 好名 = (state.project && state.project.appName) || '我的应用';
      if (!想改) { this.value = 好名; return; }
      var 撞 = appNameTakenByOther(想改);
      if (!撞) return;
      this.value = 好名;                            // 退回原名（工程里从没被改成撞名）
      snack('已经有叫「' + 想改 + '」的作品了，名字没改');
      autosave();
    });
    // 运行：▾ 菜单只负责“选择运行方式”（从头/当前页面），选中后主按钮切换为该方式；真正运行由主按钮触发
    $('btnRun').addEventListener('click', function () { closeMenus(); onRun(state.runMode || 'start'); });
    $('btnRunCaret').addEventListener('click', function (e) {
      e.stopPropagation(); toggleMenu($('runMenu'), $('runSplit'));
    });
    $('runFromStart').addEventListener('click', function () { setRunMode('start'); closeMenus(); });
    $('runCurrent').addEventListener('click', function () { setRunMode('current'); closeMenus(); });
    applyRunMode();
    $('btnExport').addEventListener('click', openExport);
    // 切页签必须 stopPropagation：这一次点击会冒泡到 document，被 Blockly 当成
    // "点了浮层外面" → 它自己调 autoHide/clearSelection，把刚恢复好的代码浮层又关掉
    // （用户反馈"一点代码按钮积木栏就闪一下"就是这个 + 套用视角一起造成的）。
    $('tabDesign').addEventListener('click', function (e) { e.stopPropagation(); showView('design'); });
    $('tabBlocks').addEventListener('click', function (e) { e.stopPropagation(); showView('blocks'); });
    // 分段滑块：设计/代码（编辑器顶栏）+ 个人信息/社区（账号页左栏）
    // 容器一开始是隐藏的（量不到宽高），所以先装、再延时补一次同步
    (function () {
      var seg = document.querySelector('#viewEditor .seg.viewseg');
      if (seg) 装分段药丸(seg, [$('tabDesign'), $('tabBlocks')]);
      var nav = document.querySelector('#viewAccount .acct-rail');
      if (nav) 装分段药丸(nav, [$('acctNavInfo'), $('acctNavComm')]);
      var setRail = $('setRail');
      if (setRail) 装分段药丸(setRail, Array.prototype.slice.call(setRail.querySelectorAll('.acct-item')));
      setTimeout(同步分段药丸, 80);
    })();
    $('btnLayout').addEventListener('click', openLayout);
    // 「如何预览」下拉：自动 / 竖屏 / 横屏（只在布局页生效，不改页面自身方向）
    var lc = $('btnLayoutCaret');
    if (lc) lc.addEventListener('click', function (e) {
      e.stopPropagation();
      syncLayoutOrientMenu();
      toggleMenu($('layoutOrientMenu'), lc);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#layoutOrientMenu .orient-opt'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        setLayoutOrientMode(b.getAttribute('data-mode'));
        closeMenus();
        if (state.inLayout) { applyLayoutOrient(); renderLayout(); requestAnimationFrame(fitStage); }
      });
    });
    // 「控件在预览时是否显示边框」：是 / 否
    Array.prototype.forEach.call(document.querySelectorAll('#layoutOrientMenu .orient-border'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        setPreviewBorder(b.getAttribute('data-b') === '1');
        closeMenus();
      });
    });
    $('modalCancel').addEventListener('click', hideModal);
    // 设置：独立整页（左侧 常规 / AI / 反馈）
    $('btnSettings').addEventListener('click', function () { openSettings(); });   // 不带分类 = 回到上次看的那一栏
    $('btnSettingsBack').addEventListener('click', closeSettings);
    // 诊断信息页：返回只回设置；右上角一键复制（真机走原生剪贴板，网页退化成 clipboard）
    var 诊断返回 = $('btnDiagBack');
    if (诊断返回) 诊断返回.addEventListener('click', function () { closeDiagPage(); });
    var 诊断复制 = $('btnDiagCopy');
    if (诊断复制) 诊断复制.addEventListener('click', function () {
      var txt = ($('diagPre') || {}).textContent || '';
      try {
        if (window.Native && Native.copyText) Native.copyText(txt);
        else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
        snack('已复制');
      } catch (e) { snack('复制失败，请手动选择文字'); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('#setRail .acct-item'), function (b) {
      b.addEventListener('click', function () { setSettingsCat(b.getAttribute('data-cat')); });
    });
    var 设置联系 = $('setContact');
    if (设置联系) 设置联系.addEventListener('click', function () { $('contactMask').classList.remove('hidden'); });
    // 检查更新 → 更新日志
    $('updateLog').addEventListener('click', openUpdateLog);
    $('updLogClose').addEventListener('click', function () { $('updLogMask').classList.add('hidden'); });
    try { wireDiagBtn(); } catch (e) {}    // 从首页直接进设置也能点「查看诊断信息」
    applyUiAnim();
    $('viewHome').addEventListener('scroll', function () { $('homeHead').classList.toggle('scrolled', this.scrollTop > 4); });

    // ---- 添加组件：分组收纳（「控件类型 ⬇️」）----
    Array.prototype.forEach.call(document.querySelectorAll('.addgroup-h'), function (h) {
      h.addEventListener('click', function () {
        var g = h.parentNode;
        var 开 = g.classList.contains('open');
        Array.prototype.forEach.call(document.querySelectorAll('.addgroup'), function (n) { n.classList.remove('open'); });
        if (!开) g.classList.add('open');
        try { state.catOpenGroup = (!开) ? g.getAttribute('data-g') : ''; autosave(); } catch (e) {}
      });
    });
    try {
      var 记住的 = state.catOpenGroup;
      if (记住的) {
        var g2 = document.querySelector('.addgroup[data-g="' + 记住的 + '"]');
        if (g2) { Array.prototype.forEach.call(document.querySelectorAll('.addgroup'), function (n) { n.classList.remove('open'); }); g2.classList.add('open'); }
      }
    } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('[data-add]'), function (btn) {
      btn.addEventListener('click', function () { addComponent(btn.getAttribute('data-add')); });
    });
    var tplBtn = $('btnTpl');
    if (tplBtn) tplBtn.addEventListener('click', function (e) { e.stopPropagation(); openTemplates(); });
    Array.prototype.forEach.call(document.querySelectorAll('#moreOrient .orientbtn'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        curScreen().orientation = b.getAttribute('data-orient'); syncOrientSeg(); autosave();
        if (state.inLayout) { renderLayout(); requestAnimationFrame(fitStage); }   // 实时切换舞台竖/横
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#moreStatusBar .orientbtn'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        curScreen().showStatusBar = b.getAttribute('data-sb') === 'yes'; syncOrientSeg(); autosave();
      });
    });
    $('morePageTitle').addEventListener('input', function () { curScreen().title = this.value; renderTabs(); autosave(); });

    // 顶栏「页面 ▾」菜单
    $('btnScreenMenu').addEventListener('click', function (e) {
      e.stopPropagation(); buildScreenMenu(); toggleMenu($('screenMenu'), $('btnScreenMenu'));
    });
    $('menuAddScreen').addEventListener('click', function () { closeMenus(); addScreen(); });
    $('menuDelScreen').addEventListener('click', function () { closeMenus(); deleteScreen(); });
    // 顶栏「更多 ▾」菜单（页面名 / 屏幕方向）
    $('btnMore').addEventListener('click', function (e) {
      e.stopPropagation();
      $('morePageTitle').value = curScreen().title || '';
      syncOrientSeg();
      toggleMenu($('moreMenu'), $('btnMore'));
    });
    // 点击菜单外部或滚动时收起菜单
    document.addEventListener('click', function (e) {
      if (e.target.closest('.popover') || e.target.closest('.screen-menu') || e.target.closest('.caret') || e.target.closest('.lay-page-pick')) return;
      closeMenus();
    });
    // 尺寸变化也要重算选中滑块的位置：横竖屏切换、软键盘收起、窗口缩放之后，
    // 容器的位置/尺寸都变了，滑块如果不重算就会错位（用户看到"选中提示跑偏/不见了"）。
    window.addEventListener('resize', function () {
      closeMenus();
      同步分段药丸();
      requestAnimationFrame(function () { 同步分段药丸(); });
      if (state.inLayout) { requestAnimationFrame(fitStage); setTimeout(fitStage, 120); }
    });
    window.addEventListener('orientationchange', function () {
      // 横竖屏切换后布局要过几帧才稳定，分几个时间点补同步（和 fitStage 一个套路）
      同步分段药丸();
      [120, 400, 800].forEach(function (ms) { setTimeout(同步分段药丸, ms); });
      if (state.inLayout) { requestAnimationFrame(fitStage); setTimeout(fitStage, 200); setTimeout(fitStage, 500); }
    });

    // 拖动布局视图的控制台/开关/页面菜单
    bindLayoutChrome();
    // M3 自定义取色器
    bindColorPicker();
    // 云表格创建/管理 + Blockly 输入弹窗 M3 化
    bindCloudUi();
    bindBlocklyDialogUi();

    // 点设计区空白处关闭属性栏
    $('viewDesign').addEventListener('click', onTap(function (e) {
      if (e.target.closest('.compcard,.proppanel,.design-left')) return;
      if (state.selectedCompId) { state.selectedCompId = null; renderCompList(); }
    }));

    // 导出弹窗
    $('exportCancel').addEventListener('click', function () { $('exportMask').classList.add('hidden'); });
    $('exportGo').addEventListener('click', doExport);
    $('btnPickIcon').addEventListener('click', function () { $('iconFile').click(); });
    $('btnClearIcon').addEventListener('click', function () { exportIcon = null; renderIconPreview(); });
    $('iconFile').addEventListener('change', function () {
      pickImage(this, function (url) { exportIcon = url; renderIconPreview(); });
      this.value = '';
    });

    // 从运行预览/后台返回：作废所有「复位看护」——这时画布尺寸和视口都变了，
    // 让早先的快照再套一次会把积木闪回原位（用户反馈：从后台回来拖一下画布，积木闪回）。
    document.addEventListener('visibilitychange', function () {
      try { if (document.hidden) pendingRestore = {}; } catch (e) {}
    });
    // 从运行预览返回：恢复编辑器横屏、全屏沉浸与画布尺寸；并清除运行时可能残留的亮度/常亮
    window.addEventListener('pageshow', function () {
      try { pendingRestore = {}; } catch (e) {}
      // bfcache 命中时页面不重载（init 不会跑），编辑状态本来就保留；消费掉试运行标记，
      // 避免它残留到之后某次冷启动逻辑里
      try { sessionStorage.removeItem('__fromPreview'); } catch (e) {}
      if (window.Native && Native.setLayoutChrome) Native.setLayoutChrome(false);
      if (window.Native && Native.setOrientation) Native.setOrientation('landscape');
      if (window.Native && Native.restoreDisplay) Native.restoreDisplay();
      requestWsResize();
      // bfcache 命中时 init 不会再跑：从社区运行回来的，这里补一次"停在社区那一栏"
      // （DOM 通常本来就停在社区页，这里只是兜底 + 顺手刷新一次列表）
      if (消费运行来源() === 'community') {
        try {
          var a = $('viewAccount');
          if (!currentUser()) openAuth();
          else if (a && a.classList.contains('hidden')) { openAccount(); showAcctPane('comm'); }
          else showAcctPane('comm');
        } catch (e) {}
      }
    });
    // 正常进入编辑器（含从试运行 history.back 重载）：复位为横屏全屏沉浸，并兜底恢复亮度
    if (window.Native && Native.setLayoutChrome) Native.setLayoutChrome(false);
    if (window.Native && Native.setOrientation) Native.setOrientation('landscape');
    if (window.Native && Native.restoreDisplay) Native.restoreDisplay();

    renderHome();
    setTimeout(function () { 后台查更新红点(); }, 1500);   // 开机静默查一次，有新版本就在按钮上亮红点

    // 从社区点「运行」回来的：停在「账号 → 社区」那一栏（用户要求），别跳进编辑器
    if (消费运行来源() === 'community') {
      openAccount();
      showAcctPane('comm');
      return;
    }

    // 仅当本次是“试运行返回”（同进程会话，sessionStorage 标记仍在）时自动回到刚才编辑的工程；
    // 进程被杀后的冷启动没有该标记，停在“所有 App”首页（不会直接进入上次的编辑页）
    try {
      var fromPreview = sessionStorage.getItem('__fromPreview');
      sessionStorage.removeItem('__fromPreview');
      if (fromPreview) {
        var openId = localStorage.getItem(OPEN_KEY);
        if (openId && loadStore().items.some(function (x) { return x.id === openId; })) {
          openItem(openId);
        }
      } else {
        try { localStorage.removeItem(OPEN_KEY); } catch (e) {}
      }
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', init);
})();
