// FAST 电脑版外壳（WebView2）—— 只有几 MB，复用 Windows 自带的 WebView2 内核。
//
// 为什么不像以前那样用 Electron：Electron 会把整个 Chromium 打进包里（238MB 的主程序），
// 用户要求"体积小"，所以换成系统自带内核 + 本地只读 HTTP 服务。
//
// 关键点：**端口和地址必须保持 http://127.0.0.1:18731**。
// 本地存储（localStorage）是按"源"隔离的，源一变就等于换空库，用户的作品会"消失"。
// 所以这里用 TcpListener 自己写一个极简 HTTP 服务（不用 HttpListener，那个对非 localhost 前缀要 ACL）。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FastDesktop
{
    internal static class Program
    {
        private const int PORT = 18731;
        private static readonly int[] FallbackPorts = { 18731, 18732, 18733 };
        private static MiniServer _server;

        [STAThread]
        private static void Main()
        {
            // 单实例：第二次双击时，把已运行的窗口拉到前台（不重复起服务）
            bool created;
            var mutex = new Mutex(true, "FAST.Desktop.SingleInstance", out created);
            if (!created)
            {
                MessageBox.Show("FAST 已经在运行了，去任务栏找一下它的窗口。", "FAST",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www");
            int port;
            try
            {
                port = StartServer(root);
            }
            catch (Exception ex)
            {
                MessageBox.Show("本地服务启动失败：\r\n" + ex.Message, "FAST 打不开",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (port != PORT)
            {
                MessageBox.Show(
                    "端口 " + PORT + " 被占用，已临时改用 " + port + "。\r\n\r\n" +
                    "这个端口下看不到原来在 " + PORT + " 上的作品。建议关掉占用端口的程序后重开 FAST。",
                    "FAST", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }

            try
            {
                Application.Run(new MainForm(port));
            }
            finally
            {
                try { if (_server != null) _server.Stop(); } catch { }
                GC.KeepAlive(mutex);
            }
        }

        private static int StartServer(string root)
        {
            Exception last = null;
            foreach (var p in FallbackPorts)
            {
                try
                {
                    _server = new MiniServer(root, p);
                    _server.Start();
                    return p;
                }
                catch (Exception e) { last = e; }
            }
            throw last ?? new Exception("18731/18732/18733 都被占用");
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 _wv;
        private readonly string _url;
        private string _seedJson;      // 旧壳导出的作品库（只有第一次启动且本地为空时才写进去）
        private bool _seeded;

        /* 电脑版的原生桥：编辑器只认 window.Native（手机端是 Android 注入的），
           这里补上导出 APK / 打开导出目录两个能力，页面就不用再退回"只导 .fast"。 */
        private const string NativeShim =
            "(function(){try{window.Native=window.Native||{};" +
            "window.Native.exportApk=function(json,appName,orientation,icon,version){try{" +
            "chrome.webview.postMessage({type:'exportApk',json:String(json||''),appName:String(appName||'')," +
            "orientation:String(orientation||'portrait'),icon:String(icon||''),version:String(version||'')});" +
            "}catch(e){}};" +
            "window.Native.openExportFolder=function(path){try{" +
            "chrome.webview.postMessage({type:'openExportFolder',path:String(path||'')});}catch(e){}};" +
            "}catch(e){}})();";

        /// <summary>把字符串安全地拼进 ExecuteScriptAsync（路径里可能有反斜杠/引号）</summary>
        private static string JsStr(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (var c in s ?? "")
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == '\u2028' || c == '\u2029')
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        /// <summary>
        /// 清掉还占着 FAST 专用 WebView2 缓存目录的残留进程。
        /// 为什么需要：WebView2 的数据目录是"独占"的，上次异常退出/被强杀后，
        /// msedgewebview2.exe 可能还活着，再启动就会报 0x800700AA「请求的资源在使用中」，
        /// 用户看到的就是"双击弹个错误框"。
        /// 只杀命令行里带 FAST\WebView2 的那些，绝不误伤系统里其它用 WebView2 的程序。
        /// </summary>
        internal static int 清理残留()
        {
            int killed = 0;
            try
            {
                var key = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FAST", "WebView2");
                using (var searcher = new System.Management.ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedgewebview2.exe'"))
                {
                    foreach (var o in searcher.Get())
                    {
                        var cl = (string)o["CommandLine"] ?? "";
                        if (!cl.Contains(key)) continue;
                        try
                        {
                            var pid = (int)(uint)o["ProcessId"];
                            System.Diagnostics.Process.GetProcessById(pid).Kill();
                            killed++;
                        }
                        catch { }
                    }
                }
            }
            catch (Exception e) { Log("cleanup failed " + e.Message); }
            if (killed > 0) Log("killed stale webview2 processes: " + killed);
            return killed;
        }

        /// <summary>外壳自己的启动日志（排查"打不开/作品没搬过来"用）</summary>
        internal static void Log(string s)
        {
            try
            {
                var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FAST", "shell.log");
                Directory.CreateDirectory(Path.GetDirectoryName(p));
                File.AppendAllText(p, DateTime.Now.ToString("s") + " " + s + "\r\n", Encoding.UTF8);
            }
            catch { }
        }

        public MainForm(int port)
        {
            Text = "FAST";
            Width = 1366; Height = 820;
            MinimumSize = new Size(1000, 560);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0xFE, 0xF7, 0xFF);
            _url = "http://127.0.0.1:" + port + "/editor.html?desk=1";

            _wv = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(_wv);

            Shown += async (s, e) =>
            {
                try
                {
                    Log("init webview2...");
                    // 换壳后浏览器配置目录变了（Electron 的 profile ≠ WebView2 的 profile），
                    // 先把旧壳导出的作品库读进内存，等下在页面加载完成后写一次。
                    var seed = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "seed-projects.json");
                    try
                    {
                        _seedJson = File.Exists(seed) ? File.ReadAllText(seed, Encoding.UTF8).Trim() : null;
                        Log(_seedJson != null ? "seed loaded bytes=" + _seedJson.Length : "no seed file");
                    }
                    catch (Exception ee) { Log("seed read failed " + ee.Message); }

                    // WebView2 的缓存目录放用户目录，别写在程序目录里（程序目录可能只读）
                    var dataDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FAST", "WebView2");
                    Directory.CreateDirectory(dataDir);
                    var env = default(CoreWebView2Environment);
                    Exception last = null;
                    for (int attempt = 0; attempt < 3 && env == null; attempt++)
                    {
                        try { env = await CoreWebView2Environment.CreateAsync(null, dataDir); }
                        catch (Exception ee)
                        {
                            last = ee;
                            Log("create env attempt " + attempt + " failed: " + ee.Message);
                            清理残留();
                            await System.Threading.Tasks.Task.Delay(1200);
                        }
                    }
                    if (env == null) throw last ?? new Exception("WebView2 初始化失败");
                    await _wv.EnsureCoreWebView2Async(env);
                    Log("webview2 ready");
                    await _wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(NativeShim);
                    Log("native bridge ready");

                    /* 检查更新下载：固定存到 %LOCALAPPDATA%\FAST\updates，并记下路径。
                       下次点「下载并安装」时 JS 发 openUpdate 消息，这里直接把已下载的安装包打开，
                       不再重复下载（用户 2026-10-31 要求）。 */
                    _wv.CoreWebView2.DownloadStarting += (s, e) =>
                    {
                        try
                        {
                            var updDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FAST", "updates");
                            Directory.CreateDirectory(updDir);
                            var orig = e.ResultFilePath;
                            var name = string.IsNullOrEmpty(orig) ? "" : Path.GetFileName(orig);
                            if (string.IsNullOrEmpty(name)) name = "FAST_Setup_latest.exe";
                            var full = Path.Combine(updDir, name);
                            e.ResultFilePath = full;
                            e.DownloadOperation.StateChanged += (o, a) =>
                            {
                                try
                                {
                                    if (e.DownloadOperation.State.ToString() == "Completed")
                                    {
                                        File.WriteAllText(Path.Combine(updDir, "last.txt"), full);
                                        var esc = full.Replace("\\", "\\\\").Replace("'", "\\'");
                                        _wv.CoreWebView2.ExecuteScriptAsync(
                                            "window.__updateDownloaded && window.__updateDownloaded('" + esc + "')");
                                    }
                                }
                                catch { }
                            };
                        }
                        catch (Exception ee) { Log("download handler " + ee.Message); }
                    };
                    _wv.CoreWebView2.WebMessageReceived += async (s, e) =>
                    {
                        try
                        {
                            var msg = e.WebMessageAsJson ?? "";
                            var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
                            var m = ser.Deserialize<Dictionary<string, object>>(msg) ?? new Dictionary<string, object>();
                            var type = m.ContainsKey("type") ? Convert.ToString(m["type"]) : "";
                            if (type.Length == 0 && msg.IndexOf("openUpdate", StringComparison.OrdinalIgnoreCase) >= 0)
                                type = "openUpdate";

                            if (type == "openUpdate")
                            {
                                var updDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FAST", "updates");
                                var last = Path.Combine(updDir, "last.txt");
                                if (!File.Exists(last)) return;
                                var p = File.ReadAllText(last).Trim();
                                if (File.Exists(p)) Process.Start(new ProcessStartInfo(p) { UseShellExecute = true });
                                return;
                            }
                            if (type == "openExportFolder")
                            {
                                var path = m.ContainsKey("path") ? Convert.ToString(m["path"]) : "";
                                if (!string.IsNullOrEmpty(path) && File.Exists(path))
                                    Process.Start("explorer.exe", "/select,\"" + path + "\"");
                                return;
                            }
                            if (type == "exportApk")
                            {
                                var json = m.ContainsKey("json") ? Convert.ToString(m["json"]) : "";
                                var appName = m.ContainsKey("appName") ? Convert.ToString(m["appName"]) : "";
                                var orientation = m.ContainsKey("orientation") ? Convert.ToString(m["orientation"]) : "";
                                var icon = m.ContainsKey("icon") ? Convert.ToString(m["icon"]) : "";
                                var version = m.ContainsKey("version") ? Convert.ToString(m["version"]) : "";
                                try
                                {
                                    var packDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "pack");
                                    var outPath = await System.Threading.Tasks.Task.Run(
                                        () => ApkPackager.Export(packDir, json, appName, orientation, icon, version));
                                    await _wv.CoreWebView2.ExecuteScriptAsync(
                                        "window.EditorApp && EditorApp.onExportResult(true," + JsStr(outPath) + ",'','')");
                                    Log("export apk ok " + outPath);
                                }
                                catch (Exception ex)
                                {
                                    Log("export apk failed " + ex);
                                    await _wv.CoreWebView2.ExecuteScriptAsync(
                                        "window.EditorApp && EditorApp.onExportResult(false,''," + JsStr(ex.Message) + ",'')");
                                }
                                return;
                            }
                        }
                        catch (Exception ee) { Log("message handler " + ee.Message); }
                    };

                    _wv.CoreWebView2.NavigationCompleted += async (a, b) =>
                    {
                        try
                        {
                            Log("navigation completed ok=" + b.IsSuccess + " " + _wv.CoreWebView2.Source);
                            var r = await _wv.CoreWebView2.ExecuteScriptAsync(
                                "(function(){try{var s=JSON.parse(localStorage.getItem('__bb_projects_v2')||'null');" +
                                "return s&&s.items?s.items.length:-1}catch(e){return -2}})()");
                            Log("local projects = " + r);

                            // 第一次启动且本地库是空的 → 把旧壳的作品写进去，再刷新一次让页面读到。
                            // （不在 document-created 阶段注入：实测那边写进去会被页面自己的初始化覆盖掉）
                            if (!_seeded && r == "0" && _seedJson != null)
                            {
                                _seeded = true;
                                // ⚠️ setItem 只接受字符串：种子是 JSON 文本，必须 JSON.stringify 再写，
                                // 直接塞对象会被存成 "[object Object]"，页面 JSON.parse 失败 → 又变回空库（踩过）
                                var set = "(function(){try{localStorage.setItem('__bb_projects_v2',JSON.stringify(" + _seedJson +
                                          "));return 'ok'}catch(e){return 'err:'+e.message}})()";
                                var sr = await _wv.CoreWebView2.ExecuteScriptAsync(set);
                                Log("seed write -> " + sr);
                                var chk = await _wv.CoreWebView2.ExecuteScriptAsync(
                                    "(function(){try{var t=localStorage.getItem('__bb_projects_v2');var s=JSON.parse(t);" +
                                    "return 'len='+t.length+' items='+(s&&s.items?s.items.length:'none')}catch(e){return 'ERR '+e.message}})()");
                                Log("after write: " + chk);
                                await _wv.CoreWebView2.ExecuteScriptAsync("location.reload()");
                            }
                        }
                        catch (Exception ee) { Log("nav handler error " + ee.Message); }
                    };

                    _wv.CoreWebView2.Navigate(_url);
                }
                catch (Exception ex)
                {
                    Log("init failed " + ex.Message);
                    MessageBox.Show(
                        "加载编辑器失败：\r\n" + ex.Message +
                        "\r\n\r\n如果提示「请求的资源在使用中」，说明上一次 FAST 的进程没退干净，" +
                        "等几秒再双击一次 FAST.exe 就行（程序会自动清理残留）。\r\n" +
                        "如果提示缺少 WebView2 运行时，请安装 Microsoft Edge WebView2 Runtime 后重试。",
                        "FAST", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };
        }
    }

    /// <summary>
    /// 极简只读 HTTP 服务：只处理 GET/HEAD，只发 www 目录里的文件。
    /// 用 TcpListener 是为了绑 127.0.0.1:18731 不需要任何 URL ACL（HttpListener 需要）。
    /// </summary>
    internal sealed class MiniServer
    {
        private readonly string _root;
        private readonly TcpListener _listener;
        private volatile bool _stopped;
        private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js", "application/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".svg", "image/svg+xml" },
            { ".png", "image/png" },
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".gif", "image/gif" },
            { ".mp3", "audio/mpeg" },
            { ".ogg", "audio/ogg" },
            { ".wav", "audio/wav" },
            { ".ico", "image/x-icon" },
            { ".woff2", "font/woff2" },
            { ".ttf", "font/ttf" },
            { ".apk", "application/octet-stream" }
        };

        public MiniServer(string root, int port)
        {
            _root = Path.GetFullPath(root);
            _listener = new TcpListener(IPAddress.Loopback, port);
        }

        public void Start()
        {
            _listener.Start();
            var th = new Thread(AcceptLoop) { IsBackground = true };
            th.Start();
        }

        public void Stop()
        {
            _stopped = true;
            try { _listener.Stop(); } catch { }
        }

        private void AcceptLoop()
        {
            while (!_stopped)
            {
                TcpClient client;
                try { client = _listener.AcceptTcpClient(); }
                catch { if (_stopped) return; continue; }
                ThreadPool.QueueUserWorkItem(_ => Handle(client));
            }
        }

        private void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    var stream = client.GetStream();
                    stream.ReadTimeout = 5000;
                    var head = ReadHead(stream);
                    if (head == null) return;
                    var firstLine = head.Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
                    var parts = firstLine.Split(' ');
                    if (parts.Length < 2) return;
                    var method = parts[0].ToUpperInvariant();
                    var rawPath = parts[1];
                    var q = rawPath.IndexOf('?');
                    if (q >= 0) rawPath = rawPath.Substring(0, q);
                    var rel = Uri.UnescapeDataString(rawPath).TrimStart('/');
                    if (rel.Length == 0) rel = "editor.html";
                    var full = Path.GetFullPath(Path.Combine(_root, rel));

                    bool ok = full.StartsWith(_root, StringComparison.OrdinalIgnoreCase)
                              && File.Exists(full);
                    if (!ok)
                    {
                        Write(stream, method, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("404"));
                        return;
                    }
                    var ext = Path.GetExtension(full);
                    var type = Mime.ContainsKey(ext) ? Mime[ext] : "application/octet-stream";
                    var bytes = File.ReadAllBytes(full);
                    Write(stream, method, 200, type, bytes);
                }
                catch { }
            }
        }

        private static string ReadHead(NetworkStream stream)
        {
            var sb = new StringBuilder();
            var buf = new byte[4096];
            int total = 0;
            while (total < 8192)
            {
                int n = stream.Read(buf, 0, buf.Length);
                if (n <= 0) break;
                total += n;
                sb.Append(Encoding.ASCII.GetString(buf, 0, n));
                var s = sb.ToString();
                if (s.Contains("\r\n\r\n")) return s;
            }
            return sb.Length > 0 ? sb.ToString() : null;
        }

        private static void Write(NetworkStream stream, string method, int code, string type, byte[] body)
        {
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(code == 200 ? "OK" : "Not Found").Append("\r\n");
            sb.Append("Content-Type: ").Append(type).Append("\r\n");
            sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            sb.Append("Cache-Control: no-store\r\n");
            sb.Append("Connection: close\r\n\r\n");
            var head = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(head, 0, head.Length);
            if (method != "HEAD") stream.Write(body, 0, body.Length);
            stream.Flush();
        }
    }
}
