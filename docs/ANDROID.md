# Android Nhắc tôi

Ứng dụng React Native/Expo nằm trong `mobile/`. Backend dùng chung với web; dữ liệu và quyền vẫn do API quyết định. Không dùng dữ liệu thật cho kiểm thử tự động.

## Chạy local

```sh
cd mobile
npm ci
cp .env.example .env.local
```

API thường chạy ở cổng 3100. Với thiết bị USB hoặc emulator, chạy `adb reverse tcp:3100 tcp:3100`. Cần Android SDK và JDK 17; script tự tìm JDK 17 trên macOS hoặc dùng `JAVA_HOME` đã đặt. JDK 25 đi kèm một số bản Android Studio gây lỗi ở bước CMake của SQLCipher. Để build APK local: `npm run build:android`. APK sinh tại `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Khi chỉ thử thiết bị ARM64, thêm `-- -PreactNativeArchitectures=arm64-v8a` để giảm thời gian build.

Đây là APK phát triển ARM64, cần Metro và API local; chưa phải bản độc lập để phát hành. Bản đã kiểm thử được lưu tại `mobile/artifacts/nhactoi-android-dev-arm64.apk` (thư mục artifact không đưa vào Git).

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3100 tcp:3100
npx expo start --dev-client --localhost
```

Mở Nhắc tôi và chọn development server. Khi có nhiều emulator, thêm `-s <serial>` sau `adb`. Expo Go không hỗ trợ SQLCipher/module cửa sổ native của app.

Kiểm thử bằng DB riêng: từ thư mục gốc chạy `node mobile/scripts/test-api.mjs`. Đặt `EXPO_PUBLIC_API_URL=http://127.0.0.1:3101`, chạy `adb reverse tcp:3101 tcp:3101`, khởi động Metro với biến môi trường này. Tài khoản `demo@nhactoi.local` / `NhacToi2026!` chỉ được tạo trong DB tạm của tiến trình kiểm thử.

## Kết nối máy chủ đã triển khai

Trong `mobile/.env.local`, đặt origin của máy chủ (không thêm `/api`):

```dotenv
EXPO_PUBLIC_API_URL=https://nhactoi.ktvdung.io.vn
```

Chạy Metro từ `mobile/` bằng `npx expo start --dev-client --localhost`, rồi
reload toàn bộ ứng dụng. APK phát triển vẫn cần Metro và `adb reverse
tcp:8081 tcp:8081`; API HTTPS đi trực tiếp tới máy chủ, không cần reverse cổng
3100/3101. Nếu Metro đang được chạy với biến `EXPO_PUBLIC_API_URL` truyền từ
shell, dừng rồi chạy lại để tránh biến cũ ghi đè file `.env.local`.

Nếu Metro chỉ lắng nghe `[::1]:8081` trên macOS và emulator không tải được bundle,
chạy CLI với IPv4 trước: `node --dns-result-order=ipv4first
node_modules/expo/bin/cli start --dev-client --localhost --port 8081`.

