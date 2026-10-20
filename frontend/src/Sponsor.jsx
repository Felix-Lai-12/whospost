import React,{useEffect,useRef} from 'react';
import {analytics} from './analytics.mjs';
import {parseSponsorSlots,sponsorFor,sponsorClickTracking,sponsorImpression} from './sponsor-model.mjs';
const SLOTS=parseSponsorSlots(import.meta.env.VITE_SPONSOR_SLOTS);
export const sponsorConfigured=SLOTS.length>0;
/** One self-hosted sponsor card. Renders nothing (no placeholder) when the slot is not configured. */
export default function SponsorSlot({slot}){
 const sponsor=sponsorFor(SLOTS,slot);const ref=useRef(null);
 useEffect(()=>{
  if(!sponsor||!ref.current)return;
  if(typeof IntersectionObserver!=='function'){sponsorImpression(analytics,sponsor);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){sponsorImpression(analytics,sponsor);observer.disconnect();}},{threshold:.5});
  observer.observe(ref.current);return()=>observer.disconnect();
 },[sponsor?.slot,sponsor?.campaign]);
 if(!sponsor)return null;
 return <aside className={`sponsor sponsor-${slot}`} ref={ref} data-slot={slot} aria-label="贊助內容">
  <span className="sponsor-label">贊助</span>
  <a className="sponsor-link" href={sponsor.href} target="_blank" rel="noopener nofollow sponsored" {...sponsorClickTracking(analytics,sponsor)}>
   <img src={sponsor.image} alt={sponsor.alt} loading="lazy" decoding="async"/>
  </a>
  <p className="sponsor-note">贊助商認養查詢額度，讓 Whospost 免費查詢。與查核結果無關。</p>
 </aside>;
}
