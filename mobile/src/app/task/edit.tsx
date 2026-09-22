import { useSession } from "../../core/session";
import { useLocalSearchParams } from "expo-router";
import { TaskForm } from "../../features/TaskForm";
export default function Screen() {
  const { scope } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaskForm key={scope} id={id} />;
}
