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
  ImageRatio,
  BottomRecordSignature,
} from './types.ts';
import { JIMENG_URL } from './types.ts';

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

  async dismissTransientUi(): Promise<void> {
    this.log('Dismissing transient menus...');
    await this.evaluate(`
      (function() {
        const clickAt = (x, y) => {
          const target = document.elementFromPoint(x, y) || document.body;
          const evt = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
          target.dispatchEvent(evt);
        };
        clickAt(window.innerWidth - 20, 20);
        document.body.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      })()
    `);
    await sleep(400);
  }

  async getBottomRecordSignature(): Promise<BottomRecordSignature> {
    const result = await this.evaluate(`
      JSON.stringify((function() {
        const cards = Array.from(document.querySelectorAll('div[class*="image-record"]')).filter((el) => {
          if (el.parentElement?.closest('div[class*="image-record"]')) return false;
          const imgs = Array.from(el.querySelectorAll('img[src*="byteimg"]')).filter((img) => !!img.src && img.src.startsWith('http'));
          return imgs.length >= 1 && imgs.length <= 8;
        }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const last = cards[cards.length - 1];
        if (!last) return { text: '', imageUrls: [], imageCount: 0, top: -1, buttonText: [], isEmpty: true };
        const text = (last.textContent || '').replace(/\s+/g, ' ').trim();
        const imageUrls = Array.from(last.querySelectorAll('img[src*="byteimg"]'))
          .map((img) => img.src)
          .filter((src) => !!src && src.startsWith('http'));
        const buttonText = Array.from(last.querySelectorAll('button'))
          .map((btn) => (btn.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 8);
        return {
          text,
          imageUrls,
          imageCount: imageUrls.length,
          top: Math.round(last.getBoundingClientRect().top),
          buttonText,
          isEmpty: false,
        };
      })())
    `);
    try {
      return JSON.parse(result || '{"text":"","imageUrls":[],"imageCount":0,"top":-1,"buttonText":[],"isEmpty":true}');
    } catch {
      return { text: '', imageUrls: [], imageCount: 0, top: -1, buttonText: [], isEmpty: true };
    }
  }

  async switchToImageMode(): Promise<void> {
    this.log('Switching to Image mode...');

    const imageUrl = 'https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=image';
    await this.cdp!.send('Page.navigate', { url: imageUrl }, { sessionId: this.sessionId! });
    await sleep(2500);

    for (let attempt = 1; attempt <= 6; attempt++) {
      const state = await this.evaluate(`
        (function() {
          const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
          const isVisible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const hasEditor = !!document.querySelector('.tiptap.ProseMirror');
          const href = location.href;
          const bodyText = (document.body?.innerText || '').slice(0, 2000);
          const hasAgentMode = bodyText.includes('Agent 模式');
          const hasImageLabel = bodyText.includes('图片生成') || bodyText.includes('图像生成') || bodyText.includes('文生图');

          if (hasAgentMode) {
            const modeEntrances = Array.from(document.querySelectorAll('button, a, div, span')).filter((el) => {
              const txt = textOf(el);
              return isVisible(el) && (txt === 'Agent 模式' || txt.includes('Agent 模式'));
            });
            if (modeEntrances.length > 0) {
              modeEntrances[0].click();
            }
          }

          const imageOptions = Array.from(document.querySelectorAll('button, a, div, span')).filter((el) => {
            const txt = textOf(el);
            if (!txt || txt.length > 20) return false;
            return isVisible(el) && (txt === '图片生成' || txt.includes('图片生成') || txt.includes('图像生成') || txt.includes('文生图'));
          });
          if (imageOptions.length > 0) {
            imageOptions[0].click();
          }

          const tabs = Array.from(document.querySelectorAll('button, a, div, span')).filter((el) => {
            const txt = textOf(el);
            if (!txt || txt.length > 20) return false;
            return isVisible(el) && (txt.includes('图片生成') || txt.includes('图像生成') || txt.includes('文生图'));
          });

          return {
            href,
            hasEditor,
            hasAgentMode,
            hasImageLabel,
            tabCandidates: tabs.length,
            clickedAgentMode: hasAgentMode && imageOptions.length === 0,
            clickedImageOption: imageOptions.length > 0,
          };
        })()
      `);

      this.log(`Image mode check #${attempt}: ${JSON.stringify(state)}`);

      const ok = !!state?.hasEditor && !state?.hasAgentMode;
      if (ok) {
        this.log('Switched to image mode');
        return;
      }

      if (!String(state?.href || '').includes('type=image')) {
        await this.cdp!.send('Page.navigate', { url: imageUrl }, { sessionId: this.sessionId! });
      }

      await sleep(1500);
    }

    throw new Error('Failed to switch to image generation mode (still in non-image or Agent mode).');
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

    const selected = await this.evaluate(`
      (function() {
        const targetRatio = ${JSON.stringify(ratio)};
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };

        const openers = Array.from(document.querySelectorAll('button, div, span')).filter((el) => {
          if (!isVisible(el)) return false;
          const text = (el.textContent || '').trim();
          return /^\\d+:\\d+/.test(text) || text.includes('比例') || text.includes('尺寸');
        });

        for (const opener of openers) {
          opener.click();
          const options = Array.from(document.querySelectorAll('li, div, button, span')).filter((el) => {
            if (!isVisible(el)) return false;
            const text = (el.textContent || '').trim();
            if (!text || text.length > 24) return false;
            return text === targetRatio || /^\\d+:\\d+$/.test(text) || text.startsWith(targetRatio + ' ');
          });

          const exact = options.find((el) => (el.textContent || '').trim() === targetRatio);
          const partial = options.find((el) => {
            const t = (el.textContent || '').trim();
            return t.startsWith(targetRatio + ' ');
          });
          const candidate = exact || partial;
          if (candidate) {
            candidate.click();
            return { ok: true, selectedText: (candidate.textContent || '').trim() };
          }
        }

        return { ok: false, selectedText: '' };
      })()
    `);

    this.log(`Ratio selection: ${JSON.stringify(selected)}`);
    if (!selected?.ok) {
      const fallback = await this.evaluate(`
        (function() {
          const targetRatio = ${JSON.stringify(ratio)};
          const isVisible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };

          const all = Array.from(document.querySelectorAll('button, div, span, li, a'));
          const exact = all.find((el) => isVisible(el) && (el.textContent || '').trim() === targetRatio);
          if (exact) {
            exact.click();
            return { ok: true, mode: 'direct_exact' };
          }

          const hints = all
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((t) => /\d+:\d+/.test(t) || t.includes('比例') || t.includes('尺寸') || t.includes('高清'))
            .slice(0, 30);

          return { ok: false, mode: 'none', hints };
        })()
      `);

      this.log(`Ratio fallback: ${JSON.stringify(fallback)}`);
      if (!fallback?.ok) {
        this.log(`Ratio selector not found, will continue and verify output ratio later: ${ratio}`);
        return;
      }
    }

    await sleep(700);

    const verify = await this.evaluate(`
      (function() {
        const targetRatio = ${JSON.stringify(ratio)};
        const allText = Array.from(document.querySelectorAll('button, div, span'))
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean);
        return allText.some((t) => t === targetRatio || t.includes(targetRatio + ' '));
      })()
    `);

    if (!verify) {
      this.log(`Ratio ${ratio} verify check not passed; will validate from generated image dimensions.`);
      return;
    }

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
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };

        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const buttons = Array.from(document.querySelectorAll('button')).filter((btn) => isVisible(btn) && !btn.disabled);

        const strictText = ['生成', '立即生成', 'Generate'];
        const strict = buttons.find((btn) => strictText.includes(clean(btn.textContent)));
        if (strict) {
          strict.click();
          return { ok: true, reason: 'strict', text: clean(strict.textContent) };
        }

        const primary = buttons.find((btn) => {
          const cls = (btn.className || '').toString().toLowerCase();
          const aria = clean(btn.getAttribute('aria-label'));
          const text = clean(btn.textContent);
          if (text.includes('历史') || text.includes('模板') || text.includes('灵感') || text.includes('视频')) return false;
          return cls.includes('primary') || cls.includes('submit') || aria.includes('生成');
        });
        if (primary) {
          primary.click();
          return { ok: true, reason: 'primary_class', text: clean(primary.textContent) };
        }

        const soft = buttons.find((btn) => {
          const text = clean(btn.textContent);
          if (!text.includes('生成')) return false;
          if (text.length > 16) return false;
          if (text.includes('历史') || text.includes('模板') || text.includes('灵感') || text.includes('提升') || text.includes('视频')) return false;
          return true;
        });
        if (soft) {
          soft.click();
          return { ok: true, reason: 'soft', text: clean(soft.textContent) };
        }

        const relaxed = buttons.find((btn) => {
          const text = clean(btn.textContent);
          if (!text.includes('生成')) return false;
          if (text.includes('历史') || text.includes('模板') || text.includes('灵感') || text.includes('视频')) return false;
          return true;
        });
        if (relaxed) {
          relaxed.click();
          return { ok: true, reason: 'relaxed_text', text: clean(relaxed.textContent) };
        }

        const candidates = buttons.map((btn) => ({
          text: clean(btn.textContent).slice(0, 60),
          className: (btn.className || '').toString().slice(0, 60),
          aria: clean(btn.getAttribute('aria-label')).slice(0, 40),
        }));
        return { ok: false, reason: 'no_generate_button', text: '', candidates };
      })()
    `);

    this.log('Generate button: ' + JSON.stringify(result));

    if (!result?.ok) {
      throw new Error('Could not find generate button or button is disabled');
    }

    await sleep(1000);
  }

  async waitForGeneration(timeoutMs = 120000): Promise<void> {
    this.log('Waiting for generation...');
    const start = Date.now();
    
    // 初始等待
    await sleep(3000);
    
    let lastLargeImageCount = 0;
    let stableCount = 0;
    let checkCount = 0;
    
    while (Date.now() - start < timeoutMs) {
      checkCount++;
      
      // 检查生成状态
      const status = await this.evaluate(`
        (function() {
          // 检查是否有加载中状态
          const loadingElements = document.querySelectorAll('.loading, [class*="generating"], [class*="progress"]');
          const hasLoading = loadingElements.length > 0;
          
          // 检查是否有错误提示
          const isVisible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const errorElements = Array.from(document.querySelectorAll('[class*="error"], [class*="fail"]'));
          const hasError = errorElements.some((el) => {
            const text = (el.textContent || '').trim();
            return isVisible(el) && (text.includes('失败') || text.includes('出错') || text.includes('error'));
          });
          
          // 检查大图片数量
          const largeImages = Array.from(document.querySelectorAll('img[src*="byteimg"]'))
            .filter(img => {
              const w = img.naturalWidth || img.width;
              const h = img.naturalHeight || img.height;
              return w >= 500 || h >= 500;
            });
          
          return {
            hasLoading,
            hasError,
            imageCount: largeImages.length,
            checkCount: ${checkCount}
          };
        })()
      `);
      
      this.log(`Check ${checkCount}: images=${status?.imageCount}, loading=${status?.hasLoading}`);
      
      // 检查是否有错误
      if (status?.hasError) {
        throw new Error('Generation failed - error detected on page');
      }
      
      const largeImageCount = status?.imageCount || 0;
      
      if (largeImageCount > lastLargeImageCount) {
        lastLargeImageCount = largeImageCount;
        stableCount = 0;
        await sleep(1500);
        continue;
      }
      
      stableCount++;
      
      // 找到 4 张且稳定
      if (stableCount >= 2 && largeImageCount >= 4) {
        this.log('Generation complete (4 images found)');
        await sleep(1000);
        return;
      }
      
      // 有图片且稳定（可能是单张生成模式）
      if (stableCount >= 3 && largeImageCount > 0) {
        this.log(`Generation complete (${largeImageCount} image(s) found)`);
        return;
      }
      
      // 超过一定检查次数后，降低稳定要求
      if (checkCount >= 30 && largeImageCount > 0) {
        this.log('Generation complete (timeout safety)');
        return;
      }
      
      await sleep(1200);
    }
    
    if (lastLargeImageCount > 0) {
      this.log('Timeout but found images, continuing...');
      return;
    }
    
    throw new Error('Generation timeout - no images found after ' + Math.round(timeoutMs/1000) + ' seconds');
  }

  async waitForNewImages(existingRecordCount: number, beforeBottomRecord: BottomRecordSignature, prompt?: string, timeoutMs = 120000): Promise<void> {
    this.log(`Waiting for new images (existing records: ${existingRecordCount})...`);
    const start = Date.now();
    const promptHead = (prompt || '').slice(0, 28);
    const promptTail = (prompt || '').slice(-28);
    const beforeText = (beforeBottomRecord?.text || '').slice(0, 300);
    const beforeImageUrls = beforeBottomRecord?.imageUrls || [];
    let refreshedOnce = false;
    
    // 初始等待让生成开始
    await sleep(3000);
    
    let stableCount = 0;
    let checkCount = 0;
    let lastNewCount = 0;
    let generationStarted = false;
    
    while (Date.now() - start < timeoutMs) {
      checkCount++;
      
      // 检查生成状态
      const status = await this.evaluate(`
        (function() {
          const existingRecordCount = ${existingRecordCount};
          const promptHead = ${JSON.stringify(promptHead)};
          const promptTail = ${JSON.stringify(promptTail)};
          const beforeText = ${JSON.stringify(beforeText)};
          const beforeImageUrls = ${JSON.stringify(beforeImageUrls)};
          const beforeImageCount = ${beforeBottomRecord.imageCount || 0};
          const beforeTop = ${beforeBottomRecord.top ?? -1};
          const beforeButtonText = ${JSON.stringify(beforeBottomRecord.buttonText || [])};
          const beforeIsEmpty = ${beforeBottomRecord.isEmpty ? 'true' : 'false'};
          const getRecordCards = () => Array.from(document.querySelectorAll('div[class*="image-record"]')).filter((el) => {
            if (el.parentElement?.closest('div[class*="image-record"]')) return false;
            const imgs = Array.from(el.querySelectorAll('img[src*="byteimg"]')).filter((img) => !!img.src && img.src.startsWith('http'));
            return imgs.length >= 1 && imgs.length <= 8;
          }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          const isEditable = (el) => {
            return !!el.closest('textarea, input, .tiptap, .ProseMirror, [contenteditable="true"]');
          };
          const textMatchesPrompt = (text) => {
            if (!promptHead) return false;
            if (!text.includes(promptHead)) return false;
            if (promptTail && promptTail !== promptHead && !text.includes(promptTail)) return false;
            return true;
          };
          const sameImages = (a, b) => {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
              if (a[i] !== b[i]) return false;
            }
            return true;
          };
          const cardSignature = (el) => ({
            text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            imageUrls: Array.from(el.querySelectorAll('img[src*="byteimg"]')).map((img) => img.src).filter((src) => !!src && src.startsWith('http')),
          });
          const sameTextArray = (a, b) => {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
              if (a[i] !== b[i]) return false;
            }
            return true;
          };
          const isNewComparedToBefore = (el) => {
            const sig = cardSignature(el);
            const buttonText = Array.from(el.querySelectorAll('button'))
              .map((btn) => (btn.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean)
              .slice(0, 8);
            const top = Math.round(el.getBoundingClientRect().top);
            if (beforeIsEmpty) return sig.imageUrls.length > 0;
            return sig.text !== beforeText
              || !sameImages(sig.imageUrls, beforeImageUrls)
              || sig.imageUrls.length !== beforeImageCount
              || !sameTextArray(buttonText, beforeButtonText)
              || top !== beforeTop;
          };
          const findTaskContainer = () => {
            const records = getRecordCards();
            const candidateRecords = records.slice(Math.max(0, existingRecordCount - 1));
            const promptMatched = candidateRecords.filter((el) => textMatchesPrompt((el.textContent || '').trim()) && isNewComparedToBefore(el));
            if (promptMatched.length > 0) return promptMatched[promptMatched.length - 1];
            const changedBottom = candidateRecords.filter((el) => isNewComparedToBefore(el));
            if (changedBottom.length > 0) return changedBottom[changedBottom.length - 1];
            return null;
          };
          // 检查是否有加载/生成中状态
          const loadingElements = document.querySelectorAll('[class*="loading"], [class*="generating"], [class*="progress"], [class*="pending"]');
          const hasLoading = loadingElements.length > 0;
          
          // 检查是否有错误提示
          const isVisible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const errorElements = Array.from(document.querySelectorAll('[class*="error"], [class*="fail"]'));
          const hasError = errorElements.some((el) => {
            const text = (el.textContent || '').trim();
            return isVisible(el) && (text.includes('失败') || text.includes('出错') || text.toLowerCase().includes('error'));
          });
          
          // 检查所有图片
          const allImages = Array.from(document.querySelectorAll('img[src*="byteimg"]'))
            .filter(img => !!img.src && img.src.startsWith('http'));
          const totalCount = allImages.length;
          const totalRecordCount = getRecordCards().length;

          const matchedContainer = findTaskContainer();

          let taskImages = [];
          let taskLoading = false;
          if (matchedContainer) {
            taskImages = Array.from(matchedContainer.querySelectorAll('img[src*="byteimg"]'))
              .filter(img => !!img.src && img.src.startsWith('http'));
            const containerText = (matchedContainer.textContent || '');
            taskLoading = containerText.includes('生成中') || containerText.includes('排队');
          }
          
          // 检查是否有生成按钮处于禁用状态（表示正在生成）
          const buttons = document.querySelectorAll('button');
          let isGenerating = false;
          for (const btn of buttons) {
            const text = btn.textContent?.trim();
            if (text && (text.includes('生成中') || text.includes('生成ing'))) {
              isGenerating = true;
              break;
            }
          }
          
          return {
            hasLoading,
            hasError,
            totalCount,
            newCount: Math.max(0, totalRecordCount - existingRecordCount),
            isGenerating,
            taskFound: !!matchedContainer,
            taskImageCount: taskImages.length,
            taskLoading,
            totalRecordCount,
            bottomChanged: !!matchedContainer,
          };
        })()
      `);

      const newCount = Math.max(0, status?.newCount || 0);

      this.log(`Check ${checkCount}: total=${status?.totalCount}, records=${status?.totalRecordCount}, new=${newCount}, bottomChanged=${status?.bottomChanged}, taskFound=${status?.taskFound}, taskImgs=${status?.taskImageCount}, loading=${status?.hasLoading}, generating=${status?.isGenerating}`);
      
      // 检查是否有错误
      if (status?.hasError) {
        throw new Error('Generation failed - error detected on page');
      }

      if (!refreshedOnce && checkCount >= 6 && generationStarted && !status?.bottomChanged && status?.hasLoading) {
        this.log('No new images yet; reloading page to sync finished results...');
        await this.cdp!.send('Page.reload', { ignoreCache: false }, { sessionId: this.sessionId! });
        await sleep(4000);
        refreshedOnce = true;
        stableCount = 0;
        continue;
      }
      
      // 检测是否开始生成
      if (status?.isGenerating || status?.hasLoading) {
        generationStarted = true;
      }
      
      // 检查新图片数量是否有变化
      if (newCount > lastNewCount) {
        lastNewCount = newCount;
        stableCount = 0;
        await sleep(5000);
        continue;
      }

      const taskImageCount = Math.max(0, status?.taskImageCount || 0);
      if (status?.taskFound && taskImageCount >= 4 && !status?.taskLoading) {
        stableCount++;
        if (stableCount >= 2) {
          this.log(`Generation complete (matched task has ${taskImageCount} image(s))`);
          await sleep(1000);
          return;
        }
      } else if (status?.taskFound && status?.taskLoading) {
        stableCount = 0;
      }
      
      stableCount++;
      
      // 找到 4 张新图片且稳定
      if (stableCount >= 2 && newCount >= 4) {
        this.log('Generation complete (4 new images found)');
        await sleep(1000);
        return;
      }
      
      // 有新图片且稳定
      if (stableCount >= 3 && newCount > 0) {
        this.log(`Generation complete (${newCount} new image(s) found)`);
        return;
      }
      
      // 如果检测到生成开始但没有新图片，可能是检测逻辑问题
      // 尝试检查是否有任何新的大图片出现
      if (checkCount >= 40 && generationStarted && newCount >= 4 && !status?.hasLoading) {
        this.log(`Found ${newCount} new images (fallback check)`);
        await sleep(1000);
        return;
      }
      
      await sleep(5000);
    }
    
    if (lastNewCount > 0) {
      this.log('Timeout but found new images, continuing...');
      return;
    }
    
    throw new Error('Generation timeout - no new images found after ' + Math.round(timeoutMs/1000) + ' seconds');
  }

  async getGeneratedImages(): Promise<GeneratedImage[]> {
    this.log('Getting generated images...');
    
    const images = await this.evaluate(`
      (function() {
        // 获取生成的图片
        const imgs = document.querySelectorAll('img[src*="byteimg"]');
        const allImages = Array.from(imgs)
          .filter(img => {
            const src = img.src;
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            return src && 
                   !src.includes('data:') && 
                   !src.includes('favicon') &&
                   (w >= 500 || h >= 500);
          });
        
        // 只返回最后 4 张图片（新生成的）
        const lastFour = allImages.slice(-4);
        
        return lastFour.map((img, i) => ({
          url: img.src,
          index: allImages.length - 4 + i,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          // 记录父元素，用于后续点击
          parentClass: img.parentElement?.className || '',
        }));
      })()
    `);

    this.log(`Found ${images?.length || 0} new images`);
    return images || [];
  }

  async getNewGeneratedImages(existingRecordCount: number, beforeBottomRecord: BottomRecordSignature, prompt?: string): Promise<GeneratedImage[]> {
    this.log(`Getting new generated images (existing records: ${existingRecordCount})...`);
    const promptHead = (prompt || '').slice(0, 28);
    const promptTail = (prompt || '').slice(-28);
    const beforeText = (beforeBottomRecord?.text || '').slice(0, 300);
    const beforeImageUrls = beforeBottomRecord?.imageUrls || [];
    
    const images = await this.evaluate(`
      (function() {
        const existingRecordCount = ${existingRecordCount};
        const promptHead = ${JSON.stringify(promptHead)};
        const promptTail = ${JSON.stringify(promptTail)};
        const beforeText = ${JSON.stringify(beforeText)};
        const beforeImageUrls = ${JSON.stringify(beforeImageUrls)};
        const beforeImageCount = ${beforeBottomRecord.imageCount || 0};
        const beforeTop = ${beforeBottomRecord.top ?? -1};
        const beforeButtonText = ${JSON.stringify(beforeBottomRecord.buttonText || [])};
        const beforeIsEmpty = ${beforeBottomRecord.isEmpty ? 'true' : 'false'};
          const getRecordCards = () => Array.from(document.querySelectorAll('div[class*="image-record"]')).filter((el) => {
            if (el.parentElement?.closest('div[class*="image-record"]')) return false;
            const imgs = Array.from(el.querySelectorAll('img[src*="byteimg"]')).filter((img) => !!img.src && img.src.startsWith('http'));
            return imgs.length >= 1 && imgs.length <= 8;
          }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const isEditable = (el) => {
          return !!el.closest('textarea, input, .tiptap, .ProseMirror, [contenteditable="true"]');
        };
        const textMatchesPrompt = (text) => {
          if (!promptHead) return false;
          if (!text.includes(promptHead)) return false;
          if (promptTail && promptTail !== promptHead && !text.includes(promptTail)) return false;
          return true;
        };
        const sameImages = (a, b) => {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
          }
          return true;
        };
        const cardSignature = (el) => ({
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          imageUrls: Array.from(el.querySelectorAll('img[src*="byteimg"]')).map((img) => img.src).filter((src) => !!src && src.startsWith('http')),
        });
        const sameTextArray = (a, b) => {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
          }
          return true;
        };
        const isNewComparedToBefore = (el) => {
          const sig = cardSignature(el);
          const buttonText = Array.from(el.querySelectorAll('button'))
            .map((btn) => (btn.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 8);
          const top = Math.round(el.getBoundingClientRect().top);
          if (beforeIsEmpty) return sig.imageUrls.length > 0;
          return sig.text !== beforeText
            || !sameImages(sig.imageUrls, beforeImageUrls)
            || sig.imageUrls.length !== beforeImageCount
            || !sameTextArray(buttonText, beforeButtonText)
            || top !== beforeTop;
        };
        const findTaskContainer = () => {
          const records = getRecordCards();
          const candidateRecords = records.slice(Math.max(0, existingRecordCount - 1));
          const promptMatched = candidateRecords.filter((el) => textMatchesPrompt((el.textContent || '').trim()) && isNewComparedToBefore(el));
          if (promptMatched.length > 0) return promptMatched[promptMatched.length - 1];
          const changedBottom = candidateRecords.filter((el) => isNewComparedToBefore(el));
          if (changedBottom.length > 0) return changedBottom[changedBottom.length - 1];
          return null;
        };

        const matchedContainer = findTaskContainer();

        if (matchedContainer) {
          const globalImages = Array.from(document.querySelectorAll('img[src*="byteimg"]'));
          const taskImages = Array.from(matchedContainer.querySelectorAll('img[src*="byteimg"]'))
            .filter(img => !!img.src && img.src.startsWith('http'))
            .map((img) => ({
              url: img.src,
              index: globalImages.indexOf(img),
              width: img.naturalWidth || img.width,
              height: img.naturalHeight || img.height,
            }));

          const dedup = [];
          const seen = new Set();
          for (const img of taskImages) {
            if (seen.has(img.url)) continue;
            seen.add(img.url);
            dedup.push(img);
          }
          if (dedup.length > 0) {
            return dedup;
          }
          return taskImages.filter((img) => img.index >= 0);
        }

        // 获取所有图片
        const imgs = document.querySelectorAll('img[src*="byteimg"]');
        const allImages = Array.from(imgs)
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
            element: img,
          }));
        
        // 只返回新生成的图片（按 URL 去重）
        return allImages.filter((img) => !existing.has(img.url)).map((img, i) => ({
          url: img.url,
          index: img.index,
          width: img.width,
          height: img.height,
        }));
      })()
    `);

    this.log(`Found ${images?.length || 0} new images`);
    return images || [];
  }

  async selectBestImage(images: GeneratedImage[]): Promise<GeneratedImage> {
    if (images.length === 0) {
      throw new Error('No images to select from');
    }
    
    this.log(`Selecting best image from ${images.length} images...`);
    
    // 打印所有图片信息
    images.forEach((img, i) => {
      this.log(`  Image ${i}: ${img.width}x${img.height} (${(img.width || 0) * (img.height || 0)} pixels)`);
    });
    
    // 即梦生图策略：通常第一张是质量最好的
    // 但如果第一张分辨率明显较低，则选择分辨率最高的
    const firstImage = images[0];
    const firstPixels = (firstImage.width || 0) * (firstImage.height || 0);
    
    // 如果只有一张图片，直接返回
    if (images.length === 1) {
      this.log('Only one image, selecting it');
      return firstImage;
    }
    
    // 查找分辨率最高的图片
    const bestByResolution = images.reduce((best, current) => {
      const bestPixels = (best.width || 0) * (best.height || 0);
      const currentPixels = (current.width || 0) * (current.height || 0);
      return currentPixels > bestPixels ? current : best;
    }, images[0]);
    
    const bestPixels = (bestByResolution.width || 0) * (bestByResolution.height || 0);
    
    // 如果第一张图片的分辨率不低于最高分辨率的 90%，选择第一张
    // （即梦通常第一张质量最好）
    if (firstPixels >= bestPixels * 0.9) {
      this.log('Selected first image (best quality)');
      return firstImage;
    }
    
    // 否则选择分辨率最高的
    this.log('Selected highest resolution image');
    return bestByResolution;
  }

  async downloadImage(image: GeneratedImage, outputPath: string): Promise<string> {
    this.log(`Downloading image...`);
    const minDirectEdge = 500;
    const imageLooksThumbnail = (image.width || 0) < minDirectEdge && (image.height || 0) < minDirectEdge;
    
    // 确保输出目录存在
    const dir = path.dirname(outputPath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    // 1. 点击新生成的图片打开详情/大图
    this.log('Clicking on generated image...');
    const clickResult = await this.evaluate(`
      (function() {
        const targetUrl = ${JSON.stringify(image.url)};
        const targetIndex = ${image.index};
        const imgs = document.querySelectorAll('img[src*="byteimg"]');
        const allImgs = Array.from(imgs).filter(img => img.naturalWidth > 200 || img.width > 200);

        const exact = allImgs.find((img) => img.src === targetUrl);
        if (exact) {
          exact.click();
          return 'clicked image by url';
        }
        
        // 尝试点击目标索引的图片
        if (targetIndex < allImgs.length) {
          allImgs[targetIndex].click();
          return 'clicked image at index ' + targetIndex;
        }
        
        // 如果索引不存在，点击最后一张大图（新生成的）
        if (allImgs.length > 0) {
          allImgs[allImgs.length - 1].click();
          return 'clicked last large image';
        }
        
        return 'no image found';
      })()
    `);
    
    this.log('Image click: ' + clickResult);
    await sleep(2500);
    
    // 2. 尝试获取原图 URL（点击后可能显示大图）
    const originalUrl = await this.evaluate(`
      (function() {
        // 查找模态框或详情面板中的大图
        const modal = document.querySelector('[class*="modal"], [class*="dialog"], [class*="preview"], [class*="detail"]');
        if (modal) {
          const largeImg = modal.querySelector('img[src*="byteimg"]');
          if (largeImg && (largeImg.naturalWidth > 500 || largeImg.width > 500)) {
            return largeImg.src;
          }
        }
        
        // 查找所有大图片
        const imgs = document.querySelectorAll('img[src*="byteimg"]');
        for (const img of imgs) {
          if (img.naturalWidth > 800 || img.width > 800) {
            return img.src;
          }
        }
        
        return null;
      })()
    `);
    
    if (!imageLooksThumbnail && originalUrl && originalUrl.startsWith('http')) {
      this.log('Found original URL: ' + originalUrl.substring(0, 50) + '...');
      try {
        const response = await fetch(originalUrl, {
          headers: { 'Referer': 'https://jimeng.jianying.com/' },
        });
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const urlPath = new URL(originalUrl).pathname;
          const ext = path.extname(urlPath).toLowerCase();
          
          // 根据实际 URL 扩展名调整输出路径
          let finalOutputPath = outputPath;
          if (ext && ext !== path.extname(outputPath).toLowerCase()) {
            finalOutputPath = outputPath.replace(/\.[^.]+$/, ext);
            this.log(`Adjusted output extension: ${ext}`);
          }
          
          await fs.promises.writeFile(finalOutputPath, Buffer.from(buffer));
          this.log('Image saved via original URL: ' + finalOutputPath);
          return finalOutputPath;
        }
      } catch (e) {
        this.log('Original URL download failed: ' + String(e));
      }
    }
    
    // 3. 如果获取原图失败，尝试通过 URL 下载（可能还是缩略图）
    if (!imageLooksThumbnail && image.url && image.url.startsWith('http')) {
      this.log('Downloading via image URL...');
      try {
        const response = await fetch(image.url, {
          headers: { 'Referer': 'https://jimeng.jianying.com/' },
        });
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const urlPath = new URL(image.url).pathname;
          const ext = path.extname(urlPath).toLowerCase();
          
          // 根据实际 URL 扩展名调整输出路径
          let finalOutputPath = outputPath;
          if (ext && ext !== path.extname(outputPath).toLowerCase()) {
            finalOutputPath = outputPath.replace(/\.[^.]+$/, ext);
            this.log(`Adjusted output extension: ${ext}`);
          }
          
          await fs.promises.writeFile(finalOutputPath, Buffer.from(buffer));
          this.log('Image saved via URL: ' + finalOutputPath);
          return finalOutputPath;
        }
      } catch (e) {
        this.log('URL download failed: ' + String(e));
      }
    }
    
    if (imageLooksThumbnail) {
      this.log(`Selected image looks like thumbnail (${image.width}x${image.height}), using official download flow`);
    }

    // 4. 方案 3: 使用官方下载按钮
    this.log('Falling back to official download button...');
    
    // 检查可能的下载目录
    const possibleDownloadDirs = [
      path.join(os.homedir(), 'Downloads'),
      '/tmp/chrome-debug-profile/Downloads',
      '/tmp',
    ].filter(d => {
      try {
        return fs.existsSync(d);
      } catch {
        return false;
      }
    });
    
    // 记录各目录下载前的文件
    const beforeFilesMap = new Map<string, Set<string>>();
    for (const d of possibleDownloadDirs) {
      try {
        beforeFilesMap.set(d, new Set(await fs.promises.readdir(d)));
      } catch {}
    }
    
    // 点击下载按钮
    this.log('Looking for download button...');
    const downloadClicked = await this.evaluate(`
      (function() {
        // 优先查找明确的下载按钮
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text === '下载' || text === 'Download') {
            btn.click();
            return 'clicked download button: ' + text;
          }
        }
        
        // 查找下载图标按钮
        const downloadIcons = document.querySelectorAll('[class*="download"], [aria-label*="下载"], [aria-label*="download"], svg[class*="download"]');
        for (const icon of downloadIcons) {
          icon.click();
          return 'clicked download icon';
        }
        
        return 'download button not found';
      })()
    `);
    
    this.log('Download button: ' + downloadClicked);
    
    if (downloadClicked.includes('not found')) {
      throw new Error('Could not find download button');
    }
    
    await sleep(1000);
    
    // 处理确认对话框（如果有）
    await this.evaluate(`
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text === '确认' || text === '确定' || text === 'OK' || text === 'Yes') {
            btn.click();
            return 'confirmed';
          }
        }
        return 'no dialog';
      })()
    `);
    
    // 等待下载文件出现
    this.log('Waiting for download to complete...');
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(500);
      
      for (const d of possibleDownloadDirs) {
        const beforeFiles = beforeFilesMap.get(d);
        if (!beforeFiles) continue;
        
        try {
          const afterFiles = await fs.promises.readdir(d);
          for (const file of afterFiles) {
            if (!beforeFiles.has(file)) {
              const isImageFile = /\.(png|jpg|jpeg|webp)$/i.test(file);
              const isComplete = !file.endsWith('.crdownload') && !file.endsWith('.tmp');
              
              if (isComplete && isImageFile) {
                const newFile = path.join(d, file);
                await fs.promises.copyFile(newFile, outputPath);
                this.log('Image saved from download: ' + outputPath);
                return outputPath;
              }
            }
          }
        } catch {}
      }
    }
    
    throw new Error('Download timeout - no image file found');
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    
    try {
      await this.init();
      
      const found = await this.findJimengPage();
      if (!found) {
        throw new Error('Jimeng page not found. Please open jimeng.jianying.com in Chrome first.');
      }

      const beforeBottomRecord = await this.getBottomRecordSignature();
      this.log(`Initial bottom record baseline: ${JSON.stringify({ text: beforeBottomRecord.text.slice(0, 80), imageCount: beforeBottomRecord.imageCount, top: beforeBottomRecord.top, isEmpty: beforeBottomRecord.isEmpty })}`);

      // 切换到图片模式
      await this.switchToImageMode();
      
      // 确保使用 5.0 模型
      await this.ensureModel5();
      
      // 设置比例（如果指定）
      if (options.ratio) {
        await this.setRatio(options.ratio);
      }

      await this.dismissTransientUi();

      // 输入提示词
      await this.inputPrompt(options.prompt);

      await this.dismissTransientUi();

      // 记录生成前任务卡片数量（用于识别当前新任务）
      const existingRecordCount = await this.evaluate(`
        JSON.stringify((function() {
          return Array.from(document.querySelectorAll('div[class*="image-record"]')).filter((el) => {
            if (el.parentElement?.closest('div[class*="image-record"]')) return false;
            const imgs = Array.from(el.querySelectorAll('img[src*="byteimg"]')).filter((img) => !!img.src && img.src.startsWith('http'));
            return imgs.length >= 1 && imgs.length <= 8;
          }).length;
        })())
      `);
      const parsedExistingRecordCount = Number(existingRecordCount || 0);
      this.log(`Existing records before generation: ${parsedExistingRecordCount || 0}`);

      // 点击生成
      await this.clickGenerate();

      // 等待新图生成完成
      await this.waitForNewImages(parsedExistingRecordCount || 0, beforeBottomRecord, options.prompt);

      // 获取本轮新生成图片
      const images = await this.getNewGeneratedImages(parsedExistingRecordCount || 0, beforeBottomRecord, options.prompt);
      
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
