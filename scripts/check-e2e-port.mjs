import { connect } from "node:net";

const port = Number(process.argv[2]);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[e2e] 无效端口：${process.argv[2] ?? "(未提供)"}`);
  process.exit(2);
}

/**
 * 用「能否连上」判断端口是否被占用。
 *
 * 不用 bind 探测：Windows 允许在已有通配地址监听时再绑 127.0.0.1 / ::1，
 * 会把一个正在服务的旧 dev server 误判成空闲。连接探测在 Windows / Linux 上一致。
 *
 * 连不上（ECONNREFUSED 等）视为空闲；超时按占用处理（宁可报错，也不撞上挂死的旧服务）。
 */
function probe(host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const finish = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const busy = (await probe("127.0.0.1")) || (await probe("::1"));

if (!busy) {
  process.exit(0);
}

console.error(`[e2e] 端口 ${port} 已被占用，且 e2e 不再复用已有服务。`);
console.error("[e2e] 复用残留的 dev server 会让用例跑在旧构建上，表现为首轮超时。");
console.error("[e2e] 处理：结束占用进程后重跑，或用 E2E_PORT=<空闲端口> npm run test:e2e。");
console.error(
  `[e2e] Windows: Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object OwningProcess`
);
console.error(`[e2e] macOS/Linux: lsof -i :${port}`);
process.exit(1);
