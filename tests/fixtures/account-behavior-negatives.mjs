// Deliberately wrong interpretations with valid citations. Not model outputs.
import {makeAccountBehaviorCases} from '../../scripts/preview-account-behavior.mjs';
export function makeBehaviorSemanticNegatives(){
 const base=()=>structuredClone(makeAccountBehaviorCases()[0]);
 const cases=[];
 let c=base();
 c.input.evidence.forEach(e=>e.parentText=null);
 c.expected.findings[0].interpretation='每次回覆都切合原串，已確認是有來有往的對話。';
 cases.push({id:'missing-parent-certainty',problem:'沒有原串卻聲稱已核對切題',...c});
 c=base();c.expected.findings[0].alternative='帳號名稱前綴相似，也可能是同一人持有的分身。';
 cases.push({id:'operator-from-handle',problem:'加上可能仍沒有經營者關係證據',...c});
 c=base();c.expected.assessment='suspicious_behavior_observed';c.expected.findings[0].judgment='concern';
 c.expected.findings[0].interpretation='作者為了刷高曝光與互動而刻意安排這些回覆。';
 cases.push({id:'intent-from-activity',problem:'將活動直接當作者動機',...c});
 c=base();c.expected.findings[0].interpretation='早年留言與近期貼文顯示同一波活動的完整轉變。';
 cases.push({id:'cross-window-transition',problem:'缺少連續歷史卻合併活動期間',...c});
 return cases;
}
