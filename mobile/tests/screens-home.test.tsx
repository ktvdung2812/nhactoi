import React from 'react';
import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { getAdaptiveLayout } from '../src/ui/layout';
import Home from '../src/app/index';
import type { NhactoiFoldingFeature } from '../modules/nhactoi-window';

jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router',()=>({router:{push:jest.fn()}}));
jest.mock('expo-notifications',()=>({getLastNotificationResponseAsync:async()=>null,addNotificationResponseReceivedListener:()=>({remove(){}}),addNotificationReceivedListener:()=>({remove(){}}),addPushTokenListener:()=>({remove(){}})}));
jest.mock('../src/core/push',()=>({notificationTarget:()=>({}),pushConfigured:false}));
jest.mock('../src/core/session',()=>({refreshData:jest.fn(),useSession:()=>({session:{token:'t',user:{id:'u'},workspace:{id:'w'}},scope:'w',online:true,switchWorkspace:jest.fn()})}));
jest.mock('../src/ui/frames',()=>({useMeasuredWindow:()=>({attach:()=>{},onLayout:()=>{},layout:mockLayout,width:mockWidth}),position:(r:{x:number;y:number;width:number;height:number})=>({position:'absolute',left:r.x,top:r.y,width:r.width,height:r.height})}));
jest.mock('../src/features/TaskList',()=>({TaskList:({onSelect}:{onSelect:(id:string)=>void})=>{const React=require('react');const {Button,TextInput}=require('react-native');const [value,setValue]=React.useState('');return <><TextInput accessibilityLabel="list draft" value={value} onChangeText={setValue}/><Button title="Select task" onPress={()=>onSelect('t1')}/></>;}}));
jest.mock('../src/features/TaskDetail',()=>({TaskDetail:({id}:{id:string})=>{const React=require('react');const {Text,TextInput}=require('react-native');const [value,setValue]=React.useState('');return <><Text>{id}</Text><TextInput accessibilityLabel="detail draft" value={value} onChangeText={setValue}/></>;}}));
jest.mock('../src/features/Planner',()=>({Planner:()=>null}));
jest.mock('../src/features/Projects',()=>({Projects:()=>null}));
jest.mock('../src/features/Notifications',()=>({Notifications:()=>null}));
jest.mock('../src/features/Account',()=>({Account:()=>null}));
jest.mock('../src/features/Login',()=>({Login:()=>null}));
const fold=(orientation:'VERTICAL'|'HORIZONTAL'):NhactoiFoldingFeature=>({orientation,state:'HALF_OPENED',occlusionType:'NONE',isSeparating:true,bounds:orientation==='VERTICAL'?{left:390,right:410,top:0,bottom:840}:{left:0,right:800,top:410,bottom:430}});
const postures=[{width:360,height:780,foldingFeatures:[],dual:false},{width:700,height:840,foldingFeatures:[],dual:true},{width:1280,height:800,foldingFeatures:[],dual:true},{width:800,height:840,foldingFeatures:[fold('VERTICAL')],dual:true},{width:800,height:840,foldingFeatures:[fold('HORIZONTAL')],dual:true},{width:320,height:700,foldingFeatures:[],dual:false}];
let mockWidth=360,mockLayout=getAdaptiveLayout(postures[0]);
afterEach(cleanup);
test('home keeps selected task and both drafts as pane geometry changes',async()=>{
 const view=await render(<Home/>);
 await fireEvent.changeText(screen.getByLabelText('list draft'),'search');await fireEvent.press(screen.getByText('Select task'));
 await fireEvent.changeText(screen.getByLabelText('detail draft'),'comment');const draft=screen.getByLabelText('detail draft');
 for(const posture of postures){
  mockWidth=posture.width;mockLayout=getAdaptiveLayout(posture);await view.rerender(<Home/>);
  expect(mockLayout.mode).toBe(posture.dual?'dual':'single');
  for(const id of ['home-task-list-pane','home-task-detail-pane','home-navigation-region']){
   const r=StyleSheet.flatten(screen.getByTestId(id,{includeHiddenElements:true}).props.style);
   if(r.display==='none')continue;
   for(const f of posture.foldingFeatures){const b=f.bounds;expect(r.left+r.width<=b.left||r.left>=b.right||r.top+r.height<=b.top||r.top>=b.bottom).toBe(true);}
  }
  const list=StyleSheet.flatten(screen.getByTestId('home-task-list-pane',{includeHiddenElements:true}).props.style);
  expect(list.display).toBe(posture.dual?'flex':'none');expect(screen.getByText('t1')).toBeTruthy();
  expect(screen.getByLabelText('detail draft')).toBe(draft);expect(draft.props.value).toBe('comment');
  expect(screen.getByLabelText('list draft',{includeHiddenElements:true}).props.value).toBe('search');
 }
});

test('a deep-linked task starts selected in a dual layout',async()=>{
 mockWidth=1280;mockLayout=getAdaptiveLayout(postures[2]);
 await render(<Home initialTaskId="linked-task" onInitialBack={jest.fn()}/>);
 expect(screen.getByText('linked-task')).toBeTruthy();
 expect(StyleSheet.flatten(screen.getByTestId('home-task-list-pane').props.style).display).toBe('flex');
});
