import { runInNewContext } from "node:vm";

export const instantProofScript = `
const evidence=JSON.parse(document.querySelector('#instant-evidence').textContent);
const assert=(value,message)=>{if(!value)throw Error(message)};
assert(evidence.loaded&&evidence.source&&evidence.calendar,'Missing loaded source precondition');
assert(evidence.selected.length===1&&evidence.selected[0]===JSON.stringify([evidence.source.accountId,evidence.source.calendarId,evidence.source.eventId]),'Wrong selected source precondition');
assert(evidence.source.attendees.some(person=>person.self!==true),'Meeting has no saved guests');
assert(evidence.source.eventType==='default','Unexpected event type');
assert(evidence.source.accountId===evidence.calendar.accountId&&evidence.source.calendarId===evidence.calendar.calendarId,'Permission precondition identity mismatch');
const readonly=evidence.scenario==='readonly-delete';
assert(evidence.calendar.accessRole===(readonly?'reader':'owner'),'Wrong permission precondition');
if(evidence.scenario==='repeat-delete')assert(evidence.source.recurringEventId&&evidence.source.originalStartTime&&evidence.prepared?.master?.recurrence?.includes('RRULE:FREQ=DAILY'),'Not a daily recurring occurrence');
assert(evidence.calendar.title==='Work','Unrealistic calendar title');
assert(['Weekly sync','Design review'].includes(evidence.source.title),'State encoded in event title');
assert(evidence.readCompleted,'Settled scene has pending reads');
assert(!document.querySelector('.app').textContent.includes('Loading events…'),'Settled scene shows loading');
if(evidence.scenario==='editor-save')assert(evidence.editorBefore==='Editing','Save did not begin in editor');
assert(!document.querySelector('dialog[data-editing-dialog]'),'Unexpected editor or confirmation dialog');
assert(evidence.dialogsSeen.length===0,'Scope or email dialog appeared');
const viewport=document.querySelector('#time-viewport');
const sidebar=document.querySelector('.sidebar');
const panel=document.querySelector('.detail-panel,#upcoming-meeting');
assert(viewport&&sidebar&&panel,'Missing grid/sidebar/context');
const grid=viewport.getBoundingClientRect();
assert(grid.width>=400&&grid.left>=sidebar.getBoundingClientRect().right-1,'Grid clipped or overlaps sidebar');
assert(Math.abs(grid.right-panel.getBoundingClientRect().left)<=1&&panel.getBoundingClientRect().right<=innerWidth+1,'Context panel clipped or grid gap');
const toast=document.querySelector('.undo-toast');
if(readonly){
 assert(!evidence.keyHandled&&evidence.availability==='disabled'&&evidence.unchanged,'Read-only key changed state');
 assert(!toast&&evidence.mutations.length===0&&evidence.pending.length===0,'Read-only key wrote or staged');
 const chip=[...document.querySelectorAll('.event-chip')].find(item=>item.dataset.eventKey===evidence.selected[0]);
 assert(chip&&chip.classList.contains('selected'),'Read-only saved selection absent');
 const chipBox=chip.getBoundingClientRect();assert(chipBox.width>0&&chipBox.height>0&&chipBox.left>=grid.left&&chipBox.right<=grid.right&&chipBox.top>=grid.top&&chipBox.bottom<=grid.bottom,'Read-only selection not visible');
}else if(evidence.scenario==='editor-save'){
 assert(evidence.keyHandled&&evidence.availability==='enabled'&&evidence.editorAfter==='Closed','Save key did not complete');
 assert(!toast&&evidence.pending.length===0,'Save staged a deletion');
 const notice=document.querySelector('.instant-save-notice');
 assert(notice&&notice.closest('.notification-stack'),'Save receipt missing from shared stack');
 assert(notice.querySelector('p')?.textContent===('Saved "'+evidence.source.title+'". No email sent.'),'Wrong no-email save wording');
 assert(evidence.savedNotice?.sendUpdates==='none'&&evidence.savedNotice.title===evidence.source.title,'Save notice receipt mismatch');
 const noticeBox=notice.getBoundingClientRect();assert(noticeBox.width>0&&noticeBox.left>=0&&noticeBox.right<=innerWidth&&noticeBox.top>=0&&noticeBox.bottom<=innerHeight,'Saved notice clipped');
 assert(document.querySelector('.detail-panel')?.textContent.includes('· Organizer'),'Organizer role missing from saved Attendees');
 assert(evidence.mutations.length===1&&evidence.mutations[0].method==='PATCH','Save did not use ordinary update');
 assert(new URL(evidence.mutations[0].path,'https://fixture.invalid').searchParams.get('sendUpdates')==='none','Save requested email');
 const chip=[...document.querySelectorAll('.event-chip')].find(item=>item.querySelector('strong')?.textContent===evidence.source.title);
 assert(chip?.querySelector('.event-time')?.textContent==='11am–12pm','Changed time absent from saved chip');
 assert(document.querySelector('.detail-time')?.textContent.includes('11am – 12pm'),'Changed time absent from context');
 const body=JSON.parse(evidence.mutations[0].body);assert(Date.parse(body.start.dateTime)===Date.parse('2026-10-21T11:00:00-07:00')&&Date.parse(body.end.dateTime)===Date.parse('2026-10-21T12:00:00-07:00'),'Receipt does not match saved time');
}else{
 assert(evidence.keyHandled&&evidence.availability==='enabled','Delete key refused eligible source');
 assert(toast&&evidence.pending.length===1&&evidence.mutations.length===0,'Delete not staged without mutation');
 const intent=evidence.pending[0];
 assert(intent.request.scope==='single'&&intent.request.sendUpdates==='none'&&intent.request.eventId===evidence.source.eventId,'Unsafe staged occurrence request');
 assert(toast.dataset.undoIntent===intent.id,'Undo belongs to another intent');
 const occurrence=evidence.source.recurringEventId?'this occurrence of ':'';
 const quoted='"'+evidence.source.title+'"';
 const expected=evidence.source.organizer?.self===true?'Cancelled '+occurrence+quoted+'. No email sent.':'Removed '+occurrence+quoted+' from your calendar. No email sent.';
 assert(toast.querySelector('span')?.textContent===expected,'Wrong role or occurrence no-email wording');
 assert(evidence.prepared?.sendUpdates==='none'&&evidence.prepared.scope==='single','Notice does not match single no-email receipt');
 if(evidence.scenario==='repeat-delete'){
   assert(evidence.companions.length>0,'No unselected series occurrence precondition');
   const companion=evidence.companions.find(item=>item.event.recurringEventId===evidence.source.recurringEventId);
   const chip=[...document.querySelectorAll('.event-chip')].find(item=>item.dataset.eventKey===companion?.key);
   assert(chip,'Other daily occurrence vanished');
   const bounds=chip.getBoundingClientRect();assert(bounds.width>0&&bounds.height>0&&bounds.left>=grid.left&&bounds.right<=grid.right&&bounds.top>=grid.top&&bounds.bottom<=grid.bottom,'Other occurrence not visible that week');
 }
 assert([...toast.querySelectorAll('button')].some(button=>button.textContent==='Undo'),'Undo unavailable');
 const box=toast.getBoundingClientRect();
 assert(box.width>0&&box.height>0&&box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight,'Undo toast clipped');
 assert(toast.closest('.notification-stack'),'Undo not in shared stack');
 for(const button of toast.querySelectorAll('button')){const bounds=button.getBoundingClientRect();assert(bounds.left>=box.left&&bounds.right<=box.right&&bounds.top>=box.top&&bounds.bottom<=box.bottom,'Undo action clipped');}
}
assert(document.documentElement.scrollWidth<=innerWidth,'Page widened');
document.documentElement.dataset.instantNoEmailProof='pass';`;

export const executeInstantProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const sidebar = width <= 1000 ? 185 : 220;
  const panel = width <= 1000 ? 260 : 300;
  const gridWidth = width - sidebar - panel;

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        if (element.matches(".sidebar")) {
          return new DOMRect(0, 100, sidebar, 844);
        }

        if (element.matches("#time-viewport")) {
          return new DOMRect(sidebar, 100, gridWidth, 844);
        }

        if (element.matches(".detail-panel,#upcoming-meeting")) {
          return new DOMRect(width - panel, 100, panel, 844);
        }

        if (element.matches(".event-chip")) {
          return new DOMRect(sidebar + 100, 532, 100, 48);
        }

        return new DOMRect(width - 424, 880, 400, 56);
      },
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });

  const script = document.querySelector(
    "script[data-instant-proof]"
  )?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Missing exact exported instant proof");
  }

  runInNewContext(script, {
    URL,
    document,
    innerHeight: 960,
    innerWidth: width,
  });

  if (document.documentElement.dataset.instantNoEmailProof !== "pass") {
    throw new Error("Exported instant proof did not finish");
  }

  return document;
};
