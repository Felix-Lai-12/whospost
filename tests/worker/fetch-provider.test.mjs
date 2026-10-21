import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchProviderOptions} from '../../worker/fetch-provider.mjs';
import {BROWSER_CAP_USD} from '../../server/providers/index.mjs';
test('apify (the default): configured by the token alone, estimate is the Apify caps, no browser fetcher',()=>{
 const o=fetchProviderOptions({APIFY_TOKEN:'t'});
 assert.deepEqual([o.provider,o.usesBrowser,o.usesApify,o.configured,o.estimateUsd(.13)],['apify',false,true,true,.13]);
 assert.equal(fetchProviderOptions({}).configured,false);
 assert.deepEqual(o.fetchOptions(),{browser:null,fallback:'apify',minPosts:1});
});
test('browser with fallback apify needs the binding and the token, and includes browser cost plus the Apify fallback caps',()=>{
 const env={WHOSPOST_FETCH_PROVIDER:'browser',BROWSER:{},APIFY_TOKEN:'t'};
 const o=fetchProviderOptions(env,{launch:async()=>({})});
 assert.deepEqual([o.provider,o.fallback,o.usesBrowser,o.usesApify,o.configured,o.estimateUsd(.13)],['browser','apify',true,true,true,.13+BROWSER_CAP_USD]);
 assert.equal(typeof o.fetchOptions().browser,'function');assert.equal(o.fetchOptions().minPosts,1);
 assert.equal(fetchProviderOptions({...env,APIFY_TOKEN:''}).configured,false,'the fallback must be able to run');
 assert.equal(fetchProviderOptions({...env,BROWSER:undefined}).configured,false);
 assert.equal(fetchProviderOptions(env).fetchOptions().browser,null,'no launch, no fetcher (the gate never fetches)');
});
test('browser with fallback fail needs only the binding; the estimate is the browser cap; minPosts and post pages are bounded',()=>{
 const o=fetchProviderOptions({WHOSPOST_FETCH_PROVIDER:'browser',WHOSPOST_BROWSER_FALLBACK:'fail',BROWSER:{},WHOSPOST_BROWSER_MIN_POSTS:'3',WHOSPOST_BROWSER_POST_PAGES:'9'});
 assert.deepEqual([o.fallback,o.usesApify,o.configured,o.estimateUsd(.13)],['fail',false,true,BROWSER_CAP_USD]);
 assert.equal(o.fetchOptions().minPosts,3);
 assert.equal(fetchProviderOptions({WHOSPOST_BROWSER_MIN_POSTS:'abc'}).fetchOptions().minPosts,0);
});
