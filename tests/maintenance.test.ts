import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The standalone CI utility intentionally runs as JavaScript.
import {prepare,encrypt,decrypt} from '../scripts/private-maintenance.mjs';
test('private maintenance encrypts all customer details and only the deployment secret decrypts an unexpired envelope',()=>{
 const now=100000,secret='test-only cloudflare token',bundle=prepare(secret,now),payload={batch:[{sql:'UPDATE test SET value=?',params:['私人測試資料'],expectedChanges:1}]};
 const envelope=encrypt(bundle,payload),encoded=JSON.stringify(envelope);
 assert.ok(!encoded.includes('私人測試資料'));assert.ok(!encoded.includes('UPDATE'));assert.ok(!encoded.includes('PRIVATE KEY'));assert.ok(!encoded.includes(secret));
 assert.deepEqual(decrypt(secret,envelope,now+1000),payload);
 assert.throws(()=>decrypt('wrong test credential',envelope,now+1000));assert.throws(()=>decrypt(secret,envelope,now+30*60000),/expired/);
 envelope.payload.data=envelope.payload.data.slice(0,-4)+'AAAA';assert.throws(()=>decrypt(secret,envelope,now+1000));
});
