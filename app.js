const cfg = window.AXIS_CONFIG || {};
const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_PUBLISHABLE_KEY &&
  !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_PUBLISHABLE_KEY_HERE");

let sb = null;
let currentUser = null;
let currentProfile = null;
let jobs = [];
let currentPhotos = [];
let signatureDirty = false;

const $ = id => document.getElementById(id);
const loginScreen = $("loginScreen");
const mainApp = $("mainApp");
const jobDialog = $("jobDialog");
const accountDialog = $("accountDialog");
const sig = $("sig");
const ctx = sig.getContext("2d");

function esc(v=""){
  return String(v).replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function showMessage(target,text,ok=false){
  $(target).innerHTML = `<div class="${ok?"message-ok":"message-error"}">${esc(text)}</div>`;
}

async function boot(){
  if(!configured){
    loginScreen.classList.remove("hidden");
    $("loginMessage").innerHTML =
      `<div class="message-error">Open <b>config.js</b> in GitHub and paste the Supabase Publishable key where it says PASTE_PUBLISHABLE_KEY_HERE.</div>`;
    return;
  }

  sb = supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);

  const {data:{session}} = await sb.auth.getSession();

  if(session){
    await enterApp(session.user);
  } else {
    loginScreen.classList.remove("hidden");
  }

  sb.auth.onAuthStateChange(async(_event,session)=>{
    if(session) await enterApp(session.user);
    else{
      currentUser=null;
      currentProfile=null;
      mainApp.classList.add("hidden");
      loginScreen.classList.remove("hidden");
    }
  });
}

async function enterApp(user){
  currentUser=user;

  const {data,error} = await sb
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("id",user.id)
    .single();

  if(error || !data){
    loginScreen.classList.remove("hidden");
    showMessage("loginMessage","Your engineer profile could not be loaded.");
    return;
  }

  if(!data.active){
    loginScreen.classList.remove("hidden");
    showMessage("loginMessage","This engineer account is disabled.");
    await sb.auth.signOut();
    return;
  }

  currentProfile=data;

  $("engineerLine").textContent =
    `Signed in: ${currentProfile.full_name} · ${currentProfile.role}`;

  $("accountName").textContent=currentProfile.full_name;
  $("accountEmail").textContent=currentProfile.email;
  $("accountRole").textContent=currentProfile.role;

  loginScreen.classList.add("hidden");
  mainApp.classList.remove("hidden");

  await loadJobs();
}

async function login(e){
  e.preventDefault();
  $("loginMessage").innerHTML="";

  const {error}=await sb.auth.signInWithPassword({
    email:$("loginEmail").value.trim(),
    password:$("loginPassword").value
  });

  if(error) showMessage("loginMessage",error.message);
}

async function logout(){
  accountDialog.close();
  await sb.auth.signOut();
}

async function loadJobs(){
  $("jobs").innerHTML=`<div class="empty">Loading jobs…</div>`;

  const {data,error}=await sb
    .from("jobs")
    .select(`
      *,
      profiles!jobs_engineer_id_fkey(full_name)
    `)
    .order("created_at",{ascending:false});

  if(error){
    $("jobs").innerHTML=`<div class="message-error">${esc(error.message)}</div>`;
    return;
  }

  jobs=data || [];
  render();
}

function render(){
  const q=$("search").value.toLowerCase();

  $("openCount").textContent=jobs.filter(j=>j.status!=="Completed").length;
  $("doneCount").textContent=jobs.filter(j=>j.status==="Completed").length;

  const filtered=jobs.filter(j=>
    [
      j.job_no,
      j.customer_name,
      j.registration,
      j.make,
      j.model,
      j.profiles?.full_name
    ].join(" ").toLowerCase().includes(q)
  );

  $("jobs").innerHTML=filtered.length
    ? filtered.map(j=>`
      <div class="job" data-id="${j.id}">
        <div class="jobtop">
          <div>
            <strong>${esc(j.registration || "No reg")} · ${esc(j.customer_name)}</strong>
            <div class="muted">${esc(j.job_no)} · ${esc(j.job_date)} · ${esc(j.make)} ${esc(j.model)}</div>
            <div class="job-engineer">Engineer: ${esc(j.profiles?.full_name || "Unknown")}</div>
          </div>
          <span class="pill">${esc(j.status)}</span>
        </div>
      </div>
    `).join("")
    : `<div class="empty">No jobs yet. Hit <b>New Job</b> 👊</div>`;

  document.querySelectorAll(".job[data-id]").forEach(el=>{
    el.addEventListener("click",()=>editJob(el.dataset.id));
  });
}

