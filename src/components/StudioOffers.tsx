import {ArrowRight,Gift,Heart} from 'lucide-react';
import {offers} from '../studioContent';
export default function StudioOffers({compact=false}:{compact?:boolean}){
 return <section className={'studio-offers'+(compact?' compact-offers':'')}>
  <div className="section-heading"><div><div className="eyebrow">LITTLE TREATS FOR YOU</div><h2>把美好分享，留一份小禮。</h2><p>給分享日常的你，也給生日當月的你。</p></div>{compact&&<a className="text-link" href="#offers">查看活動說明 <ArrowRight size={16}/></a>}</div>
  <div className="offer-cards">{offers.map((offer,i)=><article className="offer-card" key={offer.title}>{i===0?<Heart size={25} strokeWidth={1}/>:<Gift size={25} strokeWidth={1}/>}<div className="eyebrow">{offer.eyebrow}</div><h3>{offer.title}</h3><p>{offer.description}</p><small>{offer.detail}</small></article>)}</div>
  <p className="offers-combine">可與兩人同行等其他優惠併用，折抵資格與最終金額由店家核對。</p>
  {!compact&&<details className="original-menu"><summary>查看原始活動公告</summary><img loading="lazy" src="/assets/studio-offers.jpg" alt="琳顏美學限動分享折抵與生日購物金原始活動公告"/></details>}
 </section>;
}
