# Unicode-Atlas · 离线 Unicode 字符百科全书

本地跑的 Unicode 字符浏览器：下载官方 UCD 数据到本地，断网可用；支持从 Unicode 1.1 到最新版的任意版本，可切换、可更新、可删。

## 启动

双击 **`启动 Unicode-Atlas.pyw`**。`.pyw` 由 `pythonw.exe` 运行，**不弹黑色控制台窗口**；脚本探一下本地服务，没起来就用自带的 `runtime\node.exe` 拉起（无窗口、脱离本进程），等 `/api/ping` 就绪后用 `explorer.exe` 把地址交给系统浏览器。

链路是这样：

```
启动 Unicode-Atlas.pyw（pythonw，无控制台）
  → runtime\node.exe src\server.js --port 8731 --no-open --log logs\server.log（CreateNoWindow + DETACHED_PROCESS）
  → explorer.exe "http://127.0.0.1:8731/"（等价于在资源管理器地址栏里敲地址）
```

- 用程序自带的 `runtime\node.exe`，**不需要安装 Node.js**；但 `.pyw` 需要系统里装了 Python（本机是 `Python310`），装的时候勾了「Add to PATH」就行；
- 打开页面交给 `explorer.exe` 而不是 `webbrowser.open()`/ShellExecuteEx：explorer 永远是普通权限，不会触发 Edge 那句「现有实例正在以提升的权限运行」的询问，也不会误关你已经开着的页面；
- 端口已在跑时，脚本探到之后只把页面叫出来，不会起第二份；
- 日志写在 `logs\server.log`（UTF-8），网页里也能看：⚙️ → 运行日志；
- 页面开一条 `/api/live` 的 SSE 长连接当心跳，关掉标签页（或浏览器退出）后 12 秒内连不回来，服务进程自己退出，不留后台端口；用长连接而不是定时轮询，是因为浏览器会把后台标签页的定时器节流，轮询会把「你切走了」误判成「页面关了」。

平时想手动打开：把 `http://127.0.0.1:8731/` 粘到任意浏览器地址栏即可。

关程序：顶栏最右边的 **⏻ 电源按钮** 一键关闭（⚙️ → 关闭程序 也还在），或者直接关掉标签页等它自己退。

### 拷到别的电脑

把整个 `unicode-atlas` 文件夹复制过去即可，`data\`（已装好的 Unicode 版本）和 `runtime\`（Node 运行时）都在里面，**离线可用**；目标机器需要 Python 3（跑 `.pyw` 入口）。

目录体积参考：`runtime\` 81 MB（Node 运行时）、`data\` 76 MB（UCD 原始文本 + 索引 + 字体）、`vendor\fonts\` 46 MB（字体备份）。


### 如果界面没有出现

在浏览器地址栏直接输入 `http://127.0.0.1:8731/`。端口被占时服务会自动往后找（8732、8733…），实际地址看 `logs\server.log` 第一行，或网页里的「运行日志」。

这是 Edge/Chrome 自己的单实例保护：已经有一份**以管理员权限启动**的浏览器在跑，普通权限的进程再去请求它开新标签就会被拦。服务其实已经起来了，只是页面没开。

处理办法，任选其一：

- 点弹窗里的 **「是」**，浏览器会以普通权限重启现有实例，页面立刻打开；
- 或者在任务管理器里结束所有 `msedge.exe` / `chrome.exe`，再双击启动；
- 或者干脆手动在浏览器地址栏输入 `http://127.0.0.1:8731/`。

启动器打开浏览器时，先走 `ShellExecute`，失败再退回资源管理器转发 URL，两种方式能覆盖绝大多数环境。

命令行启动等价于：

```bat
cd /d D:\DSH\unicode-atlas
runtime\node.exe src\server.js
```

浏览器自动打开 `http://127.0.0.1:8731`（端口被占会自动往后找）。加 `--no-open` 不自动开浏览器，`--port N` 指定起始端口。

不需要 `npm install` —— 服务端只用 Node.js 内置模块，零第三方 npm 依赖。

要说清的是：**整份程序不是「零依赖」**，它有两样外部件，但都不用联网装包：

