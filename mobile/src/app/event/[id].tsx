import { useSession } from "../../core/session";
import { useLocalSearchParams } from "expo-router";
import { EventForm } from "../../features/EventForm";
export default function Screen() {
  const { scope } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EventForm key={scope} id={id} />;
}
