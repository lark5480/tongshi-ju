/**
 * 通识局 —— 全局共享类型。
 *
 * ## 分层：内部态 vs 对外态
 *
 * - `Question` 是**完整题目**（含答案与解析），只存在于题库文件与服务端内存；
 * - `QuestionMeta` 是**对外可见的题目元数据**（不含答案/解析）；
 * - `RoomState` 是**服务端内部态**，以 `playerId`（凭证）为 key；
 * - `RoomSnapshot` / `RoundRecord` 是**对外态**，一律以 `slot`（0=房主 / 1=访客）为 key。
 *
 * ## 为什么对外态必须用 slot 而不是 playerId
 *
 * `playerId` 是所有写操作的唯一凭证。一旦它出现在快照或广播事件里，
 * 任何订阅者（含第三方观战者）都能冒充该玩家提交答案、认输、发起再来一局。
 * 因此：**对外数据里一律不出现 playerId**，只出现座位号。
 */

/** 12 个知识领域。ASCII kebab-case，作为题库文件名与存储 key 的唯一依据。 */
export type DomainId =
  | "gaming"
  | "anime"
  | "auto"
  | "tech"
  | "mobile"
  | "life"
  | "coding"
  | "history"
  | "film"
  | "science"
  | "literature"
  | "travel";

/** P0 只做三种题型；`blank` 列入 P1（文本判定有歧义，会破坏抢答 duel 的即时性）。 */
export type QuestionType = "single" | "multi" | "judge";

export type Difficulty = 1 | 2 | 3;

export type QuestionOrigin = "seed" | "ai";

/** 完整题目（服务端 / 题库文件内部使用）。 */
export interface Question {
  /** 稳定唯一 id，如 `gaming-0007`。 */
  id: string;
  domain: DomainId;
  /** 子知识点，必须命中所属域的 topic 白名单。 */
  topic: string;
  difficulty: Difficulty;
  type: QuestionType;
  stem: string;
  /** 选项文本。judge 固定为 `["正确", "错误"]`。 */
  options: string[];
  /**
   * 答案。single/judge 为单个选项文本；multi 为选项文本数组（入库时已按字典序排序去重）。
   * 使用**选项文本**而非 A/B/C/D 字母：客户端可能对选项排序，字母会失效。
   */
  answer: string | string[];
  /** 解析。必填，是产品的「知识密度」来源。 */
  explanation: string;
  /** 可选溯源。 */
  source?: { title: string; url?: string };
  origin: QuestionOrigin;
  /** 变体题指向原题 id。 */
  variantOf?: string;
  /** AI 生成批次 id。 */
  batchId?: string;
  /** 归一化题干指纹，用于去重。 */
  fingerprint: string;
}

/** 对外可见的题目元数据 —— **不含答案与解析**。 */
export interface QuestionMeta {
  id: string;
  domain: DomainId;
  topic: string;
  difficulty: Difficulty;
  type: QuestionType;
  stem: string;
  options: string[];
}

/** 领域元数据。 */
export interface DomainMeta {
  id: DomainId;
  name: string;
  color: string;
  emoji: string;
  /** 子知识点白名单。 */
  topics: string[];
  /** 上线批次：1 = 首发，2 = 第二批，3 = 第三批。 */
  batch: 1 | 2 | 3;
  /** 当前是否已上线（有题）。 */
  enabled: boolean;
}

/** 房间内的席位号。0 = 房主，1 = 访客。 */
export type Slot = 0 | 1;

/**
 * 玩家在房间内的公开信息（已脱敏，不含 playerId）。
 *
 * `slot` 是玩家在房间中的固定席位。客户端据此识别「我是谁」「我是不是房主」——
 * **不需要**把 playerId（凭证）暴露给任何其他客户端。
 */
export interface PublicPlayer {
  slot: Slot;
  name: string;
  emoji: string;
  ready: boolean;
  connected: boolean;
  /**
   * 本人当前得分。
   *
   * 与 `RoomSnapshot.scores[slot]` **始终一致** —— 快照构建时从真相派生，
   * 不读可能滞后的内部镜像字段。
   */
  score: number;
  /** 当前连击。同上，与 `combos[slot]` 一致。 */
  combo: number;
  /** 抢先答对的题数（平分时的次级判据）。同上，与 `firstCorrect[slot]` 一致。 */
  firstCorrect: number;
}

/** 服务端内部态：以 playerId 为 key。 */
export interface RoomPlayer extends PublicPlayer {
  /** 凭证。**只在创建/加入的私有响应中下发给本人**，快照与广播中必须脱敏。 */
  id: string;
}

/** 单回合结算记录 —— **对外态**，以 slot 为 key。 */
export interface RoundRecord {
  roundIndex: number;
  domain: DomainId;
  topic: string;
  questionId: string;
  correctAnswer: string | string[];
  explanation: string;
  /** 赢下本回合的席位；null 表示本回合无人答对。 */
  winnerSlot: Slot | null;
  /** 各席位作答用时（毫秒）；未作答为 null。key 为 slot 的字符串形式。 */
  elapsed: Record<string, number | null>;
  /** 各席位本回合得分。key 为 slot 的字符串形式。 */
  points: Record<string, number>;
  /** 是否发生「近乎同时提交」，用于结算文案标注。 */
  tie: boolean;
}

export type RoomStatus = "lobby" | "countdown" | "question" | "feedback" | "finished";

