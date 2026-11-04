/* ═══════════════════════════════════════════════════════════
   THP-GHANA TRIPDESK v19
   · Audit trail, system health checks, settings, role management
   · Admin: Send Test email/SMS button
   · SMS notifications via Arkesel (sent from GAS, key in Script Properties)
   · Staff phone numbers for SMS
   · Admin: edit trip dates, On-the-Road view, Odometer Log table
   · Double-booking guard for drivers & vehicles
   · Trip cancellation & edit-resubmit for rejected trips
   · Driver trip log: start/end trip with odometer readings
   · Contract Drivers can log in to view their assigned trips
   · Contract Drivers (separate table, linked at assignment)
   · Assignment History for admin
   · Supervisor/Admin requests bypass supervisor review
   · Password: SHA-256 hashed (matches Attendance system)
═══════════════════════════════════════════════════════════ */
'use strict';
const $=id=>document.getElementById(id);
const fmt=iso=>{if(!iso)return'—';const d=new Date(iso);return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});};
const fmtTime=iso=>{if(!iso)return'';const d=new Date(iso);return isNaN(d)?'':d.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});};
const ini=s=>(s||'?').split(' ').slice(0,2).map(w=>(w[0]||'')).join('').toUpperCase();
function toast(msg,type='ok'){const el=document.createElement('div');el.className='toast '+type;el.textContent=(type==='ok'?'✅ ':type==='info'?'ℹ️ ':'❌ ')+msg;$('toasts').appendChild(el);setTimeout(()=>el.remove(),3500);}
function showLoader(msg){const el=$('loading-overlay');if(!el)return;if(msg)$('lo-text').textContent=msg;el.classList.remove('fade-out');el.classList.add('active');}
function hideLoader(){const el=$('loading-overlay');if(!el)return;el.classList.add('fade-out');setTimeout(()=>el.classList.remove('active','fade-out'),450);}
function closeModal(id){$(id).classList.remove('open');}

