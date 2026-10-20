/**
 * 测试用假时钟。
 *
 * 服务端权威计时的测试需要精确控制「现在」，
 * 否则无法稳定复现「超时提交」「回合推进」等边界。
 *
 * ⚠️ 只在测试中安装；`afterEach` 必须调用 `uninstallFakeTime()` 复原。
 */

let current = 0;
const realNow = Date.now;
let installed = false;

/** 安装假时钟。 */
export function installFakeTime(start = realNow()): void {
  current = start;
  Date.now = () => current;
  installed = true;
}

/** 复原真实时钟。 */
export function uninstallFakeTime(): void {
  if (installed) {
    Date.now = realNow;
    installed = false;
  }
}

/** 向前推进时间。 */
export function advance(ms: number): void {
  current += ms;
}

/** 当前假时间。 */
export function now(): number {
  return current;
}
