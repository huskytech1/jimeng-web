---
name: jimeng-web
version: 1.1.0
description: 通过浏览器自动化访问即梦（jimeng.jianying.com）生成 AI 图片并保存到本地。当用户提到“即梦”“Dreamina”“文生图/图生图”“AI 出图”“批量出图”“提示词生成图片”时都应优先使用此技能，尤其是用户明确要求“在即梦里生成”或“保存到本地图片文件”时。
github_url: https://github.com/huskytech1/jimeng-web.git
github_hash: dd3119465f4b62f574a4565fafd78b9db20ab50e
---

# 即梦 Web 出图技能

本技能用于通过网页模拟的方式操作即梦页面完成出图：切到图片生成、选择模型、设置比例、输入提示词、等待结果、下载最新图片。CLI 只用于前期验证页面规律，不是本技能的默认执行方式。

## 何时使用

- 用户明确提到即梦 / Dreamina 出图
- 用户需要“在网页端自动生成并下载图片”
- 用户需要批量重复出图（同一会话多次调用）
- 用户要求固定比例输出并落地到文件路径

## 执行流程（Agent）

1. 先做环境体检（见下方“快速体检”）。
2. 确认 `jimeng.jianying.com` 已登录。
3. 通过浏览器自动化直接操作网页，不要默认调用 `scripts/main.ts`。
4. 严格按网页步骤执行：进入 `图片生成` 页面，确认不在 `Agent 模式`，选择图片模型，设置比例，输入提示词，点击生成。
5. 等待当前任务完成后再下载，不要在缩略图刚出现时提前下载。
6. 如果页面长时间停留在加载态但结果已在后端生成，主动刷新页面后重新定位当前任务并下载最新结果。
7. 返回保存路径与最终尺寸；若失败，说明卡在哪个网页步骤。

## 关键原则

- 以网页状态为准，不要把旧任务缩略图误判成当前任务结果。
- 结果判断以“当前这次任务的新图”与最终下载文件为准，不以页面上的旧缩略图为准。
- 下载时优先点开当前任务对应的最新图片，再触发官方下载。
- 下载成功后，优先再检查实际文件尺寸，确认比例是否正确。
- 如果当前页面仍停留在 `Agent 模式` 或 `视频生成`，必须先切回 `图片生成` 再继续。

## 快速体检

```bash
# 1) Bun 是否可用
bun --version

# 2) CLI 是否可运行
bun ~/.claude/skills/jimeng-web/scripts/main.ts --help

# 3) Chrome 调试端口是否就绪
curl -sS http://127.0.0.1:9222/json/version
```

如果第 3 步失败，按“启动 Chrome 调试模式”重新启动浏览器。

## 启动 Chrome 调试模式

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  '--remote-allow-origins=*' \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir="/tmp/chrome-debug-profile" &
```

注意：
- 先完全退出 Chrome（`Cmd+Q`）再启动上面的命令。
- 使用临时 profile，避免污染日常浏览器配置。

## 用法

本技能默认是网页模拟工作流，不要求用户直接运行下面这些命令。以下命令主要用于调试或复现：

```bash
# 最简：位置参数作为 prompt
bun ~/.claude/skills/jimeng-web/scripts/main.ts "赛博朋克城市夜景"

# 显式 prompt
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "一只可爱的猫咪"

# 指定比例
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "动漫少女" --ratio 16:9

# 竖图示例
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "汉服少女，电影感肖像" --ratio 9:16

# 指定输出路径
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "山水画" --output ~/my_project_area/images/mountain.png

# 机器可读输出
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "猫咪" --json

# 静默模式
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "产品海报" --quiet
```

## 参数

| 参数 | 说明 |
|---|---|
| `-p, --prompt <text>` | 提示词（未传时可使用位置参数） |
| `-o, --output <path>` | 输出文件路径，默认 `~/my_project_area/images/jimeng-*.png` |
| `-r, --ratio <ratio>` | 比例：`1:1` `16:9` `9:16` `4:3` `3:4` |
| `--json` | 输出 JSON 结果 |
| `-q, --quiet` | 静默模式（只输出必要结果） |
| `-h, --help` | 显示帮助 |

## 默认输出

- 目录：`~/my_project_area/images/`
- 文件名：`jimeng-{timestamp}.png`

## 已验证行为

- `1:1` 实测可下载到 `2048x2048`
- `9:16` 实测可下载到 `1440x2560`
- 页面生成后若前端未及时刷新，网页自动化流程会主动刷新一次并继续抓取最新结果

## 网页模拟步骤

1. 连接已开启调试端口的 Chrome。
2. 打开或切换到 `https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=image`。
3. 如果页面显示 `Agent 模式`、`视频生成` 或其他非图片模式，先切回 `图片生成`。
4. 检查当前模型，优先切到 `5.0`。
5. 设置用户要求的比例，例如 `1:1` 或 `9:16`。
6. 设置完模型或比例后，主动点击页面空白处，确保下拉菜单已经收起，不要让浮层挡住后续操作。
7. 清空输入框后填写新的提示词，避免残留旧内容。
8. 输入提示词后，再点击一次页面空白处，确保设置菜单和输入态浮层已经消失。
9. 点击生成按钮。
10. 等待当前任务完成：
   - 优先观察当前任务卡片是否出现 4 张新图。
   - 只跟踪最底部新增任务卡片，不要从历史记录区域抓图。
   - 若页面持续 loading 但无新图，刷新页面一次后重新检查。
11. 点开当前任务里最新的目标图。
12. 触发官方下载，并确认下载到的是本次最新结果。
13. 检查下载文件实际尺寸是否符合目标比例。

## 常见问题

| 错误 | 处理 |
|---|---|
| `No Chrome debug port found` | 按“启动 Chrome 调试模式”重启 Chrome |
| `Jimeng page not found` | 在 Chrome 打开并登录 `https://jimeng.jianying.com` |
| `Generation timeout` | 页面可能卡在旧状态；先重试一次，CLI 会自动刷新同步结果 |
| `No images were generated` | 当前任务未产出新图；检查额度、排队状态或缩短 prompt 后重试 |
| 下载到旧图/错图 | 这通常是页面旧状态导致；当前 CLI 已优先等待最新任务并按最新图下载 |

## 安全说明

- 调试端口默认仅监听本机（`127.0.0.1`）。
- 登录态保存在本地 Chrome profile，不在技能中存储账号密码。
- 建议始终使用临时 profile 做自动化会话。
