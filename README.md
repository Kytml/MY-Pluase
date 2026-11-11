# 录音机（Voice Recorder）

一个**纯本地、零依赖**的网页录音机：开始 / 暂停 / 继续 / 停止录音，自动保存到浏览器本地数据库，支持播放、重命名、删除、下载备份与多标签页同步。

- **零运行时依赖**：不需要 `npm install`，克隆后一条命令即可使用
- **隐私优先**：音频只存在本机浏览器 IndexedDB，不上传任何服务器
- **工程化**：`lib`（纯逻辑）/ `core`（录音、存储、播放、同步）/ `ui`（视图）分层，32 项单元测试 + 15 项真实浏览器端到端测试

---

## 功能特性

| 分类 | 能力 |
| --- | --- |
| 录音 | 开始、暂停、继续、停止并保存；暂停时段不计入时长；实时音量波形与大号计时器 |
| 录音管理 | 列表展示名称、录制时间、时长、文件大小、总条数与总时长 |
| 播放 | 底部播放条，播放 / 暂停 / 拖动进度；修复 Chrome WebM 缺少时长元数据导致的进度条失效 |
| 编辑 | 行内重命名（回车保存、Esc 取消、非法输入就地提示）、删除二次确认、一键下载备份 |
| 持久化 | 录音 Blob + 元数据写入 IndexedDB，刷新或重开浏览器不丢失；数据库不可用时降级为内存模式并明确警告 |
| 多标签页 | 基于 BroadcastChannel，一个标签页增删改，其他标签页列表自动同步 |
| 可配置 | 码率、音频处理（回声消除 / 降噪 / 自动增益）、最长录音时长自动停止、命名前缀、停止后自动下载、浅色 / 深色 / 跟随系统主题 |
| 异常处理 | 权限被拒、无设备、设备被占用、录制中断开、空录音、存储不可用、配额不足、非安全上下文，均给出原因与处理建议 |
| 快捷键 | `空格` 暂停 / 继续，`Esc` 关闭播放条，`Enter` 保存重命名 |

## 在线体验

已部署到 GitHub Pages：**https://kytml.github.io/MY-Pluase/**

HTTPS 安全上下文下可直接录音，无需本地启动服务。在线版与本地版的录音数据相互独立（浏览器按源隔离存储）。

## 快速开始

要求：**Node.js 20+**（端到端测试需要 22+），或仅有 **Python 3** 也可以运行。

```bash
git clone https://github.com/Kytml/MY-Pluase.git
cd MY-Pluase
npm start          # 等价于 node server.mjs，无需 npm install
```

启动后自动打开 `http://127.0.0.1:8168/`（端口被占用时自动向后尝试 20 个）。

其他方式：

```bash
node server.mjs --port=9000 --no-open   # 指定端口、不自动打开浏览器
python start.py                          # 无 Node.js 时的备选启动器
```

Windows 用户也可以直接**双击 `start.bat`**（优先 Node，其次 Python）。

> ⚠️ 不要直接双击 `index.html` 使用。ES 模块在 `file://` 下会被浏览器拦截，麦克风与本地存储也可能受限；页面会显示相应引导。

## 使用示例

1. 点击 **开始录音**，在浏览器弹窗中允许使用麦克风；右上角徽章显示设备状态。
2. 录音中可 **暂停**（计时与音频同时停止累积），再点 **继续** 接着录。
3. 点 **停止并保存**，录音出现在下方列表：`名称 / 录制时间 / 时长 / 大小`。
4. 点击列表左侧圆形按钮播放，底部出现播放条，可拖动进度、暂停、关闭。
5. **重命名**：点击后行内编辑，回车保存；空白或超长名称会被拒绝并提示原因。
6. **删除**：点击后需再确认一次，避免误删；**下载**：按录音名生成合法文件名保存到电脑。
7. 点击右上角 **设置** 调整参数；设置保存在 `localStorage`，录音相关选项在下一次录音时生效。

