import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clientIdentity} from '../../deploy/node/proxy-identity.mjs';
test('Public client identity requires loopback, private key and a valid IP',()=>{
 const key='synthetic-proxy-origin-key-for-monitoring';
 const request=(secret=key,ip='203.0.113.9',peer='127.0.0.1')=>({socket:{remoteAddress:peer},headers:{'x-hub-proxy-key':secret,'x-hub-client-ip':ip}});
 assert.equal(clientIdentity(request(),key),'203.0.113.9');
 assert.equal(clientIdentity(request(key,'2001:db8::1'),key),'2001:db8::1');
 for(const secret of ['fake','x'.repeat(600),[key]])assert.equal(clientIdentity(request(secret),key),'127.0.0.1');
 const missing=request();delete missing.headers['x-hub-proxy-key'];assert.equal(clientIdentity(missing,key),'127.0.0.1');
 for(const ip of ['203.0.113.9,1.1.1.1','invalid','127.0.0.1:1234',['203.0.113.9']])assert.equal(clientIdentity(request(key,ip),key),'127.0.0.1');
 assert.equal(clientIdentity(request(key,'203.0.113.9','198.51.100.1'),key),'198.51.100.1');
 assert.equal(clientIdentity(request(),'short'),'127.0.0.1');assert.equal(clientIdentity(request(),undefined),'127.0.0.1');
});
