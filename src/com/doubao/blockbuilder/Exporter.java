package com.doubao.blockbuilder;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * 导出器：把内置“运行时壳”复制一份，
 *  1) AxmlRewriter 重写二进制 Manifest 的包名/应用名/版本号（长度任意）；
 *  2) 注入用户项目 assets/project.json；
 *  3) 可选替换应用图标（按密度缩放）；
 *  4) 以最标准的 ZIP 结构重打包（resources.arsc 未压缩且 4 字节对齐，
 *     所有条目预计算 CRC、不使用数据描述符，最大化各 ROM 安装器兼容性）；
 *  5) 官方 apksig 做 v1+v2 重签名。
 * 纯打包逻辑（readEntries/packApk）不含 Android API，便于在 PC 上等价验证。
 */
public class Exporter {

    static final String SHELL_PORTRAIT = "shell.apk";
    static final String SHELL_LANDSCAPE = "shell-land.apk";
    static final String OLD_PACKAGE = "com.doubao.rt.a00000";
    static final String LABEL_ANCHOR = "XXXXXXXXXXXXXXXXXXXX";
    static final String VERSION_ANCHOR = "0.00";

    public static String export(Context ctx, String projectJson, String appName,
                                String orientation, String iconDataUrl, String version)
            throws Exception {
        if (appName == null || appName.trim().isEmpty()) appName = "我的应用";
        appName = appName.trim();
        if (appName.length() > 20) appName = appName.substring(0, 20);
        if (version == null || !version.matches(".*\\d.*")) version = "1.0";
        version = version.replaceAll("[^0-9.]", "").trim();
        if (version.isEmpty() || version.length() > 12) version = "1.0";

        String newPackage = "com.doubao.rt." + stableSuffix(appName);
        String shellAsset = "landscape".equals(orientation) ? SHELL_LANDSCAPE : SHELL_PORTRAIT;

        File work = new File(ctx.getCacheDir(), "shell_in.apk");
        copy(ctx.getAssets().open(shellAsset), work);

        // 原件保存在应用私有持久目录 files/output（不依赖外部、不会被系统清理）；
        // MainActivity 随后会再复制一份到公共「下载/fast本地app」供用户查看/安装。
        File outDir = new File(ctx.getFilesDir(), "output");
        if (!outDir.exists()) outDir.mkdirs();
        File unsigned = new File(ctx.getCacheDir(), "unsigned.apk");
        File signed = new File(outDir, sanitize(appName) + ".apk");
        if (signed.exists()) signed.delete();

        Map<String, byte[]> entries = readEntries(work);

        // Manifest：字符串池重建，长度任意
        byte[] manifest = entries.get("AndroidManifest.xml");
        if (manifest == null) throw new IllegalStateException("壳缺少 AndroidManifest.xml");
        Map<String, String> repl = new LinkedHashMap<String, String>();
        repl.put(OLD_PACKAGE, newPackage);
        repl.put(LABEL_ANCHOR, appName);
        repl.put(VERSION_ANCHOR, version);
        entries.put("AndroidManifest.xml", AxmlRewriter.replace(manifest, repl));

        // resources.arsc 内的资源包名同步改写为新包名（保持与清单一致；定长 UTF-16 缓冲，体积不变）
        byte[] arsc = entries.get("resources.arsc");
        if (arsc != null) entries.put("resources.arsc", rewriteArscPackage(arsc, newPackage));

        // 项目数据
        entries.put("assets/project.json", projectJson.getBytes("UTF-8"));

        // 本地上传的视频/音频：把工程里 media:// 引用到的文件从私有目录一并打进 assets/media
        java.util.Set<String> mediaNames = new java.util.LinkedHashSet<String>();
        java.util.regex.Matcher mm = java.util.regex.Pattern.compile("media://([A-Za-z0-9_.-]+)").matcher(projectJson);
        while (mm.find()) mediaNames.add(mm.group(1));
        for (String mname : mediaNames) {
            try {
                File mf = new File(ctx.getFilesDir(), "media/" + mname);
                if (mf.exists() && mf.isFile()) {
                    entries.put("assets/media/" + mname, readAll(new FileInputStream(mf)));
                }
            } catch (Throwable ignore) {}
        }

        // 自定义图标
        byte[] srcIcon = decodeDataUrl(iconDataUrl);
        if (srcIcon != null) {
            Bitmap bmp = BitmapFactory.decodeByteArray(srcIcon, 0, srcIcon.length);
            if (bmp != null) {
                for (String name : new ArrayList<String>(entries.keySet())) {
                    // ic_launcher.png（传统图标，给 Android 7 及以下）
                    // ic_launcher_foreground.png（自适应图标的前景层，Android 8+ 用它）
                    // 两个都要换，否则新系统上启动器会继续显示"白底+缩小"的旧图标。
                    if (!name.endsWith(".png") || !name.contains("ic_launcher")) continue;
                    int side = iconSideFor(name);
                    // 居中裁剪成正方形（fill）：照片铺满整块图标，不再被拉伸变形、也不留白边
                    Bitmap scaled = centerCropSquare(bmp, side);
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    scaled.compress(Bitmap.CompressFormat.PNG, 100, bo);
                    entries.put(name, bo.toByteArray());
                    if (scaled != bmp) scaled.recycle();
                }
                bmp.recycle();
            }
        }

        packApk(entries, unsigned);

        // 签名身份来自本机（首次导出时现场生成并存进应用私有目录），不再读取内置钥匙
        DeviceKey.Material key = DeviceKey.get(ctx);
        // 证书自检：证书本身不合法时，安卓安装器只会丢一句"安装包已损坏"，
        // 这里导出前先自己验一遍（能解析 / 在有效期内 / 主题纯 ASCII）。
        checkCert(key.chain);
        sign(key.privateKey, key.chain, unsigned, signed);
        // 设备端自检：绝不把校验不过的包交给安装器（否则系统只报含糊的“安装包已损坏”）
        String verifyMsg = verifyApk(signed);
        if (verifyMsg != null) {
            signed.delete();
            throw new IllegalStateException("生成的 APK 自检失败：" + verifyMsg);
        }
        if (!signed.exists() || signed.length() < 20000) {
            signed.delete();
            throw new IllegalStateException("生成的 APK 体积异常，已中止");
        }
        unsigned.delete();
        work.delete();
        return signed.getAbsolutePath();
    }

