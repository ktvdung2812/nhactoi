import type { ExpoConfig } from "expo/config";
const release = process.env.NHACTOI_RELEASE === "1";
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const config: ExpoConfig = {
  name: "Nhắc tôi",
  slug: "nhactoi",
  version: "0.1.0",
  scheme: "nhactoi",
  orientation: "default",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  android: {
    package: release ? "com.nhactoi.app" : "com.nhactoi.app.dev",
    versionCode: 1,
    allowBackup: false,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundColor: "#176b59",
    },
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.RECORD_AUDIO",
    ],
    predictiveBackGestureEnabled: true,
  },
  ios: { supportsTablet: true, bundleIdentifier: "com.nhactoi.app" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-sqlite", { useSQLCipher: true }],
    ["expo-notifications", { defaultChannel: "reminders" }],
    "expo-document-picker",
    "expo-sharing",
    "expo-font",
    ["expo-build-properties", { android: { usesCleartextTraffic: !release } }],
  ],
  extra: { pushConfigured: !!googleServicesFile },
  experiments: { typedRoutes: true },
};
export default config;
