export function DataLoading({label,compact=false}:{label:string;compact?:boolean}){
 return <div className={'data-loading'+(compact?' compact':'')} role="status" aria-label={label} aria-live="polite"><span className="loading-spinner" aria-hidden="true"/><p>{label}</p></div>;
}
export function DataError({message,onRetry,compact=false}:{message:string;onRetry:()=>void;compact?:boolean}){
 return <div className={'data-error'+(compact?' compact':'')} role="alert"><p>{message}</p><button className="button secondary small" onClick={onRetry}>重新查詢</button></div>;
}