    /** 已压缩的二进制资源按 STORED 存放（与官方构建一致），其余 DEFLATED */
    static boolean isStoredEntry(String name) {
        if ("resources.arsc".equals(name)) return true;
        String n = name.toLowerCase();
        return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg")
                || n.endsWith(".gif") || n.endsWith(".webp") || n.endsWith(".cur")
                || n.endsWith(".mp3") || n.endsWith(".ogg") || n.endsWith(".wav")
                || n.endsWith(".mp4") || n.endsWith(".ttf");
    }

    /**
     * 改写 resources.arsc 中 package chunk 的定长包名（UTF-16，固定 256 字节缓冲，体积不变）。
     * 让资源表包名与清单包名保持一致。
     */
    static byte[] rewriteArscPackage(byte[] arsc, String newPkg) {
        if (arsc == null || arsc.length < 12 || newPkg == null) return arsc;
        int tableHeader = (arsc[2] & 0xff) | ((arsc[3] & 0xff) << 8);
        int off = tableHeader;
        while (off + 8 <= arsc.length) {
            int type = (arsc[off] & 0xff) | ((arsc[off + 1] & 0xff) << 8);
            int size = (arsc[off + 4] & 0xff) | ((arsc[off + 5] & 0xff) << 8)
                    | ((arsc[off + 6] & 0xff) << 16) | ((arsc[off + 7] & 0xff) << 24);
            if (size <= 0) break;
            if (type == 0x0200) { // RES_TABLE_PACKAGE_TYPE
                byte[] out = arsc.clone();
                char[] chars = newPkg.toCharArray();
                if (chars.length > 127) { char[] t = new char[127]; System.arraycopy(chars, 0, t, 0, 127); chars = t; }
                int nameOff = off + 12; // id(4) 之后即 256 字节包名
                for (int i = 0; i < 128; i++) {
                    char c = i < chars.length ? chars[i] : 0;
                    out[nameOff + i * 2] = (byte) (c & 0xff);
                    out[nameOff + i * 2 + 1] = (byte) ((c >>> 8) & 0xff);
                }
                return out;
            }
            off += size;
        }
        return arsc;
    }

