import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImportLessonGroups, prepareQuestionImport } from '../src/question-import-mapping.ts';

const headers = ['ID','Topic','Question Type','Question','Option A','Option B','Option C','Option D','Correct Answer','Correct Answer Text','Explanation','Source','Source Page','XP','Difficulty'];
const categories = [{ id: 'topic-id', name: 'Main Airframe' }];

test('maps workbook aliases, answer letter, source and XP without changing question text', () => {
  const aliasHeaders = ['ID','Topic','Question Type','Question','Option A','Option B','Option C','Option D','Correct Answer','Correct Answer Text','Explanation / Mini Lesson','Source Document','Manual Page','Manual Revision','XP','Difficulty'];
  const rows = [aliasHeaders, ['41','Main Airframe','Multiple Choice','BK117 C-2-ийн frame?','A option','B option','C option','D option','C','C option','Manual explanation.','BK117 C-2 CAT B1 / Fuselage','02-14','Revision 3','15','Intermediate']];
  const [row] = prepareQuestionImport(rows, categories);
  assert.equal(row.questionText, 'BK117 C-2-ийн frame?');
  assert.equal(row.questionType, 'single_choice');
  assert.equal(row.difficulty, 'medium');
  assert.deepEqual(row.correctIndexes, [2]);
  assert.equal(row.sourceReference, '41');
  assert.equal(row.sourceLocation, '02-14');
  assert.equal(row.xp, 15);
  assert.equal(row.explanation,'Manual explanation.');
  assert.equal(row.sourceRevision,'Revision 3');
  assert.equal(row.correctAnswerText,'C option');
  assert.deepEqual(row.errors, []);
});

test('rejects wrong correct-answer mapping and duplicate workbook IDs', () => {
  const row = ['1','Main Airframe','Multiple Choice','A non-empty question?','A','B','C','D','B','not B','Explanation','Manual','02-14','10','Intermediate'];
  const mapped = prepareQuestionImport([headers, row, row], categories);
  assert.ok(mapped[0].errors.some((error) => error.includes('тэмдэглэгээ')));
  assert.ok(mapped[1].errors.some((error) => error.includes('ID давхардсан')));
});

test('maps an explicit Source Version column and leaves it missing when the workbook has none', () => {
  const withVersion = [...headers, 'Source Version', 'Source Section'];
  const row = ['42','Main Airframe','Multiple Choice','BK117 C-2-ийн structure?','A','B','C','D','B','B','Manual explanation.','BK117 C-2 CAT B1 / Fuselage / 02-4','02-4','10','Intermediate','Revision 7','Fuselage'];
  const [mapped] = prepareQuestionImport([withVersion, row], categories);
  assert.equal(mapped.sourceDocument, 'BK117 C-2 CAT B1 / Fuselage / 02-4');
  assert.equal(mapped.sourceLocation, '02-4');
  assert.equal(mapped.sourceRevision, 'Revision 7');
  assert.equal(mapped.sourceSection, 'Fuselage');
  const [withoutVersion] = prepareQuestionImport([headers, row.slice(0, headers.length)], categories);
  assert.equal(withoutVersion.sourceRevision, null);
  assert.equal(withoutVersion.sourceSection, null);
});

test('allows optional explanation during import', () => {
  const row = ['43','Main Airframe','Multiple Choice','BK117 C-2-ийн fuselage?','A','B','C','D','A','A','', 'BK117 C-2 CAT B1','02-15','10','Intermediate'];
  const [mapped] = prepareQuestionImport([headers, row], categories);
  assert.equal(mapped.explanation, '');
  assert.deepEqual(mapped.errors,[]);
});

test('uses the administrator selected source document only when workbook source is absent and permits missing answer text',()=>{
  const aliasHeaders=['ID','Topic','Question Type','Question','Option A','Option B','Option C','Option D','Correct Answer','Explanation / Mini Lesson','Manual Page','Manual Revision'];
  const row=['50','Main Airframe','Single Choice','BK117-ийн бүтэц асуулт?','A option','B option','C option','D option','A','Explanation','p. 22','Rev B'];
  const [mapped]=prepareQuestionImport([aliasHeaders,row],categories,{sourceDocumentFallback:'BK117 C-2 Training Manual CAT B1 — Chapter 02 Fuselage'});
  assert.equal(mapped.correctIndexes[0],0);
  assert.equal(mapped.sourceDocument,'BK117 C-2 Training Manual CAT B1 — Chapter 02 Fuselage');
  assert.equal(mapped.sourceLocation,'p. 22');
  assert.equal(mapped.sourceRevision,'Rev B');
  assert.deepEqual(mapped.errors,[]);
});

