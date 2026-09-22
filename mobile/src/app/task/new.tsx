import { useSession } from "../../core/session";
import { TaskForm } from "../../features/TaskForm";
export default function Screen() {
  const { scope } = useSession();
  return <TaskForm key={scope} />;
}
