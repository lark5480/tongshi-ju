/**
 * 12 个知识领域的元数据 —— 领域体系的唯一真相源。
 *
 * 设计要点：
 * - `id` 与题库文件名一一对应（`content/domains/<id>.json`）；
 * - `topics` 是**子知识点白名单**，题目的 `topic` 必须命中白名单（由 validate-content 强制）；
 * - `batch` 标记**补题批次**（1 = 首发，2/3 = 后续补齐），仅用于溯源与文档；
 * - `enabled` 标记当前是否已上线 —— **12 个域现已全部上线**。
 *
 * 后续再加新领域：补齐 `content/domains/<id>.json`（≥40 题）→ 在这里登记元数据
 * → `npm run validate:content` 通过。**只加数据、不改代码**。
 */

import type { DomainId, DomainMeta } from "@/types";

export const DOMAINS: DomainMeta[] = [
  {
    id: "gaming",
    name: "游戏",
    color: "#6C5CE7",
    emoji: "🎮",
    batch: 1,
    enabled: true,
    topics: ["主机与PC", "手游", "品类与玩法", "经典作品", "赛事", "梗与亚文化"],
  },
  {
    id: "anime",
    name: "动漫",
    color: "#FF6B9D",
    emoji: "🌸",
    batch: 1,
    enabled: true,
    topics: ["经典作品", "作者与工作室", "声优", "制作公司", "动画史", "周边文化"],
  },
  {
    id: "tech",
    name: "科技",
    color: "#00B894",
    emoji: "⚙️",
    batch: 1,
    enabled: true,
    topics: ["半导体与芯片", "人工智能", "消费电子原理", "航天", "能源与电池"],
  },
  {
    id: "coding",
    name: "编程·算法",
    color: "#0984E3",
    emoji: "💻",
    batch: 1,
    enabled: true,
    topics: ["数据结构", "算法与复杂度", "语言特性", "操作系统", "网络与协议"],
  },
  {
    id: "life",
    name: "生活·柴米油盐",
    color: "#E17055",
    emoji: "🍚",
    batch: 1,
    enabled: true,
    topics: ["饮食与食材", "生活妙招", "家庭维修", "理财常识", "健康常识", "节气食俗"],
  },
  {
    id: "history",
    name: "历史·文化",
    color: "#A29BFE",
    emoji: "🏛️",
    batch: 1,
    enabled: true,
    topics: ["中国史", "世界史", "文学史", "传统文化", "节日与习俗"],
  },
  {
    id: "auto",
    name: "汽车",
    color: "#D63031",
    emoji: "🚗",
    batch: 2,
    enabled: true,
    topics: ["品牌与车型", "动力与混动", "造车工艺", "汽车史", "赛车"],
  },
  {
    id: "mobile",
    name: "手机",
    color: "#00CEC9",
    emoji: "📱",
    batch: 2,
    enabled: true,
    topics: ["芯片与系统", "影像", "通讯技术", "机型常识", "行业史"],
  },
  {
    id: "film",
    name: "电影·娱乐",
    color: "#E84393",
    emoji: "🎬",
    batch: 2,
    enabled: true,
    topics: ["电影史", "经典影片", "剧集", "演员与导演", "配乐", "综艺与音乐"],
  },
  {
    id: "science",
    name: "科学·自然",
    color: "#00A8B5",
    emoji: "🔬",
    batch: 2,
    enabled: true,
    topics: ["物理常识", "化学常识", "生物常识", "天文", "地球科学", "人体"],
  },
  {
    id: "literature",
    name: "语文·文学",
    color: "#8E44AD",
    emoji: "📖",
    batch: 3,
    enabled: true,
    topics: ["古典诗词", "成语典故", "近现代文学", "汉字与语言", "修辞"],
  },
  {
    id: "travel",
    name: "地理·旅行",
    color: "#F39C12",
    emoji: "🧭",
    batch: 3,
    enabled: true,
    topics: ["世界地标", "中国地理", "地名由来", "气候地貌", "旅行常识"],
  },
];

const DOMAIN_MAP = new Map<DomainId, DomainMeta>(DOMAINS.map((d) => [d.id, d]));

export function getDomain(id: DomainId): DomainMeta | undefined {
  return DOMAIN_MAP.get(id);
}

export function domainName(id: DomainId): string {
  return DOMAIN_MAP.get(id)?.name ?? id;
}

export function domainColor(id: DomainId): string {
  return DOMAIN_MAP.get(id)?.color ?? "#8b93a1";
}

export function domainEmoji(id: DomainId): string {
  return DOMAIN_MAP.get(id)?.emoji ?? "•";
}

/** 当前已上线的领域。 */
export function enabledDomains(): DomainMeta[] {
  return DOMAINS.filter((d) => d.enabled);
}

/** 某领域的 topic 白名单。 */
export function topicsOf(id: DomainId): string[] {
  return DOMAIN_MAP.get(id)?.topics ?? [];
}

/** 校验某个 topic 是否属于该领域。 */
export function isValidTopic(id: DomainId, topic: string): boolean {
  return topicsOf(id).includes(topic);
}