| 依赖 | 谁需要 | 怎么来 |
| --- | --- | --- |
| Node.js 运行时 | 必须 | 程序自带 `runtime\node.exe`，不用另装 |
| Python 3 | 只有 `.pyw` 启动脚本需要 | 系统里的 `pythonw.exe`，只用标准库（`os` / `subprocess` / `urllib.request` / `webbrowser` / `ctypes`），不用 `pip install` 任何东西 |

不想装 Python 也能用：跳过 `.pyw`，直接跑 `runtime\node.exe src\server.js --port 8731`，浏览器打开 `http://127.0.0.1:8731/` 即可——`.pyw` 只是替你把这两步串起来（省掉黑框、顺手打开页面）。

## 界面

三栏布局：

- **左栏**：按官方分类浏览 —— 类别（Lu/Ll/Lo…，按 L/M/N/P/S/Z/C 顶层分组）、区块（Blocks.txt 全部 353 块）、文字系统（Scripts，177 种）、引入版本（DerivedAge，29 个版本）、平面（BMP/SMP/SIP/TIP/SSP/PUA-A/PUA-B）。每组带数量，顶部筛选框可模糊过滤，且同时匹配中文名与英文原名。
- **中栏**：字符网格，滚动自动翻页（每页 200）。格子显示字形 + 码点；控制字符显示 `NUL`/`CR`/`HT` 这类缩写，未分配字符留空，私用区紫字，组合符号加虚线圆框。
- **右栏**：上半是**收集框** —— 用详情页的「加入收集框」把字符放进去，自动拼成一串可直接复制的文本，也可逐条删；下半是**字符档案**。

操作：单击看详情，再用详情页的复制按钮拿走字符。顶栏搜索框可搜名字（`heart` / `empty set` / `龙`）、搜码点（`U+4E2D`、`0x4e2d`、`4e2d`）、或直接粘贴一个字符查它自己。收集框与「收集历史」都存在 localStorage，刷新不丢。

顶栏最右边的 **⚙️ 齿轮** 是设置菜单：版本选择与版本管理、语言切换（中 / EN，所有类别、区块、文字系统、平面都有中文名，353 块 + 177 种文字全覆盖）、Emoji 字体（Noto 彩色 / 系统彩色）、检查更新、字体包检查、花体英文生成器、使用教程、运行日志、关闭程序。齿轮右边还有一个 **⏻ 电源按钮**，一键关掉服务，不用翻菜单。

关程序调的是 `POST /api/shutdown`，让本地服务真的退出（不是只关标签页），关掉后整页显示「Unicode-Atlas 已关闭」。

## 字符名的大小写

UCD 里的正式名是全大写的（`LATIN CAPITAL LETTER A`），直接铺在界面上很吵。界面统一走 `titleCase()` 转成标题式（`Latin Capital Letter A`），但保留三类原样：

- 码点段（`4E00`、`1F600`、`10FFFF` 这类含数字的 4–6 位段）
- 真缩写（`CJK`、`GA`、`VS`、`VF`、`IPA`）
- 其余短词照常转换（`EMPTY SET` → `Empty Set`，不是 `Empty SET`）

原始全大写名在搜索索引里仍然参与匹配，搜 `CJK UNIFIED` 照样命中。

## 字符档案包含

- 码点 / UTF-8 / UTF-16 / 十进制、字符类别（含中英名）、区块、文字系统、引入版本、平面
- 双向类别、组合类别、East Asian Width、Line Break、分解映射、数值
- 大小写三映射、大小写折叠（C/S/F/T 四种）、条件特殊大小写
- 正式名、旧名（Unicode 1.0）、ISO 注释、别名（correction/control/abbreviation…）、等价名
- **所有共享同一码点的字形**：`StandardizedVariants.txt` 的变体序列（如 U+2764 的文字样式 / Emoji 样式）、emoji 变体序列、Unihan 异体字

字形栏把原形与所有变体并列成卡片，每张卡只有一个「复制」按钮：复制原形只带走基本字符，复制变体序列会多带一个不可见的变体选择符（`U+FE0E`/`U+FE0F`/`U+E0100+`），对方看到的就是你想要的那个字形。变体不进收集框，但每次复制都会按原形码点记进历史。

