/* ═══════════════════════════════════════════════════════════
   THP-GHANA TRIPDESK v6
   · Password: SHA-256 hashed (matches Attendance system)
   · Supervisor: full trip request + availability + my trips
   · Car animation: right → left
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

const LEGACY_DRIVER_IDS=['THP012','THP013','THP014','THP024','THPG/07/2024-2','THPG/08/2012','THPG/03/2012'];
function isDriver(s){return s.role==='driver'||LEGACY_DRIVER_IDS.includes(s.id);}
function isSupervisor(s){return s.role==='supervisor';}

function generateStaffId(joinDateStr,existingIds=[]){
  if(!joinDateStr)return'';const d=new Date(joinDateStr);if(isNaN(d))return'';
  const mm=String(d.getMonth()+1).padStart(2,'0'),yyyy=d.getFullYear();
  const base=`THPG/${mm}/${yyyy}`;if(!existingIds.includes(base))return base;
  let seq=2;while(existingIds.includes(`${base}-${seq}`))seq++;return`${base}-${seq}`;
}

/* ── Password hashing — SHA-256 ──────────────────────────────
   The Attendance system stores passwords as SHA-256 hex hashes
   (confirmed: 64-char hex strings in the `password` column).
   TripDesk must hash the entered password the same way before
   comparing or storing. Uses the browser's built-in SubtleCrypto
   API — no external libraries needed.
────────────────────────────────────────────────────────────── */
async function hashPassword(plain){
  const encoded=new TextEncoder().encode(String(plain).trim());
  const buf=await crypto.subtle.digest('SHA-256',encoded);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function extractPw(row){
  const v=row.password??row.pass??row.passwd??'';
  return String(v).trim();
}

const API={
  _h(){return{'apikey':SUPA.KEY,'Authorization':'Bearer '+SUPA.KEY,'Content-Type':'application/json','Prefer':'return=representation'};},
  async _q(p,o={}){
    try{const r=await fetch(SUPA.URL+'/rest/v1/'+p,{headers:this._h(),...o});if(!r.ok){console.warn('Supa',r.status,p);return null;}const t=await r.text();return t?JSON.parse(t):[];}
    catch(e){console.warn('Supa fetch',e.message);return null;}
  },
  get(t,q=''){return this._q(t+(q?'?'+q:''));},
  ins(t,d){return this._q(t,{method:'POST',body:JSON.stringify(d)});},
  upd(t,q,d){return this._q(t+'?'+q,{method:'PATCH',body:JSON.stringify(d)});},
  del(t,q){return this._q(t+'?'+q,{method:'DELETE'});},
  gasPost(p){return fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(p),redirect:'follow'}).then(r=>r.json()).catch(()=>null);}
};

function saveSession(id){localStorage.setItem('td_session',JSON.stringify({id,exp:Date.now()+12*3600000}));}
function getSession(){try{const s=JSON.parse(localStorage.getItem('td_session')||'null');return(s&&s.id&&Date.now()<s.exp)?s:null;}catch(e){return null;}}
function clearSession(){localStorage.removeItem('td_session');}

function parseStops(raw){try{return typeof raw==='string'?JSON.parse(raw):Array.isArray(raw)?raw:[];}catch(e){return[];}}
function routeChain(stops){
  if(!stops||!stops.length)return'—';
  const pl=[stops[0].from||stops[0].origin||''];
  stops.forEach(s=>{const to=s.to||s.destination||'';if(to&&to!==pl[pl.length-1])pl.push(to);});
  return pl.join(' → ');
}
function routeChainHTML(stops,cls=''){
  if(!stops||!stops.length)return'<span class="route">—</span>';
  const pl=[stops[0].from||stops[0].origin||''];
  stops.forEach(s=>{const to=s.to||s.destination||'';if(to&&to!==pl[pl.length-1])pl.push(to);});
  return`<span class="${cls||'route'}">${pl.map((p,i)=>i>0?`<span class="${cls?'rc-arrow':'route-arrow'}">→</span>${p}`:p).join('')}</span>`;
}

/* ════════════════════════════════════════════════════════════
   APP
════════════════════════════════════════════════════════════ */
class TripDesk{
  constructor(){
    this.user=null;this.staff=[];this.trips=[];this.vehicles=[];this.projects=[];
    this._stStops=[];this._svStops=[];
  }

  /* ── LOGIN ── */
  async login(){
    const id=$('login-id').value.trim().toUpperCase(),pass=$('login-pass').value,err=$('login-err');
    err.textContent='';
    if(!id||!pass){err.textContent='Enter Staff ID and password.';return;}
    showLoader('Signing in…');
    try{
      const rows=await API.get('staff','id=eq.'+encodeURIComponent(id));
      if(!rows||!rows.length){hideLoader();err.textContent='Staff ID not found.';return;}
      const s=rows[0];
      /* Hash the entered password with SHA-256 to match Attendance system storage */
      const hashed=await hashPassword(pass);
      if(extractPw(s)!==hashed){hideLoader();err.textContent='Incorrect password.';return;}
      saveSession(id);
      this.user={id:s.id,name:s.name,unit:(s.unit||'').trim(),role:s.role||'staff',color:s.avatar_color||avColor(s.name),email:s.email||''};
      $('lo-text').textContent='Loading trip data…';
      await this._hydrate();this._enter();
    }catch(e){console.error('Login:',e);hideLoader();err.textContent='Connection error. Please try again.';}
  }

  /* ── SELF PASSWORD RESET ── */
  openResetModal(){$('reset-id').value='';$('reset-msg').textContent='';$('reset-modal').classList.add('open');}
  async selfResetPass(){
    const id=$('reset-id')?.value.trim().toUpperCase(),msg=$('reset-msg');msg.textContent='';
    if(!id){msg.innerHTML='<span style="color:var(--red)">Enter your Staff ID.</span>';return;}
    const rows=await API.get('staff','id=eq.'+encodeURIComponent(id));
    if(!rows||!rows.length){msg.innerHTML='<span style="color:var(--red)">Staff ID not found. Contact your admin.</span>';return;}
    /* Store hashed '1234' so it works in both TripDesk and Attendance */
    const hashed=await hashPassword('1234');
    await API.upd('staff','id=eq.'+encodeURIComponent(id),{password:hashed});
    msg.innerHTML='<span style="color:var(--green)">✓ Password reset to <strong>1234</strong>. Log in and change it immediately.</span>';
    setTimeout(()=>closeModal('reset-modal'),2500);
    toast('Password reset to 1234','info');
  }

