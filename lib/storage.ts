/**
 * localStorage 安全封装。
 *
 * ## 降级策略
 *
 * 隐私模式 / 配额超限时 localStorage 可能抛异常或写入失败。
 * 此时自动降级为**内存存储**：游戏仍可玩，但进度不落盘（下次打开即丢失）。
 * `isPersistent()` 让 UI 能提示用户当前处于「无持久化模式」。
 */

import type {
  DailySession,
  DomainId,
  HistoryEntry,
  MasteryMap,
  Profile,
  RoomSnapshot,
  WrongEntry,
} from "@/types";
import type { GhostRecord } from "@/lib/engine/ghost";
import { shiftDay } from "@/lib/engine/date";
import { createWrongEntry, onCorrect, onWrong } from "@/lib/engine/repetition";
import { computeRank, countTopicsTouched, type RankSnapshot } from "@/lib/engine/rank";

const PREFIX = "tongshi-ju.";

/** 内存兜底存储。 */
const memory = new Map<string, string>();

let persistent: boolean | null = null;

/** localStorage 是否可用（可用则持久化，否则退化为内存）。 */
export function isPersistent(): boolean {
  if (persistent !== null) return persistent;
  try {
    const probe = `${PREFIX}__probe__`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    persistent = true;
  } catch {
    persistent = false;
  }
  return persistent;
}

function readRaw(key: string): string | null {
  if (!isPersistent()) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string): void {
  if (!isPersistent()) {
    memory.set(key, value);
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 写入失败（配额满）→ 退回内存，至少本次会话可用
    memory.set(key, value);
    persistent = false;
  }
}

