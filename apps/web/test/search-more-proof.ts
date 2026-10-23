import { runInNewContext } from "node:vm";

export const searchMoreProofScript = `
const evidence=JSON.parse(document.querySelector('#search-more-evidence').textContent);
const assert=(condition,message)=>{if(!condition)throw Error(message)};
assert(innerWidth===evidence.width,'Wrong viewport width');
const panel=document.querySelector('#search-panel');
const results=panel?.querySelector('#search-results');
const controls=results?.querySelector('[data-search-page-controls="true"]');
assert(panel&&results&&controls,'Missing actual search recipient');
assert(controls.getAttribute('role')==='status'&&controls.getAttribute('aria-live')==='polite','Search footer is not a polite status region');
const rows=[...results.querySelectorAll('[data-search-event]')];
assert(rows.length===evidence.rowCount&&rows.length>0,'Earlier search page was lost');
assert(new Set(rows.map(row=>row.dataset.searchEvent)).size===rows.length,'Duplicate search rows');
assert(rows.some(row=>row.textContent.includes('Planning outside this week')),'Original page title disappeared');
const retries=[...results.querySelectorAll('[data-search-retry-calendar]')];
const buttons=[...controls.querySelectorAll('button'),...retries];
const more=buttons.find(button=>button.textContent==='Load more');
const loading=evidence.scenario==='loading-more';
const exhausted=evidence.scenario==='exhausted';
const partial=evidence.scenario==='partial-failure';
assert(!!more===(!exhausted&&!partial),'Wrong Load more availability');
if(more)assert(more.disabled===loading,'Wrong outstanding-request guard');
assert(controls.textContent.includes('Loading more')===loading,'Wrong pending status');
assert(controls.textContent.includes('No more results')===exhausted,'Wrong exhaustion status');
assert(retries.length===(partial?1:0),'Missing failed-calendar retry');
for(const retry of retries){
 assert(retry.textContent==='Retry','Wrong visible calendar retry copy');
 assert(retry.getAttribute('aria-label')==='Retry Work (owner@example.test)','Calendar retry lacks account-qualified name');
 assert(retry.previousElementSibling?.textContent==="Couldn't load more from Work (owner@example.test).",'Retry is detached from its failure line');
 assert(retry.closest('[data-search-page-controls]')===controls,'Continuation failure is outside the footer');
 assert(retry.parentElement?.dataset.searchFailure==='true','Retry is outside its failure recipient');
}
assert(controls.textContent.includes("Some older results aren't shown."),'Older bounded history was mislabeled');
assert(!!results.querySelector('[data-search-failure="true"]')===partial,'Wrong partial failure copy');
assert(!results.textContent.includes('Fake fixture page failure'),'Raw provider failure leaked');
assert(!controls.querySelector('[autofocus]'),'Continuation steals focus');
const prior=document.activeElement;
for(const button of buttons){
 if(button.disabled)continue;
 button.focus();
 assert(document.activeElement===button,'Search page action is not focusable');
 const rect=button.getBoundingClientRect();
 assert(rect.width>0&&rect.height>0&&rect.left>=-1&&rect.right<=innerWidth+1,'Search page action clips horizontally');
}
document.activeElement?.blur();prior?.focus();
assert(document.documentElement.scrollWidth<=innerWidth+1,'Search page overflow');
document.documentElement.dataset.searchMoreProof='pass';
`;

export const executeSearchMoreProofWithStandInBoxes = (
  html: string,
  width: number
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '#search-results [data-search-page-controls="true"] button'
  )) {
    button.focus = () => {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: button,
      });
    };

    button.blur = () => {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: document.body,
      });
    };

    button.getBoundingClientRect = () => new DOMRect(20, 100, width - 40, 36);
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });

  const script = document.querySelector(
    "script[data-search-more-proof]"
  )?.textContent;

  if (script === null || script === undefined) {
    throw new Error("Missing exact exported search-more proof");
  }

  runInNewContext(script, { document, innerHeight: 960, innerWidth: width });

  if (document.documentElement.dataset.searchMoreProof !== "pass") {
    throw new Error("Search-more proof did not finish");
  }

  return document;
};