    /** 用官方 apksig 在设备端复核签名；返回 null 表示通过，否则返回错误描述 */
    static String verifyApk(File apk) {
        try {
            ApkVerifier.Result r = new ApkVerifier.Builder(apk)
                    .setMinCheckedPlatformVersion(24)
                    .setMaxCheckedPlatformVersion(34)
                    .build().verify();
            if (!r.isVerified()) {
                StringBuilder sb = new StringBuilder();
                for (ApkVerifier.IssueWithParams i : r.getErrors()) sb.append(i).append(';');
                return sb.length() == 0 ? "未通过签名校验" : sb.toString();
            }
            if (r.isVerifiedUsingV1Scheme() || r.isVerifiedUsingV2Scheme() || r.isVerifiedUsingV3Scheme())
                return null;
            return "缺少任何可用签名方案";
        } catch (Exception e) {
            return "校验异常：" + e;
        }
    }

    /** 密度目录关键字 -> 图标边长（aapt2 会补 -v4 等限定符，按包含关系匹配） */
    static int iconSideFor(String entryName) {
        if (entryName.contains("xxxhdpi")) return 144;
        if (entryName.contains("xxhdpi")) return 128;
        if (entryName.contains("xhdpi")) return 96;
        if (entryName.contains("hdpi")) return 72;
        return 48;
    }

    /**
     * 把任意比例的图片**居中裁剪**成 side×side 的正方形（等价于 CSS 的 object-fit: cover）。
     * 以前是直接拉伸成正方形：非正方照片会变形；自适应图标下还会因为内容没铺满而露白边。
     */
    static Bitmap centerCropSquare(Bitmap src, int side) {
        int w = src.getWidth(), h = src.getHeight();
        if (w <= 0 || h <= 0) return Bitmap.createScaledBitmap(src, side, side, true);
        int edge = Math.min(w, h);
        int x = (w - edge) / 2, y = (h - edge) / 2;
        Bitmap cropped = Bitmap.createBitmap(src, x, y, edge, edge);
        Bitmap out = Bitmap.createScaledBitmap(cropped, side, side, true);
        if (cropped != src) cropped.recycle();
        return out;
    }

    /* ============ 纯打包逻辑（无 Android 依赖，PC 可测） ============ */

