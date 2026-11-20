import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
// auth.ts imports two framework modules only to load; the path helpers under test are pure.
const stub='data:text/javascript,'+encodeURIComponent('export const headers=async()=>new Headers();export const redirect=()=>{};');
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(specifier,context,next){return specifier==='next/headers'||specifier==='next/navigation'?{url:${JSON.stringify(stub)},shortCircuit:true}:next(specifier,context);}`));
const {chatGPTSignInPath,chatGPTSignOutPath}=await import('../../src/server/auth.ts');
const returned=path=>new URL(path,'https://app.local').searchParams.get('return_to');
test('Sign-in and sign-out return paths never leave the site',()=>{
 assert.equal(returned(chatGPTSignInPath('/music/browser-import?x=1#top')),'/music/browser-import?x=1#top');
 for(const value of ['/.//evil.example','/x/..//evil.example/login','/.\\/evil.example','/./\\evil.example','//evil.example','https://evil.example/','/signin-with-chatgpt','/callback']){
  for(const build of [chatGPTSignInPath,chatGPTSignOutPath])assert.equal(returned(build(value)),'/');
 }
});
