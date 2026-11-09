import IllustratedIcon from './IllustratedIcon.js';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Check} from 'lucide-react';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
export const AVIATION_SUBJECT='11100000-0000-4000-8000-000000000001';
export const AVIATION_PILOT_SUBJECT='11100000-0000-4000-8000-000000000004';
export const AVIATION_ENGINEER_SUBJECT='11100000-0000-4000-8000-000000000005';
const SUBJECT_STORAGE_KEY='unit111-learning-subject-v2';
export type LearningSubject={id:string;parentId:string|null;title:string;icon:string;sortOrder:number;lessonCount:number};
const Context=createContext({subjectId:'',selectSubject:(_id:string)=>{}});

export function LearningSubjectProvider({children}:{children:ReactNode}){
 const [subjectId,set]=useState(()=>{try{return localStorage.getItem(SUBJECT_STORAGE_KEY)||AVIATION_SUBJECT}catch{return AVIATION_SUBJECT}});
 useEffect(()=>{try{localStorage.setItem(SUBJECT_STORAGE_KEY,subjectId)}catch{}},[subjectId]);
 return <Context.Provider value={{subjectId,selectSubject:set}}>{children}</Context.Provider>;
}
export const useLearningSubject=()=>useContext(Context);
export const subjectPath=(subjectId:string)=>`/learning/path${subjectId?`?subjectId=${encodeURIComponent(subjectId)}`:''}`;

export function LearningSubjectPicker({api}:{api:Api}){
 const {subjectId,selectSubject}=useLearningSubject();
 const subjects=useQuery({queryKey:['learning-subjects'],queryFn:()=>api<{items:LearningSubject[]}>('/learning/subjects')});
 const items=subjects.data?.items??[];
 const selected=items.find(item=>item.id===subjectId);
 const parentItems=items.filter(item=>item.parentId===null);
 const activeParentId=selected?.parentId??selected?.id??AVIATION_SUBJECT;
 const activeParent=parentItems.find(item=>item.id===activeParentId);
 const children=items.filter(item=>item.parentId===activeParentId);
 useEffect(()=>{if(items.length&&!selected)selectSubject(AVIATION_SUBJECT)},[items,selected,selectSubject]);
 if(subjects.isLoading)return <p>Сургалтын сэдэв ачаалж байна…</p>;
 if(subjects.isError)return <p className="learn-error" role="alert">Сургалтын сэдэв ачаалж чадсангүй. <button onClick={()=>void subjects.refetch()}>Дахин оролдох</button></p>;
 return <section className="subject-picker" aria-label="Сургалтын үндсэн сэдэв">
  <div className="learn-section-title"><div><span className="eyebrow">СУРГАЛТЫН ҮНДСЭН СЭДЭВ</span><h2>Хичээлээ сонгоно уу</h2></div></div>
  <div className="subject-grid">{parentItems.map(item=>{const active=item.id===activeParentId;return <button key={item.id} className={`subject-choice ${active?'selected':''}`} aria-pressed={active} onClick={()=>selectSubject(item.id)}><span className={`subject-icon subject-${item.icon}`}><IllustratedIcon name={item.icon} size={35}/></span><span><b>{item.title}</b><small>{item.lessonCount?`${item.lessonCount} хичээл`:'Агуулга бэлтгэгдэж байна'}</small></span>{active&&<Check size={19} className="subject-check"/>}</button>})}</div>
  {activeParent&&children.length>0&&<div className="subject-subcategories"><div className="learn-section-title"><div><span className="eyebrow">{activeParent.title.toLocaleUpperCase('mn-MN')}</span><h3>Суралцагчийн ангилал</h3></div></div><div className="subject-grid">{children.map(item=>{const active=item.id===subjectId;return <button key={item.id} className={`subject-choice subject-child ${active?'selected':''}`} aria-pressed={active} onClick={()=>selectSubject(item.id)}><span className={`subject-icon subject-${item.icon}`}><IllustratedIcon name={item.icon} size={31}/></span><span><b>{item.title}</b><small>{item.lessonCount?`${item.lessonCount} хичээл`:'Агуулга бэлтгэгдэж байна'}</small></span>{active&&<Check size={19} className="subject-check"/>}</button>})}</div></div>}
 </section>;
}

export function AdminLearningSubjects({api,role}:{api:Api;role:string}){
 const qc=useQueryClient(),[title,T]=useState(''),[error,E]=useState(''),[busy,B]=useState(false);
 const subjects=useQuery({queryKey:['learning-subjects'],queryFn:()=>api<{items:LearningSubject[]}>('/learning/subjects')});
 async function save(id:string|undefined,newTitle:string,icon='book'){if(busy||!newTitle.trim())return;B(true);E('');try{await api(id?`/admin/subjects/${id}`:'/admin/subjects',{method:id?'PUT':'POST',body:JSON.stringify({title:newTitle.trim(),icon})});if(!id)T('');await qc.invalidateQueries({queryKey:['learning-subjects']})}catch(e){E((e as Error).message)}finally{B(false)}}
 const items=subjects.data?.items??[];
 const label=(item:LearningSubject)=>item.parentId?`${items.find(parent=>parent.id===item.parentId)?.title??'Сэдэв'} › ${item.title}`:item.title;
 return <section className="learn-card admin-subjects"><h2>Үндсэн сэдэв, ангилал</h2><p className="learn-muted">Нисэхийн мэдлэгийн хичээлийг Нисгэгч эсвэл Инженерийн ангилалд холбоно.</p>{error&&<p className="learn-error" role="alert">{error}</p>}{role==='admin'&&<form className="subject-create" onSubmit={e=>{e.preventDefault();void save(undefined,title)}}><label>Шинэ үндсэн сэдэв<input required maxLength={200} value={title} onChange={e=>T(e.target.value)} placeholder="Жишээ: Аюулгүй ажиллагаа"/></label><button className="learn-button learn-button-primary" disabled={busy||!title.trim()}>Сэдэв нэмэх</button></form>}<details><summary>Сэдэв, ангиллын нэр засах</summary>{items.map(item=><form className="subject-create" key={`${item.id}:${item.title}`} onSubmit={e=>{e.preventDefault();void save(item.id,String(new FormData(e.currentTarget).get('title')),item.icon)}}><input name="title" required maxLength={200} defaultValue={item.title} aria-label={`${label(item)} нэр`} disabled={role!=='admin'}/>{role==='admin'&&<button className="learn-button learn-button-outline" disabled={busy}>Хадгалах</button>}</form>)}</details></section>;
}
