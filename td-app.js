/* ═══════════════════════════════════════════════════════════
   THP-GHANA TRIPDESK v3 — Multi-stop Itinerary
   Supabase-first · GAS for emails · No urgency
   Staff ID format: THPG/MM/YYYY (matches Attendance system)
═══════════════════════════════════════════════════════════ */
'use strict';
const $=id=>document.getElementById(id);
const fmt=iso=>{if(!iso)return'—';const d=new Date(iso);return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});};
const ini=s=>(s||'?').split(' ').slice(0,2).map(w=>(w[0]||'')).join('').toUpperCase();
function toast(msg,type='ok'){const el=document.createElement('div');el.className='toast '+type;el.textContent=(type==='ok'?'✅ ':type==='info'?'ℹ️ ':'❌ ')+msg;$('toasts').appendChild(el);setTimeout(()=>el.remove(),3500);}
function showLoader(msg){const el=$('loading-overlay');if(!el)return;if(msg)$('lo-text').textContent=msg;el.classList.remove('fade-out');el.classList.add('active');}
function hideLoader(){const el=$('loading-overlay');if(!el)return;el.classList.add('fade-out');setTimeout(()=>el.classList.remove('active','fade-out'),450);}
function closeModal(id){$(id).classList.remove('open');}

const SUPA={URL:'https://jhpqzkwzxprsnaczkyjq.supabase.co',KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocHF6a3d6eHByc25hY3preWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTE4NTMsImV4cCI6MjA4OTc2Nzg1M30.GKJz9EhxGP1wTQBiufLoVLxWOstx-9Z0MPWHxj2c8VM'};
const GAS_URL='https://script.google.com/macros/s/AKfycby1gAE6dkwroOS6IZ_ODXf2c7E41mVLJJG62TBUolp9jLw2TJp7Attw2uakYidZHZNL/exec';
const MAX_CONCURRENT=2;
const AV_COLORS=['#2D3592','#3DBFB8','#F5A623','#22c55e','#ef4444','#818cf8','#06b6d4','#f97316','#a855f7','#ec4899'];
function avColor(n){return AV_COLORS[(n||'').charCodeAt(0)%AV_COLORS.length];}

/* ── Drivers: identified by role='driver' in staff table.
   Legacy fallback list for staff who haven't had role updated yet. */
const LEGACY_TRANSPORT_IDS=['THP012','THP013','THP014','THP024','THPG/07/2024-2','THPG/08/2012','THPG/03/2012'];
function isDriver(staffObj){return staffObj.role==='driver'||LEGACY_TRANSPORT_IDS.includes(staffObj.id);}

/* ─── Staff ID generator: THPG/MM/YYYY ───────────────────────────────────
   Given a join date string (YYYY-MM-DD), produces e.g. "THPG/01/2025".
   If multiple staff share the same month+year, a sequence counter is added:
   THPG/01/2025, THPG/01/2025-2, THPG/01/2025-3 …
   Pass existingIds array to avoid clashes.
───────────────────────────────────────────────────────────────────────── */
function generateStaffId(joinDateStr, existingIds=[]){
  if(!joinDateStr)return'';
  const d=new Date(joinDateStr);
  if(isNaN(d))return'';
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const yyyy=d.getFullYear();
  const base=`THPG/${mm}/${yyyy}`;
  if(!existingIds.includes(base))return base;
  let seq=2;
  while(existingIds.includes(`${base}-${seq}`))seq++;
  return`${base}-${seq}`;
}

const API={
  _h(){return{'apikey':SUPA.KEY,'Authorization':'Bearer '+SUPA.KEY,'Content-Type':'application/json','Prefer':'return=representation'};},
  async _q(p,o={}){
    try{
      const r=await fetch(SUPA.URL+'/rest/v1/'+p,{headers:this._h(),...o});
      if(!r.ok){console.warn('Supa error:',r.status,p);return null;}
      const t=await r.text();return t?JSON.parse(t):[];
    }catch(e){console.warn('Supa fetch:',e.message,p);return null;}
  },
  get(t,q=''){return this._q(t+(q?'?'+q:''));},ins(t,d){return this._q(t,{method:'POST',body:JSON.stringify(d)});},
  upd(t,q,d){return this._q(t+'?'+q,{method:'PATCH',body:JSON.stringify(d)});},del(t,q){return this._q(t+'?'+q,{method:'DELETE'});},
  gasPost(p){return fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(p),redirect:'follow'}).then(r=>r.json()).catch(()=>null);}
};

function saveSession(id){localStorage.setItem('td_session',JSON.stringify({id,exp:Date.now()+12*3600000}));}
function getSession(){try{const s=JSON.parse(localStorage.getItem('td_session')||'null');return(s&&s.id&&Date.now()<s.exp)?s:null;}catch(e){return null;}}
function clearSession(){localStorage.removeItem('td_session');}

/* ═══════════════════════════════════════════════
   HELPERS — route display, stop parsing
═══════════════════════════════════════════════ */
function parseStops(raw){try{return typeof raw==='string'?JSON.parse(raw):Array.isArray(raw)?raw:[];}catch(e){return[];}}
function routeChain(stops){
  if(!stops||!stops.length)return'—';
  const places=[stops[0].from||stops[0].origin||''];
  stops.forEach(s=>{const to=s.to||s.destination||'';if(to&&to!==places[places.length-1])places.push(to);});
  return places.join(' → ');
}
function routeChainHTML(stops,cls=''){
  if(!stops||!stops.length)return'<span class="route">—</span>';
  const places=[stops[0].from||stops[0].origin||''];
  stops.forEach(s=>{const to=s.to||s.destination||'';if(to&&to!==places[places.length-1])places.push(to);});
  return`<span class="${cls||'route'}">${places.map((p,i)=>i>0?`<span class="${cls?'rc-arrow':'route-arrow'}">→</span>${p}`:p).join('')}</span>`;
}