test('accepts arbitrary optional source text while still blocking repeated normalized questions',()=>{
  const first=['51','Main Airframe','Single Choice','BK117 fuselage question?','A','B','C','D','B','Explanation','unknown','Rev A'];
  const second=['52','Main Airframe','Single Choice','  BK117   FUSELAGE question? ','A2','B2','C2','D2','B','Explanation','page 4','Rev A'];
  const aliasHeaders=['ID','Topic','Question Type','Question','Option A','Option B','Option C','Option D','Correct Answer','Explanation / Mini Lesson','Manual Page','Manual Revision'];
  const mapped=prepareQuestionImport([aliasHeaders,first,second],categories,{sourceDocumentFallback:'Manual'});
  assert.deepEqual(mapped[0].errors,[]);
  assert.ok(mapped[1].errors.some(error=>error.includes('давхардсан')));
});

test('accepts Category heading and applies selected category over workbook value',()=>{
  const h=['ID','Category','Question Type','Question','Option A','Option B','Option C','Option D','Correct Answer','Explanation / Mini Lesson','Manual Page','Manual Revision'];
  const row=['61','Англи category','Single Choice','BK117 fuselage category override?','A','B','C','D','A','Explanation','p. 9','Rev 1'];
  const choices=[...categories,{id:'selected-category',name:'Fuselage'}];
  const [mapped]=prepareQuestionImport([h,row],choices,{categoryIdOverride:'selected-category',sourceDocumentFallback:'Manual'});
  assert.equal(mapped.categoryId,'selected-category');
  assert.equal(mapped.categoryName,'Fuselage');
  assert.deepEqual(mapped.errors,[]);
});

test('category matching ignores case and repeated whitespace',()=>{
  const h=['ID','Topic','Question Type','Question','Option A','Option B','Option C','Option D','Correct Answer','Explanation / Mini Lesson','Manual Page','Manual Revision'];
  const row=['62','  main   AIRFRAME  ','Single Choice','BK117 normalized category question?','A','B','C','D','B','Explanation','p. 3','Rev 1'];
  const [mapped]=prepareQuestionImport([h,row],categories,{sourceDocumentFallback:'Manual'});
  assert.equal(mapped.categoryId,'topic-id');
  assert.equal(mapped.categoryName,'Main Airframe');
});

test('treats ENGINEER as learner audience and maps it to the existing general bank category',()=>{
  const h=['category','questionText','questionType','options','correctIndexes','explanation','sourceDocument'];
  const row=['ENGINEER','Tail boom supports the tail rotor?','single_choice','A|B|C|D','0','Explanation','BK117 C-2 Training Manual, Chapter 03: Tail Unit'];
  const choices=[{id:'general-id',name:'Ерөнхий техникийн мэдлэг'}];
  const [mapped]=prepareQuestionImport([h,row],choices);
  assert.equal(mapped.audience,'engineer');
  assert.equal(mapped.originalCategoryName,'ENGINEER');
  assert.equal(mapped.categoryId,'general-id');
  assert.equal(mapped.categoryName,'Ерөнхий техникийн мэдлэг');
  assert.deepEqual(mapped.errors,[]);
  assert.match(mapped.warnings.join(' '),/суралцагчийн ангилал/);
});

test('splits chapter sourced questions into draft lesson plan groups of ten',()=>{
  const rows=Array.from({length:70},(_,index)=>({sourceDocument:'Airbus Helicopters BK117C-2 Training Manual CAT B1, Chapter 03: Tail Unit',sourceSection:`Section ${index+1}`}));
  const groups=buildImportLessonGroups(rows);
  assert.equal(groups.length,7);
  assert.deepEqual(groups.map(group=>group.questionIndexes.length),[10,10,10,10,10,10,10]);
  assert.ok(groups.every(group=>group.chapterTitle==='03 — Tail Unit'));
  assert.equal(groups[0].lessonTitle,'Tail Unit — Хичээл 01');
  assert.equal(groups[6].lessonTitle,'Tail Unit — Хичээл 07');
  assert.deepEqual(groups.flatMap(group=>group.questionIndexes),Array.from({length:70},(_,index)=>index));
});

 test('imports questions without any source columns',()=>{const h=['category','questionText','questionType','options','correctIndexes','explanation'];const [row]=prepareQuestionImport([h,['Main Airframe','No source question?','single_choice','First|Second|Third|Fourth','0','Optional supporting explanation']],categories);assert.equal(row.sourceDocument,'');assert.equal(row.sourceLocation,'');assert.deepEqual(row.errors,[])});