详情顶部有一个**「当前字符」字体选择框**，只列真的含有这个码点字形的字体（服务端读字体文件的 `cmap` 表判断，不靠猜）。换字体是**按字符记的**：只改这一个字符——右侧详情卡的主字形与全部变体卡，以及网格里这一格的字形；别的字符不受影响。缺字形的字符仍回退到原来的字体栈，不至于变成豆腐块。

这个记忆只活在这一页里：不写 localStorage，切换字符、切换区块、切换分类都不会丢，关掉程序（或刷新页面）就全忘了。想马上清掉，用 ⚙️ →「恢复默认字体」。

排序固定为 Noto 系列 → Times New Roman → 宋体 → 其余本机字体，不支持该字符的字体不出现在详情下拉里。扫描范围是 `data/fonts/` 的 Noto 字体包，加 `C:\Windows\Fonts` 和当前用户自己装的 `%LOCALAPPDATA%\Microsoft\Windows\Fonts`；字体名取 `name` 表里的中文名（`楷体`、`宋体`），CSS 那边仍用英文家族名（`KaiTi`、`SimSun`），所以清单里不会出现一排看不懂的拼音。只读不装，首次扫描约 2–4 秒，之后走内存缓存。

页面开着一条 `/api/live` 的 SSE 长连接：标签页关掉（或浏览器退出）后 12 秒内没有新连接，服务进程自己退出，不在后台留端口；开着多个标签页时只要还有一个连着就继续跑。放在后台不管、切到别的应用去也都算「还开着」。

- 注释：`NamesList.txt` 的说明与交叉引用
- **Unihan**：释义（英文）、普通话拼音、粤语、日语音读训读、韩语、越南语、笔画数、部首笔画、等级
- **CLDR 中文**：emoji 与符号的中文名与关键词（`红心`、`嘿嘿`、`彩虹旗`）

## 版本管理

顶栏「版本管理」：

- **已安装**：每个版本显示字符数、是否含 Unihan/CLDR、索引大小、安装时间；可切换查看、可删除
- **安装新版本**：填版本号（或选下拉建议，来自 unicode.org 的发布目录列表），可选是否带 Unihan（约 8 MB）与 CLDR 中文注释（约 50 KB）
- **检查更新**：读 `unicode.org/Public/UCD/latest/ucd/` 里 Blocks.txt 的文件头拿版本号（只拉 400 字节，用 HTTP Range），与本地比对
- **Noto 字体包**：一键下载 206 个 Noto 字体（清单声明约 27 MB，磁盘实测约 46 MB —— 其中 Noto Sans CJK SC 单个就有 15.7 MB），全部落在 `data/fonts/`。装好后 `/fonts.css` 会为每个已装字体生成 `@font-face`（家族名 `NA-<Family>`），并用 `--glyph-font` 把它们按优先级排进字符显示字体栈：符号字体优先，然后是 Noto Sans、Noto Sans CJK SC，最后才回退到系统字体。没装的字体不会写进 CSS，因此不会有一堆 404。下载是串行 + 失败重试 3 次，进度在弹窗里轮询显示，装完自动刷新页面。少数 Unicode 18 新区块（小篆、遗产计算符号补充、西里尔扩展 D、Ol Onal、Garay）Noto 尚未发布字体，这些字符仍会显示方框。

安装流程：优先拉 `UCD.zip` 一次拿全部（解压到内存按文件名匹配），老版本没有 zip 就按目录索引逐个下载。装完写 `index.json.gz`（gzip）和 `manifest.json`，最后把该版本设为默认（已有默认则不改）。

数据落盘在 `data/`：

```
data/
  state.json                 默认版本、上次检查时间
  cldr/{zh,en}.json          CLDR 注释（跨版本共用，按 npm 上的最新 tag 取）
  fonts/*.ttf|otf|woff2      Noto 字体包（跨版本共用）
  versions/<版本>/
    manifest.json            字符数、来源文件、缺失文件、体积
    index.json.gz            构建好的紧凑索引
    raw/*.txt|zip            原始 UCD 文件（保留，便于重建/审计）
```

`raw/` 是原样保存的官方文件，想重建索引不需要重新下载。

## 各版本的数据差异

老版本发布时还没有现在这些文件，程序会如实标注「该版本原有 N 类数据文件未发布」：

