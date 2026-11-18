// Public studio details shared by the website and customer confirmation messages.
export const STUDIO_ADDRESS='63044 雲林縣斗南鎮西岐里文化街14號';
export const STUDIO_NAVIGATION_NAME='朵漾美學工作室';
export const STUDIO_MAP_URL='https://maps.app.goo.gl/AszXJuSH4ehnw9Jq7?g_st=ic';
export function studioAddress(address?:string){return address?.trim()||STUDIO_ADDRESS}
export function studioLocationText(address?:string){return `工作室地址：${studioAddress(address)}\n導航名稱：${STUDIO_NAVIGATION_NAME}（琳顏美學）\nGoogle 地圖：${STUDIO_MAP_URL}`}
