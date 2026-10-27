// 帳號背景's place beside the name as a flag (Felix 10-24). Threads gives the place as text in the viewer's language
// ("Romania", 「羅馬尼亞」); this maps the names it uses to ISO 3166 codes and the code to its flag emoji. A place not
// in the table is shown as its text. Pure; the engine draws it with the full name as the title.
const NAMES={
 TW:['Taiwan','台灣','臺灣'],CN:['China','Mainland China','中國','中國大陸','中華人民共和國'],HK:['Hong Kong','香港'],MO:['Macau','Macao','澳門'],
 US:['United States','United States of America','USA','美國'],JP:['Japan','日本'],KR:['South Korea','Korea','Republic of Korea','韓國','南韓'],
 SG:['Singapore','新加坡'],MY:['Malaysia','馬來西亞'],TH:['Thailand','泰國'],VN:['Vietnam','Viet Nam','越南'],PH:['Philippines','菲律賓'],
 ID:['Indonesia','印尼','印度尼西亞'],IN:['India','印度'],GB:['United Kingdom','UK','英國'],DE:['Germany','德國'],FR:['France','法國'],
 RO:['Romania','羅馬尼亞'],RU:['Russia','Russian Federation','俄羅斯'],UA:['Ukraine','烏克蘭'],AU:['Australia','澳洲','澳大利亞'],
 CA:['Canada','加拿大'],NZ:['New Zealand','紐西蘭'],MM:['Myanmar','緬甸'],KH:['Cambodia','柬埔寨'],BD:['Bangladesh','孟加拉'],
 PK:['Pakistan','巴基斯坦'],NP:['Nepal','尼泊爾'],LK:['Sri Lanka','斯里蘭卡'],AE:['United Arab Emirates','阿拉伯聯合大公國','阿聯酋'],
 SA:['Saudi Arabia','沙烏地阿拉伯'],IL:['Israel','以色列'],TR:['Turkey','Türkiye','土耳其'],IR:['Iran','伊朗'],EG:['Egypt','埃及'],
 NG:['Nigeria','奈及利亞'],KE:['Kenya','肯亞'],ZA:['South Africa','南非'],IT:['Italy','義大利'],ES:['Spain','西班牙'],PT:['Portugal','葡萄牙'],
 NL:['Netherlands','荷蘭'],BE:['Belgium','比利時'],CH:['Switzerland','瑞士'],AT:['Austria','奧地利'],SE:['Sweden','瑞典'],NO:['Norway','挪威'],
 DK:['Denmark','丹麥'],FI:['Finland','芬蘭'],IE:['Ireland','愛爾蘭'],PL:['Poland','波蘭'],CZ:['Czechia','Czech Republic','捷克'],
 HU:['Hungary','匈牙利'],GR:['Greece','希臘'],BG:['Bulgaria','保加利亞'],RS:['Serbia','塞爾維亞'],BY:['Belarus','白俄羅斯'],
 MX:['Mexico','墨西哥'],BR:['Brazil','巴西'],AR:['Argentina','阿根廷'],CL:['Chile','智利'],CO:['Colombia','哥倫比亞'],PE:['Peru','秘魯']
};
const BY_NAME=new Map(Object.entries(NAMES).flatMap(([code,names])=>names.map(n=>[n.toLowerCase(),code])));
/** The ISO 3166 alpha-2 code for a place name Threads shows, or null. */
export const countryCode=name=>BY_NAME.get(String(name??'').trim().toLowerCase())??null;
/** The name shown for a code from the list: its Chinese name in the table, else its first name; null when unknown. */
export const countryName=code=>{const names=NAMES[code];return names?names.find(n=>/[\u4e00-\u9fff]/.test(n))??names[0]:null;};
/** 🇹🇼 for 'TW': the two regional indicator letters. */
export const flagEmoji=code=>/^[A-Z]{2}$/.test(code??'')?String.fromCodePoint(...[...code].map(c=>0x1f1e6+c.charCodeAt(0)-65)):'';
/** What goes beside the name: {text, title, flag}. The flag when the place is in the table, else the place itself;
 *  null when there is no place. */
export function placeMark(name){
 const place=String(name??'').trim();
 if(!place)return null;
 const code=countryCode(place);
 return code?{text:flagEmoji(code),title:place,flag:true}:{text:place,title:place,flag:false};
}
