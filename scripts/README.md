# 验证与辅助脚本

所有脚本都不依赖外部服务，可离线复跑。

| 脚本 | 作用 | 命令 |
|---|---|---|
| `verify-utils.mjs` | 纯函数测试：变体扫描（2/3/4 字名）、中文字数、分章、diff、token 预算、JSON 容错 | `npm run verify` |
| `verify-zip.mjs` | 自研 ZIP 写入器校验：对照 Python `zipfile` 检查 CRC、中央目录、UTF-8 文件名、mimetype 位置 | `npm run verify:zip` |
| `verify-ebook.mjs` | EPUB 3 与 DOCX 格式校验：zip 完整性、XML 良构、OPF spine/manifest 一致、OOXML 必需部件 | `npm run verify:ebook` |
| `proxy.mjs` | **本地代理**：给不支持浏览器跨域（CORS）的模型服务做转发。数据只经本机，Key 不写盘 | `npm run proxy` |
| `mock-llm.mjs` | 本地假模型（OpenAI 兼容），无 API Key 也能跑通 AI 链路 | `npm run mock-llm` |
| `verify-proxy.mjs` | 回归：代理探测、经代理真实请求、未启动时代理路径被跳过、本地模型永不走代理、设置页卡片 | 先起 `npm run proxy`，再 `node scripts/verify-proxy.mjs` |
| `verify-memory.mjs` | 回归：记忆提取、去重与证据累积、注入 system prompt 与上下文、暂停/置顶、管理界面 | `node scripts/verify-memory.mjs` |

所有浏览器类脚本都用 `scripts/lib/browser.mjs` 的 `launchIsolated()`：**按脚本名隔离 profile 并在启动前清空**。
早期两个脚本共用同一个 profile 目录，批量跑时会互相污染，出现"单跑全过、批量失败"的假象。
| `verify-conflict.mjs` | 回归：超时与"用户取消"被正确区分、冲突自检分批与进度、执行前的分批说明、不把超时误报为失败 | 需 Key：`DEEPSEEK_KEY=… node scripts/verify-conflict.mjs` |
| `ai-e2e.mjs` | AI 链路端到端：配置模型 → 续写 → 流式 → 插入正文 → 落库校验 | `npm run e2e:ai` |
| `shot.mjs` | 任意页面截图 + 控制台错误收集（持久 profile，数据跨次保留） | `npm run shot -- <url> <png>` |
| `verify-settings-entry.mjs` | 回归：全部「设置」入口（首页按钮 / 侧栏 / AI 面板模型名 / ⌘, / 命令面板 / 引导按钮）都能真正进入设置 | `node scripts/verify-settings-entry.mjs` |
| `verify-rebrand.mjs` | 回归：图标无「墨」字且为黑底、死设置项已清、默认心流真的生效、库名与存储键已统一为 huajiao | `node scripts/verify-rebrand.mjs` |
| `verify-overview.mjs` | 回归：项目总览页（进度/今日/近 7 天/指标卡/行动项/节奏图/结构分布），且不再出现「建设中」 | `node scripts/verify-overview.mjs` |
| `verify-review.mjs` | 回归：审稿协作 —— 批注锚定与正文标记渲染、修订建议接受/拒绝与快照、**改稿后锚点自动重定位**、审稿台、更新日志 | `node scripts/verify-review.mjs` |
| `verify-newproject-ai.mjs` | 回归：新建作品「AI 选题」—— 生成条数与内容来自模型、选中后书名/一句话故事/简介全部带出、**种子直通一句话成书**、模型连不上时必须留下可见错误 | 先起 `npm run mock-llm`，再 `node scripts/verify-newproject-ai.mjs` |
| `verify-select-chip.mjs` | 回归：**所有可选芯片的选中态必须看得见** —— 源码不许再出现「靠 Chip 颜色表达选中」的写法；选中的芯片必须带 `.chip--selected` 与勾，且底色/内描边/字重与未选中项有可见差异（设置·创作者档案、新建作品分类都实测）；控制台干净 | `node scripts/verify-select-chip.mjs` |
| `verify-license.mjs` | 回归：LicenseHub 授权（设备线 / 授权码）—— **未激活只卡 AI 功能**（点 AI 建档 / 生成选题才提示，空白项目照建）、授权页上没有任何接入信息输入框、域名线已删干净（静态）、激活→验签→**篡改授权文件必须被拒**→心跳→解绑→卡点恢复、控制台零错误 | 先起 LicenseHub（见 skill `license-hub-ops`）并准备 `/tmp/lh-fixtures.json`：`{ baseUrl, apiKey, product, licenseKey }`，再 `node scripts/verify-license.mjs` |

> 授权卡点开关：`scripts/lib/browser.mjs` 默认给测试上下文打开**只在 dev 构建生效**的开发绕行（`huajiao:license:devBypass`），所以其它脚本不用先激活就能建项目；**要测卡点本身的脚本必须传 `{ licensing: true }`**（`verify-license.mjs` 已这么做），否则断言会静默失效。
> 授权页上没有接入信息输入框（用户只填授权码），脚本要指向其它 LicenseHub 实例时用 `{ licensing: true }` + `addInitScript` 写 `localStorage["huajiao:license:devConn"]`（同样只在 dev 构建生效）。

| `run-all-verify.mjs` | 批量跑所有 `verify-*.mjs` 并汇总：绿（0 失败）/ 跳过（缺外部依赖，如 DEEPSEEK_KEY、`npm run proxy`、本地 Ollama）/ 红 | `node scripts/run-all-verify.mjs` |

## 真模型验证

需要一次性 Key，脚本内不保存任何凭据：

```bash
DEEPSEEK_KEY=sk-xxx node -e "/* 见 git 历史里的 real-model-e2e 脚本，或直接用界面跑 */"
```

已验证过的真模型行为（DeepSeek V4 系列）：
- 连接自检、流式输出、JSON 结构化输出均正常
- 一句话成书单阶段：6 人物 + 12 世界观条目 + 6 硬规则，81 秒 / 15.6k tokens
- 创作者档案（笔名、写作原则、全局禁用词、长期指令）确实进入 system prompt
- **推理模型会先花 token 思考**：max_tokens 给小了正文会为空，见 `docs/GOTCHAS.md`
