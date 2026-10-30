import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredOrigin} from '../../src/core/config.ts';

test('Every installation uses its own configured origin; production has no author fallback',()=>{
  assert.equal(configuredOrigin('https://radar.example/'),'https://radar.example');
  assert.equal(configuredOrigin(undefined,true),'http://localhost:5173');
  assert.equal(configuredOrigin('http://127.0.0.1:5173',true),'http://127.0.0.1:5173');
  for(const value of [undefined,'','http://radar.example','http://localhost:5173','https://user:pass@radar.example','https://radar.example/path','https://radar.example/?token=bad','https://radar.example/#bad']) {
    assert.throws(()=>configuredOrigin(value));
  }
});