Dùng tài khoản đã đăng ký tại `https://nhactoi.ktvdung.io.vn`; tài khoản demo
local không có trên máy chủ này. Đây là database production dùng chung với web,
chỉ tạo dữ liệu thử trong workspace dành riêng cho kiểm thử. File `.env.local`
không đưa vào Git. Xem [cách Expo nạp biến môi trường](https://docs.expo.dev/guides/environment-variables/).

Đã xác minh ngày 22/09/2026 trên `NhactoiPhoneApi36`: module API trong tiến trình
Android nhận đúng origin HTTPS trên; gọi `/api/auth/google/config` thành công,
`/api/me` không có token và `/api/mobile/auth/login` với thông tin rỗng trả 401
đúng dự kiến. TypeScript và lint đạt. Chưa kiểm tra đăng nhập thành công bằng
tài khoản máy chủ; không tạo tài khoản hay dữ liệu mẫu trên production.

## Bản cài thử độc lập trên điện thoại

APK `mobile/artifacts/nhactoi-android-test-arm64.apk` đóng gói sẵn JavaScript,
trỏ tới `https://nhactoi.ktvdung.io.vn` và không cần Metro hoặc cáp USB để chạy.
Bản này được tạo bằng `assembleRelease -PreactNativeArchitectures=arm64-v8a`
từ native project đã generate, với `EXPO_PUBLIC_API_URL` truyền khi build.
Package vẫn là `com.nhactoi.app.dev`, phiên bản `0.1.0`, ký bằng debug key
hiện có để cài thử nội bộ; chưa phải bản ký phát hành Google Play.

Ngày 22/09/2026 đã kiểm tra chữ ký APK, bundle và endpoint; cài thành công qua
USB lên Pixel 7 (Android API 37). Android báo khởi động thành công, activity ở
foreground và không ghi lỗi React Native/AndroidRuntime trong lượt kiểm tra.
Chưa kiểm tra đăng nhập bằng tài khoản thật trên điện thoại.

Thông báo 401 khi đăng nhập được tách khỏi 401 của phiên đã đăng nhập:
email/mật khẩu sai hiện “Email hoặc mật khẩu chưa đúng.”, còn token hết hạn
vẫn hiện “Phiên đăng nhập đã hết hạn.” Ba kiểm thử hồi quy bao phủ hai trường
hợp này và lỗi máy chủ khi đăng nhập.

Màn hình đăng nhập và các biểu mẫu dùng `KeyboardAvoidingView` với `padding`
trên Android, đặt ngoài vùng đo kích thước tránh bản lề. Khi bàn phím mở,
vùng cuộn được thu nhỏ theo phần màn hình còn lại. Bản APK đã cài lên Pixel 7
ngày 22/09/2026: ô mật khẩu và nút đăng nhập hiện phía trên Gboard; nhập thử,
đóng/mở lại bàn phím và xoay ngang rồi về dọc đều giữ nội dung và bố cục.
Ở chế độ ngang, Gboard dùng giao diện nhập toàn màn hình của hệ thống.

## Phạm vi

- Tài khoản có sẵn, chuyển doanh nghiệp, phiên riêng với web.
- Công việc, người phụ trách/team, trạng thái/cột, lịch lặp và lời nhắc.
- Checklist, bình luận/nhắc tên/phản ứng, tệp và liên kết, lịch sử.
- Công việc và lịch hẹn trên cùng một bảng, hộp thư thông báo.
- Bản lưu chỉ đọc, mã hóa SQLCipher, tối đa 24 giờ sau lần xác minh quyền; hết hạn phiên thì đăng nhập lại. Đăng xuất xóa cache.

Đăng ký/Google login, thanh toán, quản trị doanh nghiệp và SaaS chưa có giao diện mobile. Các quy tắc hạn thuê bao, team lưu trữ và quyền API vẫn áp dụng.

## Push

Bản local không có Firebase vẫn chạy các nghiệp vụ và hộp thư thông báo. Push thật cần Android app trên Firebase khớp package (`com.nhactoi.app.dev` cho local) và Google Play services trên thiết bị. Đặt `GOOGLE_SERVICES_JSON` tới file cấu hình Android rồi build lại. Thông tin xác thực gửi FCM chỉ đặt ở backend, không đóng gói vào APK. Máy chủ phải chạy liên tục để xử lý lịch đúng thời điểm.

Backend nhận `FCM_SERVICE_ACCOUNT_JSON` là nội dung JSON từ secret store, hoặc bộ `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`. Không đặt những giá trị này vào biến `EXPO_PUBLIC_*`. Thiếu cấu hình thì worker không gửi FCM; thông báo trong ứng dụng vẫn được lưu. Chưa kiểm thử giao nhận push thật vì chưa có cấu hình Firebase.

Không hứa push đúng từng giây: Android có thể trì hoãn; Force stop khác với đóng màn hình/đưa app về nền. Hộp thư trên server là nguồn đối chiếu. Payload màn hình khóa dùng nội dung chung, mở đối tượng luôn xác minh lại quyền.

## Kiểm tra trước phát hành

```sh
cd mobile
npm run typecheck
npm run lint
npm test
```

Chạy bộ backend ở thư mục gốc bằng `npm test`. Dùng điện thoại và thiết bị gập để kiểm tra đăng nhập → tạo việc → checklist/bình luận → lịch → mất mạng → nối mạng → đổi doanh nghiệp → đăng xuất. Kiểm tra lúc gập/mở, xoay, chia đôi màn hình, tăng cỡ chữ và bật bàn phím; không mất lựa chọn hoặc nội dung đang nhập do thay đổi kích thước.

Bản phát hành sau local cần `NHACTOI_RELEASE=1`, API HTTPS công khai, package `com.nhactoi.app`, khóa ký và cấu hình Firebase tương ứng. Chuẩn bị AAB, chính sách riêng tư/Data safety và tài khoản xét duyệt trước thử nội bộ/Google Play. Không đưa checkout BillGateway vào app.

## Kết quả kiểm thử local ngày 22/09/2026

- Backend: 78/78; mobile: 14 kiểm thử logic và 11 kiểm thử component. TypeScript, lint, Expo Doctor và build web đạt.
- APK debug ARM64 build bằng JDK 17; cài và chạy trên emulator điện thoại API 36 và Pixel 10 Pro Fold API 36.
- Đã thao tác từ giao diện: đăng nhập, tạo công việc, checklist/mục, bình luận, tải tệp lên, tải xuống/mở hộp chia sẻ, tạo lịch hẹn; đối chiếu dữ liệu qua API.
- Đã kiểm tra nháp khi xoay màn hình, chuyển chi tiết hai cột/một cột khi gập, bản lề dọc/ngang ở HALF_OPENED, biểu mẫu không cắt qua bản lề và cỡ chữ 130%.
- Chia đôi màn hình Android cùng ứng dụng Settings: thanh điều hướng nằm trong cửa sổ ứng dụng và danh sách tiếp tục cuộn trong phần màn hình được cấp.
- Tắt kết nối API, khởi động lại app: đọc cache và khóa thao tác ghi. Cache thiết bị không có header SQLite thường và không đọc được khi thiếu khóa SQLCipher. Tệp tải xuống được xóa sau khi đóng hộp chia sẻ.
- Đăng xuất khi ngoại tuyến trở về màn hình đăng nhập.
- Ảnh và log hình học đã kiểm tra nằm tại `mobile/artifacts/qa/`. Chưa kiểm thử thiết bị vật lý, iOS hay phát hành Google Play.

AVD Pixel Fold phải dùng skin đúng để WindowManager trả về bản lề. Với SDK local, chọn `pixel_10_pro_fold` dưới `emulator/resources/skins/android-36/userdebug`. Nếu sensor báo 90° nhưng `foldingFeatures` rỗng, kiểm tra hai overlay `com.android.internal.emulation.pixel_10_pro_fold` và `com.android.systemui.emulation.pixel_10_pro_fold` đã bật; khởi động lại ứng dụng sau khi sửa cấu hình AVD. Chỉ thay kích thước màn hình không đủ để kiểm chứng bản lề.
