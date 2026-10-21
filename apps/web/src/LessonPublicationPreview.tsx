import {useState,type ComponentProps} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {X,ArrowLeft,ArrowRight} from 'lucide-react';
import QuestionComposer from './QuestionComposer.js';
import {ContentBlock} from './LearningLessonPlayer.js';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Block=ComponentProps<typeof ContentBlock>['block']&{reviewStatus:string};
type Question={id:string;questionText:string;questionType:string;status:string;explanation:string;options:{id:string;optionText:string}[];correctOptionIds:string[];correctOptionTexts:string[]};
type Preview={lesson:{id:string;title:string;description:string;content:string;status:string};questions:Question[];contentBlocks:Block[];placement:{chapterTitle:string;chapterStatus:string;courseTitle:string;courseStatus:string}|null;review:{readyToPublish:boolean;reasons:string[];blockingQuestions:{id:string;reason:string}[]}};
type EditQuestion=NonNullable<ComponentProps<typeof QuestionComposer>['initial']>;

export default function LessonPublicationPreview({id,api,categories,onClose,onEditLesson}:{id:string;api:Api;categories:{id:string;name:string}[];onClose:()=>void;onEditLesson:()=>void}){
 const qc=useQueryClient();
 const query=useQuery({queryKey:['lesson-preview',id],queryFn:()=>api<Preview>(`/lessons/${id}/preview`)});
 const [phase,Phase]=useState<'theory'|'practice'>('theory'),[theoryIndex,TheoryIndex]=useState(0),[index,Index]=useState(0),[selected,Selected]=useState<string[]>([]),[checked,Checked]=useState(false),[finished,Finished]=useState(false),[editing,Editing]=useState<EditQuestion|null>(null),[busy,Busy]=useState(false),[error,ErrorText]=useState(''),[message,Message]=useState('');
 const data=query.data,blocks=data?.contentBlocks??[],question=data?.questions[index],block=blocks[theoryIndex];
 const correct=!!question&&selected.length===question.correctOptionIds.length&&selected.every(id=>question.correctOptionIds.includes(id));
 async function editQuestion(questionId:string){Busy(true);ErrorText('');try{Editing(await api<EditQuestion>(`/questions/${questionId}`))}catch(e){ErrorText((e as Error).message)}finally{Busy(false)}}
 async function savedQuestion(){Editing(null);Selected([]);Checked(false);await qc.invalidateQueries({queryKey:['content-management','questions']});await query.refetch()}
 function moveQuestion(next:number){Index(next);Selected([]);Checked(false);Finished(false)}
 async function publish(){if(busy||!data?.review.readyToPublish)return;Busy(true);ErrorText('');Message('');try{
  const result=await api<{publishedCount:number;blocked:{id:string;reasons:string[]}[]}>('/lessons/bulk-publish',{method:'POST',body:JSON.stringify({lessonIds:[id]})});
  if(result.blocked.length)ErrorText(result.blocked.flatMap(item=>item.reasons).join(' '));else Message('Хичээл нийтлэгдлээ.');
  await Promise.all([query.refetch(),qc.invalidateQueries({queryKey:['admin-lessons']}),qc.invalidateQueries({queryKey:['admin-courses']}),qc.invalidateQueries({queryKey:['learning-path']}),qc.invalidateQueries({queryKey:['learning-subjects']})]);
 }catch(e){ErrorText((e as Error).message)}finally{Busy(false)}}
 return <div className="purge-backdrop"><section className="panel lesson-preview-dialog publication-preview" role="dialog" aria-modal="true" aria-labelledby="publication-title">
  <div className="admin-toolbar"><div><small>СУРАЛЦАГЧИЙН ХАРАГДАЦ · АХИЦ ХАДГАЛАХГҮЙ</small><h2 id="publication-title">{data?.lesson.title||'Хичээлийг урьдчилан харах'}</h2></div><button type="button" aria-label="Preview хаах" onClick={onClose} disabled={busy}><X size={19}/></button></div>
  {query.isLoading?<p>Хичээлийг ачаалж байна…</p>:query.isError?<p className="error" role="alert">Хичээлийг ачаалж чадсангүй. <button type="button" onClick={()=>void query.refetch()}>Дахин оролдох</button></p>:data&&<>
   <p className="muted">Энд хариулж үзэхэд оролдлого, оноо, XP болон ахиц үүсэхгүй.</p>
   {data.placement&&<p className="preview-placement">{data.placement.courseTitle} → {data.placement.chapterTitle}</p>}
   {data.placement&&(data.placement.chapterStatus!=='published'||data.placement.courseStatus!=='published')&&<p className="lesson-draft-warning">Сургалтын замд харагдахын тулд хөтөлбөр болон бүлгийг мөн нийтэлсэн байна. <Link to="/admin/courses">Бүлгийн тохиргоо</Link></p>}
   <nav className="preview-tabs" aria-label="Хичээлийн хэсэг"><button type="button" aria-pressed={phase==='theory'} onClick={()=>Phase('theory')}>Онол · {blocks.length}</button><button type="button" aria-pressed={phase==='practice'} onClick={()=>Phase('practice')}>Дадлага · {data.questions.length}</button></nav>
   {editing?<QuestionComposer key={editing.question.id} api={api} categories={categories} initial={editing} onSaved={()=>void savedQuestion()} onCancel={()=>Editing(null)}/>:phase==='theory'?<>
    {data.lesson.description&&<p>{data.lesson.description}</p>}
    {block?<><span className="eyebrow">Алхам {theoryIndex+1} / {blocks.length} · {block.reviewStatus==='approved'?'Баталгаажсан':'Ноорог материал'}</span><article className={`lesson-content-card lesson-block-${block.blockType}`}><ContentBlock block={block}/></article><div className="admin-actions"><button type="button" disabled={theoryIndex===0} onClick={()=>TheoryIndex(i=>i-1)}><ArrowLeft size={15}/> Өмнөх</button><button type="button" className="learn-button learn-button-primary" onClick={()=>theoryIndex+1<blocks.length?TheoryIndex(i=>i+1):Phase('practice')}>{theoryIndex+1<blocks.length?'Үргэлжлүүлэх':'Дадлага эхлүүлэх'} <ArrowRight size={15}/></button></div></>:<><div className="preview-text">{data.lesson.content||'Тусдаа онолын материал оруулаагүй байна. Асуултын тайлбарыг дадлага хэсгээс шалгана.'}</div><button type="button" className="learn-button learn-button-primary" onClick={()=>Phase('practice')}>Дадлага эхлүүлэх <ArrowRight size={15}/></button></>}
    <p><Link to="/admin/courses">Онолын материал засах →</Link></p>
   </>:finished?<section className="lesson-preview-finished"><h3>Урьдчилан үзэж дууслаа</h3><p>Бодит оноо, XP, ахиц хадгалаагүй.</p><button type="button" onClick={()=>moveQuestion(0)}>Дахин үзэх</button></section>:question?<>
    <div className="preview-question-heading"><span>Асуулт {index+1} / {data.questions.length}</span><button type="button" disabled={busy} onClick={()=>void editQuestion(question.id)}>Энэ асуултыг засах</button></div>
    <article className="lesson-question-card"><h3>{question.questionText}</h3><div className="lesson-options">{question.options.map((option,i)=><button type="button" key={option.id} disabled={checked} className={`lesson-option ${selected.includes(option.id)?'selected':''} ${checked&&question.correctOptionIds.includes(option.id)?'correct':''} ${checked&&selected.includes(option.id)&&!question.correctOptionIds.includes(option.id)?'incorrect':''}`} onClick={()=>Selected(current=>question.questionType==='multiple_choice'?(current.includes(option.id)?current.filter(id=>id!==option.id):[...current,option.id]):[option.id])}><span className="lesson-option-letter">{'ABCD'[i]||i+1}</span><span>{option.optionText}</span></button>)}</div>
    {checked&&<div className={`lesson-feedback ${correct?'correct':'incorrect'}`} role="status"><b>{correct?'Зөв хариуллаа':'Дахин анхаараарай'}</b><p>Зөв хариулт: {question.correctOptionTexts.join(' · ')}</p><p className="preview-text">{question.explanation||'Тайлбар оруулаагүй байна.'}</p></div>}</article>
    <div className="admin-actions"><button type="button" disabled={index===0} onClick={()=>moveQuestion(index-1)}>Өмнөх асуулт</button>{!checked?<button type="button" className="learn-button learn-button-primary" disabled={!selected.length} onClick={()=>Checked(true)}>Хариултыг шалгах</button>:<button type="button" className="learn-button learn-button-primary" onClick={()=>index+1<data.questions.length?moveQuestion(index+1):Finished(true)}>{index+1<data.questions.length?'Дараагийн асуулт':'Дуусгах'}</button>}</div>
   </>:<p>Холбогдсон асуулт алга.</p>}
   <section className="preview-publication"><h3>{data.lesson.status==='published'?'Хичээл нийтлэгдсэн':'Нийтлэхийн өмнөх шалгалт'}</h3>{data.lesson.status!=='published'&&<>{data.review.readyToPublish?<p>{data.questions.length} асуулт · Нийтлэхэд бэлэн</p>:<><ul>{data.review.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>{data.review.blockingQuestions.map(item=><div className="preview-blocker" key={item.id}><span>{data.questions.find(q=>q.id===item.id)?.questionText||item.id} — {item.reason}</span><button type="button" disabled={busy} onClick={()=>void editQuestion(item.id)}>Асуулт засах</button></div>)}{data.review.blockingQuestions.length>0&&<Link to="/admin/manage">Асуултын сангаас нийтлэх →</Link>}</>}</>}
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="success" role="status">{message}</p>}
    <div className="admin-actions"><button type="button" onClick={onEditLesson} disabled={busy}>Хичээлийн мэдээлэл засах</button>{data.lesson.status!=='published'&&<button type="button" className="learn-button learn-button-primary" disabled={busy||!data.review.readyToPublish||!!editing} onClick={()=>void publish()}>{busy?'Нийтэлж байна…':'Хичээлийг нийтлэх'}</button>}</div>
   </section>
  </>}
 </section></div>;
}
