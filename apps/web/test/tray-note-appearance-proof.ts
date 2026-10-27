export const trayNoteAppearanceProof = (stagedLabel: string | null) => `
const expectedStaged=${JSON.stringify(stagedLabel)};
const phone=document.documentElement.dataset.fixturePane==='phone';
const pane=phone?document.querySelector('#phone-shell-dialog'):document.querySelector('.detail-panel');
const section=pane?.querySelector('.event-rsvp');
const field=section?.querySelector('#rsvp-note');
const app=document.querySelector('.app');
if(!field||!app||!section)throw Error('Missing RSVP appearance surface');
const family=getComputedStyle(field).fontFamily;
if(family!==getComputedStyle(app).fontFamily||family.includes('monospace'))throw Error('RSVP textarea font differs from app');
const staged=[...section.querySelectorAll('button[data-rsvp-staged="true"]')];
if(staged.length!==(expectedStaged===null?0:1)||staged.some(button=>button.textContent!==expectedStaged))throw Error('Staged response attribute differs');
const rgb=value=>{
 const values=value.match(/[\\d.]+/g)?.slice(0,3).map(Number);
 if(!values||values.length!==3)throw Error('Unknown computed RGB colour');
 return values;
};
const luminance=value=>rgb(value).map(component=>component/255).map(component=>component<=0.04045?component/12.92:((component+0.055)/1.055)**2.4).reduce((sum,component,index)=>sum+component*[0.2126,0.7152,0.0722][index],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
for(const button of staged){
 const style=getComputedStyle(button);
 const token=document.createElement('span');token.style.color='var(--pressed)';app.append(token);
 const pressed=getComputedStyle(token).color;token.style.color='var(--focus)';const focus=getComputedStyle(token).color;token.remove();
 if(rgb(style.backgroundColor).join(',')!==rgb(pressed).join(','))throw Error('Staged fill does not reuse pressed token');
 if(!style.boxShadow.includes('inset')||!style.boxShadow.includes(focus))throw Error('Staged accent does not reuse focus token');
 if(contrast(style.color,style.backgroundColor)<4.5||contrast(focus,style.backgroundColor)<3)throw Error('Staged response contrast insufficient');
}
document.documentElement.dataset.trayNoteAppearance='pass';
`;