/** 服务端内部房间状态。 */
export interface RoomState {
  code: string;
  hostId: string;
  /** playerId -> 玩家。 */
  players: Record<string, RoomPlayer>;
  status: RoomStatus;
  /** 决定题目序列的种子。 */
  seed: number;
  /** 房主的领域集合（开局后广播给双方）。 */
  domains: DomainId[];
  /** 题目元数据序列 —— **只存元数据，答案与解析不在这里**。 */
  questions: QuestionMeta[];
  roundIndex: number;
  /** 当前题开始的服务端时间戳（权威）。 */
  startedAt: number | null;
  /** 当前题截止的服务端时间戳（权威）。 */
  deadlineAt: number | null;
  /** 限时（毫秒），由难度决定。 */
  limitMs: number;
  /** 各玩家本回合的作答记录（内部态，playerId 为 key）。 */
  answered: Record<string, { answer: string | string[]; at: number; correct: boolean }>;
  /** 本回合已锁定的赢家；null 表示尚未锁定。 */
  lockedWinnerId: string | null;
  /** 本阶段结束的时刻（countdown / feedback 阶段用）。 */
  nextAt: number | null;
  /** 内部态：playerId -> 总分。 */
  scores: Record<string, number>;
  /** 内部态：playerId -> 当前连击。 */
  combos: Record<string, number>;
  /** 内部态：playerId -> 抢先答对的次数。 */
  firstCorrect: Record<string, number>;
  /** 内部态：playerId -> 上次抢先答对的领域（跨域连击判定）。 */
  lastWinDomain: Record<string, DomainId | null>;
  history: RoundRecord[];
  createdAt: number;
  lastActivity: number;
  /** 结束原因。 */
  reason?: string;
}

/** 对外快照 —— 玩家 id 一律脱敏，凭证绝不出现。 */
export interface RoomSnapshot {
  code: string;
  /** 房主所在席位。`players[hostSlot]` 即房主。 */
  hostSlot: Slot;
  status: RoomStatus;
  domains: DomainId[];
  roundIndex: number;
  questions: QuestionMeta[];
  startedAt: number | null;
  deadlineAt: number | null;
  limitMs: number;
  nextAt: number | null;
  /** 本回合已锁定的赢家席位。 */
  lockedWinnerSlot: Slot | null;
  /** 各席位总分。key 为 slot 的字符串形式。 */
  scores: Record<string, number>;
  /** 各席位当前连击。key 为 slot 的字符串形式。 */
  combos: Record<string, number>;
  /** 席位顺序固定为 [房主, 访客]。 */
  players: PublicPlayer[];
  history: RoundRecord[];
  /** 服务端当前时间，供客户端校准时钟偏移。 */
  serverNow: number;
  /** 共几题。 */
  totalRounds: number;
  /** 结束原因。 */
  reason?: string;
}

/** 创建/加入房间时**私有**下发给本人的信息（含凭证）。 */
export interface RoomCredential {
  code: string;
  /** 凭证。绝不出现在快照与广播中。 */
  playerId: string;
  /** 本人在房间中的席位。 */
  slot: Slot;
  /** 是否为房主。 */
  isHost: boolean;
}

/** SSE 事件联合类型 —— 全部为对外态，不含 playerId。 */
export type RoomEvent =
  | { type: "state"; room: RoomSnapshot }
  | { type: "player_answered"; roundIndex: number; playerSlot: Slot }
  | { type: "round_locked"; roundIndex: number; winnerSlot: Slot }
  | { type: "round_result"; record: RoundRecord; scores: Record<string, number> }
  | {
      type: "round_start";
      roundIndex: number;
      question: QuestionMeta;
      startedAt: number;
      deadlineAt: number;
    }
  | { type: "countdown"; roundIndex: number; nextAt: number }
  | { type: "duel_end"; scores: Record<string, number>; reason: string };

/** 客户端本地档案。 */
export interface Profile {
  name: string;
  emoji: string;
  /**
   * 选定的领域（1-3 个）。
   *
   * 在「盲盒轮转」模式下只有第 1 个是**本命**，其余由日期种子每日轮换
   * （见 `lib/engine/blindbox.ts`）。
   */
  domains: DomainId[];
  /** 是否已用过「随缘开局」的免费重抽。 */
  usedReroll: boolean;
  /** 是否开启「盲盒轮转」：1 个本命 + 2 个每日盲盒。 */
  blindbox: boolean;
}

/** `(domain, topic) -> 熟练度`。 */
export type MasteryMap = Record<string, number>;

/** 错题队列条目。 */
export interface WrongEntry {
  questionId: string;
  domain: DomainId;
  topic: string;
  /** 连续答对次数，达到 2 即毕业。 */
  streak: number;
  /** 累计答错次数。 */
  wrongCount: number;
  lastWrongAt: number;
  /** SM-2 简化版的难度因子。 */
  ease: number;
  /** 下次应复习的时间戳。 */
  nextDueAt: number;
}

/** 单场历史记录。 */
export interface HistoryEntry {
  date: string;
  domains: DomainId[];
  score: number;
  correct: number;
  total: number;
  stars: number;
  maxCombo: number;
  mode: "daily" | "duel";
  /** duel 专用：对局房间码。 */
  roomCode?: string;
}

/** 每日挑战的锁定结果。 */
export interface DailySession {
  date: string;
  domains: DomainId[];
  /** 题目 id 序列（锁定，当天不因改领域而重算）。 */
  questionIds: string[];
  done: boolean;
  score?: number;
  correct?: number;
  stars?: number;
  maxCombo?: number;
  /** 本局使用的领域模式（native / blindbox / random）。 */
  mode?: "native" | "blindbox" | "random";
}
