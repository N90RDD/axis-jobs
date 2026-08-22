const cfg=window.AXIS_CONFIG||{};
const configured=cfg.SUPABASE_URL&&cfg.SUPABASE_PUBLISHABLE_KEY&&!cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_PUBLISHABLE_KEY_HERE");
const $=id=>document.getElementById(id);
let sb=null,currentUser=null,currentProfile=null,jobs=[],currentPhotos=[],wizardStep=0,currentPhotoGroup="before",completedJob=null;
const steps=["Customer","Vehicle","Job Details","Photos","Finish"];

function esc(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function msg(id,text,ok=false){$(id).innerHTML=`<div class="${ok?"message-ok":"message-error"}">${esc(text)}</div>`}
function statusClass(s){return String(s||"").replace(/\s/g,"")}
function dateISO(){return new Date().toISOString().slice(0,10)}
function jobNo(){const d=new Date(),yy=String(d.getFullYear()).slice(-2),mm=String(d.getMonth()+1).padStart(2,"0"),dd=String(d.getDate()).padStart(2,"0");return `AX-${yy}${mm}${dd}-${String(Math.floor(Math.random()*900)+100)}`}

async function boot(){
  setTimeout(()=>$("splash").classList.add("hide"),1100);
  setTimeout(()=>$("splash").classList.add("hidden"),1500);

  if(!configured){
    $("loginScreen").classList.remove("hidden");
    msg("loginMessage","Open config.js in GitHub and paste the Supabase Publishable key.");
    return;
  }

  sb=supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
  const {data:{session}}=await sb.auth.getSession();
  if(session) await enterApp(session.user);
  else $("loginScreen").classList.remove("hidden");

  sb.auth.onAuthStateChange(async(_event,session)=>{
    if(session) await enterApp(session.user);
    else{
      currentUser=null;currentProfile=null;
      $("mainApp").classList.add("hidden");
      $("loginScreen").classList.remove("hidden");
    }
  });
}

async function enterApp(user){
  currentUser=user;
  const {data,error}=await sb.from("profiles").select("id,email,full_name,role,active").eq("id",user.id).single();
  if(error||!data){$("loginScreen").classList.remove("hidden");msg("loginMessage","Your engineer profile could not be loaded.");return}
  if(!data.active){msg("loginMessage","This engineer account is disabled.");await sb.auth.signOut();return}
  currentProfile=data;
  $("loginScreen").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  $("headerSub").textContent=`${currentProfile.full_name} · ${currentProfile.role}`;
  $("accountName").textContent=currentProfile.full_name;
  $("accountEmail").textContent=currentProfile.email;
  $("accountRole").textContent=currentProfile.role;
  await loadJobs();
  showHome();
}

async function login(e){
  e.preventDefault();$("loginMessage").innerHTML="";
  const {error}=await sb.auth.signInWithPassword({email:$("loginEmail").value.trim(),password:$("loginPassword").value});
  if(error) msg("loginMessage",error.message);
}
async function logout(){$("accountDialog").close();await sb.auth.signOut()}

async function loadJobs(){
  const {data,error}=await sb.from("jobs").select("*,profiles!jobs_engineer_id_fkey(full_name)").order("created_at",{ascending:false});
  if(error){jobs=[];return}
  jobs=data||[];
}

function setNav(name){
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.nav===name));
}

function showHome(){
  setNav("home");
  const open=jobs.filter(j=>j.status!=="Completed").length;
  const today=jobs.filter(j=>new Date(j.created_at).toDateString()===new Date().toDateString()).length;
  const done=jobs.filter(j=>j.status==="Completed").length;
  $("screen").innerHTML=`
    <div class="dashboard-hero">
      <div><h1>Engineer <span>Portal</span></h1><small>${esc(currentProfile.full_name)}</small></div>
    </div>
    <button class="primary new-job-big" onclick="newJob()">＋ NEW JOB</button>
    <div class="stats">
      <div class="stat-card"><span>OPEN JOBS</span><strong>${open}</strong></div>
      <div class="stat-card"><span>TODAY</span><strong>${today}</strong></div>
      <div class="stat-card"><span>COMPLETED</span><strong>${done}</strong></div>
    </div>
    <div class="section-row"><h3>Recent Jobs</h3><button onclick="showJobs()">View all ›</button></div>
    ${jobRows(jobs.slice(0,5))}
  `;
}

