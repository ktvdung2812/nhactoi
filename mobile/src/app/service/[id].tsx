import {router,useLocalSearchParams} from 'expo-router';
import {useSession} from '../../core/session';
import {Services} from '../../features/Services';
export default function Screen(){const {scope}=useSession();const {id}=useLocalSearchParams<{id:string}>();return <Services key={`${scope}/${id}`} initialId={id} onInitialBack={()=>router.canGoBack()?router.back():router.replace('/')}/>;}
