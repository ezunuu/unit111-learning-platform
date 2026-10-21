import {sql,type SQL} from 'drizzle-orm';
import {assessQuestionPurge} from './question-purge-policy.js';

type SqlExecutor={execute:(query:SQL)=>Promise<unknown>};
type QuestionRow={id:string;question_text:string;status:string;created_at:Date;updated_at:Date;quiz_links:{id:string;title:string;status:string}[];lesson_links:{id:string;title:string;status:string}[];attempt_count:number|string;answer_count:number|string;snapshot_count:number|string;competition_count:number|string;revision_count:number|string;audit_count:number|string;duplicate_reference_count:number|string;option_count:number|string;correct_option_count:number|string};
export type QuestionPurgePreviewItem=QuestionRow&{canDelete:boolean;reasons:string[];quizLinksToDetach:number;unknownForeignKeyTables:string[]};

const knownQuestionDependents=new Set(['quiz_questions','lesson_questions','quiz_attempt_questions','answers','question_revisions','question_options','question_correct_options','questions']);

export async function inspectQuestionPurge(executor:SqlExecutor,questionId:string):Promise<QuestionPurgePreviewItem|null>{
  const [questionResult,foreignKeyResult]=await Promise.all([
    executor.execute(sql`SELECT q.id,q.question_text,q.status,q.created_at,q.updated_at,
      COALESCE((SELECT json_agg(json_build_object('id',quiz.id,'title',quiz.title,'status',quiz.status) ORDER BY quiz.title) FROM quiz_questions link JOIN quizzes quiz ON quiz.id=link.quiz_id WHERE link.question_id=q.id),'[]'::json) AS quiz_links,
      COALESCE((SELECT json_agg(json_build_object('id',lesson.id,'title',lesson.title,'status',lesson.status) ORDER BY lesson.title) FROM lesson_questions link JOIN lessons lesson ON lesson.id=link.lesson_id WHERE link.question_id=q.id),'[]'::json) AS lesson_links,
      (SELECT count(DISTINCT attempt.id)::int FROM quiz_questions link JOIN quiz_attempts attempt ON attempt.quiz_id=link.quiz_id WHERE link.question_id=q.id) AS attempt_count,
      (SELECT count(*)::int FROM answers answer WHERE answer.question_id=q.id) AS answer_count,
      (SELECT count(*)::int FROM quiz_attempt_questions snapshot WHERE snapshot.question_id=q.id) AS snapshot_count,
      (SELECT count(DISTINCT competition.id)::int FROM quiz_questions link JOIN competitions competition ON competition.quiz_id=link.quiz_id WHERE link.question_id=q.id) AS competition_count,
      (SELECT count(*)::int FROM question_revisions revision WHERE revision.question_id=q.id) AS revision_count,
      (SELECT count(*)::int FROM audit_logs audit WHERE audit.entity_type='question' AND audit.entity_id=q.id) AS audit_count,
      (SELECT count(*)::int FROM questions duplicate WHERE duplicate.duplicate_of=q.id) AS duplicate_reference_count,
      (SELECT count(*)::int FROM question_options option WHERE option.question_id=q.id) AS option_count,
      (SELECT count(*)::int FROM question_correct_options correct WHERE correct.question_id=q.id) AS correct_option_count
      FROM questions q WHERE q.id=${questionId}`),
    executor.execute(sql`SELECT DISTINCT source.relname AS table_name
      FROM pg_constraint fk
      JOIN pg_class target ON target.oid=fk.confrelid
      JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace
      JOIN pg_class source ON source.oid=fk.conrelid
      JOIN pg_namespace source_ns ON source_ns.oid=source.relnamespace
      JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS source_key(attnum,ord) ON true
      JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS target_key(attnum,ord) ON target_key.ord=source_key.ord
      JOIN pg_attribute target_column ON target_column.attrelid=target.oid AND target_column.attnum=target_key.attnum
      WHERE fk.contype='f' AND target_ns.nspname='public' AND source_ns.nspname='public' AND target.relname='questions' AND target_column.attname='id'`),
  ]);
  const questionRows=(questionResult as {rows:QuestionRow[]}).rows;
  if(!questionRows.length)return null;
  const foreignRows=(foreignKeyResult as {rows:{table_name:string}[]}).rows;
  const unknownForeignKeyTables=[...new Set(foreignRows.map(row=>row.table_name).filter(name=>!knownQuestionDependents.has(name)))].sort();
  const question=questionRows[0];
  const dependencies={
    quizLinkCount:question.quiz_links.length,
    lessonLinkCount:question.lesson_links.length,
    attemptCount:Number(question.attempt_count),
    answerCount:Number(question.answer_count),
    snapshotCount:Number(question.snapshot_count),
    competitionCount:Number(question.competition_count),
    revisionCount:Number(question.revision_count),
    duplicateReferenceCount:Number(question.duplicate_reference_count),
    unknownForeignKeyTables,
  };
  const assessment=assessQuestionPurge(question.status,dependencies);
  return{...question,...assessment,unknownForeignKeyTables};
}