function removeRaw(key: string): void {
  memory.delete(key);
  if (!isPersistent()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(PREFIX + key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 忽略：值含循环引用等异常情况 */
  }
}

export function removeKey(key: string): void {
  removeRaw(PREFIX + key);
}

// ---------------------------------------------------------------- 档案

const DEFAULT_PROFILE: Profile = {
  name: "通识玩家",
  emoji: "🧠",
  domains: [],
  usedReroll: false,
  blindbox: false,
};

export function getProfile(): Profile {
  return { ...DEFAULT_PROFILE, ...readJson<Partial<Profile>>("profile", {}) };
}

export function saveProfile(patch: Partial<Profile>): Profile {
  const next = { ...getProfile(), ...patch };
  writeJson("profile", next);
  return next;
}

// ---------------------------------------------------------------- 每日挑战

export function getDailySession(date: string): DailySession | null {
  return readJson<DailySession | null>(`daily.${date}`, null);
}

export function saveDailySession(session: DailySession): void {
  writeJson(`daily.${session.date}`, session);
}

// ---------------------------------------------------------------- 连续天数

export interface StreakState {
  current: number;
  best: number;
  lastDate: string | null;
}

export function getStreak(): StreakState {
  return readJson<StreakState>("streak", { current: 0, best: 0, lastDate: null });
}

/**
 * 完成当天挑战后推进 streak。
 *
 * 规则：昨天完成过 → +1；否则从 1 重新开始（断签）。
 * 同一天重复完成**不重复计数**。
 */
export function bumpStreak(date: string): StreakState {
  const prev = getStreak();
  if (prev.lastDate === date) return prev;
  const yesterday = shiftDay(date, -1);
  const current = prev.lastDate === yesterday ? prev.current + 1 : 1;
  const next: StreakState = { current, best: Math.max(prev.best, current), lastDate: date };
  writeJson("streak", next);
  return next;
}

// ---------------------------------------------------------------- 熟练度

export function getMastery(): MasteryMap {
  return readJson<MasteryMap>("mastery", {});
}

/** 记录一次作答对错，返回更新后的熟练度。 */
export function recordMastery(domain: DomainId, topic: string, correct: boolean): MasteryMap {
  const map = getMastery();
  const key = `${domain}|${topic}`;
  const prev = map[key] ?? 0;
  const next = Math.max(0, prev + (correct ? 1 : -1));
  map[key] = next;
  writeJson("mastery", map);
  return map;
}

/** 熟练度 → 星级（0-5）。 */
export function masteryStars(value: number): number {
  return Math.max(0, Math.min(5, Math.floor(value / 2)));
}

// ---------------------------------------------------------------- 错题本

export function getWrongEntries(): WrongEntry[] {
  return readJson<WrongEntry[]>("wrong", []);
}

export function saveWrongEntries(entries: WrongEntry[]): void {
  writeJson("wrong", entries);
}

export interface AttemptParams {
  questionId: string;
  domain: DomainId;
  topic: string;
  correct: boolean;
  /**
   * 是否同时更新熟练度。默认为 true。
   * 独立练习流（`/wrong/practice`）只推进错题间隔，不刷熟练度与段位。
   */
  mastery?: boolean;
  now?: number;
}

/**
 * 记录一次作答对错 —— 熟练度与错题本的**唯一写入点**。
 *
 * 每日挑战、同题 PK、同步抢答结算、错题复习都走这里，
 * 避免四份各自维护的「答错进队列 / 答对推进 / 连对毕业」逻辑漂移。
 */
export function recordAttempt(params: AttemptParams): void {
  const now = params.now ?? Date.now();
  if (params.mastery !== false) {
    recordMastery(params.domain, params.topic, params.correct);
  }

  const entries = getWrongEntries();
  const existing = entries.find((e) => e.questionId === params.questionId);
  if (!params.correct) {
    const next = existing
      ? onWrong(existing, now)
      : createWrongEntry({
          questionId: params.questionId,
          domain: params.domain,
          topic: params.topic,
          now,
        });
    saveWrongEntries([...entries.filter((e) => e.questionId !== params.questionId), next]);
    return;
  }

  if (!existing) return;
  const next = onCorrect(existing, now);
  saveWrongEntries(
    next === null
      ? entries.filter((e) => e.questionId !== params.questionId)
      : [...entries.filter((e) => e.questionId !== params.questionId), next]
  );
}

// ---------------------------------------------------------------- 生涯累计

/**
 * 生涯累计统计 —— **不被历史窗口截断**。
 *
 * `getHistory()` 只保留最近 30 场（给"最近战绩"页面看），
 * 但段位需要的是**生涯**数据，所以单独存一份只增不减的计数。
 */
export interface LifetimeStats {
  /** 生涯答对题数。 */
  totalCorrect: number;
  /** 生涯完成局数。 */
  totalPlayed: number;
  /** 生涯累计星级。 */
  totalStars: number;
  /** 生涯最高连击。 */
  bestCombo: number;
}

const DEFAULT_LIFETIME: LifetimeStats = {
  totalCorrect: 0,
  totalPlayed: 0,
  totalStars: 0,
  bestCombo: 0,
};

export function getLifetimeStats(): LifetimeStats {
  return { ...DEFAULT_LIFETIME, ...readJson<Partial<LifetimeStats>>("lifetime", {}) };
}

/** 累加一次对局的成绩。 */
export function bumpLifetimeStats(delta: {
  correct: number;
  stars: number;
  maxCombo: number;
}): LifetimeStats {
  const prev = getLifetimeStats();
  const next: LifetimeStats = {
    totalCorrect: prev.totalCorrect + Math.max(0, delta.correct),
    totalPlayed: prev.totalPlayed + 1,
    totalStars: prev.totalStars + Math.max(0, delta.stars),
    bestCombo: Math.max(prev.bestCombo, delta.maxCombo),
  };
  writeJson("lifetime", next);
  return next;
}

/**
 * 当前段位。
 *
 * 组装 `RankInput` 并调用纯函数 `computeRank`。
 * 数据全部来自本地：生涯累计 + 熟练度表 + 最长连胜。
 */
export function getRankSnapshot(): RankSnapshot {
  const life = getLifetimeStats();
  const mastery = getMastery();
  const streak = getStreak();
  return computeRank({
    totalCorrect: life.totalCorrect,
    totalPlayed: life.totalPlayed,
    totalStars: life.totalStars,
    topicsTouched: countTopicsTouched(mastery),
    bestCombo: life.bestCombo,
    bestStreak: streak.best,
  });
}

// ---------------------------------------------------------------- 影子对手

/**
 * 影子记录表 —— `领域集合键 -> 影子`。
 *
 * 影子对手是**纯本地**的对手：不需要服务端、不需要账号，
 * 对手就是"过去的自己"（见 `lib/engine/ghost.ts`）。
 */
export function getGhosts(): Record<string, GhostRecord> {
  return readJson<Record<string, GhostRecord>>("ghosts", {});
}

/** 取某组领域下的影子；没有则返回 null。 */
export function getGhost(key: string): GhostRecord | null {
  return getGhosts()[key] ?? null;
}

/** 写入（或覆盖）某组领域下的影子。 */
export function saveGhost(record: GhostRecord): void {
  const all = getGhosts();
  all[record.key] = record;
  writeJson("ghosts", all);
}

// ---------------------------------------------------------------- 历史

const HISTORY_LIMIT = 30;

export function getHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>("history", []);
}

