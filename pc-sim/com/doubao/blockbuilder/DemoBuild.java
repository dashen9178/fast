package com.doubao.blockbuilder;
import com.android.apksig.ApkSigner;
import java.io.*;
import java.security.*;
import java.security.cert.*;
import java.util.*;

/**
 * PC 端等价复刻设备导出流水线（Exporter.export 的无 Android 依赖版本）：
 * 读壳 -> AxmlRewriter 改包名/应用名/版本 -> arsc 包名同步 -> 注入 assets/project.json
 *        -> Exporter.packApk 标准 ZIP -> 用现场生成的「设备身份」做 apksig v1+v2+v3 签名。
 *
 * 签名身份不再来自任何密钥文件：和手机端一样当场生成（同一个 DerX509）。
 * 用法：DemoBuild <shell.apk> <project.json> <appName> <version> <out.apk>
 */
public class DemoBuild {
  static byte[] readAll(File f) throws Exception {
    ByteArrayOutputStream bo = new ByteArrayOutputStream();
    FileInputStream in = new FileInputStream(f);
    byte[] b = new byte[8192]; int n;
    while ((n = in.read(b)) > 0) bo.write(b, 0, n);
    in.close();
    return bo.toByteArray();
  }

  static PrivateKey deviceKey;
  static List<X509Certificate> deviceChain;

  /** 复刻 DeviceKey.generate：现场造一对 RSA 密钥 + DerX509 自签证书 */
  static void makeDeviceIdentity(String cn) throws Exception {
    KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
    kpg.initialize(2048);
    KeyPair kp = kpg.generateKeyPair();
    Date now = new Date();
    Calendar c = Calendar.getInstance();
    c.setTime(now); c.add(Calendar.DAY_OF_MONTH, -1); Date notBefore = c.getTime();
    c.setTime(now); c.add(Calendar.YEAR, 30);         Date notAfter = c.getTime();
    byte[] der = DerX509.selfSigned(kp, cn, notBefore, notAfter);
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    X509Certificate cert = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(der));
    deviceKey = kp.getPrivate();
    deviceChain = new ArrayList<X509Certificate>();
    deviceChain.add(cert);
  }

  static void sign(File in, File out) throws Exception {
    ApkSigner.SignerConfig sc = new ApkSigner.SignerConfig.Builder("CERT", deviceKey, deviceChain).build();
    new ApkSigner.Builder(Collections.singletonList(sc))
        .setInputApk(in).setOutputApk(out)
        .setMinSdkVersion(24)
        .setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true)
        .setOtherSignersSignaturesPreserved(false).build().sign();
  }

  static String suffix(String name) {
    long h = 1125899906842597L;
    for (int i = 0; i < name.length(); i++) h = 31 * h + name.charAt(i);
    h = Math.abs(h);
    String s = Long.toString(h, 36);
    while (s.length() < 6) s = "0" + s;
    return s.substring(s.length() - 6);
  }

  public static void main(String[] a) throws Exception {
    File shell = new File(a[0]);
    byte[] project = readAll(new File(a[1]));
    String appName = a[2];
    String ver = a[3];
    File out = new File(a[4]);

    String npkg = "com.doubao.rt." + suffix(appName);
    LinkedHashMap<String, byte[]> e = Exporter.readEntries(shell);
    LinkedHashMap<String, String> repl = new LinkedHashMap<>();
    repl.put(Exporter.OLD_PACKAGE, npkg);
    repl.put(Exporter.LABEL_ANCHOR, appName);
    repl.put(Exporter.VERSION_ANCHOR, ver);
    e.put("AndroidManifest.xml", AxmlRewriter.replace(e.get("AndroidManifest.xml"), repl));
    byte[] arsc = e.get("resources.arsc");
    if (arsc != null) e.put("resources.arsc", Exporter.rewriteArscPackage(arsc, npkg));
    e.put("assets/project.json", project);

    makeDeviceIdentity("FAST Demo Device");
    File un = new File(out.getParentFile(), "unsigned_" + out.getName());
    Exporter.packApk(e, un);
    sign(un, out);
    un.delete();
    System.out.println("built " + out.getName() + " pkg=" + npkg + " bytes=" + out.length()
        + " projectBytes=" + project.length);
  }
}
