import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
} from "@expo-google-fonts/be-vietnam-pro";
import { Providers, useSession } from "../core/session";
import { Loading } from "../ui/kit";
import { AppearanceProvider, useAppearanceSettings } from "../core/appearance";
import { ThemeProvider, ThemedStatusBar, useTheme } from "../ui/theme";
function Navigation() {
  const { session, loading } = useSession();
  const { colors, reduceMotion } = useTheme();
  if (loading) return <Loading />;
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? "none" : "fade", contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="task/new" />
        <Stack.Screen name="task/edit" />
        <Stack.Screen name="event/[id]" />
        <Stack.Screen name="event/new" />
        <Stack.Screen name="appearance" />
      </Stack.Protected>
    </Stack>
  );
}
// One shared appearance instance feeds both the root theme and the settings screen.
function ThemedNavigation() {
  const { preferences, cacheLoading } = useAppearanceSettings();
  return (
    <ThemeProvider preferences={preferences}>
      <ThemedStatusBar />
      {cacheLoading ? <Loading /> : <Navigation />}
    </ThemeProvider>
  );
}
export default function Layout() {
  const [ready, error] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });
  return (
    <SafeAreaProvider>
      {!ready && !error ? (
        <Loading />
      ) : (
        <Providers>
          <AppearanceProvider>
            <ThemedNavigation />
          </AppearanceProvider>
        </Providers>
      )}
    </SafeAreaProvider>
  );
}
