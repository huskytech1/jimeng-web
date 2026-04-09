# jimeng-web

Version: `1.1.0`

通过网页模拟方式操作即梦（Dreamina / 即梦）完成图片生成、等待结果、下载保存。

## What It Does

- 连接已开启调试端口的 Chrome
- 自动切换到 `图片生成`
- 遇到 `Agent 模式` 时先点模式入口，再切回 `图片生成`
- 设置模型与图片比例
- 输入提示词并提交生成
- 等待最底部新增任务卡片完成
- 点开最新生成图并走官方下载
- 将图片保存到本地文件

## Current Workflow

这个仓库当前版本的核心是“网页模拟完成所有操作”。

- 默认行为：网页模拟
- CLI 作用：调试入口与验证入口
- Skill 行为：应复用网页模拟步骤，不应把 CLI 当作默认主流程

## Verified Results

以下流程已在本地验证通过：

- `1:1` 生成并下载，得到 `2048x2048`
- `3:4` 生成并下载，得到 `1728x2304`
- `9:16` 生成并下载，得到 `1440x2560`

## Key Fixes In v1.1.0

- 修复 `Agent 模式` 下无法正确切回 `图片生成`
- 修复设置模型/比例后浮层未关闭导致后续点击失效
- 修复过早下载历史记录图片的问题
- 改为等待最底部新增任务卡片完成后再下载
- 下载时优先按当前图片 URL 精确点击，再走官方下载
- 页面长时间停留在 loading 时，支持刷新后继续同步结果

## Usage

调试时可以直接运行 CLI：

```bash
bun ~/.claude/skills/jimeng-web/scripts/main.ts --prompt "一只可爱的猫咪" --ratio 1:1
```

## Requirements

- Bun
- Google Chrome
- Chrome 以远程调试模式启动
- 已登录 `https://jimeng.jianying.com`

示例启动命令：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  '--remote-allow-origins=*' \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir="/tmp/chrome-debug-profile" &
```

## Repository Notes

- README 不包含个人账号信息、Cookie、下载目录历史等敏感数据
- 本仓库示例路径统一使用通用本地路径写法
- Skill 元数据保留 `github_url` 与 `github_hash` 字段
