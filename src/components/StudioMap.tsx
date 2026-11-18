import {useId} from 'react';

// A schematic based on the owner's location card; Google Maps supplies the actual route.
export default function StudioMap(){
 const id=useId();
 const roads=['M-25 145 L730 96','M320 122 L343 324 L370 465 L416 700','M-20 506 L720 408','M124 488 L194 700','M404 458 L458 700','M0 224 L166 206 L184 320 L0 350','M394 190 L574 170 L589 280 L710 262','M460 356 L679 330 L639 408','M-15 588 L186 548','M236 580 L437 545','M461 591 L716 545'];
 return <svg className="studio-schematic" viewBox="0 0 700 650" role="img" aria-labelledby={id+'-title '+id+'-desc'}>
  <title id={id+'-title'}>琳顏美學工作室周邊位置示意</title><desc id={id+'-desc'}>工作室位於文化街14號，鄰近建國一路、大全聯斗南店、斗南高級中學與斗南國民小學。此圖為周邊示意，實際路線請使用 Google 地圖導航。</desc>
  <rect width="700" height="650" fill="#f2e6d9"/>
  <path d="M-20 55 Q150 43 335 64 T720 27" fill="none" stroke="#fffaf5" strokeWidth="38"/>
  <path d="M-20 55 Q150 43 335 64 T720 27" fill="none" stroke="#acd0db" strokeWidth="23"/>
  <g fill="none" strokeLinecap="round" strokeLinejoin="round">{roads.map((d,i)=><g key={i}><path d={d} stroke="#fffaf5" strokeWidth={i<5?35:23}/><path d={d} stroke="#decbb7" strokeWidth={i<5?19:9}/></g>)}</g>
  <g className="studio-map-road-labels" fill="#705d4f" stroke="#fffaf5" strokeWidth="7" paintOrder="stroke" fontSize="24" fontWeight="500"><text x="480" y="48" fill="#4d7b91">石牛溪</text><text x="95" y="126" transform="rotate(-4 95 126)">建國一路</text><text x="306" y="220" transform="rotate(83 306 220)">文化街</text><text x="172" y="468" transform="rotate(-8 172 468)">順安街350巷</text><text x="149" y="555" transform="rotate(73 149 555)">中山路</text><text x="400" y="509" fontSize="21" transform="rotate(77 400 509)">中山路210巷</text></g>
  <g transform="translate(215 300)"><circle r="24" fill="#7c96a0" stroke="#fffaf5" strokeWidth="4"/><path d="M-12-9h4l4 16h14l4-12H-6M-2 13h1m8 0h1" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"/><text x="-35" y="-10" textAnchor="end" fontSize="23" fill="#567684">大全聯</text><text x="-35" y="18" textAnchor="end" fontSize="23" fill="#567684">斗南店</text></g>
  <g transform="translate(98 412)"><circle r="23" fill="#a29380" stroke="#fffaf5" strokeWidth="4"/><path d="m-15-4 15-9L15-4 0 5Z M-10 3v9m20-9v9M-9 9q9 6 18 0" stroke="white" strokeWidth="2" fill="none"/><text x="0" y="48" textAnchor="middle" fontSize="22" fill="#6d5a4d">斗南高級中學</text></g>
  <g transform="translate(550 523)"><circle r="23" fill="#a29380" stroke="#fffaf5" strokeWidth="4"/><path d="m-15-4 15-9L15-4 0 5Z M-10 3v9m20-9v9M-9 9q9 6 18 0" stroke="white" strokeWidth="2" fill="none"/><text x="0" y="48" textAnchor="middle" fontSize="22" fill="#6d5a4d">斗南國民小學</text></g>
  <ellipse cx="364" cy="358" rx="30" ry="8" fill="#b8967d" opacity=".35"/>
  <path d="M364 357s-40-45-40-72a40 40 0 0 1 80 0c0 27-40 72-40 72Z" fill="#9b665b" stroke="#fffaf5" strokeWidth="5"/><circle cx="364" cy="284" r="15" fill="#fffaf5"/>
  <rect x="414" y="262" width="240" height="92" rx="22" fill="#fffaf5" stroke="#d8c1ac" strokeWidth="2"/><text x="534" y="300" textAnchor="middle" fill="#805c54" fontSize="29" fontWeight="500">琳顏美學</text><text x="534" y="331" textAnchor="middle" fill="#897567" fontSize="22">文化街 14 號</text>
  <text x="667" y="623" textAnchor="end" fill="#a18a77" fontSize="17" letterSpacing="3">LOCATION GUIDE</text>
 </svg>;
}