| 版本 | 可用核心文件 | 说明 |
|---|---|---|
| 1.1 | 只有 UnicodeData | 没有区块、没有引入版本、没有注释 |
| 2.0–2.1 | +Blocks/NamesList/PropList | |
| 3.0 | +EastAsianWidth/SpecialCasing/LineBreak | |
| 3.1 | +Scripts/CaseFolding/DerivedCoreProperties | |
| 3.2 | +DerivedAge/BidiMirroring | 引入版本从这里开始有 |
| 4.0 | +StandardizedVariants/HangulSyllableType | |
| 4.1 | +Unihan | |
| 5.0 | +NameAliases | 控制字符名从这版起有别名 |
| 6.0+ | +DerivedName | 此前 CJK/谚文的名字靠规则生成（程序内置算法，不缺名） |

实测安装耗时（本机，含网络）：18.0.0 约 25 秒（312,389 字符），15.1.0 约 20 秒（289,394），4.1.0 约 15 秒（237,236）。

## 数据来源

- UCD：`https://www.unicode.org/Public/{版本}/ucd/`（`latest` 永远指向最新）
- 名字：`extracted/DerivedName.txt` 是权威来源（UnicodeData 里 CJK/谚文是 `<CJK Ideograph, First>` 这类区间占位）
- CLDR 中文：`cldr-annotations-full` 的 `annotations/zh`（jsDelivr CDN）
- 不需要任何 API key，也不经过第三方代理

## 代码结构

```
src/
  server.js     静态服务 + 端口选择 + 自动开浏览器
  http.js       路由与请求处理
  vendor.js     下载/安装/更新检测/版本状态
  source.js     UCD 目录发现与文件定位（含老版本文件名差异）
  zip.js        最小 ZIP 解析（中央目录 + inflateRaw）
  parsers.js    各 UCD 文本格式解析器
  build.js      索引构建（紧凑短键 + 区间索引）
  db.js         查询：搜索、过滤、分页、单字符详情
  fonts.js      Noto 字体包：下载、状态、动态生成 /fonts.css（优先从 vendor/fonts 备份复制）
  fonts-data.js 206 个字体的清单（家族名、文件名、体积、URL）
  constants.js  类别/双向/平面等对照表
  paths.js      路径
vendor/fonts/   206 个 Noto 字体文件的本地备份（约 46 MB，随程序分发，断网也能装）
public/
  index.html / style.css / app.js
  names-zh.js   区块/文字系统/类别/平面的中文名 + 中英切换用的取值函数
  stylize.js    花体英文生成器的 18 种映射（数学字母块 + 缺口补字）
tools/
  make-icon.mjs        生成 app.ico（手写 PNG + ICO 封装，Unicode 风格的蓝底白 U）
runtime/
  node.exe             便携 Node.js 运行时（81 MB，程序自带，不需要另装）
app.ico        程序图标
启动 Unicode-Atlas.pyw  启动入口
```

## HTTP API

只监听回环地址。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 存活 + 当前版本 |
| GET | `/api/meta` | 分类/区块/文字/年龄/平面清单与计数 |
| GET | `/api/versions` | 已安装版本、当前版本、上次检查 |
| GET | `/api/releases` | unicode.org 上所有发布目录名 |
| POST | `/api/check-update` | 探测最新版本 |
| POST | `/api/install` | `{version, includeUnihan, includeCldr}`，后台跑，立即返回 |
| GET | `/api/install/status` | 安装进度与日志 |
| POST | `/api/switch` | `{version}` 切换当前查看的版本 |
| POST | `/api/versions/remove` | `{version}` 删除 |
| POST | `/api/versions/default` | `{version}` 设为默认 |
| GET | `/api/chars` | `q, block, gc, script, age, plane, offset, limit, unassigned` |
| GET | `/api/char/:hex` | 单字符完整档案 |
| GET | `/api/fonts` | Noto 字体包状态（已装/总数/体积/缺失清单/下载任务） |
| POST | `/api/fonts/install` | `{force}`，后台串行下载，立即返回 202 |
| GET | `/api/fonts/status` | 下载进度（done/total/current/error） |
| GET | `/fonts.css` | 动态生成：已装字体的 `@font-face` + `--glyph-font` |
| GET | `/fonts/<file>` | 字体文件，支持 Range（206） |
| POST | `/api/shutdown` | 关闭本地服务 |

