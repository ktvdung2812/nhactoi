import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "../src/styles.css";
// Keep the legacy entrypoint's cascade order: design-system.css was imported
// after the application stylesheet from src/main.jsx.
import "../src/design-system.css";
import "../src/feature-kit.css";
import { headers } from "next/headers";
import ClientApp from "./client-app.jsx";

export const metadata = {
  title: "Nhắc tôi · Công việc nhẹ nhàng hơn",
  description:
    "Nhắc tôi — Quản lý công việc, lịch nhắc và thu chi cho đội ngũ dịch vụ.",
  applicationName: "Nhắc tôi",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Nhắc tôi", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
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

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('nhactoi_theme') || 'system';
    var isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }) {
  // proxy.js allows only scripts carrying this request's nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ClientApp>{children}</ClientApp>
      </body>
    </html>
  );
}
