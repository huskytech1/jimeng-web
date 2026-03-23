import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { 
  CdpConnection, 
  sleep,
} from './vendor/baoyu-chrome-cdp/src/index.js';
import type { 
  GenerateOptions, 
  GenerateResult, 
  GeneratedImage, 
  JimengConfig,
  ImageRatio 
} from './types.js';
import { JIMENG_URL } from './types.js';

export class JimengClient {
  private config: JimengConfig;
  private cdp: CdpConnection | null = null;
  private targetId: string | null = null;
  private sessionId: string | null = null;
  private verbose: boolean;

  constructor(config: Partial<JimengConfig> = {}, verbose = false) {
    this.verbose = verbose;
    this.config = {
      dataDir: config.dataDir ?? this.resolveDataDir(),
      cookiePath: config.cookiePath ?? this.resolveCookiePath(),
      profileDir: config.profileDir ?? this.resolveProfileDir(),
      chromePath: config.chromePath,
    };
  }

  private resolveDataDir(): string {
    const base = process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
        : (process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'));
    return path.join(base, 'baoyu-skills', 'jimeng-web');
  }

  private resolveCookiePath(): string {
    return path.join(this.resolveDataDir(), 'cookies.json');
  }

  private resolveProfileDir(): string {
    return path.join(this.resolveDataDir(), 'chrome-profile');
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[Jimeng] ${message}`);
    }
  }

  async init(): Promise<void> {
    this.log('Connecting to Chrome...');
    
    const debugPort = await this.findChromeDebugPort();
    if (!debugPort) {
      throw new Error('No Chrome debug port found. Please open Chrome with remote debugging enabled.');
    }
    
    this.log(`Found Chrome debug port: ${debugPort}`);
    
    const versionResponse = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    const version = await versionResponse.json() as { webSocketDebuggerUrl: string };
    
    this.cdp = await CdpConnection.connect(version.webSocketDebuggerUrl, 15000);
    this.log('Connected to Chrome');
  }

  private async findChromeDebugPort(): Promise<number | null> {
    const ports = [9222, 9223, 9229, 52024, 52025, 52026];
    
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { 
          signal: AbortSignal.timeout(1000) 
        });
        if (response.ok) {
          return port;
        }
      } catch {}
    }
    return null;
  }

  async findJimengPage(): Promise<boolean> {
    if (!this.cdp) throw new Error('Client not initialized');
    
    this.log('Finding Jimeng page...');
    
    const { targetInfos } = await this.cdp.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>(
      'Target.getTargets'
    );
    
    const jimengPage = targetInfos.find(t => 
      t.type === 'page' && 
      (t.url.includes('jimeng.jianying.com') || t.url.includes('jimeng'))
    );
    
    if (jimengPage) {
      this.targetId = jimengPage.targetId;
      this.log(`Found Jimeng page: ${jimengPage.url}`);
      
      const { sessionId } = await this.cdp.send<{ sessionId: string }>(
        'Target.attachToTarget',
        { targetId: this.targetId, flatten: true }
      );
      this.sessionId = sessionId;
      
      await this.cdp.send('Page.enable', {}, { sessionId });
      await this.cdp.send('Runtime.enable', {}, { sessionId });
      await this.cdp.send('DOM.enable', {}, { sessionId });
      
      return true;
    }
    
    this.log('Jimeng page not found');
    return false;
  }

  async evaluate(expression: string): Promise<any> {
    if (!this.cdp || !this.sessionId) throw new Error('Page not open');
    
    const result = await this.cdp.send<{ result: { value?: any; type?: string; description?: string } }>(
      'Runtime.evaluate',
      { 
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      { sessionId: this.sessionId }
    );
    
    if (result.result?.type === 'error') {
      throw new Error(`Evaluation error: ${result.result.description}`);
    }
    
    return result.result?.value;
  }

  async switchToImageMode(): Promise<void> {
    this.log('Switching to Image mode...');
    
    // 检查当前 URL
    const currentUrl = await this.evaluate('location.href');
    if (currentUrl.includes('type=image')) {
      this.log('Already in image mode');
      return;
    }
    
    // 直接导航到图片生成页面
    await this.cdp!.send('Page.navigate', { 
      url: 'https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=image' 
    }, { sessionId: this.sessionId! });
    
    await sleep(3000);
    
    this.log('Switched to image mode');
  }

  async ensureModel5(): Promise<void> {
    this.log('Checking model...');
    
    // 检查当前模型
    const currentModel = await this.evaluate(`
      document.querySelector('.lv-select-view-value')?.textContent?.trim()
    `);
    
    this.log(`Current model: ${currentModel}`);
    
    // 如果已经是 5.0，直接返回
    if (currentModel?.includes('5.0')) {
      this.log('Already using model 5.0');
      return;
    }
    
    // 点击模型选择器
    await this.evaluate(`
      (function() {
        const selects = document.querySelectorAll('.lv-select');
        for (const sel of selects) {
          const value = sel.querySelector('.lv-select-view-value')?.textContent?.trim();
          if (value && (value.includes('4.') || value.includes('3.'))) {
            sel.click();
            return true;
          }
        }
        return false;
      })()
    `);
    
    await sleep(500);
    
    // 选择 5.0 Lite
    await this.evaluate(`
      (function() {
        const options = document.querySelectorAll('.lv-select-option');
        for (const opt of options) {
          const text = opt.textContent?.trim();
          if (text && text.includes('5.0')) {
            opt.click();
            return 'clicked: ' + text.substring(0, 30);
          }
        }
        return 'not found';
      })()
    `);
    
    await sleep(1000);
    this.log('Selected model 5.0');
  }

  async setRatio(ratio: ImageRatio): Promise<void> {
    this.log(`Setting ratio: ${ratio}`);
    
    // 点击比例按钮（如 "1:1高清 2K"）
    await this.evaluate(`
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text && text.includes('高清') && (text.includes('1:1') || text.includes('16:9') || text.includes('9:16'))) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `);
    
    await sleep(500);
    
    // 选择指定比例
    await this.evaluate(`
      (function() {
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
          const text = el.textContent?.trim();
          if (text === ${JSON.stringify(ratio)}) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.height < 50) {
              el.click();
              return true;
            }
          }
        }
        return false;
      })()
    `);
    
    await sleep(500);
    this.log(`Ratio set to ${ratio}`);
  }

  async inputPrompt(prompt: string): Promise<void> {
    this.log('Inputting prompt...');
    
    const success = await this.evaluate(`
      (function() {
        const editor = document.querySelector('.tiptap.ProseMirror');
        if (!editor) return false;
        
        editor.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        document.execCommand('insertText', false, ${JSON.stringify(prompt)});
        
        return true;
      })()
    `);
    
    if (!success) {
      throw new Error('Could not find input field');
    }
    
    this.log('Prompt inputted');
    await sleep(1000);
  }

  async clickGenerate(): Promise<void> {
    this.log('Clicking generate button...');
    
    const result = await this.evaluate(`
      (function() {
        const buttons = document.querySelectorAll('.lv-btn-primary');
        
        for (const btn of buttons) {
          const classList = btn.className;
          if (classList.includes('submit-button') && !classList.includes('disabled')) {
            btn.click();
            return 'clicked submit button';
          }
        }
        
        return 'no enabled submit button found';
      })()
    `);
    
    if (!result.includes('clicked')) {
      throw new Error('Could not find generate button or button is disabled');
    }
    
    this.log(result);
    await sleep(500);
  }

  async waitForGeneration(timeoutMs = 90000): Promise<void> {
    this.log('Waiting for generation...');
    const start = Date.now();
    
    // 初始等待缩短
    await sleep(2000);
    
    let lastLargeImageCount = 0;
    let stableCount = 0;
    
    while (Date.now() - start < timeoutMs) {
      // 检查大图片数量
      const largeImageCount = await this.evaluate(`
        Array.from(document.querySelectorAll('img[src*="byteimg"]'))
          .filter(img => img.naturalWidth > 400 || img.width > 400)
          .length
      `);
      
      this.log(`Large images: ${largeImageCount}`);
      
      if (largeImageCount > lastLargeImageCount) {
        lastLargeImageCount = largeImageCount;
        stableCount = 0;
        await sleep(1000);  // 缩短等待
        continue;
      }
      
      stableCount++;
      
      // 找到 4 张且稳定
      if (stableCount >= 2 && largeImageCount >= 4) {
        this.log('Generation complete');
        await sleep(1000);
        return;
      }
      
      // 有图片且稳定
      if (stableCount >= 3 && largeImageCount > 0) {
        this.log('Generation complete');
        return;
      }
      
      await sleep(1000);  // 缩短轮询间隔
    }
    
    if (lastLargeImageCount > 0) {
      this.log('Timeout but found images, continuing...');
      return;
    }
    
    throw new Error('Generation timeout');
  }

  async getGeneratedImages(): Promise<GeneratedImage[]> {
    this.log('Getting generated images...');
    
    const images = await this.evaluate(`
      (function() {
        // 获取生成的图片（宽或高 > 200px）
        const imgs = document.querySelectorAll('img[src*="byteimg"]');
        return Array.from(imgs)
          .filter(img => {
            const src = img.src;
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            return src && 
                   !src.includes('data:') && 
                   !src.includes('favicon') &&
                   (w > 200 || h > 200);
          })
          .map((img, i) => ({
            url: img.src,
            index: i,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
          }));
      })()
    `);

    return images || [];
  }

  async selectBestImage(images: GeneratedImage[]): Promise<GeneratedImage> {
    if (images.length === 0) {
      throw new Error('No images to select from');
    }
    
    return images.reduce((best, current) => {
      const bestPixels = (best.width || 0) * (best.height || 0);
      const currentPixels = (current.width || 0) * (current.height || 0);
      return currentPixels > bestPixels ? current : best;
    }, images[0]);
  }

  async downloadImage(image: GeneratedImage, outputPath: string): Promise<string> {
    this.log(`Downloading image via official download...`);
    
    // 记录下载前的文件列表
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const beforeFiles = new Set(await fs.promises.readdir(downloadsDir));
    
    // 1. 点击图片打开详情
    await this.evaluate(`
      (function() {
        const imgs = document.querySelectorAll('img[src*="byteimg"]');
        for (const img of imgs) {
          if (img.naturalWidth > 200) {
            img.click();
            return true;
          }
        }
        return false;
      })()
    `);
    
    await sleep(800);
    
    // 2. 点击下载按钮
    await this.evaluate(`
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.trim() === '下载') {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `);
    
    await sleep(1000);
    
    // 3. 处理确认对话框
    await this.evaluate(`
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text === '确认' || text === '确定') {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `);
    
    // 4. 等待新文件出现（缩短轮询间隔）
    const dir = path.dirname(outputPath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    let newFile = null;
    for (let i = 0; i < 8; i++) {
      await sleep(500);  // 缩短到 500ms
      
      const afterFiles = await fs.promises.readdir(downloadsDir);
      for (const file of afterFiles) {
        if (!beforeFiles.has(file) && file.startsWith('jimeng-') && file.endsWith('.png')) {
          newFile = path.join(downloadsDir, file);
          break;
        }
      }
      
      if (newFile) break;
    }
    
    if (newFile) {
      await fs.promises.copyFile(newFile, outputPath);
      this.log('Image saved to: ' + outputPath);
      return outputPath;
    }
    
    throw new Error('Download file not found');
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    
    try {
      await this.init();
      
      const found = await this.findJimengPage();
      if (!found) {
        throw new Error('Jimeng page not found. Please open jimeng.jianying.com in Chrome first.');
      }

      // 切换到图片模式
      await this.switchToImageMode();
      
      // 确保使用 5.0 模型
      await this.ensureModel5();
      
      // 设置比例（如果指定）
      if (options.ratio) {
        await this.setRatio(options.ratio);
      }

      // 输入提示词
      await this.inputPrompt(options.prompt);

      // 点击生成
      await this.clickGenerate();

      // 等待生成完成
      await this.waitForGeneration();

      // 获取生成的图片
      const images = await this.getGeneratedImages();
      
      if (images.length === 0) {
        return {
          success: false,
          images: [],
          error: 'No images were generated',
          duration: Date.now() - startTime,
        };
      }

      // 选择最佳图片
      const bestImage = await this.selectBestImage(images);

      // 确定输出路径
      const outputPath = options.outputPath ?? this.getDefaultOutputPath();

      // 下载图片
      const savedPath = await this.downloadImage(bestImage, outputPath);

      return {
        success: true,
        images,
        savedPath,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        images: [],
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    } finally {
      await this.close();
    }
  }

  private getDefaultOutputPath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const imagesDir = path.join(os.homedir(), 'my_project_area', 'images');
    return path.join(imagesDir, `jimeng-${timestamp}.png`);
  }

  async close(): Promise<void> {
    this.log('Closing connection...');
    
    if (this.cdp) {
      this.cdp.close();
      this.cdp = null;
    }
    
    this.sessionId = null;
    this.targetId = null;
  }
}
