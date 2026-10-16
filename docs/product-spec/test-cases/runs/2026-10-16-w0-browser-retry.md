# W0 — Thử lại bằng VC browser ngày 2026-10-16

Kết quả: **BLOCKED** ở công cụ browser. Đây là lần gọi công cụ mới theo yêu cầu thử lại, không tái sử dụng kết luận của lần trước. Không có ca UI nào được xác nhận PASS và không lấy được screenshot.

## Môi trường

- HEAD `894f068ad4ad6288cbe467459fd4e0039c4764c9` cùng working tree chưa commit; manifest triển khai tại `artifacts/spec-implementation-2026-10-16/implementation-manifest.json`.
- Next 16.3.8 production, build ID `pPd54IfUzavpKBss6spWl`; Node 24.21.0; PostgreSQL 17.2 thử riêng.
- URL thử: `http://127.0.0.1:63348/login`; schema độc lập `browser_w0_a819a12e2e17402185f11be0b48bc066`.
- Owner/workspace thử mới; background sender tắt, không gửi provider thật. Không thao tác database ứng dụng.
- `/login` trả HTTP 200, đăng ký owner fixture thành công. Đây là bằng chứng môi trường sẵn sàng, không phải browser E2E.

## Thao tác và kết quả

| Công cụ / thao tác | Quan sát thực tế |
|---|---|
| `preview_status` | `available: true`, `tab_3`, `visible: false`, `loading: false`; URL cũ `http://127.0.0.1:59902/login`, title `Nhắc tôi · Chưa có kết nối` |
| `preview_open` vào URL thử mới, tái sử dụng `tab_3` | `PreviewAutomationTimeoutError` |
| `preview_status` sau lỗi | Tab vẫn ở URL cũ; không có bằng chứng điều hướng thành công |
| `preview_navigate`, `readiness: none`, timeout 15 giây | `PreviewAutomationTimeoutError` |
| `preview_snapshot`, `includeImage: false`, `saveScreenshot: true` | `PreviewAutomationTimeoutError`; không có DOM hoặc artifact ảnh |
| `preview_status` sau snapshot | Vẫn URL cũ, `visible: false`, `loading: false` |
| Browser dự phòng VC: `agent_browser_use`, `action: status` | `This MCP credential is missing the 'browser' capability.` |

Không thực hiện click/type khi chưa có snapshot và không đổi sang browser ngoài để vượt capability bị từ chối. Skill áp dụng: [vc-agent-browser](/Users/ktvdung/.agents/skills/vc-agent-browser/SKILL.md), quy tắc: “An explicit access denial is not permission to switch.”

## Bằng chứng và phạm vi

- Log các lần gọi mới: `artifacts/spec-implementation-2026-10-16/browser-retry/browser-attempts.json`.
- Môi trường: `browser-retry/manifest.json`, `browser-retry/server.log`; credential thử không được đưa vào báo cáo.
- Các ca Web W0-T03, W0-T04 và accessibility/responsive chưa được thao tác thực tế. Catalog tiếp tục `NOT RUN`; lần thực thi này là `BLOCKED` do công cụ.
- Runtime, schema và credential thử được dọn sau lần chạy; cluster PostgreSQL thử riêng được dừng. URL trên là URL tạm đã ngừng phục vụ.

Để chạy tiếp cần khôi phục kết nối preview trong VC. Browser dự phòng còn cần bật **Agent Browser Use** tại **Settings → Integrations**, cho phép browser trong project, rồi mở phiên agent mới để quyền có hiệu lực. HTTP 200 không thay thế bằng chứng UI.
