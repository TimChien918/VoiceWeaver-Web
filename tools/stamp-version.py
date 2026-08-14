#!/usr/bin/env python3
"""把版本戳寫進所有靜態資源的網址，讓瀏覽器一定拿得到新版。

沒有打包流程的純靜態站有個老問題：改了 JS/CSS，回訪的使用者還是吃到快取的舊檔，
畫面看起來像沒更新。ES module 的相對 import 各自有自己的網址，所以只在 index.html
的 <script> 加版本沒用——底下 import 進去的模組還是舊的。

做法：把每個相對 import、以及 index.html 裡的 css/js 網址，統一補上 ?v=<版本>。
先剝掉舊的版本戳再加新的，所以可以重複執行。

用法（發布前跑一次）：
    python3 tools/stamp-version.py 1.4.1
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def stamp(url: str, ver: str) -> str:
    base = url.split("?", 1)[0]
    return f"{base}?v={ver}"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    ver = sys.argv[1].strip()

    changed = []

    # 1. JS 模組之間的相對 import / export ... from "./x.js"
    for f in sorted((ROOT / "js").glob("*.js")):
        src = f.read_text(encoding="utf-8")
        new = re.sub(
            r'(\bfrom\s+")(\.{1,2}/[^"?]+\.js)(?:\?v=[^"]*)?(")',
            lambda m: m.group(1) + stamp(m.group(2), ver) + m.group(3),
            src,
        )
        # 動態 import("./x.js") 也一起處理
        new = re.sub(
            r'(\bimport\(\s*")(\.{1,2}/[^"?]+\.js)(?:\?v=[^"]*)?(")',
            lambda m: m.group(1) + stamp(m.group(2), ver) + m.group(3),
            new,
        )
        if new != src:
            f.write_text(new, encoding="utf-8")
            changed.append(f.name)

    # 2. index.html 的 stylesheet 與 entry script
    idx = ROOT / "index.html"
    html = idx.read_text(encoding="utf-8")
    new_html = re.sub(
        r'(<link[^>]+href=")([^"?]+\.css)(?:\?v=[^"]*)?(")',
        lambda m: m.group(1) + stamp(m.group(2), ver) + m.group(3),
        html,
    )
    new_html = re.sub(
        r'(<script[^>]+src=")([^"?]+\.js)(?:\?v=[^"]*)?(")',
        lambda m: m.group(1) + stamp(m.group(2), ver) + m.group(3),
        new_html,
    )
    # 3. 看得見的版本號。跟 ?v= 同一次更新，才不會出現「畫面說 1.5.7x、
    #    載進去的模組卻是另一版」——那比沒有版本號更會誤導人。
    new_html = re.sub(
        r'(<meta name="app-version" content=")([^"]*)(")',
        lambda m: m.group(1) + ver + m.group(3),
        new_html,
    )
    if new_html != html:
        idx.write_text(new_html, encoding="utf-8")
        changed.append("index.html")

    print(f"版本戳 v={ver}：更新 {len(changed)} 個檔案")
    for name in changed:
        print("  ", name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
