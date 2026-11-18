import {useState} from 'react';
import {ArrowRight,Check,Copy,MapPin,Navigation,Landmark,MessageCircle} from 'lucide-react';
import {STUDIO_MAP_URL,STUDIO_NAVIGATION_NAME,studioAddress} from '../studio';
import SocialLinks from './SocialLinks';
import StudioMap from './StudioMap';

export default function StudioLocation({address}:{address:string}){
 const [copied,setCopied]=useState(false),[copying,setCopying]=useState(false),[copyError,setCopyError]=useState('');
 const fullAddress=studioAddress(address);
 async function copy(){setCopying(true);setCopyError('');try{await navigator.clipboard.writeText(fullAddress);setCopied(true)}catch{setCopyError('暫時無法自動複製，請長按地址複製。')}finally{setCopying(false)}}
 return <main className="container page studio-location-page">
  <div className="page-title"><div className="eyebrow">FIND LINYAN</div><h1>工作室地點</h1><p>把路線準備好，安心赴約。</p></div>
  <div className="studio-location-layout">
   <section className="studio-location-card" aria-labelledby="studio-location-title"><span className="studio-location-pin"><MapPin size={28} strokeWidth={1.5}/></span><div className="eyebrow">DOUNAN, YUNLIN</div><h2 id="studio-location-title">琳顏美學</h2><p className="studio-location-caption">為日常，留一點美。</p>
    <div className="studio-address"><span>工作室地址</span><address>{fullAddress}</address></div>
    <div className="studio-location-actions"><a className="button" href={STUDIO_MAP_URL} target="_blank" rel="noopener noreferrer"><Navigation size={18}/>開啟 Google 地圖導航</a><button className="button secondary" type="button" disabled={copying} onClick={()=>void copy()}>{copied?<Check size={17}/>:<Copy size={17}/>}<span aria-live="polite">{copying?'複製中…':copied?'已複製地址':'複製地址'}</span></button></div>{copyError&&<p className="studio-copy-error" role="status">{copyError}</p>}
    <div className="studio-navigation-note"><Navigation size={19}/><div><strong>導航搜尋「{STUDIO_NAVIGATION_NAME}」</strong><p>Google 地圖顯示為「{STUDIO_NAVIGATION_NAME}」，即為琳顏美學所在位置。</p></div></div>
   </section>
   <section className="studio-location-map" aria-label="工作室位置示意圖"><div className="studio-map-heading"><MapPin size={18}/><strong>在地圖上找到我們</strong><a href={STUDIO_MAP_URL} target="_blank" rel="noopener noreferrer" className="text-link">開啟導航 <ArrowRight size={15}/></a></div><a className="studio-map-frame" href={STUDIO_MAP_URL} target="_blank" rel="noopener noreferrer" aria-label="在 Google 地圖查看工作室位置（另開視窗）"><StudioMap/></a><p className="studio-map-caption">周邊位置示意，實際路線請依 Google 地圖導航。</p></section>
  </div>
  <div className="studio-location-bottom"><section className="studio-landmarks"><div className="eyebrow">AROUND THE STUDIO</div><h2><Landmark size={23} strokeWidth={1.5}/>附近地標</h2><div className="studio-landmark-tags"><span>大全聯斗南店</span><span>斗南高級中學</span><span>斗南國民小學</span></div><p>抵達附近後，請依 Google 地圖導航至文化街 14 號。</p></section><section className="studio-arrival"><MessageCircle size={23} strokeWidth={1.5}/><h2>抵達前，需要幫忙嗎？</h2><p>找不到位置或有預約問題，歡迎透過 LINE 聯絡我們。</p><SocialLinks/><a href="#booking" className="text-link">安排你的預約 <ArrowRight size={16}/></a></section></div>
 </main>;
}
