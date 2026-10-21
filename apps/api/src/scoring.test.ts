import test from 'node:test';import assert from 'node:assert/strict';import {answersMatch} from './scoring.js';import {averageScore,rankAttempts} from './standings.js';
test('single selection scores only the exact correct option',()=>{assert.equal(answersMatch(['a'],['a']),true);assert.equal(answersMatch(['b'],['a']),false)});
test('multiple choice is order independent but requires the full set',()=>{assert.equal(answersMatch(['c','a'],['a','c']),true);assert.equal(answersMatch(['a'],['a','c']),false);assert.equal(answersMatch(['a','b','c'],['a','c']),false)});
test('empty answer is incorrect',()=>{assert.equal(answersMatch([],['a']),false);assert.equal(answersMatch(['a'],[]),false)});
test('duplicate submitted option is not a match',()=>{assert.equal(answersMatch(['a','a'],['a']),false)});

test('team average uses started participant scores and rounds to nearest point',()=>{assert.equal(averageScore([100,81,80]),87);assert.equal(averageScore([]),0)});
test('standings break ties by accuracy then completion time and keep best attempt per person',()=>{const ranked=rankAttempts([{userId:'a',score:100,accuracy:80,time:60},{userId:'b',score:100,accuracy:90,time:80},{userId:'c',score:100,accuracy:90,time:50},{userId:'a',score:90,accuracy:95,time:20}]);assert.deepEqual(ranked.map(x=>x.userId),['c','b','a'])});