function jobRows(list){
  if(!list.length)return `<div class="empty">No jobs yet. Hit New Job 👊</div>`;
  return list.map(j=>`
    <div class="job-row" onclick="editJob('${j.id}')">
      <div class="job-main">
        <strong>${esc(j.job_no)} &nbsp; ${esc(j.registration||"No reg")}</strong>
        <small>${esc(j.customer_name)} · ${esc(j.make)} ${esc(j.model)}</small>
      </div>
      <span class="status-pill ${statusClass(j.status)}">${esc(j.status)}</span>
      <span>›</span>
    </div>
  `).join("");
}

function showJobs(){
  setNav("jobs");
  $("screen").innerHTML=`
    <div class="section-row"><h3>Jobs</h3><button onclick="newJob()">＋ New</button></div>
    <input class="search" id="jobsSearch" placeholder="Search job, reg or customer">
    <div id="jobsList">${jobRows(jobs)}</div>
  `;
  $("jobsSearch").addEventListener("input",e=>{
    const q=e.target.value.toLowerCase();
    $("jobsList").innerHTML=jobRows(jobs.filter(j=>[j.job_no,j.registration,j.customer_name,j.make,j.model].join(" ").toLowerCase().includes(q)));
  });
}

function showCustomers(){
  setNav("customers");
  const map=new Map();
  jobs.forEach(j=>{
    const key=(j.email||j.phone||j.customer_name||"").toLowerCase();
    if(!key)return;
    if(!map.has(key))map.set(key,{name:j.customer_name,phone:j.phone,email:j.email,address:j.address,count:0});
    map.get(key).count++;
  });
  const list=[...map.values()];
  $("screen").innerHTML=`
    <div class="section-row"><h3>Customers</h3><span class="muted">${list.length}</span></div>
    ${list.length?list.map(c=>`<div class="list-card"><strong>${esc(c.name)}</strong><small>${esc(c.phone)} ${esc(c.email)}</small><small>${c.count} job${c.count===1?"":"s"}</small></div>`).join(""):`<div class="empty">Customers appear here as you create jobs.</div>`}
  `;
}

function showVehicles(){
  setNav("vehicles");
  const map=new Map();
  jobs.forEach(j=>{
    if(!j.registration)return;
    map.set(j.registration,{reg:j.registration,make:j.make,model:j.model,year:j.year,count:(map.get(j.registration)?.count||0)+1});
  });
  const list=[...map.values()];
  $("screen").innerHTML=`
    <div class="section-row"><h3>Vehicles</h3><span class="muted">${list.length}</span></div>
    ${list.length?list.map(v=>`<div class="list-card"><strong>${esc(v.reg)}</strong><small>${esc(v.make)} ${esc(v.model)} ${esc(v.year)}</small><small>${v.count} job${v.count===1?"":"s"}</small></div>`).join(""):`<div class="empty">Vehicles appear here as you create jobs.</div>`}
  `;
}

function showMore(){
  setNav("more");
  $("screen").innerHTML=`
    <div class="section-row"><h3>More</h3></div>
    <div class="list-card"><strong>Signed in</strong><small>${esc(currentProfile.full_name)} · ${esc(currentProfile.role)}</small></div>
    <div class="list-card"><strong>PDF Reports</strong><small>Open any completed job to generate its PDF.</small></div>
    <div class="list-card"><strong>Cloud Sync</strong><small>Jobs, signatures and photos are stored in Supabase.</small></div>
    <div class="list-card"><strong>Offline Ready</strong><small>App shell is cached. Full offline job sync can be added next.</small></div>
  `;
}

