package com.fast.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 同一个 Activity 服务两种形态：
 *  - shell（导出的作品）：assets 存在 project.json，直接进运行时；
 *  - editor（编辑器）：无 project.json，进入编辑器。
 * 不做 edge-to-edge：WebView 始终布局在系统栏安全区内，状态栏/导航栏区域不显示任何网页内容，
 * 系统栏使用纯色背景。
 *
 * <p>本文件约 1000 行，方法索引（按关注点分组，直接搜索方法名即可跳转）：
 * <ul>
 *   <li>窗口 / 系统栏：enterImmersive、applyShellBars、applyStatusBar、applySafeInsets、
 *       onWindowFocusChanged、onConfigurationChanged</li>
 *   <li>网页 → 原生（NativeBridge 内的 @JavascriptInterface）：
 *       getMode、getProject、deviceInfo、toast、copyText、vibrate、
 *       setOrientation、setStatusBar、setLayoutChrome、setBrightness、setKeepScreenOn、
 *       restoreDisplay、openDownloadFolder、exitApp</li>
 *   <li>导出与安装：exportApk、installApk、launchInstaller、downloadApk</li>
 *   <li>文件与分享：shareProject、launchShare、pickMedia、mediaUrl</li>
 *   <li>联网请求：httpRequest、postHttpResult</li>
 *   <li>其它：evalJs（原生回调网页）、onBackPressed</li>
 * </ul>
 */
public class MainActivity extends Activity {

    private WebView web;
    private boolean shellMode;
    private boolean currentShowSB = true;
    private boolean layoutChrome = false;
    private String embeddedProject;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> filePathCallback;
    private static final int REQ_FILE = 5173;
    private static final int REQ_MEDIA = 5174;
    private static final int REQ_PICK_IMG = 5175;   // 代码块「拍照或选图」用
    private static final int REQ_NOTIF = 5176;      // 通知栏权限（Android 13+）
    // 试运行的通知卡片（「终止运行」按钮）：通道 id 与通知 id
    private static final String CH_RUN = "fast_run";
    private static final int RUN_NOTICE_ID = 8801;
    private String pendingPickCb;                   // 对应的网页回调 id
    private String pendingMediaKind;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        shellMode = false;
        embeddedProject = null;
        try {
            byte[] data = readAll(getAssets().open("project.json"));
            String p = new String(data, "UTF-8");
            if (p != null && p.contains("screens")) { shellMode = true; embeddedProject = p; }
        } catch (Exception ignore) {}

        int bgColor = shellMode ? Color.parseColor("#F7F6FA") : Color.WHITE;
        if (shellMode) {
            // 导出作品启动时的方向：必须按**起始页**那一页来（运行时渲染的也是它）。
            // 以前取的是 screens[0]，如果起始页不是第一页、且两页方向不同，
            // 就会出现"先按第一页方向起来、再被运行时改成起始页方向"的竖↔横抖动。
            try {
                org.json.JSONObject jo = new org.json.JSONObject(embeddedProject);
                org.json.JSONArray ss = jo.optJSONArray("screens");
                if (ss != null && ss.length() > 0) {
                    String startId = jo.optString("startScreen", "");
                    org.json.JSONObject s0 = null;
                    for (int i = 0; i < ss.length(); i++) {
                        org.json.JSONObject s = ss.getJSONObject(i);
                        if (startId != null && startId.length() > 0 && startId.equals(s.optString("id", ""))) { s0 = s; break; }
                    }
                    if (s0 == null) s0 = ss.getJSONObject(0);
                    String o = s0.optString("orientation", "");
                    if (o == null || o.length() == 0) o = jo.optString("orientation", "portrait");
                    setRequestedOrientation("landscape".equals(o)
                            ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                }
            } catch (Exception ignore) {}
        }
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) {
            // 关键：横屏默认会在挖孔那条边留黑边，SHORT_EDGES 让窗口铺到挖孔两侧
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        getWindow().getDecorView().setBackgroundColor(bgColor);
        if (!shellMode) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            enterImmersive(); // 编辑器像横屏游戏一样全屏隐藏状态栏/导航栏
        } else {
            applyShellBars();
        }

        web = new WebView(this);
        // 关掉 WebView 缓存：资源更新后如果还用缓存的旧 JS/HTML，就会出现
        // "改了代码却看不到任何变化"的假象（这次排查 PC 侧也踩了同一个坑）。
        try {
            web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
        } catch (Exception ignore) {}
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        web.setWebChromeClient(new WebChromeClient() {
            // 支持 <input type=file>：选图标/图片，以及导入作品用的 .fast 文件
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) { filePathCallback.onReceiveValue(null); }
                filePathCallback = cb;
                Intent it = buildFileChooserIntent(params);
                try { startActivityForResult(it, REQ_FILE); }
                catch (Exception e) { filePathCallback = null; Toast.makeText(MainActivity.this,
                        "无法打开文件选择", Toast.LENGTH_SHORT).show(); return false; }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new NativeBridge(), "Native");
        // 避让区（状态栏/导航栏/挖孔）显示该底色，而不是黑色
        web.setBackgroundColor(bgColor);

