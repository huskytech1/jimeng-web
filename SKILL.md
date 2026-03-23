---
name: jimeng-web
description: 通过浏览器自动化访问即梦（jimeng.jianying.com）生成 AI 图片并保存到本地。当用户提到"即梦"、"Dreamina"、"AI图片生成"、"文字转图片"时使用此技能。
---

# 即梦 Web 图片生成

通过 Chrome 浏览器自动化访问即梦生成 AI 图片，支持多种比例和画质选择。

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `{baseDir}`
2. Script path = `{baseDir}/scripts/<script-name>.ts`
3. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun
4. Replace all `{baseDir}` and `${BUN_X}` in this document with actual values

**Script Reference**:
| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | CLI entry point for image generation |
| `scripts/jimeng-client.ts` | Jimeng client - browser automation logic |
| `scripts/types.ts` | TypeScript type definitions |
| `scripts/vendor/baoyu-chrome-cdp/` | Chrome CDP library for browser control |

## Prerequisites

1. **Bun runtime**: Install with `curl -fsSL https://bun.sh/install | bash`
2. **Chrome with remote debugging**: Start Chrome with `--remote-debugging-port=9222`
3. **Jimeng login**: Must be logged in to jimeng.jianying.com

## Usage

```bash
# Basic usage - generate image from prompt
${BUN_X} {baseDir}/scripts/main.ts --prompt "一只可爱的猫咪"
${BUN_X} {baseDir}/scripts/main.ts "赛博朋克城市夜景"

# Specify output path
${BUN_X} {baseDir}/scripts/main.ts --prompt "山水画" --output ./my-image.png

# With ratio
${BUN_X} {baseDir}/scripts/main.ts --prompt "动漫少女" --ratio 16:9

# JSON output (for script integration)
${BUN_X} {baseDir}/scripts/main.ts --prompt "猫咪" --json
```

## Options

| Option | Description |
|--------|-------------|
| `-p, --prompt <text>` | Prompt text (required) |
| `-o, --output <path>` | Output image path (default: `~/my_project_area/images/jimeng-*.png`) |
| `-r, --ratio <ratio>` | Image ratio: `1:1`, `16:9`, `9:16`, `4:3`, `3:4` (default: `1:1`) |
| `--json` | Output as JSON |
| `-h, --help` | Show help |

## Supported Ratios

| Ratio | Use Case |
|-------|----------|
| `1:1` | Avatar, social media posts |
| `16:9` | Wallpaper, video thumbnail |
| `9:16` | Mobile wallpaper, short video |
| `4:3` | Traditional format |
| `3:4` | Portrait format |

## Setup

### 1. Start Chrome with Debugging

```bash
# Start Chrome with remote debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 &
```

### 2. Login to Jimeng

1. Open Chrome (with debugging enabled)
2. Navigate to https://jimeng.jianying.com
3. Login with your account (supports Douyin/Phone/WeChat)

### 3. Generate Images

```bash
bun ~/.claude/skills/jimeng-web/scripts/main.ts "你的提示词"
```

## How It Works

1. **Connect to Chrome**: Uses Chrome DevTools Protocol (CDP)
2. **Find Jimeng page**: Locates the open Jimeng tab
3. **Switch to Image mode**: Navigates to image generation interface
4. **Select Model 5.0**: Uses the latest AI model (5.0 Lite)
5. **Set ratio**: Configures image aspect ratio
6. **Input prompt**: Enters your description
7. **Click generate**: Triggers image generation
8. **Wait for completion**: Monitors generation progress
9. **Download via official method**: Uses official download button for original quality

## Output

### File Location
Default: `~/my_project_area/images/jimeng-{timestamp}.png`

### JSON Output
With `--json` flag:
```json
{
  "success": true,
  "images": [...],
  "savedPath": "/path/to/image.png",
  "duration": 37000
}
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| `No Chrome debug port found` | Start Chrome with `--remote-debugging-port=9222` |
| `Jimeng page not found` | Open jimeng.jianying.com in Chrome |
| `Generation timeout` | Check if you're logged in; try again |
| `No images were generated` | Verify prompt is valid; check account credits |

## Tips

1. **Use descriptive prompts**: Better prompts = better images
2. **Specify ratio**: Match your use case
3. **Keep Chrome open**: Reuse the same session for multiple generations
4. **Login persists**: No need to re-login unless you clear browser data

## Limitations

- Requires Chrome with remote debugging enabled
- Must be logged in to jimeng.jianying.com
- Generation time depends on server load (~30s)
- Free tier has usage limits

## Security

- Debug port only listens on localhost (127.0.0.1)
- Login credentials stored in Chrome, not in this skill
- Each user uses their own Chrome profile

## Base Directory

Base directory for this skill: `~/.claude/skills/jimeng-web`
Relative paths in this skill (e.g., scripts/) are relative to this base directory.
