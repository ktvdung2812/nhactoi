import { useLocalSearchParams, router, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { HingeSafe } from "../../ui/frames";
import { TaskDetail } from "../../features/TaskDetail";
import { useSession } from "../../core/session";
import { Loading, colors } from "../../ui/kit";
export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <HingeSafe>
        <TaskDetail
          key={session.workspace.id + "/" + id}
          id={id}
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
        />
      </HingeSafe>
    </SafeAreaView>
  );
}
