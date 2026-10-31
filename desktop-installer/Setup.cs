// FAST 电脑版安装/升级向导（用户 2026-10-31：要有安装向导，看起来更专业）
//
// 仍然沿用原来"自带整套程序、原地替换"的思路：
//   payload.zip（FAST.exe + www + WebView2 dll + runtimes + pack）以资源形式内嵌进本 exe，
//   升级只替换安装目录里的程序文件，绝不碰作品数据（作品和缓存都在 %APPDATA%\FAST）。
//
// 目标目录的判定顺序：
//   1) 环境变量 FAST_INSTALL_DIR（自动化测试用；设了就不写注册表、不建快捷方式）
//   2) HKCU\Software\FAST 的 InstallDir（安装包自己写进去的）
//   3) 桌面上的 FAST.lnk 指向哪个目录（老版本是手工装的，没有注册表键）
//   4) 正在运行的 FAST.exe 所在目录
//   5) D:\FAST（现网用户的安装位置）
//   6) %LOCALAPPDATA%\FAST（全新安装）
//
// 自动化测试：FAST_SETUP_TEST=1 时完全不弹窗，只写结果文件（保持原有测试链路可用）。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace FastSetup
{
    internal static class Program
    {
        private const string REG_KEY = @"Software\FAST";
        private const string EXE = "FAST.exe";
        private const string APP_TITLE = "FAST 安装向导";

        /// <summary>排查用日志：只在自动化测试（FAST_SETUP_TEST=1）时才写，正常安装不留垃圾文件</summary>
        private static void Trace(string s)
        {
            if (Environment.GetEnvironmentVariable("FAST_SETUP_TEST") != "1") return;
            var line = DateTime.Now.ToString("HH:mm:ss.fff") + "  " + s + "\r\n";
            try { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fast_setup_trace.txt"), line); } catch { }
        }

        [STAThread]
        private static void Main()
        {
            Trace("enter");
            var args = Environment.GetCommandLineArgs();
            bool testArg = false, hasDirArg = false;
            string dirArg = null;
            foreach (var a in args)
            {
                if (a == null) continue;
                if (a.Equals("--test", StringComparison.OrdinalIgnoreCase)) testArg = true;
                if (a.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase))
                {
                    dirArg = a.Substring(6).Trim().Trim('"');
                    hasDirArg = dirArg.Length > 0;
                }
            }
            bool test = testArg || Environment.GetEnvironmentVariable("FAST_SETUP_TEST") == "1";
            string forced = Environment.GetEnvironmentVariable("FAST_INSTALL_DIR");
            if (string.IsNullOrEmpty(forced) && hasDirArg) forced = dirArg;
            Trace("test=" + test + " forced=" + forced);

            if (test)
            {
                SilentInstall(forced);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string dir;
            try { dir = (forced != null && forced.Trim().Length > 0) ? forced.Trim() : FindInstallDir(); }
            catch (Exception ex)
            {
                MessageBox.Show("找不到安装位置：\r\n" + ex.Message, APP_TITLE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Application.Run(new SetupWizard(dir));
        }

        /// <summary>自动化测试链路：原样保留（不弹窗、写结果文件）</summary>
        private static void SilentInstall(string forced)
        {
            string dir;
            try { dir = (forced != null && forced.Trim().Length > 0) ? forced.Trim() : FindInstallDir(); }
            catch (Exception ex) { Fail("找不到安装位置：\r\n" + ex.Message); return; }

            if (!StopFast(dir))
            {
                Fail("FAST 正在运行，文件替换不了。\r\n\r\n请先把 FAST 关掉（任务栏右键 → 关闭窗口），再双击这个安装包。");
                return;
            }

            Trace("dir=" + dir);
            try { Install(dir, null); Trace("install done"); }
            catch (Exception ex) { Fail("安装失败（目标目录：" + dir + "）：\r\n" + ex.Message); return; }

            try
            {
                File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fast_setup_test_result.txt"),
                    "OK " + dir + " files=" + Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Length);
            }
            catch { }
        }

        private static void Fail(string msg)
        {
            LogError(msg);
            if (Environment.GetEnvironmentVariable("FAST_SETUP_TEST") == "1")
            {
                try { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fast_setup_error.txt"), msg); } catch { }
                return;
            }
            MessageBox.Show(msg, APP_TITLE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        /// <summary>把失败原因写到安装包所在目录（仅在非 C 盘时写，遵守不写 C 盘的要求）</summary>
        private static void LogError(string msg)
        {
            try
            {
                var dir = AppDomain.CurrentDomain.BaseDirectory;
                var root = Path.GetPathRoot(dir) ?? "";
                if (root.TrimEnd('\\').Equals("C:", StringComparison.OrdinalIgnoreCase)) return;
                int rid = IntegrityRid();
                var env = "完整性级别=" + (rid == 0 ? "未知" : rid.ToString("X"))
                    + "  管理员=" + (IsAdmin() ? "是" : "否")
                    + "  用户=" + Environment.UserName
                    + "  进程=" + Application.ExecutablePath
                    + "\r\n";
                File.AppendAllText(Path.Combine(dir, "fast_setup_error.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + env + (msg ?? "") + "\r\n");
            }
            catch { }
        }

        /// <summary>当前进程是不是管理员（安装到 D:\ 这类目录、或被杀软拦写时，需要提权重试）</summary>
        private static bool IsAdmin()
        {
            try
            {
                var id = System.Security.Principal.WindowsIdentity.GetCurrent();
                return new System.Security.Principal.WindowsPrincipal(id)
                    .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
            }
            catch { return false; }
        }

        /// <summary>
        /// 当前进程的完整性级别：0x1000 低（IDE/沙箱终端）、0x2000 中（普通双击）、0x3000 高（已提权）。
        /// 低完整性时 IsAdmin() 仍然返回 true，但写 D:\ 会被系统拒绝。
        /// </summary>
        private static int IntegrityRid()
        {
            try
            {
                using (var id = System.Security.Principal.WindowsIdentity.GetCurrent())
                {
                    int len = 0;
                    // TokenIntegrityLevel = 25；第一次调用只为取得所需缓冲区大小（必然返回 false）
                    Native.GetTokenInformation(id.Token, 25, IntPtr.Zero, 0, out len);
                    if (len <= 0) return 0;
                    var buf = System.Runtime.InteropServices.Marshal.AllocHGlobal(len);
                    try
                    {
                        if (!Native.GetTokenInformation(id.Token, 25, buf, len, out len)) return 0;
                        var sid = System.Runtime.InteropServices.Marshal.ReadIntPtr(buf); // TOKEN_MANDATORY_LABEL.Label.Sid
                        int count = System.Runtime.InteropServices.Marshal.ReadByte(Native.GetSidSubAuthorityCount(sid));
                        if (count <= 0) return 0;
                        return System.Runtime.InteropServices.Marshal.ReadInt32(Native.GetSidSubAuthority(sid, count - 1));
                    }
                    finally { System.Runtime.InteropServices.Marshal.FreeHGlobal(buf); }
                }
            }
            catch { return 0; }
        }

        private static class Native
        {
            [System.Runtime.InteropServices.DllImport("advapi32.dll", SetLastError = true)]
            public static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int infoLength, out int returnLength);

            [System.Runtime.InteropServices.DllImport("advapi32.dll")]
            public static extern IntPtr GetSidSubAuthority(IntPtr sid, int index);

            [System.Runtime.InteropServices.DllImport("advapi32.dll")]
            public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
        }

        /// <summary>以管理员身份重新启动安装向导，并带上用户选好的目录</summary>
        private static bool RestartElevated(string dir)
        {
            try
            {
                var psi = new ProcessStartInfo(Application.ExecutablePath)
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    WorkingDirectory = Path.GetDirectoryName(Application.ExecutablePath),
                    Arguments = "--dir=\"" + (dir ?? "").Replace("\"", "") + "\""
                };
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                MessageBox.Show("提权启动失败（可能取消了 UAC 授权）：\r\n" + ex.Message,
                    APP_TITLE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
        }

        /// <summary>目标安装目录</summary>
        private static string FindInstallDir()
        {
            // 0) 正在运行的 FAST.exe 所在目录：用户此刻真正在用的那一份，最可靠
            try
            {
                foreach (var p in Process.GetProcessesByName("FAST"))
                {
                    try
                    {
                        var f = p.MainModule.FileName;
                        if (!string.IsNullOrEmpty(f) && File.Exists(f))
                        {
                            var dd = Path.GetDirectoryName(f);
                            if (HasExe(dd)) return dd;
                        }
                    }
                    catch { }
                }
            }
            catch { }

            string d = null;
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(REG_KEY))
                {
                    if (k != null) d = k.GetValue("InstallDir") as string;
                }
            }
            catch { }
            if (HasExe(d)) return d;

            foreach (var lnk in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FAST.lnk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "FAST.lnk") })
            {
                var t = ReadShortcutTarget(lnk);
                if (t != null && HasExe(Path.GetDirectoryName(t))) return Path.GetDirectoryName(t);
            }

            if (HasExe(@"D:\FAST")) return @"D:\FAST";

            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FAST");
        }

        private static bool HasExe(string dir)
        {
            try { return dir != null && dir.Length > 0 && File.Exists(Path.Combine(dir, EXE)); }
            catch { return false; }
        }

        /// <summary>把正在运行的 FAST（只认目标目录里的那个）关掉</summary>
        private static bool StopFast(string dir)
        {
            var target = Path.GetFullPath(Path.Combine(dir, EXE)).ToLowerInvariant();
            var pids = new List<int>();
            bool any = false;
            foreach (var p in Process.GetProcessesByName("FAST"))
            {
                try
                {
                    string exe = null;
                    try { exe = p.MainModule.FileName; } catch { }
                    if (exe != null && exe.ToLowerInvariant() != target) continue;
                    any = true;
                    pids.Add(p.Id);
                    try { p.CloseMainWindow(); } catch { }
                }
                catch { any = true; }
            }
            if (!any) { 清理WebView2残留(pids); return true; }
            for (int i = 0; i < 12; i++)
            {
                Thread.Sleep(200);
                bool alive = false;
                foreach (var p in Process.GetProcessesByName("FAST"))
                {
                    try
                    {
                        string exe = null;
                        try { exe = p.MainModule.FileName; } catch { }
                        if (exe != null && exe.ToLowerInvariant() != target) continue;
                        alive = true;
                    }
                    catch { alive = true; }
                }
                if (!alive) { 清理WebView2残留(pids); return true; }
            }
            foreach (var p in Process.GetProcessesByName("FAST"))
            {
                try
                {
                    string exe = null;
                    try { exe = p.MainModule.FileName; } catch { }
                    if (exe != null && exe.ToLowerInvariant() != target) continue;
                    p.Kill();
                }
                catch { }
            }
            Thread.Sleep(500);
            清理WebView2残留(pids);
            return true;
        }

        /// <summary>
        /// FAST 的 WebView2 子进程可能比 FAST.exe 活得久，并继续占着 www 里的文件，
        /// 这时把 www 改名会报“访问被拒绝”。按父子关系把它们一起清掉。
        /// </summary>
        private static void 清理WebView2残留(List<int> killed)
        {
            if (killed == null || killed.Count == 0) return;
            try
            {
                var parent = new Dictionary<int, int>();
                var webviews = new List<int>();
                using (var s = new System.Management.ManagementObjectSearcher(
                    "SELECT ProcessId, ParentProcessId, Name FROM Win32_Process"))
                {
                    foreach (var o in s.Get())
                    {
                        int pid = Convert.ToInt32(o["ProcessId"]);
                        parent[pid] = Convert.ToInt32(o["ParentProcessId"]);
                        if (string.Equals(o["Name"] as string, "msedgewebview2.exe", StringComparison.OrdinalIgnoreCase))
                            webviews.Add(pid);
                    }
                }
                foreach (var pid in webviews)
                {
                    int cur = pid;
                    bool 属于目标 = false;
                    for (int d = 0; d < 6 && cur > 0; d++)
                    {
                        cur = parent.ContainsKey(cur) ? parent[cur] : 0;
                        if (killed.Contains(cur)) { 属于目标 = true; break; }
                    }
                    if (!属于目标) continue;
                    try { Process.GetProcessById(pid).Kill(); } catch { }
                }
                Thread.Sleep(600);
            }
            catch { }
        }

        /// <summary>
        /// 选一个能写的临时目录。顺序：
        ///   1) 安装目录内（同盘移动最快）
        ///   2) 安装包自己所在目录（这个目录一定是能读能执行的位置，通常也可写）
        ///   3) 安装盘根目录
        ///   4) %LOCALAPPDATA%\FAST\setup_tmp（最后兜底）
        /// </summary>
        private static string 准备临时目录(string dir, out bool 在目标内)
        {
            在目标内 = true;
            Exception last = null;
            var 候选 = new List<string>();
            foreach (var name in new[] { ".fast_update_tmp", "fast_update_tmp" })
                if (Directory.Exists(dir)) 候选.Add(Path.Combine(dir, name));
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            候选.Add(Path.Combine(baseDir, "fast_setup_tmp"));
            string root = null;
            try { root = Path.GetPathRoot(Path.GetFullPath(dir)); } catch { }
            if (!string.IsNullOrEmpty(root))
                候选.Add(Path.Combine(root, "FAST_setup_tmp"));
            try
            {
                候选.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "FAST", "setup_tmp"));
            }
            catch { }

            for (int i = 0; i < 候选.Count; i++)
            {
                var t = 候选[i];
                try
                {
                    if (i >= 2) t = t + "_" + Guid.NewGuid().ToString("N").Substring(0, 8);
                    if (File.Exists(t)) File.Delete(t);
                    if (Directory.Exists(t)) Directory.Delete(t, true);
                    Directory.CreateDirectory(t);
                    在目标内 = (i == 0 || i == 1);
                    return t;
                }
                catch (Exception e) { last = e; }
            }
            string detail = last == null ? "未知错误" :
                (last.GetType().Name + " 0x" + last.HResult.ToString("X8") + " " + last.Message);
            throw new Exception("无法创建临时目录（目标：" + dir + "）：\r\n" + detail +
                "\r\n用户：" + Environment.UserName + "  管理员：" + (IsAdmin() ? "是" : "否") +
                "  完整性级别：" + (IntegrityRid() == 0 ? "未知" : IntegrityRid().ToString("X")) +
                "\r\n\r\n可以尝试：1) 右键安装包 → 以管理员身份运行；" +
                "2) 换一个安装位置（建议 D 盘）；3) 关闭正在占用该目录的程序后重试。");
        }

        /// <summary>解开内嵌的 payload.zip，替换安装目录里的程序（www 先旧→备份，成功后再删）</summary>
        private static void Install(string dir, Action<int, string> progress)
        {
            Directory.CreateDirectory(dir);
            var temp = 准备临时目录(dir, out bool 在目标内);
            try
            {
                progress?.Invoke(2, "正在准备安装文件…");
                Trace("install: open resource");
                using (var res = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                {
                    Trace("install: resource " + (res == null ? "null" : res.Length.ToString()));
                    if (res == null) throw new Exception("安装包损坏：找不到内嵌的程序数据");
                    using (var zip = new ZipArchive(res, ZipArchiveMode.Read))
                    {
                        var files = 0;
                        foreach (var e in zip.Entries)
                        {
                            if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) continue;
                            if (e.FullName.EndsWith(".pdb", StringComparison.OrdinalIgnoreCase)) continue;
                            files++;
                        }
                        int done = 0;
                        foreach (var e in zip.Entries)
                        {
                            if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) continue;
                            if (e.FullName.EndsWith(".pdb", StringComparison.OrdinalIgnoreCase)) continue;
                            var rel = e.FullName.Replace('/', Path.DirectorySeparatorChar);
                            var dst = Path.Combine(temp, rel);
                            Directory.CreateDirectory(Path.GetDirectoryName(dst));
                            using (var input = e.Open())
                            using (var output = File.Create(dst))
                                input.CopyTo(output);
                            done++;
                            if (progress != null && files > 0)
                                progress(5 + (int)(done * 65.0 / files), "正在解压：" + Path.GetFileName(dst));
                        }
                    }
                }

                progress?.Invoke(72, "正在更新程序文件…");
                var oldWww = Path.Combine(dir, "www.old");
                var newWww = Path.Combine(dir, "www");
                string stage = "准备更新 www";
                try
                {
                    bool 已备份 = false;
                    if (Directory.Exists(newWww))
                    {
                        for (int i = 0; i < 10 && !已备份; i++)
                        {
                            try
                            {
                                if (Directory.Exists(oldWww)) Directory.Delete(oldWww, true);
                                stage = "把旧 www 备份成 www.old";
                                Directory.Move(newWww, oldWww);
                                已备份 = true;
                            }
                            catch { Thread.Sleep(400); } // 有进程短暂占用（杀软扫描、WebView2 句柄未释放）时重试
                        }
                    }

                    if (已备份 || !Directory.Exists(newWww))
                    {
                        stage = "写入新的 www";
                        CopyDir(Path.Combine(temp, "www"), newWww);
                    }
                    else
                    {
                        // 旧 www 实在改不了名（有文件被占用），那就原地覆盖程序文件
                        stage = "原地覆盖 www（旧目录被占用）";
                        CopyDir(Path.Combine(temp, "www"), newWww);
                    }

                    progress?.Invoke(88, "正在更新运行库…");
                    stage = "更新程序文件";
                    foreach (var f in Directory.GetFiles(temp, "*", SearchOption.TopDirectoryOnly))
                    {
                        File.Copy(f, Path.Combine(dir, Path.GetFileName(f)), true);
                    }
                    stage = "更新运行库";
                    CopyDir(Path.Combine(temp, "runtimes"), Path.Combine(dir, "runtimes"));
                    // pack（导出 APK 用的运行时壳）：老安装包漏了这一步，全新安装后导出会失败
                    stage = "更新打包壳";
                    CopyDir(Path.Combine(temp, "pack"), Path.Combine(dir, "pack"));
                }
                catch (Exception ex)
                {
                    // 尽力回滚 www，避免留一个半新半旧的目录
                    try { if (Directory.Exists(oldWww)) { if (Directory.Exists(newWww)) Directory.Delete(newWww, true); Directory.Move(oldWww, newWww); } } catch { }
                    throw new Exception("无法写入安装目录：" + dir +
                        "\r\n失败步骤：" + stage +
                        "\r\n可能是权限不足、文件被占用或磁盘异常。" +
                        "\r\n请右键安装包 → 以管理员身份运行，或换一个安装位置后重试。" +
                        "\r\n\r\n详细信息：" + ex.Message);
                }
                if (Directory.Exists(oldWww)) { try { Directory.Delete(oldWww, true); } catch { } }
                progress?.Invoke(100, "安装完成");
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch { }
            }
        }

        private static void CopyDir(string src, string dst)
        {
            if (!Directory.Exists(src)) return;
            Directory.CreateDirectory(dst);
            foreach (var d in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
            {
                Directory.CreateDirectory(Path.Combine(dst, Rel(src, d)));
            }
            foreach (var f in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                var to = Path.Combine(dst, Rel(src, f));
                Directory.CreateDirectory(Path.GetDirectoryName(to));
                File.Copy(f, to, true);
            }
        }
        private static string Rel(string root, string p)
        {
            return p.Substring(root.TrimEnd(Path.DirectorySeparatorChar).Length + 1);
        }

        private static string ReadShortcutTarget(string lnk)
        {
            try
            {
                if (!File.Exists(lnk)) return null;
                var t = Type.GetTypeFromProgID("WScript.Shell");
                if (t == null) return null;
                var sh = Activator.CreateInstance(t);
                var sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
                var target = sc.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, sc, null) as string;
                return target;
            }
            catch { return null; }
        }

        private static void MakeShortcut(string dir)
        {
            var exe = Path.Combine(dir, EXE);
            var lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FAST.lnk");
            var t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) return;
            var sh = Activator.CreateInstance(t);
            var sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            sc.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { exe });
            sc.GetType().InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { dir });
            sc.GetType().InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { exe + ",0" });
            sc.GetType().InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "FAST 积木编程" });
            sc.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        /// <summary>
        /// 安装向导：欢迎 → 选择位置 → 安装进度 → 完成。
        /// 纯 WinForms，自绘配色，不依赖任何第三方组件。
        /// </summary>
        private sealed class SetupWizard : Form
        {
            private static readonly Color Ink = Color.FromArgb(29, 27, 32);
            private static readonly Color Muted = Color.FromArgb(121, 116, 126);
            private static readonly Color Accent = Color.FromArgb(101, 85, 143);
            private static readonly Color PageBg = Color.White;
            private static readonly Color Line = Color.FromArgb(231, 227, 233);

            private readonly string _dir;
            private readonly Panel _page0, _page1, _page2, _page3;
            private readonly Button _back, _next, _cancel;
            private readonly TextBox _path;
            private readonly Label _disk;
            private readonly Label _status;
            private readonly ProgressBar _bar;
            private readonly CheckBox _launch;
            private readonly Label _donePath;
            private int _page;

            public SetupWizard(string dir)
            {
                _dir = dir;
                Text = APP_TITLE;
                StartPosition = FormStartPosition.CenterScreen;
                FormBorderStyle = FormBorderStyle.FixedDialog;
                MaximizeBox = false; MinimizeBox = false;
                ClientSize = new Size(620, 440);
                BackColor = PageBg;
                Font = new Font("Segoe UI", 9f);
                AutoScaleMode = AutoScaleMode.Dpi;

                // ---- 顶部标题区 ----
                var head = new Panel { Dock = DockStyle.Top, Height = 92, BackColor = Ink };
                var ver = Assembly.GetExecutingAssembly().GetName().Version;
                var vtext = "版本 " + ver.Major + "." + ver.Minor + "." + ver.Build;
                var title = new Label
                {
                    Text = "FAST", ForeColor = Color.White, BackColor = Color.Transparent,
                    Font = new Font("Segoe UI", 26f, FontStyle.Bold),
                    AutoSize = true, Left = 28, Top = 16
                };
                var sub = new Label
                {
                    Text = "积木式编程 · 桌面版安装向导", ForeColor = Color.FromArgb(202, 196, 208),
                    BackColor = Color.Transparent, Font = new Font("Segoe UI", 10f),
                    AutoSize = true, Left = 31, Top = 58
                };
                var vlab = new Label
                {
                    Text = vtext, ForeColor = Color.FromArgb(202, 196, 208),
                    BackColor = Color.Transparent, Font = new Font("Segoe UI", 9f),
                    AutoSize = true, Left = 520, Top = 62
                };
                head.Controls.Add(title); head.Controls.Add(sub); head.Controls.Add(vlab);
                Controls.Add(head);

                // ---- 底部按钮区 ----
                var foot = new Panel { Dock = DockStyle.Bottom, Height = 64, BackColor = Color.FromArgb(247, 245, 248) };
                foot.Paint += (s, e) =>
                {
                    e.Graphics.DrawLine(new Pen(Line), 0, 0, foot.Width, 0);
                };
                _back = MakeButton("上一步", false);
                _next = MakeButton("下一步", true);
                _cancel = MakeButton("取消", false);
                _cancel.DialogResult = DialogResult.Cancel;
                _back.Click += (s, e) => ShowPage(_page - 1);
                _next.Click += (s, e) =>
                {
                    if (_page == 0) ShowPage(1);
                    else if (_page == 1) StartInstall();
                    else if (_page == 3) FinishClick();
                };
                _cancel.Click += (s, e) => Close();
                foot.Controls.Add(_back); foot.Controls.Add(_next); foot.Controls.Add(_cancel);
                Controls.Add(foot);
                PositionFoot(foot);
                foot.Resize += (s, e) => PositionFoot(foot);

                // ---- 页面 0：欢迎 ----
                _page0 = NewPage();
                AddTitle(_page0, "欢迎使用 FAST 安装向导");
                AddBody(_page0, "这个向导会帮你把 FAST 安装到电脑上；如果是升级，会保留你已有的作品和设置。", 62);
                AddCheckItem(_page0, "自动识别已安装的位置，升级时原地替换程序文件", 96);
                AddCheckItem(_page0, "安装前会自动关闭正在运行的 FAST", 126);
                AddCheckItem(_page0, "不会动作品数据（作品保存在用户目录，和安装位置无关）", 156);
                AddBody(_page0, "安装位置：" + _dir, 200, true);
                Controls.Add(_page0);

                // ---- 页面 1：选择位置 ----
                _page1 = NewPage();
                AddTitle(_page1, "选择安装位置");
                AddBody(_page1, "将 FAST 安装到下面的文件夹：", 62);
                _path = new TextBox
                {
                    Left = 34, Top = 90, Width = 440, Height = 28,
                    Text = _dir, Font = new Font("Segoe UI", 10f),
                    BorderStyle = BorderStyle.FixedSingle
                };
                var browse = MakeButton("浏览…", false);
                browse.Left = 484; browse.Top = 88; browse.Width = 88;
                browse.Click += (s, e) => BrowseFolder();
                _disk = new Label
                {
                    Left = 34, Top = 128, Width = 540, AutoSize = false, Height = 22,
                    ForeColor = Muted, Text = DiskText(_dir), BackColor = PageBg
                };
                var tip = new Label
                {
                    Left = 34, Top = 164, Width = 540, Height = 54, AutoSize = false,
                    ForeColor = Muted, BackColor = PageBg,
                    Text = "提示：升级安装请保持和当前 FAST 相同的目录，这样程序文件会被直接替换，作品数据不受影响。"
                };
                _page1.Controls.Add(_path); _page1.Controls.Add(browse);
                _page1.Controls.Add(_disk); _page1.Controls.Add(tip);
                Controls.Add(_page1);

                // ---- 页面 2：安装进度 ----
                _page2 = NewPage();
                AddTitle(_page2, "正在安装");
                AddBody(_page2, "请稍候，向导正在把 FAST 安装到你的电脑上。", 62);
                _bar = new ProgressBar
                {
                    Left = 34, Top = 92, Width = 538, Height = 18,
                    Style = ProgressBarStyle.Continuous, Minimum = 0, Maximum = 100
                };
                _status = new Label
                {
                    Left = 34, Top = 122, Width = 538, Height = 24, AutoSize = false,
                    ForeColor = Muted, BackColor = PageBg, Text = "正在准备…"
                };
                _page2.Controls.Add(_bar); _page2.Controls.Add(_status);
                Controls.Add(_page2);

                // ---- 页面 3：完成 ----
                _page3 = NewPage();
                AddTitle(_page3, "安装完成");
                AddBody(_page3, "FAST 已经成功安装到：", 62);
                _donePath = new Label
                {
                    Left = 34, Top = 96, Width = 538, Height = 44, AutoSize = false,
                    ForeColor = Ink, BackColor = PageBg, Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                    Text = _dir
                };
                _launch = new CheckBox
                {
                    Left = 34, Top = 142, Width = 480, Height = 26,
                    Text = "立即启动 FAST", Checked = true, BackColor = PageBg
                };
                _page3.Controls.Add(_donePath); _page3.Controls.Add(_launch);
                Controls.Add(_page3);

                ShowPage(0);
            }

            private static Button MakeButton(string text, bool primary)
            {
                var b = new Button
                {
                    Text = text, Width = 96, Height = 34, FlatStyle = FlatStyle.Flat,
                    BackColor = primary ? Accent : Color.White,
                    ForeColor = primary ? Color.White : Ink,
                    Font = new Font("Segoe UI", 9.5f, primary ? FontStyle.Bold : FontStyle.Regular),
                    Cursor = Cursors.Hand
                };
                b.FlatAppearance.BorderSize = primary ? 0 : 1;
                b.FlatAppearance.BorderColor = Line;
                return b;
            }

            private void PositionFoot(Panel foot)
            {
                // 右下角三个按钮：取消 / 上一步 / 下一步（右对齐）
                int right = foot.Width - 20;
                _next.Left = right - _next.Width; right = _next.Left - 8;
                _back.Left = right - _back.Width; right = _back.Left - 8;
                _cancel.Left = right - _cancel.Width;
                _next.Top = _back.Top = _cancel.Top = 15;
            }

            private Panel NewPage()
            {
                return new Panel { Dock = DockStyle.Fill, BackColor = PageBg, Visible = false, Padding = new Padding(0) };
            }

            private static void AddTitle(Panel p, string text)
            {
                p.Controls.Add(new Label
                {
                    Text = text, Left = 34, Top = 20, AutoSize = true,
                    Font = new Font("Segoe UI", 15f, FontStyle.Bold), ForeColor = Ink, BackColor = PageBg
                });
            }

            private static void AddBody(Panel p, string text, int top, bool mono = false)
            {
                p.Controls.Add(new Label
                {
                    Text = text, Left = 34, Top = top, Width = 540, Height = 24, AutoSize = false,
                    ForeColor = Ink, BackColor = PageBg,
                    Font = mono ? new Font("Consolas", 9.5f) : new Font("Segoe UI", 10f)
                });
            }

            private static void AddCheckItem(Panel p, string text, int top)
            {
                p.Controls.Add(new Label
                {
                    Text = "✓  " + text, Left = 40, Top = top, Width = 540, Height = 24, AutoSize = false,
                    ForeColor = Muted, BackColor = PageBg
                });
            }

            private static string DiskText(string dir)
            {
                try
                {
                    var root = Path.GetPathRoot(Path.GetFullPath(dir));
                    var d = new DriveInfo(root);
                    return "磁盘可用空间：" + (d.AvailableFreeSpace / 1024.0 / 1024.0 / 1024.0).ToString("0.0") + " GB（需要约 30 MB）";
                }
                catch { return ""; }
            }

            private void BrowseFolder()
            {
                using (var fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "选择 FAST 的安装文件夹";
                    fbd.ShowNewFolderButton = true;
                    try { fbd.SelectedPath = _path.Text; } catch { }
                    if (fbd.ShowDialog(this) == DialogResult.OK)
                    {
                        _path.Text = fbd.SelectedPath;
                        _disk.Text = DiskText(fbd.SelectedPath);
                    }
                }
            }

            private void ShowPage(int i)
            {
                _page = i;
                foreach (var p in new[] { _page0, _page1, _page2, _page3 }) p.Visible = false;
                var cur = i == 0 ? _page0 : i == 1 ? _page1 : i == 2 ? _page2 : _page3;
                cur.Visible = true;
                cur.BringToFront();

                _back.Visible = i == 1;
                _cancel.Visible = i < 2;
                _next.Visible = i != 2;
                _next.Text = i == 3 ? "完成" : (i == 1 ? "安装" : "下一步");
                _bar.Value = 0;
            }

            private void StartInstall()
            {
                var target = (_path.Text ?? "").Trim();
                if (target.Length == 0) { MessageBox.Show(this, "请选择安装位置。", APP_TITLE, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                try { Path.GetFullPath(target); }
                catch (Exception ex) { MessageBox.Show(this, "安装位置不是有效路径：\r\n" + ex.Message, APP_TITLE, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }

                ShowPage(2);
                SetBusy(true);
                string err = null;
                var th = new Thread(() =>
                {
                    try
                    {
                        if (!StopFast(target)) throw new Exception("FAST 正在运行，文件替换不了，请先关闭 FAST 再重试。");
                        Install(target, Report);
                        try { Registry.CurrentUser.CreateSubKey(REG_KEY).SetValue("InstallDir", target); } catch { }
                        try { MakeShortcut(target); } catch { }
                    }
                    catch (Exception ex) { err = ex.Message; }
                    try
                    {
                        BeginInvoke(new Action(() =>
                        {
                            if (err != null)
                            {
                                LogError(err);
                                SetBusy(false);
                                int rid = IntegrityRid();
                                bool low = rid > 0 && rid < 0x2000;
                                string more = low
                                    ? "\r\n\r\n当前进程被系统限制了写入权限（多见于从 IDE 内置终端或沙箱里启动安装包）。" +
                                      "\r\n请关掉本窗口，直接在资源管理器里双击安装包运行。"
                                    : IsAdmin()
                                        ? "\r\n\r\n当前已经是管理员权限。若仍失败，请换一个安装位置（建议 D 盘）后重试。"
                                        : "\r\n\r\n是否以管理员身份重新打开安装向导再试一次？";
                                var r = MessageBox.Show(this, "安装失败：\r\n" + err + more,
                                    APP_TITLE, (low || IsAdmin()) ? MessageBoxButtons.OK : MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                                if (!low && !IsAdmin() && r == DialogResult.Yes)
                                {
                                    if (RestartElevated(target)) { Close(); return; }
                                }
                                ShowPage(1);
                                return;
                            }
                            SetBusy(false); // 安装成功后要恢复按钮，否则"完成"是灰的、点不动
                            _donePath.Text = target;
                            ShowPage(3);
                        }));
                    }
                    catch { }
                });
                th.IsBackground = true;
                th.Start();
            }

            private void Report(int percent, string text)
            {
                try
                {
                    BeginInvoke(new Action(() =>
                    {
                        _bar.Value = Math.Max(0, Math.Min(100, percent));
                        _status.Text = text;
                    }));
                }
                catch { }
            }

            private void SetBusy(bool busy)
            {
                _next.Enabled = !busy; _back.Enabled = !busy; _cancel.Enabled = !busy;
            }

            private void FinishClick()
            {
                if (_launch.Checked)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(Path.Combine(_path.Text.Trim(), EXE)) { WorkingDirectory = _path.Text.Trim() });
                    }
                    catch (Exception ex) { MessageBox.Show(this, "启动失败：\r\n" + ex.Message, APP_TITLE, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
                }
                Close();
            }
        }
    }
}
