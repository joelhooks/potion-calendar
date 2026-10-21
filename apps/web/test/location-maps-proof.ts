import { runInNewContext } from "node:vm";

export const locationMapsProofScript = `
const e=JSON.parse(document.querySelector('#maps-evidence').textContent);
const assert=(ok,message)=>{if(!ok)throw Error(message)};
assert(e.loaded&&e.person&&e.location==='123 Main Street, San Francisco & café #4','Missing loaded location precondition');
const apple=e.scenario!=='non-apple';
assert(['userAgentData','navigator.platform'].includes(e.platform.source),'Missing platform source');
const detected=e.platform.source==='userAgentData'?e.platform.value==='macOS':e.platform.value.startsWith('Mac');
assert(detected===apple&&e.platform.apple===apple,'Wrong platform precondition');
const defaults=e.scenario==='apple-default';
assert(defaults?e.saved===null:e.saved&&e.saved.locationMaps==='apple','Wrong saved preference precondition');
assert(e.normalized===(defaults?'google':'apple'),'Wrong normalized saved value');
const settings=document.querySelector('[data-maps-surface="settings"]');
const calendar=document.querySelector('[data-maps-surface="calendar"]');
const panel=calendar?.querySelector('.detail-panel');
assert(settings&&calendar&&panel&&panel.textContent.includes(e.location),'Location text precondition missing');
const select=settings.querySelector('#settings-location-maps');
assert(apple?select&&select.value===e.normalized:select===null,'Wrong Apple-only row or selection');
if(apple)assert([...select.options].map(o=>o.textContent).join('|')==='Google Maps|Apple Maps','Wrong maps options');
const expectedApple=apple&&!defaults;
const label=expectedApple?'Open in Apple Maps ↗':'Open in Google Maps ↗';
const link=[...panel.querySelectorAll('a')].find(a=>a.textContent===label);
const expected=(expectedApple?'https://maps.apple.com/search?query=':'https://www.google.com/maps/search/?api=1&query=')+encodeURIComponent(e.location);
assert(link&&link.getAttribute('href')===expected,'Wrong generated maps href');
assert(link.target==='_blank'&&link.rel==='noopener noreferrer','Unsafe external maps path');
assert(panel.querySelector('a[href="https://example.test/notes"]')&&panel.querySelector('a[href="mailto:team@example.test"]'),'Ordinary links changed');
const measured=[];
const visible=(surface,host,node,name)=>{
 surface.scrollIntoView({block:'start'});
 node.scrollIntoView({block:'center'});
 const p=host.getBoundingClientRect(),r=node.getBoundingClientRect();
 assert(r.width>0&&r.height>0&&r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1,name+' outside panel');
 assert(r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,name+' outside viewport');
 measured.push({name,left:r.left,right:r.right,top:r.top,bottom:r.bottom});
};
const settingsScene=e.scenario==='apple-settings'||defaults;
const shown=settingsScene?settings:calendar,other=settingsScene?calendar:settings;
assert(!shown.hidden&&other.hidden&&other.getBoundingClientRect().width===0&&other.getBoundingClientRect().height===0,'Other route is rendered');
assert(!shown.textContent.includes('Loading'),'Visible route is not settled');
if(apple){
 const rows=[...settings.querySelectorAll('.settings-row')];
 const zone=rows.findIndex(row=>row.querySelector('span')?.textContent==='Time zone');
 const ask=rows.findIndex(row=>row.querySelector('#settings-ask-zone'));
 const maps=rows.findIndex(row=>row.querySelector('#settings-location-maps'));
 assert(zone>=0&&ask===zone+1&&maps===ask+1,'Time zone and Location row order changed');
 assert(rows.every(row=>row.textContent.trim()!==''),'Empty Settings row');
}
if(settingsScene)visible(settings,settings.querySelector('.settings-content'),select,'Maps preference');
else visible(calendar,panel,link,'Maps link');
assert(document.documentElement.scrollWidth<=innerWidth,'Page widened');
document.documentElement.dataset.mapsProof=JSON.stringify({passed:true,scenario:e.scenario,href:link.getAttribute('href'),measured});
document.documentElement.dataset.fixtureReady='location-maps';
`;

export const executeMapsProofWithStandIns = (
  html: string,
  width: number
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const script = document.querySelector("script[data-maps-proof]")?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Missing exact exported maps proof");
  }

  const panelWidth = width <= 1000 ? 260 : 300;

  for (const node of document.querySelectorAll<HTMLElement>(
    "[data-maps-surface], .settings-content, .detail-panel, #settings-location-maps, .detail-panel a"
  )) {
    if (node.closest("[hidden]") !== null) {
      continue;
    }

    const settings = node.matches(".settings-content, #settings-location-maps");

    const box = settings
      ? new DOMRect(240, 100, width - 280, 600)
      : new DOMRect(width - panelWidth + 16, 100, panelWidth - 32, 600);

    Object.defineProperty(node, "getBoundingClientRect", { value: () => box });
    Object.defineProperty(node, "scrollIntoView", { value: () => null });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, {
    JSON,
    URL,
    document,
    innerHeight: 960,
    innerWidth: width,
  });

  return document;
};