function generateJobNo(){
  const d=new Date();
  const yy=String(d.getFullYear()).slice(-2);
  const mm=String(d.getMonth()+1).padStart(2,"0");
  const dd=String(d.getDate()).padStart(2,"0");
  const random=String(Math.floor(Math.random()*900)+100);
  return `AX-${yy}${mm}${dd}-${random}`;
}

function newJob(){
  $("jobForm").reset();
  $("jobId").value="";
  $("date").value=new Date().toISOString().slice(0,10);
  $("jobNo").value=generateJobNo();
  $("formTitle").textContent="New Job";
  $("jobEngineer").textContent=currentProfile.full_name;
  $("jobMessage").innerHTML="";
  currentPhotos=[];
  $("photoPreview").innerHTML="";
  clearSig();
  jobDialog.showModal();
}

async function editJob(jobId){
  $("jobMessage").innerHTML="";

  const {data:j,error}=await sb
    .from("jobs")
    .select("*")
    .eq("id",jobId)
    .single();

  if(error){
    alert(error.message);
    return;
  }

  const {data:photos}=await sb
    .from("job_photos")
    .select("*")
    .eq("job_id",jobId)
    .order("created_at",{ascending:true});

  currentPhotos=photos || [];

  const values={
    jobId:j.id,
    jobNo:j.job_no,
    date:j.job_date,
    customer:j.customer_name,
    phone:j.phone,
    email:j.email,
    address:j.address,
    reg:j.registration,
    mileage:j.mileage,
    make:j.make,
    model:j.model,
    year:j.year,
    workRequired:j.work_required,
    workCarriedOut:j.work_carried_out,
    parts:j.parts_used,
    notes:j.engineer_notes,
    status:j.status,
    signatory:j.customer_signatory
  };

  Object.entries(values).forEach(([key,value])=>{
    $(key).value=value || "";
  });

  $("formTitle").textContent=`Edit ${j.job_no}`;

  const assigned=jobs.find(x=>x.id===jobId)?.profiles?.full_name || currentProfile.full_name;
  $("jobEngineer").textContent=assigned;

  clearSig();

  if(j.signature_data){
    const im=new Image();
    im.onload=()=>ctx.drawImage(im,0,0,sig.width,sig.height);
    im.src=j.signature_data;
  }

  renderPhotoPreview();
  jobDialog.showModal();
}

function jobPayload(){
  return {
    job_no:$("jobNo").value.trim(),
    job_date:$("date").value,
    customer_name:$("customer").value.trim(),
    phone:$("phone").value.trim(),
    email:$("email").value.trim(),
    address:$("address").value.trim(),
    registration:$("reg").value.trim().toUpperCase(),
    mileage:$("mileage").value.trim(),
    make:$("make").value.trim(),
    model:$("model").value.trim(),
    year:$("year").value.trim(),
    work_required:$("workRequired").value.trim(),
    work_carried_out:$("workCarriedOut").value.trim(),
    parts_used:$("parts").value.trim(),
    engineer_notes:$("notes").value.trim(),
    status:$("status").value,
    engineer_id:currentUser.id,
    customer_signatory:$("signatory").value.trim(),
    signature_data:sig.toDataURL("image/png"),
    completion_date:$("status").value==="Completed"
      ? new Date().toISOString()
      : null,
    updated_at:new Date().toISOString()
  };
}

async function saveJob(e){
  if(e) e.preventDefault();

  $("jobMessage").innerHTML="";
  const jobId=$("jobId").value;
  const payload=jobPayload();

  let result;

  if(jobId){
    result=await sb
      .from("jobs")
      .update(payload)
      .eq("id",jobId)
      .select()
      .single();
  }else{
    result=await sb
      .from("jobs")
      .insert(payload)
      .select()
      .single();
  }

  if(result.error){
    showMessage("jobMessage",result.error.message);
    return null;
  }

  $("jobId").value=result.data.id;

  await uploadSelectedPhotos(result.data.id);
  await logAudit(result.data.id,jobId ? "updated" : "created");

  showMessage("jobMessage","Job saved.",true);
  await loadJobs();

  return result.data;
}

