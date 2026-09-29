import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AssistantMarkdown from "../src/AssistantMarkdown.js";

const render = (content, props = {}) => renderToStaticMarkup(React.createElement(AssistantMarkdown, { content, ...props }));

test("AI replies render GFM tables, emphasis, lists and code inside a scrollable region", () => {
  const html = render(`## Công việc đang làm

Có **2 công việc**, cần ưu tiên:

| # | Tiêu đề | Mức ưu tiên | Hạn |
| --- | --- | --- | --- |
| 1 | Gửi proposal cho Mộc Studio | **Cao** | 22/09/2026, 17:00 |
| 2 | Chăm sóc khách hàng | Trung bình | 24/09/2026, 17:00 |

1. Kiểm tra nội dung.
2. Gửi phản hồi.

- [x] Đã xem
- [ ] Chưa gửi

\`doing\`

\`\`\`json
{"status":"doing"}
\`\`\`
`);
  for (const part of ["<h2>", "<strong>2 công việc</strong>", "<table>", "<thead>", "<tbody>", "<ol>", 'type="checkbox"', "<pre><code", 'role="region"', 'tabindex="0"']) assert.ok(html.includes(part), part);
  assert.ok(!html.includes("**"));
  assert.ok(!html.includes("| ---"));
});

test("AI task table cells and verified task links open task controls with selection", () => {
  const references = [{ id: "task-1", title: "Gửi proposal" }, { id: "task-2", title: "[Demo] Chăm sóc" }];
  const html = render(`| Tiêu đề | Trạng thái |
| --- | --- |
| **Gửi proposal** | Đang làm |
| [Demo] Chăm sóc | Cần làm |
| **[Gửi proposal](/tasks/task-1)** | Đang làm |

[Xem công việc](/tasks/task-1)

[ID không có trong tham chiếu](/tasks/unknown)`, { references, onOpenTask() {}, selectedTaskId: "task-1" });
  assert.equal((html.match(/class="assistant-task-link/g) || []).length, 4);
  assert.ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(html));
  assert.ok(html.includes('class="is-selected-task"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('aria-label="Mở công việc [Demo] Chăm sóc"'));
  assert.ok(html.includes('href="/tasks/unknown"'));
});

test("AI table does not guess task identity from duplicate or partial titles", () => {
  const html = render(`| Tiêu đề |
| --- |
| Trùng tên |
| Gửi proposal |`, { references: [{ id: "1", title: "Trùng tên" }, { id: "2", title: "Trùng tên" }, { id: "3", title: "Gửi proposal khách hàng" }], onOpenTask() {} });
  assert.ok(!html.includes("assistant-task-link"));
});

test("AI Markdown never executes HTML, script URLs or loads remote images", () => {
  const html = render(`<script>alert('unsafe')</script>

<iframe src="https://tracker.example"></iframe>

[Không an toàn](javascript:alert%281%29)

[Dữ liệu](data:text/html,unsafe)

[Website](https://example.com/docs)

![Ảnh minh họa](https://tracker.example/pixel.png)

\`<img src=x onerror=alert(1)>\``);
  assert.ok(!/<(?:script|iframe|img)\b/i.test(html));
  assert.ok(!/href="(?:javascript|data):/i.test(html));
  assert.ok(!html.includes("tracker.example"));
  assert.ok(html.includes('href="https://example.com/docs"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes("Ảnh minh họa"));
  assert.ok(html.includes("&lt;img"));
});
