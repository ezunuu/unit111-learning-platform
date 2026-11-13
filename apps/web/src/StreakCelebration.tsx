import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useLearningSubject,subjectPath} from './LearningSubjects.js';
import LearningStatIcon from './LearningStatIcon.js';

type Snapshot={date:string;streak:number;active:boolean;celebratedDate?:string};
export function streakTransition(previous:Snapshot|null,date:string,streak:number,activityCount:number){
 const active=activityCount>0;
 const celebrate=!!previous&&active&&previous.celebratedDate!==date&&(previous.date!==date||!previous.active)&&streak>0;
 return {celebrate,snapshot:{date,streak,active,celebratedDate:celebrate?date:previous?.celebratedDate}};
}
export default function StreakCelebration({userId,api}:{userId:string;api:<T>(path:string,options?:RequestInit)=>Promise<T>}){
 const {subjectId}=useLearningSubject();
 const query=useQuery({queryKey:['learning-path',subjectId],queryFn:()=>api<{summary:{activityDate?:string;currentStreak:number;todayActivityCount:number}}>(subjectPath(subjectId))});
 const [count,Count]=useState<number|null>(null);
 const previous=useRef<Snapshot|null>(null),loadedUser=useRef('');
 useEffect(()=>{
  if(loadedUser.current!==userId){loadedUser.current=userId;previous.current=null;Count(null);try{const raw=localStorage.getItem('unit111-streak-celebration:'+userId);if(raw){const value=JSON.parse(raw);if(typeof value.date==='string'&&Number.isInteger(value.streak)&&typeof value.active==='boolean')previous.current=value}}catch{}}
  const summary=query.data?.summary;if(!summary?.activityDate)return;
  // Read again so another tab's celebration is respected.
  try{const raw=localStorage.getItem('unit111-streak-celebration:'+userId);if(raw){const value=JSON.parse(raw);if(typeof value.date==='string'&&Number.isInteger(value.streak)&&typeof value.active==='boolean')previous.current=value}}catch{}
  const next=streakTransition(previous.current,summary.activityDate,summary.currentStreak,summary.todayActivityCount);
  previous.current=next.snapshot;
  try{localStorage.setItem('unit111-streak-celebration:'+userId,JSON.stringify(next.snapshot))}catch{}
  if(next.celebrate)Count(summary.currentStreak)
 },[userId,query.data]);
 useEffect(()=>{if(count===null)return;const timer=setTimeout(()=>Count(null),4600);return()=>clearTimeout(timer)},[count]);
 if(count===null)return null;
 return <div className="streak-celebration"><section className="streak-celebration-card" role="status" aria-live="polite"><div className="streak-rays" aria-hidden="true"/>{Array.from({length:12},(_,i)=><i key={i} className="streak-confetti" style={{'--particle':i} as React.CSSProperties} aria-hidden="true"/>)}<div className="streak-celebration-flame"><LearningStatIcon kind="streak"/></div><span className="eyebrow">ӨНӨӨДРИЙН АЛХАМ БИЕЛЛЭЭ</span><strong className="streak-celebration-count">{count}</strong><h2>өдрийн цуврал!</h2><p>Өдөр бүрийн жижиг алхам том ахиц болно.</p><button type="button" onClick={()=>Count(null)}>Үргэлжлүүлэх →</button></section></div>;
}