export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = [entry, ...getHistory()].slice(0, HISTORY_LIMIT);
  writeJson("history", list);
  return list;
}

// ---------------------------------------------------------------- duel 结算去重

/** 该房间最近一次已结算的 matchId；未结算过为 null。 */
export function getDuelSettledMatch(code: string): string | null {
  return readRaw(`${PREFIX}duelSettled.${code.toUpperCase()}`);
}

/** 记录该房间已结算的 matchId（刷新页面后据此跳过重复写入）。 */
export function setDuelSettledMatch(code: string, matchId: string): void {
  writeRaw(`${PREFIX}duelSettled.${code.toUpperCase()}`, matchId);
}

// ---------------------------------------------------------------- 凭证

/**
 * 本地 playerId 凭证（**按房间码分别保存**）。
 *
 * 为什么按房间码存而不是全局一个：玩家可能先建房、再加入另一个房间，
 * 只有一个全局凭证会让第二个房间的写操作带上错误的凭证。
 *
 * ⚠️ 纪律：写操作请求的凭证**只能**从这里取，**绝不能**从房间快照里取
 * —— 快照中的玩家 id 一律脱敏为空串，取到会表现为「提交答案 400 参数缺失」。
 */
export function getRoomPlayerId(code: string): string | null {
  return readRaw(`${PREFIX}playerId.${code.toUpperCase()}`);
}

export function setRoomPlayerId(code: string, playerId: string): void {
  writeRaw(`${PREFIX}playerId.${code.toUpperCase()}`, playerId);
}

export function clearRoomPlayerId(code: string): void {
  removeKey(`playerId.${code.toUpperCase()}`);
}

// ---------------------------------------------------------------- 首屏快照交接

/**
 * 房间快照交接 —— 大厅创建/加入后**预取**快照，房间页直接取来渲染。
 *
 * ## 为什么需要
 *
 * 慢链路（公网隧道 RTT ≈ 1s）下，「创建房间 → 跳转 → 首屏出画面」本来要**串行**等：
 * 跳转拉 RSC 载荷（1 个 RTT）→ 页面挂载 → 再拉快照（1 个 RTT）。
 * 大厅把「预取快照」与「跳转」**并行**发起，房间页通常能拿到现成快照直接出画面，
 * 首屏因此少等一个往返。
 *
 * ## 为什么存 sessionStorage
 *
 * 只服务「本标签页刚创建/加入」这一种场景，按标签页隔离，
 * 不会把上一个房间的快照带到新标签页。
 */
const handoffKey = (code: string) => `roomHandoff.${code.toUpperCase()}`;

/** 写入交接快照（只在本标签页生效）。 */
export function setRoomHandoff(code: string, snapshot: RoomSnapshot): void {
  try {
    window.sessionStorage.setItem(handoffKey(code), JSON.stringify(snapshot));
  } catch {
    /* 隐私模式 / 配额满：忽略，预取失败不影响主流程 */
  }
}

/** 读取交接快照；没有或已损坏返回 null。 */
export function getRoomHandoff(code: string): RoomSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(handoffKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as RoomSnapshot;
  } catch {
    return null;
  }
}

/** 用掉交接快照（读一次即失效，避免旧快照闪现）。 */
export function clearRoomHandoff(code: string): void {
  try {
    window.sessionStorage.removeItem(handoffKey(code));
  } catch {
    /* 忽略 */
  }
}