async function uploadSelectedPhotos(jobId){
  const files=[...$("photos").files];

  if(!files.length) return;

  for(const file of files){
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const path=`${jobId}/${Date.now()}-${safeName}`;

    const upload=await sb.storage
      .from("job-photos")
      .upload(path,file,{upsert:false});

    if(upload.error){
      showMessage("jobMessage","Job saved, but a photo failed to upload: "+upload.error.message);
      continue;
    }

    const {data:{publicUrl}}=sb.storage
      .from("job-photos")
      .getPublicUrl(path);

    await sb.from("job_photos").insert({
      job_id:jobId,
      storage_path:path,
      public_url:publicUrl,
      uploaded_by:currentUser.id
    });
  }

  $("photos").value="";

  const {data}=await sb
    .from("job_photos")
    .select("*")
    .eq("job_id",jobId)
    .order("created_at",{ascending:true});

  currentPhotos=data || [];
  renderPhotoPreview();
}

function renderPhotoPreview(){
  $("photoPreview").innerHTML=currentPhotos.length
    ? currentPhotos.map(p=>`<img src="${esc(p.public_url)}" alt="Job photo">`).join("")
    : "";
}

async function logAudit(jobId,action){
  await sb.from("job_audit").insert({
    job_id:jobId,
    user_id:currentUser.id,
    action
  });
}

function clearSig(){
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,sig.width,sig.height);
  ctx.strokeStyle="#111";
  ctx.lineWidth=3;
  ctx.lineCap="round";
  signatureDirty=false;
}

function pos(e){
  const r=sig.getBoundingClientRect();
  const p=e.touches ? e.touches[0] : e;
  return [
    (p.clientX-r.left)*sig.width/r.width,
    (p.clientY-r.top)*sig.height/r.height
  ];
}

let drawing=false;

function start(e){
  drawing=true;
  signatureDirty=true;
  const [x,y]=pos(e);
  ctx.beginPath();
  ctx.moveTo(x,y);
  e.preventDefault();
}

function move(e){
  if(!drawing)return;
  const [x,y]=pos(e);
  ctx.lineTo(x,y);
  ctx.stroke();
  e.preventDefault();
}

["mousedown","touchstart"].forEach(x=>sig.addEventListener(x,start,{passive:false}));
["mousemove","touchmove"].forEach(x=>sig.addEventListener(x,move,{passive:false}));
["mouseup","mouseleave","touchend"].forEach(x=>sig.addEventListener(x,()=>drawing=false));

async function getCurrentSavedJob(){
  const jid=$("jobId").value;
  if(!jid){
    const saved=await saveJob();
    if(!saved) return null;
    return saved;
  }

  const {data}=await sb.from("jobs").select("*").eq("id",jid).single();
  return data;
}

async function printCurrent(){
  const j=await getCurrentSavedJob();
  if(!j) return;

  $("printArea").innerHTML=`
    <div class="printsheet">
      <img src="axis-logo.png" class="print-logo">
      <h1>AXIS AutoTech</h1>
      <h2>Job Sheet ${esc(j.job_no)}</h2>

      <div class="print-grid">
        <p><b>Date:</b> ${esc(j.job_date)}</p>
        <p><b>Engineer:</b> ${esc(currentProfile.full_name)}</p>
        <p><b>Customer:</b> ${esc(j.customer_name)}</p>
        <p><b>Phone:</b> ${esc(j.phone)}</p>
        <p><b>Vehicle:</b> ${esc(j.registration)} — ${esc(j.make)} ${esc(j.model)}</p>
        <p><b>Mileage:</b> ${esc(j.mileage)}</p>
      </div>

      <hr>

      <h3>Work required / reported fault</h3>
      <p>${esc(j.work_required).replace(/\n/g,"<br>")}</p>

      <h3>Work carried out</h3>
      <p>${esc(j.work_carried_out).replace(/\n/g,"<br>")}</p>

      <h3>Parts / materials used</h3>
      <p>${esc(j.parts_used).replace(/\n/g,"<br>")}</p>

      <h3>Engineer notes</h3>
      <p>${esc(j.engineer_notes).replace(/\n/g,"<br>")}</p>

      <p><b>Status:</b> ${esc(j.status)}</p>
      <p><b>Customer signatory:</b> ${esc(j.customer_signatory)}</p>

      <h3>Customer signature</h3>
      <img src="${j.signature_data}" style="max-width:360px;border:1px solid #aaa">
    </div>`;

  window.print();
}