/* ═══════════════════════════════════════════════
   APP
═══════════════════════════════════════════════ */
class TripDesk{
  constructor(){this.user=null;this.staff=[];this.trips=[];this.vehicles=[];this.projects=[];this._stops=[];}

  async login(){
    const id=$('login-id').value.trim().toUpperCase(),pass=$('login-pass').value,err=$('login-err');err.textContent='';
    if(!id||!pass){err.textContent='Enter Staff ID and password.';return;}
    showLoader('Signing in…');
    try{
      const rows=await API.get('staff','id=eq.'+encodeURIComponent(id));
      if(!rows||!rows.length){hideLoader();err.textContent='Staff ID not found.';return;}
      const s=rows[0];
      // Handle password — Supabase may store as number or string
      const storedPass=s.password!==undefined?s.password:s.pass;
      if(String(storedPass).trim()!==String(pass).trim()){hideLoader();err.textContent='Incorrect password.';return;}
      saveSession(id);
      this.user={id:s.id,name:s.name,unit:(s.unit||'').trim(),role:s.role||'staff',color:s.avatar_color||avColor(s.name),email:s.email||''};
      $('lo-text').textContent='Loading trip data…';
      await this._hydrate();this._enter();
    }catch(e){
      console.error('Login error:',e);
      hideLoader();err.textContent='Connection error. Please try again.';
    }
  }

  async _hydrate(){
    const[staff,trips,veh,proj]=await Promise.all([API.get('staff','order=name'),API.get('trips','order=submitted.desc&limit=5000'),API.get('vehicles','order=plate'),API.get('projects','order=name')]);
    this.staff=(staff||[]).map(s=>({id:s.id,name:s.name,unit:(s.unit||'').trim(),role:s.role||'staff',color:s.avatar_color||avColor(s.name),email:s.email||''}));
    this.trips=(trips||[]).map(t=>({id:t.id,staffId:t.staff_id,officer:t.officer,unit:t.unit,project:t.project||'',purpose:t.purpose,stops:parseStops(t.stops),depDate:t.dep_date,retDate:t.ret_date,companions:t.companions||'',status:t.status||'pending',driver:t.driver||'',driverId:t.driver_id||'',vehicle:t.vehicle||'',vehicleId:t.vehicle_id||'',color:t.color||'',staffEmail:t.staff_email||'',adminNote:t.admin_note||'',submitted:t.submitted}));
    this.vehicles=(veh||[]).map(v=>({id:v.id,plate:v.plate,make:v.make||'',status:v.status||'available'}));
    this.projects=(proj||[]).filter(p=>p.status==='active').map(p=>({id:p.id,name:p.name,code:p.code||'',desc:p.description||'',status:p.status}));
  }

  _enter(){
    try{
      if(this.user.role==='admin'){
        this._showView('admin-view');$('ad-uname').textContent=this.user.name;this._populateUnitFilter();
        this.renderDash();this.renderPending();this.renderAllTrips();this.renderVehicles();this.renderProjects();this.renderStaff();this._renderCal();
      }else{
        this._showView('staff-view');$('st-uname').textContent=this.user.name;
        const av=$('st-av');if(av){av.textContent=ini(this.user.name);av.style.background=this.user.color;}
        const me=this.staff.find(s=>s.id===this.user.id);
        if(me&&isDriver(me)){$('staff-tabs').children[0].style.display='none';this.showTab('staff','mytrips',$('staff-tabs').children[1]);}
        this._populateProjects();this._initStops();this.renderMyTrips();
      }
    }catch(e){console.error('_enter error:',e);}
    hideLoader();
  }

