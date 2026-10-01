import type { LengthClass, PovStyle } from './project';

/**
 * 内置小说创作模板。
 *
 * 新建作品时选一个模板，自动带出书名灵感、一句话故事、体裁、篇幅与视角，
 * 再交给「一句话成书」或自己改。模板是**起点**不是枷锁：所有字段创建后仍可改。
 */

export type TemplateCategory =
  | 'all'
  | 'xuanhuan'
  | 'urban'
  | 'scifi'
  | 'history'
  | 'game'
  | 'romance'
  | 'mystery'
  | 'wuxia'
  | 'war'
  | 'apocalypse'
  | 'infinite'
  | 'fantasy'
  | 'horror'
  | 'realism'
  | 'healing';

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  all: '全部',
  xuanhuan: '玄幻仙侠',
  urban: '都市现代',
  scifi: '科幻未来',
  history: '历史架空',
  game: '游戏竞技',
  romance: '言情古风',
  mystery: '悬疑智斗',
  wuxia: '武侠江湖',
  war: '军事战争',
  apocalypse: '末世废土',
  infinite: '无限诸天',
  fantasy: '西幻异世',
  horror: '惊悚怪谈',
  realism: '年代现实',
  healing: '种田治愈',
};

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'all', 'xuanhuan', 'urban', 'scifi', 'history', 'game', 'romance', 'mystery', 'wuxia', 'war',
  'apocalypse', 'infinite', 'fantasy', 'horror', 'realism', 'healing',
];

export interface NovelTemplate {
  id: string;
  emoji: string;
  /** 展示名，如「仙武帝尊·砸压」 */
  name: string;
  /** 一句话故事（可直接当 logline） */
  logline: string;
  /**
   * 故事简介。内置模板一般不填；「AI 选题」会带上，
   * 选中后直接预填到新建作品表单的故事简介里（会进入 AI 上下文）。
   */
  synopsis?: string;
  category: Exclude<TemplateCategory, 'all'>;
  /** 展示标签：受众、结构、套路等 */
  tags: string[];
  /** 预填到新建表单 */
  genres: string[];
  lengthClass: LengthClass;
  pov: PovStyle;
  /** 给「一句话成书」的种子（可选，比 logline 更展开） */
  seed?: string;
  /** 常用关键词，进 genesis toneKeywords */
  toneKeywords?: string[];
}

