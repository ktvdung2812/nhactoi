import { useSession } from '../../core/session';
import { Services } from '../../features/Services';
export default function Screen(){const {scope}=useSession();return <Services key={scope}/>;}
