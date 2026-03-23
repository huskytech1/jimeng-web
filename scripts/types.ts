export type ImageRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export type ImageStyle = 
  | 'general'      // 通用
  | 'realistic'    // 写实
  | 'anime'        // 动漫
  | 'chinese'      // 中国风
  | 'oil_painting' // 油画
  | 'watercolor'   // 水彩
  | 'sketch'       // 素描
  | 'cyberpunk';   // 赛博朋克

export interface JimengConfig {
  dataDir: string;
  cookiePath: string;
  profileDir: string;
  chromePath?: string;
}

export interface GenerateOptions {
  prompt: string;
  outputPath?: string;
  ratio?: ImageRatio;
  style?: ImageStyle;
  negativePrompt?: string;
}

export interface GeneratedImage {
  url: string;
  index: number;
  width?: number;
  height?: number;
}

export interface GenerateResult {
  success: boolean;
  images: GeneratedImage[];
  savedPath?: string;
  error?: string;
  duration?: number;
}

export interface CliArgs {
  prompt: string | null;
  outputPath: string | null;
  ratio: ImageRatio;
  style: ImageStyle | null;
  negativePrompt: string | null;
  json: boolean;
  login: boolean;
  cookiePath: string | null;
  profileDir: string | null;
  headless: boolean;
  help: boolean;
}

export const JIMENG_URL = 'https://jimeng.jianying.com/ai-tool/image/generate';

export const DEFAULT_CONFIG: JimengConfig = {
  dataDir: '',
  cookiePath: '',
  profileDir: '',
};
