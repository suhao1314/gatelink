 'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
process.env.NODE_ENV = 'test';
const parent = path.resolve(__dirname, '../../99-temp');
fs.mkdirSync(parent, {recursive:true});
const tmp = fs.mkdtempSync(path.join(parent, 'handler-tests-'));
process.env.DATA_DIR=tmp;
process.env.UPLOAD_DIR=path.join(tmp,'uploads');
process.env.QR_DIR=path.join(tmp,'qr');
process.env.DB_FILE=':memory:';
const {getDb,closeDb}=require('../src/db');
const {nowSec,dayStr}=require('../src/util');
const {validShareToken,usableShare}=require('../src/share-policy');
const auth=require('../src/auth');
const merchant=require('../src/handlers-merchant');
const pub=require('../src/handlers-public');
const {todayCountMap,buildStats}=require('../src/stats');
let passed=0;
function check(name,fn) {fn(); passed++; console.log('PASS '+name);}
function response() {return {status:0,body:'',setHeader(){},writeHead(code){this.status=code;},end(body){this.body=String(body||'');}};}
function req(body) {const r=Readable.from([JSON.stringify(body||{})]);r.headers={authorization:'Bearer '+auth.signToken({uid:'u'})};return r;}
async function main(){
 const db=getDb();
 db.prepare('INSERT INTO users(id,openid) VALUES (?,?)').run('u','test-u');
 db.prepare('INSERT INTO users(id,openid) VALUES (?,?)').run('other','test-other');
 for(const [id,owner] of [['c','u'],['foreign','other']]) db.prepare('INSERT INTO campaigns(id,owner_id,slug,name,cover_path,fallback_id) VALUES (?,?,?,?,?,?)').run(id,owner,id,'test','cover.png',id==='c'?'ch':'');
 db.prepare('INSERT INTO channels(id,campaign_id,image_path,expires_at,quota,served_count) VALUES (?,?,?,?,?,?)').run('ch','c','shared.png',1,1,1);
 fs.writeFileSync(path.join(process.env.UPLOAD_DIR,'shared.png'),'fixture');
 for (const [id,v] of [['c',3],['foreign',99]]) db.prepare('INSERT INTO daily_stats(campaign_id,day,visits,uniques) VALUES (?,?,?,?)').run(id,dayStr(nowSec()),v,1);
 check('owner today map isolates campaigns and preserves public shape',()=>assert.deepEqual([...todayCountMap('u')],[['c',{visits:3,uniques:1}]]));
 check('share token bounds',()=>{assert(validShareToken('a'.repeat(20)));assert(!validShareToken('a'.repeat(19)));assert(!validShareToken('../'+ 'a'.repeat(20)));});
 check('share expiry boundary and invalid scope',()=>{assert(!usableShare({enabled:1,scope:'full',expires_at:20},20));assert(usableShare({enabled:1,scope:'summary',expires_at:0},20));assert(!usableShare({enabled:1,scope:'anything',expires_at:0},20));});
 const token='a'.repeat(20);
 db.prepare('INSERT INTO share_links(id,campaign_id,token,scope,expires_at) VALUES (?,?,?,?,?)').run('s','c',token,'summary',nowSec());
 check('expired API share is rejected',()=>{const r=response();pub.handleShareApi({},r,{token});assert.equal(r.status,410);});
 check('expired HTML share is rejected',()=>{const r=response();pub.handleSharePage({},r,{token},{});assert.equal(r.status,404);});
 db.prepare('UPDATE share_links SET expires_at=0 WHERE token=?').run(token);
 db.prepare('INSERT INTO visits(id,campaign_id,source,day) VALUES (?,?,?,?)').run('v','c','PRIVATE_SOURCE',dayStr(nowSec()));
 db.prepare('INSERT INTO visits(id,campaign_id,source,day) VALUES (?,?,?,?)').run('future','c','FUTURE_SOURCE','2099-01-01');
 check('stats excludes future records',()=>assert(!buildStats('c','30d').sources.some(r=>r.key==='FUTURE_SOURCE')));
 check('summary API excludes source breakdown',()=>{const r=response();pub.handleShareApi({},r,{token});assert.equal(r.status,200);assert(!('sources' in JSON.parse(r.body).data.stats));});
 check('summary HTML excludes source breakdown',()=>{const r=response();pub.handleSharePage({},r,{token},{});assert.equal(r.status,200);assert(!r.body.includes('PRIVATE_SOURCE'));});
 for(const body of [{scope:'bad'},{ttlDays:-1},{ttlDays:'3'},{ttlDays:0.5},{ttlDays:null}]) {const r=response();await merchant.handleCreateShare(req(body),r,{id:'c'});check('share input rejects '+JSON.stringify(body),()=>assert.equal(r.status,400));}
 const originalLogin=auth.login;
 auth.login=async()=>{throw new Error('SECRET_INTERNAL_DB_PATH');};
 const login=response();await merchant.handleLogin(req({code:'x'}),login);
 auth.login=originalLogin;
 check('login error hides internals',()=>assert(!login.body.includes('SECRET_INTERNAL_DB_PATH')));
 const copy=response();merchant.handleDuplicateCampaign(req(),copy,{id:'c'});const clone=JSON.parse(copy.body).data.campaign;
 check('duplicate fallback maps to cloned channel',()=>{assert.notEqual(clone.fallbackId,'ch');assert.equal(clone.fallbackId,clone.channels[0].id);});
 merchant.handleDeleteChannel(req(),response(),{id:'ch'});
 check('deleting source channel preserves duplicate image',()=>assert(fs.existsSync(path.join(process.env.UPLOAD_DIR,'shared.png'))));
 merchant.handleDeleteChannel(req(),response(),{id:clone.channels[0].id});
 check('deleting last reference removes image',()=>assert(!fs.existsSync(path.join(process.env.UPLOAD_DIR,'shared.png'))));
 closeDb();console.log('Security handler assertions: '+passed+' passed');
}
main().catch(e=>{console.error(e);closeDb();process.exitCode=1;});
