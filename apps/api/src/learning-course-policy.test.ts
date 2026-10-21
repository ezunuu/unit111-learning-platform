import assert from 'node:assert/strict';
import test from 'node:test';
import { achievedMilestones, buildCourseLessonPath, currentLearningStreak, lessonXpReward, localActivityDate } from './learning-course-policy.js';

test('lesson sequence resets by chapter and free learning bypasses locks', () => {
  const path = buildCourseLessonPath([
    { id: 'b2', lessonOrder: 2, completed: false, questionCount: 10, groupKey: 'b' },
    { id: 'a1', lessonOrder: 1, completed: false, questionCount: 10, groupKey: 'a' },
    { id: 'a2', lessonOrder: 2, completed: false, questionCount: 10, groupKey: 'a' },
    { id: 'b1', lessonOrder: 1, completed: false, questionCount: 10, groupKey: 'b' },
  ]);
  assert.deepEqual(path.map((item) => item.unlocked), [true, true, false, false]);
  assert.equal(buildCourseLessonPath([{ id: 'x', lessonOrder: 2, completed: false, questionCount: 10, freeLearning: true }])[0].unlocked, true);
});

test('chapter-level prerequisite keeps later chapters locked until their prerequisite passes', () => {
  const path = buildCourseLessonPath([
    { id: 'one', lessonOrder: 1, completed: true, questionCount: 10, groupKey: 'chapter-1' },
    { id: 'two', lessonOrder: 1, completed: false, questionCount: 10, groupKey: 'chapter-2', groupUnlocked: false },
    { id: 'three', lessonOrder: 2, completed: false, questionCount: 10, groupKey: 'chapter-2', groupUnlocked: false },
  ]);
  assert.deepEqual(path.map((item) => item.unlocked), [true, false, false]);
});

test('local activity day and streak use configured timezone boundaries', () => {
  assert.equal(localActivityDate(new Date('2026-10-18T16:30:00.000Z'), 'Asia/Ulaanbaatar'), '2026-10-19');
  assert.equal(currentLearningStreak(['2026-10-18', '2026-10-17', '2026-10-15'], '2026-10-18'), 2);
  assert.equal(currentLearningStreak(['2026-10-18', '2026-10-17'], '2026-10-19'), 2);
  assert.equal(currentLearningStreak(['2026-10-17'], '2026-10-19'), 0);
  assert.throws(() => localActivityDate(new Date(), 'No/Such_Zone'), /INVALID_TIME_ZONE/);
});

test('XP rewards are calculated only for a passing first completion and milestones are deterministic', () => {
  assert.equal(lessonXpReward({ questionXp: 40, passed: false, perfect: false, completionXp: 10, passXp: 15, perfectXp: 10 }), 0);
  assert.equal(lessonXpReward({ questionXp: 40, passed: true, perfect: true, completionXp: 10, passXp: 15, perfectXp: 10 }), 75);
  assert.deepEqual(achievedMilestones({ lessonCount: 5, perfectLessonCount: 1, streak: 7, chapterComplete: true, courseComplete: true }), ['first_lesson', 'lessons_5', 'perfect_practice', 'streak_3', 'streak_7', 'chapter_complete', 'course_complete']);
});

test('completed lessons stay replayable when a new prerequisite is inserted, without unlocking unfinished gaps',()=>{
 const path=buildCourseLessonPath([
  {id:'new',lessonOrder:0,completed:false,questionCount:10,groupKey:'old'},
  {id:'done',lessonOrder:1,completed:true,questionCount:10,groupKey:'old',groupUnlocked:false},
  {id:'next',lessonOrder:2,completed:false,questionCount:10,groupKey:'old',groupUnlocked:false},
 ]);
 assert.deepEqual(path.map(item=>item.unlocked),[true,true,false]);
 assert.equal(buildCourseLessonPath([{id:'invalid',lessonOrder:0,completed:true,questionCount:0}])[0].unlocked,false);
});
