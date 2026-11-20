<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Quy trình phân công và xác minh đa agent

### Phân công worker

- Master agent phân công task cho các worker theo năng lực và tải máy hiện tại.
- Nhóm worker gồm: `SWE-2 MAX` (số lượng tùy hiệu năng máy), `Deepseek v4.1 flash max`, và `GLM 5.3 flash max`.
- Mỗi worker phải ghi rõ phạm vi thay đổi, giả định, cách kiểm thử và kết quả bàn giao.

### Xác minh vòng 1

- Reviewer vòng 1 là `Claude Sonnet 5.5 xhigh` hoặc `Codex GPT 6.1 Sol xhigh`.
- Vòng 1 đánh giá mã và chức năng do worker xây dựng: yêu cầu, tính đúng đắn, hồi quy, bảo mật, hiệu năng và kiểm thử.
- Chỉ khi vòng 1 đạt thì task mới được chuyển sang vòng 2. Nếu chưa đạt, worker phải sửa theo phản hồi và gửi lại để đánh giá.

### Xác minh vòng 2

- Reviewer vòng 2 là `Claude Opus 5.5` hoặc `Fable 5.2 xhigh`.
- Vòng 2 phản biện kết quả đã qua vòng 1, so sánh các phương án và chọn phương án tối ưu phù hợp với phạm vi task.
- Kết luận vòng 2 phải nêu rõ vấn đề còn lại, lý do chọn phương án và các kiểm thử đã chạy.

### Quy tắc bế tắc

- Không bỏ qua thứ tự vòng 1 → vòng 2 và không coi việc agent tự đánh giá là một lần duyệt độc lập.
- Nếu cùng một task không đạt sau 3 lần duyệt/sửa, quyết định cuối cùng thuộc về người dùng hoặc master agent.
- Khi có bất đồng giữa các reviewer, master agent tổng hợp bằng chứng và đưa ra quyết định trong phạm vi ủy quyền; nếu vượt phạm vi, chuyển cho người dùng.
