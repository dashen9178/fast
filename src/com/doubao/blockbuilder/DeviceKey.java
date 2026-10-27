package com.doubao.blockbuilder;

import android.content.Context;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * 设备签名密钥：首次使用时在本机生成，之后一直复用。
 *
 * 为什么改成这样：以前编辑器 APK 里内嵌了一份"人人相同"的签名私钥（assets/signkey.pk8），
 * 而 APK 本身只是个 ZIP，任何人拿到都能把私钥抠出来，进而以作者名义签出假的"官方更新"。
 * 现在私钥不再随包分发，而是在每台设备首次运行时用 KeyPairGenerator 现生成一份，
 * 连同自签证书一起存在应用私有目录里（其他应用读不到）。
 *
 * 代价：清除应用数据 / 卸载重装 / 换手机之后密钥会丢失，此前导出的作品将无法再被
 * 覆盖更新（必须先卸载旧版）。这是"密钥不上传"必然要付的代价。
 */
final class DeviceKey {

    /** 私有目录下的存放位置：<filesDir>/signing/ */
    private static final String DIR_NAME = "signing";
    private static final String KEY_NAME = "device.pk8";
    private static final String CERT_NAME = "device.crt";

    /** 证书主题里的 CN */
    private static final String SUBJECT_CN = "FAST Device Signing Key";

    /** 密钥长度与有效期（Android 14 起要求新应用的签名证书有效期至少到 2033 年，30 年足够） */
    private static final int KEY_BITS = 2048;
    private static final int VALID_YEARS = 30;

    private DeviceKey() {}

    /** 一份可用的签名身份：私钥 + 证书链 */
    static final class Material {
        final PrivateKey privateKey;
        final List<X509Certificate> chain;

        Material(PrivateKey privateKey, List<X509Certificate> chain) {
            this.privateKey = privateKey;
            this.chain = chain;
        }
    }

    /**
     * 取出设备密钥；不存在或已损坏则当场生成一份并持久化。
     * 生成一次约需几百毫秒（RSA 2048），故只在首次导出处发生。
     */
    static synchronized Material get(Context ctx) throws Exception {
        File dir = new File(ctx.getFilesDir(), DIR_NAME);
        File keyFile = new File(dir, KEY_NAME);
        File certFile = new File(dir, CERT_NAME);

        if (keyFile.isFile() && certFile.isFile()) {
            try {
                return load(keyFile, certFile);
            } catch (Throwable t) {
                // 半损坏状态（例如只写成功了一半）：放弃这一对，重新生成。
                // 不静默复用其中一半，否则会得到"私钥与证书不匹配"的怪包。
                keyFile.delete();
                certFile.delete();
            }
        }
        return generate(dir, keyFile, certFile);
    }

    /** 仅供"重新生成密钥"这类维护入口使用；会让已导出的作品无法覆盖更新 */
    static synchronized void reset(Context ctx) {
        File dir = new File(ctx.getFilesDir(), DIR_NAME);
        new File(dir, KEY_NAME).delete();
        new File(dir, CERT_NAME).delete();
    }

    private static Material load(File keyFile, File certFile) throws Exception {
        byte[] keyDer = readAll(new FileInputStream(keyFile));
        PrivateKey pk = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(keyDer));

        byte[] certDer = readAll(new FileInputStream(certFile));
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate cert = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(certDer));

        return new Material(pk, Collections.singletonList(cert));
    }

    private static Material generate(File dir, File keyFile, File certFile) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(KEY_BITS);
        KeyPair kp = kpg.generateKeyPair();

        Date notBefore = shift(new Date(), Calendar.DAY_OF_MONTH, -1);
        Date notAfter = shift(new Date(), Calendar.YEAR, VALID_YEARS);
        byte[] certDer = DerX509.selfSigned(kp, SUBJECT_CN, notBefore, notAfter);

        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("无法创建密钥目录：" + dir.getAbsolutePath());
        }
        writeAll(new FileOutputStream(keyFile), kp.getPrivate().getEncoded());
        writeAll(new FileOutputStream(certFile), certDer);

        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate cert = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(certDer));
        return new Material(kp.getPrivate(), Collections.singletonList(cert));
    }

    private static Date shift(Date base, int field, int amount) {
        Calendar c = Calendar.getInstance();
        c.setTime(base);
        c.add(field, amount);
        return c.getTime();
    }

    private static byte[] readAll(InputStream is) throws Exception {
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } finally {
            try { is.close(); } catch (Throwable ignore) {}
        }
    }

    private static void writeAll(FileOutputStream os, byte[] data) throws Exception {
        try {
            os.write(data);
            os.flush();
        } finally {
            try { os.close(); } catch (Throwable ignore) {}
        }
    }
}
