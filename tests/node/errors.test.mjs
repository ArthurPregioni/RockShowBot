import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicMessage} from '../../src/server/errors.ts';
test('Only messages written for the user leave the server; transport, parser and database failures get the fallback',()=>{
 const fallback='Não foi possível consultar sua biblioteca Apple Music.';
 assert.equal(publicMessage(new Error('Apple recusou o acesso à biblioteca. Confira sua assinatura e autorize novamente.'),fallback),'Apple recusou o acesso à biblioteca. Confira sua assinatura e autorize novamente.');
 const internal=[new TypeError('fetch failed'),new SyntaxError('Unexpected token < in JSON at position 0'),new DOMException('The operation was aborted due to timeout','TimeoutError'),
  Object.assign(new Error('UNIQUE constraint failed: watch_artists.normalized'),{code:'ERR_SQLITE_ERROR'}),new Error('D1_ERROR: no such table: music_imports'),new Error(''),'text',null,undefined];
 for(const error of internal)assert.equal(publicMessage(error,fallback),fallback);
});
