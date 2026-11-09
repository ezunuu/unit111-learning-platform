export type ImportCategory = { id: string; name: string };
export type ImportRow = {
  line: number;
  reuseQuestionId?:string;
  duplicateMatch?:{questionId:string;questionText:string;message:string;canReuse:boolean;metadataDiffers:boolean;sourceDocument?:string;sourceLocation?:string;status?:string};
  chapterTitle?:string;
  lessonTitle?:string;
  sourceReference: string | null;
  categoryId: string;
  categoryName: string;
  originalCategoryName:string;
  audience:'engineer'|'pilot'|null;
  questionText: string;
  questionType: 'single_choice' | 'multiple_choice' | 'true_false';
  difficulty: 'easy' | 'medium' | 'hard';
  options: { text: string }[];
  correctIndexes: number[];
  correctAnswerText: string | null;
  explanation: string;
  sourceDocument: string;
  sourceRevision: string | null;
  sourceSection: string | null;
  sourceLocation: string;
  xp: number;
  errors: string[];
  warnings: string[];
};

const normalize = (value: string) => value.normalize('NFKC').replace(/[\p{Cf}\p{P}\p{S}]/gu, ' ').toLocaleLowerCase('mn').replace(/\s+/gu, ' ').trim();
const normalizeAnswer = (value: string) => normalize(value).replace(/\s/gu, '');

export function prepareQuestionImport(rows: string[][], categories: ImportCategory[], options: { sourceDocumentFallback?: string; categoryIdOverride?: string } = {}): ImportRow[] {
  if (!rows.length) return [];
  const names = rows[0].map((value) => value.trim().toLocaleLowerCase('en-US'));
  const position = new Map(names.map((name, index) => [name, index]));
  const workbook = position.has('id') && (position.has('topic') || position.has('category')) && position.has('question');
  const seenIds = new Set<string>();
  const mapped = rows.slice(1).filter((row) => row.some(Boolean)).map((raw, index) => {
    const get = (...keys: string[]) => {
      for (const key of keys) {
        const column = position.get(key.toLocaleLowerCase('en-US'));
        if (column !== undefined) return (raw[column] ?? '').trim();
      }
      return '';
    };
    const sourceReference = workbook ? get('id') : get('sourceReference', 'id') || null;
    const originalCategoryName = workbook ? get('topic','category') : get('category','topic');
    const normalizedAudience=normalize(originalCategoryName);
    const audience:ImportRow['audience']=['engineer','engineering','инженер'].includes(normalizedAudience)?'engineer':['pilot','pilots','нисгэгч'].includes(normalizedAudience)?'pilot':null;
    const directCategory=categories.find((item) => normalize(item.name) === normalize(originalCategoryName));
    const selectedCategory=options.categoryIdOverride?categories.find(item=>item.id===options.categoryIdOverride):undefined;
    const generalCategory=categories.find(item=>['ерөнхий техникийн мэдлэг','general technical knowledge','general'].includes(normalize(item.name)));
    // ENGINEER/PILOT in these spreadsheets names the learner audience, not a
    // question-bank taxonomy. Keep that audience visible and use the explicit
    // bank category when selected, otherwise the existing general category.
    const category=selectedCategory??directCategory??(audience?generalCategory:undefined);
    const rawType = (workbook ? get('question type') : get('questionType')).toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_');
    const typeSupported = ['single_choice','multiple_choice','true_false','multiple_correct','multiple_answer','multiple_choice_multi','true/false'].includes(rawType);
    const questionType: ImportRow['questionType'] = ['multiple_correct', 'multiple_answer', 'multiple_choice_multi'].includes(rawType)
      ? 'multiple_choice'
      : ['true_false', 'true/false', 'truefalse'].includes(rawType)
        ? 'true_false'
        : 'single_choice';
    const difficultyValue = (get('difficulty') || 'medium').toLocaleLowerCase('en-US');
    const difficulty: ImportRow['difficulty'] = difficultyValue === 'easy' ? 'easy' : difficultyValue === 'hard' ? 'hard' : 'medium';
    const optionTexts = workbook
      ? ['A', 'B', 'C', 'D'].map((letter) => get(`option ${letter}`))
      : get('options').split('|').map((value) => value.trim());
    const rawCorrect = workbook ? get('correct answer') : get('correctIndexes');
    const correctIndexes = workbook
      ? rawCorrect.split(/[;,\s]+/).filter(Boolean).map((letter) => 'ABCD'.indexOf(letter.toUpperCase()))
      : rawCorrect.split(',').map((value) => Number(value.trim())).filter(Number.isInteger);
    const questionText = workbook ? get('question') : get('questionText');
    const explanation = get('explanation', 'explanation / mini lesson', 'mini lesson');
    const sourceDocument = (workbook ? get('source document', 'source') : get('sourceDocument', 'source document')) || (workbook ? options.sourceDocumentFallback?.trim() ?? '' : '');
    // Some workbooks use a human-facing heading while the CSV template uses
    // the API field name. Never infer a revision from Source or Source Page.
    const sourceRevision = get('source version', 'source revision', 'sourceVersion', 'sourceRevision', 'manual revision') || null;
    const sourceSection = get('source section', 'section', 'sourceSection') || null;
    const sourceLocation = workbook ? get('source page', 'source location', 'manual page') : get('sourceLocation', 'source page', 'manual page');
    const rawXp = get('xp');
    const xp = rawXp ? Number(rawXp) : 10;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!category) errors.push('Ангилал олдсонгүй.');
    if(audience&&category&&!directCategory&&!selectedCategory)warnings.push(`Excel-ийн ${originalCategoryName} нь суралцагчийн ангилал; асуултын сангийн ангиллыг “${category.name}” гэж оноолоо.`);
    else if(audience&&category&&(selectedCategory||directCategory))warnings.push(`Excel-ийн ${originalCategoryName} нь суралцагчийн ангилал.`);
    if (questionText.length < 10) errors.push('Асуултын текст дор хаяж 10 тэмдэгт байна.');
    if (!typeSupported) errors.push('Асуултын төрөл буруу.');
    if ((workbook && optionTexts.length !== 4) || optionTexts.length < 2 || optionTexts.some((value) => !value) || new Set(optionTexts.map(normalize)).size !== optionTexts.length) errors.push('Сонголтууд дутуу эсвэл давхардсан.');
    if (!correctIndexes.length || new Set(correctIndexes).size !== correctIndexes.length || correctIndexes.some((value) => value < 0 || value >= optionTexts.length)) errors.push('Зөв сонголтын дугаар буруу.');
    if (questionType === 'single_choice' && correctIndexes.length !== 1) errors.push('Нэг зөв хариулттай төрөлд нэг index хэрэгтэй.');
    if (questionType === 'multiple_choice' && correctIndexes.length < 2) errors.push('Олон зөв хариултад дор хаяж хоёр index хэрэгтэй.');
    if (questionType === 'true_false' && (optionTexts.length !== 2 || correctIndexes.length !== 1)) errors.push('Үнэн/худал нь хоёр сонголттой, нэг зөв index-тэй байна.');
    const correctAnswerText = get('correct answer text');
    if (workbook && correctAnswerText && correctIndexes.length === 1 && normalizeAnswer(correctAnswerText) !== normalizeAnswer(optionTexts[correctIndexes[0]] ?? '')) errors.push('Зөв хариултын тэмдэглэгээ болон текст таарахгүй байна.');
    if (workbook && questionType !== 'single_choice') errors.push('Excel импортод A/B/C/D-ээс нэг зөв хариулт сонгоно.');
    if (!Number.isInteger(xp) || xp < 0 || xp > 1000) errors.push('XP нь 0–1000 бүхэл тоо байна.');
    if (sourceReference) {
      if (seenIds.has(sourceReference)) warnings.push('Workbook ID давхардсан; ижил ID-г давхар key болгохгүйгээр импортолно.');
      seenIds.add(sourceReference);
    }
    return { line: index + 2, chapterTitle:get('бүлэг','chapter'),lessonTitle:get('хичээл','lesson'), sourceReference, categoryId: category?.id ?? '', categoryName: category?.name??originalCategoryName, originalCategoryName, audience, questionText, questionType, difficulty, options: optionTexts.map((text) => ({ text })), correctIndexes, correctAnswerText:correctAnswerText||null, explanation, sourceDocument, sourceRevision, sourceSection, sourceLocation, xp, errors, warnings };
  });
  const seenQuestions = new Map<string, number>();
  for (const item of mapped) {
    const key = normalize(item.questionText);
    if (!key) continue;
    const priorLine = seenQuestions.get(key);
    if (priorLine !== undefined) item.warnings.push(`Файл доторх асуулт ${priorLine}-тай ижил эсвэл давхардсан; тусдаа асуулт болгон импортлох боломжтой.`);
    else seenQuestions.set(key, item.line);
  }
  return mapped;
}

