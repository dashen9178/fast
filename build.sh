#!/usr/bin/env bash
# 积木编程 v1.2：构建竖屏壳 shell.apk、横屏壳 shell-land.apk，再构建编辑器
set -e
cd "$(dirname "$0")"

# JDK17（如路径不同请改这里，或预先 export JAVA_HOME）
export JAVA_HOME="${JAVA_HOME:-/home/user/toolchain/jdk-17.0.13+11}"
export PATH="$JAVA_HOME/bin:$PATH"

BT=../sdk/bt/android-13
ANDROID_JAR=../sdk/pt/android-13/android.jar
APKSIG=$BT/lib/apksigner.jar
D8JAR=$BT/lib/d8.jar
AAPT2=$BT/aapt2
ZIPALIGN=$BT/zipalign
APKSIGNER=$BT/apksigner
chmod +x "$AAPT2" "$ZIPALIGN" "$APKSIGNER" 2>/dev/null || true

# 签名密码：优先读环境变量 FAST_KS_PASS / FAST_KEY_PASS，未设置时用默认值
KS_PASS="${FAST_KS_PASS:-CHANGE_ME}"
KEY_PASS="${FAST_KEY_PASS:-CHANGE_ME}"
STAGE=stage
# 成品目录：默认 ../../fastapk（对应 D:\DSH工作\fastapk），可用 FAST_OUT_DIR 覆盖
OUT="${FAST_OUT_DIR:-../../fastapk}"
rm -rf "$STAGE"; mkdir -p "$STAGE/classes" "$STAGE/dex" "$OUT"

# 版本号规则：VERSION 第 1 行 versionCode 每次 +1（保证可覆盖安装）；
# 第 2 行是上一次的 versionName，打包时把最后一段 +1（1.0.116.1 -> 1.0.116.2）
VC="1"; PREV=""
if [ -f VERSION ]; then
  VC=$(sed -n '1p' VERSION | tr -d '[:space:]')
  PREV=$(sed -n '2p' VERSION | tr -d '[:space:]')
fi
if printf '%s' "$PREV" | grep -Eq '^.*\.[0-9]+$'; then
  VN=$(printf '%s' "$PREV" | awk -F. 'BEGIN{OFS="."} {$(NF)=$(NF)+1; print}')
else
  VN="1.0.$VC.1"
fi
echo "== 本次构建版本：versionCode=$VC  versionName=$VN =="

echo "== [1/8] aapt2 编译资源（图标） =="
"$AAPT2" compile --dir res -o "$STAGE/res.zip"

echo "== [2/8] javac 编译 Java =="
find src -name '*.java' > "$STAGE/srcs.txt"
javac -source 8 -target 8 -nowarn -encoding UTF-8 \
  -classpath "$ANDROID_JAR:$APKSIG" \
  -d "$STAGE/classes" @"$STAGE/srcs.txt" 2>&1 | grep -viE 'bootstrap|obsolete|deprecat|Note:|warning:' || true
echo "编译出的类:"; find "$STAGE/classes" -name '*.class'

echo "== [3/8] d8 生成 classes.dex（含官方 apksig 签名库） =="
find "$STAGE/classes" -name '*.class' > "$STAGE/classes.txt"
java -cp "$D8JAR" com.android.tools.r8.D8 --release --min-api 24 \
  --lib "$ANDROID_JAR" --output "$STAGE/dex" @"$STAGE/classes.txt" "$APKSIG"

echo "== [4/8] 组装资产 =="
rm -rf "$STAGE/shell_assets"; mkdir -p "$STAGE/shell_assets/www"
cp assets/www/runtime.html assets/www/runtime.css assets/www/runtime.js "$STAGE/shell_assets/www/"
cp shell_assets/project.json "$STAGE/shell_assets/project.json"
rm -rf "$STAGE/editor_assets"; mkdir -p "$STAGE/editor_assets"
cp -r assets/www "$STAGE/editor_assets/www"
# 这里刻意不再往编辑器 assets 里放任何签名密钥：
# 导出的作品改由「设备端自己生成的密钥」签名（见 DeviceKey.java），
# 编辑器 APK 里从此不含任何秘密，可以随意分发。

# 通用 link：manifest assetsdir outname res?
# 版本号从工程根 VERSION 文件读取（第一行 versionCode，第二行 versionName）；
# 每次构建后 versionCode 自动 +1 写回，保证每版 APK 版本号递增、可区分。
link_pkg() {
  local cmd=("$AAPT2" link -o "$STAGE/$3" -I "$ANDROID_JAR" \
    --manifest "$1" -A "$2" \
    --min-sdk-version 24 --target-sdk-version 30 \
    --version-code "$VC" --version-name "$VN")
  [ "$4" = "res" ] && cmd+=("$STAGE/res.zip")
  "${cmd[@]}"
}

build_shell() { # manifest 输出名
  link_pkg "$1" "$STAGE/shell_assets" "$2.base.apk" res
  (cd "$STAGE/dex" && zip -q -X "../$2.base.apk" classes.dex)
  "$ZIPALIGN" -f -p 4 "$STAGE/$2.base.apk" "$STAGE/$2"
}

# 竖/横壳清单都由 shell/AndroidManifest.xml 这一份模板生成，唯一差别是 screenOrientation
sed 's/@ORIENTATION@/portrait/'  shell/AndroidManifest.xml > "$STAGE/shell-manifest.xml"
sed 's/@ORIENTATION@/landscape/' shell/AndroidManifest.xml > "$STAGE/shell-land-manifest.xml"

echo "== [5/8] 竖屏壳 shell.apk（含图标资源，未签名，导出时重签） =="
build_shell "$STAGE/shell-manifest.xml" shell.apk
echo "== [6/8] 横屏壳 shell-land.apk =="
build_shell "$STAGE/shell-land-manifest.xml" shell-land.apk
cp "$STAGE/shell.apk" "$STAGE/shell-land.apk" "$STAGE/editor_assets/"

echo "== [7/8] 构建编辑器并签名 =="
link_pkg AndroidManifest.xml "$STAGE/editor_assets" editor_base.apk res
(cd "$STAGE/dex" && zip -q -X ../editor_base.apk classes.dex)
"$ZIPALIGN" -f -p 4 "$STAGE/editor_base.apk" "$STAGE/editor_aligned.apk"
"$APKSIGNER" sign --ks keys/editor.p12 --ks-type PKCS12 \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KEY_PASS" \
  --v1-signing-enabled true --v2-signing-enabled true \
  "$STAGE/editor_aligned.apk"
APK_NAME="FAST_v$VN.apk"
cp "$STAGE/editor_aligned.apk" "$OUT/$APK_NAME"

echo "== [8/8] 校验 =="
"$APKSIGNER" verify --verbose "$OUT/$APK_NAME" | head -6
echo "壳内条目:"; python3 -c "import zipfile;[print(' ',i.filename,i.compress_type,i.file_size) for i in zipfile.ZipFile('$STAGE/shell.apk').infolist()]"
echo "成品：$OUT/$APK_NAME"; ls -la "$OUT/$APK_NAME"

# 构建成功：versionCode 自动 +1，versionName 末段留给下次 +1
printf '%s\n%s\n' "$((VC + 1))" "$VN" > VERSION
echo "== 已递增版本号：下次将使用 versionCode=$((VC + 1))（本次 versionName=$VN）=="
