import {useState} from 'react';
import {bookingNotes,browsBefore,browsAfter,lashesBefore,lashesAfter} from '../studioContent';
import type {Settings} from '../domain';
import StudioOffers from './StudioOffers';
type Category='booking'|'lashes'|'brows';
function Notes({title,items}:{title:string;items:string[]}){return <section className="care-section"><h2>{title}</h2><ol className="care-list">{items.map(item=><li key={item}>{item}</li>)}</ol></section>}
function Poster({type,when}:{type:'lashes'|'brows';when:'before'|'after'}){const title=`${type==='lashes'?'美睫':'霧眉'}${when==='before'?'施作前':'施作後'}注意事項`;return <details className="original-menu"><summary>查看原始{title}</summary><img loading="lazy" src={`/assets/${type}-${when}care.jpg`} alt={`琳顏美學${title}原始公告`}/></details>}
export default function StudioPolicies({settings,initialCategory='booking'}:{settings:Settings;initialCategory?:Category}){
 const [category,setCategory]=useState<Category>(initialCategory);
 return <main className="container page narrow"><div className="page-title"><div className="eyebrow">BEFORE & AFTER YOUR VISIT</div><h1>預約與保養須知</h1><p>預約前讀一讀，讓每次相遇都更從容。</p></div>
  <div className="tabs care-tabs">{([['booking','預約須知'],['lashes','美睫須知'],['brows','霧眉須知']] as const).map(([id,name])=><button key={id} className={category===id?'active':''} aria-pressed={category===id} onClick={()=>setCategory(id)}>{name}</button>)}</div>
  <div className="policy-content">
   {category==='booking'?<><Notes title="預約、訂金與付款" items={bookingNotes}/><section className="care-section"><h2>取消與改期</h2><p>可於預約前 {settings.cancelHours} 小時以上在線上取消。改期請取消後重新申請，或透過 LINE 聯絡店家。已過取消期限，請直接聯絡店家。</p></section>{settings.policies&&<section className="care-section"><h2>店家補充須知</h2><p className="pre-wrap">{settings.policies}</p></section>}<section className="care-section"><h2>補睫、補色與同行優惠</h2><p>兩週內補睫限原款式半價；霧眉三個月內補色免費。兩人同行霧眉每人折 $500，每位 NT$4,500，兩位需分別安排時段。優惠資格、同行者取消後的優惠與無創除色金額，由店家核對。</p></section><StudioOffers/><section className="care-section"><h2>資料使用說明</h2><p>姓名、電話、LINE 使用者識別碼與預約紀錄，僅用於預約管理、聯繫及服務資格核對。資料保存在受管理的資料庫，客人只可查看自己的預約。若需更正或刪除資料，請聯絡店家。</p></section></>:category==='lashes'?<><Notes title="嫁接睫毛・施作前" items={lashesBefore}/><Poster type="lashes" when="before"/><Notes title="嫁接睫毛・施作後" items={lashesAfter}/><Poster type="lashes" when="after"/></>:<><Notes title="霧眉・施作前" items={browsBefore}/><Poster type="brows" when="before"/><Notes title="霧眉・施作後" items={browsAfter}/><Poster type="brows" when="after"/></>}
  </div>
 </main>;
}