export type ImportLessonGroup={chapterTitle:string;lessonTitle:string;questionIndexes:number[]};
export function buildImportLessonGroups(rows:Pick<ImportRow,'chapterTitle'|'lessonTitle'|'sourceDocument'|'sourceSection'>[],questionsPerLesson=10):ImportLessonGroup[]{
  if(!rows.length||!Number.isInteger(questionsPerLesson)||questionsPerLesson<1)return[];
  const explicitlyGrouped=rows.some(row=>row.chapterTitle?.trim()||row.lessonTitle?.trim());
  if(explicitlyGrouped){
    const grouped=new Map<string,ImportLessonGroup>();
    rows.forEach((row,index)=>{const chapterTitle=row.chapterTitle?.trim()??'',lessonTitle=row.lessonTitle?.trim()??'',key=JSON.stringify([normalize(chapterTitle),normalize(lessonTitle)]),group=grouped.get(key)??{chapterTitle,lessonTitle,questionIndexes:[]};group.questionIndexes.push(index);grouped.set(key,group)});
    return [...grouped.values()];
  }
  const reference=rows.find(row=>row.sourceDocument?.trim())?.sourceDocument??'';
  const chapterMatch=reference.match(/\bchapter\s*(\d+)\s*[:–—-]\s*([^,;]+)/i);
  const chapterTitle=chapterMatch?`${chapterMatch[1].padStart(2,'0')} — ${chapterMatch[2].trim()}`:'Импортолсон асуултууд';
  const lessonPrefix=chapterMatch?.[2].trim()??'Импорт';
  const groups:ImportLessonGroup[]=[];
  for(let start=0;start<rows.length;start+=questionsPerLesson){const lessonNumber=String(groups.length+1).padStart(2,'0');groups.push({chapterTitle,lessonTitle:`${lessonPrefix} — Хичээл ${lessonNumber}`,questionIndexes:Array.from({length:Math.min(questionsPerLesson,rows.length-start)},(_,offset)=>start+offset)})}
  return groups;
}
