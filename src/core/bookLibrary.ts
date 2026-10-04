/**
 * 书库：免费公版书目录（维基文库 zh.wikisource.org）。
 *
 * 只收**已验证存在子页**的整本书（前缀/第01回 这种结构），目录页数据来自
 * MediaWiki API（origin=* 带 CORS，网页版/桌面版都能直接用）。
 * 公版书没有版权问题，抓取也只在你点「一键拆书」时发生。
 */
export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  /** 维基文库子页前缀，如「老殘遊記」→ 老殘遊記/第01回… */
  prefix: string;
}

export const BOOK_LIBRARY: LibraryBook[] = [
  { id: "laoCanYouJi", title: "老殘遊記", author: "刘鹗", prefix: "老殘遊記" },
  { id: "xiYouJi", title: "西遊記", author: "吴承恩", prefix: "西遊記" },
  { id: "sanGuoYanYi", title: "三國演義", author: "罗贯中", prefix: "三國演義" },
  { id: "hongLouMeng", title: "紅樓夢", author: "曹雪芹", prefix: "紅樓夢" },
  { id: "shuiHuZhuan", title: "水滸傳", author: "施耐庵", prefix: "水滸傳" },
  { id: "ruLinWaiShi", title: "儒林外史", author: "吴敬梓", prefix: "儒林外史" },
  { id: "jingHuaYuan", title: "鏡花緣", author: "李汝珍", prefix: "鏡花緣" },
  { id: "fengShenYanYi", title: "封神演義", author: "许仲琳", prefix: "封神演義" },
  { id: "suiTangYanYi", title: "隋唐演義", author: "褚人获", prefix: "隋唐演義" },
  { id: "shiShuoXinYu", title: "世說新語", author: "刘义庆", prefix: "世說新語" },
  { id: "sanXiaWuYi", title: "三俠五義", author: "石玉昆", prefix: "三俠五義" },
  { id: "xingShiYinYuan", title: "醒世姻緣傳", author: "西周生", prefix: "醒世姻緣傳" },
  { id: "fuXianXianTan", title: "負曝閒談", author: "蘧园", prefix: "負曝閒談" },
  { id: "nieHaiHua", title: "孽海花", author: "曾朴", prefix: "孽海花" },
];