function setupStepper(){
  $("stepper").innerHTML=steps.map((s,i)=>`<div class="step-item ${i===wizardStep?"active":i<wizardStep?"done":""}">
    <div class="step-dot">${i+1}</div><div class="step-label">${esc(s)}</div>
  </div>`).join("");
  document.querySelectorAll(".wizard-step").forEach((el,i)=>el.classList.toggle("hidden",i!==wizardStep));
  $("prevStepBtn").textContent=wizardStep===0?"Cancel":"Back";
  const labels=["Next: Vehicle Details →","Next: Job Details →","Next: Photos →","Next: Signature →","Complete Job ✓"];
  $("nextStepBtn").textContent=labels[wizardStep];
}

function clearWizard(){
  $("jobForm").reset();$("jobId").value="";$("date").value=dateISO();$("status").value="Booked";
  $("jobEngineer").textContent=currentProfile.full_name;
  $("wizardJobNo").textContent=jobNo();
  currentPhotos=[];currentPhotoGroup="before";wizardStep=0;
  clearSig();renderPhotos();setupStepper();$("jobMessage").innerHTML="";
  document.querySelectorAll("#checklist input").forEach(x=>x.checked=false);
  document.querySelectorAll("[data-photo-group]").forEach(b=>b.classList.toggle("active",b.dataset.photoGroup==="before"));
}

function newJob(){
  clearWizard();
  $("wizardTitle").textContent="New Job";
  $("jobNoValue")?.remove();
  $("jobDialog").showModal();
}

async function editJob(id){
  const {data:j,error}=await sb.from("jobs").select("*").eq("id",id).single();
  if(error){alert(error.message);return}
  const {data:p}=await sb.from("job_photos").select("*").eq("job_id",id).order("created_at");
  currentPhotos=p||[];
  $("jobId").value=j.id;$("wizardJobNo").textContent=j.job_no;$("wizardTitle").textContent="Job Details";
  $("customer").value=j.customer_name||"";$("phone").value=j.phone||"";$("email").value=j.email||"";$("address").value=j.address||"";
  $("reg").value=j.registration||"";$("make").value=j.make||"";$("model").value=j.model||"";$("year").value=j.year||"";$("mileage").value=j.mileage||"";
  $("jobType").value=j.job_type||"Installation";$("workRequired").value=j.work_required||"";$("workCarriedOut").value=j.work_carried_out||"";$("parts").value=j.parts_used||"";$("notes").value=j.engineer_notes||"";
  $("signatory").value=j.customer_signatory||"";$("date").value=j.job_date||dateISO();$("status").value=j.status||"Booked";$("jobEngineer").textContent=jobs.find(x=>x.id===id)?.profiles?.full_name||currentProfile.full_name;
  clearSig();if(j.signature_data){const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,sig.width,sig.height);im.src=j.signature_data}
  const checks=(j.checklist||"").split("|").filter(Boolean);
  document.querySelectorAll("#checklist input").forEach(x=>x.checked=checks.includes(x.value));
  wizardStep=0;renderPhotos();setupStepper();$("jobDialog").showModal();
}

function payload(){
  const existing=jobs.find(x=>x.id===$("jobId").value);
  const checks=[...document.querySelectorAll("#checklist input:checked")].map(x=>x.value).join("|");
  return {
    job_no:existing?.job_no||$("wizardJobNo").textContent,
    job_date:$("date").value||dateISO(),
    customer_name:$("customer").value.trim(),
    phone:$("phone").value.trim(),
    email:$("email").value.trim(),
    address:$("address").value.trim(),
    registration:$("reg").value.trim().toUpperCase(),
    make:$("make").value.trim(),model:$("model").value.trim(),year:$("year").value.trim(),mileage:$("mileage").value.trim(),
    job_type:$("jobType").value,
    work_required:$("workRequired").value.trim(),work_carried_out:$("workCarriedOut").value.trim(),parts_used:$("parts").value.trim(),engineer_notes:$("notes").value.trim(),
    checklist:checks,status:$("status").value,engineer_id:existing?.engineer_id||currentUser.id,customer_signatory:$("signatory").value.trim(),
    signature_data:sig.toDataURL("image/png"),
    completion_date:$("status").value==="Completed"?new Date().toISOString():null,
    updated_at:new Date().toISOString()
  }
}

