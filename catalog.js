"use strict";
const $=id=>document.getElementById(id);
const mode=document.body.dataset.catalog;
const DATA_URL=mode==="series"?"./data/series.json":"./data/pokemon-collections.json";
let groups=[],selected=null,cards=[],status="all",query="";
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;
function setText(id,value){const el=$(id);if(el)el.textContent=value}
function imageFor(card){return card.image||""}
function badge(owned){const el=document.createElement("span");el.className=`status-badge ${owned?"is-owned":"is-missing"}`;el.textContent=owned?(mode==="series"?"수집완료":"보유"):(mode==="series"?"구함":"미보유");return el}
function updateSummary(){
 const all=groups.reduce((n,g)=>n+g.total,0),owned=groups.reduce((n,g)=>n+g.owned,0),rate=pct(owned,all);
 setText("catalog-owned",owned);setText("catalog-total",all);setText("catalog-missing",all-owned);setText("catalog-rate",`${rate}%`);
 setText("stat-catalog-groups",groups.length);setText("stat-catalog-total",all);setText("stat-catalog-rate",rate);
 $("catalog-progress-ring").style.setProperty("--progress",rate);
}
function updateSelected(){const owned=cards.filter(c=>c.owned).length;setText("selected-name",selected.title||selected.name);setText("selected-progress",`${owned} / ${cards.length}${mode==="series"?"장":"장"} · ${pct(owned,cards.length)}%`)}
function openDialog(card){const d=$("catalog-dialog"),img=$("catalog-dialog-image"),wrap=$("catalog-dialog-image-wrap");img.src=imageFor(card);img.alt=`${card.name||card.code} 카드`;wrap.classList.toggle("is-missing",!card.owned);setText("dialog-code",card.code||card.meta);const b=$("dialog-status");b.replaceWith(badge(card.owned));const nb=d.querySelector(".status-badge");nb.id="dialog-status";setText("dialog-name",card.name||card.code);setText("dialog-meta",card.meta||card.code);setText("dialog-group",selected.title||selected.name);if(typeof d.showModal==="function")d.showModal();else d.setAttribute("open","")}
function makeCard(card){
 const a=document.createElement("article");a.className=`pokemon-card catalog-card${card.owned?"":" is-missing"}`;
 const b=document.createElement("button");b.type="button";b.className="pokemon-card-button";
 const iw=document.createElement("span");iw.className="card-image-wrap";const img=document.createElement("img");img.className="card-image";img.loading="lazy";img.src=imageFor(card);img.alt=`${card.name||card.code} 카드`;img.onerror=()=>a.classList.add("has-image-error");
 const miss=document.createElement("span");miss.className="missing-overlay";miss.textContent=mode==="series"?"구함":"미보유";const fb=document.createElement("span");fb.className="image-fallback";fb.innerHTML='<span class="fallback-ball"><span></span></span>이미지를 불러오지 못했습니다';iw.append(img,miss,fb);
 const body=document.createElement("span");body.className="card-body";const top=document.createElement("span");top.className="card-topline";const num=document.createElement("span");num.className="number-badge";num.textContent=card.code||card.meta;top.append(num,badge(card.owned));const name=document.createElement("strong");name.className="card-name-ko";name.textContent=card.name||card.code;const sub=document.createElement("span");sub.className="card-name-en";sub.textContent=selected.code||selected.name;const meta=document.createElement("span");meta.className="card-meta";meta.textContent=card.meta||card.code;body.append(top,name,sub,meta);b.append(iw,body);b.onclick=()=>openDialog(card);a.append(b);return a
}
function render(){const q=query.trim().toLowerCase();const shown=cards.filter(c=>(status==="all"||(status==="owned")===c.owned)&&(!q||`${c.name||""} ${c.code||""} ${c.meta||""}`.toLowerCase().includes(q)));$("catalog-grid").replaceChildren(...shown.map(makeCard));setText("result-count",shown.length);$("catalog-empty").hidden=shown.length!==0}
function loadGroup(value){selected=groups.find(g=>(g.code||g.name)===value)||groups[0];cards=selected.cards;updateSelected();render()}
async function init(){try{const r=await fetch(DATA_URL,{cache:"no-store"});if(!r.ok)throw new Error(r.status);groups=await r.json();groups.forEach(g=>{g.total=g.cards.length;g.owned=g.cards.filter(c=>c.owned).length});updateSummary();const select=$("catalog-select");groups.forEach(g=>{const o=document.createElement("option");o.value=g.code||g.name;o.textContent=`${g.title||g.name} · ${g.total}장`;select.append(o)});select.onchange=()=>loadGroup(select.value);$("catalog-search").oninput=e=>{query=e.target.value;render()};$("catalog-status").onclick=e=>{const b=e.target.closest("button");if(!b)return;status=b.dataset.status;e.currentTarget.querySelectorAll("button").forEach(x=>x.classList.toggle("is-active",x===b));render()};$("dialog-close").onclick=()=>$("catalog-dialog").close();loadGroup(select.value||groups[0].code||groups[0].name)}catch(e){console.error(e);$("catalog-error").hidden=false}}
init();
