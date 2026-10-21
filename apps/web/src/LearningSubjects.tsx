import IllustratedIcon from './IllustratedIcon.js';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {BookOpen,Layers,Plane,Shield,Check} from 'lucide-react';
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
export const AVIATION_SUBJECT='11100000-0000-4000-8000-000000000001';
export type LearningSubject={id:string;title:string;icon:string;lessonCount?:number};
const Context=createContext({subjectId:'',selectSubject:(_id:string)=>{}});
export function LearningSubjectProvider({children}:{children:ReactNode}){
 const [subjectId,set]=useState(()=>{try{return localStorage.getItem('unit111-learning-subject')||AVIATION_SUBJECT}catch{return AVIATION_SUBJECT}});
 useEffect(()=>{try{localStorage.setItem('unit111-learning-subject',subjectId)}catch{}},[subjectId]);
 return <Context.Provider value={{subjectId,selectSubject:set}}>{children}</Context.Provider>;
}
export const useLearningSubject=()=>useContext(Context);
export const subjectPath=(subjectId:string)=>`/learning/path${subjectId?`?subjectId=${encodeURIComponent(subjectId)}`:''}`;
const icons:{[key:string]:typeof BookOpen}={plane:Plane,book:BookOpen,shield:Shield,layers:Layers};
export function LearningSubjectPicker({api}:{api:Api}){
 const {subjectId,selectSubject}=useLearningSubject();
 const subjects=useQuery({queryKey:['learning-subjects'],queryFn:()=>api<{items:LearningSubject[]}>('/learning/subjects')});
 useEffect(()=>{const items=subjects.data?.items;if(items?.length&&!items.some(item=>item.id===subjectId))selectSubject(items[0].id)},[subjects.data,subjectId,selectSubject]);
 if(subjects.isLoading)return <p>Сургалтын чиглэл ачаалж байна…</p>;
 if(subjects.isError)return <p className="learn-error" role="alert">Сургалтын чиглэл ачаалж чадсангүй. <button onClick={()=>void subjects.refetch()}>Дахин оролдох</button></p>;
 return <section className="subject-picker" aria-label="Сургалтын чиглэл"><div className="learn-section-title"><div><span className="eyebrow">ЮУ СУРАХ ВЭ?</span><h2>Сургалтын чиглэл</h2></div></div><div className="subject-grid">{subjects.data?.items.map(item=>{const Icon=icons[item.icon]??BookOpen;const active=item.id===subjectId;return <button key={item.id} className={`subject-choice ${active?'selected':''}`} aria-pressed={active} onClick={()=>selectSubject(item.id)}><span className={`subject-icon subject-${item.icon}`}><IllustratedIcon name={item.icon} size={35}/></span><span><b>{item.title}</b><small>{item.lessonCount?`${item.lessonCount} хичээл`:'Агуулга бэлтгэгдэж байна'}</small></span>{active&&<Check size={19} className="subject-check"/>}</button>})}</div></section>;
}
export function AdminLearningSubjects({api,role}:{api:Api;role:string}){
 const qc=useQueryClient(),[title,T]=useState(''),[error,E]=useState(''),[busy,B]=useState(false);
 const subjects=useQuery({queryKey:['learning-subjects'],queryFn:()=>api<{items:LearningSubject[]}>('/learning/subjects')});
 async function save(id:string|undefined,newTitle:string,icon='book'){if(busy||!newTitle.trim())return;B(true);E('');try{await api(id?`/admin/subjects/${id}`:'/admin/subjects',{method:id?'PUT':'POST',body:JSON.stringify({title:newTitle.trim(),icon})});if(!id)T('');await qc.invalidateQueries({queryKey:['learning-subjects']})}catch(e){E((e as Error).message)}finally{B(false)}}
 return <section className="learn-card admin-subjects"><h2>Сургалтын чиглэлүүд</h2><p className="learn-muted">Чиглэл дотор хөтөлбөр, бүлэг, хичээлүүдээ байрлуулна.</p>{error&&<p className="learn-error" role="alert">{error}</p>}{role==='admin'&&<form className="subject-create" onSubmit={e=>{e.preventDefault();void save(undefined,title)}}><label>Шинэ чиглэл<input required maxLength={200} value={title} onChange={e=>T(e.target.value)} placeholder="Жишээ: Аюулгүй ажиллагаа"/></label><button className="learn-button learn-button-primary" disabled={busy||!title.trim()}>Чиглэл нэмэх</button></form>}<details><summary>Чиглэлийн нэр засах</summary>{subjects.data?.items.map(item=><form className="subject-create" key={`${item.id}:${item.title}`} onSubmit={e=>{e.preventDefault();void save(item.id,String(new FormData(e.currentTarget).get('title')),item.icon)}}><input name="title" required maxLength={200} defaultValue={item.title} aria-label={`${item.title} нэр`} disabled={role!=='admin'}/>{role==='admin'&&<button className="learn-button learn-button-outline" disabled={busy}>Хадгалах</button>}</form>)}</details></section>;
}
