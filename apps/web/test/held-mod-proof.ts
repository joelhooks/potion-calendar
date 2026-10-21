import { runInNewContext } from "node:vm";

export const heldModProofScript = `
const e=JSON.parse(document.querySelector('#held-mod-evidence').textContent);
const assert=(value,message)=>{if(!value)throw Error(message)};
assert(e.loaded&&e.source&&e.calendar,'Missing loaded source precondition');
assert(e.calendar.title==='Work'&&e.source.eventType==='default','Wrong source precondition');
assert(e.source.accountId===e.calendar.accountId&&e.source.calendarId===e.calendar.calendarId,'Wrong permission identity');
assert(e.source.organizer?.self===true&&e.source.attendees.some(person=>person.self!==true),'Not an organizer meeting');
assert(e.selected.includes(JSON.stringify([e.source.accountId,e.source.calendarId,e.source.eventId])),'Grabbed source not selected');
assert(e.selected.join('|')===e.afterSelection.join('|'),'Selection changed');
const readOnly=e.scenario==='readonly';
const month=e.scenario==='month-move'||readOnly;
assert(e.calendar.accessRole===(readOnly?'reader':'owner'),'Wrong write permission precondition');
const last=e.native.pointerLog.at(-1);
assert(last&&(e.native.platform==='MacIntel'?last.metaKey:last.ctrlKey),'Held modifier missing from native event');
if(e.scenario==='repeat-resize'){
 assert(last.type==='pointerup'&&last.shiftKey,'Shift-Mod not sampled at drop');
 assert(e.source.recurringEventId&&e.source.originalStartTime&&e.prepared?.session.master?.recurrence?.includes('RRULE:FREQ=DAILY'),'Not a loaded daily occurrence');
 assert(e.companions.some(peer=>peer.source.recurringEventId===e.source.recurringEventId&&!e.selected.includes(peer.key)),'No unselected recurring occurrence precondition');
}
if(e.scenario==='month-move')assert(e.selected.length===2&&e.companions.length>0,'Missing multi-selection precondition');
assert(e.native.selectionChanges===0,'Rectangle selection consumed gesture');
assert(!document.querySelector('dialog[data-editing-dialog]'),'Unexpected confirmation dialog');
assert(!e.dialogsSeen.includes('Scope')&&!e.dialogsSeen.includes('Email'),'Confirmation dialog appeared');
assert(!document.querySelector('.undo-toast'),'Move invented deletion Undo');
const viewport=document.querySelector(month?'#month-viewport':'#time-viewport');
const sidebar=document.querySelector('.sidebar');
const panel=document.querySelector('.detail-panel,#upcoming-meeting');
assert(viewport&&sidebar&&panel,'Missing calendar surfaces');
if(month)viewport.scrollTop=(document.querySelector('.month-week')?.getBoundingClientRect().height??0)*6;
const grid=viewport.getBoundingClientRect();
assert(grid.width>=400&&grid.left>=sidebar.getBoundingClientRect().right-1,'Grid overlaps sidebar');
assert(Math.abs(grid.right-panel.getBoundingClientRect().left)<=1&&panel.getBoundingClientRect().right<=innerWidth+1,'Context clipped');
const sourceKey=JSON.stringify([e.source.accountId,e.source.calendarId,e.source.eventId]);
const chip=[...document.querySelectorAll('.event-chip')].find(node=>node.dataset.eventKey===sourceKey);
assert(chip&&chip.classList.contains('selected'),'Grabbed event missing');
const box=chip.getBoundingClientRect();
assert(box.width>0&&box.height>0&&box.left>=grid.left-1&&box.right<=grid.right+1&&box.top>=grid.top-1&&box.bottom<=grid.bottom+1,'Grabbed event not visible');
const stack=document.querySelector('.notification-stack');
assert(stack,'Missing existing notice stack');
if(readOnly){
 assert(e.native.refusal==='ReadOnlyEvent'&&!e.native.completed&&e.mutations.length===0&&e.requests.length===0,'Read-only wrote or loaded an editor');
 const refusal=stack.querySelector('.gesture-refusal');
 assert(refusal?.textContent.includes("You can only view this event, so it can't be moved. Nothing was changed."),'Missing existing refusal');
 assert(!stack.querySelector('.instant-save-notice'),'Read-only shows saved receipt');
}else{
 assert(e.native.completed.intent==='noEmailGesture'&&last.type==='pointerup','Instant drop intent missing');
 assert(e.native.clickOwner==='gesture','Post-drag click escaped to selection');
 assert(e.prepared.scope==='single'&&e.prepared.sendUpdates==='none'&&!e.prepared.emailNeeded&&e.prepared.prompt==='none','Wrong prepared scope or email decision');
 assert(e.mutations.length===1&&e.mutations[0].method==='PATCH','Wrong mutation count or method');
 const url=new URL(e.mutations[0].path,'https://fixture.invalid');
 assert(url.pathname==='/calendars/'+encodeURIComponent(e.source.calendarId)+'/events/'+encodeURIComponent(e.source.eventId),'Mutation targeted a series or another event');
 assert(url.searchParams.get('sendUpdates')==='none','Mutation requested email');
 const body=JSON.parse(e.mutations[0].body);
 assert(Date.parse((body.start??e.source.start).dateTime)===Date.parse(e.expected.start)&&Date.parse(body.end.dateTime)===Date.parse(e.expected.end),'Mutation time mismatch');
 assert(e.readCompleted&&!document.querySelector('.app').textContent.includes('Loading events…'),'Saved scene has unfinished read');
 const notice=stack.querySelector('.instant-save-notice');
 const occurrence=e.scenario==='repeat-resize'?'this occurrence of ':'';
 assert(notice?.querySelector('p')?.textContent==='Moved '+occurrence+'"'+e.source.title+'". No email sent.','Wrong move receipt wording');
 assert(e.savedNotice?.title===e.source.title&&e.savedNotice.sendUpdates==='none','Notice receipt mismatch');
 assert(!notice.textContent.includes('Undo'),'Move notice offers unsupported Undo');
 assert(notice.querySelector('button')?.getAttribute('aria-label')==='Dismiss moved notice','Move receipt is not dismissible');
 if(month)assert(chip.closest('[data-day]')?.dataset.day===String(e.expectedDay),'Saved Month date missing');
 else assert(chip.querySelector('.event-time')?.textContent===(e.scenario==='repeat-resize'?'9am–11am':'11am–12pm'),'Saved chip time mismatch');
}
for(const peer of e.companions){
 assert(e.afterCompanions.some(item=>item.key===peer.key&&JSON.stringify(item.source)===JSON.stringify(peer.source)),'Another occurrence or selection moved');
 const peerChip=[...document.querySelectorAll('.event-chip')].find(node=>node.dataset.eventKey===peer.key);
 assert(peerChip,'Unmoved companion missing');
 const bounds=peerChip.getBoundingClientRect();
 assert(bounds.width>0&&bounds.height>0&&bounds.left>=grid.left-1&&bounds.right<=grid.right+1&&bounds.top>=grid.top-1&&bounds.bottom<=grid.bottom+1,'Unmoved companion not visible');
}
const notices=[...stack.children].filter(node=>node.getBoundingClientRect().height>0);
assert(notices.length>0,'No visible result');
for(const [index,node] of notices.entries()){
 const bounds=node.getBoundingClientRect();
 assert(bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight,'Result notice clipped');
 assert(index===0||notices[index-1].getBoundingClientRect().bottom<=bounds.top,'Notice stack overlaps');
 for(const button of node.querySelectorAll('button')){
  const control=button.getBoundingClientRect();
  assert(control.left>=bounds.left&&control.right<=bounds.right&&control.top>=bounds.top&&control.bottom<=bounds.bottom,'Notice action clipped');
 }
}
assert(document.documentElement.scrollWidth<=innerWidth,'Page widened');
document.documentElement.dataset.heldModifierProof=JSON.stringify({passed:true,scenario:e.scenario});
document.documentElement.dataset.fixtureReady='true';`;

