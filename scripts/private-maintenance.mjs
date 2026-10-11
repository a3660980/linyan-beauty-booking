import {createHash,generateKeyPairSync,randomBytes,createCipheriv,createDecipheriv,privateDecrypt,publicEncrypt,constants} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

function seal(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return {iv:iv.toString('base64'),data:Buffer.concat([cipher.update(value),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')}}
function unseal(value,key){const d=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));d.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([d.update(Buffer.from(value.data,'base64')),d.final()])}
function wrappingKey(secret){return createHash('sha256').update('linyan-maintenance-v1:'+secret).digest()}
export function prepare(secret,now=Date.now()){
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 return {publicKey,sealed:seal(Buffer.from(JSON.stringify({privateKey,expiresAt:now+30*60000})),wrappingKey(secret))};
}
export function encrypt(bundle,payload){const key=randomBytes(32);return {bundle,key:publicEncrypt({key:bundle.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),payload:seal(Buffer.from(JSON.stringify(payload)),key)}}
export function decrypt(secret,envelope,now=Date.now()){
 const {privateKey,expiresAt}=JSON.parse(unseal(envelope.bundle.sealed,wrappingKey(secret)).toString());if(expiresAt<=now)throw Error('Maintenance encryption key expired');
 const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.key,'base64'));
 return JSON.parse(unseal(envelope.payload,key).toString());
}
async function main(){
 const token=process.env.CLOUDFLARE_API_TOKEN;if(!token)throw Error('Cloudflare credential is missing');
 const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 if(event.inputs.phase==='prepare'){
  // Only the public key and sealed private key are published; the private key
  // can be recovered solely by a production job with the existing API secret.
  console.log('MAINTENANCE_ENCRYPTION_BUNDLE='+Buffer.from(JSON.stringify(prepare(token))).toString('base64'));return;
 }
 if(event.inputs.phase!=='apply')throw Error('Invalid maintenance phase');
 const payload=decrypt(token,JSON.parse(Buffer.from(event.inputs.request,'base64').toString()));
 if(!Array.isArray(payload.batch)||!payload.batch.length||payload.batch.length>10)throw Error('Invalid maintenance request');
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,db=process.env.CLOUDFLARE_D1_DATABASE_ID;
 if(!account||!db)throw Error('Database binding is missing');
 for(let i=0;i<payload.batch.length;i++){
  const item=payload.batch[i];if(typeof item.sql!=='string'||!Array.isArray(item.params)||!Number.isInteger(item.expectedChanges))throw Error('Invalid maintenance statement');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(db)}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:item.sql,params:item.params})});
  const data=await response.json();if(!response.ok||!data.success||!data.result?.[0]?.success)throw Error('Maintenance database operation failed; no private details are logged');
  const changes=data.result[0].meta?.changes;if(changes!==item.expectedChanges)throw Error('Maintenance write guard did not match; inspect current records privately');
  console.log(`Maintenance statement ${i+1}: verified ${changes} changes`);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(()=>{console.error('Private maintenance failed. Inspect authorization, envelope expiry or guarded record versions.');process.exitCode=1})}
