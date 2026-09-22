import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
function Navigation() {
  const { session, loading } = useSession();
  if (loading) return <Loading />;
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="task/new" />
        <Stack.Screen name="task/edit" />
        <Stack.Screen name="event/[id]" />
        <Stack.Screen name="event/new" />
      </Stack.Protected>
    </Stack>
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
      <StatusBar style="dark" />
      {!ready && !error ? (
        <Loading />
      ) : (
        <Providers>
          <Navigation />
        </Providers>
      )}
    </SafeAreaProvider>
  );
}
