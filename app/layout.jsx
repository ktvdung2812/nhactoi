import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "../src/styles.css";
// Keep the legacy entrypoint's cascade order: design-system.css was imported
// after the application stylesheet from src/main.jsx.
import "../src/design-system.css";
import ClientApp from "./client-app.jsx";

export const metadata = {
  title: "Nhắc tôi · Công việc nhẹ nhàng hơn",
  description:
    "Nhắc tôi — Quản lý công việc, lịch nhắc và thu chi cho đội ngũ dịch vụ.",
  applicationName: "Nhắc tôi",
  openGraph: {
    title: "Nhắc tôi · Công việc nhẹ nhàng hơn",
    description:
      "Quản lý công việc, lịch nhắc và thu chi cho đội ngũ dịch vụ.",
    locale: "vi_VN",
    type: "website",
  },
};

export const viewport = {
  themeColor: "#14685c",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <ClientApp>{children}</ClientApp>
      </body>
    </html>
  );
}
