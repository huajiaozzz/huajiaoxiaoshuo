# 花椒写作平台

本地优先的 AI 长篇小说创作工作台。人物、世界观、伏笔、时间线都是可被 AI 读取的结构化资产，
每次生成都会自动组装正确的上下文 —— 目标是让 AI 写出来的东西不用大改。

- 前端：React 19 · TypeScript · Tailwind CSS v4 · Vite 8
- UI：Animate UI（弹窗/气泡/按钮/数字等动画原语，源码在 `src/components/animate-ui`）+ 自研控件 `src/components/kit`，动效引擎 motion
- 存储：浏览器 IndexedDB（Dexie），**数据不出本机**；可导出 JSON 全量备份
  - 桌面版自动改用本机 **SQLite**（`src/db/adapter/*`），业务代码同一套；表结构从 `schema.ts` 的 `DB_STORES` 单一来源推导
- 模型：DeepSeek / OpenAI / Kimi / 智谱 / 通义 / 硅基流动 / OpenRouter / Ollama / LM Studio / 任意 OpenAI 兼容服务
- 桌面端：Tauri 2（Mac / Windows），与网页版同一份构建产物

## 桌面版安装

安装包在 [Releases](https://github.com/huajiaozzz/huajiaoxiaoshuo/releases) 页面，打 `v*` tag 后 CI
自动构建挂上：Mac 是两个 dmg（Apple Silicon 选 `aarch64`、Intel 选 `x64`），Windows 选
`setup.exe`（NSIS）或 `.msi`，安装界面均为简体中文。

**Mac 首次打开**：安装包没有做 Apple 签名与公证，Gatekeeper 会弹「无法验证 HuajiaoWriter.app」——
这不是应用坏了。点「完成」关掉弹窗 → 系统设置 → 隐私与安全性 → 拉到底点「**仍要打开**」→「打开」。
例外记住后以后双击直接启动；也可以终端一步到位：

```bash
xattr -cr /Applications/HuajiaoWriter.app   # 应用拖到了别的位置就换成对应路径
```

**Windows 首次打开**：SmartScreen 会提示「Windows 已保护你的电脑」——点「更多信息」→「仍要运行」。

## 快速开始

```bash
npm install
npm run dev            # http://127.0.0.1:5178
```

首次使用：右上角「设置 → 模型与 AI」选一个供应商、填 API Key（本地模型无需 Key）、点「测试连接」，
再在顶部选择模型即可。也可以「设置 → 任务路由」为不同任务指定不同模型。

没有 API Key 也能验证整条 AI 链路：

```bash
node scripts/mock-llm.mjs 8765   # 启动本地假模型
# 然后在设置里新增供应商：名称任意，地址 http://127.0.0.1:8765/v1，模型 mock-story-model
```

## 写作记忆（可插拔）

默认只用**本地写作记忆**：你能看见每一条、知道出处、能改能删能暂停，不做黑箱。
记忆多了之后可以在「设置 → 写作记忆」按需挂外挂，全部默认关闭、连不上就静默退回本地链路：

| 系统 | 用途 | 怎么用 |
|---|---|---|
| 语义召回 | 按「当前在写什么」找最相关的记忆 | 一键启用，需要本机 Ollama 或支持 /embeddings 的供应商 |
| OpenViking | 分级存放 + 目录式检索，记忆很多时更准更省 token | 用**火山引擎托管版**（控制台开通、建库、填 API Key）或本地自建 `openviking-server` |
| MindMemOS | 开源记忆操作系统，自动抽取 / 去重 / 合并 | 官方云 `mindmemos.cn` 申请 Key，或本地自建（`make dev`，默认 :8000） |
| Hindsight | 跨书长期记忆 + 自动归纳，适合系列文 | 云端申请 Key + 建 bank |

云端记忆大多不支持浏览器跨域，线上站点自带受限转发（只放行这些记忆服务域名、只服务本站），
填个 Key 就能用；本机开发时跑 `npm run proxy` 即可。数据流向始终是「浏览器 → 你的转发 → 目标服务」。

## 目录结构

```
src/
  core/        领域模型（无依赖，桌面端可复用）
  db/          Dexie 表结构与仓储层（唯一的数据读写入口）
  ai/          供应商适配、上下文组装、JSON 修复、创作与质量能力、抽取与成书流水线
  utils/       文本/字数/diff/token 预算/文风分析等纯函数
  app/         全局状态、路由、数据订阅 hooks
  components/  共享 UI（脚手架、通知、命令面板）
  features/    各功能页面（editor / outline / characters / world / threads / timeline / graph /
               insights / consistency / ai / genesis / usage / data / settings）
scripts/       mock-llm（假模型）、ai-e2e（AI 链路验证）、shot（截图排查）
docs/          GOTCHAS（陷阱与约定）
```

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 生产构建 |
| `npx tsc -b --force` | 全量类型检查 |
| `npm run verify` | 纯函数测试（28 项） |
| `npm run verify:zip` | ZIP 写入器校验（对照 Python zipfile） |
| `npm run verify:ebook` | EPUB / DOCX 格式校验 |
| `npm run verify:conflict` | 冲突判定 + 审稿报告生成（纯函数 49 项 + DOCX 规范校验） |
| `npm run verify:units` | 单元测试：锚点定位 / 文风分析 / 记忆冲突（42 项） |
| `node scripts/verify-sqlite-adapter.mjs` | 桌面端 SQLite 适配层（53 项，假 driver） |
| `node scripts/run-all-verify.mjs` | 批量跑所有回归并汇总绿 / 跳过 / 红 |
| `npm run mock-llm` | 启动本地假模型（无需 API Key） |
| `npm run e2e:ai` | AI 链路端到端 |
| `npm run proxy` | 本地转发（给不支持 CORS 的模型/记忆服务用） |
| `npm run release` | 按更新日志发 GitHub Release（含 tag） |
| `npm run tauri:build` | 打包 Mac / Windows 桌面端 |
| `npm run lint` | oxlint |

## 支持的导出格式

| 格式 | 用途 |
|---|---|
| **EPUB 3** | 阅读器、自出版（规范级：mimetype 首位不压缩、nav + NCX、OPF 元数据） |
| **DOCX** | 投稿给编辑（真 OOXML，A4 页面、中文首行缩进、章节分页） |
| TXT / Markdown / HTML | 通用投稿、Obsidian/Notion、打印成 PDF |
| JSON | 全量结构化备份，可原样恢复 |

ZIP 与 EPUB/DOCX 都是自研实现（`src/features/data/zip.ts`、`ebook.ts`），零第三方依赖，校验方式见 `scripts/verify-zip.mjs` / `verify-ebook.mjs`。

## 发版流程

更新日志只有一个数据源：`src/core/changelog.ts`。应用内「关于 → 更新日志」和 GitHub Release
都从它生成，改一处两边同步，不要另开一份。

```bash
# 1. 在 src/core/changelog.ts 加一条版本；顺手把 APP_VERSION 改成同一个号
# 2. 提交推送
# 3. 发 Release（自动打 tag、标题用 headline、正文用条目、含 Full Changelog 对比链接）
npm run release                # 发 APP_VERSION
npm run release -- 0.13.0      # 或指定版本
npm run release -- 0.13.0 --dry-run   # 先看再发
```

打 `v*` tag 会触发桌面端 CI，Mac / Windows 安装包自动挂到对应 Release 的附件里。

## 数据安全

作品全部存在浏览器 IndexedDB 里。浏览器「清除浏览数据」会连带清掉，
所以请在「数据与导出」页定期生成备份文件（支持 gzip 压缩）另存到磁盘。

AI 调用只发送**必要上下文**，每次生成后可以在「AI 用量」里看到具体带了哪些来源、各花多少 token。
「设置 → 隐私」里关闭云端后，只允许本机模型参与生成。

详见 [ROADMAP.md](ROADMAP.md) 与 [docs/GOTCHAS.md](docs/GOTCHAS.md)。