  /* ── HYDRATE ── */
  async _hydrate(){
    const[staff,trips,veh,proj]=await Promise.all([
      API.get('staff','order=name'),
      API.get('trips','order=submitted.desc&limit=5000'),
      API.get('vehicles','order=plate'),
      API.get('projects','order=name')
    ]);
    this.staff=(staff||[]).map(s=>({id:s.id,name:s.name,unit:(s.unit||'').trim(),role:s.role||'staff',color:s.avatar_color||avColor(s.name),email:s.email||''}));
    this.trips=(trips||[]).map(t=>({
      id:t.id,staffId:t.staff_id,officer:t.officer,unit:t.unit,project:t.project||'',
      purpose:t.purpose,stops:parseStops(t.stops),depDate:t.dep_date,retDate:t.ret_date,
      companions:t.companions||'',status:t.status||'pending',
      supervisorId:t.supervisor_id||'',supervisorName:t.supervisor_name||'',supervisorNote:t.supervisor_note||'',
      driver:t.driver||'',driverId:t.driver_id||'',vehicle:t.vehicle||'',
      color:t.color||'',staffEmail:t.staff_email||'',adminNote:t.admin_note||'',submitted:t.submitted
    }));
    this.vehicles=(veh||[]).map(v=>({id:v.id,plate:v.plate,make:v.make||'',status:v.status||'available'}));
    this.projects=(proj||[]).filter(p=>p.status==='active').map(p=>({id:p.id,name:p.name,code:p.code||'',desc:p.description||'',status:p.status}));
  }

  /* ── ENTER (role routing) ── */
  _enter(){
    try{
      const role=this.user.role;
      if(role==='admin'){
        this._showView('admin-view');
        $('ad-uname').textContent=this.user.name;
        const dn=$('ad-dash-name');if(dn)dn.textContent=this.user.name;
        this._populateUnitFilter();
        this.renderDash();this.renderAdminPending();this.renderAllTrips();
        this.renderVehicles();this.renderProjects();this.renderStaff();this._renderAdminCal();
      }else if(role==='supervisor'){
        this._showView('supervisor-view');
        $('sv-uname').textContent=this.user.name;
        const av=$('sv-av');if(av){av.textContent=ini(this.user.name);av.style.background=this.user.color;}
        this._populateSvProjectsAndSupervisors();
        this._initStops('sv');
        this.renderSupervisorPending();
        this.renderSupervisorAllTrips();
        this.renderMyTrips('sv');
        this._renderCalendar('sv-calendar',this._svCalM,this._svCalY);
      }else{
        this._showView('staff-view');
        $('st-uname').textContent=this.user.name;
        const av=$('st-av');if(av){av.textContent=ini(this.user.name);av.style.background=this.user.color;}
        const me=this.staff.find(s=>s.id===this.user.id);
        if(me&&isDriver(me)){
          const tabs=$('staff-tabs');
          if(tabs)Array.from(tabs.children).forEach(t=>{if(t.textContent.includes('Request'))t.style.display='none';});
        }
        this._populateStProjectsAndSupervisors();
        this._initStops('st');
        this.renderMyTrips('st');
        this._renderCalendar('st-calendar',this._stCalM,this._stCalY);
      }
    }catch(e){console.error('_enter:',e);}
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
    const t=$(id);if(t)t.classList.add('active');
    const bg=document.querySelector('.login-bg');if(bg)bg.style.display=(id==='login-view')?'':'none';
  }
  showTab(scope,name,btn){
    const p=$(scope+'-'+name)?.closest('.main-content');
    if(p)p.querySelectorAll('.tabpanel').forEach(x=>x.classList.remove('active'));
    $(scope+'-'+name)?.classList.add('active');
    const tabs=$(scope+'-tabs');
    if(tabs)tabs.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    if(btn)btn.classList.add('active');
  }

  /* ── Populate dropdowns ── */
  _populateStProjectsAndSupervisors(){
    const sel=$('tr-project');
    if(sel)sel.innerHTML='<option value="">— Select project —</option>'+this.projects.map(p=>`<option value="${p.name}">${p.name}${p.code?' ('+p.code+')':''}</option>`).join('');
    const sv=$('tr-supervisor');
    if(sv)sv.innerHTML='<option value="">— Select supervisor —</option>'+this.staff.filter(s=>isSupervisor(s)).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  }
  _populateSvProjectsAndSupervisors(){
    const sel=$('sv-tr-project');
    if(sel)sel.innerHTML='<option value="">— Select project —</option>'+this.projects.map(p=>`<option value="${p.name}">${p.name}${p.code?' ('+p.code+')':''}</option>`).join('');
    /* Supervisors can pick any OTHER supervisor to approve their request */
    const sv=$('sv-tr-supervisor');
    if(sv)sv.innerHTML='<option value="">— Select supervisor —</option>'+
      this.staff.filter(s=>isSupervisor(s)&&s.id!==this.user.id).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  }
  _populateUnitFilter(){
    const sel=$('ad-trip-unit');if(!sel)return;
    const u=[...new Set(this.staff.map(s=>s.unit).filter(Boolean))].sort();
    sel.innerHTML='<option value="">All Units</option>'+u.map(x=>`<option>${x}</option>`).join('');
  }

  /* ── ITINERARY BUILDER (shared for st and sv prefixes) ── */
  _initStops(prefix){
    if(prefix==='st')this._stStops=[{from:'Accra',to:'',dep:'',ret:''}];
    else this._svStops=[{from:'Accra',to:'',dep:'',ret:''}];
    this._renderStops(prefix);
  }
  _getStops(prefix){return prefix==='st'?this._stStops:this._svStops;}
  _setStops(prefix,arr){if(prefix==='st')this._stStops=arr;else this._svStops=arr;}

