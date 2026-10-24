import {
  measureSearchAnchor,
  restoreSearchAnchor,
} from "../src/client/search/scroll-anchor.js";

export const searchHistoryProofScript = `
(async()=>{
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const evidence=JSON.parse(document.querySelector('#search-history-evidence').textContent);
const standIn=window.__searchHistoryStandIn===true;
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const measure=${measureSearchAnchor.toString()};
const restore=${restoreSearchAnchor.toString()};
assert(innerWidth===evidence.width,'Wrong search history viewport');
const panel=document.querySelector('#search-panel');
const viewport=panel?.querySelector('#search-results');
assert(panel&&viewport,'Missing actual search surface');
const dialog=document.querySelector('#phone-search-dialog');
if(evidence.width===390){
 assert(dialog,'Phone search dialog missing');
 if(standIn)dialog.setAttribute('open','');else dialog.showModal();
}
await frame();
viewport.scrollTop=440;
await frame();
const history=viewport.querySelector('[data-search-history-controls]');
assert(history&&viewport.firstElementChild===history,'Older controls are not at the top of the actual search results');
const anchor=measure(document);
assert(anchor,'No initial visible search anchor');
const oldKeys=[...viewport.querySelectorAll('[data-search-event]')].map(row=>row.dataset.searchEvent);
assert(oldKeys.length===20,'Wrong initial result recipient');
window.__searchHistoryEvidence={geometry:standIn?'DOMRect stand-in':'native browser',before:anchor,scene:evidence.scene};
window.__loadSearchHistory=async()=>{
 const latest=measure(document);
 assert(latest,'No latest visible row before page merge');
 const topHeightBefore=viewport.querySelector('[data-search-history-controls]').getBoundingClientRect().height;
 assert(latest.position>0,'History arrival is not tested mid-list');
 viewport.innerHTML=document.querySelector('#search-history-after').content.querySelector('#search-results').innerHTML;
 await frame();
 restore(document,latest);
 await frame();
 const restored=[...viewport.querySelectorAll('[data-search-event],#search-today')].find(row=>(row.dataset.searchEvent??row.id)===latest.key);
 assert(restored,'Existing visible row disappeared');
 const afterOffset=restored.getBoundingClientRect().top-viewport.getBoundingClientRect().top;
 assert(Math.abs(afterOffset-latest.offset)<=0.5,'Older arrival shifted the visible row');
 const keys=[...viewport.querySelectorAll('[data-search-event]')].map(row=>row.dataset.searchEvent);
 assert(oldKeys.every(key=>keys.includes(key)),'Older merge lost existing results');
 assert(keys.length===evidence.afterRows&&new Set(keys).size===keys.length,'Wrong merged result identity/count');
 const footer=viewport.querySelector('[data-search-page-controls]');
 const top=viewport.querySelector('[data-search-history-controls]');
 assert(top&&viewport.firstElementChild===top,'Older controls moved below the dated results');
 assert(top.getAttribute('role')==='status'&&top.getAttribute('aria-live')==='polite','Older region lost its polite status');
 assert(footer&&!/older|Searched back/i.test(footer.textContent),'Older-direction UI leaked into the forward footer');
 assert(!top.textContent.includes('Loading older results'),'History left an endless spinner');
 const topHeightAfter=top.getBoundingClientRect().height;
 const horizon=top.querySelector('[data-search-history-horizon]');
 assert(!!horizon===(evidence.scene==='horizon'),'Wrong history horizon state');
 if(horizon){
  assert(horizon.textContent==='Searched back to Oct 2016','Horizon hides how far back search went');
  assert(Math.abs(topHeightAfter-topHeightBefore)>0.5,'Horizon proof did not change the top container height');
 }
 if(evidence.width===390){
  assert(dialog.open,'Phone search dialog closed');
  const box=viewport.getBoundingClientRect();
  assert(box.left>=-0.5&&box.right<=innerWidth+0.5,'Phone search viewport escapes its dialog');
 }
 assert(document.documentElement.scrollWidth<=innerWidth+1,'Search history page overflows');
 window.__searchHistoryEvidence={...window.__searchHistoryEvidence,before:latest,afterOffset,afterScrollTop:viewport.scrollTop,topHeightBefore,topHeightAfter,footerHasOlder:false,rows:keys.length,horizon:horizon?.textContent??null};
 document.documentElement.dataset.searchHistoryProof=standIn?'stand-in':'browser';
 return window.__searchHistoryEvidence;
};
window.__searchHistoryReady=true;
document.documentElement.dataset.fixtureReady='search-history';
})().catch(error=>{window.__searchHistoryError=String(error);throw error});
`;