const SUPA={URL:'https://jhpqzkwzxprsnaczkyjq.supabase.co',KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocHF6a3d6eHByc25hY3preWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTE4NTMsImV4cCI6MjA4OTc2Nzg1M30.GKJz9EhxGP1wTQBiufLoVLxWOstx-9Z0MPWHxj2c8VM'};
const GAS_URL='https://script.google.com/macros/s/AKfycby1gAE6dkwroOS6IZ_ODXf2c7E41mVLJJG62TBUolp9jLw2TJp7Attw2uakYidZHZNL/exec';
const ADMIN_EMAIL='eric.koomson@thp.org';
const ADMIN_PHONE='';  /* ← optional: put admin's phone here in 0XXXXXXXXX or 233XXXXXXXXX format for admin SMS */
let MAX_CONCURRENT=3;              /* overridable from Settings (settings table) */
let SETTINGS={};                   /* key→value map loaded at hydrate */
const AV_COLORS=['#2D3592','#3DBFB8','#F5A623','#22c55e','#ef4444','#818cf8','#06b6d4','#f97316','#a855f7','#ec4899'];
function avColor(n){return AV_COLORS[(n||'').charCodeAt(0)%AV_COLORS.length];}

const LEGACY_DRIVER_IDS=['THP012','THP013','THP014','THP024','THPG/07/2024-2','THPG/08/2012','THPG/03/2012'];
function isDriver(s){return s.role==='driver'||LEGACY_DRIVER_IDS.includes(s.id);}
function isSupervisor(s){return s.role==='supervisor'||s.role==='manager'||s.role==='country_leader';}

function generateStaffId(joinDateStr,existingIds=[]){
  if(!joinDateStr)return'';const d=new Date(joinDateStr);if(isNaN(d))return'';
  const mm=String(d.getMonth()+1).padStart(2,'0'),yyyy=d.getFullYear();
  const base=`THPG/${mm}/${yyyy}`;if(!existingIds.includes(base))return base;
  let seq=2;while(existingIds.includes(`${base}-${seq}`))seq++;return`${base}-${seq}`;
}

/* ── Password hashing — SHA-256 ── */
async function hashPassword(plain, staffId){
  const raw = staffId ? (staffId + ':' + String(plain).trim()) : String(plain).trim();
  const encoded=new TextEncoder().encode(raw);
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
  gasPost(p){return fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(p),redirect:'follow'}).then(r=>r.json()).catch(()=>null);},
  /* ── AUDIT TRAIL — fire-and-forget; never blocks or breaks the action ── */
  audit(action,target,detail){
    try{
      const u=(window.TD&&TD.user)||{};
      return this.ins('audit_log',{
        id:'AUD'+Date.now()+Math.random().toString(36).slice(2,6),
        actor_id:u.id||'(unknown)',actor_name:u.name||'(unknown)',actor_role:u.role||'',
        action,target:target||'',detail:detail||'',at:new Date().toISOString()
      }).catch(()=>null);
    }catch(e){return null;}
  },
  /* Sends notification and reports delivery: toasts who was skipped and why */
  gasNotify(p){
    return this.gasPost(p).then(res=>{
      if(!res)return; /* network/CORS — can't confirm either way */
      if(res.success===false){toast('Notification failed: '+(res.error||'unknown error'),'err');return;}
      if(res.skipped&&res.skipped.length)toast('No email sent to: '+res.skipped.join(', '),'info');
      if(res.smsSkipped&&res.smsSkipped.length){
        /* Only surface real SMS problems, not the "SMS disabled" noise */
        const realProblems=res.smsSkipped.filter(x=>!x.includes('SMS disabled'));
        if(realProblems.length)toast('No SMS sent to: '+realProblems.join(', '),'info');
      }
      if(res.smsSent&&res.smsSent.length)toast('📱 SMS sent to '+res.smsSent.length+' recipient'+(res.smsSent.length>1?'s':''),'ok');
    });
  }
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
    this.user=null;this.staff=[];this.trips=[];this.vehicles=[];this.projects=[];this.contractDrivers=[];
    this._stStops=[];this._svStops=[];this._editingTripId=null;
  }

  /* ── LOGIN ── */
  async login(){
    const id=$('login-id').value.trim().toUpperCase(),pass=$('login-pass').value,err=$('login-err');
    err.textContent='';
    if(!id||!pass){err.textContent='Enter Staff ID and password.';return;}
    showLoader('Signing in…');
    try{
      if(id==='ADMIN01'){
        const settings=await API.get('settings','key=eq.admin_password');
        const adminPass=(settings&&settings[0])?settings[0].value:'admin123';
        if(String(pass)!==String(adminPass)){hideLoader();err.textContent='Incorrect password.';return;}
        saveSession(id);
        this.user={id:'ADMIN01',name:'Administrator',unit:'Admin',role:'admin',color:'#2D3592',email:''};
        API.audit('login','','Admin signed in');
        $('lo-text').textContent='Loading trip data…';
        await this._hydrate();this._enter();
        return;
      }
      /* Contract driver login — CD/ prefix routes to contract_drivers table */
      if(id.startsWith('CD/')){
        const cdrows=await API.get('contract_drivers','id=eq.'+encodeURIComponent(id));
        if(!cdrows||!cdrows.length){hideLoader();err.textContent='Driver ID not found.';return;}
        const cd=cdrows[0];
        if(cd.status!=='active'){hideLoader();err.textContent='Account inactive. Contact admin.';return;}
        const hashed=await hashPassword(pass,id);
        const storedPw=extractPw(cd);
        /* First-time login: no password set → accept default '1234' */
        const firstTimeOk=!storedPw&&pass==='1234';
        if(!firstTimeOk&&storedPw!==hashed&&storedPw!==pass){hideLoader();err.textContent='Incorrect password.';return;}
        saveSession(id);
        this.user={id:cd.id,name:cd.name,unit:'Contract Driver',role:'contract_driver',color:'#F5A623',email:cd.email||'',phone:cd.phone||'',license:cd.license_no||''};
        API.audit('login','','Contract driver signed in');
        $('lo-text').textContent='Loading your trips…';
        await this._hydrate();this._enter();
        return;
      }
      const rows=await API.get('staff','id=eq.'+encodeURIComponent(id));
      if(!rows||!rows.length){hideLoader();err.textContent='Staff ID not found.';return;}
      const s=rows[0];
      const hashed=await hashPassword(pass, id);
      const storedPw=extractPw(s);
      if(storedPw!==hashed&&storedPw!==pass){hideLoader();err.textContent='Incorrect password.';return;}
      saveSession(id);
      this.user={id:s.id,name:s.name,unit:(s.unit||'').trim(),role:s.role||'staff',color:s.avatar_color||avColor(s.name),email:s.email||'',phone:s.phone||''};
      API.audit('login','','Signed in as '+(s.role||'staff'));
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
    const hashed=await hashPassword('1234', id);
    await API.upd('staff','id=eq.'+encodeURIComponent(id),{password:hashed});
    msg.innerHTML='<span style="color:var(--green)">✓ Password reset to <strong>1234</strong>. Log in and change it immediately.</span>';
    setTimeout(()=>closeModal('reset-modal'),2500);
    toast('Password reset to 1234','info');
  }

  /* ── HYDRATE ── */
  async _hydrate(){
    const[staff,trips,veh,proj,cdrivers]=await Promise.all([
      API.get('staff','order=name'),
      API.get('trips','order=submitted.desc&limit=5000'),
      API.get('vehicles','order=plate'),
      API.get('projects','order=name'),
      API.get('contract_drivers','order=name')
    ]);
    /* System settings (key/value) — tolerate a missing table */
    const setRows=await API.get('settings','');
    SETTINGS={};(setRows||[]).forEach(r=>{SETTINGS[r.key]=r.value;});
    const mc=parseInt(SETTINGS.max_concurrent,10);
    if(!isNaN(mc)&&mc>0&&mc<=20)MAX_CONCURRENT=mc;
    this.staff=(staff||[]).map(s=>({id:s.id,name:s.name,unit:(s.unit||'').trim(),role:s.role||'staff',color:s.avatar_color||avColor(s.name),email:s.email||'',phone:s.phone||''}));
    this.trips=(trips||[]).map(t=>({
      id:t.id,staffId:t.staff_id,officer:t.officer,unit:t.unit,project:t.project||'',
      purpose:t.purpose,stops:parseStops(t.stops),depDate:t.dep_date,retDate:t.ret_date,
      companions:t.companions||'',status:t.status||'pending',
      supervisorId:t.supervisor_id||'',supervisorName:t.supervisor_name||'',supervisorNote:t.supervisor_note||'',
      driver:t.driver||'',driverId:t.driver_id||'',vehicle:t.vehicle||'',vehicleId:t.vehicle_id||'',
      color:t.color||'',staffEmail:t.staff_email||'',adminNote:t.admin_note||'',
      submitted:t.submitted,updatedAt:t.updated_at||'',
      tripType:t.trip_type||'round',dropTime:t.drop_time||'',pickupTime:t.pickup_time||'',
      tripStartedAt:t.trip_started_at||'',tripEndedAt:t.trip_ended_at||'',
      odoStart:t.odo_start??null,odoEnd:t.odo_end??null
    }));
    this.vehicles=(veh||[]).map(v=>({id:v.id,plate:v.plate,make:v.make||'',status:v.status||'available'}));
    this.projects=(proj||[]).filter(p=>p.status==='active').map(p=>({id:p.id,name:p.name,code:p.code||'',desc:p.description||'',status:p.status}));
    this.contractDrivers=(cdrivers||[]).filter(d=>d.status==='active').map(d=>({id:d.id,name:d.name,phone:d.phone||'',license:d.license_no||'',email:d.email||'',status:d.status||'active'}));
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
        this.renderVehicles();this.renderProjects();this.renderStaff();
        this._renderAdminCal();this.renderHistory();this.renderContractDrivers();
        this.renderSettings();this.loadAudit();
      }else if(role==='contract_driver'){
        this._showView('cdriver-view');
        $('cd-uname').textContent=this.user.name;
        const wn=$('cd-welcome-name');if(wn)wn.textContent=this.user.name;
        const av=$('cd-av');if(av){av.textContent=ini(this.user.name);}
        this.renderDriverTrips();
      }else if(isSupervisor(this.user)){
        this._showView('supervisor-view');
        $('sv-uname').textContent=this.user.name;
        const av=$('sv-av');if(av){av.textContent=ini(this.user.name);av.style.background=this.user.color;}
        /* Supervisor requests skip supervisor review — hide supervisor selector, update description */
        const svField=$('sv-supervisor-field');if(svField)svField.style.display='none';
        const svDesc=$('sv-request-desc');if(svDesc)svDesc.textContent='Your request goes directly to admin for driver & vehicle assignment.';
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
          const at=$('st-assign-tab');if(at)at.style.display='';
          this.renderDriverTrips('st-assign-cards','st-assign-summary');
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

  /* ══════════════════════════════════════════════════
     SUBMIT TRIP — handles both staff and supervisor
     KEY CHANGE: Supervisors/managers bypass the
     supervisor review stage. Their requests go
     directly to admin (status: supervisor_approved).
  ══════════════════════════════════════════════════ */
  async submitTrip(prefix){
    const isSv=prefix==='sv';
    const projectEl=$(isSv?'sv-tr-project':'tr-project');
    const supervisorEl=$(isSv?'sv-tr-supervisor':'tr-supervisor');
    const purposeEl=$(isSv?'sv-tr-purpose':'tr-purpose');
    const companionsEl=$(isSv?'sv-tr-companions':'tr-companions');
    const errEl=$(isSv?'sv-tr-err':'tr-err');
    const clashEl=$(isSv?'sv-tr-clash':'tr-clash');
    errEl.textContent='';

    const project=projectEl?.value,purpose=purposeEl?.value.trim(),companions=companionsEl?.value.trim();
    if(!project)return errEl.textContent='Select a project.';
    if(!purpose)return errEl.textContent='Describe the purpose.';

    /* Trip type + times */
    const tp=isSv?'sv-tr-':'tr-';
    const tripType=$(tp+'type')?.value||'round';
    const dropTime=$(tp+'drop')?.value||'';
    const pickupTime=tripType==='dropoff'?($(tp+'pickup')?.value||''):'';
    if(tripType!=='round'&&!dropTime)return errEl.textContent=tripType==='oneway'?'Enter the departure time.':'Enter the drop-off time.';
    if(tripType==='dropoff'&&!pickupTime)return errEl.textContent='Enter the pick-up time.';
    /* Only enforce ordering when the drop and the pick-up are the same day —
       a Monday drop and a Friday pick-up may legitimately be 09:00 → 08:00. */

    /* Supervisor/manager submitting → bypass supervisor stage entirely */
    const userIsSupervisor=isSupervisor(this.user);
    let supervisorId='',supervisorName='',supervisorEmail='',supervisorPhone='';

    if(userIsSupervisor){
      /* No supervisor needed — goes straight to admin */
      supervisorId=this.user.id;
      supervisorName=this.user.name+' (self)';
      supervisorEmail=this.user.email;
      supervisorPhone=this.user.phone||'';
    }else{
      /* Regular staff — must select a supervisor */
      supervisorId=supervisorEl?.value;
      if(!supervisorId)return errEl.textContent='Select a supervisor.';
      const supervisorObj=this.staff.find(s=>s.id===supervisorId);
      supervisorName=supervisorObj?.name||'';
      supervisorEmail=supervisorObj?.email||'';
      supervisorPhone=supervisorObj?.phone||'';
    }

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
    /* A drop and a pick-up on the SAME day must be in order. Across days
       (drop Monday, pick-up Friday) any clock times are valid. */
    if(tripType==='dropoff'&&depDate===retDate&&dropTime&&pickupTime&&pickupTime<=dropTime)
      return errEl.textContent='Pick-up must be after drop-off when both are on the same day.';
    /* Check peak daily concurrency across the requested range, not total overlapping trips.
       When editing, the trip being edited must NOT count against itself — otherwise its own
       old dates still occupy a slot and block the new dates. */
    const overlapping=this.trips.filter(b=>b.id!==this._editingTripId&&b.status!=='rejected'&&b.status!=='cancelled'&&new Date(depDate)<=new Date(b.retDate)&&new Date(retDate)>=new Date(b.depDate));
    let peakDay='',peakCount=0;
    const mineDays=this._occupiedDays({tripType,stops,depDate,retDate});
    const startMs=new Date(depDate).getTime(),endMs=new Date(retDate).getTime();
    for(let d=startMs;d<=endMs;d+=86400000){
      const ds=new Date(d).toISOString().slice(0,10);
      if(!mineDays.includes(ds))continue;              /* this trip isn't out that day */
      const dayCount=overlapping.filter(b=>this._occupiesDay(b,ds)).length;
      if(dayCount>peakCount){peakCount=dayCount;peakDay=ds;}
    }
    if(peakCount>=MAX_CONCURRENT){
      clashEl.innerHTML='⚠ <strong>Schedule conflict on '+fmt(peakDay)+':</strong> '+peakCount+' trips already overlap that day. Max '+MAX_CONCURRENT+' concurrent (one per driver).';
      clashEl.style.display='block';return errEl.textContent='Too many overlapping trips on '+fmt(peakDay)+'.';
    }
    clashEl.style.display='none';

    const adminStaff=this.staff.find(s=>s.role==='admin');

    /* ══ EDIT MODE — update the existing pending trip instead of creating a new one ══ */
    if(this._editingTripId){
      const editId=this._editingTripId;
      const existing=this.trips.find(tr=>tr.id===editId);
      if(!existing||existing.status!=='pending'){
        toast('This trip can no longer be edited','err');
        this._setEditMode(prefix,null);
        return;
      }
      showLoader('Saving changes…');
      const upd=await API.upd('trips','id=eq.'+encodeURIComponent(editId),{
        project,purpose,stops:JSON.stringify(stops),dep_date:depDate,ret_date:retDate,
        companions,supervisor_id:supervisorId,supervisor_name:supervisorName,
        trip_type:tripType,drop_time:dropTime,pickup_time:pickupTime,
        updated_at:new Date().toISOString()
      });
      hideLoader();
      if(!upd){toast('Server error','err');return;}
      Object.assign(existing,{project,purpose,stops,depDate,retDate,companions,supervisorId,supervisorName,tripType,dropTime,pickupTime});
      /* Reset the form out of edit mode */
      this._setEditMode(prefix,null);
      projectEl.value='';purposeEl.value='';companionsEl.value='';
      if(supervisorEl)supervisorEl.value='';
      this._initStops(prefix);
      $(isSv?'sv-tr-summary':'tr-summary').style.display='none';
      this.renderMyTrips(prefix);
      if(isSv)this.renderSupervisorAllTrips();
      this._refreshCalendars();
      API.audit('trip_edited',editId,routeChain(stops)+' · '+depDate+' → '+retDate);
      toast('Your request has been updated ✓');
      /* Re-notify the supervisor that the request changed */
      API.gasNotify({action:'tripSubmitted',data:{
        id:editId,officer:this.user.name,unit:this.user.unit,project,purpose,
        route:routeChain(stops),depDate,retDate,companions,tripType,dropTime,pickupTime,
        staffEmail:this.user.email,supervisorName,supervisorEmail,adminEmail:adminStaff?.email||ADMIN_EMAIL,
        staffPhone:this.user.phone||'',supervisorPhone,adminPhone:adminStaff?.phone||ADMIN_PHONE
      }}).catch(()=>{});
      return;
    }

    /* Set initial status based on role */
    const initialStatus=userIsSupervisor?'supervisor_approved':'pending';

    const id='TRIP'+Date.now();
    const trip={id,staff_id:this.user.id,officer:this.user.name,unit:this.user.unit,project,purpose,
      stops:JSON.stringify(stops),dep_date:depDate,ret_date:retDate,companions,status:initialStatus,
      color:this.user.color,staff_email:this.user.email,supervisor_id:supervisorId,supervisor_name:supervisorName,
      trip_type:tripType,drop_time:dropTime,pickup_time:pickupTime};

    /* If supervisor, auto-set decided fields */
    if(userIsSupervisor){
      trip.supervisor_note='Auto-approved (supervisor self-request)';
      trip.supervisor_decided_at=new Date().toISOString();
    }

    showLoader('Submitting…');
    const r=await API.ins('trips',trip);
    hideLoader();
    if(!r){toast('Server error','err');return;}

    this.trips.unshift({id,staffId:this.user.id,officer:this.user.name,unit:this.user.unit,project,purpose,
      stops,depDate,retDate,companions,status:initialStatus,color:this.user.color,
      staffEmail:this.user.email,supervisorId,supervisorName,tripType,dropTime,pickupTime,
      supervisorNote:userIsSupervisor?'Auto-approved (supervisor self-request)':'',
      driver:'',driverId:'',vehicle:'',vehicleId:'',submitted:new Date().toISOString(),adminNote:'',updatedAt:''});

    projectEl.value='';purposeEl.value='';companionsEl.value='';
    if(supervisorEl)supervisorEl.value='';
    this._initStops(prefix);
    $(isSv?'sv-tr-summary':'tr-summary').style.display='none';
    this.renderMyTrips(prefix);
    this._refreshCalendars();
    if(!this.user.email)toast('⚠ You have no email on your profile — you won\'t receive email updates. Ask admin to add it.','info');

    if(userIsSupervisor){
      /* Notify admin directly — trip is ready for assignment */
      API.audit('trip_submitted',id,routeChain(stops)+' · '+depDate+' → '+retDate+' (auto-approved, supervisor self-request)');
      toast('Trip submitted! Goes directly to admin for assignment.');
      API.gasNotify({action:'supervisorDecision',data:{
        id,status:'supervisor_approved',officer:this.user.name,unit:this.user.unit,
        project,purpose,route:routeChain(stops),depDate,retDate,companions,tripType,dropTime,pickupTime,
        staffEmail:this.user.email,supervisorName,supervisorEmail,
        adminEmail:adminStaff?.email||ADMIN_EMAIL,
        staffPhone:this.user.phone||'',supervisorPhone,adminPhone:adminStaff?.phone||ADMIN_PHONE,
        supervisorNote:'Auto-approved (supervisor self-request)'
      }}).catch(()=>{});
      /* Also refresh supervisor views */
      this.renderSupervisorAllTrips();
    }else{
      API.audit('trip_submitted',id,routeChain(stops)+' · '+depDate+' → '+retDate+' · supervisor: '+supervisorName);
      toast('Trip submitted! Your supervisor will be notified.');
      API.gasNotify({action:'tripSubmitted',data:{
        id,officer:this.user.name,unit:this.user.unit,project,purpose,
        route:routeChain(stops),depDate,retDate,companions,tripType,dropTime,pickupTime,
        staffEmail:this.user.email,supervisorName,supervisorEmail,adminEmail:adminStaff?.email||ADMIN_EMAIL,
        staffPhone:this.user.phone||'',supervisorPhone,adminPhone:adminStaff?.phone||ADMIN_PHONE
      }}).catch(()=>{});
    }
  }

  /* ── MY TRIPS (staff + supervisor share same renderer) ── */
  renderMyTrips(prefix){
    const isSv=prefix==='sv';
    const box=$(isSv?'sv-trips-cards':'st-trips-cards');if(!box)return;
    const mine=this.trips.filter(t=>t.staffId===this.user.id);
    if(!mine.length){box.innerHTML='<div class="card" style="text-align:center;color:var(--text3);padding:2rem">No trips yet — submit your first request! 🚗</div>';return;}
    box.innerHTML=mine.map(t=>{
      const stops=parseStops(t.stops);
      const today=new Date().toISOString().slice(0,10);
      /* Cancellable: not yet rejected/cancelled, trip hasn't started, and departure hasn't passed */
      const canCancel=['pending','supervisor_approved','approved'].includes(t.status)&&!t.tripStartedAt&&t.depDate>=today;
      const canResubmit=t.status==='rejected'||t.status==='cancelled';
      /* Directly editable only while still pending — nobody has acted on it yet */
      const canEdit=t.status==='pending';
      let actions='';
      if(canEdit)actions+=`<button class="btn-sm btn-teal" onclick="TD.editTrip('${t.id}')">✎ Edit Request</button> `;
      if(canCancel)actions+=`<button class="btn-sm btn-outline" style="color:var(--red);border-color:#fca5a5" onclick="TD.cancelTrip('${t.id}')">⊘ Cancel Trip</button> `;
      if(canResubmit)actions+=`<button class="btn-sm btn-teal" onclick="TD.resubmitTrip('${t.id}')">↻ Edit &amp; Resubmit</button>`;
      return`<div class="trip-card">
        <div class="trip-card-badge">${this._badge(t.status,t)}</div>
        <div class="trip-card-route"><div class="route-chain">${routeChainHTML(stops,'route-chain')}</div></div>
        <div class="trip-card-meta">
          <strong>Project:</strong> ${t.project||'—'} · <strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)} · <strong>${stops.length} stop${stops.length!==1?'s':''}</strong><br>
          <strong>Type:</strong> ${this._typeLabel(t)}<br>
          <strong>Purpose:</strong> ${t.purpose||'—'}<br>
          <strong>Supervisor:</strong> ${t.supervisorName||'—'}<br>
          ${t.supervisorNote?'<strong>Supervisor Note:</strong> <em>'+t.supervisorNote+'</em><br>':''}
          ${t.driver?'<strong>Driver:</strong> '+t.driver+' · ':''}${t.vehicle?'<strong>Vehicle:</strong> '+t.vehicle:''}
          ${t.adminNote?'<br><strong>Admin Note:</strong> <em>'+t.adminNote+'</em>':''}
        </div>
        ${this._timeline4(t)}
        ${actions?'<div style="margin-top:.6rem;display:flex;gap:.35rem;flex-wrap:wrap">'+actions+'</div>':''}
      </div>`;
    }).join('');
  }

  /* ── CANCEL TRIP ── */
  async cancelTrip(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const wasAssigned=t.status==='approved';
    if(!confirm('Cancel this trip ('+routeChain(parseStops(t.stops))+', '+fmt(t.depDate)+')?'+(wasAssigned?'\n\nA driver and vehicle were already assigned — they will be freed and notified.':'')))return;
    showLoader('Cancelling…');
    const r=await API.upd('trips','id=eq.'+encodeURIComponent(id),{status:'cancelled',updated_at:new Date().toISOString()});
    hideLoader();
    if(!r){toast('Server error','err');return;}
    t.status='cancelled';
    const prefix=isSupervisor(this.user)?'sv':'st';
    this.renderMyTrips(prefix);
    if(prefix==='sv')this.renderSupervisorAllTrips();
    this._refreshCalendars();
    API.audit('trip_cancelled',id,t.officer+' · '+routeChain(parseStops(t.stops))+' · '+fmt(t.depDate)+(wasAssigned?' (driver/vehicle freed)':''));
    toast('Trip cancelled — the slot is now free for others');
    /* Notify admin (and driver if one was assigned) */
    const adminStaff=this.staff.find(s=>s.role==='admin');
    let driverEmail='',driverPhone='';
    if(wasAssigned&&t.driverId){
      const dStaff=this.staff.find(s=>s.id===t.driverId),dContract=this.contractDrivers.find(d=>d.id===t.driverId);
      driverEmail=dStaff?.email||dContract?.email||'';
      driverPhone=dStaff?.phone||dContract?.phone||'';
    }
    const svObj=this.staff.find(s=>s.id===t.supervisorId);
    const officerPhone=this.staff.find(s=>s.id===t.staffId)?.phone||this.user.phone||'';
    const officerEmail=t.staffEmail||this.staff.find(s=>s.id===t.staffId)?.email||'';
    API.gasNotify({action:'tripCancelled',data:{
      id,officer:t.officer,unit:t.unit,route:routeChain(parseStops(t.stops)),project:t.project,
      depDate:t.depDate,retDate:t.retDate,driver:t.driver||'',vehicle:t.vehicle||'',
      adminEmail:adminStaff?.email||ADMIN_EMAIL,supervisorEmail:svObj?.email||'',supervisorName:t.supervisorName||'',driverEmail,staffEmail:officerEmail,
      adminPhone:adminStaff?.phone||ADMIN_PHONE,supervisorPhone:svObj?.phone||'',driverPhone,staffPhone:officerPhone
    }}).catch(()=>{});
  }

  /* ── Click a free day on the availability calendar → start a request on that date ── */
  requestOn(ds){
    const prefix=isSupervisor(this.user)?'sv':'st';
    const scope=prefix==='sv'?'supervisor':'staff';
    this._setEditMode(prefix,null);
    const arr=this._getStops(prefix);
    if(arr&&arr.length){arr[0].dep=ds;if(!arr[0].ret)arr[0].ret=ds;}
    this._renderStops(prefix);this._updateSummary(prefix);
    const tabs=$(scope+'-tabs');
    const btn=tabs?Array.from(tabs.children).find(b=>b.textContent.includes('Request')):null;
    this.showTab(scope,'request',btn);
    toast('Starting a request for '+fmt(ds),'info');
  }

  /* ── Shared: prefill the request form from an existing trip ── */
  _prefillForm(t){
    const stops=parseStops(t.stops);
    const prefix=isSupervisor(this.user)?'sv':'st';
    const projectEl=$(prefix==='sv'?'sv-tr-project':'tr-project');
    const purposeEl=$(prefix==='sv'?'sv-tr-purpose':'tr-purpose');
    const companionsEl=$(prefix==='sv'?'sv-tr-companions':'tr-companions');
    const supervisorEl=$(prefix==='sv'?'sv-tr-supervisor':'tr-supervisor');
    if(projectEl)projectEl.value=t.project||'';
    if(purposeEl)purposeEl.value=t.purpose||'';
    if(companionsEl)companionsEl.value=t.companions||'';
    if(supervisorEl&&t.supervisorId)supervisorEl.value=t.supervisorId;
    const fp=prefix==='sv'?'sv-tr-':'tr-';
    if($(fp+'type'))$(fp+'type').value=t.tripType||'round';
    if($(fp+'drop'))$(fp+'drop').value=t.dropTime||'';
    if($(fp+'pickup'))$(fp+'pickup').value=t.pickupTime||'';
    this.onTripTypeChange(prefix);
    this._setStops(prefix,stops.length?stops.map(s=>({from:s.from||'',to:s.to||'',dep:s.depDate||'',ret:s.retDate||''})):[{from:'Accra',to:'',dep:'',ret:''}]);
    this._renderStops(prefix);
    this._updateSummary(prefix);
    const scope=prefix==='sv'?'supervisor':'staff';
    const tabs=$(scope+'-tabs');
    const btn=tabs?Array.from(tabs.children).find(b=>b.textContent.includes('Request')):null;
    this.showTab(scope,'request',btn);
    return prefix;
  }

  /* ── Edit-mode banner + submit button label ── */
  _setEditMode(prefix,trip){
    this._editingTripId=trip?trip.id:null;
    const scope=prefix==='sv'?'supervisor':'staff';
    const panel=$(scope+'-request');
    if(!panel)return;
    let banner=$(prefix+'-edit-banner');
    if(trip){
      if(!banner){
        banner=document.createElement('div');
        banner.id=prefix+'-edit-banner';
        banner.className='clash-box';
        banner.style.borderLeftColor='var(--teal)';
        banner.style.background='#ECFDF5';
        banner.style.color='#065F46';
        banner.style.borderColor='#6EE7B7';
        const card=panel.querySelector('.card');
        if(card)card.insertBefore(banner,card.firstChild);
      }
      banner.innerHTML=`✎ <strong>Editing your existing request</strong> (${routeChain(parseStops(trip.stops))}, ${fmt(trip.depDate)}). Make your changes and click <strong>Save Changes</strong>. <button class="btn-sm btn-outline" style="margin-left:.5rem" onclick="TD.cancelEdit('${prefix}')">Cancel edit</button>`;
      banner.style.display='block';
    }else if(banner){
      banner.style.display='none';
    }
    /* Update the submit button label */
    const btns=panel.querySelectorAll('.btn-primary');
    btns.forEach(b=>{if(b.textContent.includes('Submit')||b.textContent.includes('Save Changes'))b.textContent=trip?'Save Changes':'Submit Request';});
  }

  cancelEdit(prefix){
    this._setEditMode(prefix,null);
    const projectEl=$(prefix==='sv'?'sv-tr-project':'tr-project');
    const purposeEl=$(prefix==='sv'?'sv-tr-purpose':'tr-purpose');
    const companionsEl=$(prefix==='sv'?'sv-tr-companions':'tr-companions');
    if(projectEl)projectEl.value='';if(purposeEl)purposeEl.value='';if(companionsEl)companionsEl.value='';
    const rp=prefix==='sv'?'sv-tr-':'tr-';
    if($(rp+'type'))$(rp+'type').value='round';
    if($(rp+'drop'))$(rp+'drop').value='';
    if($(rp+'pickup'))$(rp+'pickup').value='';
    this.onTripTypeChange(prefix);
    this._initStops(prefix);
    const sum=$(prefix==='sv'?'sv-tr-summary':'tr-summary');if(sum)sum.style.display='none';
    toast('Edit cancelled');
  }

  /* ── EDIT a pending trip (updates in place) ── */
  editTrip(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    if(t.status!=='pending'){toast('This trip can no longer be edited — cancel it and submit a new one instead','err');return;}
    const prefix=this._prefillForm(t);
    this._setEditMode(prefix,t);
    toast('Editing your request — make changes and click Save Changes','info');
  }

  /* ── EDIT & RESUBMIT (rejected/cancelled trips → creates a NEW trip) ── */
  resubmitTrip(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const prefix=this._prefillForm(t);
    this._setEditMode(prefix,null); /* not an edit — this creates a new trip */
    toast('Form pre-filled from your previous request — adjust the dates and resubmit','info');
  }

  _timeline4(t){
    const s=t.status;
    if(s==='cancelled')return'<div class="trip-timeline"><div class="tl-step" style="color:var(--text3)"><div class="tl-dot" style="background:var(--text3);border-color:var(--text3)"></div>Cancelled by requester</div></div>';
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

  /* A trip is "completed" once its return date has passed — derived, not stored,
     so back-dated records stop looking like live trips. */
  /* ── Trip type: round | dropoff | oneway ── */
  _typeLabel(t){
    const ty=(t&&t.tripType)||'round';
    if(ty==='dropoff'){
      const d=this._occupiedDays(t);
      const a=d[0],b=d[1];
      const dropTxt=(a?fmt(a):'—')+(t.dropTime?' '+t.dropTime:'');
      const pickTxt=(b?fmt(b):(a?fmt(a):'—'))+(t.pickupTime?' '+t.pickupTime:'');
      return'🔄 Drop off &amp; pick up · drop '+dropTxt+' → pick-up '+pickTxt
        +(b&&b!==a?' <span style="color:var(--green);font-weight:600">(vehicle free in between)</span>':'');
    }
    if(ty==='oneway')return'➡️ One way'+(t.dropTime?' · departs '+t.dropTime:'')+' <span style="color:var(--green);font-weight:600">(single journey — no return leg)</span>';
    return'🚗 Round trip'+(t.dropTime?' · departs '+t.dropTime:'');
  }
  _isDropoff(t){return t&&t.tripType==='dropoff';}

  /* Which calendar days this trip actually occupies a driver + vehicle.
     Round trip  → every day (the vehicle stays out).
     Drop & pick up → only the drop day and the pick-up day; the vehicle
                      returns to base in between and is free for other trips.
     One-way drop  → only the drop day.
     Accepts a trip object or a plain {tripType,stops,depDate,retDate}. */
  _occupiedDays(t){
    if(!t)return[];
    const stops=parseStops(t.stops)||[];
    const first=(stops[0]&&stops[0].depDate)||t.depDate;
    const last=(stops.length&&stops[stops.length-1].retDate)||t.retDate;
    const ty=t.tripType||'round';
    if(ty==='oneway')return first?[first]:[];
    if(ty==='dropoff'){
      const d=[];if(first)d.push(first);if(last&&last!==first)d.push(last);return d;
    }
    /* Round trip — every day across every leg */
    const out=new Set();
    const addRange=(a,b)=>{
      if(!a)return;const end=b||a;
      for(let x=new Date(a).getTime();x<=new Date(end).getTime();x+=86400000)
        out.add(new Date(x).toISOString().slice(0,10));
    };
    if(stops.length)stops.forEach(st=>addRange(st.depDate,st.retDate));
    else addRange(t.depDate,t.retDate);
    return[...out];
  }
  _occupiesDay(t,ds){return this._occupiedDays(t).includes(ds);}
  onTripTypeChange(prefix){
    const p=prefix==='sv'?'sv-tr-':'tr-';
    const ty=$(p+'type')?.value||'round';
    const wrap=$(p+'times-wrap');if(!wrap)return;
    const pu=$(p+'pickup'),sep=$(p+'times-sep'),lab=$(p+'times-label'),hint=$(p+'times-hint');
    wrap.style.display=ty==='round'?'none':'block';
    const showPick=ty==='dropoff';
    if(pu)pu.style.display=showPick?'':'none';
    if(sep)sep.style.display=showPick?'':'none';
    if(lab)lab.textContent=showPick?'Drop-off time (departure date) → Pick-up time (return date)':'Departure time';
    if(hint)hint.textContent=showPick
      ?'The driver drops you on your departure date and picks you up on your return date. The vehicle is released on the days in between — they stay bookable for others.'
      :'One journey only — outward or return. Use this for airport runs, or when you are travelling on by other means.';
  }

  _hasEnded(t){return !!(t&&t.retDate&&t.retDate<new Date().toISOString().slice(0,10));}
  _isPast(t){return !!(t&&t.status==='approved'&&this._hasEnded(t));}
  _badge(s,t){
    if(s==='approved'&&this._isPast(t))return'<span class="badge" style="background:#F1F5F9;color:#334155;border:1px solid #CBD5E1">✓ Completed</span>';
    if(s==='approved')return'<span class="badge b-approved">✓ Approved</span>';
    if(s==='rejected')return'<span class="badge b-rejected">✗ Rejected</span>';
    if(s==='cancelled')return'<span class="badge" style="background:#F1F5F9;color:#475569;border:1px solid #CBD5E1">⊘ Cancelled</span>';
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
        <div class="pend-meta"><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose||'—'}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br><strong>Type:</strong> ${this._typeLabel(t)}${t.companions?' · <strong>With:</strong> '+t.companions:''}<br><strong>📅 Submitted:</strong> <span style="color:var(--teal);font-weight:600">${fmtTime(t.submitted)}</span></div>
        ${stopsHTML}
        <div class="pend-actions"><button class="btn-sm btn-gold" onclick="TD.openSupervisorModal('${t.id}')">👁 Review &amp; Decide</button></div>
      </div>`;
    }).join('');
  }

  openSupervisorModal(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const stops=parseStops(t.stops);
    $('sv-tm-title').textContent='Review: '+t.officer;
    $('sv-tm-info').innerHTML=`<strong>Officer:</strong> ${t.officer} (${t.unit})<br><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br><strong>Type:</strong> ${this._typeLabel(t)}<br>${t.companions?'<strong>Companions:</strong> '+t.companions+'<br>':''}<strong>Submitted:</strong> ${fmt(t.submitted)}`;
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
    API.audit(newStatus==='supervisor_approved'?'supervisor_approved':'supervisor_rejected',id,t.officer+' · '+routeChain(parseStops(t.stops))+(note?' · note: '+note:''));
    toast(newStatus==='supervisor_approved'?'Approved — forwarded to admin ✓':'Trip rejected');
    const adminStaff=this.staff.find(s=>s.role==='admin');
    /* Fall back to the officer's CURRENT email if the trip predates their email being on file */
    const officerEmail=t.staffEmail||this.staff.find(s=>s.id===t.staffId)?.email||'';
    const officerPhone=this.staff.find(s=>s.id===t.staffId)?.phone||'';
    API.gasNotify({action:'supervisorDecision',data:{
      id,status:newStatus,supervisorNote:note,officer:t.officer,
      route:routeChain(parseStops(t.stops)),project:t.project,purpose:t.purpose,
      depDate:t.depDate,retDate:t.retDate,staffEmail:officerEmail,
      supervisorName:this.user.name,supervisorEmail:this.user.email,adminEmail:adminStaff?.email||ADMIN_EMAIL,
      staffPhone:officerPhone,supervisorPhone:this.user.phone||'',adminPhone:adminStaff?.phone||ADMIN_PHONE
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
      return`<tr><td><strong>${t.officer}</strong></td><td style="font-size:.68rem">${t.unit}</td><td style="font-size:.68rem">${t.project||'—'}</td><td>${routeChainHTML(stops)}</td><td style="font-size:.68rem;white-space:nowrap">${fmt(t.depDate)} → ${fmt(t.retDate)}</td><td>${this._badge(t.status,t)}</td><td>${myDec}</td></tr>`;
    }).join('');
  }

  /* ── ADMIN — Dashboard ── */
  renderDash(){
    const total=this.trips.length,pend=this.trips.filter(t=>t.status==='pending').length;
    const svPend=this.trips.filter(t=>t.status==='supervisor_approved').length;
    const apprAll=this.trips.filter(t=>t.status==='approved');
    const done=apprAll.filter(t=>this._isPast(t)).length;
    const appr=apprAll.length-done;
    $('ad-stats').innerHTML=`
      <div class="stat"><div class="stat-lbl">Total Trips</div><div class="stat-val" style="color:var(--purple)">${total}</div></div>
      <div class="stat"><div class="stat-lbl">With Supervisor</div><div class="stat-val" style="color:var(--gold)">${pend}</div></div>
      <div class="stat"><div class="stat-lbl">Ready to Assign</div><div class="stat-val" style="color:var(--teal)">${svPend}</div></div>
      <div class="stat"><div class="stat-lbl">Active / Upcoming</div><div class="stat-val" style="color:var(--green)">${appr}</div></div>
      <div class="stat"><div class="stat-lbl">Completed</div><div class="stat-val" style="color:var(--text2)">${done}</div></div>
      <div class="stat"><div class="stat-lbl">Vehicles</div><div class="stat-val" style="color:#818cf8">${this.vehicles.length}</div></div>`;
    const body=$('ad-recent-body');
    body.innerHTML=this.trips.slice(0,8).map(t=>`<tr><td><strong>${t.officer}</strong></td><td>${routeChainHTML(parseStops(t.stops))}</td><td style="font-size:.7rem">${t.project||'—'}</td><td style="font-size:.7rem">${fmt(t.depDate)} → ${fmt(t.retDate)}</td><td style="font-size:.66rem;color:var(--text2)" title="${fmtTime(t.submitted)}">${fmt(t.submitted)}</td><td>${this._badge(t.status,t)}</td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1.5rem">No trips yet</td></tr>';
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
      const ended=this._hasEnded(t);
      return`<div class="pend-card" style="border-left-color:${ended?'#94a3b8':'var(--teal)'}">
        <h4>${t.officer}: ${routeChain(stops)} ${ended?'<span class="badge" style="background:#F1F5F9;color:#334155;border:1px solid #CBD5E1;font-size:.55rem">⏪ already ended</span>':''}</h4>
        <div class="pend-meta"><strong>Project:</strong> ${t.project||'—'} · <strong>Unit:</strong> ${t.unit}<br><strong>Purpose:</strong> ${t.purpose||'—'}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br><strong>Type:</strong> ${this._typeLabel(t)}<br><strong>Supervisor:</strong> ${t.supervisorName||'—'}${t.supervisorNote?' · <em>'+t.supervisorNote+'</em>':''}${t.companions?' · <strong>With:</strong> '+t.companions:''}<br><strong>📅 Submitted:</strong> <span style="color:var(--teal);font-weight:600">${fmtTime(t.submitted)}</span></div>
        ${stopsHTML}
        <div class="pend-actions"><button class="btn-sm btn-gold" onclick="TD.openAdminModal('${t.id}')">🚗 Assign Driver &amp; Vehicle</button> <button class="btn-sm btn-outline" onclick="TD.openEditDates('${t.id}')" title="Edit dates">✎ Dates</button> <button class="btn-sm btn-outline" style="color:var(--red);border-color:#fca5a5" onclick="TD.deleteTrip('${t.id}')">🗑 Delete</button></div>
      </div>`;
    }).join('');
  }

  openAdminModal(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const stops=parseStops(t.stops);
    $('tm-title').textContent='Assign: '+t.officer;
    $('tm-info').innerHTML=`<strong>Officer:</strong> ${t.officer} (${t.unit})<br><strong>Project:</strong> ${t.project||'—'}<br><strong>Purpose:</strong> ${t.purpose}<br><strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br><strong>Type:</strong> ${this._typeLabel(t)}<br><strong>Supervisor:</strong> ${t.supervisorName||'—'}${t.supervisorNote?' · <em>'+t.supervisorNote+'</em>':''}<br><strong>📅 Submitted:</strong> ${fmtTime(t.submitted)}`
      +(this._hasEnded(t)?`<div style="margin-top:.5rem;padding:.45rem .6rem;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-size:.7rem;color:#334155"><strong>⏪ This trip already ended on ${fmt(t.retDate)}.</strong> You are recording it after the fact, so driver and vehicle availability is not enforced — it will be marked <strong>Completed</strong> once saved.</div>`:'');
    $('tm-stops').innerHTML=stops.length?`<div style="font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:.3rem">Itinerary</div>`+stops.map((s,i)=>`<div style="display:flex;align-items:center;gap:.4rem;padding:.25rem .5rem;background:var(--surf2);border-radius:6px;margin-bottom:.25rem;font-size:.74rem"><strong style="color:var(--purple)">${i+1}.</strong> ${s.from} <span style="color:var(--teal);font-weight:800">→</span> ${s.to}<span style="color:var(--text3);margin-left:auto;font-size:.65rem">${fmt(s.depDate)} → ${fmt(s.retDate)}</span></div>`).join(''):'';
    /* ── Double-booking guard ──
       Only meaningful for trips that have not yet ended. A trip being recorded after the
       fact cannot tie anyone up now, so conflicts are shown as context, never as a block. */
    const recordingPast=this._hasEnded(t);
    const tDays=this._occupiedDays(t);
    const busyDrivers={},busyVehicles={};
    this.trips.forEach(b=>{
      if(b.id===t.id||b.status!=='approved')return;
      const clashDays=tDays.filter(x=>this._occupiesDay(b,x));
      if(!clashDays.length)return;                        /* never out on the same day */
      /* Same day, but both are drop/pick-up runs — the vehicle is only tied up
         for part of each day, so flag it and let admin judge. */
      const shareable=this._isDropoff(t)&&this._isDropoff(b);
      const when=clashDays.map(x=>fmt(x)).join(', ')+(shareable&&b.dropTime?' ('+b.dropTime+'→'+(b.pickupTime||'—')+')':'');
      const rec={when,soft:shareable};
      if(b.driverId&&!busyDrivers[b.driverId])busyDrivers[b.driverId]=rec;
      if(b.vehicleId&&!busyVehicles[b.vehicleId])busyVehicles[b.vehicleId]=rec;
    });
    const softAll=recordingPast;
    const optAttr=b=>(softAll||b.soft)?'':'disabled';
    const optMark=b=>((softAll||b.soft)?' — also on ':' — ⛔ on trip ')+b.when;
    const driverOptions=this.staff.filter(s=>isDriver(s)).map(d=>{
      const busy=busyDrivers[d.id];
      return`<option value="${d.id}" ${busy?optAttr(busy):''}>${d.name}${busy?optMark(busy):''}</option>`;
    }).join('');
    const cdOptions=this.contractDrivers.map(d=>{
      const busy=busyDrivers[d.id];
      return`<option value="CD_${d.id}" ${busy?optAttr(busy):''}>🚐 ${d.name} (${d.id})${busy?optMark(busy):''}</option>`;
    }).join('');
    const selfBusy=busyDrivers[t.staffId];
    const selfDriveOpt=`<option value="SELF_${t.staffId}" ${selfBusy?optAttr(selfBusy):''} style="font-weight:600">🚗 Self-Driving — ${t.officer}${selfBusy?optMark(selfBusy):''}</option>`;
    $('tm-driver').innerHTML='<option value="">— Select driver —</option>'
      +(driverOptions?`<optgroup label="── Staff Drivers ──">${driverOptions}</optgroup>`:'')
      +(cdOptions?`<optgroup label="── Contract Drivers ──">${cdOptions}</optgroup>`:'')
      +`<optgroup label="── Self-Driving ──">${selfDriveOpt}</optgroup>`;
    $('tm-vehicle').innerHTML='<option value="">— Select vehicle —</option>'+this.vehicles.map(v=>{
      const busy=busyVehicles[v.id];
      return`<option value="${v.id}" ${busy?optAttr(busy):''}>${v.plate} — ${v.make}${busy?optMark(busy):''}</option>`;
    }).join('');
    $('tm-note').value='';$('tm-id').value=id;$('trip-modal').classList.add('open');
  }

  async adminAssign(){
    const id=$('tm-id').value,t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const dId=$('tm-driver').value,vId=$('tm-vehicle').value,note=$('tm-note').value.trim();
    if(!dId)return toast('Select a driver','err');
    if(!vId)return toast('Select a vehicle','err');
    /* Final double-booking check at save time */
    const rawDid=dId.startsWith('SELF_')?dId.replace('SELF_',''):dId.startsWith('CD_')?dId.replace('CD_',''):dId;
    const myDays=this._occupiedDays(t);
    const conflict=this._hasEnded(t)?null:this.trips.find(b=>b.id!==t.id&&b.status==='approved'&&!(this._isDropoff(t)&&this._isDropoff(b))&&myDays.some(x=>this._occupiesDay(b,x))&&(b.driverId===rawDid||b.vehicleId===vId));
    if(conflict){toast('⛔ Double-booking: '+(conflict.driverId===rawDid?'driver':'vehicle')+' is already on '+conflict.officer+'\'s trip '+fmt(conflict.depDate)+'–'+fmt(conflict.retDate),'err');return;}
    const isSelfDrive=dId.startsWith('SELF_');
    const isContract=dId.startsWith('CD_');
    const actualDriverId=isSelfDrive?dId.replace('SELF_',''):isContract?dId.replace('CD_',''):dId;
    let dName='',dEmail='',dPhone='';
    if(isSelfDrive){
      dName=t.officer+' (Self-Driving)';dEmail=t.staffEmail||'';dPhone=this.staff.find(s=>s.id===t.staffId)?.phone||'';
    }else if(isContract){
      const cd=this.contractDrivers.find(d=>d.id===actualDriverId);
      dName=(cd?.name||'')+'  (Contract)';dEmail=cd?.email||'';dPhone=cd?.phone||'';
    }else{
      const staffD=this.staff.find(s=>s.id===dId);
      dName=staffD?.name||'';dEmail=staffD?.email||'';dPhone=staffD?.phone||'';
    }
    const veh=this.vehicles.find(v=>v.id===vId);
    const vLabel=veh?veh.plate+' — '+(veh.make||''):'';
    const now=new Date().toISOString();
    showLoader('Confirming…');
    await API.upd('trips','id=eq.'+encodeURIComponent(id),{status:'approved',driver:dName,driver_id:actualDriverId,vehicle:vLabel,vehicle_id:vId,admin_note:note,updated_at:now});
    t.status='approved';t.driver=dName;t.driverId=actualDriverId;t.vehicle=vLabel;t.vehicleId=vId;t.adminNote=note;t.updatedAt=now;
    hideLoader();closeModal('trip-modal');
    this.renderDash();this.renderAdminPending();this.renderAllTrips();this._renderAdminCal();this.renderHistory();
    const wasPast=this._hasEnded(t);
    API.audit('trip_assigned',id,t.officer+' · '+routeChain(parseStops(t.stops))+' · driver: '+dName+' · vehicle: '+vLabel+(wasPast?' (recorded after the trip ended)':''));
    toast(wasPast?'Recorded ✓ — marked Completed':'Trip approved & assigned ✓');
    const svObj=this.staff.find(s=>s.id===t.supervisorId);
    const adminObj=this.staff.find(s=>s.role==='admin');
    /* Fall back to the officer's CURRENT email if the trip predates their email being on file */
    const officerEmail=t.staffEmail||this.staff.find(s=>s.id===t.staffId)?.email||'';
    const officerPhone=this.staff.find(s=>s.id===t.staffId)?.phone||'';
    if(!isSelfDrive&&!dPhone&&!dEmail)toast('⚠ '+dName+' has no phone or email on file — they will NOT be notified','err');
    else if(!isSelfDrive&&!dPhone)toast('⚠ '+dName+' has no phone on file — notified by email instead','info');
    if(!officerPhone&&!officerEmail)toast('⚠ '+t.officer+' has no phone or email on file — they will NOT be notified','err');
    API.gasNotify({action:'adminAssigned',data:{
      id,officer:t.officer,route:routeChain(parseStops(t.stops)),project:t.project,purpose:t.purpose,
      depDate:t.depDate,retDate:t.retDate,driver:dName,vehicle:vLabel,adminNote:note,
      tripType:t.tripType||'round',dropTime:t.dropTime||'',pickupTime:t.pickupTime||'',
      staffEmail:officerEmail,supervisorName:t.supervisorName,supervisorEmail:svObj?.email||'',driverEmail:isSelfDrive?officerEmail:dEmail,
      adminEmail:adminObj?.email||ADMIN_EMAIL,
      staffPhone:officerPhone,supervisorPhone:svObj?.phone||'',driverPhone:isSelfDrive?officerPhone:dPhone,adminPhone:adminObj?.phone||ADMIN_PHONE
    }}).catch(()=>{});
  }

  /* ══════════════════════════════════════════════════
     CONTRACT DRIVER DASHBOARD — Their assigned trips
  ══════════════════════════════════════════════════ */
  renderDriverTrips(boxId='cd-trips-cards',summaryId='cd-summary'){
    const box=$(boxId);if(!box)return;
    /* Match trips by driver_id == this driver's id (CD/xxx or staff id) */
    const myTrips=this.trips.filter(t=>t.driverId===this.user.id&&t.status==='approved');
    /* Sort: upcoming first (future trips closest to today), then past */
    const today=new Date().toISOString().slice(0,10);
    myTrips.sort((a,b)=>{
      const aUpcoming=a.retDate>=today,bUpcoming=b.retDate>=today;
      if(aUpcoming&&!bUpcoming)return -1;
      if(!aUpcoming&&bUpcoming)return 1;
      if(aUpcoming)return new Date(a.depDate)-new Date(b.depDate);
      return new Date(b.depDate)-new Date(a.depDate);
    });
    const upcoming=myTrips.filter(t=>t.retDate>=today);
    const past=myTrips.filter(t=>t.retDate<today);
    /* Header summary */
    const summaryEl=$(summaryId);
    if(summaryEl)summaryEl.innerHTML=`<strong>${upcoming.length}</strong> upcoming · <strong>${past.length}</strong> completed`;
    if(!myTrips.length){box.innerHTML='<div class="card" style="text-align:center;color:var(--text3);padding:2rem">No trips assigned to you yet. You\'ll see them here once admin assigns you a trip. 🚗</div>';return;}
    box.innerHTML=myTrips.map(t=>{
      const stops=parseStops(t.stops);
      const isUpcoming=t.retDate>=today;
      const started=!!t.tripStartedAt,ended=!!t.tripEndedAt;
      const isDriving=started&&!ended;
      const statusBadge=isDriving?'<span class="badge" style="background:#FFF7ED;color:#9A3412;border:1px solid #FDBA74">🚗 On Trip</span>':ended?'<span class="badge b-approved">✓ Trip Logged</span>':isUpcoming?'<span class="badge b-sv-approved">📅 Upcoming</span>':'<span class="badge" style="background:#F1F5F9;color:#475569;border:1px solid #CBD5E1">— Not Logged</span>';
      /* Trip log section */
      let logHTML='';
      if(started||ended){
        const km=(t.odoStart!=null&&t.odoEnd!=null)?(t.odoEnd-t.odoStart):null;
        logHTML=`<div style="margin-top:.5rem;padding:.5rem .7rem;background:${ended?'#ECFDF5':'#FFF7ED'};border:1px solid ${ended?'#6EE7B7':'#FDBA74'};border-radius:8px;font-size:.7rem;line-height:1.7">
          <strong style="font-size:.6rem;text-transform:uppercase;letter-spacing:.5px;color:${ended?'#065F46':'#9A3412'}">Trip Log</strong><br>
          ▶ <strong>Started:</strong> ${fmtTime(t.tripStartedAt)}${t.odoStart!=null?' · Odo: '+Number(t.odoStart).toLocaleString()+' km':''}
          ${ended?`<br>⏹ <strong>Ended:</strong> ${fmtTime(t.tripEndedAt)}${t.odoEnd!=null?' · Odo: '+Number(t.odoEnd).toLocaleString()+' km':''}`:''}
          ${km!=null?`<br>📏 <strong>Distance:</strong> ${km.toLocaleString()} km`:''}
        </div>`;
      }
      /* Action buttons */
      let actions='';
      if(!started)actions=`<div style="margin-top:.6rem"><button class="btn-sm btn-green" onclick="TD.openTripLog('${t.id}','start')">▶ Start Trip</button></div>`;
      else if(!ended)actions=`<div style="margin-top:.6rem"><button class="btn-sm btn-red" onclick="TD.openTripLog('${t.id}','end')">⏹ End Trip</button></div>`;
      return`<div class="trip-card" style="border-left:4px solid ${isDriving?'var(--gold)':ended?'var(--green)':isUpcoming?'var(--teal)':'var(--text3)'}">
        <div class="trip-card-badge">${statusBadge}</div>
        <div class="trip-card-route"><div class="route-chain">${routeChainHTML(stops,'route-chain')}</div></div>
        <div class="trip-card-meta">
          <strong>Officer:</strong> ${t.officer} · <strong>Unit:</strong> ${t.unit}<br>
          <strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)} · <strong>${stops.length} stop${stops.length!==1?'s':''}</strong><br>
          <strong>Type:</strong> ${this._typeLabel(t)}<br>
          <strong>Project:</strong> ${t.project||'—'}<br>
          <strong>Purpose:</strong> ${t.purpose||'—'}<br>
          <strong>Vehicle:</strong> ${t.vehicle||'—'}
          ${t.companions?'<br><strong>Companions:</strong> '+t.companions:''}
          ${t.adminNote?'<br><strong>Admin Note:</strong> <em>'+t.adminNote+'</em>':''}
        </div>
        ${stops.length>1?`<div style="margin-top:.5rem;padding:.4rem .6rem;background:var(--surf2);border-radius:8px;font-size:.7rem"><strong style="color:var(--text2);font-size:.6rem;text-transform:uppercase;letter-spacing:.5px">Itinerary</strong><br>${stops.map((s,i)=>`<div style="padding:.15rem 0">${i+1}. ${s.from} → ${s.to} <span style="color:var(--text3);font-size:.65rem">(${fmt(s.depDate)})</span></div>`).join('')}</div>`:''}
        ${logHTML}${actions}
      </div>`;
    }).join('');
  }

  /* ── TRIP LOG (start/end with odometer) ── */
  openTripLog(id,phase){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    this._tlogId=id;this._tlogPhase=phase;
    $('tlog-title').textContent=phase==='start'?'▶ Start Trip':'⏹ End Trip';
    $('tlog-info').innerHTML=`<strong>Route:</strong> ${routeChain(parseStops(t.stops))}<br><strong>Vehicle:</strong> ${t.vehicle||'—'}${phase==='end'&&t.odoStart!=null?'<br><strong>Odometer at start:</strong> '+Number(t.odoStart).toLocaleString()+' km':''}`;
    $('tlog-odo').value='';$('tlog-msg').textContent='';
    $('tlog-odo-label').textContent=phase==='start'?'Odometer reading at departure (km)':'Odometer reading at return (km)';
    /* Prefill the timestamp: now for a live trip, the trip's own dates for a past one */
    const tw=$('tlog-when');
    if(tw){
      const base=phase==='start'?t.depDate:t.retDate;
      const useTrip=this._isPast(t)||(base&&base<new Date().toISOString().slice(0,10));
      tw.value=useTrip?(base+'T08:00'):new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
    $('tlog-modal').classList.add('open');
  }
  async saveTripLog(){
    const id=this._tlogId,phase=this._tlogPhase;
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const msg=$('tlog-msg');msg.textContent='';
    const odoRaw=$('tlog-odo').value.trim();
    const odo=odoRaw===''?null:Number(odoRaw);
    if(odoRaw!==''&&(isNaN(odo)||odo<0)){msg.innerHTML='<span style="color:var(--red)">Enter a valid odometer number.</span>';return;}
    if(phase==='end'&&odo!=null&&t.odoStart!=null&&odo<t.odoStart){msg.innerHTML='<span style="color:var(--red)">End reading can\'t be less than start reading ('+Number(t.odoStart).toLocaleString()+' km).</span>';return;}
    const whenRaw=$('tlog-when')?.value;
    const now=whenRaw?new Date(whenRaw).toISOString():new Date().toISOString();
    if(isNaN(new Date(now).getTime())){msg.innerHTML='<span style="color:var(--red)">Enter a valid date and time.</span>';return;}
    if(phase==='end'&&t.tripStartedAt&&new Date(now)<new Date(t.tripStartedAt)){msg.innerHTML='<span style="color:var(--red)">End time cannot be before the start time ('+fmtTime(t.tripStartedAt)+').</span>';return;}
    const patch=phase==='start'?{trip_started_at:now,odo_start:odo}:{trip_ended_at:now,odo_end:odo};
    showLoader(phase==='start'?'Starting trip…':'Ending trip…');
    const r=await API.upd('trips','id=eq.'+encodeURIComponent(id),patch);
    hideLoader();
    if(!r){toast('Server error — check that the trip log columns exist','err');return;}
    if(phase==='start'){t.tripStartedAt=now;t.odoStart=odo;}
    else{t.tripEndedAt=now;t.odoEnd=odo;}
    closeModal('tlog-modal');
    /* Re-render whichever driver view is active */
    if(this.user.role==='contract_driver')this.renderDriverTrips();
    else if(this.user.role==='admin'){this.renderHistory();this.renderDash();this.renderAllTrips();}
    else this.renderDriverTrips('st-assign-cards','st-assign-summary');
    API.audit(phase==='start'?'trip_started':'trip_ended',id,routeChain(parseStops(t.stops))+(odo!=null?' · odo '+odo+' km':' · no odometer reading'));
    toast(phase==='start'?'Trip started — safe journey! 🚗':'Trip ended — log saved ✓');
  }

  async changeDriverPass(){
    const old=$('cd-old-pw')?.value,np=$('cd-new-pw')?.value,conf=$('cd-conf-pw')?.value;
    const msg=$('cd-pw-msg');msg.textContent='';
    if(!old||!np||!conf){msg.innerHTML='<span style="color:var(--red)">Fill all fields.</span>';return;}
    if(np.length<4){msg.innerHTML='<span style="color:var(--red)">Min 4 chars.</span>';return;}
    if(np!==conf){msg.innerHTML='<span style="color:var(--red)">Passwords don\'t match.</span>';return;}
    const uid=this.user.id;
    const rows=await API.get('contract_drivers','id=eq.'+encodeURIComponent(uid));
    if(!rows?.length){msg.innerHTML='<span style="color:var(--red)">Account not found.</span>';return;}
    const hashedOld=await hashPassword(old,uid);
    const storedPw=extractPw(rows[0]);
    const firstTimeOk=!storedPw&&old==='1234';
    if(!firstTimeOk&&storedPw!==hashedOld&&storedPw!==old){msg.innerHTML='<span style="color:var(--red)">Wrong current password.</span>';return;}
    const hashedNew=await hashPassword(np,uid);
    await API.upd('contract_drivers','id=eq.'+encodeURIComponent(uid),{password:hashedNew});
    msg.innerHTML='<span style="color:var(--green)">✓ Password changed!</span>';
    $('cd-old-pw').value='';$('cd-new-pw').value='';$('cd-conf-pw').value='';
    toast('Password updated');
  }

  /* ══════════════════════════════════════════════════
     ASSIGNMENT HISTORY — Full log + summary stats
  ══════════════════════════════════════════════════ */
  renderHistory(){
    const statsEl=$('hist-stats');
    const listEl=$('hist-list');
    const countEl=$('hist-count');
    if(!statsEl||!listEl)return;

    /* Filter to approved trips only (these have assignments) */
    let assigned=this.trips.filter(t=>t.status==='approved'&&t.driver);

    /* Apply filters */
    const mf=$('hist-month')?.value||'';
    const sf=($('hist-search')?.value||'').toLowerCase();
    if(mf){const[y,m]=mf.split('-').map(Number);assigned=assigned.filter(t=>{const d=new Date(t.depDate);return d.getFullYear()===y&&d.getMonth()===m-1;});}
    if(sf)assigned=assigned.filter(t=>
      t.officer.toLowerCase().includes(sf)||
      t.driver.toLowerCase().includes(sf)||
      t.vehicle.toLowerCase().includes(sf)||
      (t.project||'').toLowerCase().includes(sf)
    );

    /* Sort by most recently assigned (updated_at or submitted) */
    assigned.sort((a,b)=>(new Date(b.updatedAt||b.submitted))-(new Date(a.updatedAt||a.submitted)));

    countEl.textContent=assigned.length;

    /* ── 🚦 On the Road Now — started but not ended (unfiltered: always live) ── */
    const roadCard=$('ontheroad-card'),roadList=$('ontheroad-list');
    if(roadCard&&roadList){
      const onRoad=this.trips.filter(t=>t.status==='approved'&&t.tripStartedAt&&!t.tripEndedAt);
      if(onRoad.length){
        roadCard.style.display='';
        roadList.innerHTML=onRoad.map(t=>`<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px;margin-bottom:.4rem;font-size:.76rem;flex-wrap:wrap">
          <span style="font-weight:700">🚗 ${t.driver}</span>
          <span>→ ${routeChain(parseStops(t.stops))}</span>
          <span class="hist-vehicle-tag">🚘 ${t.vehicle||'—'}</span>
          <span style="color:var(--text3);font-size:.68rem;margin-left:auto">Departed ${fmtTime(t.tripStartedAt)}${t.odoStart!=null?' · Odo '+Number(t.odoStart).toLocaleString()+' km':''}</span>
        </div>`).join('');
      }else roadCard.style.display='none';
    }

    /* ── 🧭 Odometer Log table — trips with logs, follows same filters ── */
    const odoBody=$('odo-log-body');
    if(odoBody){
      const logged=assigned.filter(t=>t.tripStartedAt);
      if(!logged.length)odoBody.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:1.2rem">No odometer entries yet. Drivers log readings via ▶ Start / ⏹ End Trip on their page.</td></tr>';
      else odoBody.innerHTML=logged.map(t=>{
        const km=(t.odoStart!=null&&t.odoEnd!=null)?(t.odoEnd-t.odoStart):null;
        return`<tr>
          <td><strong>${t.officer}</strong></td><td style="font-size:.7rem">${t.driver}</td><td style="font-size:.7rem">${t.vehicle||'—'}</td>
          <td style="font-size:.68rem;white-space:nowrap">${fmtTime(t.tripStartedAt)}</td>
          <td>${t.odoStart!=null?Number(t.odoStart).toLocaleString()+' km':'—'}</td>
          <td style="font-size:.68rem;white-space:nowrap">${t.tripEndedAt?fmtTime(t.tripEndedAt):'<span style="color:#9A3412;font-weight:700">on trip</span>'}</td>
          <td>${t.odoEnd!=null?Number(t.odoEnd).toLocaleString()+' km':'—'}</td>
          <td>${km!=null?'<strong style="color:var(--green)">'+km.toLocaleString()+' km</strong>':'—'}</td>
        </tr>`;
      }).join('');
    }

    /* Summary stats */
    const totalAssigned=assigned.length;
    const driverMap={};assigned.forEach(t=>{const d=t.driver||'—';driverMap[d]=(driverMap[d]||0)+1;});
    const vehicleMap={};assigned.forEach(t=>{const v=t.vehicle||'—';vehicleMap[v]=(vehicleMap[v]||0)+1;});
    const topDriver=Object.entries(driverMap).sort((a,b)=>b[1]-a[1])[0];
    const topVehicle=Object.entries(vehicleMap).sort((a,b)=>b[1]-a[1])[0];
    const uniqueDrivers=Object.keys(driverMap).length;
    const uniqueVehicles=Object.keys(vehicleMap).length;

    statsEl.innerHTML=`
      <div class="hist-stat"><div class="hist-stat-lbl">Total Assignments</div><div class="hist-stat-val">${totalAssigned}</div></div>
      <div class="hist-stat"><div class="hist-stat-lbl">Drivers Used</div><div class="hist-stat-val">${uniqueDrivers}</div></div>
      <div class="hist-stat"><div class="hist-stat-lbl">Vehicles Used</div><div class="hist-stat-val">${uniqueVehicles}</div></div>
      <div class="hist-stat"><div class="hist-stat-lbl">Busiest Driver</div><div class="hist-stat-val" style="font-size:.85rem">${topDriver?topDriver[0].split(' ')[0]:'—'}</div></div>
      <div class="hist-stat"><div class="hist-stat-lbl">Most Used Vehicle</div><div class="hist-stat-val" style="font-size:.72rem">${topVehicle?topVehicle[0].split(' — ')[0]:'—'}</div></div>`;

    /* Render history cards */
    if(!assigned.length){
      listEl.innerHTML='<div style="text-align:center;color:var(--text3);padding:2rem">No assignment history found.</div>';
      return;
    }
    listEl.innerHTML=assigned.map(t=>{
      const stops=parseStops(t.stops);
      const km=(t.odoStart!=null&&t.odoEnd!=null)?(t.odoEnd-t.odoStart):null;
      const logLine=t.tripStartedAt?`<br><strong>🚗 Trip Log:</strong> Started ${fmtTime(t.tripStartedAt)}${t.odoStart!=null?' <span class="hist-vehicle-tag">Odo: '+Number(t.odoStart).toLocaleString()+' km</span>':''}${t.tripEndedAt?' · Ended '+fmtTime(t.tripEndedAt)+(t.odoEnd!=null?' <span class="hist-vehicle-tag">Odo: '+Number(t.odoEnd).toLocaleString()+' km</span>':''):' · <span style="color:#9A3412;font-weight:700">still on trip</span>'}${km!=null?' · <span class="hist-vehicle-tag" style="color:var(--green);border-color:#6EE7B7">📏 '+km.toLocaleString()+' km travelled</span>':''}`:'';
      return`<div class="hist-card">
        <div class="hist-card-main">
          <div class="hist-officer">${t.officer} <span style="font-weight:400;color:var(--text2);font-size:.72rem">· ${t.unit}</span></div>
          <div class="hist-route">${routeChain(stops)}</div>
          <div class="hist-detail">
            <strong>Project:</strong> ${t.project||'—'} · <strong>Dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}<br>
            <strong>Purpose:</strong> ${t.purpose||'—'}<br>
            <strong>Type:</strong> ${this._typeLabel(t)}<br>
            <strong>Driver:</strong> <span class="hist-vehicle-tag">🚗 ${t.driver}</span>
            <strong style="margin-left:.4rem">Vehicle:</strong> <span class="hist-vehicle-tag">🚘 ${t.vehicle||'—'}</span>
            ${t.supervisorName?'<br><strong>Approved by:</strong> '+t.supervisorName:''}
            ${t.adminNote?'<br><strong>Admin Note:</strong> <em>'+t.adminNote+'</em>':''}
            ${logLine}
          </div>
        </div>
        <div style="text-align:right">
          <div class="hist-time">${fmtTime(t.updatedAt||t.submitted)}</div>
          ${!t.tripStartedAt?`<button class="btn-sm btn-outline" style="margin-top:.4rem" onclick="TD.openTripLog('${t.id}','start')" title="Record departure for the record">▶ Log Start</button>`:(!t.tripEndedAt?`<button class="btn-sm btn-gold" style="margin-top:.4rem" onclick="TD.openTripLog('${t.id}','end')" title="Close out this trip">⏹ Log End</button>`:'')}
          <button class="btn-sm btn-outline" style="margin-top:.3rem" onclick="TD.openEditDates('${t.id}')">✎ Dates</button>
          <button class="btn-sm btn-outline" style="color:var(--red);border-color:#fca5a5;margin-top:.3rem" onclick="TD.deleteTrip('${t.id}')">🗑 Delete</button>
        </div>
      </div>`;
    }).join('');
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
    if(!list.length){body.innerHTML='<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:1.5rem">No trips match</td></tr>';return;}
    body.innerHTML=list.map(t=>{const stops=parseStops(t.stops);return`<tr>
      <td><strong>${t.officer}</strong></td><td style="font-size:.68rem">${t.unit}</td><td style="font-size:.68rem">${t.project||'—'}</td>
      <td>${routeChainHTML(stops)}</td><td style="font-size:.68rem">${t.supervisorName||'—'}</td>
      <td style="font-size:.66rem;white-space:nowrap;color:var(--text2)" title="${fmtTime(t.submitted)}">${fmt(t.submitted)}</td>
      <td style="font-size:.68rem;white-space:nowrap">${fmt(t.depDate)} → ${fmt(t.retDate)}</td>
      <td>${this._badge(t.status,t)}</td><td style="font-size:.68rem">${t.driver||'—'}</td><td style="font-size:.68rem">${t.vehicle||'—'}</td>
      <td>${t.status==='supervisor_approved'?`<button class="btn-sm btn-gold" onclick="TD.openAdminModal('${t.id}')">Assign</button> `:''}<button class="btn-sm btn-outline" onclick="TD.openEditDates('${t.id}')" title="Edit dates">✎</button> <button class="btn-sm btn-outline" onclick="TD.deleteTrip('${t.id}')">🗑</button></td>
    </tr>`;}).join('');
  }
  async deleteTrip(id){
    const t=this.trips.find(tr=>tr.id===id);
    const label=t?`${t.officer} — ${routeChain(parseStops(t.stops))} (${fmt(t.depDate)})`:'this trip';
    const warn=t&&t.driver?'\n\nDriver and vehicle were assigned — they will be freed.':'';
    if(!confirm('Permanently delete '+label+'?'+warn+'\n\nThis cannot be undone.'))return;
    showLoader('Deleting…');
    const r=await API.del('trips','id=eq.'+encodeURIComponent(id));
    hideLoader();
    if(!r){toast('Server error — trip not deleted','err');return;}
    this.trips=this.trips.filter(x=>x.id!==id);
    this.renderDash();this.renderAdminPending();this.renderAllTrips();this._renderAdminCal();this.renderHistory();
    API.audit('trip_deleted',id,label);
    toast('Trip deleted — calendar slot freed');
  }
  /* ══════════════════════════════════════════════════
     AUDIT TRAIL — who did what, when
  ══════════════════════════════════════════════════ */
  async loadAudit(){
    const rows=await API.get('audit_log','order=at.desc&limit=1000');
    this.auditRows=(rows||[]).map(r=>({
      id:r.id,actorId:r.actor_id||'',actorName:r.actor_name||'',actorRole:r.actor_role||'',
      action:r.action||'',target:r.target||'',detail:r.detail||'',at:r.at||''
    }));
    this.renderAudit();
  }
  _auditMeta(a){
    const m={
      login:['🔑','#64748b'],trip_submitted:['📝','#2D3592'],trip_edited:['✎','#2D3592'],
      supervisor_approved:['✅','#16a34a'],supervisor_rejected:['❌','#dc2626'],
      trip_assigned:['🚗','#16a34a'],trip_cancelled:['⊘','#64748b'],trip_deleted:['🗑','#dc2626'],
      trip_dates_edited:['📅','#F5A623'],trip_started:['▶','#F5A623'],trip_ended:['⏹','#16a34a'],
      staff_added:['👤','#2D3592'],staff_removed:['🚫','#dc2626'],password_reset:['🔑','#F5A623'],
      staff_contact_updated:['📞','#3DBFB8'],staff_role_changed:['🛡','#dc2626'],
      contract_driver_added:['🚐','#2D3592'],contract_driver_removed:['🚫','#dc2626'],
      settings_changed:['⚙','#dc2626']
    };
    return m[a]||['•','#64748b'];
  }
  renderAudit(){
    const body=$('audit-body');if(!body)return;
    let list=(this.auditRows||[]).slice();
    const af=$('audit-action')?.value||'',sf=($('audit-search')?.value||'').toLowerCase(),df=$('audit-date')?.value||'';
    if(af)list=list.filter(r=>r.action===af);
    if(df)list=list.filter(r=>(r.at||'').slice(0,10)===df);
    if(sf)list=list.filter(r=>(r.actorName+' '+r.action+' '+r.target+' '+r.detail).toLowerCase().includes(sf));
    const cnt=$('audit-count');if(cnt)cnt.textContent=list.length;
    /* Action filter options (built once from the data) */
    const sel=$('audit-action');
    if(sel&&sel.options.length<=1){
      const acts=[...new Set((this.auditRows||[]).map(r=>r.action))].sort();
      sel.innerHTML='<option value="">All Actions</option>'+acts.map(a=>`<option value="${a}">${a.replace(/_/g,' ')}</option>`).join('');
    }
    if(!list.length){body.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">No activity recorded yet</td></tr>';return;}
    body.innerHTML=list.slice(0,400).map(r=>{
      const[icon,col]=this._auditMeta(r.action);
      return`<tr>
        <td style="font-size:.66rem;white-space:nowrap;color:var(--text2)">${fmtTime(r.at)}</td>
        <td><strong style="font-size:.72rem">${r.actorName}</strong>${r.actorRole?`<br><span style="font-size:.58rem;color:var(--text3)">${r.actorRole}</span>`:''}</td>
        <td><span style="color:${col};font-weight:700;font-size:.68rem;white-space:nowrap">${icon} ${r.action.replace(/_/g,' ')}</span></td>
        <td style="font-size:.6rem;font-family:monospace;color:var(--text3)">${r.target||'—'}</td>
        <td style="font-size:.68rem;color:var(--text2)">${r.detail||'—'}</td>
      </tr>`;
    }).join('');
  }
  exportAuditCSV(){
    let csv='Timestamp,Actor,Staff ID,Role,Action,Target,Detail\n';
    (this.auditRows||[]).forEach(r=>{csv+=`"${fmtTime(r.at)}","${r.actorName}","${r.actorId}","${r.actorRole}","${r.action}","${r.target}","${(r.detail||'').replace(/"/g,'""')}"\n`;});
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='TripDesk_AuditTrail_'+Date.now()+'.csv';a.click();
  }

  /* ══════════════════════════════════════════════════
     SETTINGS + SYSTEM HEALTH
  ══════════════════════════════════════════════════ */
  renderSettings(){
    const mc=$('set-max-concurrent');if(mc)mc.value=MAX_CONCURRENT;
    this.renderHealth();
  }
  async saveSettings(){
    const msg=$('set-msg');if(msg)msg.textContent='';
    const v=parseInt($('set-max-concurrent')?.value,10);
    if(isNaN(v)||v<1||v>20){if(msg)msg.innerHTML='<span style="color:var(--red)">Enter a number between 1 and 20.</span>';return;}
    const prev=MAX_CONCURRENT;
    showLoader('Saving settings…');
    /* upsert: try update, insert if the row doesn't exist */
    let r=await API.upd('settings','key=eq.max_concurrent',{value:String(v)});
    if(!r||!r.length)r=await API.ins('settings',{key:'max_concurrent',value:String(v)});
    hideLoader();
    if(!r){if(msg)msg.innerHTML='<span style="color:var(--red)">Could not save — check the settings table exists.</span>';return;}
    MAX_CONCURRENT=v;SETTINGS.max_concurrent=String(v);
    API.audit('settings_changed','max_concurrent','Concurrent trip limit '+prev+' → '+v);
    if(msg)msg.innerHTML='<span style="color:var(--green)">✓ Saved. Limit is now '+v+' concurrent trips per day.</span>';
    this._renderAdminCal();this.renderDash();
    toast('Settings saved');
  }
  renderHealth(){
    const box=$('health-list');if(!box)return;
    const checks=[];
    /* 1. Staff contactability */
    const noContact=this.staff.filter(s=>!s.phone&&!s.email);
    const noPhone=this.staff.filter(s=>s.phone==='' && s.email);
    checks.push(noContact.length
      ? ['err','Staff with no phone AND no email',noContact.length+' cannot be notified at all: '+noContact.map(s=>s.name).slice(0,6).join(', ')+(noContact.length>6?'…':'')]
      : ['ok','Staff contactability','Every staff member has at least one contact channel']);
    if(noPhone.length)checks.push(['warn','Staff with no phone',noPhone.length+' will fall back to email: '+noPhone.map(s=>s.name).slice(0,6).join(', ')+(noPhone.length>6?'…':'')]);
    /* 2. Contract drivers */
    const cdNo=this.contractDrivers.filter(d=>!d.phone);
    checks.push(cdNo.length
      ? ['err','Contract drivers with no phone',cdNo.map(d=>d.name).join(', ')]
      : ['ok','Contract driver contacts',this.contractDrivers.length+' active contract driver(s), all with phone numbers']);
    /* 3. Ghost trips — occupy the calendar but have broken itinerary data */
    const ghosts=this.trips.filter(t=>t.status!=='rejected'&&t.status!=='cancelled'&&(!parseStops(t.stops)||!parseStops(t.stops).length));
    checks.push(ghosts.length
      ? ['err','Trips with broken itinerary data',ghosts.length+' trip(s) block the calendar but show no route — IDs: '+ghosts.map(t=>t.id).join(', ')]
      : ['ok','Trip data integrity','All active trips have valid itineraries']);
    /* 4. Stuck trips — started but never ended */
    const today=new Date().toISOString().slice(0,10);
    const stuck=this.trips.filter(t=>t.tripStartedAt&&!t.tripEndedAt&&t.retDate<today);
    checks.push(stuck.length
      ? ['warn','Trips still marked "on trip"',stuck.length+' past their return date and never ended: '+stuck.map(t=>t.officer).join(', ')]
      : ['ok','Driver trip logs','No overdue open trip logs']);
    /* 5. Unassigned backlog */
    const waiting=this.trips.filter(t=>t.status==='supervisor_approved');
    checks.push(waiting.length
      ? ['warn','Trips awaiting assignment',waiting.length+' approved trip(s) still need a driver and vehicle']
      : ['ok','Assignment backlog','Nothing waiting for assignment']);
    /* 6. Fleet capacity vs limit */
    const driverCount=this.staff.filter(s=>isDriver(s)).length+this.contractDrivers.length;
    checks.push(driverCount<MAX_CONCURRENT
      ? ['warn','Driver capacity','Concurrent limit is '+MAX_CONCURRENT+' but only '+driverCount+' driver(s) exist']
      : ['ok','Driver capacity',driverCount+' driver(s) available for a limit of '+MAX_CONCURRENT+' concurrent trips']);
    /* 7. Vehicles */
    checks.push(this.vehicles.length
      ? ['ok','Fleet',this.vehicles.length+' vehicle(s) registered']
      : ['err','Fleet','No vehicles registered — assignment is impossible']);
    const sev={err:['#dc2626','#FEF2F2','#FCA5A5','✕'],warn:['#9A3412','#FFF7ED','#FDBA74','!'],ok:['#065F46','#ECFDF5','#6EE7B7','✓']};
    const order={err:0,warn:1,ok:2};
    checks.sort((a,b)=>order[a[0]]-order[b[0]]);
    const bad=checks.filter(c=>c[0]==='err').length,warn=checks.filter(c=>c[0]==='warn').length;
    const sum=$('health-summary');
    if(sum)sum.innerHTML=bad?`<span style="color:var(--red);font-weight:700">${bad} issue${bad>1?'s':''} need attention</span>${warn?` · ${warn} warning${warn>1?'s':''}`:''}`
      :warn?`<span style="color:#9A3412;font-weight:700">${warn} warning${warn>1?'s':''}</span> · no critical issues`
      :'<span style="color:var(--green);font-weight:700">All systems healthy</span>';
    box.innerHTML=checks.map(([lvl,title,detail])=>{
      const[c,bg,bd,ic]=sev[lvl];
      return`<div style="display:flex;gap:.6rem;align-items:flex-start;padding:.6rem .8rem;background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:.4rem">
        <span style="color:${c};font-weight:900;font-size:.8rem;line-height:1.4">${ic}</span>
        <div style="min-width:0"><div style="font-weight:700;font-size:.75rem;color:${c}">${title}</div>
        <div style="font-size:.68rem;color:var(--text2);line-height:1.5">${detail}</div></div>
      </div>`;
    }).join('');
  }

  /* ── ADMIN — Edit Trip Dates (fix wrongly-entered dates blocking the calendar) ── */
  openEditDates(id){
    const t=this.trips.find(tr=>tr.id===id);if(!t)return;
    this._edateId=id;
    $('edate-info').innerHTML=`<strong>Officer:</strong> ${t.officer}<br><strong>Route:</strong> ${routeChain(parseStops(t.stops))}<br><strong>Current dates:</strong> ${fmt(t.depDate)} → ${fmt(t.retDate)}`;
    $('edate-dep').value=t.depDate||'';$('edate-ret').value=t.retDate||'';
    $('edate-msg').textContent='';
    $('edate-modal').classList.add('open');
  }
  async saveTripDates(){
    const id=this._edateId,t=this.trips.find(tr=>tr.id===id);if(!t)return;
    const msg=$('edate-msg');msg.textContent='';
    const dep=$('edate-dep').value,ret=$('edate-ret').value;
    if(!dep||!ret){msg.innerHTML='<span style="color:var(--red)">Both dates required.</span>';return;}
    if(new Date(ret)<new Date(dep)){msg.innerHTML='<span style="color:var(--red)">Return can\'t be before departure.</span>';return;}
    /* Adjust itinerary: first stop departs on new dep, last stop returns on new ret; clamp middle stops inside range */
    const stops=parseStops(t.stops);
    if(stops.length){
      stops[0].depDate=dep;
      stops[stops.length-1].retDate=ret;
      stops.forEach(s=>{
        if(s.depDate<dep)s.depDate=dep;
        if(s.retDate>ret)s.retDate=ret;
        if(s.retDate<s.depDate)s.retDate=s.depDate;
      });
    }
    showLoader('Saving dates…');
    const r=await API.upd('trips','id=eq.'+encodeURIComponent(id),{dep_date:dep,ret_date:ret,stops:JSON.stringify(stops),updated_at:new Date().toISOString()});
    hideLoader();
    if(!r){toast('Server error','err');return;}
    t.depDate=dep;t.retDate=ret;t.stops=stops;
    closeModal('edate-modal');
    this.renderDash();this.renderAllTrips();this.renderAdminPending();this._refreshCalendars();this.renderHistory();
    API.audit('trip_dates_edited',id,t.officer+' · now '+fmt(dep)+' → '+fmt(ret));
    toast('Trip dates corrected ✓ — calendar slots updated');
  }

  exportCSV(){
    let csv='Officer,Unit,Project,Route,Supervisor,Departure,Return,Status,Trip Type,Drop Time,Pickup Time,Driver,Vehicle,Submitted,Trip Started,Odo Start (km),Trip Ended,Odo End (km),Distance (km)\n';
    this.trips.forEach(t=>{
      const km=(t.odoStart!=null&&t.odoEnd!=null)?(t.odoEnd-t.odoStart):'';
      csv+=`"${t.officer}","${t.unit}","${t.project||''}","${routeChain(parseStops(t.stops))}","${t.supervisorName||''}","${fmt(t.depDate)}","${fmt(t.retDate)}","${t.status}","${t.tripType||'round'}","${t.dropTime||''}","${t.pickupTime||''}","${t.driver||''}","${t.vehicle||''}","${fmt(t.submitted)}","${t.tripStartedAt?fmtTime(t.tripStartedAt):''}","${t.odoStart??''}","${t.tripEndedAt?fmtTime(t.tripEndedAt):''}","${t.odoEnd??''}","${km}"\n`;
    });
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
  clearAddStaffForm(){['ns-name','ns-joindate','ns-id','ns-unit','ns-email','ns-phone'].forEach(id=>{const el=$(id);if(el)el.value='';});const r=$('ns-role');if(r)r.value='staff';const m=$('ns-msg');if(m)m.textContent='';const p=$('ns-pass');if(p)p.value='1234';}
  async addStaff(){
    const msg=$('ns-msg');if(msg)msg.textContent='';
    const name=$('ns-name')?.value.trim(),joinDate=$('ns-joindate')?.value,idVal=$('ns-id')?.value.trim().toUpperCase();
    const unit=$('ns-unit')?.value.trim(),email=$('ns-email')?.value.trim(),phone=$('ns-phone')?.value.trim(),role=$('ns-role')?.value||'staff',pass=$('ns-pass')?.value||'1234';
    if(!name){if(msg)msg.innerHTML='<span style="color:var(--red)">Full name required.</span>';return;}
    if(!idVal){if(msg)msg.innerHTML='<span style="color:var(--red)">Staff ID required.</span>';return;}
    if(!unit){if(msg)msg.innerHTML='<span style="color:var(--red)">Unit required.</span>';return;}
    if(pass.length<4){if(msg)msg.innerHTML='<span style="color:var(--red)">Password min 4 chars.</span>';return;}
    if(this.staff.find(s=>s.id===idVal)){if(msg)msg.innerHTML=`<span style="color:var(--red)">ID <strong>${idVal}</strong> already exists.</span>`;return;}
    const color=avColor(name);showLoader('Adding…');
    const hashedPass=await hashPassword(pass, idVal);
    const r=await API.ins('staff',{id:idVal,name,unit,role,email:email||'',phone:phone||'',password:hashedPass,avatar_color:color,join_date:joinDate||null});
    hideLoader();if(!r){toast('Failed to add staff','err');return;}
    this.staff.push({id:idVal,name,unit,role,color,email:email||'',phone:phone||''});
    this.staff.sort((a,b)=>a.name.localeCompare(b.name));
    if(msg)msg.innerHTML=`<span style="color:var(--green)">✓ <strong>${name}</strong> added as <strong>${idVal}</strong>.</span>`;
    this.clearAddStaffForm();$('add-staff-form').style.display='none';const btn=$('add-staff-toggle');if(btn)btn.textContent='▼ Expand';
    API.audit('staff_added',idVal,name+' · '+unit+' · role: '+role);
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
        ${s.email?`<div style="font-size:.6rem;color:var(--text3);margin-bottom:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.email}">✉ ${s.email}</div>`:''}
        <div style="font-size:.6rem;color:${s.phone?'var(--text3)':'#dc2626'};margin-bottom:.3rem;white-space:nowrap">📞 ${s.phone||'no phone — SMS won\'t reach them'}</div>
        <div class="scard-btns"><button class="btn-sm btn-teal" onclick="TD.editStaffContact('${s.id}')">✎ Contact</button><button class="btn-sm btn-outline" onclick="TD.changeStaffRole('${s.id}')">🛡 Role</button><button class="btn-sm btn-outline" onclick="TD.resetStaffPass('${s.id}')">🔑 Reset</button><button class="btn-sm btn-red" onclick="TD.removeStaff('${s.id}','${s.name.replace(/'/g,'')}')">🗑</button></div>
      </div>`;
    }).join('');
  }
  async sendTest(){
    const email=$('test-email')?.value.trim(),phone=$('test-phone')?.value.trim(),msg=$('test-msg');
    if(msg)msg.textContent='';
    if(!email&&!phone){if(msg)msg.innerHTML='<span style="color:var(--red)">Enter an email or phone to test.</span>';return;}
    showLoader('Sending test…');
    const res=await API.gasPost({action:'testEmail',data:{to:email,phone}});
    hideLoader();
    if(!res){if(msg)msg.innerHTML='<span style="color:var(--red)">No response from notification server. Check the GAS deployment.</span>';return;}
    let parts=[];
    if(res.sent&&res.sent.length)parts.push('✅ Email sent');
    if(res.skipped&&res.skipped.length)parts.push('⚠ Email: '+res.skipped.join(', '));
    if(res.smsSent&&res.smsSent.length)parts.push('✅ SMS sent — check your phone');
    if(res.smsSkipped&&res.smsSkipped.length)parts.push('⚠ SMS: '+res.smsSkipped.join(', '));
    if(res.smsConfigured===false)parts.push('ℹ SMS is currently OFF (set SMS_ENABLED=true in Script Properties)');
    if(res.smsRaw)parts.push('<span style="font-size:.66rem;color:var(--text3)">Arkesel reply: '+String(res.smsRaw).replace(/</g,'&lt;')+'</span>');
    if(typeof res.quotaRemaining!=='undefined')parts.push('📧 Email quota left today: '+res.quotaRemaining);
    if(msg)msg.innerHTML='<span style="color:var(--text2)">'+parts.join('<br>')+'</span>';
    toast('Test sent — see results below');
  }
  /* ── PRIVILEGES — change a staff member's role ── */
  async changeStaffRole(id){
    const s=this.staff.find(x=>x.id===id);if(!s)return;
    const roles=['staff','driver','supervisor','admin'];
    const choice=prompt(
      'Role for '+s.name+'\n\n'
      +'  staff      — request trips through a supervisor\n'
      +'  driver     — no trip requests; sees driving assignments\n'
      +'  supervisor — approves team trips; own requests skip review\n'
      +'  admin      — full access: assign, settings, audit\n\n'
      +'Type the new role:', s.role||'staff');
    if(choice===null)return;
    const role=choice.trim().toLowerCase();
    if(!roles.includes(role)){toast('Unknown role — use staff, driver, supervisor or admin','err');return;}
    if(role===s.role){toast('No change');return;}
    if(role==='admin'&&!confirm('Grant FULL ADMIN access to '+s.name+'?\n\nThey will be able to assign trips, change settings, manage staff and view the audit trail.'))return;
    const prev=s.role;
    showLoader('Updating role…');
    const r=await API.upd('staff','id=eq.'+encodeURIComponent(id),{role});
    hideLoader();
    if(!r){toast('Server error — role not changed','err');return;}
    s.role=role;
    API.audit('staff_role_changed',id,s.name+': '+prev+' → '+role);
    this.renderStaff();this._populateStProjectsAndSupervisors();this._populateSvProjectsAndSupervisors();
    toast(s.name+' is now '+role);
  }
  async editStaffContact(id){
    const s=this.staff.find(x=>x.id===id);if(!s)return;
    const email=prompt('Email for '+s.name+':',s.email||'');
    if(email===null)return; /* cancelled */
    const phone=prompt('Phone number for '+s.name+' (for SMS):',s.phone||'');
    if(phone===null)return;
    showLoader('Saving…');
    await API.upd('staff','id=eq.'+encodeURIComponent(id),{email:email.trim(),phone:phone.trim()});
    hideLoader();
    s.email=email.trim();s.phone=phone.trim();
    API.audit('staff_contact_updated',id,s.name+' · phone: '+(phone.trim()||'(none)')+' · email: '+(email.trim()||'(none)'));
    this.renderStaff();
    toast('Contact updated for '+s.name);
  }
  async resetStaffPass(id){
    if(!confirm('Reset password to "1234"?'))return;
    const hashed=await hashPassword('1234', id);
    await API.upd('staff','id=eq.'+encodeURIComponent(id),{password:hashed});
    API.audit('password_reset',id,'Reset to default by admin');
    toast('Password reset to 1234');
  }
  async removeStaff(id,name){if(!confirm(`Remove ${name} (${id})?\nTrip history is preserved.`))return;showLoader('Removing…');await API.del('staff','id=eq.'+encodeURIComponent(id));hideLoader();API.audit('staff_removed',id,name);this.staff=this.staff.filter(s=>s.id!==id);this.renderStaff();this._populateUnitFilter();toast(`${name} removed`);}

  /* ── CHANGE PASSWORD (shared for st and sv prefix) ── */
  async changePass(prefix){
    const old=$(prefix+'-old-pw')?.value,np=$(prefix+'-new-pw')?.value,conf=$(prefix+'-conf-pw')?.value;
    const msg=$(prefix+'-pw-msg');msg.textContent='';
    if(!old||!np||!conf){msg.innerHTML='<span style="color:var(--red)">Fill all fields.</span>';return;}
    if(np.length<4){msg.innerHTML='<span style="color:var(--red)">Min 4 chars.</span>';return;}
    if(np!==conf){msg.innerHTML='<span style="color:var(--red)">Passwords don\'t match.</span>';return;}
    const uid=this.user.id;
    const rows=await API.get('staff','id=eq.'+encodeURIComponent(uid));
    const hashedOld=await hashPassword(old, uid);
    const storedPw=rows?.length?extractPw(rows[0]):'';
    if(!rows?.length||(storedPw!==hashedOld&&storedPw!==old)){msg.innerHTML='<span style="color:var(--red)">Wrong current password.</span>';return;}
    const hashedNew=await hashPassword(np, uid);
    await API.upd('staff','id=eq.'+encodeURIComponent(uid),{password:hashedNew});
    msg.innerHTML='<span style="color:var(--green)">✓ Password changed!</span>';
    $(prefix+'-old-pw').value='';$(prefix+'-new-pw').value='';$(prefix+'-conf-pw').value='';
    toast('Password updated');
  }

  /* ══════════════════════════════════════════════════
     CONTRACT DRIVERS — CRUD
  ══════════════════════════════════════════════════ */
  _nextCdId(){
    const existing=this.contractDrivers.map(d=>d.id);
    let seq=1;
    while(existing.includes(`CD/${String(seq).padStart(3,'0')}`))seq++;
    return`CD/${String(seq).padStart(3,'0')}`;
  }
  previewCdId(){const idField=$('cd-id');if(idField&&!idField.value)idField.value=this._nextCdId();}
  toggleAddCdForm(){const form=$('add-cd-form'),btn=$('add-cd-toggle');if(!form)return;const open=form.style.display==='block';form.style.display=open?'none':'block';if(btn)btn.textContent=open?'+ Add Driver':'▲ Close';}
  clearCdForm(){['cd-name','cd-id','cd-phone','cd-license','cd-email'].forEach(id=>{const el=$(id);if(el)el.value='';});const m=$('cd-msg');if(m)m.textContent='';const h=$('cd-id-hint');if(h)h.textContent='Leave blank for auto-generated ID';}

  async addContractDriver(){
    const msg=$('cd-msg');if(msg)msg.textContent='';
    const name=$('cd-name')?.value.trim();
    let idVal=$('cd-id')?.value.trim().toUpperCase();
    const phone=$('cd-phone')?.value.trim();
    const license=$('cd-license')?.value.trim().toUpperCase();
    const email=$('cd-email')?.value.trim();
    if(!name){if(msg)msg.innerHTML='<span style="color:var(--red)">Name required.</span>';return;}
    if(!phone){if(msg)msg.innerHTML='<span style="color:var(--red)">Phone number required.</span>';return;}
    if(!license){if(msg)msg.innerHTML='<span style="color:var(--red)">License number required.</span>';return;}
    if(!idVal)idVal=this._nextCdId();
    if(this.contractDrivers.find(d=>d.id===idVal)){if(msg)msg.innerHTML=`<span style="color:var(--red)">ID <strong>${idVal}</strong> already exists.</span>`;return;}
    showLoader('Adding contract driver…');
    const r=await API.ins('contract_drivers',{id:idVal,name,phone,license_no:license,email:email||'',status:'active'});
    hideLoader();
    if(!r){toast('Failed to add','err');return;}
    this.contractDrivers.push({id:idVal,name,phone,license,email:email||'',status:'active'});
    this.contractDrivers.sort((a,b)=>a.name.localeCompare(b.name));
    if(msg)msg.innerHTML=`<span style="color:var(--green)">✓ <strong>${name}</strong> added as <strong>${idVal}</strong>.</span>`;
    this.clearCdForm();$('add-cd-form').style.display='none';$('add-cd-toggle').textContent='+ Add Driver';
    this.renderContractDrivers();
    API.audit('contract_driver_added',idVal,name+' · '+phone);
    toast(`${name} (${idVal}) added ✓`);
  }

  renderContractDrivers(){
    const g=$('ad-cd-grid');if(!g)return;
    const search=($('cd-search')?.value||'').toLowerCase();
    let list=this.contractDrivers.slice();
    if(search)list=list.filter(d=>d.name.toLowerCase().includes(search)||d.id.toLowerCase().includes(search)||d.phone.includes(search));
    if(!list.length){g.innerHTML='<div style="color:var(--text3);font-size:.8rem;padding:1rem;grid-column:1/-1;text-align:center">No contract drivers found. Add one above.</div>';return;}
    g.innerHTML=list.map(d=>`<div class="cd-card">
      <div class="cd-card-top"><div class="av" style="background:var(--gold)">${ini(d.name)}</div><div><div class="cd-name">${d.name}</div><div class="cd-id">${d.id}</div></div></div>
      <div class="cd-detail">
        <strong>📞</strong> ${d.phone||'—'}<br>
        <strong>🪪</strong> ${d.license||'—'}
        ${d.email?'<br><strong>✉</strong> '+d.email:''}
      </div>
      <div style="display:flex;gap:.3rem;align-items:center">
        <span class="cd-badge">Contract</span>
        <span style="flex:1"></span>
        <button class="btn-sm btn-teal" onclick="TD.editCdContact('${d.id}')">✎ Contact</button>
        <button class="btn-sm btn-outline" onclick="TD.toggleCdStatus('${d.id}')">${d.status==='active'?'⏸':'▶'}</button>
        <button class="btn-sm btn-red" onclick="TD.removeContractDriver('${d.id}','${d.name.replace(/'/g,'')}')">🗑</button>
      </div>
    </div>`).join('');
  }

  async editCdContact(id){
    const d=this.contractDrivers.find(x=>x.id===id);if(!d)return;
    const phone=prompt('Phone number for '+d.name+' (for SMS):',d.phone||'');
    if(phone===null)return;
    const email=prompt('Email for '+d.name+' (optional):',d.email||'');
    if(email===null)return;
    showLoader('Saving…');
    await API.upd('contract_drivers','id=eq.'+encodeURIComponent(id),{phone:phone.trim(),email:email.trim()});
    hideLoader();
    d.phone=phone.trim();d.email=email.trim();
    this.renderContractDrivers();
    toast('Contact updated for '+d.name);
  }

  async toggleCdStatus(id){
    const d=this.contractDrivers.find(x=>x.id===id);if(!d)return;
    const ns=d.status==='active'?'inactive':'active';
    await API.upd('contract_drivers','id=eq.'+encodeURIComponent(id),{status:ns});
    if(ns==='inactive'){this.contractDrivers=this.contractDrivers.filter(x=>x.id!==id);}
    else{d.status=ns;}
    this.renderContractDrivers();toast(ns==='active'?'Driver activated':'Driver deactivated');
  }

  async removeContractDriver(id,name){
    if(!confirm(`Remove contract driver ${name} (${id})?\nTrip assignment history is preserved.`))return;
    showLoader('Removing…');
    await API.del('contract_drivers','id=eq.'+encodeURIComponent(id));
    hideLoader();
    this.contractDrivers=this.contractDrivers.filter(d=>d.id!==id);
    API.audit('contract_driver_removed',id,name);
    this.renderContractDrivers();
    toast(`${name} removed`);
  }

  /* ── CALENDARS ── */
  _stCalM=new Date().getMonth();_stCalY=new Date().getFullYear();
  _svCalM=new Date().getMonth();_svCalY=new Date().getFullYear();
  _adCalM=new Date().getMonth();_adCalY=new Date().getFullYear();

  _renderCalendar(boxId,m,y){
    const box=$(boxId);if(!box)return;
    const isAdmin=boxId==='ad-calendar';
    const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),todayStr=new Date().toISOString().slice(0,10);
    const prefix=boxId==='st-calendar'?'_stCal':boxId==='sv-calendar'?'_svCal':'_adCal';
    let h=`<div class="cal-nav">
      <button onclick="TD.${prefix}M--;if(TD.${prefix}M<0){TD.${prefix}M=11;TD.${prefix}Y--;}TD._renderCalendar('${boxId}',TD.${prefix}M,TD.${prefix}Y)">◀</button>
      <span>${MN[m]} ${y}</span>
      <button onclick="TD.${prefix}M++;if(TD.${prefix}M>11){TD.${prefix}M=0;TD.${prefix}Y++;}TD._renderCalendar('${boxId}',TD.${prefix}M,TD.${prefix}Y)">▶</button>
    </div>`;
    if(!isAdmin){
      h+=`<div class="cal-legend">
        <span class="leg-item"><span class="leg-dot" style="background:#16a34a"></span>Available</span>
        <span class="leg-item"><span class="leg-dot" style="background:#ca8a04"></span>1–2 Booked</span>
        <span class="leg-item"><span class="leg-dot" style="background:#dc2626"></span>Fully Booked</span>
      </div>`;
    }
    h+='<div class="cal-grid">';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{h+=`<div class="cal-hdr">${d}</div>`;});
    for(let i=0;i<first;i++)h+='<div class="cal-day" style="background:transparent;border:none"></div>';
    for(let d=1;d<=days;d++){
      const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayTrips=[];this.trips.forEach(t=>{if(t.status==='rejected'||t.status==='cancelled')return;if(this._occupiesDay(t,ds))dayTrips.push(t);});
      const count=dayTrips.length,isPast=ds<todayStr;
      if(isAdmin){
        h+=`<div class="cal-day${ds===todayStr?' today':''}"><div class="cal-num">${d}</div>`;
        dayTrips.slice(0,2).forEach(t=>{h+=`<span class="cal-trip" style="background:${t.color||'var(--purple)'}" title="${t.officer}: ${routeChain(parseStops(t.stops))}">${t.officer.split(' ')[0]}</span>`;});
        if(dayTrips.length>2)h+=`<span style="font-size:.5rem;color:var(--text3)">+${dayTrips.length-2}</span>`;
      }else{
        const isFull=count>=MAX_CONCURRENT;
        const bg=isFull?'#fee2e2':count===2?'#fef3c7':count===1?'#fef9c3':(!isPast?'#dcfce7':'');
        const borderCol=isFull?'#dc2626':count===2?'#d97706':count===1?'#ca8a04':ds===todayStr?'var(--teal)':'var(--surf3)';
        const textCol=isFull?'#991b1b':count===2?'#92400e':count===1?'#92400e':'inherit';
        const bookable=!isFull&&!isPast&&this.user&&this.user.role!=='driver'&&this.user.role!=='contract_driver';
        h+=`<div class="cal-day${bookable?' cal-bookable':''}" style="background:${bg};border-color:${borderCol}"${bookable?` onclick="TD.requestOn('${ds}')" title="Request a trip starting ${fmt(ds)}"`:''}><div class="cal-num" style="color:${textCol}">${d}</div>`;
        if(isFull){
          h+=`<span style="font-size:.52rem;font-weight:800;color:#dc2626;display:block">FULL</span>`;
          dayTrips.forEach(t=>{h+=`<span style="font-size:.48rem;color:#7f1d1d;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${t.officer}">${t.officer.split(' ')[0]}</span>`;});
        }else if(count>0){
          dayTrips.forEach(t=>{h+=`<span style="font-size:.48rem;color:#92400e;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${t.officer}">${t.officer.split(' ')[0]}</span>`;});
        }
      }
      h+='</div>';
    }
    h+='</div>';box.innerHTML=h;
  }

  _renderAdminCal(){this._renderCalendar('ad-calendar',this._adCalM,this._adCalY);}

  /* ── Re-render every availability calendar present in the current view.
     Must run after ANY change to trip dates/status, or the calendar keeps
     showing the old dates as occupied until the page is reloaded. ── */
  _refreshCalendars(){
    if($('st-calendar'))this._renderCalendar('st-calendar',this._stCalM,this._stCalY);
    if($('sv-calendar'))this._renderCalendar('sv-calendar',this._svCalM,this._svCalY);
    if($('ad-calendar'))this._renderCalendar('ad-calendar',this._adCalM,this._adCalY);
  }
}

/* ── BOOT ── */
const TD=new TripDesk();

(async function(){
  const s=getSession();if(!s)return;
  showLoader('Restoring session…');
  const lv=$('login-view');if(lv)lv.style.display='none';
  const bg=document.querySelector('.login-bg');if(bg)bg.style.display='none';
  try{
    if(s.id==='ADMIN01'){
      TD.user={id:'ADMIN01',name:'Administrator',unit:'Admin',role:'admin',color:'#2D3592',email:''};
      $('lo-text').textContent='Loading trip data…';await TD._hydrate();TD._enter();
      return;
    }
    if(s.id.startsWith('CD/')){
      const cdrows=await API.get('contract_drivers','id=eq.'+encodeURIComponent(s.id));
      if(!cdrows||!cdrows.length){clearSession();hideLoader();if(lv){lv.style.display='';lv.classList.add('active');}if(bg)bg.style.display='';return;}
      const cd=cdrows[0];
      TD.user={id:cd.id,name:cd.name,unit:'Contract Driver',role:'contract_driver',color:'#F5A623',email:cd.email||'',phone:cd.phone||'',license:cd.license_no||''};
      $('lo-text').textContent='Loading your trips…';await TD._hydrate();TD._enter();
      return;
    }
    const staff=await API.get('staff','id=eq.'+encodeURIComponent(s.id));
    if(!staff||!staff.length){clearSession();hideLoader();if(lv){lv.style.display='';lv.classList.add('active');}if(bg)bg.style.display='';return;}
    const u=staff[0];
    TD.user={id:u.id,name:u.name,unit:(u.unit||'').trim(),role:u.role||'staff',color:u.avatar_color||avColor(u.name),email:u.email||'',phone:u.phone||''};
    $('lo-text').textContent='Loading trip data…';await TD._hydrate();TD._enter();
  }catch(e){
    console.error('Session restore:',e);clearSession();hideLoader();
    if(lv){lv.style.display='';lv.classList.add('active');}if(bg)bg.style.display='';
  }
})();
