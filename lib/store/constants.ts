/**
 * 房间相关常量与限额 —— 集中一处，避免散落的 magic number。
 */

/** 房间生命周期与容量限额。 */
export const ROOM_LIMITS = {
  /** 房间码长度。 */
  CODE_LENGTH: 6,
  /** 进程内房间数上限。 */
  MAX_ROOMS: 500,
  /** 每房最大玩家数（1v1）。 */
  MAX_PLAYERS: 2,
  /** 对局结束后房间保留时长（毫秒）。 */
  TTL_AFTER_END: 30 * 60 * 1000,
  /** 无活动房间清理阈值（毫秒）。 */
  TTL_IDLE: 3 * 60 * 60 * 1000,
} as const;

/** SSE 连接配额。 */
export const STREAM_LIMITS = {
  /** 单房间最大并发连接数。 */
  MAX_SUBSCRIBERS_PER_ROOM: 12,
  /** 全局最大并发连接数。 */
  MAX_TOTAL_SUBSCRIBERS: 300,
  /**
   * 超过此时长的订阅必为平台掐断后残留的僵尸。
   * 取「函数最大执行时长 + 余量」：EdgeOne Node Functions 上限 120s，
   * 正常连接会在 STREAM_MAX_AGE_MS 时被服务端主动关闭。
   */
  STALE_SUBSCRIBER_MS: 130_000,
  /**
   * 单条 SSE 连接的服务端存活上限（主动轮换）。
   * 配套 `edgeone.json` 的 nodeFunctionsConfig.maxDuration = 120。
   */
  STREAM_MAX_AGE_MS: 100_000,
  /** 心跳间隔：保活中间代理，同时在写失败时兜底清理。 */
  PING_INTERVAL_MS: 25_000,
} as const;

/** 各写接口的限流（次 / 分钟 / IP）。 */
export const RATE_LIMITS = {
  createRoom: 10,
  joinRoom: 10,
  ready: 30,
  startRoom: 20,
  submitAnswer: 60,
  rematch: 20,
  aiGenerate: 5,
} as const;
