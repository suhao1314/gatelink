'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert/strict');
const { config, validateConfig } = require('../src/config');
const http = require('../src/http');
const { safeLogTarget, base64url, hmacSign, nowSec } = require('../src/util');
const { verifyToken, signToken } = require('../src/auth');
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS ' + name); }
function response(origin) {
  return { req: { headers: origin === undefined ? {} : { origin } }, headers: {},
    setHeader(k,v) { this.headers[k] = v; }, writeHead(s,h) {this.status=s; Object.assign(this.headers,h);},
    end(body) { this.body=body; } };
}
const allowed = config.allowedOrigins;
config.allowedOrigins = 'https://a.example, https://b.example';
check('CORS chooses exact requested allowed origin', () => {
  const r=response('https://b.example'); http.setCors(r); assert.equal(r.headers['Access-Control-Allow-Origin'],'https://b.example');
});
check('CORS rejects lookalike origin', () => assert.equal(http.isOriginAllowed('https://a.example.evil'),false));
check('native requests without Origin remain allowed', () => assert.equal(http.isOriginAllowed(undefined),true));
check('preflight supplies requested origin and methods', () => {
  const r=response('https://a.example'); http.handleOptions(r); assert.equal(r.status,204);
  assert.match(r.headers['Access-Control-Allow-Methods'],/OPTIONS/); assert.equal(r.headers.Vary,'Origin');
});
check('disallowed origin never gets allow header', () => {const r=response('null');http.setCors(r);assert.equal(r.headers['Access-Control-Allow-Origin'],undefined);});
config.allowedOrigins = allowed;
check('server error hides internal detail', () => {const r=response();http.serverError(r,new Error('secret-file-and-token'));assert.equal(r.body.includes('secret-file-and-token'),false);});
check('JSON response cannot be cached', () => {const r=response();http.ok(r,{token:'dummy'});assert.equal(r.headers['Cache-Control'],'no-store');});
check('authenticated QR buffer cannot enter a shared cache', () => {const r=response();http.sendBuffer(r,Buffer.from('test'),'image/png');assert.equal(r.headers['Cache-Control'],'private, no-store');});
check('share page is not cached', () => {const r=response();http.sendHtml(r,'test');assert.equal(r.headers['Cache-Control'],'no-store');});
for (const target of ['/s/private-token?secret=foo','/api/public/share/private-token','/api/share/private-token','/api/health?token=secret','/untrusted/private-token']) {
  check('logs redact ' + target.split('?')[0], () => {const s=safeLogTarget(target);assert.equal(s.includes('private-token'),false);assert.equal(s.includes('secret'),false);});
}
const prod = {...config,nodeEnv:'production',wxAppId:'test-app',wxSecret:'test-wx-secret',tokenSecret:'x'.repeat(32),visitorSalt:'y'.repeat(32),publicHost:'https://gate.valid.example',allowedOrigins:'https://gate.valid.example'};
check('valid production configuration accepted', () => validateConfig(prod));
for (const bad of [{tokenSecret:'gatelink-local-dev-secret'},{visitorSalt:'short'},{wxSecret:''},{wxAppId:''},{publicHost:'http://gate.valid.example'},{publicHost:'https://gate.example.com'},{publicHost:'https://user:pass@gate.valid.example'},{allowedOrigins:'*'},{allowedOrigins:'https://gate.valid.example/path'},{maxUploadBytes:NaN}]) {
 check('production rejects ' + Object.keys(bad)[0], () => assert.throws(() => validateConfig({...prod,...bad})));
}
function signed(payload) {const b=base64url(JSON.stringify(payload));return b+'.'+base64url(hmacSign(b,config.tokenSecret));}
check('valid login token works', () => assert.equal(verifyToken(signToken({uid:'u_test'})).uid,'u_test'));
for (const payload of [{uid:'u',exp:nowSec()},{uid:'u',exp:'9999999999'},{uid:'u',exp:1e99},{exp:nowSec()+60},['u',nowSec()+60]]) {
 check('reject invalid signed payload', () => assert.equal(verifyToken(signed(payload)),null));
}
check('reject oversized token before processing', () => assert.equal(verifyToken('a'.repeat(4097)),null));
console.log('Transport checks passed: ' + count);
