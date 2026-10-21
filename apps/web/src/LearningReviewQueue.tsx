import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type QueueItem={id:string;kind?:'lesson'|'practice';questionId:string;questionText:string;lessonId:string|null;lessonTitle:string;attemptId?:string;options?:{id:string;text:string}[];missCount:number;reviewCount:number;firstMissedAt:string;lastMissedAt:string;sourceDocument:string|null;sourceRevision:string|null;sourceLocation:string|null};
type RetryResult={correct:boolean;correctOptionTexts:string[];explanation:string;awardedXp:0;reviewCount:number};
function PracticeReviewCard({item,api}:{item:QueueItem;api:Api}){
 const [selected,setSelected]=useState(''),[result,setResult]=useState<RetryResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),qc=useQueryClient();
 async function retry(){if(!item.attemptId||!selected)return;setBusy(true);setError('');try{const value=await api<RetryResult>(`/attempts/${item.attemptId}/questions/${item.questionId}/retry`,{method:'POST',body:JSON.stringify({optionIds:[selected]})});setResult(value);await qc.invalidateQueries({queryKey:['learning-review-queue']});await qc.invalidateQueries({queryKey:['learning-summary']})}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <article className="review-queue-card"><div><small>{item.lessonTitle} · {item.missCount} удаа алдсан</small><h2>{item.questionText}</h2><p>Давтсан: {item.reviewCount} удаа · XP олгохгүй</p><div className="quiz-options">{(item.options??[]).map((option,index)=><button type="button" className={`quiz-option ${selected===option.id?'selected':''}`} key={option.id} disabled={busy||!!result} onClick={()=>setSelected(option.id)}><span className="quiz-option-letter">{String.fromCharCode(65+index)}</span><span>{option.text}</span></button>)}</div>{error&&<p className="learn-error" role="alert">{error}</p>}{result&&<div className={`lesson-feedback ${result.correct?'correct':'incorrect'}`} role="status"><b>{result.correct?'Зөв хариуллаа!':'Дахин оролдоод үзээрэй'}</b><p><strong>Зөв хариулт:</strong> {result.correctOptionTexts.join(' · ')}<br/>{result.explanation.trim()||'Энэ асуултад тайлбар оруулаагүй байна'}</p><small>XP олгохгүй · Давталт: {result.reviewCount}</small></div>}<span>Эх сурвалж: {item.sourceDocument||'—'} · {item.sourceRevision||'Хувилбар заагаагүй'} · {item.sourceLocation||'Байршил заагаагүй'}</span></div><button className="learn-button learn-button-outline" onClick={()=>void retry()} disabled={busy||!selected||!!result}>{busy?'Шалгаж байна…':'Хариулж давтах'} <ArrowRight size={15}/></button></article>
}
export default function LearningReviewQueue({api}:{api:Api}){
 const query=useQuery({queryKey:['learning-review-queue'],queryFn:()=>api<{items:QueueItem[]}>('/learning/review-queue')});
 const qc=useQueryClient(),navigate=useNavigate(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function start(questionIds?:string[]){setBusy(true);setError('');try{const pack=await api<{attempt:{id:string}}>('/learning/review-queue/start',{method:'POST',body:JSON.stringify(questionIds?{questionIds}:{})});await qc.invalidateQueries({queryKey:['learning-review-queue']});navigate(`/learning-review/${pack.attempt.id}`)}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
 if(query.isLoading)return <p className="learn-loading">Давтах сэдвийг ачаалж байна…</p>;
 if(query.isError)return <p className="learn-error" role="alert">Алдсан асуултыг ачаалж чадсангүй.</p>;
 const items=query.data?.items??[];
 return <main className="learn-page"><header className="learn-page-heading"><span className="eyebrow">ХУВИЙН ДАВТЛАГА</span><h1>Алдсан асуултуудаа давтах</h1><p>Зөв хариулж, давтлагын явцаа ахиулна. Энэ нь албан ёсны шалгалтын үнэлгээнд нөлөөлөхгүй.</p></header>
  {error&&<p className="learn-error" role="alert">{error}</p>}
  {!items.length?<section className="learn-empty"><RotateCcw size={30}/><h2>Давтах асуулт алга</h2><p>Сургалтын хичээл дээр буруу хариулсан, нийтлэгдсэн асуултууд энд хадгалагдана.</p></section>:<>
   <section className="review-queue-toolbar"><div><b>{items.length} асуулт</b><span>Нийтлэгдсэн асуулттай үед давтлагад нээнэ.</span></div>{items.some(item=>item.kind!=='practice')&&<button className="learn-button learn-button-primary" onClick={()=>void start(items.filter(item=>item.kind!=='practice').map(item=>item.questionId))} disabled={busy}>{busy?'Бэлдэж байна…':'Хичээлийн асуултуудыг давтах'} <ArrowRight size={16}/></button>}</section>
   <div className="review-queue-list">{items.map((item)=>item.kind==='practice'?<PracticeReviewCard key={item.id} item={item} api={api}/>:<article className="review-queue-card" key={item.id}><div><small>{item.lessonTitle} · {item.missCount} удаа алдсан</small><h2>{item.questionText}</h2><p>Давтсан: {item.reviewCount} удаа</p><span>Эх сурвалж: {item.sourceDocument||'—'} · {item.sourceRevision||'Хувилбар заагаагүй'} · {item.sourceLocation||'Байршил заагаагүй'}</span></div><button className="learn-button learn-button-outline" onClick={()=>void start([item.questionId])} disabled={busy}>Давтах <ArrowRight size={15}/></button></article>)}</div>
  </>}
 </main>;
}