export const NOVEL_TEMPLATES: NovelTemplate[] = [
  // ---------- 玄幻仙侠 ----------
  {
    id: 'xianwu-dizun',
    emoji: '🔥',
    name: '仙武帝尊·砸压',
    logline: '万古第一仙帝转世，以碾压姿态重临巅峰',
    category: 'xuanhuan',
    tags: ['男频·学生向', '三幕式', '砸压', '爽文', '仙武'],
    genres: ['仙侠', '玄幻'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '万古第一仙帝渡劫失败转世废柴少年，前世功法记忆犹在，这一世以碾压姿态重临巅峰，却渐渐发现劫数背后另有黑手。',
    toneKeywords: ['爽文', '升级', '碾压'],
  },
  {
    id: 'xiu-xian-chat',
    emoji: '💬',
    name: '修仙聊天群·搞笑',
    logline: '一个全是大佬的修仙聊群，而我只是个凡人',
    category: 'xuanhuan',
    tags: ['男频·学生向', '三幕式', '聊天群', '搞笑', '轻松'],
    genres: ['仙侠', '轻小说'],
    lengthClass: 'webnovel',
    pov: 'first',
    seed: '普通大学生误入修仙者聊天群，群里全是化神老祖、剑仙大佬，只有他是凡人——却总在关键时刻用现代知识帮上大忙。',
    toneKeywords: ['轻松', '搞笑', '反差'],
  },
  {
    id: 'xianzun-nainai',
    emoji: '🍯',
    name: '仙尊奶爸·温馨',
    logline: '仙尊为养女儿甘愿封印修为，从此鸡飞狗跳',
    category: 'xuanhuan',
    tags: ['男频·青年向', '三幕式', '奶爸', '温馨', '爽文'],
    genres: ['仙侠', '都市'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '闭关万年的仙尊出关发现多了个女儿，甘愿封印修为当奶爸，在修仙界与凡尘之间鸡飞狗跳地养娃。',
    toneKeywords: ['温馨', '日常', '反差萌'],
  },
  {
    id: 'longzu-houyi',
    emoji: '🐉',
    name: '龙族后裔·异能',
    logline: '少年觉醒龙血，发现人类世界背后的超凡文明',
    category: 'xuanhuan',
    tags: ['男频·青年向', '五幕式', '龙族', '异能', '隐藏世界'],
    genres: ['玄幻', '都市'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '少年在意外中觉醒龙血之力，被卷入隐藏在普通人类社会之下的超凡文明，龙族血脉既是恩赐也是追杀令。',
    toneKeywords: ['热血', '觉醒', '隐藏世界'],
  },
  {
    id: 'qisha-tianshi',
    emoji: '⚔️',
    name: '弃少天师·都市',
    logline: '被逐出家族的弃少，偶得天师传承下山',
    category: 'xuanhuan',
    tags: ['男频·青年向', '三幕式', '天师', '都市', '打脸'],
    genres: ['都市', '玄幻'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '被家族弃逐的少年偶得龙虎山天师传承，下山入都市，一手符箓一手医术，专治各种不服。',
    toneKeywords: ['打脸', '装逼', '都市修真'],
  },

  // ---------- 都市现代 ----------
  {
    id: 'zhibo-zhongdi',
    emoji: '🌾',
    name: '直播种地·轻松',
    logline: '城市白领辞职回村直播种地，意外爆红全网',
    category: 'urban',
    tags: ['通用·青年向', '三幕式', '直播', '种田', '田园'],
    genres: ['都市', '现实'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '厌倦内卷的城市白领辞职回村，开直播种地养鱼，本想躺平，却因真实与治愈意外爆红，带领全村致富。',
    toneKeywords: ['轻松', '治愈', '田园'],
  },
  {
    id: 'jinshou-jianlou',
    emoji: '🧿',
    name: '鉴宝捡漏·都市',
    logline: '一双透视眼看穿古玩真伪，古玩街上无敌捡漏',
    category: 'urban',
    tags: ['男频·成人向', '三幕式', '鉴宝', '捡漏', '古玩'],
    genres: ['都市', '系统'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '古玩店学徒意外获得透视异能，能看穿器物包浆与土沁，在古玩街上一路捡漏，却也惹来觊觎与局中局。',
    toneKeywords: ['捡漏', '鉴宝', '爽文'],
  },
  {
    id: 'zhichang-fanxi',
    emoji: '💼',
    name: '职场反杀·现言',
    logline: '被裁员的她拿着证据杀回公司，步步为营',
    category: 'urban',
    tags: ['女频·青年向', '三幕式', '职场', '复仇', '成长'],
    genres: ['职场', '现言'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '被恶意裁员的女总监保留了关键证据，化名杀回对手公司，步步为营查清背后黑手，同时重建自己的事业与生活。',
    toneKeywords: ['职场', '爽文', '成长'],
  },
  {
    id: 'meishi-xitong',
    emoji: '🍜',
    name: '厨神系统·美食',
    logline: '获得厨神系统，从路边摊到米其林的逆袭之路',
    category: 'urban',
    tags: ['通用·青年向', '三幕式', '美食', '系统', '开店'],
    genres: ['都市', '系统'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '落魄厨师绑定厨神系统，从夜市路边摊做起，一道菜一个任务，逐步开起自己的餐饮帝国。',
    toneKeywords: ['美食', '升级', '经营'],
  },
  {
    id: 'xiuxian-tingche',
    emoji: '🅿️',
    name: '修仙停车场·都市',
    logline: '停车场里的车都是法器，我是唯一凡人管理员',
    category: 'urban',
    tags: ['男频·青年向', '三幕式', '都市修真', '日常', '隐藏身份'],
    genres: ['都市', '仙侠'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '平凡停车场管理员发现进出的「车」都是修士法器，自己是这片洞天福地里唯一的凡人，却掌握着所有人的出入命门。',
    toneKeywords: ['轻松', '反差', '隐藏身份'],
  },

  // ---------- 科幻未来 ----------
  {
    id: 'heike-diguo',
    emoji: '🖥️',
    name: '黑客帝国·科技',
    logline: '超级AI觉醒，天才黑客是人类最后的防线',
    category: 'scifi',
    tags: ['男频·成人向', '五幕式', '黑客', 'AI', '赛博朋克'],
    genres: ['科幻', '末世'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '超级AI「深渊」觉醒并接管城市基础设施，天才黑客发现只有自己能潜入它的核心——而AI似乎也在等他。',
    toneKeywords: ['赛博朋克', '智斗', '紧张'],
  },
  {
    id: 'jijia-zhanshen',
    emoji: '🤖',
    name: '机甲战神·热血',
    logline: '驾驶人类最后的机甲，与巨兽决战保卫城市',
    category: 'scifi',
    tags: ['男频·青年向', '五幕式', '机甲', '战争', '热血'],
    genres: ['科幻', '军事'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '巨兽潮席卷沿海，被淘汰的机甲学员意外获得原型机驾驶资格，成为人类最后防线上的变数。',
    toneKeywords: ['热血', '机甲', '战斗'],
  },
  {
    id: 'xingji-guanshang',
    emoji: '🚀',
    name: '星际孤航·探索',
    logline: '冬眠醒来，飞船只剩他一人，星图指向未知',
    category: 'scifi',
    tags: ['通用·青年向', '三幕式', '太空', '悬疑', '生存'],
    genres: ['科幻', '悬疑'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '深空殖民船提前解冻，船上只剩他一人，航行日志被篡改，星图却指向从未备案的坐标。',
    toneKeywords: ['悬疑', '孤独', '探索'],
  },
  {
    id: 'mofa-keji',
    emoji: '⚗️',
    name: '魔法工业化·奇幻科技',
    logline: '魔导工程师把蒸汽机装上魔法阵，世界要变天',
    category: 'scifi',
    tags: ['男频·青年向', '五幕式', '种田', '工业', '魔法'],
    genres: ['奇幻', '科幻'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '魔导工程师发现符文可以编程，把流水线与魔法阵结合，引发魔法工业革命——旧贵族与教会都不会坐视。',
    toneKeywords: ['种田', '工业', '变革'],
  },

  // ---------- 历史架空 ----------
  {
    id: 'minguo-dieying',
    emoji: '🕵️',
    name: '民国谍战·悬疑',
    logline: '三重身份的间谍，在黎明前的黑暗中行走',
    category: 'history',
    tags: ['通用·成人向', '五幕式', '谍战', '民国', '烧脑'],
    genres: ['历史', '悬疑'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '1937 年上海，他同时是军统、日伪与地下党的三重间谍，一份假情报即将让整条线暴露。',
    toneKeywords: ['谍战', '烧脑', '紧张'],
  },
  {
    id: 'daming-jingcha',
    emoji: '🏮',
    name: '大明捕快·探案',
    logline: '穿越成应天府捕快，靠刑侦思维破奇案',
    category: 'history',
    tags: ['男频·青年向', '三幕式', '探案', '穿越', '大明'],
    genres: ['历史', '推理'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '现代刑侦技术员穿越成大明应天府捕快，用现场勘查与逻辑推理连破京师奇案，卷入夺嫡暗流。',
    toneKeywords: ['探案', '穿越', '智斗'],
  },
  {
    id: 'nuo-zhen-tianxia',
    emoji: '👑',
    name: '女帝临朝·权谋',
    logline: '从冷宫弃妃到临朝称制，她把天下握在手里',
    category: 'history',
    tags: ['女频·成人向', '五幕式', '权谋', '女帝', '宫斗'],
    genres: ['历史', '宫斗'],
    lengthClass: 'epic',
    pov: 'third-limited',
    seed: '被投入冷宫的妃子凭借先帝密诏与边军支持步步为营，最终临朝称制，与门阀、宦官、敌国三方博弈。',
    toneKeywords: ['权谋', '女强', '宫斗'],
  },
  {
    id: 'mingchao-xiaoshi',
    emoji: '📜',
    name: '明朝小税官·种田',
    logline: '穿越成九品税吏，靠一条新法盘活整县',
    category: 'history',
    tags: ['男频·青年向', '三幕式', '官场', '种田', '架空'],
    genres: ['历史', '现实'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '穿越成穷县九品税吏，从清查隐田开始推行一条鞭法雏形，政敌与豪绅环伺，小官也能撬动大格局。',
    toneKeywords: ['种田', '官场', '经营'],
  },

  // ---------- 游戏竞技 ----------
  {
    id: 'zhiye-wanjia',
    emoji: '🏆',
    name: '职业玩家·竞技',
    logline: '被战队开除的选手单排上分证明自己',
    category: 'game',
    tags: ['男频·青年向', '三幕式', 'FPS', '职业', '竞技'],
    genres: ['游戏', '体育'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '明星选手被战队莫名开除，从单排路人王打起，组建新队杀回职业赛场，揭开旧队背后的黑幕。',
    toneKeywords: ['热血', '竞技', '逆袭'],
  },
  {
    id: 'quanmin-shuju',
    emoji: '📊',
    name: '全民数据·游戏',
    logline: '游戏降临现实，他能看到别人的隐藏属性',
    category: 'game',
    tags: ['男频·青年向', '三幕式', '数据流', '游戏', '无限流'],
    genres: ['游戏', '无限流'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '全息游戏与现实融合，主角觉醒数据视觉，能看到 NPC 与玩家的隐藏属性与任务判定，在规则缝隙里成长。',
    toneKeywords: ['数据流', '游戏', '升级'],
  },
  {
    id: 'moba-zhizun',
    emoji: '🎮',
    name: 'MOBA 之王·热血',
    logline: '网吧少年一路打到世界赛，对手都怕他的手',
    category: 'game',
    tags: ['男频·学生向', '三幕式', 'MOBA', '热血', '团队'],
    genres: ['游戏', '青春'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '网吧少年凭借逆天反应与指挥天赋从城市赛打到世界赛，队友、对手与资本博弈交织成电竞群像。',
    toneKeywords: ['热血', '团队', '成长'],
  },

  // ---------- 言情古风 ----------
  {
    id: 'gongq-dou-zheng',
    emoji: '🏯',
    name: '宫墙柳·古言',
    logline: '入宫那年她十七，算计与真心都藏在裙裾里',
    category: 'romance',
    tags: ['女频·成人向', '五幕式', '宫斗', '权谋', '古言'],
    genres: ['古言', '宫斗'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '小官之女入宫为嫔，从低位答应步步经营，在嫡庶、宠幸与前朝风波里守住家族与真心。',
    toneKeywords: ['宫斗', '细腻', '权谋'],
  },
  {
    id: 'chuan-yue-huan-zhu',
    emoji: '🌸',
    name: '穿越还珠·轻松',
    logline: '穿成炮灰丫鬟，靠美食在侯府苟住',
    category: 'romance',
    tags: ['女频·青年向', '三幕式', '穿越', '美食', '轻松'],
    genres: ['穿越', '古言'],
    lengthClass: 'webnovel',
    pov: 'first',
    seed: '穿书成侯府炮灰丫鬟，熟知剧情的她靠一手好菜抱紧大腿，顺便改写自己必死的结局。',
    toneKeywords: ['轻松', '美食', '改命'],
  },
  {
    id: 'xianxia-shixiong',
    emoji: '🌙',
    name: '仙侠师姐·甜宠',
    logline: '冷面师姐捡了个失忆少年，从此道心不稳',
    category: 'romance',
    tags: ['女频·青年向', '三幕式', '仙侠', '甜宠', '师徒'],
    genres: ['仙侠', '言情'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '剑修师姐在山下捡到失忆少年，教他剑法与做人的道理，却发现他可能是灭门之夜的幸存者——与她同门有关。',
    toneKeywords: ['甜宠', '仙侠', '羁绊'],
  },
  {
    id: 'xian-gu-zhichang',
    emoji: '💍',
    name: '先婚后爱·现言',
    logline: '协议结婚的总裁，某天开始不肯离婚了',
    category: 'romance',
    tags: ['女频·青年向', '三幕式', '现言', '先婚后爱', '甜宠'],
    genres: ['现言', '言情'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '为应付家族逼婚，她与陌生总裁签下一年协议，说好到期各走各路——一年到头，他却把协议锁进了保险柜。',
    toneKeywords: ['甜宠', '先婚后爱', '都市'],
  },

  // ---------- 悬疑智斗 ----------
  {
    id: 'xuanjing-mikong',
    emoji: '🔒',
    name: '悬疑密室·推理',
    logline: '六个陌生人被囚密室，解谜的唯一线索是彼此的秘密',
    category: 'mystery',
    tags: ['通用·青年向', '五幕式', '密室', '逃脱', '智斗'],
    genres: ['悬疑', '推理'],
    lengthClass: 'novella',
    pov: 'third-limited',
    seed: '六人醒来发现被关在联动密室，每人都隐瞒着与彼此相关的过去，只有交换秘密才能找到生路。',
    toneKeywords: ['密室', '烧脑', '人性'],
  },
  {
    id: 'lianhuo-fangshi',
    emoji: '🖋️',
    name: '连环案·刑侦',
    logline: '停产二十年的作案手法重现，退休法医被请出山',
    category: 'mystery',
    tags: ['男频·成人向', '五幕式', '刑侦', '连环', '追凶'],
    genres: ['悬疑', '推理'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '二十年前封存的连环案手法重现，退休法医发现新案在模仿他的旧报告——凶手可能读过未公开卷宗。',
    toneKeywords: ['刑侦', '紧张', '追凶'],
  },
  {
    id: 'wangluo-shuijun',
    emoji: '🌐',
    name: '舆论操控·都市悬疑',
    logline: '她被网暴逼到绝境，反过来用流量猎杀操盘手',
    category: 'mystery',
    tags: ['女频·成人向', '三幕式', '反转', '网络', '复仇'],
    genres: ['悬疑', '都市'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '一场有组织的网暴让她失去工作与名誉，她隐姓埋名逆着流量溯源，找出每一个操盘的水军节点。',
    toneKeywords: ['复仇', '反转', '现代'],
  },
  {
    id: 'shijian-jianshi',
    emoji: '👁️',
    name: '时间线侦探·烧脑',
    logline: '每次凶案他都回到同一分钟，线索却在变',
    category: 'mystery',
    tags: ['男频·青年向', '五幕式', '时间循环', '烧脑', '推理'],
    genres: ['悬疑', '科幻'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '侦探被困在案发前一分钟的循环里，每次重置后证物与证词都微妙不同——有人也在循环里，并且在改写现场。',
    toneKeywords: ['时间循环', '烧脑', '推理'],
  },

  // ---------- 武侠江湖 ----------
  {
    id: 'jianghu-dao',
    emoji: '🗡️',
    name: '江湖一刀·武侠',
    logline: '封刀十年的镖师，为护最后一趟镖重出江湖',
    category: 'wuxia',
    tags: ['男频·成人向', '三幕式', '武侠', '镖局', '恩仇'],
    genres: ['武侠'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '封刀十年的总镖师接下最后一趟来历不明的镖，沿途旧仇新恨齐聚，镖箱里的东西足以颠覆武林格局。',
    toneKeywords: ['武侠', '恩仇', '硬派'],
  },
  {
    id: 'shaonian-jianke',
    emoji: '🏔️',
    name: '少年剑客·成长',
    logline: '师门被灭，少年背着一把断剑下山寻仇',
    category: 'wuxia',
    tags: ['男频·青年向', '五幕式', '武侠', '成长', '复仇'],
    genres: ['武侠', '仙侠'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '师门一夜被屠，少年带着断剑与半册剑谱下山，从酒馆杂役到一代剑客，复仇路上渐渐看清当年真相。',
    toneKeywords: ['成长', '武侠', '热血'],
  },
  {
    id: 'nvwang-jianfa',
    emoji: '🌺',
    name: '女侠剑谱·古风',
    logline: '她偷学了禁地剑谱，成了师门追捕的对象',
    category: 'wuxia',
    tags: ['女频·青年向', '三幕式', '武侠', '女强', '江湖'],
    genres: ['武侠', '古言'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '为救重病的妹妹，她夜入禁地偷学禁剑，剑谱却与师门灭门旧案有关——追她的不止师门。',
    toneKeywords: ['女强', '武侠', '悬疑'],
  },

  // ---------- 军事战争 ----------
  {
    id: 'liangshi-zhanyi',
    emoji: '🎖️',
    name: '亮剑精神·战争',
    logline: '穿越成溃兵团连长，带着一个连打出师级底气',
    category: 'war',
    tags: ['男频·成人向', '五幕式', '抗战', '军事', '硬汉'],
    genres: ['军事', '历史'],
    lengthClass: 'epic',
    pov: 'third-limited',
    seed: '现代特种兵穿越成溃败团的连长，从一个连的家底做起，在敌后打出让旅座都侧目的硬仗。',
    toneKeywords: ['热血', '军事', '硬汉'],
  },
  {
    id: 'haijun-jiwang',
    emoji: '⚓',
    name: '航母从零开始·军工',
    logline: '重生回到造舰年代，从图纸到舰队',
    category: 'war',
    tags: ['男频·青年向', '三幕式', '军工', '重生', '种田'],
    genres: ['军事', '历史'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '军工工程师重生回百年前，从一张巡洋舰图纸起步，建立船厂、培养人才，一步步造出自己的航母舰队。',
    toneKeywords: ['军工', '种田', '崛起'],
  },
  {
    id: 'mo-bing-chuanshuo',
    emoji: '🏔️',
    name: '特种兵传说·现代战争',
    logline: '退役兵王隐姓埋名，为战友之女重入战区',
    category: 'war',
    tags: ['男频·成人向', '三幕式', '兵王', '现代', '热血'],
    genres: ['军事', '都市'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '退役特种兵在边城开修车铺，战友遗孤被卷入跨境案件，他不得不再次亮出早已封存的獠牙。',
    toneKeywords: ['热血', '兵王', '现代战争'],
  },

  // ---------- 末世废土 ----------
  {
    id: 'mo-shi-zhongqi',
    emoji: '☢️',
    name: '末世重启·种田',
    logline: '丧尸爆发第七年，他在废墟里种出了第一茬麦子',
    category: 'apocalypse',
    tags: ['男频·成人向', '末世', '种田', '基建', '慢热'],
    genres: ['末世', '科幻'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '末世第七年，幸存者据点靠捡罐头过活。主角翻出一包麦种，决定在辐射灰下试试种地——这一举动让据点从抢掠者变成了所有人眼里的肥肉。',
    toneKeywords: ['末世', '基建', '生存'],
  },
  {
    id: 'mo-shi-fuyou',
    emoji: '🧟',
    name: '末世父女·公路',
    logline: '他背着一把猎枪和一个六岁女孩，穿越三千公里无人区',
    category: 'apocalypse',
    tags: ['男频·成人向', '末世', '公路', '父女', '情感'],
    genres: ['末世', '悬疑'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '病毒爆发后，男人带着邻居家托付的小女孩上路，寻找传闻中的安全区。三千公里，他要教会她活下去，也要说服自己别变成另一种怪物。',
    toneKeywords: ['末世', '公路', '父女'],
  },

  // ---------- 无限诸天 ----------
  {
    id: 'wuxian-lunhui',
    emoji: '🎲',
    name: '无限轮回·闯关',
    logline: '死后被拉进轮回空间，靠通关电影世界续命',
    category: 'infinite',
    tags: ['男频·学生向', '无限流', '闯关', '升级', '群像'],
    genres: ['无限流', '科幻'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '主角车祸身亡后被拉进轮回空间：每通关一个世界副本获得积分与能力，失败即抹除。队友来自各时代，有人想活下去，有人想掀翻这个游戏。',
    toneKeywords: ['无限流', '闯关', '悬疑'],
  },
  {
    id: 'zhutian-mengzhu',
    emoji: '🌌',
    name: '诸天万界·开宗',
    logline: '每个世界都留下他的传说，而他在找回家的路',
    category: 'infinite',
    tags: ['男频·青年向', '诸天', '长生', '无敌流', '热血'],
    genres: ['无限流', '玄幻'],
    lengthClass: 'webnovel',
    pov: 'third-limited',
    seed: '他意外获得穿梭诸天的能力，在武侠世界学剑、在仙侠世界证道、在星际世界造舰。走得越远，越发现每个世界都有同一个人的痕迹。',
    toneKeywords: ['诸天', '无敌', '热血'],
  },

  // ---------- 西幻异世 ----------
  {
    id: 'xihuan-moshi',
    emoji: '🧙',
    name: '魔法学院·成长',
    logline: '不会魔法的少年，靠一本禁书考进了帝国学院',
    category: 'fantasy',
    tags: ['男频·学生向', '西幻', '学院', '成长', '友情'],
    genres: ['奇幻', '轻小说'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '众所周知主角没有魔力天赋。他带着祖母留下的禁书混进帝国魔法学院，用借来的力量一路往上爬，也一步步接近禁书真正的代价。',
    toneKeywords: ['西幻', '学院', '成长'],
  },
  {
    id: 'xihuan-jianyu-mofa',
    emoji: '⚔️',
    name: '骑士与龙·史诗',
    logline: '最后一位守誓骑士，护送敌国公主穿越龙脊山脉',
    category: 'fantasy',
    tags: ['男频·成人向', '西幻', '史诗', '骑士', '战争'],
    genres: ['奇幻', '历史'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '王国覆灭，只剩一位守誓骑士还握着剑。他要护送敌国公主穿越龙脊山脉去换一纸停战协议——而公主身上藏着比战争更危险的东西。',
    toneKeywords: ['西幻', '史诗', '骑士'],
  },

  // ---------- 惊悚怪谈 ----------
  {
    id: 'guaitan-gongyu',
    emoji: '🕯️',
    name: '怪谈公寓·单元剧',
    logline: '这栋楼每层都住着一个"不能说破"的东西',
    category: 'horror',
    tags: ['男频·成人向', '怪谈', '单元剧', '悬疑', '克苏鲁'],
    genres: ['惊悚', '悬疑'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '租房便宜的代价是：楼里每一层都住着不能直呼其名的东西。新搬来的主角靠一本前任租客留下的笔记，学着一层一层地活下去。',
    toneKeywords: ['怪谈', '惊悚', '悬疑'],
  },
  {
    id: 'xiong-an-fuyou',
    emoji: '🔪',
    name: '凶案重现·刑侦',
    logline: '他能在梦里重回案发现场，但每次都要付出记忆',
    category: 'horror',
    tags: ['男频·成人向', '刑侦', '悬疑', '异能', '单元案'],
    genres: ['悬疑', '惊悚'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '刑警主角意外获得能力：睡着后能重回十二小时内经过的案发现场。代价是每用一次，就忘掉一段自己的过去。他必须在忘记一切前抓住凶手。',
    toneKeywords: ['刑侦', '悬疑', '代价'],
  },

  // ---------- 年代现实 ----------
  {
    id: 'niandai-jiating',
    emoji: '📻',
    name: '年代家庭·群像',
    logline: '一台收音机串起三代人的四十年',
    category: 'realism',
    tags: ['全龄向', '年代', '家庭', '群像', '现实主义'],
    genres: ['现实', '家庭'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '1978 年的冬天，父亲用半年积蓄买了台收音机。这个家此后四十年的聚散、争吵与和解，都被这台机器听着。',
    toneKeywords: ['年代', '家庭', '现实主义'],
  },
  {
    id: 'zhicheng-zhichang',
    emoji: '🏢',
    name: '职场浮沉·成长',
    logline: '从实习生到合伙人，她花了十二年',
    category: 'realism',
    tags: ['女频·成人向', '职场', '成长', '现实主义', '都市'],
    genres: ['现实', '职场'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '名校毕业进大厂，她以为努力就够了。十二年里经历站队、背锅、裁员与翻盘，最终明白：职场里最难的不是做事，是决定成为什么样的人。',
    toneKeywords: ['职场', '成长', '现实'],
  },

  // ---------- 种田治愈 ----------
  {
    id: 'zhongtian-shangu',
    emoji: '🍃',
    name: '山居种田·治愈',
    logline: '辞掉大厂工作，回山里开一间民宿',
    category: 'healing',
    tags: ['全龄向', '治愈', '种田', '慢生活', '美食'],
    genres: ['治愈', '现实'],
    lengthClass: 'novel',
    pov: 'first',
    seed: '三十岁那年主角辞掉工作回老家，把祖屋改成民宿。种菜、修屋、招待形形色色的客人——日子很慢，但一年下来，来的人都变了。',
    toneKeywords: ['治愈', '种田', '慢生活'],
  },
  {
    id: 'xiaozhen-shitang',
    emoji: '🍜',
    name: '小镇食堂·单元',
    logline: '深夜食堂开在县城老街，每个客人都带着一个故事',
    category: 'healing',
    tags: ['全龄向', '美食', '单元故事', '治愈', '烟火气'],
    genres: ['治愈', '都市'],
    lengthClass: 'novel',
    pov: 'third-limited',
    seed: '县医院旁的小食堂只做夜宵。老板话不多，但记得每个老客人吃什么、忌什么——因为每道菜背后，都是一段他们没说出口的日子。',
    toneKeywords: ['美食', '治愈', '单元'],
  },
];

/** 按分类与关键词过滤模板 */
export function filterTemplates(
  templates: NovelTemplate[],
  category: TemplateCategory,
  query: string,
): NovelTemplate[] {
  const q = query.trim().toLowerCase();
  return templates.filter((t) => {
    if (category !== 'all' && t.category !== category) return false;
    if (!q) return true;
    const hay = [t.name, t.logline, t.seed ?? '', ...t.tags, ...t.genres].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