## 配置说明

设置项持久化在 `localStorage` 的 `voice-recorder:config:v1` 键中。非法值会被拒绝（设置面板）或回退为默认值并提示（读取时）。

| 配置项 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- |
| `namePrefix` | `录音` | ≤ 20 字符 | 新录音命名为「前缀 + 录制时间」 |
| `audioBitsPerSecond` | `128000` | 16000–512000 | 面板提供 64 / 96 / 128 / 192 / 256 kbps |
| `maxDurationSec` | `0` | 0–86400 | 最长录音时长（秒），0 不限；到达上限自动停止并保存 |
| `echoCancellation` | `true` | 布尔 | 回声消除 |
| `noiseSuppression` | `true` | 布尔 | 降噪 |
| `autoGainControl` | `true` | 布尔 | 自动增益 |
| `autoDownload` | `false` | 布尔 | 停止后自动下载备份到电脑 |
| `theme` | `system` | `system` / `light` / `dark` | 界面主题 |
| `timesliceMs` | `1000` | 100–10000 | MediaRecorder 分片间隔（高级项，面板未暴露） |
| `mimePreference` | 见 `src/lib/config.js` | MIME 数组 | 录制格式优先级（高级项，面板未暴露） |

高级项可在 `src/lib/config.js` 的 `DEFAULTS` 中修改，或写入上述 localStorage 键。

## 数据与隐私

- 录音保存在 IndexedDB：数据库 `voice-recorder`，对象仓库 `recordings`，包含音频 Blob 与元数据。
- 数据按 **源（origin）隔离**：`http://127.0.0.1:8168` 与其他端口 / 域名的录音互不可见，请固定使用同一种方式打开。
- **清理浏览器网站数据会删除录音**；隐私模式或禁用 IndexedDB 时会降级为内存模式（关闭页面即丢失），界面会明确警告，请及时「下载」备份。
- 设置面板底部显示当前存储方式与 `navigator.storage.estimate()` 的用量 / 配额估计。

## 浏览器兼容性

| 浏览器 | 支持情况 |
| --- | --- |
| Chrome / Edge（推荐） | 完整支持，输出 `audio/webm;codecs=opus` |
| Firefox | 完整支持，输出 `audio/ogg;codecs=opus` 或 WebM |
| Safari | 基本支持，输出 `audio/mp4`；暂停能力取决于系统版本 |

必须通过 **安全上下文**访问：`http://127.0.0.1` / `localhost` 或 `https`。部署到静态托管（GitHub Pages、Nginx 等）时，HTTPS 下可直接使用，无需后端。

## 开发指南

### 目录结构

```
├── index.html               # 页面结构、file:// 直开引导
├── styles/main.css          # 浅色/深色双主题，CSS 变量驱动
├── src/
│   ├── main.js              # 入口：组装 core 与 ui，唯一负责跨模块协作
│   ├── lib/                 # 纯逻辑，无 DOM 依赖，可在 Node 中单测
│   │   ├── clock.js         #   计时器（时间戳差值，暂停不计时、后台不漂移）
│   │   ├── config.js        #   配置默认值、范围校验、localStorage 读写
│   │   ├── validate.js      #   名称/前缀输入校验
│   │   ├── format.js        #   时长、大小、日期、安全文件名
│   │   └── emitter.js       #   极简事件发射器
│   ├── core/                # 浏览器能力封装，不碰 DOM
│   │   ├── recorder.js      #   录音状态机 idle→starting→recording⇄paused→stopping→idle
│   │   ├── storage.js       #   IndexedDB 仓储 + 内存降级 + 用量估计
│   │   ├── player.js        #   播放控制、objectURL 生命周期、时长回填
│   │   ├── sync.js          #   BroadcastChannel 多标签同步
│   │   └── errors.js        #   错误归一化为带 code 的 RecorderError
│   └── ui/                  # 视图层，业务动作通过回调上抛
│       ├── record-list.js   #   列表渲染、行内重命名、删除确认
│       ├── settings-dialog.js # 设置面板（先校验后保存）
│       ├── waveform.js      #   频谱波形
│       ├── notifier.js      #   通知条（错误常驻，成功自动消失）
│       └── dom.js           #   DOM 构建（统一 textContent，防 XSS）
├── server.mjs               # 零依赖静态服务器（仅 127.0.0.1、防目录遍历）
├── start.py / start.bat     # Python 启动器 / Windows 一键启动
├── scripts/check.mjs        # 语法、控制字符、资源引用、README 章节检查
└── tests/
    ├── unit/                # node:test 单元测试（32 项）
    └── e2e/                 # CDP 驱动的真实浏览器测试（15 项）
        ├── harness.js       #   浏览器/服务启动、CDP 客户端
        └── run.mjs          #   测试用例
```

