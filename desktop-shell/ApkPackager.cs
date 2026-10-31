// 电脑版导出 APK：把内置运行时壳（pack/shell*.apk）复制一份，
// 改写 Manifest 的包名/应用名/版本号、同步 resources.arsc 包名、注入 assets/project.json、
// 可选替换图标，按规范 ZIP 重打包，再做 APK Signature Scheme v2 签名（minSdk 24 起原生支持）。
// 这样电脑版不依赖 JDK / Android SDK，也能在本地直接产出可安装的 APK。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace FastDesktop
{
    internal static class ApkPackager
    {
        private const string OLD_PACKAGE = "com.fast.app.rt.a00000";
        private const string LABEL_ANCHOR = "XXXXXXXXXXXXXXXXXXXX";
        private const string VERSION_ANCHOR = "0.00";
        private const uint SIG_ALG_RSA_PKCS1_SHA256 = 0x0103;
        private const uint V2_BLOCK_ID = 0x7109871a;
        private const string SIGN_PASS = "fast-desktop-device-key";

        public static string Export(string packDir, string projectJson, string appName,
                                   string orientation, string iconDataUrl, string version)
        {
            if (string.IsNullOrEmpty(appName) || appName.Trim().Length == 0) appName = "我的应用";
            appName = appName.Trim();
            if (appName.Length > 20) appName = appName.Substring(0, 20);
            if (string.IsNullOrEmpty(version) || !System.Text.RegularExpressions.Regex.IsMatch(version, "\\d"))
                version = "1.0";
            version = System.Text.RegularExpressions.Regex.Replace(version, "[^0-9.]", "").Trim();
            if (version.Length == 0 || version.Length > 12) version = "1.0";

            string shell = Path.Combine(packDir,
                "landscape".Equals(orientation, StringComparison.OrdinalIgnoreCase) ? "shell-land.apk" : "shell.apk");
            if (!File.Exists(shell)) throw new Exception("缺少运行时壳：" + shell);

            string newPackage = "com.fast.app.rt." + StableSuffix(appName);

            List<string> order; Dictionary<string, byte[]> entries;
            ReadEntries(shell, out order, out entries);

            byte[] manifest;
            if (!entries.TryGetValue("AndroidManifest.xml", out manifest))
                throw new Exception("运行时壳缺少 AndroidManifest.xml");
            var repl = new Dictionary<string, string>
            {
                { OLD_PACKAGE, newPackage },
                { LABEL_ANCHOR, appName },
                { VERSION_ANCHOR, version }
            };
            entries["AndroidManifest.xml"] = AxmlReplace(manifest, repl);

            byte[] arsc;
            if (entries.TryGetValue("resources.arsc", out arsc))
                entries["resources.arsc"] = RewriteArscPackage(arsc, newPackage);

            entries["assets/project.json"] = Encoding.UTF8.GetBytes(projectJson ?? "{}");
            if (!order.Contains("assets/project.json")) order.Add("assets/project.json");

            ReplaceIcons(order, entries, iconDataUrl);

            byte[] unsigned = PackZip(order, entries);
            X509Certificate2 cert = GetSigningCert();
            byte[] signed = SignV2(unsigned, cert);

            string outDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads", "fast本地app");
            Directory.CreateDirectory(outDir);
            string outPath = Path.Combine(outDir, Sanitize(appName) + ".apk");
            File.WriteAllBytes(outPath, signed);
            return outPath;
        }

        /* ================= 签名身份（首次导出生成，之后固定复用，保证覆盖安装） ================= */
        private static X509Certificate2 GetSigningCert()
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FAST", "signing");
            Directory.CreateDirectory(dir);
            var pfx = Path.Combine(dir, "device.pfx");
            if (File.Exists(pfx))
            {
                try { return new X509Certificate2(pfx, SIGN_PASS, X509KeyStorageFlags.Exportable); }
                catch { }
            }
            using (var rsa = new RSACryptoServiceProvider(2048))
            {
                var req = new CertificateRequest("CN=FAST Desktop Device", rsa,
                    HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
                req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
                using (var cert = req.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(30)))
                {
                    byte[] bytes = cert.Export(X509ContentType.Pfx, SIGN_PASS);
                    File.WriteAllBytes(pfx, bytes);
                    return new X509Certificate2(bytes, SIGN_PASS, X509KeyStorageFlags.Exportable);
                }
            }
        }

        /* ================= ZIP 读写 ================= */
        private static void ReadEntries(string apk, out List<string> order, out Dictionary<string, byte[]> entries)
        {
            order = new List<string>();
            entries = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            using (var z = ZipFile.OpenRead(apk))
            {
                foreach (var e in z.Entries)
                {
                    if (e.FullName.StartsWith("META-INF/", StringComparison.OrdinalIgnoreCase)) continue;
                    if (e.FullName.EndsWith("/")) continue;
                    using (var s = e.Open())
                    using (var ms = new MemoryStream())
                    {
                        s.CopyTo(ms);
                        order.Add(e.FullName);
                        entries[e.FullName] = ms.ToArray();
                    }
                }
            }
        }

        private static byte[] PackZip(List<string> order, Dictionary<string, byte[]> entries)
        {
            using (var ms = new MemoryStream())
            {
                var central = new List<byte[]>();
                foreach (var name in order)
                {
                    byte[] raw = entries[name];
                    string lower = name.ToLowerInvariant();
                    bool stored = name == "resources.arsc" || lower.EndsWith(".png") || lower.EndsWith(".jpg")
                        || lower.EndsWith(".jpeg") || lower.EndsWith(".gif") || lower.EndsWith(".webp")
                        || lower.EndsWith(".cur") || lower.EndsWith(".mp3") || lower.EndsWith(".ogg")
                        || lower.EndsWith(".wav") || lower.EndsWith(".mp4") || lower.EndsWith(".ttf");

                    byte[] payload;
                    int method;
                    if (stored) { method = 0; payload = raw; }
                    else { method = 8; payload = Deflate(raw); }
                    uint crc = Crc32(raw);
                    byte[] nameB = Encoding.UTF8.GetBytes(name);
                    bool nonAscii = false;
                    foreach (byte b in nameB) if ((b & 0x80) != 0) { nonAscii = true; break; }
                    int flag = nonAscii ? 0x800 : 0;

                    long offset = ms.Position;
                    int extraLen = 0;
                    if (stored)
                    {
                        long headerEnd = ms.Position + 30 + nameB.Length;
                        extraLen = (int)((4 - (headerEnd & 3)) & 3);
                    }
                    WU32(ms, 0x04034b50);
                    WU16(ms, 20);
                    WU16(ms, flag);
                    WU16(ms, method);
                    WU16(ms, 0); WU16(ms, 0x0021);
                    WU32(ms, crc);
                    WU32(ms, payload.Length);
                    WU32(ms, raw.Length);
                    WU16(ms, nameB.Length);
                    WU16(ms, extraLen);
                    ms.Write(nameB, 0, nameB.Length);
                    for (int i = 0; i < extraLen; i++) ms.WriteByte(0);
                    ms.Write(payload, 0, payload.Length);

                    using (var ce = new MemoryStream())
                    {
                        WU32(ce, 0x02014b50);
                        WU16(ce, 20); WU16(ce, 20);
                        WU16(ce, flag);
                        WU16(ce, method);
                        WU16(ce, 0); WU16(ce, 0x0021);
                        WU32(ce, crc);
                        WU32(ce, payload.Length);
                        WU32(ce, raw.Length);
                        WU16(ce, nameB.Length);
                        WU16(ce, 0); WU16(ce, 0);
                        WU16(ce, 0); WU16(ce, 0);
                        WU32(ce, 0);
                        WU32(ce, offset);
                        ce.Write(nameB, 0, nameB.Length);
                        central.Add(ce.ToArray());
                    }
                }

                long cdStart = ms.Position;
                foreach (var ce in central) ms.Write(ce, 0, ce.Length);
                long cdSize = ms.Position - cdStart;

                WU32(ms, 0x06054b50);
                WU16(ms, 0); WU16(ms, 0);
                WU16(ms, central.Count); WU16(ms, central.Count);
                WU32(ms, cdSize);
                WU32(ms, cdStart);
                WU16(ms, 0);
                return ms.ToArray();
            }
        }

        private static byte[] Deflate(byte[] raw)
        {
            using (var ms = new MemoryStream())
            {
                using (var ds = new DeflateStream(ms, CompressionLevel.Optimal, true))
                    ds.Write(raw, 0, raw.Length);
                return ms.ToArray();
            }
        }

        /* ================= APK Signature Scheme v2 ================= */
        private static byte[] SignV2(byte[] zip, X509Certificate2 cert)
        {
            int eocd = -1;
            for (int i = zip.Length - 22; i >= 0 && i >= zip.Length - 22 - 65535; i--)
            {
                if (ReadU32(zip, i) == 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) throw new Exception("APK 缺少 EOCD");
            int cdStart = checked((int)ReadU32(zip, eocd + 16));

            // 内容摘要只依赖「未插入签名块」的原始数据：EOCD 里的 CD 偏移要改写成签名块起点（=原 CD 起点），
            // 与块大小无关，所以不需要先试算块长。
            byte[] digest = ContentDigest(zip, cdStart, eocd);
            byte[] block = BuildV2Block(digest, cert);

            int tailLen = zip.Length - cdStart;
            byte[] final = new byte[cdStart + block.Length + tailLen];
            Buffer.BlockCopy(zip, 0, final, 0, cdStart);
            Buffer.BlockCopy(block, 0, final, cdStart, block.Length);
            Buffer.BlockCopy(zip, cdStart, final, cdStart + block.Length, tailLen);
            int newEocd = eocd + block.Length;
            SetU32(final, newEocd + 16, (uint)(cdStart + block.Length));
            return final;
        }

        private static byte[] BuildV2Block(byte[] contentDigest, X509Certificate2 cert)
        {
            using (var rsa = cert.GetRSAPrivateKey())
            {
                if (rsa == null) throw new Exception("签名证书没有私钥");
                byte[] certDer = cert.GetRawCertData();
                byte[] pubKey = BuildSubjectPublicKeyInfo(cert);

                byte[] digestRecord = Cat(U32((int)SIG_ALG_RSA_PKCS1_SHA256), Len(contentDigest));
                byte[] digestsSeq = Len(digestRecord);
                byte[] certsSeq = Len(certDer);
                // signed-data 本身是「三段带长度前缀的序列」：digests / certificates / 附加属性（空）
                byte[] signedData = Cat(Len(digestsSeq), Len(certsSeq), U32(0));

                byte[] signature = rsa.SignData(signedData, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                byte[] sigRecord = Cat(U32((int)SIG_ALG_RSA_PKCS1_SHA256), Len(signature));
                byte[] sigsSeq = Len(sigRecord);

                byte[] signer = Cat(Len(signedData), Len(sigsSeq), Len(pubKey));
                // v2 块的值是「signer 序列」，序列本身也要再带一层长度前缀
                byte[] value = Len(Len(signer));
                long pairLen = 4 + value.Length;

                using (var ms = new MemoryStream())
                {
                    WU64(ms, pairLen + 32);
                    WU64(ms, pairLen);
                    WU32(ms, V2_BLOCK_ID);
                    ms.Write(value, 0, value.Length);
                    WU64(ms, pairLen + 32);
                    byte[] magic = Encoding.ASCII.GetBytes("APK Sig Block 42");
                    ms.Write(magic, 0, magic.Length);
                    return ms.ToArray();
                }
            }
        }

        private static byte[] ContentDigest(byte[] zip, int cdStart, int eocd)
        {
            // CHUNKED_SHA256：每块先算 SHA256(0xA5||长度||块数据)，
            // 再把「0x5A||块数||各块摘要」整体做一次 SHA256。
            var chunkDigests = new List<byte[]>();
            DigestSection(zip, 0, cdStart, chunkDigests);
            DigestSection(zip, cdStart, eocd - cdStart, chunkDigests);

            byte[] eocdBytes = new byte[zip.Length - eocd];
            Buffer.BlockCopy(zip, eocd, eocdBytes, 0, eocdBytes.Length);
            SetU32(eocdBytes, 16, (uint)cdStart);   // 验签时用的 CD 偏移 = 签名块起点
            DigestSection(eocdBytes, 0, eocdBytes.Length, chunkDigests);

            using (var sha = SHA256.Create())
            using (var data = new MemoryStream())
            {
                data.WriteByte(0x5A);
                byte[] cnt = U32(chunkDigests.Count);
                data.Write(cnt, 0, cnt.Length);
                foreach (var d in chunkDigests) data.Write(d, 0, d.Length);
                data.Position = 0;
                return sha.ComputeHash(data);
            }
        }

        private static void DigestSection(byte[] src, int off, int len, List<byte[]> outp)
        {
            const int MAX = 1024 * 1024;
            while (len > 0)
            {
                int n = Math.Min(len, MAX);
                using (var sha = SHA256.Create())
                using (var data = new MemoryStream())
                {
                    data.WriteByte(0xA5);
                    byte[] l = U32(n);
                    data.Write(l, 0, l.Length);
                    data.Write(src, off, n);
                    outp.Add(sha.ComputeHash(data.ToArray()));
                }
                off += n; len -= n;
            }
        }

        /* ================= 证书公钥 SPKI ================= */
        private static byte[] BuildSubjectPublicKeyInfo(X509Certificate2 cert)
        {
            using (var rsa = cert.GetRSAPublicKey())
            {
                if (rsa == null) throw new Exception("签名证书没有 RSA 公钥");
                var p = rsa.ExportParameters(false);
                byte[] modulus = DerInteger(p.Modulus);
                byte[] exponent = DerInteger(p.Exponent);
                byte[] rsaPub = DerSeq(Cat(modulus, exponent));
                byte[] algId = DerSeq(Cat(
                    new byte[] { 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01 },
                    new byte[] { 0x05, 0x00 }));
                byte[] bitString = Cat(new byte[] { 0x03 }, DerLen(rsaPub.Length + 1), new byte[] { 0x00 }, rsaPub);
                return DerSeq(Cat(algId, bitString));
            }
        }

        private static byte[] DerInteger(byte[] unsignedBigEndian)
        {
            int i = 0;
            while (i < unsignedBigEndian.Length - 1 && unsignedBigEndian[i] == 0) i++;
            byte[] v = new byte[unsignedBigEndian.Length - i];
            Buffer.BlockCopy(unsignedBigEndian, i, v, 0, v.Length);
            if (v.Length > 0 && (v[0] & 0x80) != 0) v = Cat(new byte[] { 0x00 }, v);
            return Cat(new byte[] { 0x02 }, DerLen(v.Length), v);
        }

        private static byte[] DerSeq(byte[] content) { return Cat(new byte[] { 0x30 }, DerLen(content.Length), content); }

        private static byte[] DerLen(int n)
        {
            if (n < 0x80) return new byte[] { (byte)n };
            if (n <= 0xff) return new byte[] { 0x81, (byte)n };
            return new byte[] { 0x82, (byte)(n >> 8), (byte)n };
        }

        /* ================= 图标替换 ================= */
        private static void ReplaceIcons(List<string> order, Dictionary<string, byte[]> entries, string dataUrl)
        {
            byte[] src = DecodeDataUrl(dataUrl);
            if (src == null) return;
            try
            {
                using (var ms = new MemoryStream(src))
                using (var img = Image.FromStream(ms))
                {
                    foreach (var name in order)
                    {
                        string lower = name.ToLowerInvariant();
                        if (!lower.EndsWith(".png") || lower.IndexOf("ic_launcher", StringComparison.Ordinal) < 0) continue;
                        int side = 48;
                        if (lower.Contains("xxxhdpi")) side = 144;
                        else if (lower.Contains("xxhdpi")) side = 128;
                        else if (lower.Contains("xhdpi")) side = 96;
                        else if (lower.Contains("hdpi")) side = 72;
                        entries[name] = CenterCropSquare(img, side);
                    }
                }
            }
            catch { /* 图标解不开就算了，继续用壳自带图标 */ }
        }

        private static byte[] CenterCropSquare(Image src, int side)
        {
            int w = src.Width, h = src.Height;
            int edge = Math.Min(w, h);
            int x = (w - edge) / 2, y = (h - edge) / 2;
            using (var bmp = new Bitmap(side, side, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp))
            using (var outMs = new MemoryStream())
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.DrawImage(src, new Rectangle(0, 0, side, side), new Rectangle(x, y, edge, edge), GraphicsUnit.Pixel);
                bmp.Save(outMs, ImageFormat.Png);
                return outMs.ToArray();
            }
        }

        private static byte[] DecodeDataUrl(string s)
        {
            if (s == null || !s.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return null;
            int comma = s.IndexOf(',');
            if (comma < 0) return null;
            try { return Convert.FromBase64String(s.Substring(comma + 1)); }
            catch { return null; }
        }

        private static string StableSuffix(string name)
        {
            unchecked
            {
                long h = 1125899906842597L;
                for (int i = 0; i < name.Length; i++) h = 31 * h + name[i];
                if (h < 0) h = -h;
                string s = Base36(h);
                while (s.Length < 6) s = "0" + s;
                return s.Substring(s.Length - 6);
            }
        }

        private static string Base36(long v)
        {
            const string DIG = "0123456789abcdefghijklmnopqrstuvwxyz";
            if (v == 0) return "0";
            var sb = new StringBuilder();
            while (v > 0) { sb.Insert(0, DIG[(int)(v % 36)]); v /= 36; }
            return sb.ToString();
        }

        private static string Sanitize(string name)
        {
            string s = System.Text.RegularExpressions.Regex.Replace(name, "[\\\\/:*?\"<>|\\s]+", "_");
            return s.Length == 0 ? "app" : s;
        }

        /* ================= AXML 字符串池重写 ================= */
        private static byte[] AxmlReplace(byte[] axml, Dictionary<string, string> repl)
        {
            if (ReU16(axml, 0) != 0x0003) throw new Exception("不是 AXML");
            int poolOff = 8;
            int pType = ReU16(axml, poolOff);
            int pHeader = ReU16(axml, poolOff + 2);
            if (pType != 0x0001) throw new Exception("AXML 字符串池不在首位");
            int pSize = (int)ReadU32(axml, poolOff + 4);
            int stringCount = (int)ReadU32(axml, poolOff + 8);
            int styleCount = (int)ReadU32(axml, poolOff + 12);
            int flags = (int)ReadU32(axml, poolOff + 16);
            int stringsStart = (int)ReadU32(axml, poolOff + 20);
            if (styleCount != 0) throw new Exception("不支持带样式的字符串池");
            bool utf8 = (flags & 0x100) != 0;

            int dataStart = poolOff + stringsStart;
            var strings = new string[stringCount];
            for (int i = 0; i < stringCount; i++)
            {
                int off = (int)ReadU32(axml, poolOff + pHeader + 4 * i);
                strings[i] = utf8 ? DecodeUtf8(axml, dataStart + off) : DecodeUtf16(axml, dataStart + off);
            }

            bool changed = false;
            for (int i = 0; i < stringCount; i++)
            {
                string nv;
                if (strings[i] != null && repl.TryGetValue(strings[i], out nv) && nv != strings[i])
                {
                    strings[i] = nv; changed = true;
                }
            }
            if (!changed) return axml;

            using (var data = new MemoryStream())
            {
                var offsets = new int[stringCount];
                for (int i = 0; i < stringCount; i++)
                {
                    offsets[i] = (int)data.Position;
                    byte[] enc = EncodeString(strings[i], utf8);
                    data.Write(enc, 0, enc.Length);
                }
                byte[] dataBytes = data.ToArray();
                int newStringsStart = pHeader + 4 * stringCount;
                int unpadded = newStringsStart + dataBytes.Length;
                int newPoolSize = (unpadded + 3) & ~3;

                using (var pool = new MemoryStream())
                {
                    WU16(pool, 0x0001);
                    WU16(pool, pHeader);
                    WU32(pool, newPoolSize);
                    WU32(pool, stringCount);
                    WU32(pool, styleCount);
                    WU32(pool, flags);
                    WU32(pool, newStringsStart);
                    WU32(pool, 0);
                    foreach (int o in offsets) WU32(pool, o);
                    pool.Write(dataBytes, 0, dataBytes.Length);
                    while (pool.Length < newPoolSize) pool.WriteByte(0);
                    byte[] poolBytes = pool.ToArray();

                    using (var outp = new MemoryStream())
                    {
                        int restLen = axml.Length - (poolOff + pSize);
                        WU16(outp, 0x0003);
                        WU16(outp, 8);
                        WU32(outp, 8 + poolBytes.Length + restLen);
                        outp.Write(poolBytes, 0, poolBytes.Length);
                        outp.Write(axml, poolOff + pSize, restLen);
                        return outp.ToArray();
                    }
                }
            }
        }

        private static string DecodeUtf16(byte[] b, int p)
        {
            int n = ReU16(b, p);
            var sb = new StringBuilder(n);
            for (int i = 0; i < n; i++) sb.Append((char)ReU16(b, p + 2 + i * 2));
            return sb.ToString();
        }

        private static string DecodeUtf8(byte[] b, int p)
        {
            int skip = b[p] & 0xff;
            int q = p + (((skip & 0x80) != 0) ? 2 : 1);
            int n = b[q] & 0xff;
            if ((n & 0x80) != 0) n = ((n & 0x7f) << 8) | (b[q + 1] & 0xff);
            int s = q + (((b[q] & 0x80) != 0) ? 2 : 1);
            return Encoding.UTF8.GetString(b, s, n);
        }

        private static byte[] EncodeString(string s, bool utf8)
        {
            using (var o = new MemoryStream())
            {
                if (utf8)
                {
                    byte[] u = Encoding.UTF8.GetBytes(s);
                    WriteLen8(o, s.Length);
                    WriteLen8(o, u.Length);
                    o.Write(u, 0, u.Length);
                    o.WriteByte(0);
                }
                else
                {
                    WU16(o, s.Length);
                    foreach (char c in s) WU16(o, c);
                    WU16(o, 0);
                }
                return o.ToArray();
            }
        }

        private static void WriteLen8(Stream o, int v)
        {
            if (v < 0x80) { o.WriteByte((byte)v); return; }
            o.WriteByte((byte)(((v >> 8) & 0x7f) | 0x80));
            o.WriteByte((byte)(v & 0xff));
        }

        /* ================= resources.arsc 包名同步 ================= */
        private static byte[] RewriteArscPackage(byte[] arsc, string newPkg)
        {
            if (arsc == null || arsc.Length < 12 || newPkg == null) return arsc;
            int tableHeader = ReU16(arsc, 2);
            int off = tableHeader;
            while (off + 8 <= arsc.Length)
            {
                int type = ReU16(arsc, off);
                int size = (int)ReadU32(arsc, off + 4);
                if (size <= 0) break;
                if (type == 0x0200)
                {
                    byte[] outp = (byte[])arsc.Clone();
                    char[] chars = newPkg.ToCharArray();
                    if (chars.Length > 127) Array.Resize(ref chars, 127);
                    int nameOff = off + 12;
                    for (int i = 0; i < 128; i++)
                    {
                        char c = i < chars.Length ? chars[i] : '\0';
                        outp[nameOff + i * 2] = (byte)(c & 0xff);
                        outp[nameOff + i * 2 + 1] = (byte)((c >> 8) & 0xff);
                    }
                    return outp;
                }
                off += size;
            }
            return arsc;
        }

        /* ================= 小工具 ================= */
        private static uint Crc32(byte[] data)
        {
            uint[] table = CrcTable.Value;
            uint c = 0xFFFFFFFF;
            for (int i = 0; i < data.Length; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >> 8);
            return ~c;
        }

        private static readonly Lazy<uint[]> CrcTableLazy = new Lazy<uint[]>(() =>
        {
            var t = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint c = i;
                for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
                t[i] = c;
            }
            return t;
        });

        private static class CrcTable
        {
            public static uint[] Value { get { return CrcTableLazy.Value; } }
        }

        private static byte[] Cat(params byte[][] parts)
        {
            int n = 0; foreach (var p in parts) n += p.Length;
            byte[] r = new byte[n]; int o = 0;
            foreach (var p in parts) { Buffer.BlockCopy(p, 0, r, o, p.Length); o += p.Length; }
            return r;
        }

        private static byte[] Len(byte[] b) { return Cat(U32(b.Length), b); }

        private static byte[] U32(int v)
        {
            return new byte[] { (byte)(v & 0xff), (byte)((v >> 8) & 0xff), (byte)((v >> 16) & 0xff), (byte)((v >> 24) & 0xff) };
        }

        private static ushort ReU16(byte[] b, int o) { return (ushort)(b[o] | (b[o + 1] << 8)); }

        private static uint ReadU32(byte[] b, int o)
        {
            return (uint)(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24));
        }

        private static void SetU32(byte[] b, int o, uint v)
        {
            b[o] = (byte)(v & 0xff); b[o + 1] = (byte)((v >> 8) & 0xff);
            b[o + 2] = (byte)((v >> 16) & 0xff); b[o + 3] = (byte)((v >> 24) & 0xff);
        }

        private static void WU16(Stream s, int v)
        {
            s.WriteByte((byte)(v & 0xff)); s.WriteByte((byte)((v >> 8) & 0xff));
        }

        private static void WU32(Stream s, long v)
        {
            s.WriteByte((byte)(v & 0xff)); s.WriteByte((byte)((v >> 8) & 0xff));
            s.WriteByte((byte)((v >> 16) & 0xff)); s.WriteByte((byte)((v >> 24) & 0xff));
        }

        private static void WU64(Stream s, long v)
        {
            WU32(s, v & 0xFFFFFFFFL); WU32(s, (long)((ulong)v >> 32));
        }
    }
}
