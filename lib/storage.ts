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
  WrongEntry,
} from "@/types";

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
  const yesterday = shiftDateKey(date, -1);
  const current = prev.lastDate === yesterday ? prev.current + 1 : 1;
  const next: StreakState = { current, best: Math.max(prev.best, current), lastDate: date };
  writeJson("streak", next);
  return next;
}

/** 日期加减（UTC 计算，仅用于日期字符串，避免时区漂移）。 */
export function shiftDateKey(dateKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