async function saveJob(close=false){
  const data=payload();
  if(!data.customer_name||!data.registration){msg("jobMessage","Customer name and registration are required.");return null}
  let r;
  if($("jobId").value)r=await sb.from("jobs").update(data).eq("id",$("jobId").value).select().single();
  else r=await sb.from("jobs").insert(data).select().single();
  if(r.error){msg("jobMessage",r.error.message);return null}
  $("jobId").value=r.data.id;
  await sb.from("job_audit").insert({job_id:r.data.id,user_id:currentUser.id,action:"saved"});
  await loadJobs();
  if(close){$("jobDialog").close();showHome()}
  return r.data;
}

async function nextStep(){
  if(wizardStep===0&&!$("customer").value.trim()){msg("jobMessage","Enter the customer / company name.");return}
  if(wizardStep===1&&!$("reg").value.trim()){msg("jobMessage","Enter the vehicle registration.");return}
  $("jobMessage").innerHTML="";
  if(wizardStep<4){wizardStep++;setupStepper();return}
  $("status").value="Completed";
  const j=await saveJob(false);if(!j)return;
  completedJob=j;
  $("jobDialog").close();
  $("completeJobNo").textContent=j.job_no;
  $("completeDialog").showModal();
}
function prevStep(){if(wizardStep===0){$("jobDialog").close();return}wizardStep--;setupStepper()}

async function ensureJob(){
  if($("jobId").value)return $("jobId").value;
  const j=await saveJob(false);return j?.id||null;
}

async function uploadFiles(files){
  if(!files?.length)return;
  const id=await ensureJob();if(!id)return;
  if(!$("jobDialog").open){try{$("jobDialog").showModal()}catch(_){}} 
  msg("jobMessage","Uploading photo…",true);
  for(const file of files){
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const path=`${id}/${Date.now()}-${currentPhotoGroup}-${safe}`;
    const u=await sb.storage.from("job-photos").upload(path,file,{upsert:false});
    if(u.error){msg("jobMessage",u.error.message);continue}
    const {data:{publicUrl}}=sb.storage.from("job-photos").getPublicUrl(path);
    const ins=await sb.from("job_photos").insert({job_id:id,storage_path:path,public_url:publicUrl,uploaded_by:currentUser.id});
    if(ins.error)msg("jobMessage",ins.error.message);
  }
  const {data}=await sb.from("job_photos").select("*").eq("job_id",id).order("created_at");
  currentPhotos=data||[];renderPhotos();msg("jobMessage","Photo added.",true);
  $("cameraPhotos").value="";$("galleryPhotos").value="";
}

function photoGroup(p){return (p.storage_path||"").includes("-after-")?"after":"before"}
function renderPhotos(){
  const list=currentPhotos.filter(p=>photoGroup(p)===currentPhotoGroup);
  $("photoPreview").innerHTML=list.length?list.map(p=>`<div class="photo-card"><img src="${esc(p.public_url)}"><span class="photo-tag">${currentPhotoGroup.toUpperCase()}</span></div>`).join(""):`<div class="empty">No ${currentPhotoGroup} photos yet.</div>`;
}

