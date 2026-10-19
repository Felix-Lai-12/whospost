// PNG rendering for preview cards: workers-og (satori layout, resvg-wasm raster) with a Noto Sans TC subset
// (Big5 common characters, ASCII and punctuation; see scripts/og-font-subset.sh). Characters outside the subset
// show as blanks. Only the OG image Durable Object imports this; it needs the Workers runtime.
import {ImageResponse} from 'workers-og';
import {cardElement} from './og-card.mjs';
import regular from './og/NotoSansTC-Regular-subset.otf';
import bold from './og/NotoSansTC-Bold-subset.otf';
const fonts=[{name:'Noto Sans TC',data:regular,weight:400,style:'normal'},{name:'Noto Sans TC',data:bold,weight:700,style:'normal'}];
export const renderCard=card=>new ImageResponse(cardElement(card),{width:1200,height:630,fonts}).arrayBuffer();
