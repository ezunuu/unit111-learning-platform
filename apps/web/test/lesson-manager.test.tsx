import {MemoryRouter} from 'react-router-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import LessonManager from '../src/LessonManager.tsx';

test('lesson form creates a title-only draft without forcing category or questions',async()=>{
 let payload:any;let view!:ReactTestRenderer;const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 try{
  await act(async()=>{view=create(<MemoryRouter><QueryClientProvider client={client}><LessonManager categories={[]} questions={[]} api={async(path,options)=>{if(path==='/lessons'&&options?.method==='POST'){payload=JSON.parse(options.body as string);return {lesson:{id:'new',status:'draft'}} as any}return {items:[]} as any}}/></QueryClientProvider></MemoryRouter>)});
  const title=view.root.findAllByType('input').find(node=>node.props.maxLength===200)!;assert.ok(title);
  await act(async()=>title.props.onChange({target:{value:'Simple lesson'}}));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(payload.title,'Simple lesson');assert.deepEqual(payload.questionIds,[]);assert.equal(payload.categoryId,undefined);
  assert.equal(view.root.findByType('details').props.open,undefined);
 }finally{if(view)await act(async()=>view.unmount());client.clear()}
});