const sig=$("sig"),ctx=sig.getContext("2d");let drawing=false;
function clearSig(){ctx.fillStyle="#07101a";ctx.fillRect(0,0,sig.width,sig.height);ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.lineCap="round"}
function pos(e){const r=sig.getBoundingClientRect(),p=e.touches?e.touches[0]:e;return[(p.clientX-r.left)*sig.width/r.width,(p.clientY-r.top)*sig.height/r.height]}
function start(e){drawing=true;const[x,y]=pos(e);ctx.beginPath();ctx.moveTo(x,y);e.preventDefault()}
function move(e){if(!drawing)return;const[x,y]=pos(e);ctx.lineTo(x,y);ctx.stroke();e.preventDefault()}
["mousedown","touchstart"].forEach(x=>sig.addEventListener(x,start,{passive:false}));
["mousemove","touchmove"].forEach(x=>sig.addEventListener(x,move,{passive:false}));
["mouseup","mouseleave","touchend"].forEach(x=>sig.addEventListener(x,()=>drawing=false));

async function imageToDataUrl(src){return new Promise((resolve,reject)=>{const im=new Image();im.crossOrigin="anonymous";im.onload=()=>{const c=document.createElement("canvas");c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext("2d").drawImage(im,0,0);resolve(c.toDataURL("image/png"))};im.onerror=reject;im.src=src})}
async function urlToDataUrl(url){const r=await fetch(url);const b=await r.blob();return await new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(rd.result);rd.onerror=reject;rd.readAsDataURL(b)})}

async function buildPdf(j){
  const {jsPDF}=window.jspdf,pdf=new jsPDF({unit:"mm",format:"a4"}),W=210,H=297,M=12;
  let y=12;
  const np=()=>{pdf.addPage();y=12};
  const ensure=n=>{if(y+n>H-14)np()};
  try{pdf.addImage(await imageToDataUrl("axis-logo.png"),"PNG",12,10,30,30)}catch(_){}
  pdf.setFont("helvetica","bold");pdf.setFontSize(18);pdf.text("Axis AutoTech",48,19);
  pdf.setTextColor(0,125,215);pdf.setFontSize(9);pdf.text("Vehicle Technology. Real World Benefits.",48,25);
  pdf.setTextColor(0);pdf.setFontSize(13);pdf.text(`JOB SHEET ${j.job_no}`,148,18);
  y=48;
  const line=(a,b)=>{ensure(8);pdf.setFont("helvetica","bold");pdf.setFontSize(9);pdf.text(a,M,y);pdf.setFont("helvetica","normal");const ls=pdf.splitTextToSize(String(b||""),145);pdf.text(ls,48,y);y+=Math.max(1,ls.length)*5+1};
  line("CUSTOMER",j.customer_name);line("PHONE",j.phone);line("EMAIL",j.email);line("ADDRESS",j.address);
  line("VEHICLE",`${j.registration||""} ${j.make||""} ${j.model||""}`);line("YEAR / MILEAGE",`${j.year||""} / ${j.mileage||""}`);
  line("JOB TYPE",j.job_type||"Installation");line("ENGINEER",currentProfile.full_name);line("DATE",j.job_date);
  const block=(t,v)=>{ensure(18);y+=2;pdf.setFont("helvetica","bold");pdf.setFontSize(9);pdf.text(t,M,y);y+=5;pdf.setFont("helvetica","normal");for(const ln of pdf.splitTextToSize(v||"-",186)){ensure(6);pdf.text(ln,M,y);y+=5}y+=2};
  block("CUSTOMER REPORTED FAULT / REQUEST",j.work_required);
  block("WORK CARRIED OUT",j.work_carried_out);
  block("PARTS / EQUIPMENT USED",j.parts_used);
  block("ENGINEER NOTES",j.engineer_notes);
  block("CHECKLIST",(j.checklist||"").split("|").join(" • "));

  const {data:photos}=await sb.from("job_photos").select("*").eq("job_id",j.id).order("created_at");
  if(photos?.length){
    ensure(14);pdf.setFont("helvetica","bold");pdf.text("JOB PHOTOS",M,y);y+=7;
    for(let i=0;i<photos.length;i++){
      ensure(68);
      try{const d=await urlToDataUrl(photos[i].public_url);pdf.addImage(d,"JPEG",M,y,86,58,undefined,"FAST");pdf.setFontSize(8);pdf.text(`${photoGroup(photos[i]).toUpperCase()} ${i+1}`,M,y+62);y+=68}catch(_){}
    }
  }
  if(j.signature_data){ensure(40);pdf.setFont("helvetica","bold");pdf.text(`CUSTOMER SIGNATURE — ${j.customer_signatory||""}`,M,y);y+=5;pdf.addImage(j.signature_data,"PNG",M,y,80,28);y+=34}
  const pages=pdf.getNumberOfPages();for(let i=1;i<=pages;i++){pdf.setPage(i);pdf.setFontSize(8);pdf.setTextColor(90);pdf.text(`AXIS AutoTech · ${j.job_no} · Page ${i} of ${pages}`,M,H-7)}
  return pdf;
}

