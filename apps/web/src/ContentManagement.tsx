import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import LessonManager from './LessonManager.js';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Category={id:string;name:string};
type Question={id:string;questionText:string;status:string};

export default function ContentManagement({api}:{api:Api}){
  const categories=useQuery({queryKey:['content-management','categories'],queryFn:()=>api<{items:Category[]}>('/categories')});
  const questions=useQuery({queryKey:['content-management','questions'],queryFn:()=>api<{items:Question[]}>('/questions?limit=100')});
  return <>
    <div className="admin-management-head"><div><small>СУРГАЛТЫН АГУУЛГА</small><h1>Хичээл ба материал</h1></div><Link to="/admin/manage">Асуулт, сорилын удирдлага →</Link></div>
    <p className="muted">Энд хичээл үүсгэж, сургалтын материал оруулж, асуултын сангаас асуулт холбох боломжтой. Асуулт нэмэх, засахыг “Асуулт, сорилын удирдлага” хэсгээс хийнэ.</p>
    {(categories.isError||questions.isError)&&<p className="error" role="alert">Агуулгын мэдээлэл ачаалж чадсангүй. Дахин ачаална уу.</p>}
    {categories.isLoading||questions.isLoading?<p>Агуулга ачаалж байна…</p>:<LessonManager api={api} categories={categories.data?.items||[]} questions={questions.data?.items||[]}/>}
  </>;
}
