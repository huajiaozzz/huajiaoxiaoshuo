import type { ID, Timestamped } from './base';
import type { ModelParams, ProviderConfig, TaskRouting } from './ai';

/**
 * 界面主题清单（唯一来源）。
 * - light/dark/system：中性配色（白 / 黑 / 浅灰），默认
 * - warm：暖阳 —— 奶油底 + 近黑字 + 琥珀/橙强调
 * - soft：柔彩 —— 淡蓝白底 + 莓粉强调 + 极淡氛围渐变
 *
 * 加/删主题只改这里：loadSettings 的回落校验与设置页按钮都从它派生。
 */
export const THEMES = ['light', 'dark', 'warm', 'soft', 'system'] as const;

export type Theme = (typeof THEMES)[number];

export interface AppSettings {
  /** 当前激活的供应商 */
  activeProviderId?: ID;
  /** 当前激活模型 */
  activeModel?: string;
  /** UI 主题 */
  theme: Theme;
  /** 编辑器字号 */
  editorFontSize: number;
  /** 编辑器宽度 px，0 = 自适应 */
  editorMaxWidth: number;
  /** 自动保存间隔 ms */
  autosaveMs: number;
  /** 自动快照间隔（分钟），0 关闭 */
  snapshotIntervalMin: number;
  /** 心流模式默认开启 */
  flowByDefault: boolean;
  /** 打字机滚动 */
  typewriterScroll: boolean;
  /** AI 上下文预算 tokens */
  contextBudget: number;
  /** 每次生成候选数 */
  candidateCount: number;
  /** 是否默认流式输出 */
  stream: boolean;
  /** 隐私：是否允许把正文发给云模型（关闭后仅本地模型） */
  allowCloud: boolean;

  // ---------- 创作者档案：会进入所有 AI 调用的 system prompt ----------
  /** 笔名，生成时用于署名与自称 */
  penName?: string;
  /** 惯用体裁，影响 AI 的题材要点提示 */
  defaultGenres: string[];
  /** 惯用视角 */
  defaultPov?: 'first' | 'third-limited' | 'third-omniscient' | 'second' | 'mixed';
  /** 一以贯之的写作原则，逐条进入 system prompt */
  writingPrinciples: string[];
  /** 全局禁用词/表达（比单本书的 forbidden 优先级更高） */
  globalForbidden: string[];
  /** 给 AI 的长期补充指令 */
  globalInstructions?: string;

  // ---------- 语义召回（可选，默认关闭） ----------
  semanticRecall?: SemanticRecallSettings;
  // ---------- OpenViking 增强召回（可选，默认关闭） ----------
  viking?: VikingSettings;
  // ---------- Laya 本地决策模型（可选，默认关闭） ----------
  laya?: LayaSettings;
  // ---------- Hindsight 云记忆（可选，默认关闭） ----------
  hindsight?: HindsightSettings;
  // ---------- 保存后自动抽取（默认开启） ----------
  autoExtract?: AutoExtractSettings;
}

/** 向量来源：本地 Ollama，或任意 OpenAI 兼容的 /embeddings 端点 */
export type EmbeddingSource = 'ollama' | 'provider';

export interface SemanticRecallSettings {
  /**
   * 默认 false：不配好 embedding 就完全走原来的规则排序。
   * 这一点是刻意的 —— 语义召回是"锦上添花"，绝不能让没装 Ollama 的作者
   * 每次生成都白等一次网络超时。
   */
  enabled: boolean;
  source: EmbeddingSource;
  /** source = provider 时指向「模型与 AI」里已配置的供应商（复用 key / 代理设置） */
  providerId?: ID;
  model: string;
  /** source = ollama 时的地址：可以是完整端点，也可以只写主机名（自动补 /api/embeddings） */
  endpoint: string;
  /** 每次召回的条数 */
  topK: number;
}

export const DEFAULT_SEMANTIC_RECALL: SemanticRecallSettings = {
  enabled: false,
  source: 'ollama',
  model: 'nomic-embed-text',
  endpoint: 'http://127.0.0.1:11434/api/embeddings',
  topK: 8,
};

/** 补全缺省值：老版本存下来的 settings 里没有 semanticRecall */
export function resolveSemanticRecall(settings?: Partial<AppSettings> | null): SemanticRecallSettings {
  const raw = settings?.semanticRecall;
  return {
    ...DEFAULT_SEMANTIC_RECALL,
    ...(raw ?? {}),
    // topK 用 0 会让召回失效，兜回默认值
    topK: raw?.topK && raw.topK > 0 ? Math.min(raw.topK, 24) : DEFAULT_SEMANTIC_RECALL.topK,
  };
}