        setContentView(web);
        applySafeInsets(web);
        // 只有编辑器需要保证「下载/fast本地app」存在；壳是导出出去的作品，不该去建这个目录
        if (!shellMode) ensurePublicDir();
        if (shellMode) web.loadUrl("file:///android_asset/www/runtime.html");
        else web.loadUrl("file:///android_asset/www/editor.html");
    }

    /**
     * 编辑器：全屏沉浸（像横屏游戏），隐藏状态栏与导航栏，内容铺到物理边缘；
     * 仅靠内边距避让挖孔摄像头（见 applySafeInsets）。
     */
    private void enterImmersive() {
        final View decor = getWindow().getDecorView();
        Runnable r = new Runnable() { @Override public void run() {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            decor.setSystemUiVisibility(flags);
            if (Build.VERSION.SDK_INT >= 30) {
                android.view.WindowInsetsController c = decor.getWindowInsetsController();
                if (c != null) {
                    c.hide(android.view.WindowInsets.Type.systemBars());
                    c.setSystemBarsBehavior(
                            android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
        }};
        main.post(r);
    }

    /** 导出的作品：系统栏保持可见，浅底 + 深色图标 */
    private void applyShellBars() {
        main.post(new Runnable() { @Override public void run() {
            View decor = getWindow().getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 27) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }});
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && !shellMode && !layoutChrome) enterImmersive();
        // 运行时壳：焦点回来时按当前页面设置重设系统栏，保证隐藏通知栏后长期隐藏
        if (hasFocus && shellMode) {
            applyStatusBar(currentShowSB);
        }
    }
    private void applyStatusBar(final boolean show) {
        main.post(new Runnable() { @Override public void run() {
            try {
                View decor = getWindow().getDecorView();
                int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                if (Build.VERSION.SDK_INT >= 27) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                if (!show) {
                    flags |= View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
                } else if (Build.VERSION.SDK_INT >= 26) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                decor.setSystemUiVisibility(flags);
            } catch (Exception ignore) {}
        }});
    }

    /** 系统深浅色切换时通知前端（前端处于“跟随系统”才换肤） */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        try {
            boolean dark = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            if (web != null) evalJs("window.__onSystemThemeChanged&&window.__onSystemThemeChanged(" + dark + ")");
        } catch (Exception ignore) {}
    }

    /**
     * 用 WindowInsets 给 WebView 设内边距：
     *  - 编辑器全屏沉浸，系统栏已隐藏，只避让挖孔摄像头（避免 UI 压到镜头）；
     *  - 作品避让系统栏 + 挖孔。内边距区域由 WebView 底色填充，消除黑边。
     */
    private void applySafeInsets(final View v) {
        v.setFitsSystemWindows(false);
        v.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public android.view.WindowInsets onApplyWindowInsets(View view,
                                                                          android.view.WindowInsets in) {
                int l, t, r, b;
                if (Build.VERSION.SDK_INT >= 30) {
                    // 舞台始终铺满整个屏幕：状态栏、导航栏都只是浮层，内容伸到它们下面
                    // （开/关通知栏、有无导航栏，舞台大小位置完全一致）
                    int typeMask = android.view.WindowInsets.Type.displayCutout();
                    android.graphics.Insets si = in.getInsets(typeMask);
                    l = si.left; t = si.top; r = si.right; b = 0;
                } else {
                    l = in.getSystemWindowInsetLeft();
                    t = 0;   // 不避让状态栏
                    r = in.getSystemWindowInsetRight();
                    b = 0;   // 不避让导航栏
                }
                view.setPadding(l, t, r, b);
                return in;
            }
        });
        v.requestApplyInsets();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            if (filePathCallback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                Uri u = data.getData();
                if (u != null) result = new Uri[]{ u };
            }
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
        if (requestCode == REQ_PICK_IMG) {
            // 选图 / 拍照：读成 dataURL 回给网页（网页里直接塞进图片控件）
            final String cbId = pendingPickCb; pendingPickCb = null;
            final Uri uri = (data != null) ? data.getData() : null;
            android.graphics.Bitmap 缩略 = null;
            try {
                if (uri == null && data != null && data.getExtras() != null) {
                    Object o = data.getExtras().get("data");
                    if (o instanceof android.graphics.Bitmap) 缩略 = (android.graphics.Bitmap) o;
                }
            } catch (Throwable ignore) {}
            if (resultCode != RESULT_OK || (uri == null && 缩略 == null)) {
                evalJs("window.__nativePickImage&&window.__nativePickImage('" + (cbId == null ? "" : cbId) + "','')");
                return;
            }
            final android.graphics.Bitmap 位图 = 缩略;
            new Thread(new Runnable() { public void run() {
                String dataUrl = "";
                try {
                    android.graphics.Bitmap bmp = 位图;
                    if (bmp == null) bmp = 从Uri读图(uri, 1600);
                    if (bmp != null) {
                        int w = bmp.getWidth(), h = bmp.getHeight(), 最长 = Math.max(w, h);
                        if (最长 > 1600) {
                            float k = 1600f / 最长;
                            bmp = android.graphics.Bitmap.createScaledBitmap(bmp,
                                    Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true);
                        }
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, bos);
                        dataUrl = "data:image/jpeg;base64," + android.util.Base64.encodeToString(
                                bos.toByteArray(), android.util.Base64.NO_WRAP);
                    }
                } catch (Throwable ignore) {}
                final String out = dataUrl;
                runOnUiThread(new Runnable() { public void run() {
                    evalJs("window.__nativePickImage&&window.__nativePickImage("
                            + jsStr(cbId) + "," + jsStr(out) + ")");
                }});
            }}).start();
            return;
        }
        if (requestCode == REQ_MEDIA) {
            final String kind = pendingMediaKind; pendingMediaKind = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                evalJs("window.EditorApp&&EditorApp.onMediaPicked&&EditorApp.onMediaPicked('')");
                return;
            }
            final Uri src = data.getData();
            new Thread(new Runnable() {
                public void run() {
                    try {
                        String mime = null;
                        try { mime = getContentResolver().getType(src); } catch (Throwable ignore) {}
                        String ext = (kind != null && kind.equals("audio")) ? ".mp3" : ".mp4";
                        if (mime != null) {
                            String m = mime.toLowerCase();
                            if (m.contains("mpeg") || m.contains("mp3")) ext = ".mp3";
                            else if (m.contains("wav")) ext = ".wav";
                            else if (m.contains("ogg")) ext = ".ogg";
                            else if (m.contains("webm")) ext = ".webm";
                            else if (m.contains("quicktime") || m.contains("mp4")) ext = ".mp4";
                        }
                        java.io.File dir = new java.io.File(getFilesDir(), "media"); dir.mkdirs();
                        String name = (kind != null ? kind : "media") + "_" + System.currentTimeMillis() + ext;
                        java.io.File dst = new java.io.File(dir, name);
                        byte[] bytes = readAll(getContentResolver().openInputStream(src));
                        java.io.FileOutputStream out = new java.io.FileOutputStream(dst);
                        out.write(bytes); out.close();
                        evalJs("window.EditorApp&&EditorApp.onMediaPicked&&EditorApp.onMediaPicked(" + jsStr(name) + ")");
                    } catch (Throwable e) {
                        evalJs("window.EditorApp&&EditorApp.onMediaPicked&&EditorApp.onMediaPicked('')");
                    }
                }
            }).start();
        }
    }

    private static byte[] readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        is.close();
        return bo.toByteArray();
    }

    /** 复制文件并强制落盘（fsync），保证交给安装器的副本完整 */
    private static void copyFile(java.io.File src, java.io.File dst) throws Exception {
        java.io.FileInputStream in = new java.io.FileInputStream(src);
        java.io.FileOutputStream out = new java.io.FileOutputStream(dst);
        try {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush(); out.getFD().sync();
        } finally { in.close(); out.close(); }
    }

    class NativeBridge {

        @JavascriptInterface
        public String getMode() { return shellMode ? "shell" : "editor"; }

        @JavascriptInterface
        public String getProject() { return shellMode ? embeddedProject : null; }

        /** 前端请求屏幕方向：portrait / landscape；布局页保持与运行时一致的系统栏，其余编辑器界面全屏沉浸 */
        @JavascriptInterface
        public void setOrientation(final String mode) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    if ("portrait".equals(mode))
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    else if ("landscape".equals(mode))
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } catch (Exception ignore) {}
                if (!shellMode && !layoutChrome) enterImmersive();
            }});
        }

        /** 运行作品时按页面设置是否显示通知栏（状态栏）。show=false 隐藏状态栏，保留导航栏 */
        @JavascriptInterface
        public void setStatusBar(final boolean show) {
            currentShowSB = show;
            applyStatusBar(show);
        }

        /**
         * 进入/退出“拖动布局”全屏页时切换系统栏风格：
         *  on  = 与导出作品(壳)完全一致：状态栏/导航栏可见、透明、浅色图标，并让 WebView
         *        按系统栏+挖孔留白。这样布局页的可用区宽高、边距与实际运行完全相同（修复底部对不齐）。
         *  off = 恢复编辑器的全屏沉浸。
         */
        @JavascriptInterface
        public void setLayoutChrome(final boolean on) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    layoutChrome = on;
                    if (on) applyShellBars(); else enterImmersive();
                    if (web != null) applySafeInsets(web);
                } catch (Exception ignore) {}
            }});
        }

        @JavascriptInterface
        public void setStatusBarStyle(String mode) { /* 由模式决定，保留接口兼容 */ }

        /** 系统当前是否深色模式（供前端“跟随系统”可靠判断，部分 WebView 不回传 prefers-color-scheme） */
        @JavascriptInterface
        public boolean isSystemDark() {
            try {
                int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
                return mode == Configuration.UI_MODE_NIGHT_YES;
            } catch (Exception e) { return false; }
        }

        /** 震动指定毫秒（震动代码用） */
        @JavascriptInterface
        public void vibrate(final long ms) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    Vibrator vib = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                    if (vib == null || !vib.hasVibrator()) return;
                    long m = Math.max(1, Math.min(ms, 3000));
                    if (Build.VERSION.SDK_INT >= 26)
                        vib.vibrate(VibrationEffect.createOneShot(m, VibrationEffect.DEFAULT_AMPLITUDE));
                    else vib.vibrate(m);
                } catch (Exception ignore) {}
            }});
        }

        @JavascriptInterface
        public void exportApk(final String projectJson, final String appName,
                              final String orientation, final String iconDataUrl,
                              final String version) {
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        String path = Exporter.export(MainActivity.this, projectJson, appName,
                                orientation, iconDataUrl, version);
                        // 每次导出都直接在公共「下载/fast本地app」落一份，并拿到系统 MediaStore 的 content:// 地址
                        String dlUri = null;
                        try { dlUri = persistToDownload(new java.io.File(path)); } catch (Throwable ignore) {}
                        evalJs("window.EditorApp&&EditorApp.onExportResult(true," + jsStr(path) + ",'',"
                                + (dlUri == null ? "null" : jsStr(dlUri)) + ")");
                    } catch (final Throwable e) {
                        String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                        evalJs("window.EditorApp&&EditorApp.onExportResult(false,''," + jsStr(msg) + ",null)");
                    }
                }
            }).start();
        }

        /**
         * 调起系统安装器。优先用公共下载目录的系统 MediaStore content://（系统 Provider 拥有，
         * 任何安装器都能稳定读取）；否则退回应用私有副本 + 自有 FileProvider。
         * 并向所有能处理安装的包显式授予读权限，修复 ColorOS 等安装器跨进程读不到文件而报“包损坏”。
         */
        @JavascriptInterface
        public void installApk(final String path, final String downloadUri) {
            new Thread(new Runnable() { @Override public void run() {
                Uri uri = null;
                try {
                    if (path != null && path.startsWith("content://")) uri = Uri.parse(path);
                    if (downloadUri != null && downloadUri.startsWith("content://")) uri = Uri.parse(downloadUri);
                    if (uri == null) {
                        java.io.File master = new java.io.File(path);
                        // 审计加固：纯路径只认本 App 目录内的真 APK（外来的任意文件不许直接交给安装器）
                        if (!master.exists() || master.length() < 10000 || !是本机安装包(master)) {
                            toast("安装文件不存在或不完整，请重新导出"); return;
                        }
                        // 交给安装器的是一次性副本，避免部分 ROM 安装结束后清掉原件
                        java.io.File stage = new java.io.File(getFilesDir(), "install_stage.apk");
                        copyFile(master, stage);
                        uri = SimpleFileProvider.uriFor(stage);
                    }
                    final Uri target = uri;
                    main.post(new Runnable() { @Override public void run() { launchInstaller(target); } });
                } catch (final Exception e) {
                    toast("无法调起安装：" + e.getMessage());
                }
            }}).start();
        }

        /** 纯路径安装包的安全门槛（审计加固）：必须在本 App 自己的目录里、后缀 .apk、ZIP 魔数正确。
            导出/更新下载都落在 getFilesDir()（downloads、install_stage），走 content:// 时不经过这里。 */
        private boolean 是本机安装包(java.io.File f) {
            try {
                java.io.File 真 = f.getCanonicalFile();
                boolean 在目录内 = false;
                java.io.File[] 根 = { getFilesDir(), getCacheDir(), getExternalFilesDir(null) };
                for (java.io.File r : 根) {
                    if (r == null) continue;
                    String rp = r.getCanonicalPath();
                    if (真.getPath().startsWith(rp + java.io.File.separator)) { 在目录内 = true; break; }
                }
                if (!在目录内) return false;
                if (!真.isFile() || !真.getName().toLowerCase().endsWith(".apk")) return false;
                java.io.FileInputStream in = new java.io.FileInputStream(真);
                int b0 = in.read(), b1 = in.read(), b2 = in.read(), b3 = in.read();
                in.close();
                return b0 == 'P' && b1 == 'K' && b2 == 3 && b3 == 4;
            } catch (Exception e) { return false; }
        }
        /** 下载指定 URL 的安装包到私有目录，完成后回调 EditorApp.onApkDownloaded(cbId, 本地路径, 错误) */
        @JavascriptInterface
        public void downloadApk(final String cbId, final String url, final String saveName) {
            // 审计加固：只允许 http/https。否则 file:// 之类的地址能把本机任意文件
            // 复制成 .apk 再走安装流程（配合网页控件里的第三方页面，是个不该开的口子）。
            String scheme = (url == null ? "" : url.trim()).toLowerCase();
            if (!(scheme.startsWith("http://") || scheme.startsWith("https://"))) {
                evalJs("window.EditorApp&&EditorApp.onApkDownloaded(" + jsStr(cbId) + ",'',"
                        + jsStr("下载地址无效（只支持 http/https）") + ")");
                return;
            }
            new Thread(new Runnable() { @Override public void run() {
                try {
                    java.io.File dir = new java.io.File(getFilesDir(), "downloads"); dir.mkdirs();
                    String name = (saveName == null || saveName.trim().isEmpty()) ? "update.apk" : saveName;
                    name = name.replaceAll("[\\\\/:*?\"<>|]+", "_");
                    if (!name.toLowerCase().endsWith(".apk")) name += ".apk";
                    java.io.File dst = new java.io.File(dir, name);
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setRequestMethod("GET"); c.setInstanceFollowRedirects(true); c.setConnectTimeout(15000); c.setReadTimeout(60000);
                    // 关键：禁用 gzip，避免下到未解压的压缩字节；用 UA 避免被拒
                    c.setRequestProperty("Accept-Encoding", "identity");
                    c.setRequestProperty("User-Agent", "FAST-Update/1.0");
                    long expect = c.getContentLengthLong();
                    InputStream is = c.getInputStream();
                    java.io.FileOutputStream os = new java.io.FileOutputStream(dst);
                    byte[] buf = new byte[8192]; int n; long got = 0;
                    while ((n = is.read(buf)) > 0) { os.write(buf, 0, n); got += n; }
                    os.close(); is.close(); c.disconnect();
                    // 大小校验：与服务器 Content-Length 必须一致，否则视为损坏
                    if (expect > 0 && got != expect) {
                        dst.delete();
                        evalJs("window.EditorApp&&EditorApp.onApkDownloaded(" + jsStr(cbId) + ",'',"
                                + jsStr("下载不完整(期望" + expect + "实际" + got + ")，请重试") + ")");
                        return;
                    }
                    // 校验确实是 APK（ZIP 魔数 PK\x03\x04），避免下到错误页/重定向页导致“安装包损坏”
                    java.io.FileInputStream chk = new java.io.FileInputStream(dst);
                    int b0 = chk.read(), b1 = chk.read(), b2 = chk.read(), b3 = chk.read(); chk.close();
                    if (b0 != 'P' || b1 != 'K' || b2 != 3 || b3 != 4) {
                        dst.delete();
                        evalJs("window.EditorApp&&EditorApp.onApkDownloaded(" + jsStr(cbId) + ",'',"
                                + jsStr("下载到的不是有效安装包(可能链接已过期)，请重试") + ")");
                        return;
                    }
                    // 与导出 APK 完全相同的落盘方式：写入公共 Download/fast本地app（MediaStore），
                    // 返回系统 content:// 地址，安装器可稳定读取（私有 FileProvider 偶发装不上）
                    String contentUri = null;
                    try { contentUri = persistToDownload(dst); } catch (Throwable t) { contentUri = null; }
                    final String cbPath = (contentUri != null) ? contentUri : dst.getAbsolutePath();
                    evalJs("window.EditorApp&&EditorApp.onApkDownloaded(" + jsStr(cbId) + ","
                            + jsStr(cbPath) + ",'')");
                } catch (final Throwable e) {
                    evalJs("window.EditorApp&&EditorApp.onApkDownloaded(" + jsStr(cbId) + ",'',"
                            + jsStr(e.getMessage() == null ? "下载失败" : e.getMessage()) + ")");
                }
            }}).start();
        }

        /** 直接跳转到公共「下载/fast本地app」目录，让用户用系统文件管理器点 APK 安装（直装失败时的兜底通道） */
        @JavascriptInterface
        public void openDownloadFolder() {
            main.post(new Runnable() { @Override public void run() {
                // 先判断目录在不在：startActivity 对"不存在的 documentId"不会报错，
                // 只会让文件管理器落到别处（表现为"打开的根本不是那个文件夹"），
                // 所以不能靠 openDocDir 的返回值判断成败，得先自己确认。
                String docId = publicDirHasFiles() ? ("primary:Download/" + PUBLIC_SUBDIR) : "primary:Download";
                Intent opened = openDocDir(docId);
                if (opened == null) opened = openDocDir("primary:Download");
                if (opened == null) {
                    try {
                        Intent it = new Intent(Intent.ACTION_GET_CONTENT);
                        it.setType("application/vnd.android.package-archive");
                        it.addCategory(Intent.CATEGORY_OPENABLE);
                        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(Intent.createChooser(it, "选择安装包").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception e) {
                        toast("请打开系统「文件管理」，进入 下载/fast本地app 目录点击安装");
                    }
                }
            }});
        }

        /** 分享 FAST 作品文件（.fast，本质 JSON）：写入下载目录后用系统分享面板发出 */
        @JavascriptInterface
        public void shareProject(final String json, final String fileName) {
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        java.io.File dir = new java.io.File(getFilesDir(), "shared");
                        if (!dir.exists()) dir.mkdirs();
                        String safe = fileName == null ? "FAST作品.fast"
                                : fileName.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_").trim();
                        if (safe.isEmpty()) safe = "FAST作品.fast";
                        if (!safe.toLowerCase().endsWith(".fast")) safe = safe + ".fast";
                        final java.io.File f = new java.io.File(dir, safe);
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
                        try { fos.write(json.getBytes("UTF-8")); fos.flush(); fos.getFD().sync(); } finally { fos.close(); }

                        // 关键：优先分享「公共下载/fast本地app」里的系统 MediaStore 地址，而不是我们自己的
                        // FileProvider。微信读自建 Provider 的 content:// 会报「获取资源失败」，而系统
                        // Downloads Provider 拥有的地址它能稳定读取——安装器那条路早就踩过同一个坑
                        // （见 launchInstaller 的注释）。顺带这份公开副本也成了分享失败时的兜底：
                        // 用户可以直接在微信里从「文件」里把它发出去。
                        String dl = null;
                        try { dl = persistToDownloadAs(f, "application/octet-stream", PUBLIC_SUBDIR); } catch (Throwable ignore) {}
                        final String dlUri = dl;
                        main.post(new Runnable() { @Override public void run() { launchShare(f, dlUri); } });
                    } catch (final Exception e) {
                        main.post(new Runnable() { @Override public void run() { toast("分享失败：" + e.getMessage()); } });
                    }
                }
            }).start();
        }

        /**
         * 只把作品文件存到公共「下载/fast本地app」，**不**唤起系统分享面板。
         * 「保存在本地」用它；「分享到社交平台」仍走 shareProject。
         * （分享必须先落一份公共副本，否则微信读不到 App 私有目录里的 content://）
         */
        @JavascriptInterface
        public void saveProject(final String json, final String fileName) {
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        java.io.File dir = new java.io.File(getFilesDir(), "shared");
                        if (!dir.exists()) dir.mkdirs();
                        String safe = fileName == null ? "FAST作品.fast"
                                : fileName.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_").trim();
                        if (safe.isEmpty()) safe = "FAST作品.fast";
                        if (!safe.toLowerCase().endsWith(".fast")) safe = safe + ".fast";
                        final java.io.File f = new java.io.File(dir, safe);
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
                        try { fos.write(json.getBytes("UTF-8")); fos.flush(); fos.getFD().sync(); } finally { fos.close(); }
                        String dl = null;
                        try { dl = persistToDownloadAs(f, "application/octet-stream", PUBLIC_SUBDIR); } catch (Throwable ignore) {}
                        final boolean ok = dl != null;
                        main.post(new Runnable() { @Override public void run() {
                            toast(ok ? "已保存到「下载/fast本地app」" : "保存失败，请检查存储权限");
                        }});
                    } catch (final Exception e) {
                        main.post(new Runnable() { @Override public void run() { toast("保存失败：" + e.getMessage()); } });
                    }
                }
            }).start();
        }

        /** 读取 AI 的 API Key（没设置过返回空串） */
        @JavascriptInterface
        public String getAiKey() {
            try {
                java.io.File f = new java.io.File(new java.io.File(getFilesDir(), AI_DIR), AI_KEY_FILE);
                if (!f.isFile()) return "";
                return new String(readAll(new java.io.FileInputStream(f)), "UTF-8").trim();
            } catch (Throwable t) {
                return "";
            }
        }

        /** 保存 AI 的 API Key；传空串即清除 */
        @JavascriptInterface
        public void setAiKey(final String key) {
            try {
                java.io.File dir = new java.io.File(getFilesDir(), AI_DIR);
                if (!dir.exists() && !dir.mkdirs()) return;
                java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(dir, AI_KEY_FILE));
                try {
                    out.write((key == null ? "" : key.trim()).getBytes("UTF-8"));
                    out.flush();
                } finally { out.close(); }
            } catch (Throwable ignore) {}
        }

        @JavascriptInterface
        public void toast(final String text) {
            main.post(new Runnable() { @Override public void run() {
                Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show();
            }});
        }

        /** 选择本地视频/音频：由原生弹出系统选择器，选完拷入 filesDir/media，再回调 onMediaPicked(文件名) */
        @JavascriptInterface
        public void pickMedia(final String kind) {
            main.post(new Runnable() { public void run() {
                pendingMediaKind = (kind != null && kind.equals("audio")) ? "audio" : "video";
                Intent it = new Intent(Intent.ACTION_GET_CONTENT);
                it.setType(pendingMediaKind.equals("audio") ? "audio/*" : "video/*");
                it.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(Intent.createChooser(it, "选择" + (pendingMediaKind.equals("audio") ? "音频" : "视频")), REQ_MEDIA);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "无法打开文件选择", Toast.LENGTH_SHORT).show();
                }
            }});
        }

        /**
     * 代码块「拍照或选图，显示到〔图片控件〕」的原生实现。
     * 为什么不用网页里的 &lt;input type=file&gt;：WebView 的文件选择器在部分机型上不弹、
     * 也不一定能开相机；这里自己拉起"相机 / 相册"选择器，读成 dataURL 回给网页，稳。
     */
    @JavascriptInterface
    public void pickImageNative(final String cbId, final String kind) {
        main.post(new Runnable() { public void run() {
            pendingPickCb = cbId;
            try {
                Intent 相册 = new Intent(Intent.ACTION_GET_CONTENT);
                相册.setType("image/*");
                相册.addCategory(Intent.CATEGORY_OPENABLE);
                Intent 拍照 = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
                Intent chooser = Intent.createChooser(相册, "拍照或选择图片");
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{ 拍照 });
                startActivityForResult(chooser, REQ_PICK_IMG);
            } catch (Throwable e) {
                pendingPickCb = null;
                evalJs("window.__nativePickImage&&window.__nativePickImage(" + jsStr(cbId) + ",'')");
            }
        }});
    }

    /** 把工程里的 media:// 引用解析成可播放地址：编辑器私有目录优先，否则用导出 APK 的 assets */        @JavascriptInterface
        public String mediaUrl(String name) {
            if (name == null) return "";
            if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf("..") >= 0) return "";
            java.io.File f = new java.io.File(getFilesDir(), "media/" + name);
            if (f.exists()) return "file://" + f.getAbsolutePath();
            return "file:///android_asset/media/" + name;
        }

        /** 分享作品时把本地视频/音频读成 Base64，好让接收方也能播放；文件不存在返回空串 */
        @JavascriptInterface
        public String readMediaBase64(final String name) {
            if (name == null) return "";
            if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf("..") >= 0) return "";
            try {
                java.io.File f = new java.io.File(getFilesDir(), "media/" + name);
                if (!f.isFile()) return "";
                byte[] bytes = readAll(new java.io.FileInputStream(f));
                return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
            } catch (Throwable t) {
                return "";
            }
        }

        /** 导入分享作品时，把随作品带来的本地媒体写回私有目录；成功返回 true */
        @JavascriptInterface
        public boolean writeMedia(final String name, final String base64) {
            if (name == null || base64 == null || base64.isEmpty()) return false;
            if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf("..") >= 0) return false;
            try {
                byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                java.io.File dir = new java.io.File(getFilesDir(), "media");
                if (!dir.exists() && !dir.mkdirs()) return false;
                java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(dir, name));
                try { out.write(bytes); out.flush(); } finally { out.close(); }
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public void exitApp() {
            main.post(new Runnable() { @Override public void run() { finish(); } });
        }

        /**
         * 通用异步 HTTP 请求（云列表等代码使用）。WebView 直连受 CORS 限制
         * （例如 SeaTable api-gateway 会返回重复 Access-Control-Allow-Origin 头，浏览器直接拒绝），
         * 原生 HttpURLConnection 不受此限制。结果通过 window.__nativeHttpResolve(id, json) 回调。
         */
        @JavascriptInterface
        public void httpRequest(final String cbId, final String method, final String url,
                                final String headersJson, final String body) {
            new Thread(new Runnable() { @Override public void run() {
                java.io.OutputStream out = null; java.io.InputStream in = null;
                try {
                    java.net.HttpURLConnection conn =
                            (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    conn.setConnectTimeout(15000);
                    // 读超时必须比 JS 侧的统一超时（读表 40 秒）**宽**，否则弱网下是原生先掐断，
                    // 报出来只有一句"连接超时"，JS 那边的重试与 40 秒窗口都用不上。
                    conn.setReadTimeout(60000);
                    conn.setRequestMethod(method == null ? "GET" : method.toUpperCase());
                    conn.setDoInput(true);
                    org.json.JSONObject headers = (headersJson == null || headersJson.length() == 0)
                            ? new org.json.JSONObject() : new org.json.JSONObject(headersJson);
                    java.util.Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        String v = headers.optString(k);
                        if (k != null && v != null) conn.setRequestProperty(k, v);
                    }
                    if (body != null && body.length() > 0) {
                        conn.setDoOutput(true);
                        out = conn.getOutputStream();
                        // multipart 上传：JS 侧把二进制体按「一字符 = 一字节」的 Latin-1 传过来，
                        // 这里必须按同样规则还原，否则图片/附件会传坏。
                        // （普通 JSON 体走的是 UTF-8，不能动）
                        String ct = conn.getRequestProperty("Content-Type");
                        if (ct != null && ct.startsWith("multipart/form-data")) {
                            out.write(body.getBytes("ISO-8859-1"));
                        } else {
                            out.write(body.getBytes("UTF-8"));
                        }
                        out.flush();
                    }
                    int code = conn.getResponseCode();
                    in = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    if (in != null) { byte[] chunk = new byte[4096]; int n; while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n); }
                    org.json.JSONObject result = new org.json.JSONObject();
                    result.put("status", code);
                    result.put("body", new String(buf.toByteArray(), "UTF-8"));
                    postHttpResult(cbId, result.toString());
                } catch (Exception e) {
                    try {
                        org.json.JSONObject result = new org.json.JSONObject();
                        result.put("error", e.getMessage() == null ? "网络请求失败" : e.getMessage());
                        postHttpResult(cbId, result.toString());
                    } catch (Exception ignore) {}
                } finally {
                    try { if (out != null) out.close(); } catch (Exception ignore) {}
                    try { if (in != null) in.close(); } catch (Exception ignore) {}
                }
            }}).start();
        }

        /* ==================== 设备信息代码 ==================== */
        // CPU 占用率、温度需要两次采样，后台守护线程每 2 秒采样一次，deviceInfo 直接读缓存
        private volatile long cpuBusy = -1, cpuTotal = -1;
        private volatile int cpuUsage = -1;
        private volatile double thermalC = -1, gpuUsage = -1;
        {
            Thread sampler = new Thread(new Runnable() {
                @Override public void run() {
                    while (true) {
                        try {
                            long[] j = readCpuJiffies();
                            if (j != null) {
                                if (cpuTotal >= 0 && j[1] > cpuTotal) {
                                    long db = j[0] - cpuBusy, dt = j[1] - cpuTotal;
                                    if (dt > 0) cpuUsage = (int) Math.max(0, Math.min(100, Math.round(db * 100.0 / dt)));
                                }
                                cpuBusy = j[0]; cpuTotal = j[1];
                            }
                            thermalC = readThermal();
                            gpuUsage = readGpu();
                            Thread.sleep(2000);
                        } catch (Throwable t) {
                            try { Thread.sleep(2000); } catch (Throwable ig) {}
                        }
                    }
                }
            });
            sampler.setDaemon(true);
            sampler.start();
        }

        private String readSmallFile(java.io.File f) {
            try {
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(f));
                String s = br.readLine(); br.close();
                return s == null ? "" : s.trim();
            } catch (Exception e) { return ""; }
        }

        // 返回 {忙jiffies, 总jiffies}
        private long[] readCpuJiffies() {
            try {
                java.io.BufferedReader br = new java.io.BufferedReader(
                        new java.io.FileReader("/proc/stat"));
                String line = br.readLine(); br.close();
                if (line == null) return null;
                String[] p = line.trim().split("\\s+");
                long idle = 0, total = 0;
                for (int k = 1; k < p.length; k++) {
                    try { long v = Long.parseLong(p[k]); total += v; if (k == 4 || k == 5) idle += v; }
                    catch (NumberFormatException ignore) {}
                }
                return new long[]{ total - idle, total };
            } catch (Exception e) { return null; }
        }

        private android.content.Intent batteryIntent() {
            try {
                return registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            } catch (Exception e) { return null; }
        }

        private double readThermal() {
            // 优先取热区温度（CPU/主板等），取 20~120℃ 之间的最高值；读不到回退电池温度
            double best = -1;
            try {
                java.io.File dir = new java.io.File("/sys/class/thermal");
                java.io.File[] zones = dir.listFiles(new java.io.FileFilter() {
                    @Override public boolean accept(java.io.File f) { return f.getName().startsWith("thermal_zone"); }
                });
                if (zones != null) {
                    for (java.io.File z : zones) {
                        try {
                            String t = readSmallFile(new java.io.File(z, "temp"));
                            if (t.length() == 0) continue;
                            double v = Double.parseDouble(t) / 1000.0;
                            if (v > 20 && v < 120 && v > best) best = v;
                        } catch (Exception ignore) {}
                    }
                }
            } catch (Exception ignore) {}
            if (best > 0) return Math.round(best * 10) / 10.0;
            try {
                android.content.Intent i = batteryIntent();
                if (i == null) return -1;
                int t = i.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                if (t == Integer.MIN_VALUE) return -1;
                return Math.round(t / 100.0) / 10.0;
            } catch (Exception e) { return -1; }
        }

        // 高通 Adreno GPU 占用：gpubusy 通常需要 root，普通应用读不到则返回 -1
        private double readGpu() {
            try {
                java.io.File f = new java.io.File("/sys/class/kgsl/kgsl-3d0/gpubusy");
                if (f.exists()) {
                    String[] p = readSmallFile(f).split("\\s+");
                    if (p.length >= 2) {
                        // 格式为 "忙时 闲时"，占用 = 忙 / (忙 + 闲)
                        long busy = Long.parseLong(p[0]), idle = Long.parseLong(p[1]);
                        long tot = busy + idle;
                        if (tot > 0) return Math.round(busy * 1000.0 / tot) / 10.0;
                    }
                }
            } catch (Exception ignore) {}
            return -1;
        }

        private double readBrightness() {
            try {
                float b = getWindow().getAttributes().screenBrightness;
                if (b >= 0 && b <= 1) return Math.round(b * 100);
                int v = android.provider.Settings.System.getInt(getContentResolver(),
                        android.provider.Settings.System.SCREEN_BRIGHTNESS);
                return Math.round(v / 255.0 * 100);
            } catch (Exception e) { return -1; }
        }

        /** 设备信息：一次性返回 JSON（CPU/内存/电池/温度/网络/屏幕/型号等），代码按需取字段 */
        @JavascriptInterface
        public String deviceInfo() {
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("cpuCores", Runtime.getRuntime().availableProcessors());
                o.put("cpuUsage", cpuUsage);
                java.lang.Runtime jrt = Runtime.getRuntime();
                long used = jrt.totalMemory() - jrt.freeMemory();
                long max = jrt.maxMemory();
                o.put("jvmMemUsage", max > 0 ? Math.round(used * 100.0 / max) : -1);

                android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
                if (am != null) {
                    android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
                    am.getMemoryInfo(mi);
                    long total = mi.totalMem, avail = mi.availMem;
                    o.put("memTotalGB", Math.round(total / 1073741824.0 * 10) / 10.0);
                    o.put("memAvailGB", Math.round(avail / 1073741824.0 * 10) / 10.0);
                    o.put("memUsage", total > 0 ? Math.round((total - avail) * 100.0 / total) : -1);
                } else {
                    o.put("memTotalGB", -1); o.put("memAvailGB", -1); o.put("memUsage", -1);
                }

                android.content.Intent bi = batteryIntent();
                if (bi != null) {
                    int level = bi.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                    int scale = bi.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100);
                    int status = bi.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                    o.put("battery", level >= 0 && scale > 0 ? Math.round(level * 100.0 / scale) : -1);
                    int t = bi.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                    o.put("batteryTemp", t == Integer.MIN_VALUE ? -1 : Math.round(t / 100.0) / 10.0);
                    o.put("charging", status == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                            || status == android.os.BatteryManager.BATTERY_STATUS_FULL);
                } else {
                    o.put("battery", -1); o.put("batteryTemp", -1); o.put("charging", false);
                }
                o.put("deviceTemp", thermalC);
                o.put("gpuUsage", gpuUsage);

                String net = "无网络"; boolean online = false;
                try {
                    android.net.ConnectivityManager cm =
                            (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                    android.net.NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
                    if (ni != null && ni.isConnected()) {
                        online = true;
                        net = ni.getType() == android.net.ConnectivityManager.TYPE_WIFI ? "WiFi" : "移动数据";
                    }
                } catch (Exception ignore) {}
                o.put("netType", net);
                o.put("online", online);

                float rr = 60;
                try {
                    android.view.Display d = getWindowManager().getDefaultDisplay();
                    if (d.getRefreshRate() > 0) rr = d.getRefreshRate();
                } catch (Exception ignore) {}
                o.put("refreshRate", Math.round(rr));

                o.put("model", Build.MODEL == null ? "" : Build.MODEL);
                o.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
                o.put("androidVersion", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE);
                o.put("sdkInt", Build.VERSION.SDK_INT);
                o.put("brightness", readBrightness());
                o.put("screenWidth", getResources().getDisplayMetrics().widthPixels);
                o.put("screenHeight", getResources().getDisplayMetrics().heightPixels);
                o.put("density", Math.round(getResources().getDisplayMetrics().density * 100) / 100.0);
                o.put("language", java.util.Locale.getDefault().getLanguage());
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        /** 设置本应用窗口亮度（0~100，负数=恢复自动亮度） */
        @JavascriptInterface
        public void setBrightness(final double v) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    if (v < 0) lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                    else lp.screenBrightness = (float) Math.max(0, Math.min(1, v / 100.0));
                    getWindow().setAttributes(lp);
                } catch (Exception ignore) {}
            }});
        }

        /** 保持屏幕常亮 开/关（仅本应用前台时有效，无需权限） */
        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } catch (Exception ignore) {}
            }});
        }

        /** 恢复系统显示：清除本窗口的亮度覆盖（回到自动/系统亮度）并取消常亮。
         *  试运行退出回到编辑器时调用，避免运行时设置的亮度/常亮残留。 */
        @JavascriptInterface
        public void restoreDisplay() {
            main.post(new Runnable() { @Override public void run() {
                try {
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    if (lp.screenBrightness != WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE) {
                        lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                        getWindow().setAttributes(lp);
                    }
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } catch (Exception ignore) {}
            }});
        }

        /**
         * 试运行开始：在系统通知栏挂一张卡片「《作品名》正在运行中」，右侧一个「终止运行」按钮。
         * 页面里原来的结束按钮已经删掉（用户要求改成通知栏结束）。
         * 点「终止运行」→ 拉起本 Activity 并带上 stopRun 标记 → onNewIntent 里回调 window.__nativeStopRun()。
         */
        @JavascriptInterface
        public void startRunNotice(final String appName) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                    if (nm == null) return;
                    if (Build.VERSION.SDK_INT >= 26) {
                        NotificationChannel ch = new NotificationChannel(CH_RUN, "作品运行中",
                                NotificationManager.IMPORTANCE_LOW);
                        ch.setShowBadge(false);
                        nm.createNotificationChannel(ch);
                    }
                    Intent stop = new Intent(MainActivity.this, MainActivity.class);
                    stop.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    stop.putExtra("stopRun", true);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
                    PendingIntent pi = PendingIntent.getActivity(MainActivity.this, RUN_NOTICE_ID, stop, flags);
                    String title = "《" + (appName == null || appName.trim().isEmpty() ? "作品" : appName.trim()) + "》正在运行中";
                    Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                            ? new Notification.Builder(MainActivity.this, CH_RUN)
                            : new Notification.Builder(MainActivity.this);
                    b.setSmallIcon(android.R.drawable.ic_media_play)
                            .setContentTitle(title)
                            .setContentText("下滑通知栏，点「终止运行」结束")
                            .setOngoing(true)
                            .setAutoCancel(false)
                            .setShowWhen(false)
                            .setContentIntent(pi);
                    b.addAction(new Notification.Action.Builder(
                            android.R.drawable.ic_menu_close_clear_cancel, "终止运行", pi).build());
                    Notification n = b.build();
                    // 用户要求：运行中的卡片不许被侧滑划掉、也不许被"全部清除"清掉
                    n.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
                    n.priority = Notification.PRIORITY_LOW;
                    nm.notify(RUN_NOTICE_ID, n);
                } catch (Exception ignore) {}
            }});
        }

        /** 试运行结束（不管是点卡片终止、还是从里面自己退出）：收掉通知卡片 */
        @JavascriptInterface
        public void stopRunNotice() {
            main.post(new Runnable() { @Override public void run() {
                try {
                    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                    if (nm != null) nm.cancel(RUN_NOTICE_ID);
                } catch (Exception ignore) {}
            }});
        }

        /** 通知栏权限是否可用（用户在系统里关了、或首次选了"不用"，这里都会返回 false） */
        @JavascriptInterface
        public boolean notifAllowed() {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm == null) return false;
                if (Build.VERSION.SDK_INT >= 24) return nm.areNotificationsEnabled();
                return true;
            } catch (Exception e) { return true; }
        }

        /** 申请通知栏权限（Android 13+ 弹系统授权框；更低版本直接去设置页） */
        @JavascriptInterface
        public void askNotif() {
            main.post(new Runnable() { @Override public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 33) {
                        requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, REQ_NOTIF);
                    } else {
                        openNotifSettings();
                    }
                } catch (Exception ignore) {}
            }});
        }

        /** 直接跳到本应用的通知设置页（用户把通知关了时，"去设置"按钮走这里） */
        @JavascriptInterface
        public void openNotifSettings() {
            main.post(new Runnable() { @Override public void run() {
                try {
                    Intent it = new Intent();
                    if (Build.VERSION.SDK_INT >= 26) {
                        it.setAction(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        it.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        it.setAction("android.settings.APP_NOTIFICATION_SETTINGS");
                        it.putExtra("app_package", getPackageName());
                        it.putExtra("app_uid", getApplicationInfo().uid);
                    }
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(it);
                } catch (Exception ignore) {}
            }});
        }

        /** 复制文本到系统剪贴板 */
        @JavascriptInterface
        public void copyText(final String text) {
            main.post(new Runnable() { @Override public void run() {
                try {
                    android.content.ClipboardManager cm =
                            (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(
                            android.content.ClipData.newPlainText("FAST", text == null ? "" : text));
                } catch (Exception ignore) {}
            }});
        }

        /** 流式 HTTP：AI 对话用（实现见 MainActivity.startStream） */
        @JavascriptInterface
        public void httpStreamStart(String cbId, String method, String url, String headersJson, String body) {
            MainActivity.this.startStream(cbId, method, url, headersJson, body);
        }
        @JavascriptInterface
        public void httpStreamAbort(String cbId) { MainActivity.this.abortStream(cbId); }
    }

    /** 子线程 HTTP 结果回到 JS（JSON 字符串安全转义） */
    private void postHttpResult(final String cbId, final String json) {
        main.post(new Runnable() { @Override public void run() {
            if (web == null) return;
            String script = "window.__nativeHttpResolve&&window.__nativeHttpResolve("
                    + org.json.JSONObject.quote(cbId) + "," + org.json.JSONObject.quote(json) + ");";
            web.evaluateJavascript(script, null);
        }});
    }

    /* ==================== 流式 HTTP（AI 对话用） ====================
       为什么必须流式：AI 的长回答（尤其是"深度思考"）动辄一两分钟，非流式请求要么被
       读超时掐断（用户真机反馈"稍微复杂一点就 timeout"），要么只能干等到最后才知道结果。
       流式之后：
         · 只要还有数据在来就不会超时 —— 等于不再给回答长度设上限；
         · 思考过程（reasoning_content）可以边生成边显示给用户看。
       回调：每段增量 window.__nativeStreamChunk(id, text)；收尾 window.__nativeStreamEnd(id, json)
       （json 为空串表示正常结束，否则是 {"error":"..."}）。 */
    private final java.util.concurrent.ConcurrentHashMap<String, Thread> streamThreads =
            new java.util.concurrent.ConcurrentHashMap<String, Thread>();
    private final java.util.concurrent.ConcurrentHashMap<String, java.net.HttpURLConnection> streamConns =
            new java.util.concurrent.ConcurrentHashMap<String, java.net.HttpURLConnection>();

    private void postStreamChunk(final String cbId, final String text) {
        if (text == null || text.length() == 0) return;
        main.post(new Runnable() { @Override public void run() {
            if (web == null) return;
            web.evaluateJavascript("window.__nativeStreamChunk&&window.__nativeStreamChunk("
                    + org.json.JSONObject.quote(cbId) + "," + org.json.JSONObject.quote(text) + ");", null);
        }});
    }
    private void postStreamEnd(final String cbId, final String errJson) {
        main.post(new Runnable() { @Override public void run() {
            if (web == null) return;
            web.evaluateJavascript("window.__nativeStreamEnd&&window.__nativeStreamEnd("
                    + org.json.JSONObject.quote(cbId) + "," + org.json.JSONObject.quote(errJson == null ? "" : errJson) + ");", null);
        }});
    }

    /** 流式 HTTP：实现见 NativeBridge.httpStreamStart */
    private void startStream(final String cbId, final String method, final String url,
                            final String headersJson, final String body) {
        if (cbId == null) return;
        Thread old = streamThreads.remove(cbId);
        if (old != null) old.interrupt();
        Thread t = new Thread(new Runnable() { @Override public void run() {
            java.io.OutputStream out = null; java.io.InputStream in = null;
            java.net.HttpURLConnection conn = null;
            StringBuilder pend = new StringBuilder();
            long lastFlush = 0;
            try {
                conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(0);                 // 0 = 不设读超时：长回答不该被掐断
                conn.setRequestProperty("Accept", "text/event-stream");
                conn.setRequestMethod(method == null ? "POST" : method.toUpperCase());
                conn.setDoInput(true);
                org.json.JSONObject headers = (headersJson == null || headersJson.length() == 0)
                        ? new org.json.JSONObject() : new org.json.JSONObject(headersJson);
                java.util.Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = headers.optString(k);
                    if (k != null && v != null) conn.setRequestProperty(k, v);
                }
                if (body != null && body.length() > 0) {
                    conn.setDoOutput(true);
                    out = conn.getOutputStream();
                    out.write(body.getBytes("UTF-8"));
                    out.flush();
                }
                streamConns.put(cbId, conn);
                int code = conn.getResponseCode();
                in = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
                if (code < 200 || code >= 400) {
                    java.io.ByteArrayOutputStream eb = new java.io.ByteArrayOutputStream();
                    if (in != null) { byte[] c = new byte[4096]; int n; while ((n = in.read(c)) > 0) eb.write(c, 0, n); }
                    postStreamEnd(cbId, "{\"error\":" + org.json.JSONObject.quote(
                            "HTTP " + code + " " + new String(eb.toByteArray(), "UTF-8")) + "}");
                    return;
                }
                java.io.BufferedReader rd = new java.io.BufferedReader(
                        new java.io.InputStreamReader(in, "UTF-8"), 8192);
                String line;
                while ((line = rd.readLine()) != null) {
                    if (Thread.currentThread().isInterrupted()) return;
                    if (line.length() == 0) continue;
                    // SSE：只要 data: 后面的内容；多行拼起来交给 JS 解析
                    // 原样把 SSE 行（含 "data:" 前缀）交给 JS 解析 —— 两条通道共用一个解析器
                    pend.append(line).append('\n');
                    long now = System.currentTimeMillis();
                    if (pend.length() > 512 || now - lastFlush > 60) {
                        postStreamChunk(cbId, pend.toString());
                        pend.setLength(0);
                        lastFlush = now;
                    }
                }
                if (pend.length() > 0) postStreamChunk(cbId, pend.toString());
                postStreamEnd(cbId, "");
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "流式请求失败" : e.getMessage();
                if (pend.length() > 0) postStreamChunk(cbId, pend.toString());
                postStreamEnd(cbId, "{\"error\":" + org.json.JSONObject.quote(msg) + "}");
            } finally {
                streamConns.remove(cbId);
                streamThreads.remove(cbId);
                try { if (out != null) out.close(); } catch (Exception ignore) {}
                try { if (in != null) in.close(); } catch (Exception ignore) {}
                try { if (conn != null) conn.disconnect(); } catch (Exception ignore) {}
            }
        }});
        streamThreads.put(cbId, t);
        t.start();
    }

    private void abortStream(final String cbId) {
        if (cbId == null) return;
        java.net.HttpURLConnection conn = streamConns.remove(cbId);
        if (conn != null) { try { conn.disconnect(); } catch (Exception ignore) {} }
        Thread t = streamThreads.remove(cbId);
        if (t != null) t.interrupt();
    }

    /** 把导出的 APK 直接写入公共「下载/fast本地app」目录（用户可见、可用文件管理器直接安装）。 */
    @SuppressWarnings("unused")
    private String persistToDownload(java.io.File src) throws Exception {
        return persistToDownloadAs(src, APK_MIME, PUBLIC_SUBDIR);
    }

    /**
     * 把文件写入公共「下载/<subDir>」目录：用户可见，而且拿到的是系统 Downloads Provider
     * 拥有的 content:// 地址 —— 微信/QQ/安装器读它，都比读我们自建的 FileProvider 稳定。
     * Android10+ 走 MediaStore（免权限），同名先删旧再写新，避免出现 (1) 副本；低版本直接写公共目录。
     * 返回系统 MediaStore 的 content:// 地址；低版本返回 null（调用方需自行兜底）。
     */
    private String persistToDownloadAs(java.io.File src, String mime, String subDir) throws Exception {
        final String fname = src.getName();
        final String rel = "Download/" + subDir;
        byte[] bytes = readFile(src);
        if (Build.VERSION.SDK_INT >= 29) {
            android.content.ContentResolver cr = getContentResolver();
            android.net.Uri base = android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            try {
                android.database.Cursor cur = cr.query(base, new String[]{android.provider.BaseColumns._ID},
                        android.provider.MediaStore.MediaColumns.DISPLAY_NAME + "=? AND "
                                + android.provider.MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                        new String[]{fname, rel + "/"}, null);
                if (cur != null) {
                    while (cur.moveToNext()) {
                        long id = cur.getLong(0);
                        cr.delete(android.content.ContentUris.withAppendedId(base, id), null, null);
                    }
                    cur.close();
                }
            } catch (Exception ignore) {}
            android.content.ContentValues cv = new android.content.ContentValues();
            cv.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fname);
            cv.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, rel);
            cv.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = cr.insert(base, cv);
            if (uri == null) throw new IllegalStateException("无法写入下载目录");
            java.io.OutputStream os = cr.openOutputStream(uri);
            try { os.write(bytes); os.flush(); } finally { os.close(); }
            cv.clear();
            cv.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, cv, null, null);
            // 返回系统 MediaStore 的 content:// 地址：系统 Provider 拥有，安装器可稳定读取
            return uri.toString();
        } else {
            java.io.File dir = new java.io.File(
                    android.os.Environment.getExternalStoragePublicDirectory(
                            android.os.Environment.DIRECTORY_DOWNLOADS), subDir);
            if (!dir.exists()) dir.mkdirs();
            java.io.File dst = new java.io.File(dir, fname);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(dst);
            try { fos.write(bytes); fos.flush(); fos.getFD().sync(); } finally { fos.close(); }
            return null; // API28 及以下走 FileProvider 私有副本安装，避免 file:// 暴露异常
        }
    }

    private static final String APK_MIME = "application/vnd.android.package-archive";

    /**
     * AI 设置的私有存储目录。<b>这里放的是用户的 API Key，属于机密</b>：
     * 已排除出系统云备份（见 res/xml/backup_rules.xml），也绝不进分享的 .fast 文件
     * 或导出的 APK —— 否则用户分享一次作品就把自己的密钥送出去了。
     */
    private static final String AI_DIR = "secret";
    private static final String AI_KEY_FILE = "ai_key.txt";

    /**
     * 公共存储里存放作品文件/安装包的目录名：Download/&lt;这个&gt;。
     * 用中文名是为了让用户在系统文件管理里一眼就能找到（原来是 "FAST"，混在一堆英文目录里不好认）。
     */
    private static final String PUBLIC_SUBDIR = "fast本地app";

    /**
     * 用来把上面那个目录"撑"出来的说明文件（安卓不允许 App 直接建空目录，必须写文件）。
     * 名字以下划线开头：一是排在目录最前面好认，二是明确标出"这不是作品"——
     * 导入时文件选择框会列出一堆文件，别让用户误点它。
     */
    private static final String PUBLIC_README_NAME = "_FAST说明.txt";
    private static final String PUBLIC_README_TEXT =
            "【这不是作品文件，别选它】\n\n"
          + "这个文件夹是 FAST 用来放东西的：\n"
          + "· 分享给别人的作品 —— .fast 文件\n"
          + "· 导出的 App 安装包 —— .apk 文件\n\n"
          + "在 FAST 首页点「导入作品」时，请选 .fast 结尾的作品文件。\n"
          + "（这个说明文件可以删掉，删了不影响使用。）\n";

    /** 调起系统安装器，并向所有可处理安装的包显式授予该 Uri 读权限（跨进程授权，兼容 ColorOS 等） */
    private void launchInstaller(Uri uri) {
        try {
            Intent probe = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME);
            try {
                java.util.List<android.content.pm.ResolveInfo> targets =
                        getPackageManager().queryIntentActivities(probe,
                                android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
                for (android.content.pm.ResolveInfo ri : targets) {
                    try { grantUriPermission(ri.activityInfo.packageName, uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignore) {}
                }
            } catch (Exception ignore) {}
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(uri, APK_MIME);
            it.addCategory(Intent.CATEGORY_DEFAULT);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(it);
        } catch (Exception e) {
            Toast.makeText(this, "无法调起安装：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /**
     * 用系统分享面板把作品文件（.fast）发出去。
     * 关键兼容（微信/QQ）：
     *  - MIME 用 *\/*（微信文件发送只接受通配类型，application/json 时微信往往不显示或发送失败）；
     *  - 通过 ClipData 携带 Uri，读权限随数据授予最终选中的目标（比仅对枚举结果授权更稳，含微信）；
     *  - 再对所有可接收应用显式授予一次读权限（ColorOS/部分 ROM 需要）。
     */
    /**
     * 组装 &lt;input type=file&gt; 用的选择 Intent。
     *
     * 只接受图片时（选 App 图标）沿用系统默认行为；其余情况（导入别人分享的作品文件）
     * 改用 ACTION_OPEN_DOCUMENT 并把初始目录指到「下载」—— 实测系统会默认停在上次用过的
     * 位置（比如「通话录音」），用户在那里根本找不到刚收到的 .fast 文件。
     * 收到微信/QQ 发来的作品后，用户通常先「保存到手机」，文件就落在「下载」里。
     */
    private Intent buildFileChooserIntent(WebChromeClient.FileChooserParams params) {
        String[] accepts = null;
        try { accepts = params.getAcceptTypes(); } catch (Throwable ignore) {}
        boolean imageOnly = accepts != null && accepts.length > 0;
        if (accepts != null) {
            for (String a : accepts) {
                if (a == null) continue;
                if (!(a.startsWith("image/") || a.endsWith(".png") || a.endsWith(".jpg") || a.endsWith(".jpeg"))) {
                    imageOnly = false;
                    break;
                }
            }
        }
        if (imageOnly) return params.createIntent();

        Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("*/*");
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                // 优先直接打开「下载/fast本地app」——作品文件都在那儿，用户不用再翻。
                // 但这个目录只有在写过至少一个文件之后才会存在，所以先查一下：
                // 不存在就退回「下载」，免得把用户扔进一个不存在的目录导致导航失败。
                String docId = publicDirHasFiles()
                        ? ("primary:Download/" + PUBLIC_SUBDIR)
                        : "primary:Download";
                it.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,
                        android.provider.DocumentsContract.buildDocumentUri(
                                "com.android.externalstorage.documents", docId));
            } catch (Throwable ignore) {}
        }
        return it;
    }

    /** 「下载/fast本地app」里是否已经有文件（决定导入时打开的初始目录） */
    private boolean publicDirHasFiles() {
        if (Build.VERSION.SDK_INT < 29) {
            try {
                java.io.File dir = new java.io.File(
                        android.os.Environment.getExternalStoragePublicDirectory(
                                android.os.Environment.DIRECTORY_DOWNLOADS), PUBLIC_SUBDIR);
                java.io.File[] kids = dir.listFiles();
                return kids != null && kids.length > 0;
            } catch (Throwable ignore) {
                return false;
            }
        }
        try {
            android.database.Cursor cur = getContentResolver().query(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    new String[]{android.provider.BaseColumns._ID},
                    android.provider.MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                    new String[]{"Download/" + PUBLIC_SUBDIR + "/"}, null);
            if (cur != null) {
                try { return cur.getCount() > 0; } finally { cur.close(); }
            }
        } catch (Throwable ignore) {}
        return false;
    }

    /**
     * 保证公共「下载/fast本地app」目录存在，这样用户点「导入作品」时能直接落到作品所在的文件夹。
     *
     * 安卓不给 App 直接创建空目录的权限（MediaStore 只认"写一个文件"），所以这里往里放一个
     * 几十字节的说明文件，既把目录"撑"出来，也顺便告诉用户这文件夹是干嘛的。
     * 目录里已经有东西就什么都不做；整个流程失败也无妨——导入时只是退回打开「下载」。
     */
    private void ensurePublicDir() {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    if (publicDirHasFiles()) return;
                    java.io.File tmp = new java.io.File(getCacheDir(), PUBLIC_README_NAME);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(tmp);
                    try { fos.write(PUBLIC_README_TEXT.getBytes("UTF-8")); fos.flush(); } finally { fos.close(); }
                    try { persistToDownloadAs(tmp, "text/plain", PUBLIC_SUBDIR); }
                    finally { tmp.delete(); }
                } catch (Throwable ignore) {}
            }
        }).start();
    }

    private void launchShare(java.io.File f, String downloadUri) {
        try {
            // 优先用公共「下载/fast本地app」里的系统 MediaStore 地址：微信/QQ 读自建 FileProvider 的
            // content:// 会报「获取资源失败」，读系统 Downloads Provider 的地址则正常。
            // 拿不到（低版本或写入失败）再退回自有 FileProvider。
            Uri uri = null;
            if (downloadUri != null && downloadUri.startsWith("content://")) {
                try { uri = Uri.parse(downloadUri); } catch (Throwable ignore) { uri = null; }
            }
            if (uri == null) uri = SimpleFileProvider.uriFor(f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("*/*");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TITLE, f.getName());
            send.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                send.setClipData(android.content.ClipData.newUri(getContentResolver(), f.getName(), uri));
            } catch (Exception ignore) {}
            int qf = android.content.pm.PackageManager.MATCH_DEFAULT_ONLY;
            try { qf |= android.content.pm.PackageManager.MATCH_ALL; } catch (Throwable ignore) {}
            try {
                java.util.List<android.content.pm.ResolveInfo> targets =
                        getPackageManager().queryIntentActivities(send, qf);
                for (android.content.pm.ResolveInfo ri : targets) {
                    try { grantUriPermission(ri.activityInfo.packageName, uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignore) {}
                }
            } catch (Exception ignore) {}
            Intent chooser = Intent.createChooser(send, "分享 FAST 作品");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(chooser);
        } catch (Exception e) {
            Toast.makeText(this, "无法分享：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** 用系统 DocumentsUI 打开指定 documentId 的目录；失败返回 null 以便逐级兜底 */
    private Intent openDocDir(String documentId) {
        try {
            Uri uri = android.provider.DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents", documentId);
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(uri, android.provider.DocumentsContract.Document.MIME_TYPE_DIR);
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(it);
            return it;
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readFile(java.io.File f) throws Exception {
        java.io.FileInputStream fis = new java.io.FileInputStream(f);
        try {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = fis.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } finally { fis.close(); }
    }

    private void evalJs(final String js) {
        main.post(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
    }

    /**
     * 通知卡片里的「终止运行」被点：把页面从通知栏拉回前台，并回调运行时的结束逻辑。
     * （运行页面里已经没有结束按钮了，这是唯一的结束入口）
     */
    private void handleRunStop(Intent it) {
        if (it == null || !it.getBooleanExtra("stopRun", false)) return;
        it.removeExtra("stopRun");     // 只处理一次，避免旋转/重进时重复触发
        try { if (web != null) evalJs("window.__nativeStopRun&&window.__nativeStopRun()"); } catch (Exception ignore) {}
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(RUN_NOTICE_ID);
        } catch (Exception ignore) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        try { setIntent(intent); } catch (Exception ignore) {}
        handleRunStop(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        try { handleRunStop(getIntent()); } catch (Exception ignore) {}
    }

    /**
     * 读一张图片并按最长边限制缩小（避免整张原图塞进网页）。
     * 用 inJustDecodeBounds 先量尺寸，再按 inSampleSize 采样，手机相册的大图也不会 OOM。
     */
    private android.graphics.Bitmap 从Uri读图(Uri uri, int 最长边) {
        try {
            android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            java.io.InputStream is1 = getContentResolver().openInputStream(uri);
            android.graphics.BitmapFactory.decodeStream(is1, null, o);
            try { if (is1 != null) is1.close(); } catch (Throwable ignore) {}
            int sample = 1;
            int m = Math.max(o.outWidth, o.outHeight);
            while (m / sample > 最长边 * 2) sample *= 2;
            android.graphics.BitmapFactory.Options o2 = new android.graphics.BitmapFactory.Options();
            o2.inSampleSize = sample;
            java.io.InputStream is2 = getContentResolver().openInputStream(uri);
            android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeStream(is2, null, o2);
            try { if (is2 != null) is2.close(); } catch (Throwable ignore) {}
            return bmp;
        } catch (Throwable e) { return null; }
    }

    static String jsStr(String s) {
        if (s == null) return "''";
        StringBuilder sb = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '\'': sb.append("\\'"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append("'").toString();
    }

    /** 系统返回键：先交给运行时处理（页面出栈），运行时不处理再走默认 */
    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript(
                "(function(){try{return window.__rtSystemBack?window.__rtSystemBack():'false';}catch(e){return 'false';}})();",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) {
                        if (!"true".equals(value)) MainActivity.super.onBackPressed();
                    }
                });
        } else super.onBackPressed();
    }
}
