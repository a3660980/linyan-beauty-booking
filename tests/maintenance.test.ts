import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The standalone CI utility intentionally runs as JavaScript.
import {prepare,encrypt,decrypt,diagnosticRead,decryptReply} from '../scripts/private-maintenance.mjs';
test('private maintenance encrypts all customer details and only the deployment secret decrypts an unexpired envelope',()=>{
 const now=100000,secret='test-only cloudflare token',bundle=prepare(secret,now),payload={batch:[{sql:'UPDATE test SET value=?',params:['私人測試資料'],expectedChanges:1}]};
 const envelope=encrypt(bundle,payload),encoded=JSON.stringify(envelope);
 assert.ok(!encoded.includes('私人測試資料'));assert.ok(!encoded.includes('UPDATE'));assert.ok(!encoded.includes('PRIVATE KEY'));assert.ok(!encoded.includes(secret));
 assert.deepEqual(decrypt(secret,envelope,now+1000),payload);
 assert.throws(()=>decrypt('wrong test credential',envelope,now+1000));assert.throws(()=>decrypt(secret,envelope,now+30*60000),/expired/);
 envelope.payload.data=envelope.payload.data.slice(0,-4)+'AAAA';assert.throws(()=>decrypt(secret,envelope,now+1000));
});

test('private diagnostics reject writes and encrypt bounded query results only for the requester',async()=>{
 const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),payload={mode:'read',replyPublicKey:pair.publicKey,reads:[{sql:'SELECT status FROM bookings WHERE id=?',params:['test-booking']}]};let calls=0;
 const query=async()=>{calls++;return {meta:{changes:0},results:[{status:'confirmed',customer:'私人測試客人'}]}};
 const encrypted=await diagnosticRead(payload,query);assert.equal(calls,1);assert.ok(!JSON.stringify(encrypted).includes('私人測試客人'));assert.deepEqual(decryptReply(pair.privateKey,encrypted),{results:[[{status:'confirmed',customer:'私人測試客人'}]]});
 for(const sql of ['DELETE FROM bookings','SELECT 1; DELETE FROM bookings','WITH gone AS (DELETE FROM bookings) SELECT 1'])await assert.rejects(diagnosticRead({...payload,reads:[{sql,params:[]}]},query),/Read-only/);assert.equal(calls,1);
 await assert.rejects(diagnosticRead(payload,async()=>({meta:{changes:1},results:[]})),/bounds/);await assert.rejects(diagnosticRead(payload,async()=>({meta:{changes:0},results:Array.from({length:101},()=>({status:'confirmed'}))})),/bounds/);
});