  logout(){
    clearSession();this.user=null;
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const lv=$('login-view');if(lv){lv.style.display='';lv.classList.add('active');}
    const bg=document.querySelector('.login-bg');if(bg)bg.style.display='';
  }
  _showView(id){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const target=$(id);if(target)target.classList.add('active');
    const bg=document.querySelector('.login-bg');
    if(bg)bg.style.display=(id==='login-view')?'':'none';
  }
  showTab(scope,name,btn){const p=$(scope+'-'+name)?.closest('.main-content');if(p)p.querySelectorAll('.tabpanel').forEach(x=>x.classList.remove('active'));$(scope+'-'+name)?.classList.add('active');const tabs=$(scope+'-tabs');if(tabs)tabs.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));if(btn)btn.classList.add('active');}
  _populateProjects(){const sel=$('tr-project');if(!sel)return;sel.innerHTML='<option value="">— Select project —</option>'+this.projects.map(p=>`<option value="${p.name}">${p.name}${p.code?' ('+p.code+')':''}</option>`).join('');}
  _populateUnitFilter(){const sel=$('ad-trip-unit');if(!sel)return;const u=[...new Set(this.staff.map(s=>s.unit).filter(Boolean))].sort();sel.innerHTML='<option value="">All Units</option>'+u.map(x=>`<option>${x}</option>`).join('');}

  /* ═══════════════════════════════════════════════
     MULTI-STOP ITINERARY BUILDER
  ═══════════════════════════════════════════════ */
  _initStops(){this._stops=[{from:'Accra',to:'',dep:'',ret:''}];this._renderStops();}

  addStop(){
    const prev=this._stops[this._stops.length-1];
    this._stops.push({from:prev.to||'',to:'',dep:prev.ret||'',ret:''});
    this._renderStops();
  }

  removeStop(i){
    if(this._stops.length<=1)return;
    this._stops.splice(i,1);
    for(let j=1;j<this._stops.length;j++)this._stops[j].from=this._stops[j-1].to||'';
    this._renderStops();
  }

  _onStopChange(i,field,val){
    this._stops[i][field]=val;
    // Auto-chain next stop's "from" when "to" changes
    if(field==='to'&&i<this._stops.length-1){
      this._stops[i+1].from=val;
      const nextFrom=document.querySelector(`#stop-from-${i+1}`);
      if(nextFrom)nextFrom.value=val;
    }
    // Auto-chain next stop's "dep" when "ret" changes
    if(field==='ret'&&i<this._stops.length-1&&!this._stops[i+1].dep){
      this._stops[i+1].dep=val;
      const nextDep=document.querySelector(`#stop-dep-${i+1}`);
      if(nextDep)nextDep.value=val;
    }
    this._updateSummary();
  }

  _renderStops(){
    const box=$('stops-list');if(!box)return;
    box.innerHTML=this._stops.map((s,i)=>`<div class="stop-card">
      <div class="stop-num">STOP ${i+1}</div>
      ${this._stops.length>1?`<button class="stop-remove" onclick="TD.removeStop(${i})" title="Remove stop">✕</button>`:''}
      <div class="stop-row">
        <div class="field"><label>From</label><input id="stop-from-${i}" value="${s.from||''}" ${i>0?'readonly style="background:#eee;cursor:not-allowed"':''} oninput="TD._onStopChange(${i},'from',this.value)" placeholder="Origin"></div>
        <div class="stop-arrow">→</div>
        <div class="field"><label>To</label><input id="stop-to-${i}" value="${s.to||''}" oninput="TD._onStopChange(${i},'to',this.value)" placeholder="Destination"></div>
      </div>
      <div class="stop-dates">
        <div class="field"><label>Depart</label><input id="stop-dep-${i}" type="date" value="${s.dep||''}" onchange="TD._onStopChange(${i},'dep',this.value)"></div>
        <div class="field"><label>Return / Arrive</label><input id="stop-ret-${i}" type="date" value="${s.ret||''}" onchange="TD._onStopChange(${i},'ret',this.value)"></div>
      </div>
    </div>`).join('');
  }

  _updateSummary(){
    const box=$('tr-summary');if(!box)return;
    const valid=this._stops.filter(s=>s.from&&s.to&&s.dep&&s.ret);
    if(!valid.length){box.style.display='none';return;}
    const places=[valid[0].from];valid.forEach(s=>{if(s.to&&s.to!==places[places.length-1])places.push(s.to);});
    const dep=valid[0].dep,ret=valid[valid.length-1].ret;
    box.innerHTML=`<div class="route-chain">${places.map((p,i)=>i>0?`<span class="rc-arrow">→</span>${p}`:p).join('')}</div>
      <strong>${valid.length} stop${valid.length>1?'s':''}</strong> · ${fmt(dep)} → ${fmt(ret)}`;
    box.style.display='block';
  }

  /* ═══════════════════════════════════════════════
     SUBMIT TRIP
  ═══════════════════════════════════════════════ */
  async submitTrip(){
    const project=$('tr-project')?.value,purpose=$('tr-purpose')?.value.trim(),companions=$('tr-companions')?.value.trim();
    const err=$('tr-err');err.textContent='';
    if(!project)return err.textContent='Select a project.';
    if(!purpose)return err.textContent='Describe the purpose.';

    const stops=this._stops.map(s=>({from:(s.from||'').trim(),to:(s.to||'').trim(),depDate:s.dep,retDate:s.ret}));
    for(let i=0;i<stops.length;i++){
      const s=stops[i];
      if(!s.from)return err.textContent=`Stop ${i+1}: Enter origin (From).`;
      if(!s.to)return err.textContent=`Stop ${i+1}: Enter destination (To).`;
      if(!s.depDate)return err.textContent=`Stop ${i+1}: Select departure date.`;
      if(!s.retDate)return err.textContent=`Stop ${i+1}: Select return/arrival date.`;
      if(new Date(s.retDate)<new Date(s.depDate))return err.textContent=`Stop ${i+1}: Return must be after departure.`;
      if(i>0&&new Date(s.depDate)<new Date(stops[i-1].retDate))return err.textContent=`Stop ${i+1}: Departure can't be before previous stop's return.`;
    }

    const depDate=stops[0].depDate,retDate=stops[stops.length-1].retDate;

    const clashes=this.trips.filter(b=>b.status!=='rejected'&&new Date(depDate)<=new Date(b.retDate)&&new Date(retDate)>=new Date(b.depDate));
    if(clashes.length>=MAX_CONCURRENT){$('tr-clash').innerHTML='⚠ <strong>Schedule conflict:</strong> '+clashes.length+' trips overlap. Max '+MAX_CONCURRENT+' concurrent.';$('tr-clash').style.display='block';return err.textContent='Too many overlapping trips.';}
    $('tr-clash').style.display='none';

    const id='TRIP'+Date.now();
    const trip={id,staff_id:this.user.id,officer:this.user.name,unit:this.user.unit,project,purpose,stops:JSON.stringify(stops),dep_date:depDate,ret_date:retDate,companions,status:'pending',color:this.user.color,staff_email:this.user.email};
    const r=await API.ins('trips',trip);
    if(!r){toast('Server error','err');return;}

    this.trips.unshift({id,staffId:this.user.id,officer:this.user.name,unit:this.user.unit,project,purpose,stops,depDate,retDate,companions,status:'pending',color:this.user.color,staffEmail:this.user.email,driver:'',vehicle:'',submitted:new Date().toISOString(),adminNote:''});
    $('tr-project').value='';$('tr-purpose').value='';$('tr-companions').value='';
    this._initStops();$('tr-summary').style.display='none';
    this.renderMyTrips();toast('Trip request submitted!');
    API.gasPost({action:'addTrip',data:{...trip,stops,depDate,retDate,route:routeChain(stops)}}).catch(()=>{});
  }

  /* ═══════════════════════════════════════════════
     STAFF — My Trips (card view + timeline)
  ═══════════════════════════════════════════════ */
  renderMyTrips(){
    const box=$('st-trips-cards');if(!box)return;
    const mine=this.trips.filter(t=>t.staffId===this.user.id);
    if(!mine.length){box.innerHTML='<div class="card" style="text-align:center;color:var(--text3);padding:2rem">No trips yet — submit your first request! 🚗</div>';return;}
    box.innerHTML=mine.map(t=>{
      const stops=parseStops(t.stops);
      return`<div class="trip-card">
        <div class="trip-card-badge">${this._badge(t.status)}</div>
        <div class="trip-card-route"><div class="route-chain">${routeChainHTML(stops,'route-chain')}</div></div>
        <div class="trip-card-meta">
          <strong>Project:</strong> ${t.project||'—'} · <strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)} · <strong>${stops.length} stop${stops.length!==1?'s':''}</strong><br>
          <strong>Purpose:</strong> ${t.purpose||'—'}<br>
          ${t.driver?'<strong>Driver:</strong> '+t.driver+' · ':''}${t.vehicle?'<strong>Vehicle:</strong> '+t.vehicle:''}
          ${t.adminNote?'<br><strong>Note:</strong> <em>'+t.adminNote+'</em>':''}
        </div>
        ${this._timeline(t)}
      </div>`;
    }).join('');
  }

  _timeline(t){
    const s=t.status;
    const steps=[{label:'Submitted',done:true},{label:'Under Review',done:s==='approved'||s==='rejected',active:s==='pending'},s==='rejected'?{label:'Rejected',rej:true}:{label:'Approved',done:s==='approved'}];
    return'<div class="trip-timeline">'+steps.map((st,i)=>{
      const cls=st.rej?'rej':st.done?'done':st.active?'active':'';
      return(i>0?'<div class="tl-line'+(steps[i-1].done?' done':'')+'"></div>':'')+`<div class="tl-step ${cls}"><div class="tl-dot"></div>${st.label}</div>`;
    }).join('')+'</div>';
  }

  _badge(s){return s==='approved'?'<span class="badge b-approved">✓ Approved</span>':s==='rejected'?'<span class="badge b-rejected">✗ Rejected</span>':'<span class="badge b-pending">⏳ Pending</span>';}

  /* ═══════════════════════════════════════════════
     ADMIN — Dashboard
  ═══════════════════════════════════════════════ */
  renderDash(){
    const total=this.trips.length,pend=this.trips.filter(t=>t.status==='pending').length,appr=this.trips.filter(t=>t.status==='approved').length;
    $('ad-stats').innerHTML=`
      <div class="stat"><div class="stat-lbl">Total</div><div class="stat-val" style="color:var(--purple)">${total}</div></div>
      <div class="stat"><div class="stat-lbl">Pending</div><div class="stat-val" style="color:var(--gold)">${pend}</div></div>
      <div class="stat"><div class="stat-lbl">Approved</div><div class="stat-val" style="color:var(--green)">${appr}</div></div>
      <div class="stat"><div class="stat-lbl">Vehicles</div><div class="stat-val" style="color:var(--teal)">${this.vehicles.length}</div></div>
      <div class="stat"><div class="stat-lbl">Projects</div><div class="stat-val" style="color:var(--dark)">${this.projects.length}</div></div>`;
    const body=$('ad-recent-body');const recent=this.trips.slice(0,8);
    body.innerHTML=recent.length?recent.map(t=>`<tr><td><strong>${t.officer}</strong></td><td>${routeChainHTML(parseStops(t.stops))}</td><td style="font-size:.7rem">${t.project||'—'}</td><td style="font-size:.7rem">${fmt(t.depDate)} → ${fmt(t.retDate)}</td><td>${this._badge(t.status)}</td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">No trips yet</td></tr>';
    const uMap={};this.trips.forEach(t=>{uMap[t.unit]=(uMap[t.unit]||0)+1;});const uArr=Object.entries(uMap).sort((a,b)=>b[1]-a[1]);const mx=uArr.length?uArr[0][1]:1;
    $('ad-unit-chart').innerHTML=uArr.length?uArr.map(([u,c])=>`<div class="unit-bar"><div class="unit-bar-label"><span>${u}</span><strong>${c}</strong></div><div class="unit-bar-track"><div class="unit-bar-fill" style="width:${Math.round(c/mx*100)}%"></div></div></div>`).join(''):'<div style="color:var(--text3);font-size:.75rem;text-align:center;padding:1rem">No data</div>';
    const badge=$('ad-pending-badge');if(badge){badge.textContent=pend;badge.classList.toggle('show',pend>0);}
  }

  /* ═══════════════════════════════════════════════
     ADMIN — Pending
  ═══════════════════════════════════════════════ */
  renderPending(){
    const list=$('ad-pending-list');if(!list)return;
    const pend=this.trips.filter(t=>t.status==='pending');
    if(!pend.length){list.innerHTML='<div style="text-align:center;color:var(--text3);padding:1.5rem">No pending requests 🎉</div>';return;}
    list.innerHTML=pend.map(t=>{
      const stops=parseStops(t.stops);
      const stopsHTML=stops.length?`<div class="pend-stops">${stops.map((s,i)=>`<div class="pend-stop"><strong>${i+1}.</strong> ${s.from||'—'} <span class="pend-stop-arrow">→</span> ${s.to||'—'} <span style="color:var(--text3);font-size:.65rem">(${fmt(s.depDate)} → ${fmt(s.retDate)})</span></div>`).join('')}</div>`:'';
      return`<div class="pend-card">
        <h4>${t.officer}: ${routeChain(stops)}</h4>
        <div class="pend-meta"><strong>Project:</strong> ${t.project||'—'} · <strong>Unit:</strong> ${t.unit}<br><strong>Purpose:</strong> ${t.purpose||'—'}<br><strong>Overall:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}${t.companions?' · <strong>With:</strong> '+t.companions:''}</div>
        ${stopsHTML}
        <div class="pend-actions"><button class="btn-sm btn-green" onclick="TD.openTripModal('${t.id}')">👁 Review & Decide</button></div>
      </div>`;
    }).join('');
  }

  openTripModal(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const stops=parseStops(t.stops);
    $('tm-title').textContent='Review: '+routeChain(stops);
    $('tm-info').innerHTML=`<strong>Officer:</strong> ${t.officer} (${t.unit})<br><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose}<br><strong>Overall:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br>${t.companions?'<strong>Companions:</strong> '+t.companions+'<br>':''}<strong>Submitted:</strong> ${fmt(t.submitted)}`;
    $('tm-stops').innerHTML=stops.length>0?`<div style="font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:.3rem">Itinerary (${stops.length} stop${stops.length!==1?'s':''})</div>`+stops.map((s,i)=>`<div style="display:flex;align-items:center;gap:.4rem;padding:.25rem .5rem;background:var(--surf2);border-radius:6px;margin-bottom:.25rem;font-size:.74rem"><strong style="color:var(--purple)">${i+1}.</strong> ${s.from} <span style="color:var(--teal);font-weight:800">→</span> ${s.to} <span style="color:var(--text3);margin-left:auto;font-size:.65rem">${fmt(s.depDate)} → ${fmt(s.retDate)}</span></div>`).join(''):'';
    const drivers=this.staff.filter(s=>isDriver(s));
    $('tm-driver').innerHTML='<option value="">— Select driver —</option>'+drivers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('');
    $('tm-vehicle').innerHTML='<option value="">— Select vehicle —</option>'+this.vehicles.map(v=>`<option value="${v.id}">${v.plate} — ${v.make}</option>`).join('');
    $('tm-note').value='';$('tm-id').value=id;$('trip-modal').classList.add('open');
  }

  async decideTrip(status){
    const id=$('tm-id').value,t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const dId=$('tm-driver').value,vId=$('tm-vehicle').value,note=$('tm-note').value.trim();
    const dName=dId?this.staff.find(s=>s.id===dId)?.name:'';
    const veh=vId?this.vehicles.find(v=>v.id===vId):null;const vLabel=veh?veh.plate+' — '+(veh.make||''):'';
    await API.upd('trips','id=eq.'+encodeURIComponent(id),{status,driver:dName||'',driver_id:dId||'',vehicle:vLabel,vehicle_id:vId||'',admin_note:note,updated_at:new Date().toISOString()});
    t.status=status;t.driver=dName;t.vehicle=vLabel;t.adminNote=note;
    closeModal('trip-modal');this.renderDash();this.renderPending();this.renderAllTrips();this._renderCal();
    toast(status==='approved'?'Trip approved ✓':'Trip rejected');
    API.gasPost({action:'updateTrip',data:{id,status,driver:dName,vehicle:vLabel,staffEmail:t.staffEmail,officer:t.officer,route:routeChain(parseStops(t.stops)),purpose:t.purpose,depDate:t.depDate,retDate:t.retDate,driverEmail:dId?(this.staff.find(s=>s.id===dId)?.email||''):''}}).catch(()=>{});
  }

  /* ═══════════════════════════════════════════════
     ADMIN — All Trips, Export, Delete
  ═══════════════════════════════════════════════ */
  renderAllTrips(){
    const body=$('ad-all-body');if(!body)return;
    const sf=$('ad-trip-status')?.value||'',uf=$('ad-trip-unit')?.value||'',mf=$('ad-trip-month')?.value||'';
    let list=this.trips.slice();
    if(sf)list=list.filter(t=>t.status===sf);if(uf)list=list.filter(t=>t.unit===uf);
    if(mf){const[y,m]=mf.split('-').map(Number);list=list.filter(t=>{const d=new Date(t.depDate);return d.getFullYear()===y&&d.getMonth()===m-1;});}
    $('ad-trip-count').textContent=list.length;
    if(!list.length){body.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:1.5rem">No trips match</td></tr>';return;}
    body.innerHTML=list.map(t=>{const stops=parseStops(t.stops);return`<tr>
      <td><strong>${t.officer}</strong></td><td style="font-size:.68rem">${t.unit}</td><td style="font-size:.68rem">${t.project||'—'}</td>
      <td>${routeChainHTML(stops)}</td><td style="font-size:.68rem;white-space:nowrap">${fmt(t.depDate)} → ${fmt(t.retDate)}</td>
      <td style="text-align:center">${stops.length}</td><td>${this._badge(t.status)}</td><td style="font-size:.68rem">${t.driver||'—'}</td><td style="font-size:.68rem">${t.vehicle||'—'}</td>
      <td>${t.status==='pending'?`<button class="btn-sm btn-teal" onclick="TD.openTripModal('${t.id}')">Review</button>`:`<button class="btn-sm btn-outline" onclick="TD.deleteTrip('${t.id}')">🗑</button>`}</td>
    </tr>`;}).join('');
  }
  async deleteTrip(id){if(!confirm('Delete this trip?'))return;await API.del('trips','id=eq.'+encodeURIComponent(id));this.trips=this.trips.filter(t=>t.id!==id);this.renderDash();this.renderAllTrips();this._renderCal();toast('Deleted');}
  exportCSV(){
    let csv='Officer,Unit,Project,Route,Stops,Purpose,Departure,Return,Status,Driver,Vehicle,Submitted\n';
    this.trips.forEach(t=>{csv+=`"${t.officer}","${t.unit}","${t.project||''}","${routeChain(parseStops(t.stops))}","${parseStops(t.stops).length}","${t.purpose||''}","${fmt(t.depDate)}","${fmt(t.retDate)}","${t.status}","${t.driver||''}","${t.vehicle||''}","${fmt(t.submitted)}"\n`;});
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='TripDesk_'+Date.now()+'.csv';a.click();
  }

  /* ═══════════════════════════════════════════════
     Vehicles & Projects
  ═══════════════════════════════════════════════ */
  renderVehicles(){const b=$('ad-veh-body');if(!b)return;b.innerHTML=this.vehicles.length?this.vehicles.map(v=>`<tr><td><strong>${v.plate}</strong></td><td>${v.make||'—'}</td><td><span class="badge b-approved">${v.status}</span></td><td><button class="btn-sm btn-red" onclick="TD.deleteVehicle('${v.id}')">🗑</button></td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1.5rem">No vehicles</td></tr>';}
  async addVehicle(){const p=$('v-plate')?.value.trim().toUpperCase(),m=$('v-make')?.value.trim();if(!p){toast('Enter plate','err');return;}const id='VEH'+Date.now();await API.ins('vehicles',{id,plate:p,make:m,status:'available'});this.vehicles.push({id,plate:p,make:m,status:'available'});$('v-plate').value='';$('v-make').value='';this.renderVehicles();toast('Added');}
  async deleteVehicle(id){if(!confirm('Remove?'))return;await API.del('vehicles','id=eq.'+encodeURIComponent(id));this.vehicles=this.vehicles.filter(v=>v.id!==id);this.renderVehicles();toast('Removed');}

  renderProjects(){const b=$('ad-proj-body');if(!b)return;API.get('projects','order=name').then(rows=>{const all=(rows||[]).map(p=>({id:p.id,name:p.name,code:p.code||'',desc:p.description||'',status:p.status||'active'}));b.innerHTML=all.length?all.map(p=>`<tr><td><strong>${p.name}</strong></td><td style="font-size:.72rem">${p.code||'—'}</td><td style="font-size:.72rem;color:var(--text2)">${p.desc||'—'}</td><td><span class="badge ${p.status==='active'?'b-approved':'b-rejected'}">${p.status}</span></td><td><button class="btn-sm btn-outline" onclick="TD.toggleProject('${p.id}','${p.status}')">${p.status==='active'?'Deactivate':'Activate'}</button> <button class="btn-sm btn-red" onclick="TD.deleteProject('${p.id}')">🗑</button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">No projects</td></tr>';});}
  async addProject(){const n=$('pj-name')?.value.trim(),c=$('pj-code')?.value.trim(),d=$('pj-desc')?.value.trim(),msg=$('pj-msg');if(msg)msg.textContent='';if(!n){if(msg)msg.innerHTML='<span style="color:var(--red)">Name required.</span>';return;}await API.ins('projects',{id:'PJ'+Date.now(),name:n,code:c,description:d,status:'active'});this.projects.push({id:'PJ'+Date.now(),name:n,code:c,desc:d,status:'active'});$('pj-name').value='';$('pj-code').value='';$('pj-desc').value='';this.renderProjects();this._populateProjects();toast('Added');}
  async toggleProject(id,cur){const ns=cur==='active'?'inactive':'active';await API.upd('projects','id=eq.'+encodeURIComponent(id),{status:ns});this.projects=this.projects.filter(p=>p.id!==id);if(ns==='active'){const r=await API.get('projects','id=eq.'+encodeURIComponent(id));if(r&&r[0])this.projects.push({id:r[0].id,name:r[0].name,code:r[0].code||'',desc:r[0].description||'',status:'active'});}this.renderProjects();this._populateProjects();toast(ns);}
  async deleteProject(id){if(!confirm('Delete?'))return;await API.del('projects','id=eq.'+encodeURIComponent(id));this.projects=this.projects.filter(p=>p.id!==id);this.renderProjects();this._populateProjects();toast('Deleted');}

  /* ═══════════════════════════════════════════════
     ADMIN — Staff (Directory + Add Staff)
  ═══════════════════════════════════════════════ */

  /** Preview / generate the Staff ID field when join date changes */
  previewStaffId(){
    const dateVal=$('ns-joindate')?.value;
    const existingIds=this.staff.map(s=>s.id);
    const generated=generateStaffId(dateVal,existingIds);
    const idField=$('ns-id');
    const hint=$('ns-id-hint');
    if(idField&&generated){
      idField.value=generated;
      if(hint)hint.textContent=`Auto-generated from join date · format THPG/MM/YYYY`;
    }else if(hint){
      hint.textContent='Select a join date to auto-generate';
    }
  }

  toggleAddStaffForm(){
    const form=$('add-staff-form'),btn=$('add-staff-toggle');
    if(!form)return;
    const open=form.style.display==='block';
    form.style.display=open?'none':'block';
    if(btn)btn.textContent=open?'▼ Expand':'▲ Collapse';
  }

  clearAddStaffForm(){
    ['ns-name','ns-joindate','ns-id','ns-unit','ns-email','ns-pass'].forEach(id=>{const el=$(id);if(el)el.value='';});
    const role=$('ns-role');if(role)role.value='staff';
    const msg=$('ns-msg');if(msg)msg.textContent='';
    const hint=$('ns-id-hint');if(hint)hint.textContent='';
    $('ns-pass').value='1234';
  }

  async addStaff(){
    const msg=$('ns-msg');if(msg)msg.textContent='';
    const name=$('ns-name')?.value.trim();
    const joinDate=$('ns-joindate')?.value;
    const idVal=$('ns-id')?.value.trim().toUpperCase();
    const unit=$('ns-unit')?.value.trim();
    const email=$('ns-email')?.value.trim();
    const role=$('ns-role')?.value||'staff';
    const pass=$('ns-pass')?.value||'1234';

    // Validate
    if(!name){if(msg)msg.innerHTML='<span style="color:var(--red)">Full name is required.</span>';return;}
    if(!idVal){if(msg)msg.innerHTML='<span style="color:var(--red)">Staff ID is required. Select a join date or enter manually.</span>';return;}
    if(!unit){if(msg)msg.innerHTML='<span style="color:var(--red)">Unit / Programme is required.</span>';return;}
    if(pass.length<4){if(msg)msg.innerHTML='<span style="color:var(--red)">Password must be at least 4 characters.</span>';return;}

    // Check duplicate ID
    if(this.staff.find(s=>s.id===idVal)){
      if(msg)msg.innerHTML=`<span style="color:var(--red)">Staff ID <strong>${idVal}</strong> already exists. Use a different join date or edit the ID.</span>`;
      return;
    }

    const color=avColor(name);
    const newStaff={id:idVal,name,unit,role,email:email||'',password:pass,avatar_color:color,join_date:joinDate||null};
    showLoader('Adding staff member…');
    const r=await API.ins('staff',newStaff);
    hideLoader();
    if(!r){toast('Failed to add staff. Check Supabase.','err');return;}

    // Update local cache
    this.staff.push({id:idVal,name,unit,role,color,email:email||''});
    this.staff.sort((a,b)=>a.name.localeCompare(b.name));

    if(msg)msg.innerHTML=`<span style="color:var(--green)">✓ Staff member <strong>${name}</strong> added with ID <strong>${idVal}</strong>.</span>`;
    this.clearAddStaffForm();
    // Collapse form after success
    $('add-staff-form').style.display='none';
    const btn=$('add-staff-toggle');if(btn)btn.textContent='▼ Expand';
    this.renderStaff();
    this._populateUnitFilter();
    toast(`${name} added ✓`);
  }

  renderStaff(){
    const g=$('ad-staff-grid');if(!g)return;
    const search=($('staff-search')?.value||'').toLowerCase();
    const roleFilter=$('staff-role-filter')?.value||'';

    let list=this.staff.slice();
    if(search)list=list.filter(s=>s.name.toLowerCase().includes(search)||s.id.toLowerCase().includes(search)||s.unit.toLowerCase().includes(search));
    if(roleFilter)list=list.filter(s=>s.role===roleFilter);

    if(!list.length){g.innerHTML='<div style="color:var(--text3);font-size:.8rem;padding:.5rem;grid-column:1/-1">No staff match your search.</div>';return;}

    g.innerHTML=list.map(s=>{
      const driverTag=isDriver(s)?'<span class="badge b-approved" style="font-size:.55rem;padding:1px 5px">Driver</span>':'';
      const adminTag=s.role==='admin'?'<span class="badge b-pending" style="font-size:.55rem;padding:1px 5px">Admin</span>':'';
      const roleBadge=driverTag||adminTag;
      return`<div class="scard">
        <div class="scard-top">
          <div class="av" style="background:${s.color}">${ini(s.name)}</div>
          <div>
            <div class="s-name">${s.name}</div>
            <div class="s-id" style="font-size:.6rem;font-family:monospace;color:var(--teal);font-weight:600">${s.id}</div>
          </div>
        </div>
        <div class="s-unit">${s.unit||'—'} ${roleBadge}</div>
        ${s.email?`<div style="font-size:.6rem;color:var(--text3);margin-bottom:.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.email}">✉ ${s.email}</div>`:''}
        <div class="scard-btns">
          <button class="btn-sm btn-outline" onclick="TD.resetStaffPass('${s.id}')">🔑 Reset</button>
          ${s.role!=='admin'?`<button class="btn-sm ${isDriver(s)?'btn-teal':'btn-outline'}" onclick="TD.toggleDriverRole('${s.id}')">${isDriver(s)?'✓ Driver':'Set Driver'}</button>`:''}
          <button class="btn-sm btn-red" onclick="TD.removeStaff('${s.id}','${s.name.replace(/'/g,'')}')">🗑</button>
        </div>
      </div>`;
    }).join('');
  }

  async resetStaffPass(id){if(!confirm('Reset password to "1234"?'))return;await API.upd('staff','id=eq.'+encodeURIComponent(id),{password:'1234'});toast('Password reset to 1234');}

  async toggleDriverRole(id){
    const s=this.staff.find(x=>x.id===id);if(!s)return;
    const currentlyDriver=isDriver(s);
    const newRole=currentlyDriver?'staff':'driver';
    if(!confirm(`${currentlyDriver?'Remove driver role from':'Set as driver:'} ${s.name}?`))return;
    await API.upd('staff','id=eq.'+encodeURIComponent(id),{role:newRole});
    s.role=newRole;
    this.renderStaff();
    toast(s.name+' is now '+(newRole==='driver'?'a Driver':'Staff'));
  }

  async removeStaff(id,name){
    if(!confirm(`Remove ${name} (${id}) from TripDesk?\n\nThis does not delete their trip history.`))return;
    showLoader('Removing…');
    await API.del('staff','id=eq.'+encodeURIComponent(id));
    hideLoader();
    this.staff=this.staff.filter(s=>s.id!==id);
    this.renderStaff();
    this._populateUnitFilter();
    toast(`${name} removed`);
  }

  async changePass(){const old=$('st-old-pw')?.value,np=$('st-new-pw')?.value,conf=$('st-conf-pw')?.value,msg=$('st-pw-msg');msg.textContent='';if(!old||!np||!conf){msg.innerHTML='<span style="color:var(--red)">Fill all fields.</span>';return;}if(np.length<4){msg.innerHTML='<span style="color:var(--red)">Min 4 chars.</span>';return;}if(np!==conf){msg.innerHTML='<span style="color:var(--red)">Don\'t match.</span>';return;}const rows=await API.get('staff','id=eq.'+encodeURIComponent(this.user.id));if(!rows?.length||String(rows[0].password)!==String(old)){msg.innerHTML='<span style="color:var(--red)">Wrong password.</span>';return;}await API.upd('staff','id=eq.'+encodeURIComponent(this.user.id),{password:np});msg.innerHTML='<span style="color:var(--green)">✓ Changed!</span>';$('st-old-pw').value='';$('st-new-pw').value='';$('st-conf-pw').value='';toast('Updated');}

  /* ═══════════════════════════════════════════════
     Calendar
  ═══════════════════════════════════════════════ */
  _calM=new Date().getMonth();_calY=new Date().getFullYear();
  _renderCal(){
    const box=$('ad-calendar');if(!box)return;
    const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const m=this._calM,y=this._calY,first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),todayStr=new Date().toISOString().slice(0,10);
    let h=`<div class="cal-nav"><button onclick="TD._calM--;if(TD._calM<0){TD._calM=11;TD._calY--;}TD._renderCal()">◀</button><span>${MN[m]} ${y}</span><button onclick="TD._calM++;if(TD._calM>11){TD._calM=0;TD._calY++;}TD._renderCal()">▶</button></div><div class="cal-grid">`;
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{h+=`<div class="cal-hdr">${d}</div>`;});
    for(let i=0;i<first;i++)h+='<div class="cal-day" style="background:transparent;border:none"></div>';
    for(let d=1;d<=days;d++){
      const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayTrips=[];this.trips.forEach(t=>{if(t.status==='rejected')return;parseStops(t.stops).forEach(s=>{if(ds>=s.depDate&&ds<=s.retDate&&!dayTrips.find(x=>x.id===t.id))dayTrips.push(t);});});
      h+=`<div class="cal-day${ds===todayStr?' today':''}"><div class="cal-num">${d}</div>`;
      dayTrips.slice(0,2).forEach(t=>{h+=`<span class="cal-trip" style="background:${t.color||'var(--purple)'}" title="${t.officer}: ${routeChain(parseStops(t.stops))}">${t.officer.split(' ')[0]}</span>`;});
      if(dayTrips.length>2)h+=`<span style="font-size:.5rem;color:var(--text3)">+${dayTrips.length-2}</span>`;
      h+='</div>';
    }
    h+='</div>';box.innerHTML=h;
  }

  /* ── Staff Availability Calendar ── */
  _stCalM=new Date().getMonth();_stCalY=new Date().getFullYear();
  _renderStaffCal(){
    const box=$('st-calendar');if(!box)return;
    const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const m=this._stCalM,y=this._stCalY,first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),todayStr=new Date().toISOString().slice(0,10);
    let h=`<div class="cal-nav"><button onclick="TD._stCalM--;if(TD._stCalM<0){TD._stCalM=11;TD._stCalY--;}TD._renderStaffCal()">◀</button><span>${MN[m]} ${y}</span><button onclick="TD._stCalM++;if(TD._stCalM>11){TD._stCalM=0;TD._stCalY++;}TD._renderStaffCal()">▶</button></div>`;
    h+=`<div style="display:flex;gap:.8rem;justify-content:center;margin-bottom:.6rem;font-size:.65rem;font-weight:600">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#dcfce7;border:1px solid #86efac;vertical-align:middle;margin-right:3px"></span>Available</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#fef9c3;border:1px solid #fde047;vertical-align:middle;margin-right:3px"></span>1 Trip</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#fecaca;border:1px solid #f87171;vertical-align:middle;margin-right:3px"></span>Fully Booked</span>
    </div>`;
    h+='<div class="cal-grid">';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{h+=`<div class="cal-hdr">${d}</div>`;});
    for(let i=0;i<first;i++)h+='<div class="cal-day" style="background:transparent;border:none"></div>';
    for(let d=1;d<=days;d++){
      const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayTrips=[];this.trips.forEach(t=>{if(t.status==='rejected')return;parseStops(t.stops).forEach(s=>{if(ds>=s.depDate&&ds<=s.retDate&&!dayTrips.find(x=>x.id===t.id))dayTrips.push(t);});});
      const count=dayTrips.length;
      const bg=count>=MAX_CONCURRENT?'#fecaca':count===1?'#fef9c3':ds>=todayStr?'#dcfce7':'';
      const border=count>=MAX_CONCURRENT?'#f87171':count===1?'#fde047':ds===todayStr?'var(--teal)':'var(--surf2)';
      h+=`<div class="cal-day" style="background:${bg};border-color:${border}"><div class="cal-num">${d}</div>`;
      if(count>=MAX_CONCURRENT)h+=`<span style="font-size:.5rem;font-weight:700;color:#991b1b">FULL</span>`;
      else if(count===1)h+=`<span style="font-size:.5rem;color:#92400e">${dayTrips[0].officer.split(' ')[0]}</span>`;
      h+='</div>';
    }
    h+='</div>';box.innerHTML=h;
  }
}

const TD=new TripDesk();

(async function(){
  const s=getSession();if(!s)return;
  showLoader('Restoring session…');
  const lv=$('login-view');if(lv)lv.style.display='none';
  const bg=document.querySelector('.login-bg');if(bg)bg.style.display='none';
  try{
    const staff=await API.get('staff','id=eq.'+encodeURIComponent(s.id));
    if(!staff||!staff.length){
      clearSession();hideLoader();
      if(lv){lv.style.display='';lv.classList.add('active');}
      if(bg)bg.style.display='';
      return;
    }
    const u=staff[0];
    TD.user={id:u.id,name:u.name,unit:(u.unit||'').trim(),role:u.role||'staff',color:u.avatar_color||avColor(u.name),email:u.email||''};
    $('lo-text').textContent='Loading trip data…';
    await TD._hydrate();
    TD._enter();
  }catch(e){
    console.error('Session restore error:',e);
    clearSession();hideLoader();
    if(lv){lv.style.display='';lv.classList.add('active');}
    if(bg)bg.style.display='';
  }
})();
