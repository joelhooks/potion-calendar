export const groupFixtureProof = (
  selector: string,
  created: readonly string[]
) => `document.fonts.ready.then(()=>requestAnimationFrame(()=>{
  const dialog=document.querySelector('#clipboard-guests');
  if(dialog){
    dialog.showModal();
    document.querySelector('#clipboard-exclude')?.focus();
    if(document.activeElement?.id!=='clipboard-exclude')throw Error('Default focus is not Paste without guests');
    const invite=[...dialog.querySelectorAll('button')].filter(button=>button.textContent==='Invite guests (sends email)');
    if(invite.length!==1||invite[0].disabled)throw Error('Expected one enabled group invitation choice');
    if(getComputedStyle(dialog.querySelector('.editor-scroll')).paddingBottom!=='0px')throw Error('Guest dialog retains editor scroll padding');
  }
  const sidebar=document.querySelector('.sidebar');
  const command=document.querySelector('#command-menu-button');
  const reserve=document.querySelector('.sidebar-command-space');
  if(sidebar&&command&&reserve){
    const originalScroll=sidebar.scrollTop;
    sidebar.scrollTop=sidebar.scrollHeight;
    const content=sidebar.getBoundingClientRect();
    const button=command.getBoundingClientRect();
    const footer=reserve.getBoundingClientRect();
    const signout=document.querySelector('.sign-out')?.getBoundingClientRect();
    if(content.bottom>button.top||button.top<footer.top||button.bottom>footer.bottom)throw Error('Commands overlaps the sidebar scroll area');
    if(signout&&(signout.bottom>content.bottom+1||signout.bottom>button.top))throw Error('Sign out is not reachable above Commands');
    sidebar.scrollTop=originalScroll;
    if(sidebar.scrollTop!==0)throw Error('Sidebar must start at scrollTop zero');
  }
  const viewport=document.querySelector('#time-viewport,#month-viewport');
  const ids=${JSON.stringify(created)};
  const chips=[...document.querySelectorAll('.event-chip')].filter(chip=>ids.some(id=>chip.dataset.eventKey?.includes(id))&&!chip.closest('[data-month-parked]'));
  if(viewport&&chips.length){
    const top=Math.min(...chips.map(chip=>chip.getBoundingClientRect().top));
    viewport.scrollTop=Math.max(0,viewport.scrollTop+top-viewport.getBoundingClientRect().top-100);
    const clip=viewport.getBoundingClientRect();
    const count=Number(document.querySelector('.clipboard-results h3')?.textContent.match(/Pasted (\\d+)/)?.[1]??0);
    const visibleIds=ids.filter(id=>chips.some(chip=>{
      if(!chip.dataset.eventKey?.includes(id))return false;
      const box=chip.getBoundingClientRect();
      return box.width>0&&box.height>0&&Math.min(box.right,clip.right)>Math.max(box.left,clip.left)&&Math.min(box.bottom,clip.bottom)>Math.max(box.top,clip.top+53);
    }));
    if(visibleIds.length!==count)throw Error('Not all confirmed pasted events are visible: '+visibleIds.length+' of '+count);
  }else if(document.querySelector('.clipboard-results h3')?.textContent.match(/Pasted [1-9]/))throw Error('No pasted chips found');
  const headers=document.querySelector('.day-headers');
  const panel=document.querySelector('.bulk-detail');
  const time=document.querySelector('#time-viewport');
  if(headers&&panel&&time){
    const right=Math.min(headers.getBoundingClientRect().right,time.getBoundingClientRect().right);
    const edge=panel.getBoundingClientRect().left;
    if(Math.abs(right-edge)>1)throw Error('Grid does not meet details panel: '+right+' vs '+edge);
  }
  const notice=document.querySelector('${selector}');
  if(!notice)throw Error('Missing group fixture panel');
  const box=notice.getBoundingClientRect();
  if(box.left<0||box.right>innerWidth||box.top<0||box.bottom>innerHeight)throw Error('Group panel overflow');
  for(const control of notice.querySelectorAll('button')){
    const bounds=control.getBoundingClientRect();
    if(bounds.left<box.left||bounds.right>box.right||bounds.top<box.top||bounds.bottom>box.bottom)throw Error('Clipped group control');
  }
  if(!dialog&&!notice.closest('.notification-stack'))throw Error('Notice is outside shared stack');
  if(document.querySelector('.sidebar')?.textContent.includes('Loading events'))throw Error('Settled fixture still has a loading account');
  if(document.documentElement.scrollWidth>innerWidth)throw Error('Page overflow');
  document.documentElement.dataset.clipboardGroupProof='pass';
}));`;
