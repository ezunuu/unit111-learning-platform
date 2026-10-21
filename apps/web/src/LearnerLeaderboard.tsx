import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Award, Medal, Trophy} from 'lucide-react';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Leader={id:string;fullName:string;score:number;accuracy:number;completed:number};

export default function LearnerLeaderboard({api}:{api:Api}){
  const [period,setPeriod]=useState('week');
  const board=useQuery({queryKey:['leaders',period],queryFn:()=>api<{items:Leader[]}>(`/leaderboards/individual?period=${period}`)});
  const leaders=board.data?.items||[];
  const top=leaders.slice(0,3);
  const rest=leaders.slice(3);
  return <div className="learn-page leaderboard-page"><div className="learn-page-heading"><span className="eyebrow">ХАМТЫН СУРГАЛТ</span><h1>Мэдлэгийн чансаа</h1><p>Албан сорилын оноо, нарийвчлалаараа долоо хоног бүр ахицаа харуул.</p></div><div className="leaderboard-filters">{[['week','7 хоног'],['month','Сар'],['all','Бүх хугацаа']].map(([key,label])=><button className={period===key?'active':''} onClick={()=>setPeriod(key)} key={key}>{label}</button>)}</div>{board.isLoading?<div className="learn-loading">Чансаа ачаалж байна…</div>:leaders.length===0?<section className="learn-empty"><Trophy size={30}/><h2>Чансаа одоогоор хоосон байна</h2><p>Эхний сорилоо дуусгаж оноогоо цуглуулаарай.</p></section>:<><section className="leader-podium">{[1,0,2].map(index=>{const item=top[index];if(!item)return <div className="leader-podium-empty" key={index}/>;return <article className={`podium-place place-${index+1}`} key={item.id}><span className="podium-medal">{index===0?<Trophy size={22}/>:<Medal size={20}/>}</span><div className="podium-avatar">{item.fullName.charAt(0).toLocaleUpperCase('mn-MN')}</div><b>{item.fullName}</b><small>{item.accuracy}% нарийвчлал</small><strong>{item.score} оноо</strong><span className="podium-number">{index+1}</span></article>})}</section><section className="leader-list-card"><div className="leader-list-heading"><Award size={19}/><b>Суралцагчдын байр</b><small>{leaders.length} оролцогч</small></div>{leaders.map((item,index)=><article className="leader-row" key={item.id}><span className={`leader-rank ${index<3?'top-rank':''}`}>{index+1}</span><span className="leader-avatar">{item.fullName.charAt(0).toLocaleUpperCase('mn-MN')}</span><div className="leader-person"><b>{item.fullName}</b><small>{item.completed} сорил · {item.accuracy}% зөв</small></div><strong>{item.score} <small>оноо</small></strong></article>)}</section></>}</div>;
}
