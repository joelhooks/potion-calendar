import { runInNewContext } from "node:vm";

export const placeholderProofScript = `
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const e=JSON.parse(document.querySelector('#placeholder-evidence').textContent);
assert(e.loaded&&e.person==='fixture-person'&&e.account==='work'&&e.calendar==='primary','Missing loaded person/calendar precondition');
assert(['create','edit'].includes(e.kind)&&e.editMeeting&&e.eventType==='default','Wrong ordinary editable context');
assert(e.kind==='create'?e.original===null&&e.selected.length===0:e.original?.eventId==='fixture-instance'&&e.original.title===''&&e.selected.length===1,'Wrong new/existing source context');
assert(e.title===''&&e.location===''&&e.description==='','Empty draft precondition missing');
assert(e.commandsExecuted===0&&e.qualification==='Constructed model rendered through the actual root view; no actor or provider operation.','Wrong projection qualification');
const app=document.querySelector('.app');
assert(app?.classList.contains('theme-'+e.theme),'Theme precondition missing');
const dialog=document.querySelector('dialog.editor-dialog');
assert(dialog,'Missing editor');
if(!dialog.open)dialog.showModal();
const rgb=(s)=>{
 let text=s.trim();
 if(/^#[0-9a-f]{3}$/i.test(text))text='#'+[...text.slice(1)].map(c=>c+c).join('');
 if(/^#[0-9a-f]{6}$/i.test(text))return [1,3,5].map(i=>parseInt(text.slice(i,i+2),16));
 const match=text.match(/^rgba?\\(([^)]+)\\)$/);
 assert(match,'Unsupported computed colour '+text);
 const values=match[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
 assert(values.length===3||(values.length===4&&values[3]===1),'Non-opaque computed colour '+text);
 return values.slice(0,3);
};
const luminance=(c)=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const muted=rgb(getComputedStyle(app).getPropertyValue('--muted'));
const measured=[];
for(const [id,text] of [['event-title','Title'],['event-location','Location'],['event-description','Description']]){
 const field=document.getElementById(id);
 assert(field&&field.value===''&&!field.disabled,'Missing empty enabled field '+id);
 assert(field.getAttribute('placeholder')===text,'Wrong exact placeholder '+id);
 assert(document.querySelector('label[for="'+id+'"]').textContent.trim()===text,'Accessible label changed '+id);
 const style=getComputedStyle(field,'::placeholder'),fg=rgb(style.color),bg=rgb(getComputedStyle(field).backgroundColor);
 assert(fg.every((v,i)=>v===muted[i])&&Number(style.opacity)===1,'Placeholder does not use opaque muted token '+id);
 const light=luminance(fg),back=luminance(bg),ratio=(Math.max(light,back)+.05)/(Math.min(light,back)+.05);
 assert(ratio>=4.5,'Placeholder contrast below 4.5:1 '+id+' '+ratio);
 const r=field.getBoundingClientRect(),d=dialog.getBoundingClientRect();
 const scroll=field.closest('.editor-scroll');
 assert(scroll,'Missing editor scroll viewport '+id);
 const s=scroll.getBoundingClientRect();
 assert(r.width>0&&r.height>0&&r.left>=d.left&&r.right<=d.right&&r.top>=d.top&&r.bottom<=d.bottom,'Field outside dialog '+id);
 assert(r.left>=s.left&&r.right<=s.right&&r.top>=s.top&&r.bottom<=s.bottom,'Field outside editor scroll '+id);
 assert(r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,'Field outside viewport '+id);
 measured.push({id,text,foreground:style.color,background:getComputedStyle(field).backgroundColor,opacity:style.opacity,contrastRatio:ratio,left:r.left,top:r.top,right:r.right,bottom:r.bottom});
}
assert(!document.getElementById('event-title').required&&document.getElementById('event-startDate').required,'Required-field semantics changed');
assert(!document.querySelector('[placeholder="Title (required)"]')&&!document.querySelector('[placeholder="Press ‘space’ for AI"]'),'Invented context');
assert(document.documentElement.scrollWidth<=innerWidth,'Page widened');
document.documentElement.dataset.placeholderProof=JSON.stringify({passed:true,kind:e.kind,theme:e.theme,measured});
document.documentElement.dataset.fixtureReady='editor-placeholders';
`;

export const executePlaceholderProofWithStandIns = (
  html: string,
  width: number,
  theme: "light" | "dark",
  outsideDialog = false,
  outsideScroll = false
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(document.querySelector("style")?.textContent ?? "");

  const rules = [...sheet.cssRules].filter(
    (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
  );

  const root = rules.find((rule) => rule.selectorText === ":root")?.style;

  const dark = rules.find(
    (rule) => rule.selectorText === ".app.theme-dark"
  )?.style;

  const token = (name: string) => {
    const themed = theme === "dark" ? dark?.getPropertyValue(name) : undefined;

    if (themed !== undefined && themed !== "") {
      return themed;
    }

    return root?.getPropertyValue(name) ?? "";
  };

  const fields = rules.find((rule) =>
    rule.selectorText.includes(".app input,")
  )?.style;

  const resolve = (value: string) =>
    value.startsWith("var(") ? token(value.slice(4, -1)) : value;

  for (const node of document.querySelectorAll<HTMLElement>(
    ".editor-dialog, .editor-scroll, #event-title, #event-location, #event-description"
  )) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => {
        if (node.matches(".editor-dialog")) {
          return new DOMRect(50, 20, width - 100, 850);
        }

        if (node.matches(".editor-scroll")) {
          return new DOMRect(70, 90, width - 140, 700);
        }

        if (node.id === "event-description" && outsideDialog) {
          return new DOMRect(40, 100, width - 180, 60);
        }

        return new DOMRect(
          90,
          node.id === "event-description" && outsideScroll ? 80 : 100,
          width - 180,
          60
        );
      },
    });
  }

  const dialog = document.querySelector("dialog");

  if (dialog !== null) {
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.setAttribute("open", "");
      },
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  const script = document.querySelector("#placeholder-proof")?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Missing exact exported placeholder proof");
  }

  runInNewContext(script, {
    document,
    getComputedStyle: (node: Element, pseudo?: string) => {
      const selector = `.editor-dialog ${node.tagName.toLowerCase()}::placeholder`;

      const placeholder = rules.find((rule) =>
        rule.selectorText.split(",").some((part) => part.trim() === selector)
      )?.style;

      if (pseudo !== undefined && placeholder === undefined) {
        throw new Error(`Missing scoped placeholder CSS for ${node.id}`);
      }

      return {
        backgroundColor: resolve(fields?.getPropertyValue("background") ?? ""),
        color: resolve(placeholder?.getPropertyValue("color") ?? ""),
        getPropertyValue: token,
        opacity:
          pseudo === undefined ? "1" : placeholder?.getPropertyValue("opacity"),
      };
    },
    innerHeight: 900,
    innerWidth: width,
  });

  return document;
};
