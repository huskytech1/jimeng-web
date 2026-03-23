import path from 'node:path';
import process from 'node:process';
import { JimengClient } from './jimeng-client.js';
import type { CliArgs, ImageRatio, ImageStyle } from './types.js';

function formatScriptCommand(fallback: string): string {
  const raw = process.argv[1];
  const displayPath = raw
    ? (() => {
        const relative = path.relative(process.cwd(), raw);
        return relative && !relative.startsWith('..') ? relative : raw;
      })()
    : fallback;
  const quotedPath = displayPath.includes(' ')
    ? `"${displayPath.replace(/"/g, '\\"')}"`
    : displayPath;
  return `bun ${quotedPath}`;
}

function printUsage(): void {
  const cmd = formatScriptCommand('scripts/main.ts');
  console.log(`Usage:
  ${cmd} --prompt "一只可爱的猫咪"
  ${cmd} "赛博朋克城市夜景"

Options:
  -p, --prompt <text>       Prompt text (required for generation)
  -o, --output <path>       Output image path
  -r, --ratio <ratio>       Image ratio: 1:1, 16:9, 9:16, 4:3, 3:4
  --json                    Output as JSON
  -h, --help                Show help

Examples:
  ${cmd} "一只可爱的猫咪在花园里玩耍"
  ${cmd} --prompt "赛博朋克城市夜景" --ratio 16:9`);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    prompt: null,
    outputPath: null,
    ratio: '1:1',
    style: null,
    negativePrompt: null,
    json: false,
    login: false,
    cookiePath: null,
    profileDir: null,
    headless: false,
    help: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }

    if (a === '--json') {
      out.json = true;
      continue;
    }

    if (a === '--prompt' || a === '-p') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      out.prompt = v;
      continue;
    }

    if (a === '--output' || a === '-o') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      out.outputPath = v;
      continue;
    }

    if (a === '--ratio' || a === '-r') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      if (!['1:1', '16:9', '9:16', '4:3', '3:4'].includes(v)) {
        throw new Error(`Invalid ratio: ${v}. Must be one of: 1:1, 16:9, 9:16, 4:3, 3:4`);
      }
      out.ratio = v as ImageRatio;
      continue;
    }

    if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    }

    positional.push(a);
  }

  if (!out.prompt && positional.length > 0) {
    out.prompt = positional.join(' ');
  }

  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const client = new JimengClient({}, !args.json);

  const result = await client.generate({
    prompt: args.prompt,
    outputPath: args.outputPath ?? undefined,
    ratio: args.ratio,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.success) {
    console.log(result.savedPath);
  } else {
    console.error(`Error: ${result.error}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
