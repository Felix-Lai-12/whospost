import React,{useEffect,useRef} from 'react';
import {analytics} from './analytics.mjs';
import {parseSponsorSlots,sponsorFor,sponsorClickTracking,sponsorImpression} from './sponsor-model.mjs';
const SLOTS=parseSponsorSlots(import.meta.env.VITE_SPONSOR_SLOTS);
export const sponsorConfigured=SLOTS.length>0;
/** One self-hosted sponsor card. Renders nothing (no placeholder) when the slot is not configured (VITE_SPONSOR_SLOTS=[]). */
export default function SponsorSlot({slot}){
 const sponsor=sponsorFor(SLOTS,slot);const ref=useRef(null);
 useEffect(()=>{
  if(!sponsor||!ref.current)return;
  if(typeof IntersectionObserver!=='function'){sponsorImpression(analytics,sponsor);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){sponsorImpression(analytics,sponsor);observer.disconnect();}},{threshold:.5});
  observer.observe(ref.current);return()=>observer.disconnect();
 },[sponsor?.slot,sponsor?.campaign]);
 if(!sponsor)return null;
 const tracking=sponsorClickTracking(analytics,sponsor);
 if(sponsor.kind==='text')return <aside className={`sponsor sponsor-${slot} sponsor-text`} ref={ref} data-slot={slot} aria-label="贊助內容">
  <span className="sponsor-label">贊助</span>
  <p className="sponsor-copy">{sponsor.text}</p>
  <a className="sponsor-cta" href={sponsor.href} target="_blank" rel="noopener nofollow sponsored" {...tracking}>{sponsor.cta}<span aria-hidden="true"> →</span></a>
 </aside>;
 return <aside className={`sponsor sponsor-${slot}`} ref={ref} data-slot={slot} aria-label="贊助內容">
  <span className="sponsor-label">贊助</span>
  <a className="sponsor-link" href={sponsor.href} target="_blank" rel="noopener nofollow sponsored" {...tracking}>
   <img src={sponsor.image} alt={sponsor.alt} loading="lazy" decoding="async"/>
  </a>
  <p className="sponsor-note">贊助商認養查詢額度，讓 Whospost 免費查詢。與查核結果無關。</p>
 </aside>;
}