## 已知取舍

- **汉字没有中文释义**：Unihan 的 `kDefinition` 是英文，CLDR 不覆盖汉字；中文部分只有拼音（`kMandarin`）与部首笔画。要有中文释义得另接 CC-CEDICT 之类的词典。
- **字体靠 Noto 包 + 系统兜底**：装完 Noto 字体包（206 个，磁盘约 46 MB）后绝大多数已知字符都能显示；仍未收录的才会回退到系统字体、再不行显示豆腐块。这是字体问题，不是数据问题 —— 程序始终给出码点和名字。
- **历史（收集历史）只有 300 条**（localStorage 上限），超出丢最旧。只记录真正进了收集框的字符，单纯点开看一眼不进历史。
- **Noto 字体包不分档**：没有做「按需下载某一块的字体」，因为按块拆分会把 CJK 这种巨型字体反复拆开；一次性全下最省事，且可离线复用。
- **字体有本地备份**：`vendor/fonts/` 里存着 206 个字体文件（约 46 MB）。装包时程序先从这里复制，复制不到才走网络 —— 所以断网、换机器、重装数据目录都能立刻补齐，不必重新下载。
- 未分配码点默认隐藏。点开某个区块后，左上角会出现「含未分配」勾选框（默认不勾），勾上把该区块里还没分配的码点也铺进网格，用来观察区块内的空洞和保留区；退出区块视图时它自动隐藏。

## 界面操作

- 左栏五类索引（分类 / 区块 / 文字 / 版本 / 平面），顶部可切中英文名；中文名的英文原名放在悬停提示里。
- 中间方格：单击选中并在右栏看完整档案；鼠标停留 0.4 秒弹出圆角预览卡（字形、名字、码点、类别、区块、中文释义）。方格上没有加号，也没有双击 —— 拿走字符要走详情页的复制按钮。
- 右栏上半是收集框：字符逐个 chip 排列，拼成的文本可一键复制；下半是档案（编码、DLE、大小写、分解、**字形栏**、注释、别名、CLDR 中文、Unihan）。
- **字形栏**是每个字符都有的区块：普通字符只有一张原形卡，有变体的字符（阿拉伯文按词位分独立/词首/词中/词尾形、蒙古文变体序列、CJK 兼容字与全半角、Unihan 简繁异体、汉字的中日韩标准字形）全部并列成卡片，每张卡只有一个「复制」按钮，不能把变体塞进收集框。
- 右上角 ⚙️ 设置菜单：Unicode 版本选择、版本管理、中英切换、检查更新、字体包检查、**花体英文生成器**、Emoji 字形（系统彩色 / Noto 单色）、关闭程序。
- 复制任何字形（含变体序列、异体字）都记进历史，且一律记在原形码点名下 —— 复制的是 `❤️`（U+2764 U+FE0F），历史里出现的是 U+2764。
- **同一个字符可以重复放进收集框**：详情页的「加入收集框」每点一次就多一份（按钮上会显示「已有 N」），要删就去收集框里点对应的 chip，按位置删、不会误删同一字符的其他份。历史按码点去重，以最近一次选取为准。
- **花体英文生成器**（设置 → 花体英文生成器）：输入拉丁字母或数字，实时给出 18 种风格 —— 粗体、斜体、粗斜体、花体、粗花体、哥特体、粗哥特体、空心体、无衬线、粗无衬线、等宽、小型大写、圆圈、方框、全角、上标、下标、倒置，每行一个复制按钮。这些是 Unicode 里各自独立编码的字形，复制到别处外观不变；小写方块字母、部分上下标在 Unicode 里没有编码，会原样保留。
- **使用教程**（设置 → 使用教程…，或按 <kbd>?</kbd> / <kbd>F1</kbd>）：内置一份分九节的操作说明 —— 这是什么、怎么找字符、方格怎么看、收集框与档案、字形栏、版本、字体、花体生成器、中英切换与历史、常见问题。
- **关于**（设置 → 关于…）：版本号、当前加载的 UCD 版本、数据来源（UCD / Unihan / CLDR / Noto）、技术栈、许可与致谢。