    static LinkedHashMap<String, byte[]> readEntries(File zip) throws Exception {
        LinkedHashMap<String, byte[]> entries = new LinkedHashMap<String, byte[]>();
        ZipFile zf = new ZipFile(zip);
        try {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry ze = en.nextElement();
                if (ze.getName().startsWith("META-INF/")) continue;
                entries.put(ze.getName(), readAll(zf.getInputStream(ze)));
            }
        } finally { zf.close(); }
        return entries;
    }

    /**
     * 手写规范 ZIP：resources.arsc 与已压缩二进制资源以 STORED 存储并 4 字节对齐，其余 DEFLATED；
     * 所有条目在本地头中写全 CRC/大小（general purpose bit3=0，无数据描述符），
     * 这是对各类安装器最稳妥的结构。
     */
    static void packApk(Map<String, byte[]> entries, File out) throws Exception {
        java.util.zip.Deflater def = new java.util.zip.Deflater(java.util.zip.Deflater.BEST_COMPRESSION, true);
        try {
            List<CentralEntry> central = new ArrayList<CentralEntry>();
            FileOutputStream fos = new FileOutputStream(out);
            CountedOut co = new CountedOut(fos);
            try {
                for (Map.Entry<String, byte[]> e : entries.entrySet()) {
                    String name = e.getKey();
                    byte[] raw = e.getValue();
                    boolean stored = isStoredEntry(name);
                    CRC32 crc = new CRC32(); crc.update(raw);
                    byte[] nameB = name.getBytes("UTF-8");
                    byte[] payload; int method;
                    if (stored) { method = 0; payload = raw; }
                    else { method = 8; payload = deflate(def, raw); }

                    int extraLen = 0;
                    if (stored) { // 让数据起始偏移 4 字节对齐
                        int headerEnd = (int) co.count + 30 + nameB.length;
                        extraLen = (4 - (headerEnd & 3)) & 3;
                    }
                    int offset = (int) co.count;
                    boolean nonAscii = false;
                    for (byte bb : nameB) if ((bb & 0x80) != 0) { nonAscii = true; break; }
                    int gpFlag = nonAscii ? 0x800 : 0; // UTF-8 位仅在名称含非 ASCII 时置
                    writeU32(co, 0x04034b50);   // local file header sig
                    writeU16(co, 20);           // version needed
                    writeU16(co, gpFlag);
                    writeU16(co, method);
                    writeU16(co, DOS_TIME); writeU16(co, DOS_DATE); // 合法固定时间 1980-01-01
                    writeU32(co, crc.getValue());
                    writeU32(co, payload.length);
                    writeU32(co, raw.length);
                    writeU16(co, nameB.length);
                    writeU16(co, extraLen);
                    co.write(nameB, 0, nameB.length);
                    if (extraLen > 0) co.write(new byte[extraLen], 0, extraLen);
                    co.write(payload, 0, payload.length);

                    CentralEntry ce = new CentralEntry();
                    ce.name = nameB; ce.method = method; ce.crc = crc.getValue();
                    ce.flag = gpFlag; ce.csize = payload.length; ce.usize = raw.length; ce.offset = offset;
                    central.add(ce);
                }
                int cdStart = (int) co.count;
                for (CentralEntry ce : central) {
                    writeU32(co, 0x02014b50);
                    writeU16(co, 20); writeU16(co, 20); // version made by / needed
                    writeU16(co, ce.flag);
                    writeU16(co, ce.method);
                    writeU16(co, DOS_TIME); writeU16(co, DOS_DATE);
                    writeU32(co, ce.crc);
                    writeU32(co, ce.csize); writeU32(co, ce.usize);
                    writeU16(co, ce.name.length);
                    writeU16(co, 0); writeU16(co, 0); // extra / comment len
                    writeU16(co, 0); writeU16(co, 0); // disk / internal attr
                    writeU32(co, 0);                   // external attr
                    writeU32(co, ce.offset);
                    co.write(ce.name, 0, ce.name.length);
                }
                int cdSize = (int) co.count - cdStart;
                writeU32(co, 0x06054b50); // EOCD
                writeU16(co, 0); writeU16(co, 0);
                writeU16(co, central.size()); writeU16(co, central.size());
                writeU32(co, cdSize); writeU32(co, cdStart);
                writeU16(co, 0);
            } finally { fos.close(); }
        } finally { def.end(); }
    }

    private static byte[] deflate(java.util.zip.Deflater def, byte[] raw) {
        def.reset();
        def.setInput(raw); def.finish();
        ByteArrayOutputStream bo = new ByteArrayOutputStream(raw.length / 2 + 32);
        byte[] buf = new byte[8192];
        while (!def.finished()) bo.write(buf, 0, def.deflate(buf));
        return bo.toByteArray();
    }

    /** 合法的固定 DOS 时间/日期：1980-01-01 00:00（不能写全 0，那是非法日期，部分 ROM 拒绝） */
    private static final int DOS_TIME = 0;
    private static final int DOS_DATE = (0 << 9) | (1 << 5) | 1; // 0x0021

    private static class CentralEntry {
        byte[] name; int method, flag; long crc; long csize, usize, offset;
    }

    private static void writeU16(OutputStream o, int v) throws java.io.IOException {
        o.write(v & 0xff); o.write((v >>> 8) & 0xff);
    }
    private static void writeU32(OutputStream o, long v) throws java.io.IOException {
        o.write((int) (v & 0xff)); o.write((int) ((v >>> 8) & 0xff));
        o.write((int) ((v >>> 16) & 0xff)); o.write((int) ((v >>> 24) & 0xff));
    }

    private static byte[] decodeDataUrl(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith("data:")) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0) return null;
        try { return Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT); }
        catch (Exception e) { return null; }
    }

    private static String stableSuffix(String name) {
        long h = 1125899906842597L;
        for (int i = 0; i < name.length(); i++) h = 31 * h + name.charAt(i);
        h = Math.abs(h);
        String s = Long.toString(h, 36);
        while (s.length() < 6) s = "0" + s;
        return s.substring(s.length() - 6);
    }

    private static String sanitize(String name) {
        String s = name.replaceAll("[\\\\/:*?\"<>|\\s]+", "_");
        return s.isEmpty() ? "app" : s;
    }

    /**
     * 设备端签名：使用"本机自己生成"的签名身份（见 DeviceKey）。
     *
     * 这里刻意不再从 assets 读取任何私钥——编辑器 APK 里已经不含任何密钥材料，
     * 因此这个 APK 可以随意分发，拿到它的人无法冒充本机作者签出假的"官方更新"。
     * v1+v2+v3 全开，兼容 Android 7~15 全部安装器。
     */
    /** 证书自检：能解析、当前有效、主题可安全编码 */
    private static void checkCert(java.util.List<java.security.cert.X509Certificate> chain) {
        if (chain == null || chain.isEmpty()) throw new IllegalStateException("签名证书为空");
        java.security.cert.X509Certificate c = chain.get(0);
        try { c.checkValidity(new java.util.Date()); }
        catch (Exception e) { throw new IllegalStateException("签名证书不在有效期内：" + e.getMessage()); }
        if (c.getPublicKey() == null) throw new IllegalStateException("签名证书里没有公钥");
        String dn = String.valueOf(c.getSubjectX500Principal().getName());
        for (int i = 0; i < dn.length(); i++) {
            if (dn.charAt(i) > 127) throw new IllegalStateException("签名证书主题含非 ASCII 字符：" + dn);
        }
    }

    private static void sign(PrivateKey pk, List<X509Certificate> chain, File in, File out) throws Exception {
        if (chain == null || chain.isEmpty()) throw new IllegalStateException("签名证书为空");
        ApkSigner.SignerConfig sc = new ApkSigner.SignerConfig.Builder("CERT", pk, chain).build();
        new ApkSigner.Builder(Collections.singletonList(sc))
                .setInputApk(in).setOutputApk(out)
                .setMinSdkVersion(24)
                .setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true)
                .setOtherSignersSignaturesPreserved(false).build().sign();
    }

    /** 统计已写字节数，用于 STORED 条目 4 字节对齐 */
    static class CountedOut extends FilterOutputStream {
        long count = 0;
        CountedOut(OutputStream out) { super(out); }
        @Override public void write(int b) throws java.io.IOException { out.write(b); count++; }
        @Override public void write(byte[] b, int off, int len) throws java.io.IOException { out.write(b, off, len); count += len; }
    }

    private static byte[] readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        is.close();
        return bo.toByteArray();
    }

    private static void copy(InputStream is, File dst) throws Exception {
        OutputStream os = new FileOutputStream(dst);
        byte[] buf = new byte[8192]; int n;
        while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
        os.close(); is.close();
    }
}
