/**
 * 工具组的摘要行：调用一多，「读取 4 个文件 · 执行 11 条命令 · 调用 1 次 remember」加上
 * 「· 1 个失败 · 1 个被自动审查拦下」就超过一行。折行会把计数劈成两半（真终端里试出来的），
 * 所以摘要文字让位、截断，计数完整留在同一行。
 */

import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { EntryView } from "./EntryView.tsx"
import type { ToolCall } from "../store.ts"

test("摘要太长时截断摘要，失败和被拦的计数完整留在同一行", async () => {
  const columns = 80
  const calls: ToolCall[] = [
    { id: 1, tool: "list_dir", args: "{}", running: false, ok: true },
    { id: 2, tool: "glob", args: '{"pattern":"README*"}', running: false, ok: true },
    ...[3, 4, 5, 6].map((id) => ({ id, tool: "read_file", args: "{}", running: false, ok: true })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: 10 + i, tool: "bash", args: "{}", running: false, ok: true })),
    { id: 30, tool: "bash", args: "{}", running: false, ok: false, denied: true },
    { id: 31, tool: "remember", args: "{}", running: false, ok: false },
  ]
  const { renderOnce, captureCharFrame } = await testRender(
    () => (
      <box flexDirection="column" width={columns}>
        <EntryView entry={{ kind: "tools", key: "t1", calls }} columns={columns} />
      </box>
    ),
    { width: columns, height: 6 },
  )
  await renderOnce()
  const rows = captureCharFrame().split("\n").filter((l) => l.trim())
  expect(rows).toHaveLength(1)
  expect(rows[0]).toContain("▸")
  expect(rows[0]).toContain("1 个失败")
  expect(rows[0]).toContain("1 个被自动审查拦下")
  expect(rows[0]).toContain("…")
})