async function buildPdf(j){
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF();
  let y=18;

  try{
    const logo=await imageToDataUrl("axis-logo.png");
    pdf.addImage(logo,"PNG",14,10,34,34);
  }catch(_){}

  pdf.setFont("helvetica","bold");
  pdf.setFontSize(20);
  pdf.text("AXIS AutoTech",55,20);

  pdf.setFontSize(10);
  pdf.setTextColor(13,137,220);
  pdf.text("Vehicle Technology. Real World Benefits.",55,27);

  pdf.setTextColor(0);
  pdf.setFontSize(15);
  pdf.text(`Job Sheet ${j.job_no}`,14,53);
  y=63;

  const line=(label,value)=>{
    pdf.setFont("helvetica","bold");
    pdf.setFontSize(10);
    pdf.text(label,14,y);
    pdf.setFont("helvetica","normal");
    pdf.text(String(value || ""),53,y);
    y+=7;
  };

  line("Date",j.job_date);
  line("Engineer",currentProfile.full_name);
  line("Customer",j.customer_name);
  line("Phone",j.phone);
  line("Email",j.email);
  line("Vehicle",`${j.registration || ""} — ${j.make || ""} ${j.model || ""}`);
  line("Mileage",j.mileage);
  line("Status",j.status);

  const block=(title,text)=>{
    if(y>250){pdf.addPage();y=20}
    y+=4;
    pdf.setFont("helvetica","bold");
    pdf.text(title,14,y);
    y+=6;
    pdf.setFont("helvetica","normal");
    const lines=pdf.splitTextToSize(text || "",180);
    pdf.text(lines,14,y);
    y+=Math.max(lines.length,1)*5+5;
  };

  block("Work required / reported fault",j.work_required);
  block("Work carried out",j.work_carried_out);
  block("Parts / materials used",j.parts_used);
  block("Engineer notes",j.engineer_notes);

  if(j.signature_data){
    if(y>235){pdf.addPage();y=20}
    pdf.setFont("helvetica","bold");
    pdf.text(`Customer sign-off: ${j.customer_signatory || ""}`,14,y);
    y+=5;
    pdf.addImage(j.signature_data,"PNG",14,y,70,25);
  }

  return pdf;
}

function imageToDataUrl(src){
  return new Promise((resolve,reject)=>{
    const im=new Image();
    im.crossOrigin="anonymous";
    im.onload=()=>{
      const c=document.createElement("canvas");
      c.width=im.naturalWidth;
      c.height=im.naturalHeight;
      c.getContext("2d").drawImage(im,0,0);
      resolve(c.toDataURL("image/png"));
    };
    im.onerror=reject;
    im.src=src;
  });
}

async function completeAndSend(){
  $("status").value="Completed";

  const saved=await saveJob();
  if(!saved)return;

  const {data:j,error}=await sb
    .from("jobs")
    .select("*")
    .eq("id",saved.id)
    .single();

  if(error){
    showMessage("jobMessage",error.message);
    return;
  }

  try{
    const pdf=await buildPdf(j);
    const pdfBase64=pdf.output("datauristring").split(",")[1];

    const {error:fnError}=await sb.functions.invoke("send-job-sheet",{
      body:{
        to:cfg.JOB_EMAIL_TO,
        job:j,
        engineer_name:currentProfile.full_name,
        pdfBase64
      }
    });

    if(fnError) throw fnError;

    await logAudit(j.id,"completed_and_emailed");

    showMessage(
      "jobMessage",
      `Completed and sent to ${cfg.JOB_EMAIL_TO}.`,
      true
    );

    await loadJobs();

  }catch(err){
    showMessage(
      "jobMessage",
      "Job completed and saved, but email is not connected yet. "+(err.message || "")
    );
  }
}

$("loginForm").addEventListener("submit",login);
$("newJobBtn").addEventListener("click",newJob);
$("refreshBtn").addEventListener("click",loadJobs);
$("search").addEventListener("input",render);
$("closeJobBtn").addEventListener("click",()=>jobDialog.close());
$("jobForm").addEventListener("submit",saveJob);
$("clearSigBtn").addEventListener("click",clearSig);
$("jobSheetBtn").addEventListener("click",printCurrent);
$("completeBtn").addEventListener("click",completeAndSend);

$("accountBtn").addEventListener("click",()=>accountDialog.showModal());
$("accountCloseBtn").addEventListener("click",()=>accountDialog.close());
$("logoutBtn").addEventListener("click",logout);

clearSig();
boot();

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js");
}
