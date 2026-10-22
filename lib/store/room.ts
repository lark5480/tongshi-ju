/**
 * 房间状态机（服务端权威）。
 *
 * ## 权威边界
 *
 * - **计时**：服务端记录 `startedAt` / `deadlineAt`，客户端提交时**不传用时**，
 *   服务端用收到时刻计算 `elapsed`。客户端只负责显示倒计时。
 * - **答案正确性**：服务端持有完整题目（含答案），判定只在服务端发生。
 *   答案与解析在 `round_result` 结算时才随事件下发。
 * - **回合推进**：只由服务端推进（`syncRoomPhase`），客户端不推进。
 *
 * ## 相位推进为什么做成「惰性 + 定时器」双保险
 *
 * `syncRoomPhase()` 根据服务端时间戳把房间推进到应处相位。它在
 * 「读取快照 / 提交答案 / 定时器回调」三处被调用：
 * - 定时器负责正常路径上的及时推进与事件广播；
 * - 惰性调用保证**即使定时器丢失**（Serverless 环境常见），
 *   房间状态仍然收敛到正确相位，不会卡死。
 *
 * ## 跨域连击的规则冲突如何裁定
 *
 * 需求文档里「玩家答错 / 被抢 / 超时 → 连击归零」与
 * 「对手抢先答对本轮 → 不影响本玩家连击（不奖不罚）」存在冲突。
 * 本实现采用**更具体的后者**：
 * - 惩罚只针对**自己的失误**（自己答错、自己超时未答）；
 * - **被对手抢先不算失误**，连击保持不变。
 * 这样「连击」表达的是「我连续几轮抢先拿下不同领域的题」，
 * 而不是「我没被抢到」。
 */

import { nanoid } from "nanoid";

import type {
  DomainId,
  PublicPlayer,
  RoomCredential,
  RoomEvent,
  RoomPlayer,
  RoomSnapshot,
  RoundRecord,
  Slot,
} from "@/types";

import { buildDailySet, pickDomainsBySeed } from "@/lib/engine/daily";
import { isCorrect } from "@/lib/engine/answer";
import {
  DIFFICULTY_LIMIT_MS,
  comboMultiplier,
  decideWinner,
  nextCombo,
  roundPoints,
} from "@/lib/engine/scoring";
import { hashSeed } from "@/lib/engine/prng";
import { bankPool, findQuestion } from "@/lib/content/server-bank";
import { DOMAINS } from "@/content/domains";
import { broadcast } from "@/lib/realtime";

import { ROOM_LIMITS } from "./constants";

// ---------------------------------------------------------------- 常量

/**
 * 房间码字符集：剔除 0/O/1/I/L 等易混字符。
 * （I 与 L 长得像 1；O 像 0；口径与 chess-arena 保持一致）
 */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 每局题数。 */
export const TOTAL_ROUNDS = 5;

/** 相位时长（毫秒）。 */
const COUNTDOWN_MS = 3000;
const FEEDBACK_MS = 3000;

// ---------------------------------------------------------------- 错误类型

