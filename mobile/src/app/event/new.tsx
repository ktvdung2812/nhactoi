import { useSession } from "../../core/session";
import { EventForm } from "../../features/EventForm";
export default function Screen() {
  const { scope } = useSession();
  return <EventForm key={scope} />;
}
