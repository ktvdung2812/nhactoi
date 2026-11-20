import React from 'react';
import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { getAdaptiveLayout } from '../src/ui/layout';
import { Services } from '../src/features/Services';
import { Projects } from '../src/features/Projects';
import type { NhactoiFoldingFeature } from '../modules/nhactoi-window';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({router:{back:jest.fn(),canGoBack:()=>true,replace:jest.fn(),push:jest.fn()}}));
jest.mock('expo-crypto', () => ({randomUUID:()=> 'uuid'}));
jest.mock('../src/features/ProjectAdvanced',()=>({ProjectAdvanced:()=>null}));
jest.mock('../src/features/ProjectImport',()=>({ProjectImport:()=>null}));
jest.mock('../src/ui/frames',()=>({
  useMeasuredWindow:()=>({attach:()=>{},onLayout:()=>{},layout:mockLayout}),
  position:(r: {x:number;y:number;width:number;height:number})=>({position:'absolute',left:r.x,top:r.y,width:r.width,height:r.height}),
  HingeSafe:({children}:{children:React.ReactNode})=>children,
}));
jest.mock('../src/core/session',()=>({
  useSession:()=>({api:jest.fn(),online:true,writable:true,session:{user:{role:'owner'},subscription:{capabilities:[]}}}),
  refreshData:jest.fn(),
  useResource:(path:string)=>({isPending:false,data:{value:
    path==='/services'?{services:[{id:'s',name:'Miền',provider:'P',nextDate:'2030-01-01',archivedAt:null}]}:
    path==='/services/s'?{service:{id:'s',name:'Miền',provider:'P',nextDate:'2030-01-01',amount:1,canEdit:true,cycle:'year',intervalCount:1,customerId:'c'}}:
    path.endsWith('/history')?{history:[]}:path.includes('/interactions')?{interactions:[]}:
    path==='/projects'?{projects:[{id:'p',name:'Dự án A',myRole:'manager',canManage:true}]}:
    path==='/projects/p'?{project:{id:'p',name:'Dự án A',myRole:'manager',canManage:true},members:[]}:
    path==='/members'?{members:[]}:path==='/teams'?{teams:[]}:{}}}),
}));
const hinge=(orientation:'VERTICAL'|'HORIZONTAL',width:number,height:number):NhactoiFoldingFeature=>({orientation,state:'HALF_OPENED',occlusionType:'NONE',isSeparating:true,bounds:orientation==='VERTICAL'?{left:width/2-10,right:width/2+10,top:0,bottom:height}:{left:0,right:width,top:height/2-10,bottom:height/2+10}});
const postures=[
 {width:360,height:780,foldingFeatures:[],dual:false},
 {width:700,height:840,foldingFeatures:[],dual:true},
 {width:1280,height:800,foldingFeatures:[],dual:true},
 {width:800,height:840,foldingFeatures:[hinge('VERTICAL',800,840)],dual:true},
 {width:800,height:840,foldingFeatures:[hinge('HORIZONTAL',800,840)],dual:true},
 {width:320,height:700,foldingFeatures:[],dual:false},
];
let mockLayout=getAdaptiveLayout(postures[0]);
const region=(id:string)=>StyleSheet.flatten(screen.getByTestId(id,{includeHiddenElements:true}).props.style);
function check(id:string,folds:NhactoiFoldingFeature[],x=0,y=0){
 const r=region(id); if(r.display==='none')return;
 for(const f of folds){const b=f.bounds;expect(x+r.left+r.width<=b.left||x+r.left>=b.right||y+r.top+r.height<=b.top||y+r.top>=b.bottom).toBe(true);}
}
afterEach(cleanup);
test('service list and detail retain the search and care draft across six postures',async()=>{
 mockLayout=getAdaptiveLayout(postures[0]); const view=await render(<Services/>);
 await fireEvent.changeText(screen.getByLabelText('Tìm dịch vụ'),'Miền');
 await fireEvent.press(screen.getByLabelText('Miền · 2030-01-01'));
 await fireEvent.changeText(screen.getByLabelText('Nội dung chăm sóc'),'Bản nháp');
 const draft=screen.getByLabelText('Nội dung chăm sóc');
 for(const posture of postures){
  mockLayout=getAdaptiveLayout(posture);await view.rerender(<Services/>);
  expect(mockLayout.mode).toBe(posture.dual?'dual':'single');
  expect(region('services-list-pane').display).toBe(posture.dual?'flex':'none');
  expect(region('services-detail-pane').display).toBe('flex');
  check('services-list-pane',posture.foldingFeatures);check('services-detail-pane',posture.foldingFeatures);
  expect(screen.getByLabelText('Nội dung chăm sóc')).toBe(draft);
  expect(draft.props.value).toBe('Bản nháp');
  expect(screen.getByLabelText('Tìm dịch vụ',{includeHiddenElements:true}).props.value).toBe('Miền');
 }
});
test('project list and detail retain the selected project and invite draft across six postures',async()=>{
 mockLayout=getAdaptiveLayout(postures[0]);const view=await render(<Projects layout={mockLayout}/>);
 await fireEvent.changeText(screen.getByLabelText('Tên dự án'),'Tên nháp');
 await fireEvent.press(screen.getByLabelText('Dự án: Chọn dự án'));await fireEvent.press(screen.getByText('Dự án A'));
 await fireEvent.changeText(screen.getByLabelText('Email khách'),'draft@example.com');
 const draft=screen.getByLabelText('Email khách');
 for(const posture of postures){
  mockLayout=getAdaptiveLayout(posture);await view.rerender(<Projects layout={mockLayout}/>);
  expect(mockLayout.mode).toBe(posture.dual?'dual':'single');
  expect(region('projects-list-pane').display).toBe(posture.dual?'flex':'none');
  expect(region('projects-detail-pane').display).toBe('flex');
  check('projects-list-pane',posture.foldingFeatures,mockLayout.primary.x,mockLayout.primary.y);
  check('projects-detail-pane',posture.foldingFeatures,mockLayout.primary.x,mockLayout.primary.y);
  expect(screen.getByLabelText('Email khách')).toBe(draft);expect(draft.props.value).toBe('draft@example.com');
  expect(screen.getByLabelText('Tên dự án',{includeHiddenElements:true}).props.value).toBe('Tên nháp');
 }
});

test('a deep-linked service opens beside its list on a large window',async()=>{
 mockLayout=getAdaptiveLayout(postures[2]);await render(<Services initialId="s" onInitialBack={jest.fn()}/>);
 expect(region('services-list-pane').display).toBe('flex');
 expect(region('services-detail-pane').display).toBe('flex');
 expect(screen.getByLabelText('Nội dung chăm sóc')).toBeTruthy();
});
