package com.fast.app;
import com.android.apksig.ApkSigner;
import java.io.*;
import java.security.*;
import java.security.cert.*;
import java.util.*;

/**
 * PC 端等价复刻「设备导出」流水线：读壳 -> AxmlRewriter 改包名/应用名/版本
 * -> arsc 包名同步 -> 注入 assets/project.json -> Exporter.packApk 标准 ZIP
 * -> 用「现场生成的设备身份」apksig v1+v2+v3 签名。
 *
 * 关键：签名身份不再来自任何密钥文件，而是和手机端一样当场生成
 * （走同一个 DerX509）。两次构建分别模拟两台不同手机，并断言两者
 * 的签名证书不同 —— 这正是"每台设备自己一把钥匙"要保证的性质。
 *
 * 用法：ExportSim <assetsDir 含 shell.apk / shell-land.apk> <outDir>
 */
public class ExportSim {
  static byte[] readAll(File f) throws Exception {
    ByteArrayOutputStream bo=new ByteArrayOutputStream(); FileInputStream in=new FileInputStream(f);
    byte[] b=new byte[8192]; int n; while((n=in.read(b))>0)bo.write(b,0,n); in.close(); return bo.toByteArray();
  }

  static PrivateKey deviceKey;
  static List<X509Certificate> deviceChain;

  /** 复刻 DeviceKey.generate：现场造一对 RSA 密钥，并用 DerX509 造配套自签证书。 */
  static void makeDeviceIdentity(String cn) throws Exception {
    KeyPairGenerator kpg=KeyPairGenerator.getInstance("RSA");
    kpg.initialize(2048);
    KeyPair kp=kpg.generateKeyPair();
    Date now=new Date();
    Calendar c=Calendar.getInstance();
    c.setTime(now); c.add(Calendar.DAY_OF_MONTH,-1); Date notBefore=c.getTime();
    c.setTime(now); c.add(Calendar.YEAR,30);         Date notAfter=c.getTime();
    byte[] der=DerX509.selfSigned(kp,cn,notBefore,notAfter);
    CertificateFactory cf=CertificateFactory.getInstance("X.509");
    X509Certificate cert=(X509Certificate)cf.generateCertificate(new ByteArrayInputStream(der));
    deviceKey=kp.getPrivate();
    deviceChain=new ArrayList<X509Certificate>();
    deviceChain.add(cert);
  }

  static void sign(File in, File out) throws Exception {
    ApkSigner.SignerConfig sc=new ApkSigner.SignerConfig.Builder("CERT",deviceKey,deviceChain).build();
    new ApkSigner.Builder(Collections.singletonList(sc)).setInputApk(in).setOutputApk(out)
      .setMinSdkVersion(24).setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true)
      .setOtherSignersSignaturesPreserved(false).build().sign();
  }

  static File build(File shell, String appName, String ver, File out) throws Exception {
    LinkedHashMap<String,byte[]> e=Exporter.readEntries(shell);
    String npkg="com.fast.app.rt."+suffix(appName);
    LinkedHashMap<String,String> repl=new LinkedHashMap<>();
    repl.put(Exporter.OLD_PACKAGE,npkg); repl.put(Exporter.LABEL_ANCHOR,appName); repl.put(Exporter.VERSION_ANCHOR,ver);
    e.put("AndroidManifest.xml", AxmlRewriter.replace(e.get("AndroidManifest.xml"),repl));
    byte[] arsc=e.get("resources.arsc"); if(arsc!=null) e.put("resources.arsc",Exporter.rewriteArscPackage(arsc,npkg));
    e.put("assets/project.json",("{\"appName\":\""+appName+"\",\"screens\":[{\"id\":\"s1\",\"components\":[]}]}").getBytes("UTF-8"));
    File un=new File(out.getParentFile(),"unsigned_"+out.getName());
    Exporter.packApk(e,un); sign(un,out); un.delete();
    System.out.println("built "+out.getName()+" pkg="+npkg+" bytes="+out.length());
    return out;
  }

  static String suffix(String name){long h=1125899906842597L;for(int i=0;i<name.length();i++)h=31*h+name.charAt(i);h=Math.abs(h);String s=Long.toString(h,36);while(s.length()<6)s="0"+s;return s.substring(s.length()-6);}

  static String sha256(byte[] d) throws Exception {
    byte[] h=MessageDigest.getInstance("SHA-256").digest(d);
    StringBuilder sb=new StringBuilder();
    for(byte b:h) sb.append(String.format("%02x",b));
    return sb.toString();
  }

  public static void main(String[] a) throws Exception {
    File assets=new File(a[0]), outdir=new File(a[1]); outdir.mkdirs();

    makeDeviceIdentity("FAST Device A");
    String fpA=sha256(deviceChain.get(0).getEncoded());
    build(new File(assets,"shell.apk"),"我的待办","2.5",new File(outdir,"todo.apk"));

    makeDeviceIdentity("FAST Device B");
    String fpB=sha256(deviceChain.get(0).getEncoded());
    build(new File(assets,"shell-land.apk"),"横屏测试","1.0",new File(outdir,"land.apk"));

    System.out.println("certA="+fpA);
    System.out.println("certB="+fpB);
    if (fpA.equals(fpB)) throw new IllegalStateException("两次生成的签名证书相同：设备身份隔离失效");
    System.out.println("OK: 两个成品使用了彼此不同的签名身份");
  }
}