export const executeHeldModProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const sidebar = width <= 1000 ? 185 : 220;
  const panel = width <= 1000 ? 260 : 300;

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        if (
          element
            .getAttribute("style")
            ?.replaceAll(" ", "")
            .includes("display:contents") === true
        ) {
          return new DOMRect(0, 0, 0, 0);
        }

        if (element.matches(".sidebar")) {
          return new DOMRect(0, 100, sidebar, 844);
        }

        if (element.matches("#time-viewport,#month-viewport")) {
          return new DOMRect(sidebar, 100, width - sidebar - panel, 844);
        }

        if (element.matches(".detail-panel,#upcoming-meeting")) {
          return new DOMRect(width - panel, 100, panel, 844);
        }

        if (element.matches(".event-chip")) {
          return new DOMRect(sidebar + 100, 532, 100, 48);
        }

        if (element.matches(".month-week")) {
          return new DOMRect(sidebar, 100, width - sidebar - panel, 140);
        }

        return new DOMRect(width - 424, 880, 400, 56);
      },
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });

  const script = document.querySelector(
    "script[data-held-mod-proof]"
  )?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Missing exact exported held-mod proof");
  }

  runInNewContext(script, {
    URL,
    document,
    innerHeight: 960,
    innerWidth: width,
  });

  return document;
};
