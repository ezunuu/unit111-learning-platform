import test from 'node:test';
import assert from 'node:assert/strict';
import {lessonGroupError,lessonGroupsInput} from './import-lesson-plan.js';
const plan={courseId:'11100000-0000-4000-8000-000000000001',groups:[{chapterTitle:'General',lessonTitle:'Basics',questionIndexes:[0,1]},{chapterTitle:'General',lessonTitle:'Systems',questionIndexes:[2]}]};
test('multi-lesson plans cover each imported question exactly once',()=>{
 assert.equal(lessonGroupsInput.safeParse(plan).success,true);assert.equal(lessonGroupError(plan,3),null);
 assert.ok(lessonGroupError({...plan,groups:[{...plan.groups[0],questionIndexes:[0,0]},{...plan.groups[1],questionIndexes:[2]}]},3));
 assert.ok(lessonGroupError({...plan,groups:[{...plan.groups[0],questionIndexes:[0,1,3]}]},3));
 assert.ok(lessonGroupError({...plan,groups:[plan.groups[0],{chapterTitle:' GENERAL ',lessonTitle:' Basics ',questionIndexes:[2]}]},3));
 assert.equal(lessonGroupsInput.safeParse({...plan,groups:[{...plan.groups[0],questionIndexes:Array.from({length:101},(_,i)=>i)}]}).success,false);
});