### 关键设计

- **计时用时间戳差值**（`ElapsedClock`）而非 `setInterval` 计数：后台标签页降频不会导致时长漂移，暂停时段天然排除。
- **等 `onstop` 后再释放麦克风**：`stop()` 只触发停止，音频 Blob 的组装、设备释放在 `onstop` 回调中完成，避免丢失最后一帧。
- **进度条不依赖媒体元数据**：Chrome 录制的 WebM 常 `duration = Infinity`，播放器优先使用录音时自算的时长，元数据可用时再回填。
- **脏数据不入库**：所有配置经 `validateConfig`，所有名称经 `validateRecordingName`，列表读取时过滤缺字段记录。
- **多标签一致性**：写操作后 `TabSync.notify()`，其他标签页防抖刷新；当前播放的记录被删除时自动关闭播放条。

### 新增一个配置项

1. 在 `src/lib/config.js` 的 `DEFAULTS` / `LIMITS` 中声明默认值与范围，并在 `validateConfig` 中补校验。
2. 在 `src/ui/settings-dialog.js` 添加表单控件并加入 `#collect()`。
3. 在 `src/core/recorder.js`（或对应模块）读取使用。
4. 在 `tests/unit/config.test.js` 补充合法 / 非法用例。

## 测试与质量检查

```bash
npm test           # 单元测试：32 项，纯 Node，无需浏览器
npm run test:e2e   # 端到端测试：15 项，真实 Chrome + 模拟麦克风
npm run test:all   # 依次执行两者
npm run check      # 语法、控制字符、资源引用、README 章节检查
```

E2E 说明：

- 自动探测 Chrome / Edge / Chromium，也可用 `CHROME_PATH` 环境变量指定。
- 通过 `--use-fake-device-for-media-stream` 提供模拟麦克风，**不需要真实录音设备**。
- 权限拒绝、设备不存在等异常通过 `Page.addScriptToEvaluateOnNewDocument` 注入故障来验证。
- 未安装浏览器或 Node < 22 时输出 `SKIP` 并以 0 退出，不会误报失败。
- 覆盖：录音全流程、刷新后持久化、播放、重命名校验与持久化、删除二次确认、下载真实落盘、设置持久化与非法输入、最长时长自动停止、权限 / 设备异常、多标签同步、全程无 JS 错误。

## 已知限制

- 录音格式由浏览器决定（WebM / Ogg / M4A），本项目不做转码；需要 MP3 可下载后用 FFmpeg 转换。
- 长时间录音受浏览器存储配额与内存限制，建议重要长录音分段录制并及时下载备份。
- 多标签同步依赖 BroadcastChannel，不支持的旧浏览器会自动降级为各标签页独立显示。

## 发布到 GitHub

```bash
git init
git add .
git commit -m "feat: 本地网页录音机 v1.0.0"
git branch -M main
git remote add origin https://github.com/Kytml/MY-Pluase.git
git push -u origin main
```

`.gitignore` 已排除 `node_modules/`、测试临时目录与本地工作区数据。仓库同时包含 `LICENSE`（MIT）。

## License

[MIT](./LICENSE)