// ---------- OpenViking 增强召回（可选，默认关闭） ----------
export interface VikingSettings {
  /**
   * 默认 false。OpenViking 是外置的分级记忆服务：
   *  - 火山引擎托管版（官方，默认地址）：云服务，在控制台拿 API Key 填进来即可；
   *  - 自建开源版：本机跑 openviking-server，默认 127.0.0.1:1933，不用 Key。
   * 没开就完全不碰它 —— 本地向量召回与规则排序照常工作。
   */
  enabled: boolean;
  /** 服务地址：默认火山引擎托管的 OpenViking Context */
  endpoint: string;
  /** 火山托管必填（控制台 → 用户管理 → API Key）；自建版留空 */
  apiKey?: string;
  /** 可选：X-OpenViking-Agent，用来区分是哪个应用写的数据 */
  agent?: string;
}

/** 火山引擎托管的 OpenViking Context（官方服务） */
export const VIKING_CLOUD_ENDPOINT = 'https://api.vikingdb.cn-beijing.volces.com/openviking';
/** 自建开源版 */
export const VIKING_SELF_HOSTED_ENDPOINT = 'http://127.0.0.1:1933';

export const DEFAULT_VIKING: VikingSettings = {
  enabled: false,
  endpoint: VIKING_CLOUD_ENDPOINT,
};

export function resolveViking(settings?: Partial<AppSettings> | null): VikingSettings {
  const raw = (settings as { viking?: Partial<VikingSettings> } | null)?.viking;
  return {
    ...DEFAULT_VIKING,
    ...(raw ?? {}),
    endpoint: (raw?.endpoint ?? '').trim() || DEFAULT_VIKING.endpoint,
  };
}

// ---------- 保存后自动抽取（默认开启） ----------
export interface AutoExtractSettings {
  /**
   * 默认 true。写完章节不用再去点"抽取"：自动保存后，后台把新增的人物、
   * 世界观、伏笔、时间线抽出来入库。关掉就回到纯手动（时间线页的抽取弹窗还在）。
   */
  enabled: boolean;
  /** 自上次抽取新增多少字才跑一次，避免写两句就调一次模型 */
  minNewWords: number;
}

export const DEFAULT_AUTO_EXTRACT: AutoExtractSettings = {
  enabled: true,
  minNewWords: 800,
};

export function resolveAutoExtract(settings?: Partial<AppSettings> | null): AutoExtractSettings {
  const raw = (settings as { autoExtract?: Partial<AutoExtractSettings> } | null)?.autoExtract;
  return {
    ...DEFAULT_AUTO_EXTRACT,
    ...(raw ?? {}),
    minNewWords: raw?.minNewWords && raw.minNewWords > 0 ? Math.min(raw.minNewWords, 10000) : DEFAULT_AUTO_EXTRACT.minNewWords,
  };
}

// ---------- Laya 本地决策模型（可选，默认关闭） ----------
export interface LayaSettings {
  /**
   * 默认 false。Laya 是跑在本机的决策模型（需另行启动 scripts/laya-bridge.py），
   * 没开就完全不碰它 —— 相关判定走原来的固定值。
   */
  enabled: boolean;
  /** 桥接服务地址，默认本地 1945 端口 */
  endpoint: string;
}

export const DEFAULT_LAYA: LayaSettings = {
  enabled: false,
  endpoint: 'http://127.0.0.1:1945',
};

export function resolveLaya(settings?: Partial<AppSettings> | null): LayaSettings {
  const raw = (settings as { laya?: Partial<LayaSettings> } | null)?.laya;
  return {
    ...DEFAULT_LAYA,
    ...(raw ?? {}),
    endpoint: (raw?.endpoint ?? '').trim() || DEFAULT_LAYA.endpoint,
  };
}

// ---------- Hindsight 云记忆（可选，默认关闭） ----------
export interface HindsightSettings {
  /**
   * 默认 false。Hindsight 是云端记忆服务（要注册拿 hsk_ 开头的 key，另建 bank），
   * 没开就完全不碰它 —— 本地链路照常工作。
   */
  enabled: boolean;
  /** 云 API 地址，一般不用改 */
  apiUrl: string;
  /** hsk_ 开头的 key，存在本地设置里，不上传别处 */
  apiKey?: string;
  /** 记忆库 id，在 Hindsight 后台建好后填进来 */
  bankId?: string;
}

export const DEFAULT_HINDSIGHT: HindsightSettings = {
  enabled: false,
  apiUrl: 'https://api.hindsight.vectorize.io',
};

export function resolveHindsight(settings?: Partial<AppSettings> | null): HindsightSettings {
  const raw = (settings as { hindsight?: Partial<HindsightSettings> } | null)?.hindsight;
  return {
    ...DEFAULT_HINDSIGHT,
    ...(raw ?? {}),
    apiUrl: (raw?.apiUrl ?? '').trim() || DEFAULT_HINDSIGHT.apiUrl,
  };
}

export interface ModelPricing {
  id: ID;
  /** providerId::model */
  key: string;
  /** 每百万 token 价格（元） */
  inputPerM: number;
  outputPerM: number;
}

export interface AppState extends Timestamped {
  id: 'singleton';
  lastProjectId?: ID;
  lastChapterId?: ID;
  recentProjectIds: ID[];
  onboardingDone: boolean;
}

export interface ProviderBundle {
  providers: ProviderConfig[];
  routing: TaskRouting[];
  pricing: ModelPricing[];
  defaults: ModelParams;
}