async function downloadPdf(){
  if(!completedJob){const id=$("jobId").value;if(id){const {data}=await sb.from("jobs").select("*").eq("id",id).single();completedJob=data}}
  if(!completedJob)return;
  const pdf=await buildPdf(completedJob);pdf.save(`${completedJob.job_no}-${completedJob.registration||"job"}.pdf`);
}

async function emailOffice(){
  if(!completedJob)return;
  try{
    const pdf=await buildPdf(completedJob),pdfBase64=pdf.output("datauristring").split(",")[1];
    const {error}=await sb.functions.invoke("send-job-sheet",{body:{to:cfg.JOB_EMAIL_TO,job:completedJob,engineer_name:currentProfile.full_name,pdfBase64}});
    if(error)throw error;
    alert(`Sent to ${cfg.JOB_EMAIL_TO}`);
  }catch(e){alert("Email sending is not connected yet: "+(e.message||e))}
}

function anotherJob(){$("completeDialog").close();newJob()}
function doneComplete(){$("completeDialog").close();showHome()}

document.addEventListener("DOMContentLoaded",()=>{
  $("loginForm").addEventListener("submit",login);
  $("accountBtn").addEventListener("click",()=>$("accountDialog").showModal());
  $("accountCloseBtn").addEventListener("click",()=>$("accountDialog").close());
  $("logoutBtn").addEventListener("click",logout);
  $("wizardClose").addEventListener("click",()=>$("jobDialog").close());
  $("prevStepBtn").addEventListener("click",prevStep);
  $("nextStepBtn").addEventListener("click",nextStep);
  $("clearSigBtn").addEventListener("click",clearSig);
  $("cameraPhotos").addEventListener("change",()=>uploadFiles([...$("cameraPhotos").files]));
  $("galleryPhotos").addEventListener("change",()=>uploadFiles([...$("galleryPhotos").files]));
  document.querySelectorAll("[data-photo-group]").forEach(b=>b.addEventListener("click",()=>{currentPhotoGroup=b.dataset.photoGroup;document.querySelectorAll("[data-photo-group]").forEach(x=>x.classList.toggle("active",x===b));renderPhotos()}));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.addEventListener("click",()=>({home:showHome,jobs:showJobs,customers:showCustomers,vehicles:showVehicles,more:showMore}[b.dataset.nav]||showHome)()));
  $("viewPdfBtn").addEventListener("click",downloadPdf);
  $("emailOfficeBtn").addEventListener("click",emailOffice);
  $("shareWhatsAppBtn").addEventListener("click",()=>alert("WhatsApp sharing is next on the list."));
  $("emailCustomerBtn").addEventListener("click",()=>alert("Customer email is next on the list."));
  $("anotherJobBtn").addEventListener("click",anotherJob);
  $("doneCompleteBtn").addEventListener("click",doneComplete);
  clearSig();boot();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js");
});
