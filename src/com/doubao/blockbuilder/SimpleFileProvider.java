package com.doubao.blockbuilder;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;

/**
 * 极简 FileProvider（不依赖 androidx）：把应用私有目录下的 APK
 * 以 content:// 形式共享给系统安装器（高 targetSdk 不允许 file:// 安装）。
 */
public class SimpleFileProvider extends ContentProvider {

    public static final String AUTHORITY = "com.doubao.blockbuilder.fileprovider";

    public static Uri uriFor(File f) {
        return Uri.parse("content://" + AUTHORITY + "/" + Uri.encode(f.getAbsolutePath(), "/"));
    }

    private File fileOf(Uri uri) {
        String p = uri.getEncodedPath();
        if (p != null && p.startsWith("/")) p = p.substring(1);
        return new File(Uri.decode(p));
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        File f = fileOf(uri);
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        String name = fileOf(uri).getName().toLowerCase();
        if (name.endsWith(".apk")) return "application/vnd.android.package-archive";
        // .fast 作品按通用文件类型对外暴露：微信/QQ 对 application/json 过滤较严，
        // 通用字节流可作为“文件”稳定发送；导入端按扩展名识别，不依赖 MIME。
        if (name.endsWith(".fast")) return "application/octet-stream";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/*";
        return "*/*";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        File f = fileOf(uri);
        MatrixCursor c = new MatrixCursor(new String[]{
                OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
        c.addRow(new Object[]{ f.getName(), f.length() });
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
