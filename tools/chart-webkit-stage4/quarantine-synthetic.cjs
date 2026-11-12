'use strict';
// In-memory synthetic transport only. No access control or durable storage claim.
const crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function pack(raw,key,expected){
  if(!Buffer.isBuffer(raw)||!Buffer.isBuffer(key)||key.length!==32||!/^([a-f0-9]{64})$/.test(expected||'')||hash(raw)!==expected)throw Error('hash_or_manifest_invalid');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(raw),cipher.final()]);
  return {iv,data,tag:cipher.getAuthTag(),sha256:expected};
}
function verify(box,key){
  try{if(!box||!/^([a-f0-9]{64})$/.test(box.sha256||''))throw Error();const cipher=crypto.createDecipheriv('aes-256-gcm',key,box.iv);cipher.setAuthTag(box.tag);const raw=Buffer.concat([cipher.update(box.data),cipher.final()]);if(hash(raw)!==box.sha256)throw Error();return {transfer:'SIMULATED',readbackHash:'PASS',privateIsolation:'UNKNOWN',durableStorage:'UNKNOWN'};}catch(_){return {transfer:'UNKNOWN',readbackHash:'FAIL',privateIsolation:'UNKNOWN',durableStorage:'UNKNOWN'};}
}
module.exports={pack,verify,hash};