  addStop(prefix){
    const arr=this._getStops(prefix);const prev=arr[arr.length-1];
    arr.push({from:prev.to||'',to:'',dep:prev.ret||'',ret:''});
    this._renderStops(prefix);
  }
  removeStop(prefix,i){
    const arr=this._getStops(prefix);if(arr.length<=1)return;
    arr.splice(i,1);
    for(let j=1;j<arr.length;j++)arr[j].from=arr[j-1].to||'';
    this._renderStops(prefix);
  }
  _onStopChange(prefix,i,field,val){
    const arr=this._getStops(prefix);arr[i][field]=val;
    if(field==='to'&&i<arr.length-1){arr[i+1].from=val;const nx=document.querySelector(`#${prefix}-stop-from-${i+1}`);if(nx)nx.value=val;}
    if(field==='ret'&&i<arr.length-1&&!arr[i+1].dep){arr[i+1].dep=val;const nd=document.querySelector(`#${prefix}-stop-dep-${i+1}`);if(nd)nd.value=val;}
    this._updateSummary(prefix);
  }
  _renderStops(prefix){
    const p=prefix==='st'?'':'sv-';
    const box=$(prefix==='st'?'stops-list':'sv-stops-list');if(!box)return;
    const arr=this._getStops(prefix);
    box.innerHTML=arr.map((s,i)=>`<div class="stop-card">
      <div class="stop-num">STOP ${i+1}</div>
      ${arr.length>1?`<button class="stop-remove" onclick="TD.removeStop('${prefix}',${i})">✕</button>`:''}
      <div class="stop-row">
        <div class="field"><label>From</label><input id="${prefix}-stop-from-${i}" value="${s.from||''}" ${i>0?'readonly style="background:#eee;cursor:not-allowed"':''} oninput="TD._onStopChange('${prefix}',${i},'from',this.value)" placeholder="Origin"></div>
        <div class="stop-arrow">→</div>
        <div class="field"><label>To</label><input id="${prefix}-stop-to-${i}" value="${s.to||''}" oninput="TD._onStopChange('${prefix}',${i},'to',this.value)" placeholder="Destination"></div>
      </div>
      <div class="stop-dates">
        <div class="field"><label>Depart</label><input id="${prefix}-stop-dep-${i}" type="date" value="${s.dep||''}" onchange="TD._onStopChange('${prefix}',${i},'dep',this.value)"></div>
        <div class="field"><label>Arrive</label><input id="${prefix}-stop-ret-${i}" type="date" value="${s.ret||''}" onchange="TD._onStopChange('${prefix}',${i},'ret',this.value)"></div>
      </div>
    </div>`).join('');
  }
  _updateSummary(prefix){
    const box=$(prefix==='st'?'tr-summary':'sv-tr-summary');if(!box)return;
    const arr=this._getStops(prefix);
    const valid=arr.filter(s=>s.from&&s.to&&s.dep&&s.ret);
    if(!valid.length){box.style.display='none';return;}
    const pl=[valid[0].from];valid.forEach(s=>{if(s.to&&s.to!==pl[pl.length-1])pl.push(s.to);});
    box.innerHTML=`<div class="route-chain">${pl.map((p,i)=>i>0?`<span class="rc-arrow">→</span>${p}`:p).join('')}</div>
      <strong>${valid.length} stop${valid.length>1?'s':''}</strong> · ${fmt(valid[0].dep)} → ${fmt(valid[valid.length-1].ret)}`;
    box.style.display='block';
  }

  /* ── SUBMIT TRIP (works for both staff prefix='st' and supervisor prefix='sv') ── */
  async submitTrip(prefix){
    const isSv=prefix==='sv';
    const projectEl=$(isSv?'sv-tr-project':'tr-project');
    const supervisorEl=$(isSv?'sv-tr-supervisor':'tr-supervisor');
    const purposeEl=$(isSv?'sv-tr-purpose':'tr-purpose');
    const companionsEl=$(isSv?'sv-tr-companions':'tr-companions');
    const errEl=$(isSv?'sv-tr-err':'tr-err');
    const clashEl=$(isSv?'sv-tr-clash':'tr-clash');
    errEl.textContent='';

    const project=projectEl?.value,supervisorId=supervisorEl?.value,purpose=purposeEl?.value.trim(),companions=companionsEl?.value.trim();
    if(!project)return errEl.textContent='Select a project.';
    if(!supervisorId)return errEl.textContent='Select a supervisor.';
    if(!purpose)return errEl.textContent='Describe the purpose.';

    const arr=this._getStops(prefix);
    const stops=arr.map(s=>({from:(s.from||'').trim(),to:(s.to||'').trim(),depDate:s.dep,retDate:s.ret}));
    for(let i=0;i<stops.length;i++){
      const s=stops[i];
      if(!s.from)return errEl.textContent=`Stop ${i+1}: Enter origin.`;
      if(!s.to)return errEl.textContent=`Stop ${i+1}: Enter destination.`;
      if(!s.depDate)return errEl.textContent=`Stop ${i+1}: Select departure date.`;
      if(!s.retDate)return errEl.textContent=`Stop ${i+1}: Select arrival date.`;
      if(new Date(s.retDate)<new Date(s.depDate))return errEl.textContent=`Stop ${i+1}: Return must be after departure.`;
      if(i>0&&new Date(s.depDate)<new Date(stops[i-1].retDate))return errEl.textContent=`Stop ${i+1}: Departure can't be before previous return.`;
    }
    const depDate=stops[0].depDate,retDate=stops[stops.length-1].retDate;
    const clashes=this.trips.filter(b=>b.status!=='rejected'&&new Date(depDate)<=new Date(b.retDate)&&new Date(retDate)>=new Date(b.depDate));
    if(clashes.length>=MAX_CONCURRENT){
      clashEl.innerHTML='⚠ <strong>Schedule conflict:</strong> '+clashes.length+' trips overlap. Max '+MAX_CONCURRENT+' concurrent.';
      clashEl.style.display='block';return errEl.textContent='Too many overlapping trips.';
    }
    clashEl.style.display='none';

    const supervisorObj=this.staff.find(s=>s.id===supervisorId);
    const supervisorName=supervisorObj?.name||'';
    const supervisorEmail=supervisorObj?.email||'';
    const adminStaff=this.staff.find(s=>s.role==='admin');

    const id='TRIP'+Date.now();
    const trip={id,staff_id:this.user.id,officer:this.user.name,unit:this.user.unit,project,purpose,
      stops:JSON.stringify(stops),dep_date:depDate,ret_date:retDate,companions,status:'pending',
      color:this.user.color,staff_email:this.user.email,supervisor_id:supervisorId,supervisor_name:supervisorName};
    showLoader('Submitting…');
    const r=await API.ins('trips',trip);
    hideLoader();
    if(!r){toast('Server error','err');return;}

    this.trips.unshift({id,staffId:this.user.id,officer:this.user.name,unit:this.user.unit,project,purpose,
      stops,depDate,retDate,companions,status:'pending',color:this.user.color,
      staffEmail:this.user.email,supervisorId,supervisorName,supervisorNote:'',
      driver:'',vehicle:'',submitted:new Date().toISOString(),adminNote:''});

    projectEl.value='';purposeEl.value='';companionsEl.value='';supervisorEl.value='';
    this._initStops(prefix);
    $(isSv?'sv-tr-summary':'tr-summary').style.display='none';
    this.renderMyTrips(prefix);
    toast('Trip submitted! Your supervisor will be notified.');

    API.gasPost({action:'tripSubmitted',data:{
      id,officer:this.user.name,unit:this.user.unit,project,purpose,
      route:routeChain(stops),depDate,retDate,companions,
      staffEmail:this.user.email,supervisorName,supervisorEmail,adminEmail:adminStaff?.email||''
    }}).catch(()=>{});
  }

