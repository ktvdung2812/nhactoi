import { useLocalSearchParams, router, Redirect } from "expo-router";
import Home from "../index";
import { useSession } from "../../core/session";
import { Loading } from "../../ui/kit";
export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading, scope } = useSession();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/" />;
  return <Home key={scope + "/" + id} initialTaskId={id} listenForPush={!router.canGoBack()} onInitialBack={() =>
    router.canGoBack() ? router.back() : router.replace("/")
  } />;
}