export class RoomError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "room_error") {
    super(message);
    this.name = "RoomError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- 存储

const ROOMS_KEY = "__tongshiRooms";
const TIMERS_KEY = "__tongshiRoomTimers";

type GlobalWithRooms = typeof globalThis & {
  [ROOMS_KEY]?: Map<string, RoomStateInternal>;
  [TIMERS_KEY]?: Map<string, ReturnType<typeof setTimeout>>;
};

/** 内部态：与对外 `RoomState` 同构，另加内部计时器引用。 */
interface RoomStateInternal {
  code: string;
  hostId: string;
  players: Record<string, RoomPlayer>;
  status: RoomSnapshot["status"];
  seed: number;
  domains: DomainId[];
  questions: RoomSnapshot["questions"];
  roundIndex: number;
  startedAt: number | null;
  deadlineAt: number | null;
  limitMs: number;
  answered: Record<string, { answer: string | string[]; at: number; correct: boolean }>;
  lockedWinnerId: string | null;
  nextAt: number | null;
  scores: Record<string, number>;
  combos: Record<string, number>;
  /** 内部态：playerId -> 本场最高连击。 */
  maxCombos: Record<string, number>;
  firstCorrect: Record<string, number>;
  lastWinDomain: Record<string, DomainId | null>;
  history: RoundRecord[];
  createdAt: number;
  lastActivity: number;
  reason?: string;
}

function rooms(): Map<string, RoomStateInternal> {
  const g = globalThis as GlobalWithRooms;
  if (!g[ROOMS_KEY]) g[ROOMS_KEY] = new Map();
  return g[ROOMS_KEY]!;
}

function timers(): Map<string, ReturnType<typeof setTimeout>> {
  const g = globalThis as GlobalWithRooms;
  if (!g[TIMERS_KEY]) g[TIMERS_KEY] = new Map();
  return g[TIMERS_KEY]!;
}

// ---------------------------------------------------------------- 工具

function generateRoomCode(): string {
  const map = rooms();
  let code: string;
  do {
    code = "";
    for (let i = 0; i < ROOM_LIMITS.CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (map.has(code));
  return code;
}

function slotOf(room: RoomStateInternal, playerId: string): Slot | null {
  const p = room.players[playerId];
  return p ? p.slot : null;
}

function requirePlayer(room: RoomStateInternal, playerId: string): RoomPlayer {
  const p = room.players[playerId];
  if (!p) throw new RoomError("你不在这个房间里", 403, "not_a_player");
  return p;
}

/** 该域是否已上线（有题）。 */
function enabledDomainIds(): DomainId[] {
  return DOMAINS.filter((d) => d.enabled).map((d) => d.id);
}

// ---------------------------------------------------------------- 对外事件

function snapshotOf(room: RoomStateInternal): RoomSnapshot {
  const players: PublicPlayer[] = [];
  for (const slot of [0, 1] as Slot[]) {
    const p = Object.values(room.players).find((x) => x.slot === slot);
    if (!p) continue;
    players.push({
      slot: p.slot,
      name: p.name,
      emoji: p.emoji,
      ready: p.ready,
      connected: p.connected,
      // 比分/连击/抢先答对次数的**真相**是 room.scores / room.combos / room.firstCorrect。
      // 这里**从真相派生**，绝不读可能滞后的镜像字段 ——
      // 否则 players[].score 会永远是 0（历史缺陷）。
      score: room.scores[p.id] ?? 0,
      combo: room.combos[p.id] ?? 0,
      firstCorrect: room.firstCorrect[p.id] ?? 0,
      maxCombo: room.maxCombos[p.id] ?? 0,
    });
  }

  const scores: Record<string, number> = {};
  const combos: Record<string, number> = {};
  for (const p of Object.values(room.players)) {
    scores[String(p.slot)] = room.scores[p.id] ?? 0;
    combos[String(p.slot)] = room.combos[p.id] ?? 0;
  }

  return {
    code: room.code,
    matchId: `${room.code}:${room.seed}`,
    hostSlot: 0,
    status: room.status,
    domains: room.domains,
    roundIndex: room.roundIndex,
    questions: room.questions,
    startedAt: room.startedAt,
    deadlineAt: room.deadlineAt,
    limitMs: room.limitMs,
    nextAt: room.nextAt,
    lockedWinnerSlot: room.lockedWinnerId ? slotOf(room, room.lockedWinnerId) : null,
    scores,
    combos,
    players,
    history: room.history,
    serverNow: Date.now(),
    totalRounds: TOTAL_ROUNDS,
    reason: room.reason,
  };
}

/** 广播全量状态（幂等，客户端以最新快照为准）。 */
function broadcastState(room: RoomStateInternal): void {
  const event: RoomEvent = { type: "state", room: snapshotOf(room) };
  broadcast(room.code, event);
}

function broadcastEvent(room: RoomStateInternal, event: RoomEvent): void {
  broadcast(room.code, event);
}

// ---------------------------------------------------------------- 相位推进

/**
 * 把房间推进到「当前时刻应该处于的相位」。
 *
 * 这是回合推进的**唯一权威入口**。返回 true 表示发生了相位变化。
 */
export function syncRoomPhase(room: RoomStateInternal, now = Date.now()): boolean {
  if (room.status === "lobby" || room.status === "finished") return false;

  if (room.status === "countdown" && room.nextAt !== null && now >= room.nextAt) {
    // 倒计时结束 → 进入答题相位
    const meta = room.questions[room.roundIndex];
    if (!meta) {
      finishRoom(room, "题库异常");
      return true;
    }
    room.status = "question";
    // 用「计划时刻」而非 now 作为起点，保证双方看到的时间戳完全一致
    room.startedAt = room.nextAt;
    room.limitMs = DIFFICULTY_LIMIT_MS[meta.difficulty];
    room.deadlineAt = room.startedAt + room.limitMs;
    room.answered = {};
    room.lockedWinnerId = null;
    room.nextAt = null;
    schedulePhase(room, room.deadlineAt);
    broadcastEvent(room, {
      type: "round_start",
      roundIndex: room.roundIndex,
      question: meta,
      startedAt: room.startedAt,
      deadlineAt: room.deadlineAt,
    });
    return true;
  }

  if (room.status === "question" && room.deadlineAt !== null && now >= room.deadlineAt) {
    // 答题超时 → 本回合无人答对，双方 0 分
    settleRound(room, null, now, true);
    return true;
  }

  if (room.status === "feedback" && room.nextAt !== null && now >= room.nextAt) {
    room.roundIndex += 1;
    if (room.roundIndex >= room.questions.length || room.roundIndex >= TOTAL_ROUNDS) {
      finishRoom(room, "全部题目已完成");
      return true;
    }
    room.status = "countdown";
    room.nextAt = room.nextAt; // 沿用计划时刻，避免累积漂移
    room.startedAt = null;
    room.deadlineAt = null;
    schedulePhase(room, room.nextAt);
    broadcastEvent(room, {
      type: "countdown",
      roundIndex: room.roundIndex,
      nextAt: room.nextAt,
    });
    return true;
  }

  return false;
}

/** 安排一次定时推进（Serverless 下可能丢失，由惰性 sync 兜底）。 */
function schedulePhase(room: RoomStateInternal, at: number | null): void {
  const map = timers();
  const existing = map.get(room.code);
  if (existing) clearTimeout(existing);
  if (at === null) return;
  const delay = Math.max(0, at - Date.now());
  const handle = setTimeout(() => {
    map.delete(room.code);
    const r = rooms().get(room.code);
    if (!r) return;
    if (syncRoomPhase(r)) broadcastState(r);
  }, delay);
  // 不阻止进程退出
  if (typeof handle.unref === "function") handle.unref();
  map.set(room.code, handle);
}

function clearPhaseTimer(code: string): void {
  const map = timers();
  const existing = map.get(code);
  if (existing) {
    clearTimeout(existing);
    map.delete(code);
  }
}

function finishRoom(room: RoomStateInternal, reason: string): void {
  room.status = "finished";
  room.reason = reason;
  room.nextAt = null;
  room.startedAt = null;
  room.deadlineAt = null;
  clearPhaseTimer(room.code);
  const scores: Record<string, number> = {};
  for (const p of Object.values(room.players)) scores[String(p.slot)] = room.scores[p.id] ?? 0;
  broadcastEvent(room, { type: "duel_end", scores, reason });
}

// ---------------------------------------------------------------- 结算

/**
 * 是否每个席位都已作答 —— 「双方都答错就立即结算」的判据。
 *
 * 只看 `room.players`（1v1 固定两席），**不看 `connected`**：
 * 掉线的一方仍然握着作答机会，不该因为掉线让回合被提前跳过。
 */
function allPlayersAnswered(room: RoomStateInternal): boolean {
  for (const p of Object.values(room.players)) {
    if (!room.answered[p.id]) return false;
  }
  return true;
}

/**
 * 结算一个回合。
 *
 * @param winnerId 抢先答对的玩家；null = 无人答对
 * @param timedOut 本回合是否因**读秒耗尽**结束 —— 它只用来给「未作答的人」归零连击；
 *                 双方都答错而提前结算时传 `false`（没人超时，也没人未作答）
 */
function settleRound(
  room: RoomStateInternal,
  winnerId: string | null,
  now: number,
  timedOut: boolean
): void {
  const meta = room.questions[room.roundIndex];
  if (!meta) {
    finishRoom(room, "题库异常");
    return;
  }
  const full = findQuestion(meta.id);

  const elapsed: Record<string, number | null> = {};
  const correct: Record<string, boolean> = {};
  const points: Record<string, number> = {};
  const slotScores: Record<string, number> = {};

  for (const p of Object.values(room.players)) {
    const key = String(p.slot);
    const ans = room.answered[p.id];
    elapsed[key] = ans && room.startedAt !== null ? ans.at - room.startedAt : null;
    correct[key] = ans?.correct === true;

    let gain = 0;
    if (winnerId === p.id && room.startedAt !== null) {
      const e = ans ? ans.at - room.startedAt : 0;
      const comboBefore = room.combos[p.id] ?? 0;
      gain = roundPoints(meta.difficulty, e, room.limitMs, comboBefore);
    }
    points[key] = gain;
    slotScores[key] = (room.scores[p.id] ?? 0) + gain;
    room.scores[p.id] = slotScores[key];
    p.score = slotScores[key]; // 同步镜像（对外快照以 room.scores 为准）
  }

  // 连击结算（规则冲突裁定见文件头注释）
  for (const p of Object.values(room.players)) {
    const ans = room.answered[p.id];
    if (winnerId === p.id) {
      const prev = room.lastWinDomain[p.id] ?? null;
      const combo = nextCombo(room.combos[p.id] ?? 0, true, prev, meta.domain);
      room.combos[p.id] = combo;
      p.combo = combo; // 同步镜像
      room.lastWinDomain[p.id] = meta.domain;
      const firstCorrect = (room.firstCorrect[p.id] ?? 0) + 1;
      room.firstCorrect[p.id] = firstCorrect;
      p.firstCorrect = firstCorrect; // 同步镜像
    } else if (ans && !ans.correct) {
      // 自己答错 → 归零
      room.combos[p.id] = 0;
      p.combo = 0; // 同步镜像
    } else if (!ans && timedOut) {
      // 自己超时未答 → 归零
      room.combos[p.id] = 0;
      p.combo = 0; // 同步镜像
    }
    // 未作答且被对手抢先 → 连击保持不变（不奖不罚）
  }

  // 全场最高连击：只增不减，供结算时写本地档案（不影响本回合计分）
  for (const p of Object.values(room.players)) {
    room.maxCombos[p.id] = Math.max(room.maxCombos[p.id] ?? 0, room.combos[p.id] ?? 0);
  }

  const record: RoundRecord = {
    roundIndex: room.roundIndex,
    domain: meta.domain,
    topic: meta.topic,
    questionId: meta.id,
    correctAnswer: full ? full.answer : "",
    explanation: full ? full.explanation : "",
    winnerSlot: winnerId ? slotOf(room, winnerId) : null,
    elapsed,
    correct,
    points,
    tie: false,
  };
  room.history.push(record);

  room.status = "feedback";
  room.nextAt = now + FEEDBACK_MS;
  room.startedAt = null;
  room.deadlineAt = null;
  schedulePhase(room, room.nextAt);

  const scores: Record<string, number> = {};
  for (const p of Object.values(room.players)) scores[String(p.slot)] = room.scores[p.id] ?? 0;

  broadcastEvent(room, { type: "round_result", record, scores });
}

// ---------------------------------------------------------------- 对外动作

/** 创建房间。 */
export function createRoom(params: {
  name: string;
  emoji: string;
  domains: DomainId[];
}): RoomCredential {
  const map = rooms();
  if (map.size >= ROOM_LIMITS.MAX_ROOMS) {
    throw new RoomError("服务器房间已满，请稍后再试", 503, "room_limit");
  }
  const now = Date.now();
  const code = generateRoomCode();
  const playerId = nanoid(21);

  const room: RoomStateInternal = {
    code,
    hostId: playerId,
    players: {
      [playerId]: {
        id: playerId,
        slot: 0,
        name: params.name,
        emoji: params.emoji,
        ready: false,
        connected: false,
        score: 0,
        combo: 0,
        firstCorrect: 0,
        maxCombo: 0,
      },
    },
    status: "lobby",
    seed: 0,
    domains: params.domains.slice(0, 3),
    questions: [],
    roundIndex: 0,
    startedAt: null,
    deadlineAt: null,
    limitMs: DIFFICULTY_LIMIT_MS[1],
    answered: {},
    lockedWinnerId: null,
    nextAt: null,
    scores: { [playerId]: 0 },
    combos: { [playerId]: 0 },
    maxCombos: { [playerId]: 0 },
    firstCorrect: { [playerId]: 0 },
    lastWinDomain: { [playerId]: null },
    history: [],
    createdAt: now,
    lastActivity: now,
  };
  map.set(code, room);
  return { code, playerId, slot: 0, isHost: true };
}

/** 加入房间。 */
export function joinRoom(params: { code: string; name: string; emoji: string }): RoomCredential {
  const map = rooms();
  const room = map.get(params.code);
  if (!room) throw new RoomError("房间不存在或已结束", 404, "room_not_found");
  if (room.status !== "lobby") {
    throw new RoomError("对局已经开始，无法加入", 409, "room_started");
  }
  const guestSlot = Object.values(room.players).find((p) => p.slot === 1);
  if (guestSlot) throw new RoomError("房间已满", 409, "room_full");

  const now = Date.now();
  const playerId = nanoid(21);
  room.players[playerId] = {
    id: playerId,
    slot: 1,
    name: params.name,
    emoji: params.emoji,
    ready: false,
    connected: false,
    score: 0,
    combo: 0,
    firstCorrect: 0,
    maxCombo: 0,
  };
  room.scores[playerId] = 0;
  room.combos[playerId] = 0;
  room.maxCombos[playerId] = 0;
  room.firstCorrect[playerId] = 0;
  room.lastWinDomain[playerId] = null;
  room.lastActivity = now;
  broadcastState(room);

  return { code: room.code, playerId, slot: 1, isHost: false };
}

/** 取房间（自动清理过期房间）。 */
export function getRoom(code: string): RoomStateInternal | undefined {
  const map = rooms();
  const room = map.get(code);
  if (!room) return undefined;
  if (isExpired(room)) {
    clearPhaseTimer(code);
    map.delete(code);
    return undefined;
  }
  return room;
}

/** 取脱敏快照。 */
export function getSnapshot(code: string): RoomSnapshot | null {
  const room = getRoom(code);
  if (!room) return null;
  const changed = syncRoomPhase(room);
  if (changed) broadcastState(room);
  return snapshotOf(room);
}

/**
 * 按凭证解析玩家席位。
 *
 * 只在**私有响应**（`GET /api/rooms/[code]?playerId=...`）中使用，
 * 用于告诉客户端「你的席位是几、你是不是房主」。
 * 凭证本身不会出现在任何广播事件或快照里。
 */
export function getPlayerSlot(code: string, playerId: string): Slot | null {
  const room = getRoom(code);
  if (!room) return null;
  return slotOf(room, playerId);
}

/** 标记在线状态（按连接计数，多标签页不误判离线）。 */
export function setConnected(code: string, playerId: string, connected: boolean): void {
  const room = getRoom(code);
  if (!room) return;
  const p = room.players[playerId];
  if (!p) return;
  if (p.connected === connected) return;
  p.connected = connected;
  room.lastActivity = Date.now();
  broadcastState(room);
}

/** 设置准备状态。 */
export function setReady(code: string, playerId: string, ready: boolean): RoomSnapshot {
  const room = getRoom(code);
  if (!room) throw new RoomError("房间不存在或已结束", 404, "room_not_found");
  const p = requirePlayer(room, playerId);
  if (room.status !== "lobby") {
    throw new RoomError("对局已经开始", 409, "room_started");
  }
  p.ready = ready;
  room.lastActivity = Date.now();
  broadcastState(room);
  return snapshotOf(room);
}

/** 房主开局。 */
export function startRoom(code: string, playerId: string): RoomSnapshot {
  const room = getRoom(code);
  if (!room) throw new RoomError("房间不存在或已结束", 404, "room_not_found");
  if (room.hostId !== playerId) {
    throw new RoomError("只有房主可以开局", 403, "not_host");
  }
  if (room.status !== "lobby") {
    throw new RoomError("对局已经开始", 409, "room_started");
  }
  const players = Object.values(room.players);
  if (players.length < 2) {
    throw new RoomError("至少需要两位玩家才能开局", 409, "not_enough_players");
  }
  if (!players.every((p) => p.ready)) {
    throw new RoomError("等待双方准备", 409, "not_all_ready");
  }

  const now = Date.now();
  const seed = hashSeed("duel:" + code + ":" + playerId + ":" + now);

  // 领域集合：房主选定的领域；若房主未选，则按房间种子确定性地随机 3 个（双方一致）
  const chosen = room.domains.filter((d) => enabledDomainIds().includes(d));
  const domains = chosen.length > 0 ? chosen : pickDomainsBySeed(seed, enabledDomainIds(), 3);

  if (domains.length === 0) {
    throw new RoomError("暂时没有可用的题库领域", 503, "no_domain");
  }

  const picks = buildDailySet({
    dateKey: "",
    domains,
    count: TOTAL_ROUNDS,
    pool: bankPool(domains),
    seed,
  });
  if (picks.length === 0) {
    throw new RoomError("题库暂不可用，请稍后再试", 503, "empty_bank");
  }

  room.seed = seed;
  room.domains = domains;
  room.questions = picks.map((p) => ({
    id: p.question.id,
    domain: p.question.domain,
    topic: p.question.topic,
    difficulty: p.question.difficulty,
    type: p.question.type,
    stem: p.question.stem,
    options: p.question.options,
  }));
  room.roundIndex = 0;
  room.status = "countdown";
  room.nextAt = now + COUNTDOWN_MS;
  room.startedAt = null;
  room.deadlineAt = null;
  room.answered = {};
  room.lockedWinnerId = null;
  room.history = [];
  for (const p of players) {
    room.scores[p.id] = 0;
    room.combos[p.id] = 0;
    room.maxCombos[p.id] = 0;
    room.firstCorrect[p.id] = 0;
    room.lastWinDomain[p.id] = null;
    p.score = 0; // 同步镜像
    p.combo = 0;
    p.maxCombo = 0;
    p.firstCorrect = 0;
    p.ready = false;
  }
  room.lastActivity = now;
  schedulePhase(room, room.nextAt);

  broadcastEvent(room, {
    type: "countdown",
    roundIndex: 0,
    nextAt: room.nextAt,
  });
  broadcastState(room);
  return snapshotOf(room);
}

/**
 * 提交答案 —— **服务端权威判定**。
 *
 * 客户端只传 `{ roundIndex, answer }`，**不传用时**；
 * 服务端用收到时刻减去 `startedAt` 计算用时。
 */
export function submitAnswer(params: {
  code: string;
  playerId: string;
  roundIndex: number;
  answer: string | string[];
}): { ok: true; correct: boolean; winnerSlot: Slot | null } {
  const room = getRoom(params.code);
  if (!room) throw new RoomError("房间不存在或已结束", 404, "room_not_found");
  const player = requirePlayer(room, params.playerId);
  const now = Date.now();

  // ---- 超时判定必须早于相位推进 ----
  // 否则超时提交会因为回合已被结算而得到 `not_answering`，
  // 客户端就分不清「你答晚了」和「题目已经换了」。
  if (
    room.status === "question" &&
    room.startedAt !== null &&
    now - room.startedAt > room.limitMs
  ) {
    throw new RoomError("答题时间已到", 408, "timeout");
  }

  syncRoomPhase(room, now);

  // 校验顺序有讲究：对客户端而言，「被对方抢先了」比「不是答题阶段」更有信息量。
  if (room.answered[params.playerId]) {
    throw new RoomError("本题已经作答过了", 409, "already_answered");
  }
  if (room.lockedWinnerId) {
    throw new RoomError("本回合已被抢先", 409, "round_locked");
  }
  if (room.status !== "question") {
    throw new RoomError("当前不是答题阶段", 409, "not_answering");
  }
  if (params.roundIndex !== room.roundIndex) {
    throw new RoomError("题目已切换", 409, "stale_round");
  }
  if (room.startedAt === null) {
    throw new RoomError("回合状态异常", 409, "bad_state");
  }

  const elapsed = now - room.startedAt;
  if (elapsed > room.limitMs) {
    // 超时提交：忽略答案，不锁定回合（对手仍可作答）
    throw new RoomError("答题时间已到", 408, "timeout");
  }

  const meta = room.questions[room.roundIndex];
  const full = meta ? findQuestion(meta.id) : undefined;
  if (!meta || !full) {
    throw new RoomError("题目异常", 500, "bad_question");
  }

  const correct = isCorrect(full.type, full.answer, params.answer);
  room.answered[params.playerId] = { answer: params.answer, at: now, correct };
  room.lastActivity = now;

  const slot = player.slot;
  broadcastEvent(room, {
    type: "player_answered",
    roundIndex: room.roundIndex,
    playerSlot: slot,
  });

  if (!correct) {
    // 答错：记 0 分，等待对手作答或超时。
    // 连击**立即**归零 —— 这是「自己的失误」，不等回合结算。
    room.combos[params.playerId] = 0;
    const wrongPlayer = room.players[params.playerId];
    if (wrongPlayer) wrongPlayer.combo = 0; // 同步镜像

    // 「等待对手」这条规则的前提是**对手还没答**。等双方都答完且都错时，
    // 每人一题只有一次机会，剩下的读秒不可能再改变任何结果 —— 空等只是空等，
    // 所以立即结算。判据与「掉线仍照等」的裁定见 docs/PRD.md §5.2。
    if (allPlayersAnswered(room)) settleRound(room, null, now, false);

    broadcastState(room);
    return { ok: true, correct: false, winnerSlot: null };
  }

  // 抢先答对 → 锁定本回合
  room.lockedWinnerId = params.playerId;
  broadcastEvent(room, {
    type: "round_locked",
    roundIndex: room.roundIndex,
    winnerSlot: slot,
  });
  settleRound(room, params.playerId, now, false);
  broadcastState(room);

  return { ok: true, correct: true, winnerSlot: slot };
}

/** 再来一局：重置房间并重新开局（沿用双方准备状态）。 */
export function rematch(code: string, playerId: string): RoomSnapshot {
  const room = getRoom(code);
  if (!room) throw new RoomError("房间不存在或已结束", 404, "room_not_found");
  if (room.hostId !== playerId) {
    throw new RoomError("只有房主可以发起再来一局", 403, "not_host");
  }
  if (room.status !== "finished") {
    throw new RoomError("对局尚未结束", 409, "not_finished");
  }
  clearPhaseTimer(code);
  room.status = "lobby";
  room.questions = [];
  room.roundIndex = 0;
  room.nextAt = null;
  room.startedAt = null;
  room.deadlineAt = null;
  room.answered = {};
  room.lockedWinnerId = null;
  room.history = [];
  room.reason = undefined;
  for (const p of Object.values(room.players)) {
    room.scores[p.id] = 0;
    room.combos[p.id] = 0;
    room.maxCombos[p.id] = 0;
    room.firstCorrect[p.id] = 0;
    room.lastWinDomain[p.id] = null;
    p.score = 0; // 同步镜像
    p.combo = 0;
    p.maxCombo = 0;
    p.firstCorrect = 0;
    p.ready = false;
  }
  room.lastActivity = Date.now();
  broadcastState(room);
  return snapshotOf(room);
}

/** 对局结局（供 UI 展示胜者）。 */
export function duelWinner(code: string): Slot | null {
  const room = getRoom(code);
  if (!room) return null;
  const firstCorrect: Record<string, number> = {};
  for (const p of Object.values(room.players)) {
    firstCorrect[p.id] = room.firstCorrect[p.id] ?? 0;
  }
  const winner = decideWinner(room.scores, firstCorrect);
  if (!winner) return null;
  return slotOf(room, winner);
}

/** 房间是否过期。 */
function isExpired(room: RoomStateInternal): boolean {
  const now = Date.now();
  if (room.status === "finished") {
    return now - room.lastActivity > ROOM_LIMITS.TTL_AFTER_END;
  }
  return now - room.lastActivity > ROOM_LIMITS.TTL_IDLE;
}

/** 清理过期房间（由房间清扫定期调用）。 */
export function sweepExpiredRooms(): number {
  const map = rooms();
  const now = Date.now();
  let removed = 0;
  for (const [code, room] of map) {
    if (now - room.lastActivity > ROOM_LIMITS.TTL_IDLE) {
      clearPhaseTimer(code);
      map.delete(code);
      removed++;
    }
  }
  return removed;
}

/** 仅测试用：清空全部房间与定时器。 */
export function __resetRoomsForTest(): void {
  for (const code of Array.from(rooms().keys())) clearPhaseTimer(code);
  rooms().clear();
  timers().clear();
}
