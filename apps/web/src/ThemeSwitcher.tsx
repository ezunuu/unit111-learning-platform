import {useState} from 'react';
import {Moon,Sun} from 'lucide-react';
const KEY='unit111-appearance';
export function applyAppearance(mode:'light'|'dark'){
 document.documentElement.dataset.colorTheme='aviation';
 document.documentElement.dataset.appearance=mode;
 try{localStorage.setItem(KEY,mode)}catch{}
}
export function initializeColorTheme(){
 let mode:'light'|'dark'='light';
 try{if(localStorage.getItem(KEY)==='dark')mode='dark'}catch{}
 document.documentElement.dataset.colorTheme='aviation';
 document.documentElement.dataset.appearance=mode;
}
export default function ThemeSwitcher(){
 const [mode,Mode]=useState(()=>document.documentElement.dataset.appearance==='dark'?'dark':'light');
 return <button type="button" className="theme-switch" aria-label={mode==='dark'?'Light mode':'Dark mode'} aria-pressed={mode==='dark'} onClick={()=>{const next=mode==='dark'?'light':'dark';applyAppearance(next);Mode(next)}}>{mode==='dark'?<Sun size={15}/>:<Moon size={15}/>} {mode==='dark'?'Light mode':'Dark mode'}</button>;
}
