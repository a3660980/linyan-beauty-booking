export interface Env { DB:D1Database; ASSETS:Fetcher; APP_ORIGIN?:string; LINE_LOGIN_CHANNEL_ID?:string; LINE_LOGIN_CHANNEL_SECRET?:string; LINE_CHANNEL_ACCESS_TOKEN?:string; LINE_CHANNEL_SECRET?:string; LINE_OFFICIAL_ACCOUNT_ID?:string; LINE_ADD_FRIEND_URL?:string; AUTH_SECRET?:string; ADMIN_LINE_USER_IDS?:string; }
export type Session={id:string;name:string;expires:number};
const enc=new TextEncoder();
function base64url(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function decode64(s:string){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}
async function key(secret:string){return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
export async function sign(data:unknown,secret:string){const payload=base64url(enc.encode(JSON.stringify(data)));return `${payload}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(payload))))}`;}
export async function verify<T>(token:string|undefined,secret:string|undefined):Promise<T|null>{if(!token||!secret)return null;try{const [p,s,...rest]=token.split('.');if(rest.length||!p||!s)return null;if(!await crypto.subtle.verify('HMAC',await key(secret),decode64(s),enc.encode(p)))return null;return JSON.parse(new TextDecoder().decode(decode64(p))) as T;}catch{return null;}}
export function cookies(req:Request){return Object.fromEntries((req.headers.get('cookie')||'').split(';').map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1)]}));}
export async function session(req:Request,env:Env){const s=await verify<Session>(cookies(req).linyan_session,env.AUTH_SECRET);return s&&s.expires>Date.now()?s:null;}
export function isAdmin(s:Session|null,env:Env){return !!s&&!!env.ADMIN_LINE_USER_IDS?.split(',').map(x=>x.trim()).filter(Boolean).includes(s.id)}
export function cookie(name:string,value:string,seconds:number,secure=true){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure?'; Secure':''}`;}
export async function validLineSignature(body:string,signature:string|null,secret:string|undefined){if(!signature||!secret)return false;try{return await crypto.subtle.verify('HMAC',await key(secret),Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),enc.encode(body));}catch{return false;}}
export function sameOrigin(req:Request,origin:string){return req.headers.get('origin')===origin;}
