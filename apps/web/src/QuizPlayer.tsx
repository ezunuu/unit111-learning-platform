import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,ArrowRight,CheckCircle2,Clock3,RotateCcw,Send,ShieldCheck,Sparkles} from 'lucide-react';
import {Link,useParams} from 'react-router-dom';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Question={id:string;text:string;type:string;options:{id:string;text:string}[]};
type Pack={attempt:{id:string;startedAt:string;resumed?:boolean};quiz:{id:string;title:string;timeLimitSeconds:number|null;immediateFeedback?:boolean};questions:Question[]};
type PracticeFeedback={correct:boolean;selectedOptionTexts:string[];correctOptionTexts:string[];explanation:string;source:{document:string|null;revision:string|null;location:string|null}};
type RetryFeedback=PracticeFeedback&{awardedXp:0;reviewCount:number};
type Review={questionId:string;question:string;correct:boolean;explanation:string;correctOptionIds:string[]};
type Result={score:number;correctCount:number;incorrectCount:number;accuracy:number;passed:boolean;passingPercentage:number;elapsedSeconds:number;review?:Review[]};

export default function QuizPlayer({api}:{api:Api}){
  const queryClient=useQueryClient();
  const {id}=useParams();
  const [pack,setPack]=useState<Pack|null>(null);
  const [questionIndex,setQuestionIndex]=useState(0);
  const [selected,setSelected]=useState<string[]>([]);
  const [confirmed,setConfirmed]=useState(false);
  const [practiceFeedback,setPracticeFeedback]=useState<PracticeFeedback|null>(null);
  const [miniLessonOpen,setMiniLessonOpen]=useState(false);
  const [retryOpen,setRetryOpen]=useState(false);
  const [retrySelected,setRetrySelected]=useState<string[]>([]);
  const [retryFeedback,setRetryFeedback]=useState<RetryFeedback|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  const [timeLeft,setTimeLeft]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const submitted=useRef(false);
  const startedFor=useRef<string|null>(null);
  const question=pack?.questions[questionIndex];

  async function begin(){
    if(!id)return;
    setPack(null);setResult(null);setQuestionIndex(0);setSelected([]);setConfirmed(false);setPracticeFeedback(null);setMiniLessonOpen(false);setRetryOpen(false);setRetrySelected([]);setRetryFeedback(null);setError('');setBusy(true);setTimeLeft(null);submitted.current=false;
    try{
      const next=await api<Pack>(`/quizzes/${id}/start`,{method:'POST',body:'{}'});
      let startIndex=0,savedAnswers:Record<string,string[]>={};
      if(next.attempt.resumed){
        const prior=await api<{answers:Record<string,string[]>}>(`/attempts/${next.attempt.id}`);
        savedAnswers=prior.answers;
        const firstUnanswered=next.questions.findIndex(item=>!savedAnswers[item.id]?.length);
        startIndex=firstUnanswered>=0?firstUnanswered:Math.max(0,next.questions.length-1);
      }
      setPack(next);setQuestionIndex(startIndex);setSelected(savedAnswers[next.questions[startIndex]?.id]||[]);
      const elapsed=Math.max(0,Math.floor((Date.now()-new Date(next.attempt.startedAt).getTime())/1000));
      setTimeLeft(next.quiz.timeLimitSeconds===null?null:Math.max(0,next.quiz.timeLimitSeconds-elapsed));
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  useEffect(()=>{if(!id||startedFor.current===id)return;startedFor.current=id;void begin();},[id]);
  useEffect(()=>{
    if(timeLeft===null||result)return;
    const timer=window.setInterval(()=>setTimeLeft(value=>value===null?null:Math.max(0,value-1)),1000);
    return()=>window.clearInterval(timer);
  },[timeLeft!==null,result!==null]);

  async function submit(saveCurrent:boolean){
    if(!pack||busy||submitted.current)return;
    setBusy(true);setError('');
    try{
      if(saveCurrent&&question&&selected.length)await api(`/attempts/${pack.attempt.id}/answers`,{method:'PUT',body:JSON.stringify({questionId:question.id,optionIds:selected})});
      submitted.current=true;
      setResult(await api<Result>(`/attempts/${pack.attempt.id}/submit`,{method:'POST',body:'{}'}));
    }catch(e){submitted.current=false;setError((e as Error).message)}finally{setBusy(false)}
  }
  useEffect(()=>{if(timeLeft===0&&!submitted.current)void submit(true);},[timeLeft]);

  async function confirmAnswer(){
    if(!pack||!question||!selected.length||busy)return;
    setBusy(true);setError('');
    try{const saved=await api<{saved:boolean}&Partial<PracticeFeedback>>(`/attempts/${pack.attempt.id}/answers`,{method:'PUT',body:JSON.stringify({questionId:question.id,optionIds:selected})});setPracticeFeedback(typeof saved.correct==='boolean'?saved as PracticeFeedback:null);setConfirmed(true)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  function advance(){
    if(!pack||!confirmed)return;
    if(questionIndex+1<pack.questions.length){setQuestionIndex(questionIndex+1);setSelected([]);setConfirmed(false);setPracticeFeedback(null);setMiniLessonOpen(false);setRetryOpen(false);setRetrySelected([]);setRetryFeedback(null);setError('');return}
    void submit(false);
  }
  function toggle(optionId:string){
    if(!question||confirmed)return;
    setSelected(current=>question.type==='multiple_choice'?(current.includes(optionId)?current.filter(item=>item!==optionId):[...current,optionId]):[optionId]);
  }
  async function submitRetry(){
    if(!pack||!question||!retrySelected.length||busy)return;
    setBusy(true);setError('');
    try{const feedback=await api<RetryFeedback>(`/attempts/${pack.attempt.id}/questions/${question.id}/retry`,{method:'POST',body:JSON.stringify({optionIds:retrySelected})});setRetryFeedback(feedback);await queryClient.invalidateQueries({queryKey:['learning-review-queue']});await queryClient.invalidateQueries({queryKey:['learning-summary']})}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  function toggleRetry(optionId:string){if(!question)return;setRetrySelected(current=>question.type==='multiple_choice'?(current.includes(optionId)?current.filter(item=>item!==optionId):[...current,optionId]):[optionId]);setRetryFeedback(null)}
  const total=pack?.questions.length??0;
  const progress=total?((questionIndex+(confirmed?1:0))/total)*100:0;
  const clock=timeLeft===null?null:`${Math.floor(timeLeft/60).toString().padStart(2,'0')}:${(timeLeft%60).toString().padStart(2,'0')}`;

  if(busy&&!pack)return <div className="quiz-loading"><span className="learn-spinner"/><p>Сорилын асуултуудыг бэлдэж байна…</p></div>;
  if(error&&!pack)return <div className="quiz-state"><span className="quiz-state-icon error-icon">!</span><h1>Сорил нээгдсэнгүй</h1><p>{error}</p><button className="learn-button learn-button-primary" onClick={()=>void begin()}>Дахин оролдох <RotateCcw size={16}/></button><Link className="learn-text-link" to="/path">Сургалтын зам руу буцах</Link></div>;
  if(result&&pack)return <div className="learn-page result-page"><div className={`result-hero ${result.passed?'passed':'try-again'}`}><span className="result-mark">{result.passed?'✓':'↻'}</span><span className="eyebrow">СУРГАЛТЫН ҮР ДҮН</span><h1>{result.passed?'Сайн ажиллалаа!':'Дахин давтаад үзээрэй'}</h1><p>{result.passed?'Мэдлэгээ амжилттай бататгалаа.':'Дасгал бүр ахиц авчирна.'}</p><div className="result-xp"><Sparkles size={17}/> +{Math.max(0,result.score)} XP</div></div><div className="result-stats"><article><small>ОНОО</small><b>{result.score}</b></article><article><small>ЗӨВ ХАРИУЛТ</small><b>{result.accuracy}%</b></article><article><small>ТЭНЦЭХ БОСГО</small><b>{result.passingPercentage}%</b></article><article><small>ХУГАЦАА</small><b>{Math.floor(result.elapsedSeconds/60)}:{(result.elapsedSeconds%60).toString().padStart(2,'0')}</b></article></div>{result.review?.some(item=>!item.correct)&&<section className="learn-card missed-questions"><div className="learn-section-title"><div><span className="eyebrow">ДАВТАХ АСУУЛТ</span><h2>Анхаарах асуултууд</h2></div></div>{result.review.filter(item=>!item.correct).map(item=>{const original=pack.questions.find(q=>q.id===item.questionId);const answers=original?.options.filter(option=>item.correctOptionIds.includes(option.id)).map(option=>option.text)||[];return <article className="missed-question" key={item.questionId}><b>{item.question}</b>{answers.length>0&&<p><strong>Зөв хариулт:</strong> {answers.join(' · ')}</p>}<small>{item.explanation||'Энэ асуултад тайлбар оруулаагүй байна'}</small></article>})}</section>}<div className="result-actions"><button className="learn-button learn-button-primary" onClick={()=>{startedFor.current=null;void begin()}}><RotateCcw size={16}/> Дахин сорих</button><Link className="learn-button learn-button-outline" to="/path">Замналд буцах <ArrowRight size={16}/></Link></div></div>;
  if(!pack||!question)return <div className="quiz-loading"><span className="learn-spinner"/><p>{error||'Сорилын мэдээллийг ачаалж байна…'}</p></div>;

  return <div className="quiz-shell"><div className="quiz-topbar"><Link to="/path" className="quiz-back" aria-label="Сургалтын зам руу буцах"><ArrowLeft size={19}/></Link><div className="quiz-progress-area"><div className="quiz-progress-text"><span>АСУУЛТ {questionIndex+1} <i>/ {total}</i></span>{clock&&<span className={`quiz-clock ${timeLeft!==null&&timeLeft<60?'urgent':''}`}><Clock3 size={15}/>{clock}</span>}</div><div className="learn-progress-track quiz-progress"><span style={{width:`${progress}%`}}/></div></div><span className="quiz-xp-badge"><Sparkles size={15}/>{result?.score??'XP'}</span></div><div className="quiz-content"><div className="quiz-module-tag"><span className="quiz-module-dot"/> UNIT 111 · МЭДЛЭГИЙН ШАЛГАЛТ</div><h1 className="quiz-title">{pack.quiz.title}</h1><p className="muted">Сургалтын материал — албан ёсны нислэгийн зааврыг орлохгүй.</p>{pack.attempt.resumed&&<div className="quiz-neutral-feedback"><RotateCcw size={18}/><span>Өмнөх дуусаагүй оролдлогыг үргэлжлүүлж байна. Өмнө хадгалсан хариултууд тань хэвээр байна.</span></div>}<div className="quiz-question-card" key={question.id}><span className="eyebrow">АСУУЛТ {questionIndex+1}</span><h2>{question.text}</h2><p className="quiz-hint">{question.type==='multiple_choice'?'Нэгээс олон хариулт сонгож болно.':'Хамгийн зөв хариултыг сонгоно уу.'}</p><div className="quiz-options">{question.options.map((option,index)=>{const chosen=selected.includes(option.id);return <button type="button" className={`quiz-option ${chosen?'selected':''} ${confirmed&&chosen?'saved':''}`} key={option.id} onClick={()=>toggle(option.id)} disabled={confirmed||busy}><span className="quiz-option-letter">{String.fromCharCode(65+index)}</span><span>{option.text}</span>{chosen&&<CheckCircle2 size={20} className="quiz-option-check"/>}</button>})}</div>{confirmed&&practiceFeedback?<section className={`lesson-feedback ${practiceFeedback.correct?'correct':'incorrect'}`} role="status"><b>{practiceFeedback.correct?'Зөв хариуллаа!':'Буруу хариуллаа!'}</b>{!practiceFeedback.correct&&<p><strong>Таны хариулт:</strong> {practiceFeedback.selectedOptionTexts.join(' · ')}</p>}<p>{!practiceFeedback.correct&&<><strong>Зөв хариулт:</strong> {practiceFeedback.correctOptionTexts.join(' · ')}<br/></>}{practiceFeedback.explanation.trim()||'Энэ асуултад тайлбар оруулаагүй байна'}</p>{(practiceFeedback.source.document||practiceFeedback.source.location)&&<small className="lesson-source-ref">Эх сурвалж: {practiceFeedback.source.document||'—'} · {practiceFeedback.source.revision||'Хувилбар заагаагүй'} · {practiceFeedback.source.location||'Байршил заагаагүй'}</small>}<button type="button" className="learn-button learn-button-outline" onClick={()=>setMiniLessonOpen(value=>!value)}>{miniLessonOpen?'Хичээлийг хураах':'Хичээлээ үзэх'}</button>{miniLessonOpen&&<div className="mini-lesson"><span className="eyebrow">MINI LESSON</span><h3>{question.text}</h3><p><strong>Гол ойлголт, зөв хариултын үндэслэл:</strong> {practiceFeedback.explanation.trim()||'Энэ асуултад тайлбар оруулаагүй байна. Нэмэлт техникийн мэдээлэл зохиогоогүй.'}</p>{practiceFeedback.source.document&&<p>Manual: {practiceFeedback.source.document}{practiceFeedback.source.revision?` · ${practiceFeedback.source.revision}`:''}{practiceFeedback.source.location?` · ${practiceFeedback.source.location}`:''}</p>}<p className="muted">Техникийн нэр томьёо болон буруу ойлголтын тайлбарыг эх сурвалжид байхгүй бол нэмэхгүй.</p></div>}{!practiceFeedback.correct&&<button type="button" className="learn-button learn-button-outline" onClick={()=>{setRetryOpen(value=>!value);setRetrySelected([]);setRetryFeedback(null)}}><RotateCcw size={15}/>{retryOpen?'Давтлагыг хаах':'Энэ асуултыг давтах'}</button>}{retryOpen&&!practiceFeedback.correct&&<div className="mini-lesson retry-panel"><span className="eyebrow">XP ОЛГОХГҮЙ ДАВТЛАГА</span><div className="quiz-options">{question.options.map((option,index)=><button type="button" className={`quiz-option ${retrySelected.includes(option.id)?'selected':''}`} key={`retry-${option.id}`} onClick={()=>toggleRetry(option.id)} disabled={busy||!!retryFeedback}><span className="quiz-option-letter">{String.fromCharCode(65+index)}</span><span>{option.text}</span></button>)}</div><button type="button" className="learn-button learn-button-primary" onClick={()=>void submitRetry()} disabled={busy||!retrySelected.length||!!retryFeedback}>{busy?'Шалгаж байна…':'Давталтыг шалгах'}</button>{retryFeedback&&<div className={`lesson-feedback ${retryFeedback.correct?'correct':'incorrect'}`} role="status"><b>{retryFeedback.correct?'Давталтад зөв хариуллаа!':'Давталтад буруу хариуллаа!'}</b><p><strong>Зөв хариулт:</strong> {retryFeedback.correctOptionTexts.join(' · ')}<br/>{retryFeedback.explanation.trim()||'Энэ асуултад тайлбар оруулаагүй байна'}</p><small>XP олгохгүй · Давталт: {retryFeedback.reviewCount}</small></div>}</div>}</section>:confirmed&&<div className="quiz-neutral-feedback"><ShieldCheck size={18}/><span>Хариулт хадгалагдлаа. Зөв хариултыг сорил дууссаны дараа харуулна.</span></div>}{error&&<p className="learn-error">{error}</p>}</div><div className="quiz-footer"><span className="quiz-safe-note"><ShieldCheck size={15}/> Хариултын нууцлал хамгаалагдсан</span>{!confirmed?<button className="learn-button learn-button-primary" onClick={()=>void confirmAnswer()} disabled={!selected.length||busy}>{busy?'Хадгалж байна…':'Хариулт батлах'} <CheckCircle2 size={17}/></button>:<button className="learn-button learn-button-primary" onClick={advance} disabled={busy}>{questionIndex+1===total?'Сорил илгээх':'Дараагийн асуулт'} <ArrowRight size={17}/></button>}</div></div></div>;
}
