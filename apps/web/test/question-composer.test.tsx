import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import QuestionComposer from '../src/QuestionComposer.tsx';

test('minimal composer saves a question with no source and no explanation',async()=>{
 const savedStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
 const requests:{path:string;body:any}[]=[];let saved=0;let view!:ReactTestRenderer;
 try{
  await act(async()=>{view=create(<QuestionComposer categories={[{id:'category',name:'General'}]} api={async(path,options)=>{requests.push({path,body:JSON.parse(options!.body as string)});return (path.endsWith('/check')?{matches:[]}:{question:{id:'new'}}) as any}} onSaved={()=>saved++}/>)});
  const labels=view.root.findAllByType('label').map(node=>node.children.filter(c=>typeof c==='string').join(''));
  assert.ok(!labels.some(text=>/Эх сурвалж|Хуудас|Эх баримт/.test(text)));
  assert.equal(view.root.findByType('details').props.open,undefined);
  const question=view.root.findAllByType('textarea')[0];
  await act(async()=>question.props.onChange({target:{value:'Example question?'}}));
  for(let i=0;i<4;i++){const input=view.root.findAllByType('input').find(node=>node.props['aria-label']===`${i+1}-р сонголт`)!;await act(async()=>input.props.onChange({target:{value:`Answer ${i+1}`}}))}
  const correct=view.root.findAllByType('button').find(node=>node.props.className==='correct-toggle ')!;
  await act(async()=>correct.props.onClick());
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){},nativeEvent:{submitter:null}}));
  assert.equal(saved,1);const createRequest=requests.find(item=>item.path==='/questions')!;
  assert.ok(createRequest);assert.equal(createRequest.body.status,'published');assert.equal(requests.length,1);assert.equal(createRequest.body.explanation,'');assert.equal(createRequest.body.sourceDocument,null);assert.equal(createRequest.body.sourceLocation,null);assert.deepEqual(createRequest.body.correctIndexes,[0]);assert.equal(createRequest.body.options.length,4);
 }finally{if(view)await act(async()=>view.unmount());if(savedStorage)Object.defineProperty(globalThis,'localStorage',savedStorage);else delete (globalThis as any).localStorage}
});
