// Which fetch provider a deployment uses, read from its vars. Shared by the request gate (app.mjs: configured,
// worst-case estimate, whether Apify's monthly usage matters) and the scan job (index.mjs: the options passed
// to fetchAccount). `launch` is the Worker's `()=>puppeteer.launch(env.BROWSER)`; the gate passes none and only
// needs to know whether the binding exists.
import {createBrowserFetcher} from '../server/providers/browser.mjs';
import {BROWSER_CAP_USD} from '../server/providers/index.mjs';
export function fetchProviderOptions(env,{launch=null}={}){
 const provider=env.WHOSPOST_FETCH_PROVIDER==='browser'?'browser':'apify';
 const fallback=env.WHOSPOST_BROWSER_FALLBACK==='fail'?'fail':'apify';
 const minPosts=Math.max(0,Number(env.WHOSPOST_BROWSER_MIN_POSTS??1)||0);
 const postPages=Math.min(3,Math.max(0,Number(env.WHOSPOST_BROWSER_POST_PAGES??0)||0));
 const usesBrowser=provider==='browser',usesApify=provider==='apify'||fallback==='apify';
 const browserConfigured=Boolean(env.BROWSER),apifyConfigured=Boolean(env.APIFY_TOKEN);
 return {
  provider,fallback,minPosts,usesBrowser,usesApify,
  // New scans open only when every provider the deployment may call is set up.
  configured:(usesBrowser?browserConfigured:true)&&(usesApify?apifyConfigured:true),
  /** Worst case one scan may reserve: the browser round's cap plus, when Apify may run (as provider or fallback), the Apify caps. */
  estimateUsd:apifyEstimateUsd=>usesApify?apifyEstimateUsd+(usesBrowser?BROWSER_CAP_USD:0):BROWSER_CAP_USD,
  /** Options for fetchAccount; the browser fetcher exists only when launch() is available. */
  fetchOptions:()=>({browser:usesBrowser&&launch?createBrowserFetcher({launch,postPages}):null,fallback,minPosts})
 };
}
