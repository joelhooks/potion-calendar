import { runInNewContext } from "node:vm";

export const conferencingSettingsProofScript = `
const evidence=JSON.parse(document.querySelector('#conferencing-settings-evidence').textContent);
const assert=(value,message)=>{if(!value)throw Error(message)};
const expectedMode={empty:'listing',list:'listing',add:'editing',edit:'editing',invalid:'editing',required:'editing','save-failure':'editing',remove:'listing','https-prepend':'listing',pending:'saving'};
const expectedRows={empty:0,list:2,add:0,edit:2,invalid:0,required:0,'save-failure':0,remove:1,'https-prepend':1,pending:0};
assert(document.querySelector('.settings-content h1')?.textContent==='Conferencing','Wrong Settings recipient');
assert(document.querySelector('.settings-nav a[href="/settings/conferencing"]')?.getAttribute('aria-current')==='page','Literal conferencing nav is not active');
assert(!document.querySelector('.workspace'),'Calendar workspace rendered behind Settings');
assert(evidence.mode===expectedMode[evidence.scenario],'Wrong scenario lifecycle mode');
assert(evidence.storageResults.includes('stand-ins'),'Storage stand-in boundary missing');
const rows=[...document.querySelectorAll('.settings-conferencing-list li')];
assert(rows.length===expectedRows[evidence.scenario]&&rows.length===evidence.entries.length,'Wrong saved catalog count');
for(let index=0;index<rows.length;index++){
 const entry=evidence.entries[index];
 assert(rows[index].id==='custom-video-'+entry.id,'Saved row identity mismatch');
 assert(rows[index].querySelector('strong')?.textContent===entry.name,'Wrong saved video name');
 assert(rows[index].querySelector('a')?.getAttribute('href')===entry.link,'Wrong saved video link');
 assert(['http:','https:'].includes(new URL(entry.link).protocol),'Unsafe saved video scheme');
 assert(rows[index].querySelector('button[aria-label="Edit '+entry.name+'"]'),'Missing saved-row Edit action');
 assert(rows[index].querySelector('button[aria-label="Remove '+entry.name+'"]'),'Missing saved-row Remove action');
}
const form=document.querySelector('.settings-conferencing-form');
const editing=['editing','saving'].includes(evidence.mode);
assert(Boolean(form)===editing,'Wrong edit form visibility');
if(form){
 assert(!document.querySelector('.settings-content').textContent.includes('No custom video links yet.'),'Redundant empty-state text beside the form');
 assert(form.querySelector('#custom-video-name')?.value===evidence.draft.name,'Draft name was lost');
 assert(form.querySelector('#custom-video-link')?.value===evidence.draft.link,'Draft link was lost');
 for(const field of ['name','link']){
  const expected=evidence.errors[field];
  const error=document.querySelector('#custom-video-'+field+'-error');
  assert(Boolean(error)===Boolean(expected),'Wrong field error visibility');
  if(expected)assert(error.textContent===expected,'Wrong field validation wording');
 }
 const controls=[...form.querySelectorAll('input,button')];
 assert(controls.every(control=>control.disabled===(evidence.mode==='saving')),'Incorrect pending form controls');
}
if(evidence.scenario==='invalid'){
 assert(evidence.draft.link.startsWith('javascript:'),'Rejected-script input missing');
 assert(document.querySelector('#custom-video-link-error')?.textContent==='Must be a valid URL','Script link was not rejected');
 assert(evidence.writes.length===0,'Invalid input issued a durable write');
}
if(evidence.scenario==='required'){
 assert(evidence.errors.name==='Name is required'&&evidence.errors.link==='Conferencing link is required','Missing required-field feedback');
 assert(evidence.writes.length===0,'Empty fields issued a durable write');
}
if(evidence.scenario==='save-failure'){
 assert(evidence.error&&document.querySelector('[role="alert"]')?.textContent===evidence.error,'Save failure was hidden');
 const alert=form.querySelector('[role="alert"]');
 assert(alert&&alert.textContent===evidence.error&&alert.nextElementSibling?.classList.contains('settings-conferencing-actions'),'Save failure alert is not inside the form above its actions');
 assert(evidence.draft.name==='  Daily  Standup  '&&evidence.draft.link==='daily.example/standup','Failed save did not preserve the draft');
 assert(evidence.entries.length===0&&evidence.writes.length===1,'Failed save falsely committed or retried');
}
if(evidence.scenario==='https-prepend'){
 const write=evidence.writes[0]?.args.write;
 assert(write?._tag==='Save'&&write.link==='https://daily.example/standup'&&write.name==='Daily  Standup','HTTPS prepend or whitespace policy missing from actual command');
 assert(evidence.entries[0]?.link===write.link&&evidence.entries[0]?.name===write.name,'Displayed catalog does not match saved command');
}
if(evidence.scenario==='remove'){
 assert(evidence.writes.length===1&&evidence.writes[0].args.write._tag==='Remove'&&evidence.writes[0].args.write.id==='team','Remove intent missing');
 assert(!document.querySelector('#custom-video-team')&&document.querySelector('#custom-video-design'),'Remove changed the wrong row');
}
if(evidence.scenario==='pending'){
 assert(document.querySelector('[role="status"]')?.textContent==='Saving custom video link…','Pending state missing');
 assert(form.querySelector('.settings-conferencing-actions [role="status"]'),'Pending status is outside the form actions');
}
assert(document.querySelector('.settings-content')?.textContent.includes('do not sync across devices'),'Inherited per-browser limit missing');
assert(document.querySelector('.settings-content a[href="/settings/calendar/work"]'),'Account-default recipient missing');
assert(![...document.querySelectorAll('.settings-content button')].some(button=>button.textContent.includes('Zoom')),'Unsupported OAuth action offered');
for(const anchor of document.querySelectorAll('.settings-content a'))assert(['http:','https:'].includes(new URL(anchor.getAttribute('href'),'https://fixture.invalid').protocol),'Unsafe conferencing anchor');
const content=document.querySelector('.settings-content');
const nav=document.querySelector('.settings-nav');
const panel=content.getBoundingClientRect();
assert(panel.width>0&&panel.left>=nav.getBoundingClientRect().right-1&&panel.right<=innerWidth+1,'Settings content clipped or overlapping nav');
for(const control of content.querySelectorAll('input,button,a')){
 const box=control.getBoundingClientRect();
 if(box.width>0)assert(box.left>=panel.left-1&&box.right<=panel.right+1,'Conferencing control clipped horizontally');
}
assert(document.documentElement.scrollWidth<=innerWidth,'Conferencing page widened');
document.documentElement.dataset.conferencingSettingsProof='pass';`;

export const executeConferencingSettingsProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const document = new DOMParser().parseFromString(html, "text/html");

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        if (element.matches(".settings-nav")) {
          return new DOMRect(0, 42, 216, 918);
        }

        if (element.matches(".settings-content")) {
          return new DOMRect(216, 42, width - 216, 918);
        }

        return new DOMRect(248, 100, Math.min(480, width - 280), 40);
      },
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });

  const script = document.querySelector(
    "script[data-conferencing-settings-proof]"
  )?.textContent;

  if (script === null || script === undefined) {
    throw new Error("Missing exact exported conferencing settings proof");
  }

  runInNewContext(script, {
    URL,
    document,
    innerHeight: 960,
    innerWidth: width,
  });

  if (document.documentElement.dataset.conferencingSettingsProof !== "pass") {
    throw new Error("Exported conferencing settings proof did not finish");
  }

  return document;
};
