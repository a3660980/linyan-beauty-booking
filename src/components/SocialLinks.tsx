import {AtSign,Facebook,Instagram,MessageCircle} from 'lucide-react';

const links=[
 {name:'LINE 官方帳號',url:'https://line.me/R/ti/p/@400cwhyf',Icon:MessageCircle},
 {name:'Instagram',url:'https://www.instagram.com/linyan_beauty',Icon:Instagram},
 {name:'Facebook',url:'https://www.facebook.com/share/1Drjm3Rbau/?mibextid=wwXIfr',Icon:Facebook},
 {name:'Threads',url:'https://www.threads.com/@linyan_beauty',Icon:AtSign}
];

export default function SocialLinks({lineAddFriend=false}:{lineAddFriend?:boolean}){
 return <nav className="social-links" aria-label="琳顏美學社群">{links.map(({name,url,Icon})=>lineAddFriend&&name==='LINE 官方帳號'?<a key={name} className="line-add-friend" href="https://lin.ee/wQSY8LJ" target="_blank" rel="noopener noreferrer" aria-label="加入 LINE 官方帳號好友（另開視窗）"><img src="https://scdn.line-apps.com/n/line_add_friends/btn/zh-Hant.png" alt="加入好友" width={116} height={36}/></a>:<a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={name+'（另開視窗）'}><Icon size={16} aria-hidden="true"/>{name}</a>)}</nav>;
}
