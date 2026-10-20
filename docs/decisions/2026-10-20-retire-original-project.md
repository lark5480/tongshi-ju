---
status: archived
archived_at: 2026-10-20
supersedes: docs/decisions/2026-10-20-product-decisions.md（仅「决策 1」中「旧目录保留不动」一条）
decision_type: project-retirement
---

# 决策归档：旧项目 `math-physics-quest` 正式退役并删除

> **这是一份决策快照，不回改。**
> 它**只推翻** [`2026-10-20-product-decisions.md`](2026-10-20-product-decisions.md) 里「决策 1」中的
> 「旧目录 `math-physics-quest` 保留不动」一条，其余三项决策（12 域 / 同步抢答 / 双轨）**继续有效**。

**日期**：2026-10-20
**动作**：将 `F:/other/code/ai/math-physics-quest` 移入 Windows 回收站（可恢复），项目正式退役。

---

## 1. 为什么原决策是「保留不动」，现在却要删

立项时的「保留不动」是**零成本回退**的保险：新项目从零另起一个目录，
万一方向不成立，旧目录还能留着当参照。当时的判断是「删不删都行，先留着」。

现在删除，是因为**前提变了**：

- 《通识局》已全量交付并通过验收（171 测试全绿、typecheck / lint / format / build / validate:content 全绿）；
- 旧目录里**从来没有过实现代码**——它一直是个空骨架，不存在「回退到旧版本」这回事。

## 2. 删除前的清点（结论：零信息损失）

旧目录总计 **3.6 KB**，无 `.git`、无 `node_modules`，全量内容如下：

| 路径 | 大小 | 处置 |
|---|---|---|
| `docs/PRD.md` | 3092 B | **唯一有实质内容的文件** → 已逐字节归档到 [`2026-10-20-original-prd.md`](2026-10-20-original-prd.md)，比对结果**完全一致** |
| `package.json` | 592 B | 单行反斜杠转义文本，**不是合法 JSON**（`{ name\: \math-physics-quest\, ...`），本身已损坏；依赖信息（`chess-js` 等）无意义，已由新项目的 `package.json` 取代 |
| `css/` `js/` `public/` `server/` | 0 B | **4 个空目录**，条目数均为 0 |

> 清点方法说明：最初用 `Get-ChildItem -Recurse -File` 扫目录时只看到 2 个文件，
> 补上 `-Force` 与目录项后才暴露出那 4 个空目录 —— 删目录前**必须**连隐藏项与空目录一起清点，
> 否则容易漏判「这个项目到底有没有代码」。

## 3. 归档去向

删除后，旧项目在《通识局》仓库内仍留有完整追溯：

| 内容 | 归档位置 |
|---|---|
| 原始 PRD 全文 | `docs/decisions/2026-10-20-original-prd.md`（逐字节一致） |
| 立项时的四项决策 | `docs/decisions/2026-10-20-product-decisions.md` |
| 本次退役决策 | 本文件 |

## 4. 恢复方式

删除走的是 Windows **回收站**（`Microsoft.VisualBasic.FileIO.FileSystem` + `SendToRecycleBin`），
不是永久删除 —— 误删可从回收站还原。

## 5. 未随本次删除发生的事

- `F:/other/code/ai/` 下的其余项目（`chess-arena`、`gomoku-game`、`mini-game-hub` 等）**一律未动**；
- `F:/other/code/ai/tongshi-ju` **未受影响**（删除后复核：105 个文件、4 份 docs 齐全）；
- `F:/other/code/ai/math-physics-quest/docs/PRD.md` 的内容**已先归档再删**，顺序不可颠倒。
