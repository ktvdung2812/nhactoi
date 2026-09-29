import {useLocalSearchParams} from 'expo-router';
import {useSession} from '../../core/session';
import {ServiceDetail} from '../../features/ServiceDetail';
export default function Screen(){const {scope}=useSession();const {id}=useLocalSearchParams<{id:string}>();return <ServiceDetail key={`${scope}/${id}`} id={id}/>;}