  /* ── MY TRIPS (staff + supervisor share same renderer) ── */
  renderMyTrips(prefix){
    const isSv=prefix==='sv';
    const box=$(isSv?'sv-trips-cards':'st-trips-cards');if(!box)return;
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
          <strong>Supervisor:</strong> ${t.supervisorName||'—'}<br>
          ${t.supervisorNote?'<strong>Supervisor Note:</strong> <em>'+t.supervisorNote+'</em><br>':''}
          ${t.driver?'<strong>Driver:</strong> '+t.driver+' · ':''}${t.vehicle?'<strong>Vehicle:</strong> '+t.vehicle:''}
          ${t.adminNote?'<br><strong>Admin Note:</strong> <em>'+t.adminNote+'</em>':''}
        </div>
        ${this._timeline4(t)}
      </div>`;
    }).join('');
  }

  _timeline4(t){
    const s=t.status;
    const steps=[
      {label:'Submitted',done:true},
      {label:'Supervisor',done:s==='supervisor_approved'||s==='approved',active:s==='pending',rej:s==='rejected'},
      {label:'Admin',done:s==='approved',active:s==='supervisor_approved'},
      {label:s==='rejected'?'Rejected':'Approved',done:s==='approved',rej:s==='rejected'}
    ];
    return'<div class="trip-timeline">'+steps.map((st,i)=>{
      const cls=st.rej?'rej':st.done?'done':st.active?'active':'';
      return(i>0?'<div class="tl-line'+(steps[i-1].done?' done':'')+'"></div>':'')+
        `<div class="tl-step ${cls}"><div class="tl-dot"></div>${st.label}</div>`;
    }).join('')+'</div>';
  }

  _badge(s){
    if(s==='approved')return'<span class="badge b-approved">✓ Approved</span>';
    if(s==='rejected')return'<span class="badge b-rejected">✗ Rejected</span>';
    if(s==='supervisor_approved')return'<span class="badge b-sv-approved">📋 Sv. Approved</span>';
    return'<span class="badge b-pending">⏳ Pending</span>';
  }

  /* ── SUPERVISOR — Pending ── */
  renderSupervisorPending(){
    const list=$('sv-pending-list');if(!list)return;
    const pend=this.trips.filter(t=>t.supervisorId===this.user.id&&t.status==='pending');
    const badge=$('sv-pending-badge');if(badge){badge.textContent=pend.length;badge.classList.toggle('show',pend.length>0);}
    if(!pend.length){list.innerHTML='<div style="text-align:center;color:var(--text3);padding:1.5rem">No pending requests 🎉</div>';return;}
    list.innerHTML=pend.map(t=>{
      const stops=parseStops(t.stops);
      const stopsHTML=stops.length?`<div class="pend-stops">${stops.map((s,i)=>`<div class="pend-stop"><strong>${i+1}.</strong> ${s.from||'—'} <span class="pend-stop-arrow">→</span> ${s.to||'—'} <span style="color:var(--text3);font-size:.65rem">(${fmt(s.depDate)} → ${fmt(s.retDate)})</span></div>`).join('')}</div>`:'';
      return`<div class="pend-card">
        <h4>${t.officer} <span style="font-weight:400;color:var(--text2)">· ${t.unit}</span></h4>
        <div class="pend-meta"><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose||'—'}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}${t.companions?' · <strong>With:</strong> '+t.companions:''}</div>
        ${stopsHTML}
        <div class="pend-actions"><button class="btn-sm btn-gold" onclick="TD.openSupervisorModal('${t.id}')">👁 Review &amp; Decide</button></div>
      </div>`;
    }).join('');
  }

  openSupervisorModal(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const stops=parseStops(t.stops);
    $('sv-tm-title').textContent='Review: '+t.officer;
    $('sv-tm-info').innerHTML=`<strong>Officer:</strong> ${t.officer} (${t.unit})<br><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br>${t.companions?'<strong>Companions:</strong> '+t.companions+'<br>':''}<strong>Submitted:</strong> ${fmt(t.submitted)}`;
    $('sv-tm-stops').innerHTML=stops.length?`<div style="font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:.3rem">Itinerary (${stops.length} stop${stops.length!==1?'s':''})</div>`+stops.map((s,i)=>`<div style="display:flex;align-items:center;gap:.4rem;padding:.25rem .5rem;background:var(--surf2);border-radius:6px;margin-bottom:.25rem;font-size:.74rem"><strong style="color:var(--purple)">${i+1}.</strong> ${s.from} <span style="color:var(--teal);font-weight:800">→</span> ${s.to}<span style="color:var(--text3);margin-left:auto;font-size:.65rem">${fmt(s.depDate)} → ${fmt(s.retDate)}</span></div>`).join(''):'';
    $('sv-tm-note').value='';$('sv-tm-id').value=id;$('sv-modal').classList.add('open');
  }

  async supervisorDecide(newStatus){
    const id=$('sv-tm-id').value,t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const note=$('sv-tm-note').value.trim();
    showLoader(newStatus==='supervisor_approved'?'Forwarding to admin…':'Rejecting…');
    await API.upd('trips','id=eq.'+encodeURIComponent(id),{status:newStatus,supervisor_note:note,supervisor_decided_at:new Date().toISOString()});
    t.status=newStatus;t.supervisorNote=note;
    hideLoader();closeModal('sv-modal');
    this.renderSupervisorPending();this.renderSupervisorAllTrips();
    toast(newStatus==='supervisor_approved'?'Approved — forwarded to admin ✓':'Trip rejected');
    const adminStaff=this.staff.find(s=>s.role==='admin');
    API.gasPost({action:'supervisorDecision',data:{
      id,status:newStatus,supervisorNote:note,officer:t.officer,
      route:routeChain(parseStops(t.stops)),project:t.project,purpose:t.purpose,
      depDate:t.depDate,retDate:t.retDate,staffEmail:t.staffEmail,
      supervisorName:this.user.name,supervisorEmail:this.user.email,adminEmail:adminStaff?.email||''
    }}).catch(()=>{});
  }

  renderSupervisorAllTrips(){
    const body=$('sv-all-body');if(!body)return;
    const sf=$('sv-trip-status')?.value||'',mf=$('sv-trip-month')?.value||'';
    let list=this.trips.slice();
    if(sf)list=list.filter(t=>t.status===sf);
    if(mf){const[y,m]=mf.split('-').map(Number);list=list.filter(t=>{const d=new Date(t.depDate);return d.getFullYear()===y&&d.getMonth()===m-1;});}
    $('sv-trip-count').textContent=list.length;
    if(!list.length){body.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:1.5rem">No trips found</td></tr>';return;}
    body.innerHTML=list.map(t=>{
      const stops=parseStops(t.stops);
      const myDec=t.supervisorId===this.user.id?
        (t.status==='pending'?'<span style="color:var(--gold);font-weight:600">⏳ Awaiting</span>':
         t.status==='rejected'?'<span style="color:var(--red);font-weight:600">✗ Rejected</span>':
         '<span style="color:var(--green);font-weight:600">✓ Approved</span>')
        :'<span style="color:var(--text3);font-size:.65rem">—</span>';
      return`<tr><td><strong>${t.officer}</strong></td><td style="font-size:.68rem">${t.unit}</td><td style="font-size:.68rem">${t.project||'—'}</td><td>${routeChainHTML(stops)}</td><td style="font-size:.68rem;white-space:nowrap">${fmt(t.depDate)} → ${fmt(t.retDate)}</td><td>${this._badge(t.status)}</td><td>${myDec}</td></tr>`;
    }).join('');
  }

  /* ── ADMIN — Dashboard ── */
  renderDash(){
    const total=this.trips.length,pend=this.trips.filter(t=>t.status==='pending').length;
    const svPend=this.trips.filter(t=>t.status==='supervisor_approved').length;
    const appr=this.trips.filter(t=>t.status==='approved').length;
    $('ad-stats').innerHTML=`
      <div class="stat"><div class="stat-lbl">Total Trips</div><div class="stat-val" style="color:var(--purple)">${total}</div></div>
      <div class="stat"><div class="stat-lbl">With Supervisor</div><div class="stat-val" style="color:var(--gold)">${pend}</div></div>
      <div class="stat"><div class="stat-lbl">Ready to Assign</div><div class="stat-val" style="color:#D97706">${svPend}</div></div>
      <div class="stat"><div class="stat-lbl">Approved</div><div class="stat-val" style="color:var(--green)">${appr}</div></div>
      <div class="stat"><div class="stat-lbl">Vehicles</div><div class="stat-val" style="color:var(--teal)">${this.vehicles.length}</div></div>`;
    const body=$('ad-recent-body');
    body.innerHTML=this.trips.slice(0,8).map(t=>`<tr><td><strong>${t.officer}</strong></td><td>${routeChainHTML(parseStops(t.stops))}</td><td style="font-size:.7rem">${t.project||'—'}</td><td style="font-size:.7rem">${fmt(t.depDate)} → ${fmt(t.retDate)}</td><td>${this._badge(t.status)}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">No trips yet</td></tr>';
    const uMap={};this.trips.forEach(t=>{uMap[t.unit]=(uMap[t.unit]||0)+1;});
    const uArr=Object.entries(uMap).sort((a,b)=>b[1]-a[1]);const mx=uArr.length?uArr[0][1]:1;
    $('ad-unit-chart').innerHTML=uArr.length?uArr.map(([u,c])=>`<div class="unit-bar"><div class="unit-bar-label"><span>${u}</span><strong>${c}</strong></div><div class="unit-bar-track"><div class="unit-bar-fill" style="width:${Math.round(c/mx*100)}%"></div></div></div>`).join(''):'<div style="color:var(--text3);font-size:.75rem;text-align:center;padding:1rem">No data</div>';
    const badge=$('ad-pending-badge');if(badge){badge.textContent=svPend;badge.classList.toggle('show',svPend>0);}
  }

  /* ── ADMIN — Pending (supervisor_approved only) ── */
  renderAdminPending(){
    const list=$('ad-pending-list');if(!list)return;
    const pend=this.trips.filter(t=>t.status==='supervisor_approved');
    if(!pend.length){list.innerHTML='<div style="text-align:center;color:var(--text3);padding:1.5rem">No trips awaiting assignment 🎉<br><small>Trips appear here after supervisor approval.</small></div>';return;}
    list.innerHTML=pend.map(t=>{
      const stops=parseStops(t.stops);
      const stopsHTML=stops.length?`<div class="pend-stops">${stops.map((s,i)=>`<div class="pend-stop"><strong>${i+1}.</strong> ${s.from||'—'} <span class="pend-stop-arrow">→</span> ${s.to||'—'} <span style="color:var(--text3);font-size:.65rem">(${fmt(s.depDate)} → ${fmt(s.retDate)})</span></div>`).join('')}</div>`:'';
      return`<div class="pend-card" style="border-left-color:var(--teal)">
        <h4>${t.officer}: ${routeChain(stops)}</h4>
        <div class="pend-meta"><strong>Project:</strong> ${t.project||'—'} · <strong>Unit:</strong> ${t.unit}<br><strong>Purpose:</strong> ${t.purpose||'—'}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br><strong>Supervisor:</strong> ${t.supervisorName||'—'}${t.supervisorNote?' · <em>'+t.supervisorNote+'</em>':''}${t.companions?' · <strong>With:</strong> '+t.companions:''}</div>
        ${stopsHTML}
        <div class="pend-actions"><button class="btn-sm btn-gold" onclick="TD.openAdminModal('${t.id}')">🚗 Assign Driver &amp; Vehicle</button></div>
      </div>`;
    }).join('');
  }

  openAdminModal(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const stops=parseStops(t.stops);
    $('tm-title').textContent='Assign: '+t.officer;
    $('tm-info').innerHTML=`<strong>Officer:</strong> ${t.officer} (${t.unit})<br><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br><strong>Supervisor:</strong> ${t.supervisorName||'—'}${t.supervisorNote?' · <em>'+t.supervisorNote+'</em>':''}`;
    $('tm-stops').innerHTML=stops.length?`<div style="font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:.3rem">Itinerary</div>`+stops.map((s,i)=>`<div style="display:flex;align-items:center;gap:.4rem;padding:.25rem .5rem;background:var(--surf2);border-radius:6px;margin-bottom:.25rem;font-size:.74rem"><strong style="color:var(--purple)">${i+1}.</strong> ${s.from} <span style="color:var(--teal);font-weight:800">→</span> ${s.to}<span style="color:var(--text3);margin-left:auto;font-size:.65rem">${fmt(s.depDate)} → ${fmt(s.retDate)}</span></div>`).join(''):'';
    $('tm-driver').innerHTML='<option value="">— Select driver —</option>'+this.staff.filter(s=>isDriver(s)).map(d=>`<option value="${d.id}">${d.name}</option>`).join('');
    $('tm-vehicle').innerHTML='<option value="">— Select vehicle —</option>'+this.vehicles.map(v=>`<option value="${v.id}">${v.plate} — ${v.make}</option>`).join('');
    $('tm-note').value='';$('tm-id').value=id;$('trip-modal').classList.add('open');
  }

  async adminAssign(){
    const id=$('tm-id').value,t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const dId=$('tm-driver').value,vId=$('tm-vehicle').value,note=$('tm-note').value.trim();
    if(!dId)return toast('Select a driver','err');
    if(!vId)return toast('Select a vehicle','err');
    const dName=this.staff.find(s=>s.id===dId)?.name||'';
    const dEmail=this.staff.find(s=>s.id===dId)?.email||'';
    const veh=this.vehicles.find(v=>v.id===vId);
    const vLabel=veh?veh.plate+' — '+(veh.make||''):'';
    showLoader('Confirming…');
    await API.upd('trips','id=eq.'+encodeURIComponent(id),{status:'approved',driver:dName,driver_id:dId,vehicle:vLabel,vehicle_id:vId,admin_note:note,updated_at:new Date().toISOString()});
    t.status='approved';t.driver=dName;t.vehicle=vLabel;t.adminNote=note;
    hideLoader();closeModal('trip-modal');
    this.renderDash();this.renderAdminPending();this.renderAllTrips();this._renderAdminCal();
    toast('Trip approved & assigned ✓');
    const svObj=this.staff.find(s=>s.id===t.supervisorId);
    API.gasPost({action:'adminAssigned',data:{
      id,officer:t.officer,route:routeChain(parseStops(t.stops)),project:t.project,purpose:t.purpose,
      depDate:t.depDate,retDate:t.retDate,driver:dName,vehicle:vLabel,adminNote:note,
      staffEmail:t.staffEmail,supervisorName:t.supervisorName,supervisorEmail:svObj?.email||'',driverEmail:dEmail
    }}).catch(()=>{});
  }

  /* ── ADMIN — All Trips ── */
  renderAllTrips(){
    const body=$('ad-all-body');if(!body)return;
    const sf=$('ad-trip-status')?.value||'',uf=$('ad-trip-unit')?.value||'',mf=$('ad-trip-month')?.value||'';
    let list=this.trips.slice();
    if(sf)list=list.filter(t=>t.status===sf);
    if(uf)list=list.filter(t=>t.unit===uf);
    if(mf){const[y,m]=mf.split('-').map(Number);list=list.filter(t=>{const d=new Date(t.depDate);return d.getFullYear()===y&&d.getMonth()===m-1;});}
    $('ad-trip-count').textContent=list.length;
    if(!list.length){body.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:1.5rem">No trips match</td></tr>';return;}
    body.innerHTML=list.map(t=>{const stops=parseStops(t.stops);return`<tr>
      <td><strong>${t.officer}</strong></td><td style="font-size:.68rem">${t.unit}</td><td style="font-size:.68rem">${t.project||'—'}</td>
      <td>${routeChainHTML(stops)}</td><td style="font-size:.68rem">${t.supervisorName||'—'}</td>
      <td style="font-size:.68rem;white-space:nowrap">${fmt(t.depDate)} → ${fmt(t.retDate)}</td>
      <td>${this._badge(t.status)}</td><td style="font-size:.68rem">${t.driver||'—'}</td><td style="font-size:.68rem">${t.vehicle||'—'}</td>
      <td>${t.status==='supervisor_approved'?`<button class="btn-sm btn-gold" onclick="TD.openAdminModal('${t.id}')">Assign</button>`:`<button class="btn-sm btn-outline" onclick="TD.deleteTrip('${t.id}')">🗑</button>`}</td>
    </tr>`;}).join('');
  }
  async deleteTrip(id){if(!confirm('Delete this trip?'))return;await API.del('trips','id=eq.'+encodeURIComponent(id));this.trips=this.trips.filter(t=>t.id!==id);this.renderDash();this.renderAllTrips();this._renderAdminCal();toast('Deleted');}
  exportCSV(){
    let csv='Officer,Unit,Project,Route,Supervisor,Departure,Return,Status,Driver,Vehicle,Submitted\n';
    this.trips.forEach(t=>{csv+=`"${t.officer}","${t.unit}","${t.project||''}","${routeChain(parseStops(t.stops))}","${t.supervisorName||''}","${fmt(t.depDate)}","${fmt(t.retDate)}","${t.status}","${t.driver||''}","${t.vehicle||''}","${fmt(t.submitted)}"\n`;});
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='TripDesk_'+Date.now()+'.csv';a.click();
  }

  /* ── Vehicles & Projects ── */
  renderVehicles(){const b=$('ad-veh-body');if(!b)return;b.innerHTML=this.vehicles.length?this.vehicles.map(v=>`<tr><td><strong>${v.plate}</strong></td><td>${v.make||'—'}</td><td><span class="badge b-approved">${v.status}</span></td><td><button class="btn-sm btn-red" onclick="TD.deleteVehicle('${v.id}')">🗑</button></td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1.5rem">No vehicles</td></tr>';}
  async addVehicle(){const p=$('v-plate')?.value.trim().toUpperCase(),m=$('v-make')?.value.trim();if(!p){toast('Enter plate','err');return;}const id='VEH'+Date.now();await API.ins('vehicles',{id,plate:p,make:m,status:'available'});this.vehicles.push({id,plate:p,make:m,status:'available'});$('v-plate').value='';$('v-make').value='';this.renderVehicles();toast('Added');}
  async deleteVehicle(id){if(!confirm('Remove?'))return;await API.del('vehicles','id=eq.'+encodeURIComponent(id));this.vehicles=this.vehicles.filter(v=>v.id!==id);this.renderVehicles();toast('Removed');}
  renderProjects(){const b=$('ad-proj-body');if(!b)return;API.get('projects','order=name').then(rows=>{const all=(rows||[]).map(p=>({id:p.id,name:p.name,code:p.code||'',desc:p.description||'',status:p.status||'active'}));b.innerHTML=all.length?all.map(p=>`<tr><td><strong>${p.name}</strong></td><td style="font-size:.72rem">${p.code||'—'}</td><td style="font-size:.72rem;color:var(--text2)">${p.desc||'—'}</td><td><span class="badge ${p.status==='active'?'b-approved':'b-rejected'}">${p.status}</span></td><td><button class="btn-sm btn-outline" onclick="TD.toggleProject('${p.id}','${p.status}')">${p.status==='active'?'Deactivate':'Activate'}</button> <button class="btn-sm btn-red" onclick="TD.deleteProject('${p.id}')">🗑</button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">No projects</td></tr>';});}
  async addProject(){const n=$('pj-name')?.value.trim(),c=$('pj-code')?.value.trim(),d=$('pj-desc')?.value.trim(),msg=$('pj-msg');if(msg)msg.textContent='';if(!n){if(msg)msg.innerHTML='<span style="color:var(--red)">Name required.</span>';return;}await API.ins('projects',{id:'PJ'+Date.now(),name:n,code:c,description:d,status:'active'});this.projects.push({id:'PJ'+Date.now(),name:n,code:c,desc:d,status:'active'});$('pj-name').value='';$('pj-code').value='';$('pj-desc').value='';this.renderProjects();this._populateStProjectsAndSupervisors();this._populateSvProjectsAndSupervisors();toast('Added');}
  async toggleProject(id,cur){const ns=cur==='active'?'inactive':'active';await API.upd('projects','id=eq.'+encodeURIComponent(id),{status:ns});this.projects=this.projects.filter(p=>p.id!==id);if(ns==='active'){const r=await API.get('projects','id=eq.'+encodeURIComponent(id));if(r&&r[0])this.projects.push({id:r[0].id,name:r[0].name,code:r[0].code||'',desc:r[0].description||'',status:'active'});}this.renderProjects();this._populateStProjectsAndSupervisors();toast(ns);}
  async deleteProject(id){if(!confirm('Delete?'))return;await API.del('projects','id=eq.'+encodeURIComponent(id));this.projects=this.projects.filter(p=>p.id!==id);this.renderProjects();this._populateStProjectsAndSupervisors();toast('Deleted');}

  /* ── Staff Management ── */
  previewStaffId(){const dateVal=$('ns-joindate')?.value,existingIds=this.staff.map(s=>s.id);const generated=generateStaffId(dateVal,existingIds);const idField=$('ns-id'),hint=$('ns-id-hint');if(idField&&generated){idField.value=generated;if(hint)hint.textContent='Auto-generated · THPG/MM/YYYY';}else if(hint)hint.textContent='Select a join date to auto-generate';}
  toggleAddStaffForm(){const form=$('add-staff-form'),btn=$('add-staff-toggle');if(!form)return;const open=form.style.display==='block';form.style.display=open?'none':'block';if(btn)btn.textContent=open?'▼ Expand':'▲ Collapse';}
  clearAddStaffForm(){['ns-name','ns-joindate','ns-id','ns-unit','ns-email'].forEach(id=>{const el=$(id);if(el)el.value='';});const r=$('ns-role');if(r)r.value='staff';const m=$('ns-msg');if(m)m.textContent='';const p=$('ns-pass');if(p)p.value='1234';}
  async addStaff(){
    const msg=$('ns-msg');if(msg)msg.textContent='';
    const name=$('ns-name')?.value.trim(),joinDate=$('ns-joindate')?.value,idVal=$('ns-id')?.value.trim().toUpperCase();
    const unit=$('ns-unit')?.value.trim(),email=$('ns-email')?.value.trim(),role=$('ns-role')?.value||'staff',pass=$('ns-pass')?.value||'1234';
    if(!name){if(msg)msg.innerHTML='<span style="color:var(--red)">Full name required.</span>';return;}
    if(!idVal){if(msg)msg.innerHTML='<span style="color:var(--red)">Staff ID required.</span>';return;}
    if(!unit){if(msg)msg.innerHTML='<span style="color:var(--red)">Unit required.</span>';return;}
    if(pass.length<4){if(msg)msg.innerHTML='<span style="color:var(--red)">Password min 4 chars.</span>';return;}
    if(this.staff.find(s=>s.id===idVal)){if(msg)msg.innerHTML=`<span style="color:var(--red)">ID <strong>${idVal}</strong> already exists.</span>`;return;}
    const color=avColor(name);showLoader('Adding…');
    const r=await API.ins('staff',{id:idVal,name,unit,role,email:email||'',password:pass,avatar_color:color,join_date:joinDate||null});
    hideLoader();if(!r){toast('Failed to add staff','err');return;}
    this.staff.push({id:idVal,name,unit,role,color,email:email||''});
    this.staff.sort((a,b)=>a.name.localeCompare(b.name));
    if(msg)msg.innerHTML=`<span style="color:var(--green)">✓ <strong>${name}</strong> added as <strong>${idVal}</strong>.</span>`;
    this.clearAddStaffForm();$('add-staff-form').style.display='none';const btn=$('add-staff-toggle');if(btn)btn.textContent='▼ Expand';
    this.renderStaff();this._populateUnitFilter();toast(`${name} added ✓`);
  }
  renderStaff(){
    const g=$('ad-staff-grid');if(!g)return;
    const search=($('staff-search')?.value||'').toLowerCase(),roleFilter=$('staff-role-filter')?.value||'';
    let list=this.staff.slice();
    if(search)list=list.filter(s=>s.name.toLowerCase().includes(search)||s.id.toLowerCase().includes(search)||s.unit.toLowerCase().includes(search));
    if(roleFilter)list=list.filter(s=>s.role===roleFilter);
    if(!list.length){g.innerHTML='<div style="color:var(--text3);font-size:.8rem;padding:.5rem;grid-column:1/-1">No staff match.</div>';return;}
    const roleColors={driver:'b-approved',supervisor:'b-sv-approved',admin:'b-pending'};
    g.innerHTML=list.map(s=>{
      const roleTag=s.role!=='staff'?`<span class="badge ${roleColors[s.role]||''}" style="font-size:.55rem;padding:1px 5px;text-transform:capitalize">${s.role}</span>`:'';
      return`<div class="scard">
        <div class="scard-top"><div class="av" style="background:${s.color}">${ini(s.name)}</div><div><div class="s-name">${s.name}</div><div class="s-id" style="font-size:.6rem;font-family:monospace;color:var(--teal);font-weight:600">${s.id}</div></div></div>
        <div class="s-unit">${s.unit||'—'} ${roleTag}</div>
        ${s.email?`<div style="font-size:.6rem;color:var(--text3);margin-bottom:.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.email}">✉ ${s.email}</div>`:''}
        <div class="scard-btns"><button class="btn-sm btn-outline" onclick="TD.resetStaffPass('${s.id}')">🔑 Reset</button><button class="btn-sm btn-red" onclick="TD.removeStaff('${s.id}','${s.name.replace(/'/g,'')}')">🗑</button></div>
      </div>`;
    }).join('');
  }
  async resetStaffPass(id){
    if(!confirm('Reset password to "1234"?'))return;
    const hashed=await hashPassword('1234');
    await API.upd('staff','id=eq.'+encodeURIComponent(id),{password:hashed});
    toast('Password reset to 1234');
  }
  async removeStaff(id,name){if(!confirm(`Remove ${name} (${id})?\nTrip history is preserved.`))return;showLoader('Removing…');await API.del('staff','id=eq.'+encodeURIComponent(id));hideLoader();this.staff=this.staff.filter(s=>s.id!==id);this.renderStaff();this._populateUnitFilter();toast(`${name} removed`);}

  /* ── CHANGE PASSWORD (shared for st and sv prefix) ── */
  async changePass(prefix){
    const old=$(prefix+'-old-pw')?.value,np=$(prefix+'-new-pw')?.value,conf=$(prefix+'-conf-pw')?.value;
    const msg=$(prefix+'-pw-msg');msg.textContent='';
    if(!old||!np||!conf){msg.innerHTML='<span style="color:var(--red)">Fill all fields.</span>';return;}
    if(np.length<4){msg.innerHTML='<span style="color:var(--red)">Min 4 chars.</span>';return;}
    if(np!==conf){msg.innerHTML='<span style="color:var(--red)">Passwords don\'t match.</span>';return;}
    const rows=await API.get('staff','id=eq.'+encodeURIComponent(this.user.id));
    /* Hash the entered current password to compare against stored hash */
    const hashedOld=await hashPassword(old);
    if(!rows?.length||extractPw(rows[0])!==hashedOld){msg.innerHTML='<span style="color:var(--red)">Wrong current password.</span>';return;}
    /* Hash the new password before storing — keeps both systems in sync */
    const hashedNew=await hashPassword(np);
    await API.upd('staff','id=eq.'+encodeURIComponent(this.user.id),{password:hashedNew});
    msg.innerHTML='<span style="color:var(--green)">✓ Password changed!</span>';
    $(prefix+'-old-pw').value='';$(prefix+'-new-pw').value='';$(prefix+'-conf-pw').value='';
    toast('Password updated');
  }

  /* ── CALENDARS ── */
  _stCalM=new Date().getMonth();_stCalY=new Date().getFullYear();
  _svCalM=new Date().getMonth();_svCalY=new Date().getFullYear();
  _adCalM=new Date().getMonth();_adCalY=new Date().getFullYear();

  /* Availability calendar — shared for staff (st) and supervisor (sv) */
  _renderCalendar(boxId,m,y){
    const box=$(boxId);if(!box)return;
    const isAdmin=boxId==='ad-calendar';
    const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),todayStr=new Date().toISOString().slice(0,10);

    /* Nav buttons update the correct month/year vars */
    const prefix=boxId==='st-calendar'?'_stCal':boxId==='sv-calendar'?'_svCal':'_adCal';
    let h=`<div class="cal-nav">
      <button onclick="TD.${prefix}M--;if(TD.${prefix}M<0){TD.${prefix}M=11;TD.${prefix}Y--;}TD._renderCalendar('${boxId}',TD.${prefix}M,TD.${prefix}Y)">◀</button>
      <span>${MN[m]} ${y}</span>
      <button onclick="TD.${prefix}M++;if(TD.${prefix}M>11){TD.${prefix}M=0;TD.${prefix}Y++;}TD._renderCalendar('${boxId}',TD.${prefix}M,TD.${prefix}Y)">▶</button>
    </div>`;

    if(!isAdmin){
      h+=`<div class="cal-legend">
        <span class="leg-item"><span class="leg-dot" style="background:#16a34a"></span>Available</span>
        <span class="leg-item"><span class="leg-dot" style="background:#ca8a04"></span>1 Trip</span>
        <span class="leg-item"><span class="leg-dot" style="background:#dc2626"></span>Fully Booked</span>
      </div>`;
    }

    h+='<div class="cal-grid">';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{h+=`<div class="cal-hdr">${d}</div>`;});
    for(let i=0;i<first;i++)h+='<div class="cal-day" style="background:transparent;border:none"></div>';
    for(let d=1;d<=days;d++){
      const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayTrips=[];this.trips.forEach(t=>{if(t.status==='rejected')return;parseStops(t.stops).forEach(s=>{if(ds>=s.depDate&&ds<=s.retDate&&!dayTrips.find(x=>x.id===t.id))dayTrips.push(t);});});
      const count=dayTrips.length,isPast=ds<todayStr;
      if(isAdmin){
        h+=`<div class="cal-day${ds===todayStr?' today':''}"><div class="cal-num">${d}</div>`;
        dayTrips.slice(0,2).forEach(t=>{h+=`<span class="cal-trip" style="background:${t.color||'var(--purple)'}" title="${t.officer}: ${routeChain(parseStops(t.stops))}">${t.officer.split(' ')[0]}</span>`;});
        if(dayTrips.length>2)h+=`<span style="font-size:.5rem;color:var(--text3)">+${dayTrips.length-2}</span>`;
      }else{
        const bg=count>=MAX_CONCURRENT?'#fee2e2':count===1?'#fef9c3':(!isPast?'#dcfce7':'');
        const borderCol=count>=MAX_CONCURRENT?'#dc2626':count===1?'#ca8a04':ds===todayStr?'var(--teal)':'var(--surf2)';
        const textCol=count>=MAX_CONCURRENT?'#991b1b':count===1?'#92400e':'inherit';
        h+=`<div class="cal-day" style="background:${bg};border-color:${borderCol}"><div class="cal-num" style="color:${textCol}">${d}</div>`;
        if(count>=MAX_CONCURRENT)h+=`<span style="font-size:.52rem;font-weight:800;color:#dc2626;display:block">FULL</span>`;
        else if(count===1)h+=`<span style="font-size:.5rem;color:#92400e">${dayTrips[0].officer.split(' ')[0]}</span>`;
      }
      h+='</div>';
    }
    h+='</div>';box.innerHTML=h;
  }

  _renderAdminCal(){this._renderCalendar('ad-calendar',this._adCalM,this._adCalY);}
}

/* ── BOOT ── */
const TD=new TripDesk();

(async function(){
  const s=getSession();if(!s)return;
  showLoader('Restoring session…');
  const lv=$('login-view');if(lv)lv.style.display='none';
  const bg=document.querySelector('.login-bg');if(bg)bg.style.display='none';
  try{
    const staff=await API.get('staff','id=eq.'+encodeURIComponent(s.id));
    if(!staff||!staff.length){clearSession();hideLoader();if(lv){lv.style.display='';lv.classList.add('active');}if(bg)bg.style.display='';return;}
    const u=staff[0];
    TD.user={id:u.id,name:u.name,unit:(u.unit||'').trim(),role:u.role||'staff',color:u.avatar_color||avColor(u.name),email:u.email||''};
    $('lo-text').textContent='Loading trip data…';await TD._hydrate();TD._enter();
  }catch(e){
    console.error('Session restore:',e);clearSession();hideLoader();
    if(lv){lv.style.display='';lv.classList.add('active');}if(bg)bg.style.display='';
  }
})();
