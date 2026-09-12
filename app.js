const RAW_CFG = window.TEAM_SUPABASE || {};
const CFG = {
  url: String(
    RAW_CFG.url ||
    RAW_CFG.supabaseUrl ||
    RAW_CFG.SUPABASE_URL ||
    ""
  ).trim(),
  key: String(
    RAW_CFG.key ||
    RAW_CFG.publishableKey ||
    RAW_CFG.anonKey ||
    RAW_CFG.supabaseKey ||
    RAW_CFG.SUPABASE_KEY ||
    ""
  ).trim()
};

const configMissing = [];
if (!CFG.url || CFG.url.includes("YOUR_SUPABASE")) configMissing.push("Project URL");
if (!CFG.key || CFG.key.includes("YOUR_SUPABASE")) configMissing.push("Publishable/Anon Key");

const configured = configMissing.length === 0;

const $ = (id) => document.getElementById(id);
const loginScreen = $("loginScreen");
const configScreen = $("configScreen");
const appShell = $("appShell");
const content = $("content");
const pageTitle = $("pageTitle");

let sb = null;
let session = null;
let currentUser = null;
let currentMember = null;
let realtimeChannel = null;

let state = {
  members: [],
  projects: [],
  tests: [],
  activity: [],
  profiles: {},
  calendarCursor: new Date().toISOString().slice(0,7)
};

let currentView = "dashboard";
let searchQuery = "";

function uid(){
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,10);
}

function esc(value=""){
  return String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function initials(name=""){
  return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "?";
}

function memberById(slug){
  return state.members.find(m => m.id === slug);
}

function nextDateTimeLocal(days, hour=20, minute=0){
  const d = new Date();
  d.setDate(d.getDate()+days);
  d.setHours(hour,minute,0,0);
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextDateOnly(days){
  const d=new Date();
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}

function formationFor(memberIds=[]){
  const count = new Set(memberIds).size;
  const officialCount = state.members.filter(m=>m.isActive).length || 8;

  if(count >= officialCount && officialCount > 0) return "GROUP";
  if(count >= 4) return "TEAM";
  if(count === 3) return "TRIPLE";
  if(count === 2) return "DUO";
  return "SOLO";
}

function formationInfo(memberIds=[]){
  const formation = formationFor(memberIds);
  const count = new Set(memberIds).size;
  const officialCount = state.members.filter(m=>m.isActive).length || 8;
  const hints = {
    SOLO: `SOLO · ${count || 0} member`,
    DUO: "DUO · 2 members",
    TRIPLE: "TRIPLE · 3 members",
    TEAM: "TEAM · 4–7 members",
    GROUP: `GROUP · đủ ${officialCount} members`
  };
  return { formation, hint: hints[formation] };
}

function formatDateTime(value){
  if(!value) return "No deadline";
  const d = new Date(value);
  return new Intl.DateTimeFormat("vi-VN",{
    day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"
  }).format(d);
}

function formatDate(value){
  if(!value) return "";
  const d = new Date(value+"T00:00:00");
  return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"short",year:"numeric"}).format(d);
}

function relativeDeadline(value){
  const diff = new Date(value).getTime()-Date.now();
  const hours = Math.ceil(diff/36e5);
  if(hours<0) return {label:`OVERDUE ${Math.abs(hours)}h`,cls:"overdue"};
  if(hours<=24) return {label:`Còn ${hours}h`,cls:"soon"};
  const days=Math.ceil(hours/24);
  if(days<=3) return {label:`Còn ${days} ngày`,cls:"soon"};
  return {label:`Còn ${days} ngày`,cls:""};
}

function projectProgress(p){
  if(!p.tasks?.length) return 0;
  return Math.round((p.tasks.filter(t=>t.done).length/p.tasks.length)*100);
}

function avatar(member, extraClass=""){
  if(!member) return "";
  return `<span class="avatar ${extraClass}" title="${esc(member.name)}" style="background:${esc(memberDisplayColor(member.id))}">${esc(initials(member.name))}</span>`;
}

function memberAvatars(ids=[]){
  const shown=ids.slice(0,5).map(id=>avatar(memberById(id))).join("");
  const extra=ids.length-5;
  return shown+(extra>0?`<span class="avatar more">+${extra}</span>`:"");
}

function formationBadge(formation){
  const f = (formation || "SOLO").toUpperCase();
  return `<span class="formation-badge ${f.toLowerCase()}">${esc(f)}</span>`;
}

function mapMember(row){
  return {
    id: row.slug,
    name: row.display_name,
    color: row.color,
    authUserId: row.auth_user_id,
    isOwner: !!row.is_owner,
    isActive: row.is_active !== false
  };
}

function mapProfile(row){
  return {
    memberId: row.member_slug,
    stageName: row.stage_name || "",
    birthDate: row.birth_date || "",
    roles: Array.isArray(row.roles) ? row.roles : [],
    mbti: row.mbti || "",
    zodiac: row.zodiac || "",
    color: row.profile_color || "",
    emoji: row.emoji || "",
    preDebutSongs: Array.isArray(row.pre_debut_songs) ? row.pre_debut_songs : [],
    stats: Array.isArray(row.stats) ? row.stats : [],
    languages: Array.isArray(row.languages) ? row.languages : [],
    facts: Array.isArray(row.facts) ? row.facts : [],
    updatedAt: row.updated_at
  };
}

function profileFor(memberId){
  const m = memberById(memberId);
  const p = state.profiles[memberId] || {};
  return {
    memberId,
    stageName: p.stageName || m?.name || "",
    birthDate: p.birthDate || "",
    roles: Array.isArray(p.roles) ? p.roles : [],
    mbti: p.mbti || "",
    zodiac: p.zodiac || "",
    color: p.color || m?.color || "#B0D9FA",
    emoji: p.emoji || "",
    preDebutSongs: Array.isArray(p.preDebutSongs) ? p.preDebutSongs : [],
    stats: Array.isArray(p.stats) && p.stats.length ? p.stats : [
      {name:"VOCAL",value:0},{name:"RAP",value:0},{name:"ACT",value:0}
    ],
    languages: Array.isArray(p.languages) ? p.languages : [],
    facts: Array.isArray(p.facts) ? p.facts : []
  };
}

function memberDisplayColor(memberId){
  return profileFor(memberId).color || memberById(memberId)?.color || "#B0D9FA";
}

function mapProject(row){
  return {
    id: row.id,
    name: row.name,
    type: row.project_type,
    formation: row.song_formation,
    deadline: row.deadline,
    priority: row.priority,
    memberIds: row.member_slugs || [],
    links: row.links || {},
    tasks: Array.isArray(row.tasks) ? row.tasks : [],
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTest(row){
  return {
    id: row.id,
    name: row.candidate_name,
    deadline: row.deadline,
    reviewerIds: row.reviewer_slugs || [],
    bandlab: row.bandlab_url || "",
    original: row.original_url || "",
    tasks: Array.isArray(row.test_tasks) ? row.test_tasks : [],
    notes: row.notes || "",
    status: row.status || "testing",
    createdAt: row.created_at
  };
}

function mapActivity(row){
  return {
    id: row.id,
    text: row.action_text,
    memberId: row.actor_member_slug,
    at: row.created_at
  };
}

async function boot(){
  if(!configured){
    loginScreen.classList.add("hidden");
    configScreen.classList.remove("hidden");

    const card = configScreen.querySelector(".config-card");
    if(card){
      card.innerHTML = `
        <div class="brand-mark">R</div>
        <h2>Chưa kết nối Supabase</h2>
        <p>Thiếu: <b>${esc(configMissing.join(" + "))}</b></p>
        <p>Mở <code>config.js</code> và kiểm tra lại. Web hiện nhận các tên: <code>url</code>, <code>key</code>, <code>publishableKey</code>, <code>anonKey</code>.</p>
        <p style="margin-top:14px">Nếu đã điền đúng mà vẫn thấy màn hình này, rất có thể trình duyệt đang dùng file <code>config.js</code> cũ trong cache. Hãy hard refresh bằng <b>Ctrl + F5</b>.</p>
      `;
    }
    return;
  }

  sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
  });

  const { data } = await sb.auth.getSession();
  session = data.session;

  sb.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    if(session){
      currentUser = session.user;
      await enterWorkspace();
    }else{
      leaveWorkspace();
    }
  });

  if(session){
    currentUser = session.user;
    await enterWorkspace();
  }else{
    showLogin();
  }
}

function showLogin(){
  configScreen.classList.add("hidden");
  appShell.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

function leaveWorkspace(){
  if(realtimeChannel && sb) sb.removeChannel(realtimeChannel);
  realtimeChannel=null;
  session=null;
  currentUser=null;
  currentMember=null;
  state.members=[];
  state.projects=[];
  state.tests=[];
  state.activity=[];
  state.profiles={};
  showLogin();
}

async function enterWorkspace(){
  loginScreen.classList.add("hidden");
  configScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  content.innerHTML=`<div class="loading-state">Loading workspace...</div>`;

  try{
    await loadAllData();

    currentMember = state.members.find(m=>m.authUserId===currentUser.id) || null;

    if(!currentMember){
      content.innerHTML=`
        <div class="permission-error">
          <h2>Tài khoản chưa được cấp quyền</h2>
          <p>Bạn đã đăng nhập Supabase thành công nhưng tài khoản này chưa được liên kết với một member trong <code>team_members</code>. Người giữ web cần link Auth User ID vào member tương ứng.</p>
          <button class="secondary-btn" id="permissionLogout">Sign out</button>
        </div>`;
      $("permissionLogout").addEventListener("click",logout);
      return;
    }

    renderAccount();
    subscribeRealtime();
    render();
  }catch(err){
    console.error(err);
    content.innerHTML=`
      <div class="permission-error">
        <h2>Không tải được workspace</h2>
        <p>${esc(err.message || "Unknown Supabase error")}</p>
        <button class="secondary-btn" id="loadLogout">Sign out</button>
      </div>`;
    $("loadLogout")?.addEventListener("click",logout);
  }
}

async function loadAllData(){
  const [membersRes, profilesRes, projectsRes, testsRes, activityRes] = await Promise.all([
    sb.from("team_members").select("*").eq("is_active",true).order("created_at",{ascending:true}),
    sb.from("team_member_profiles").select("*"),
    sb.from("team_projects").select("*").order("deadline",{ascending:true}),
    sb.from("team_project_tests").select("*").order("deadline",{ascending:true}),
    sb.from("team_activity").select("*").order("created_at",{ascending:false}).limit(80)
  ]);

  for(const res of [membersRes,profilesRes,projectsRes,testsRes,activityRes]){
    if(res.error) throw res.error;
  }

  state.members = membersRes.data.map(mapMember);
  state.profiles = Object.fromEntries(profilesRes.data.map(row=>{
    const p=mapProfile(row); return [p.memberId,p];
  }));
  state.projects = projectsRes.data.map(mapProject);
  state.tests = testsRes.data.map(mapTest);
  state.activity = activityRes.data.map(mapActivity);
}

function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);

  realtimeChannel = sb
    .channel("team-space-db")
    .on("postgres_changes",{event:"*",schema:"public",table:"team_member_profiles"},()=>refreshProfiles())
    .on("postgres_changes",{event:"*",schema:"public",table:"team_projects"},()=>refreshProjects())
    .on("postgres_changes",{event:"*",schema:"public",table:"team_project_tests"},()=>refreshTests())
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"team_activity"},()=>refreshActivity())
    .subscribe();
}

async function refreshProfiles(){
  const {data,error}=await sb.from("team_member_profiles").select("*");
  if(!error){
    state.profiles=Object.fromEntries(data.map(row=>{const p=mapProfile(row);return [p.memberId,p]}));
    if(currentMember) renderAccount();
    render();
  }
}

async function refreshProjects(){
  const {data,error}=await sb.from("team_projects").select("*").order("deadline",{ascending:true});
  if(!error){state.projects=data.map(mapProject);render();}
}

async function refreshTests(){
  const {data,error}=await sb.from("team_project_tests").select("*").order("deadline",{ascending:true});
  if(!error){state.tests=data.map(mapTest);render();}
}

async function refreshActivity(){
  const {data,error}=await sb.from("team_activity").select("*").order("created_at",{ascending:false}).limit(80);
  if(!error){state.activity=data.map(mapActivity);render();}
}

async function activity(text){
  if(!currentUser || !currentMember) return;
  const {error}=await sb.from("team_activity").insert({
    actor_user_id: currentUser.id,
    actor_member_slug: currentMember.id,
    action_text: text
  });
  if(error) console.warn("Activity insert failed:",error.message);
}

function renderAccount(){
  $("accountName").textContent=currentMember.name;
  $("accountAvatar").textContent=initials(currentMember.name);
  $("accountAvatar").style.background=memberDisplayColor(currentMember.id);
}

async function logout(){
  if(!sb) return;
  await sb.auth.signOut();
}

$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("loginEmail").value.trim();
  const password=$("loginPassword").value;
  const btn=$("loginBtn");
  const err=$("loginError");

  err.classList.add("hidden");
  btn.disabled=true;
  btn.textContent="Signing in...";

  const {error}=await sb.auth.signInWithPassword({email,password});

  btn.disabled=false;
  btn.textContent="Sign in";

  if(error){
    err.textContent="Sai tài khoản/mật khẩu hoặc tài khoản chưa sẵn sàng.";
    err.classList.remove("hidden");
  }
});

$("togglePassword").addEventListener("click",()=>{
  const input=$("loginPassword");
  input.type=input.type==="password"?"text":"password";
  $("togglePassword").textContent=input.type==="password"?"Show":"Hide";
});

$("logoutBtn").addEventListener("click",logout);

function setView(view){
  currentView=view;
  document.querySelectorAll(".nav-item").forEach(btn=>btn.classList.toggle("active",btn.dataset.view===view));
  const labels={dashboard:"Dashboard",projects:"Projects",mytasks:"My Tasks",calendar:"Calendar",members:"Members","project-test":"Project Test"};
  pageTitle.textContent=labels[view]||"TEAM SPACE";
  render();
  $("sidebar").classList.remove("open");
}

function render(){
  if(!currentMember) return;
  if(searchQuery){renderSearch();return}
  if(currentView==="dashboard") renderDashboard();
  if(currentView==="projects") renderProjects();
  if(currentView==="mytasks") renderMyTasks();
  if(currentView==="calendar") renderCalendar();
  if(currentView==="members") renderMembers();
  if(currentView==="project-test") renderProjectTest();
}

function renderDashboard(){
  const openTasks=state.projects.flatMap(p=>p.tasks.map(t=>({...t,project:p}))).filter(t=>!t.done);
  const myTasks=openTasks.filter(t=>t.assigneeId===currentMember.id);
  const overdue=state.projects.filter(p=>new Date(p.deadline).getTime()<Date.now()&&projectProgress(p)<100);
  const next=[...state.projects].sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)).slice(0,3);

  content.innerHTML=`
    <div class="section">
      <div class="section-head">
        <div><h2>Hello, ${esc(currentMember.name)}!</h2><p>Tổng quan hoạt động của nhóm và deadline gần nhất.</p></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><small>Active projects</small><strong>${state.projects.filter(p=>projectProgress(p)<100).length}</strong><div class="stat-foot">Project đang hoạt động</div></div>
        <div class="stat-card"><small>My tasks</small><strong>${myTasks.length}</strong><div class="stat-foot">Task chưa hoàn thành của bạn</div></div>
        <div class="stat-card"><small>Overdue</small><strong>${overdue.length}</strong><div class="stat-foot">Project đã quá deadline</div></div>
        <div class="stat-card"><small>Project Test</small><strong>${state.tests.filter(t=>t.status==="testing").length}</strong><div class="stat-foot">Candidate đang test</div></div>
      </div>

      <div class="dashboard-grid">
        <div class="stack">
          <div class="panel">
            <div class="panel-title"><h3>Upcoming Projects</h3><button class="ghost-btn" data-go="projects">View all</button></div>
            <div class="project-grid">${next.length?next.map(projectCard).join(""):emptyInline("Chưa có project","Tạo project đầu tiên để bắt đầu.")}</div>
          </div>
          <div class="panel">
            <div class="panel-title"><h3>My Tasks</h3><small>${myTasks.length} open</small></div>
            <div class="task-list">${myTasks.length?myTasks.slice(0,7).map(taskRow).join(""):emptyInline("Không có task","Bạn đang rảnh ở thời điểm này.")}</div>
          </div>
        </div>

        <div class="stack">
          <div class="panel">
            <div class="panel-title"><h3>Recent Activity</h3><small>Realtime</small></div>
            <div class="activity-list">${state.activity.length?state.activity.slice(0,10).map(activityRow).join(""):emptyInline("Chưa có activity","Thay đổi mới sẽ xuất hiện ở đây.")}</div>
          </div>
          <div class="panel">
            <div class="panel-title"><h3>Team</h3><small>${state.members.length} members</small></div>
            <div class="avatar-row">${state.members.map(m=>avatar(m)).join("")}</div>
          </div>
        </div>
      </div>
    </div>`;
  bindCommon();
}

function projectCard(p){
  const rel=relativeDeadline(p.deadline);
  const progress=projectProgress(p);
  const formation=formationFor(p.memberIds);
  const links=[];
  if(p.links?.bandlab) links.push(`<a class="link-chip" href="${esc(p.links.bandlab)}" target="_blank" rel="noopener">BandLab ↗</a>`);
  if(p.links?.original) links.push(`<a class="link-chip" href="${esc(p.links.original)}" target="_blank" rel="noopener">Original ↗</a>`);
  if(p.links?.drive) links.push(`<a class="link-chip" href="${esc(p.links.drive)}" target="_blank" rel="noopener">Drive ↗</a>`);
  if(p.links?.other) links.push(`<a class="link-chip" href="${esc(p.links.other)}" target="_blank" rel="noopener">Other ↗</a>`);

  return `
    <article class="project-card">
      <div class="topline">
        <div class="card-label-row">
          <span class="tag ${p.priority==="urgent"?"urgent":p.priority==="high"?"high":""}">${esc(p.type)} · ${esc(p.priority.toUpperCase())}</span>
          ${formationBadge(formation)}
        </div>
        <button class="card-menu edit-project" data-id="${p.id}" title="Edit">•••</button>
      </div>
      <h3>${esc(p.name)}</h3>
      <div class="deadline ${rel.cls}">${esc(formatDateTime(p.deadline))} · ${rel.label}</div>

      <div class="progress-wrap">
        <div class="progress-meta"><span>${p.tasks.filter(t=>t.done).length}/${p.tasks.length||0} tasks</span><b>${progress}%</b></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>

      <div class="avatar-row">${memberAvatars(p.memberIds)}</div>
      ${links.length?`<div class="link-row">${links.join("")}</div>`:""}
    </article>`;
}

function taskRow(t){
  const assignee=memberById(t.assigneeId);
  return `<div class="task-item">
    <button class="task-check ${t.done?"done":""}" data-project-id="${t.project.id}" data-task-id="${t.id}">${t.done?"✓":""}</button>
    <div class="task-main"><b>${esc(t.title)}</b><small>${esc(t.project.name)}</small></div>
    ${assignee?avatar(assignee):""}
  </div>`;
}

function activityRow(a){
  const m=memberById(a.memberId);
  const time=new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(a.at));
  return `<div class="activity-item"><span class="activity-dot" style="background:${m?.color||"#B0D9FA"}"></span><div><b>${esc(m?.name||"Member")}</b><p>${esc(a.text)} · ${esc(time)}</p></div></div>`;
}

function emptyInline(title,desc){
  return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(desc)}</div>`;
}

function renderProjects(){
  const projects=[...state.projects].sort((a,b)=>new Date(a.deadline)-new Date(b.deadline));
  content.innerHTML=`
    <div class="section">
      <div class="section-head">
        <div><h2>Projects</h2><p>Mọi member đều có thể tạo và chỉnh sửa project, deadline, task và link.</p></div>
        <button class="primary-btn" id="newProjectPageBtn">＋ New Project</button>
      </div>
      ${projects.length?`<div class="project-grid">${projects.map(projectCard).join("")}</div>`:emptyInline("Chưa có project","Bấm New Project để tạo project đầu tiên.")}
    </div>`;
  bindCommon();
  $("newProjectPageBtn")?.addEventListener("click",()=>openProjectModal());
}

function renderMyTasks(){
  const tasks=state.projects.flatMap(p=>p.tasks.map(t=>({...t,project:p})))
    .filter(t=>t.assigneeId===currentMember.id).sort((a,b)=>Number(a.done)-Number(b.done));

  content.innerHTML=`
    <div class="section">
      <div class="section-head"><div><h2>${esc(currentMember.name)}'s Tasks</h2><p>Task được giao trực tiếp cho tài khoản đang đăng nhập.</p></div></div>
      <div class="panel"><div class="task-list">${tasks.length?tasks.map(taskRow).join(""):emptyInline("Không có task","Bạn chưa được gán task nào.")}</div></div>
    </div>`;
  bindCommon();
}

function renderMembers(){
  const cards=state.members.map(m=>{
    const p=profileFor(m.id);
    const joined=state.projects.filter(pr=>pr.memberIds.includes(m.id));
    const assigned=state.projects.flatMap(pr=>pr.tasks).filter(t=>t.assigneeId===m.id);
    const complete=assigned.filter(t=>t.done).length;
    const icon=p.emoji || initials(m.name);
    return `<article class="member-card">
      <div class="member-accent" style="background:${esc(p.color)}"></div>
      <div class="member-hero">
        <div class="member-big-avatar ${p.emoji?"with-emoji":""}" style="background:${esc(p.color)}">${esc(icon)}</div>
        <div>
          <h3>${esc(p.stageName || m.name)}</h3>
          <div class="hex">${p.stageName && p.stageName!==m.name?esc(m.name)+" · ":""}${esc(p.color)}${m.isOwner?" · OWNER":""}</div>
        </div>
      </div>
      <div class="member-profile-summary">
        ${p.roles.slice(0,2).map(x=>`<span class="profile-mini-chip">${esc(x)}</span>`).join("")}
        ${p.mbti?`<span class="profile-mini-chip">${esc(p.mbti)}</span>`:""}
        ${p.zodiac?`<span class="profile-mini-chip">${esc(p.zodiac)}</span>`:""}
      </div>
      <div class="member-metrics">
        <div class="metric"><strong>${joined.length}</strong><small>PROJECTS</small></div>
        <div class="metric"><strong>${assigned.length-complete}</strong><small>OPEN</small></div>
        <div class="metric"><strong>${complete}</strong><small>DONE</small></div>
      </div>
      <button class="ghost-btn member-profile-btn open-profile" data-id="${m.id}">View Profile</button>
    </article>`;
  }).join("");

  content.innerHTML=`<div class="section"><div class="section-head"><div><h2>Members</h2><p>${state.members.length} member · profile có thể được chỉnh sửa bởi mọi member trong workspace.</p></div></div><div class="member-grid">${cards}</div></div>`;
  document.querySelectorAll(".open-profile").forEach(btn=>btn.addEventListener("click",()=>openMemberProfile(btn.dataset.id)));
}

function profileBars(items,color){
  if(!items?.length) return `<div class="profile-empty">Chưa có dữ liệu.</div>`;
  return `<div class="profile-bars">${items.map(item=>{
    const value=Math.max(0,Math.min(100,Number(item.value)||0));
    return `<div class="profile-bar-row" style="--profile-color:${esc(color)}"><div class="profile-bar-name">${esc(item.name||"-")}</div><div class="profile-bar-track"><div class="profile-bar-fill" style="width:${value}%"></div></div><div class="profile-bar-value">${value}%</div></div>`;
  }).join("")}</div>`;
}

function profileList(items){
  if(!items?.length) return `<div class="profile-empty">Chưa có dữ liệu.</div>`;
  return `<ul class="profile-list">${items.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`;
}

function openMemberProfile(memberId){
  const m=memberById(memberId); if(!m)return;
  $("profileModalTitle").textContent=`${profileFor(memberId).stageName || m.name}`;
  renderProfileView(memberId);
  $("profileForm").classList.add("hidden");
  $("profileView").classList.remove("hidden");
  $("memberProfileModal").classList.remove("hidden");
}

function renderProfileView(memberId){
  const m=memberById(memberId); const p=profileFor(memberId); if(!m)return;
  $("profileView").innerHTML=`
    <div class="profile-hero" style="--profile-color:${esc(p.color)}">
      <div class="profile-hero-icon">${esc(p.emoji || initials(m.name))}</div>
      <div class="profile-hero-copy">
        <h2>${esc(p.stageName || m.name)}</h2>
        <div class="real-name">${esc(m.name)}${m.isOwner?" · OWNER":""}</div>
        <div class="profile-meta-row">
          ${p.mbti?`<span class="profile-meta-chip">MBTI · ${esc(p.mbti)}</span>`:""}
          ${p.zodiac?`<span class="profile-meta-chip">ZODIAC · ${esc(p.zodiac)}</span>`:""}
          <span class="profile-meta-chip">COLOR · ${esc(p.color)}</span>
          ${p.emoji?`<span class="profile-meta-chip">ICON · ${esc(p.emoji)}</span>`:""}
        </div>
      </div>
      <div class="profile-view-actions"><button class="primary-btn" id="editProfileBtn">Edit Profile</button></div>
    </div>
    <div class="profile-sections">
      <section class="profile-section">
        <h3>Basic Information</h3>
        <div class="profile-info-grid">
          <div class="profile-info-item"><small>STAGE NAME</small><b>${esc(p.stageName||"—")}</b></div>
          <div class="profile-info-item"><small>BIRTH DATE</small><b>${esc(p.birthDate?formatDate(p.birthDate):"—")}</b></div>
        </div>
        <div style="margin-top:11px">${profileList(p.roles)}</div>
      </section>
      <section class="profile-section">
        <h3>Pre-debut Songs</h3>${profileList(p.preDebutSongs)}
      </section>
      <section class="profile-section full">
        <h3>Stats</h3>${profileBars(p.stats,p.color)}
      </section>
      <section class="profile-section full">
        <h3>Languages</h3>${profileBars(p.languages,p.color)}
      </section>
      <section class="profile-section full">
        <h3>Facts</h3>${profileList(p.facts)}
      </section>
    </div>`;
  $("editProfileBtn").addEventListener("click",()=>startProfileEdit(memberId));
}

function startProfileEdit(memberId){
  const m=memberById(memberId); const p=profileFor(memberId); if(!m)return;
  $("profileView").classList.add("hidden"); $("profileForm").classList.remove("hidden");
  $("profileMemberSlug").value=memberId; $("profileEditingName").textContent=m.name;
  $("profileStageName").value=p.stageName; $("profileBirthDate").value=p.birthDate;
  $("profileMbti").value=p.mbti; $("profileZodiac").value=p.zodiac;
  $("profileColor").value=p.color; $("profileColorPicker").value=/^#[0-9a-fA-F]{6}$/.test(p.color)?p.color:"#B0D9FA";
  $("profileEmoji").value=p.emoji; $("profileEmojiPreview").textContent=p.emoji||"★"; $("profileEmojiPreview").style.background=p.color;
  $("profileRoles").value=p.roles.join("\n"); $("profilePreDebut").value=p.preDebutSongs.join("\n"); $("profileFacts").value=p.facts.join("\n");
  $("statsEditor").innerHTML=""; p.stats.forEach(x=>addBarEditorRow("statsEditor",x));
  $("languagesEditor").innerHTML=""; p.languages.forEach(x=>addBarEditorRow("languagesEditor",x));
}

function addBarEditorRow(containerId,item={name:"",value:0}){
  const row=document.createElement("div"); row.className="bar-editor-row";
  const val=Math.max(0,Math.min(100,Number(item.value)||0));
  row.innerHTML=`<input class="bar-name" placeholder="Tên" value="${esc(item.name||"")}"><input class="bar-range" type="range" min="0" max="100" value="${val}"><input class="bar-value" type="number" min="0" max="100" value="${val}"><button type="button">×</button>`;
  const range=row.querySelector(".bar-range"), number=row.querySelector(".bar-value");
  range.addEventListener("input",()=>number.value=range.value); number.addEventListener("input",()=>{number.value=Math.max(0,Math.min(100,Number(number.value)||0));range.value=number.value});
  row.querySelector("button").addEventListener("click",()=>row.remove()); $(containerId).appendChild(row);
}

function collectBarRows(containerId){
  return [...$(containerId).querySelectorAll(".bar-editor-row")].map(row=>({name:row.querySelector(".bar-name").value.trim(),value:Math.max(0,Math.min(100,Number(row.querySelector(".bar-value").value)||0))})).filter(x=>x.name);
}

function lines(id){return $(id).value.split("\n").map(x=>x.trim()).filter(Boolean)}

function renderProjectTest(){
  const tests=[...state.tests].sort((a,b)=>new Date(a.deadline)-new Date(b.deadline));
  content.innerHTML=`
    <div class="section">
      <div class="section-head">
        <div><h2>Project Test</h2><p>Khu riêng để test member mới trước khi thêm vào roster chính.</p></div>
        <button class="primary-btn" id="newTestBtn">＋ New Candidate</button>
      </div>
      ${tests.length?`<div class="test-grid">${tests.map(testCard).join("")}</div>`:emptyInline("Chưa có candidate","Thêm member mới vào Project Test khi cần.")}
    </div>`;

  $("newTestBtn").addEventListener("click",()=>openTestModal());
  document.querySelectorAll(".edit-test").forEach(btn=>btn.addEventListener("click",()=>openTestModal(btn.dataset.id)));
  document.querySelectorAll(".test-pass").forEach(btn=>btn.addEventListener("click",()=>setTestStatus(btn.dataset.id,"passed")));
  document.querySelectorAll(".test-extend").forEach(btn=>btn.addEventListener("click",()=>extendCandidate(btn.dataset.id)));
  document.querySelectorAll(".test-fail").forEach(btn=>btn.addEventListener("click",()=>setTestStatus(btn.dataset.id,"not_passed")));
}

function testCard(t){
  const colors={testing:"#c5b7ff",passed:"#6de2ad",not_passed:"#ff6b76"};
  const labels={testing:"IN TEST",passed:"PASSED",not_passed:"NOT PASS"};
  return `<article class="test-card">
    <div class="topline"><span class="tag test">PROJECT TEST</span><button class="card-menu edit-test" data-id="${t.id}">•••</button></div>
    <div class="test-status" style="margin-top:14px"><span class="status-dot" style="background:${colors[t.status]||colors.testing}"></span>${labels[t.status]||"IN TEST"}</div>
    <h3>${esc(t.name)}</h3>
    <div class="test-meta">Deadline · ${esc(formatDate(t.deadline))}</div>
    <div class="avatar-row">${memberAvatars(t.reviewerIds||[])}</div>
    ${(t.bandlab||t.original)?`<div class="link-row">
      ${t.bandlab?`<a class="link-chip" href="${esc(t.bandlab)}" target="_blank" rel="noopener">Submission ↗</a>`:""}
      ${t.original?`<a class="link-chip" href="${esc(t.original)}" target="_blank" rel="noopener">Original ↗</a>`:""}
    </div>`:""}
    <div class="test-actions">
      ${t.status==="testing"?`
        <button class="pass test-pass" data-id="${t.id}">PASS</button>
        <button class="test-extend" data-id="${t.id}">EXTEND TEST</button>
        <button class="fail test-fail" data-id="${t.id}">NOT PASS</button>`:""}
    </div>
  </article>`;
}

function renderCalendar(){
  const [year,month]=state.calendarCursor.split("-").map(Number);
  const first=new Date(year,month-1,1);
  const start=new Date(first);
  start.setDate(first.getDate()-((first.getDay()+6)%7));
  const days=[];
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);days.push(d)}
  const monthName=new Intl.DateTimeFormat("vi-VN",{month:"long",year:"numeric"}).format(first);
  const week=["T2","T3","T4","T5","T6","T7","CN"];

  content.innerHTML=`
    <div class="section">
      <div class="calendar-toolbar">
        <div><h3>${esc(monthName)}</h3><p style="margin:4px 0 0;color:var(--muted);font-size:11px">Deadline project tự xuất hiện trên lịch.</p></div>
        <div class="calendar-actions"><button id="prevMonth">‹</button><button id="nextMonth">›</button></div>
      </div>
      <div class="calendar">
        ${week.map(w=>`<div class="day-name">${w}</div>`).join("")}
        ${days.map(d=>{
          const inMonth=d.getMonth()===(month-1);
          const dayProjects=state.projects.filter(p=>{
            const pd=new Date(p.deadline);
            return pd.getFullYear()===d.getFullYear()&&pd.getMonth()===d.getMonth()&&pd.getDate()===d.getDate();
          });
          return `<div class="day ${inMonth?"":"muted"}"><div class="day-number">${d.getDate()}</div>${dayProjects.map(p=>`<div class="cal-event" title="${esc(p.name)}">${esc(p.name)}</div>`).join("")}</div>`;
        }).join("")}
      </div>
    </div>`;
  $("prevMonth").addEventListener("click",()=>shiftMonth(-1));
  $("nextMonth").addEventListener("click",()=>shiftMonth(1));
}

function shiftMonth(delta){
  const [y,m]=state.calendarCursor.split("-").map(Number);
  const d=new Date(y,m-1+delta,1);
  state.calendarCursor=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  renderCalendar();
}

function renderSearch(){
  const q=searchQuery.toLowerCase();
  const projects=state.projects.filter(p=>p.name.toLowerCase().includes(q)||p.type.toLowerCase().includes(q)||p.tasks.some(t=>t.title.toLowerCase().includes(q)));
  const tests=state.tests.filter(t=>t.name.toLowerCase().includes(q));

  content.innerHTML=`
    <div class="section">
      <div class="section-head"><div><h2>Search</h2><p>Kết quả cho “${esc(searchQuery)}”</p></div></div>
      ${projects.length?`<h3 style="font-size:13px">Projects</h3><div class="project-grid">${projects.map(projectCard).join("")}</div>`:""}
      ${tests.length?`<h3 style="font-size:13px;margin-top:22px">Project Test</h3><div class="test-grid">${tests.map(testCard).join("")}</div>`:""}
      ${!projects.length&&!tests.length?`<div class="search-empty">Không tìm thấy kết quả.</div>`:""}
    </div>`;
  bindCommon();
  document.querySelectorAll(".edit-test").forEach(btn=>btn.addEventListener("click",()=>openTestModal(btn.dataset.id)));
}

function bindCommon(){
  document.querySelectorAll(".edit-project").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();openProjectModal(btn.dataset.id)}));
  document.querySelectorAll(".task-check").forEach(btn=>btn.addEventListener("click",()=>toggleTask(btn.dataset.projectId,btn.dataset.taskId)));
  document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.go)));
}

async function toggleTask(projectId,taskId){
  const p=state.projects.find(x=>x.id===projectId);
  const t=p?.tasks.find(x=>x.id===taskId);
  if(!t)return;
  const nextTasks=p.tasks.map(x=>x.id===taskId?{...x,done:!x.done}:x);
  const {error}=await sb.from("team_projects").update({tasks:nextTasks}).eq("id",projectId);
  if(error){toast(error.message,true);return}
  await activity(`${!t.done?"hoàn thành":"mở lại"} task “${t.title}” trong ${p.name}`);
}

function fillMemberChecks(containerId,selectedIds=[],namePrefix="member"){
  const el=$(containerId);
  el.innerHTML=state.members.map(m=>`
    <label class="member-check">
      <input type="checkbox" name="${namePrefix}" value="${m.id}" ${selectedIds.includes(m.id)?"checked":""}>
      <span style="background:${m.color}"></span><b>${esc(m.name)}</b>
    </label>`).join("");
}

function updateFormationPreview(){
  const selected=[...document.querySelectorAll('input[name="projectMember"]:checked')].map(x=>x.value);
  const info=formationInfo(selected);
  const badge=$("formationPreview");
  badge.textContent=info.formation;
  badge.className=`formation-badge ${info.formation.toLowerCase()}`;
  $("formationHint").textContent=info.hint;
}

function addTaskEditorRow(task={title:"",assigneeId:currentMember?.id||"",done:false}){
  const row=document.createElement("div");
  row.className="task-row";
  row.dataset.taskId=task.id||uid();
  row.dataset.done=task.done?"1":"0";
  row.innerHTML=`
    <input class="task-title-input" placeholder="Tên task..." value="${esc(task.title)}">
    <select class="task-assignee-input">
      <option value="">Unassigned</option>
      ${state.members.map(m=>`<option value="${m.id}" ${task.assigneeId===m.id?"selected":""}>${esc(m.name)}</option>`).join("")}
    </select>
    <button type="button" class="remove-task-row">×</button>`;
  row.querySelector(".remove-task-row").addEventListener("click",()=>row.remove());
  $("taskRows").appendChild(row);
}

function openProjectModal(id=null){
  const p=id?state.projects.find(x=>x.id===id):null;
  $("projectModalTitle").textContent=p?"Edit Project":"New Project";
  $("projectId").value=p?.id||"";
  $("projectName").value=p?.name||"";
  $("projectType").value=p?.type||"COVER";
  $("projectDeadline").value=p?toLocalInput(p.deadline):nextDateTimeLocal(7,20,0);
  $("projectPriority").value=p?.priority||"normal";
  $("projectBandlab").value=p?.links?.bandlab||"";
  $("projectOriginal").value=p?.links?.original||"";
  $("projectDrive").value=p?.links?.drive||"";
  $("projectOtherLink").value=p?.links?.other||"";
  $("projectNotes").value=p?.notes||"";

  fillMemberChecks("projectMembers",p?.memberIds||[currentMember.id],"projectMember");
  document.querySelectorAll('input[name="projectMember"]').forEach(x=>x.addEventListener("change",updateFormationPreview));

  $("taskRows").innerHTML="";
  (p?.tasks?.length?p.tasks:[
    {title:"Chia line",assigneeId:currentMember.id,done:false},
    {title:"Thu vocal",assigneeId:"",done:false},
    {title:"Mix",assigneeId:"",done:false},
    {title:"Review final",assigneeId:"",done:false}
  ]).forEach(addTaskEditorRow);

  $("deleteProjectBtn").classList.toggle("hidden",!p);
  updateFormationPreview();
  $("projectModal").classList.remove("hidden");
}

function toLocalInput(value){
  const d=new Date(value);
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

$("projectForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=$("projectId").value;
  const memberIds=[...document.querySelectorAll('input[name="projectMember"]:checked')].map(x=>x.value);
  const tasks=[...document.querySelectorAll("#taskRows .task-row")].map(row=>({
    id:row.dataset.taskId||uid(),
    title:row.querySelector(".task-title-input").value.trim(),
    assigneeId:row.querySelector(".task-assignee-input").value,
    done:row.dataset.done==="1"
  })).filter(t=>t.title);

  const payload={
    name:$("projectName").value.trim(),
    project_type:$("projectType").value,
    song_formation:formationFor(memberIds),
    deadline:new Date($("projectDeadline").value).toISOString(),
    priority:$("projectPriority").value,
    member_slugs:memberIds,
    links:{
      bandlab:$("projectBandlab").value.trim(),
      original:$("projectOriginal").value.trim(),
      drive:$("projectDrive").value.trim(),
      other:$("projectOtherLink").value.trim()
    },
    tasks,
    notes:$("projectNotes").value.trim()
  };

  const btn=$("saveProjectBtn");
  btn.disabled=true;

  let result;
  if(id){
    result=await sb.from("team_projects").update(payload).eq("id",id);
  }else{
    payload.created_by=currentUser.id;
    result=await sb.from("team_projects").insert(payload);
  }

  btn.disabled=false;
  if(result.error){toast(result.error.message,true);return}

  await activity(`${id?"cập nhật":"tạo"} project “${payload.name}” · ${payload.song_formation}`);
  closeModal("projectModal");
  toast("Project saved");
});

$("deleteProjectBtn").addEventListener("click",async()=>{
  const id=$("projectId").value;
  const p=state.projects.find(x=>x.id===id);
  if(!p)return;
  if(!confirm(`Xóa project “${p.name}”?`))return;
  const {error}=await sb.from("team_projects").delete().eq("id",id);
  if(error){toast(error.message,true);return}
  await activity(`xóa project “${p.name}”`);
  closeModal("projectModal");
  toast("Project deleted");
});

$("addTaskRowBtn").addEventListener("click",()=>addTaskEditorRow());

function openTestModal(id=null){
  const t=id?state.tests.find(x=>x.id===id):null;
  $("testModalTitle").textContent=t?"Edit Candidate Test":"New Candidate Test";
  $("testId").value=t?.id||"";
  $("testName").value=t?.name||"";
  $("testDeadline").value=t?.deadline||nextDateOnly(7);
  $("testBandlab").value=t?.bandlab||"";
  $("testOriginal").value=t?.original||"";
  $("testTasks").value=(t?.tasks||["Vocal test","Harmony test","Communication / teamwork"]).join("\n");
  $("testNotes").value=t?.notes||"";
  fillMemberChecks("testReviewers",t?.reviewerIds||[currentMember.id],"testReviewer");
  $("deleteTestBtn").classList.toggle("hidden",!t);
  $("testModal").classList.remove("hidden");
}

$("testForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=$("testId").value;
  const old=id?state.tests.find(t=>t.id===id):null;
  const payload={
    candidate_name:$("testName").value.trim(),
    deadline:$("testDeadline").value,
    reviewer_slugs:[...document.querySelectorAll('input[name="testReviewer"]:checked')].map(x=>x.value),
    bandlab_url:$("testBandlab").value.trim(),
    original_url:$("testOriginal").value.trim(),
    test_tasks:$("testTasks").value.split("\n").map(x=>x.trim()).filter(Boolean),
    notes:$("testNotes").value.trim(),
    status:old?.status||"testing"
  };

  const btn=$("saveTestBtn");
  btn.disabled=true;

  let result;
  if(id){
    result=await sb.from("team_project_tests").update(payload).eq("id",id);
  }else{
    payload.created_by=currentUser.id;
    result=await sb.from("team_project_tests").insert(payload);
  }

  btn.disabled=false;
  if(result.error){toast(result.error.message,true);return}

  await activity(`${id?"cập nhật":"thêm"} Project Test của ${payload.candidate_name}`);
  closeModal("testModal");
  toast("Candidate test saved");
});

$("deleteTestBtn").addEventListener("click",async()=>{
  const id=$("testId").value;
  const t=state.tests.find(x=>x.id===id);
  if(!t)return;
  if(!confirm(`Xóa Project Test của ${t.name}?`))return;
  const {error}=await sb.from("team_project_tests").delete().eq("id",id);
  if(error){toast(error.message,true);return}
  await activity(`xóa Project Test của ${t.name}`);
  closeModal("testModal");
  toast("Test deleted");
});

async function setTestStatus(id,status){
  const t=state.tests.find(x=>x.id===id);
  if(!t)return;
  const {error}=await sb.from("team_project_tests").update({status}).eq("id",id);
  if(error){toast(error.message,true);return}
  await activity(`${t.name} được đánh dấu ${status==="passed"?"PASS":"NOT PASS"}`);
}

async function extendCandidate(id){
  const t=state.tests.find(x=>x.id===id);
  if(!t)return;
  const d=new Date(t.deadline+"T00:00:00");
  d.setDate(d.getDate()+7);
  const deadline=d.toISOString().slice(0,10);
  const {error}=await sb.from("team_project_tests").update({deadline}).eq("id",id);
  if(error){toast(error.message,true);return}
  await activity(`gia hạn Project Test của ${t.name} thêm 7 ngày`);
}


$("addStatBtn").addEventListener("click",()=>addBarEditorRow("statsEditor",{name:"",value:0}));
$("addLanguageBtn").addEventListener("click",()=>addBarEditorRow("languagesEditor",{name:"",value:0}));
$("profileColorPicker").addEventListener("input",()=>{
  $("profileColor").value=$("profileColorPicker").value.toUpperCase();
  $("profileEmojiPreview").style.background=$("profileColorPicker").value;
});
$("profileColor").addEventListener("input",()=>{
  const v=$("profileColor").value.trim();
  if(/^#[0-9a-fA-F]{6}$/.test(v)){
    $("profileColorPicker").value=v;
    $("profileEmojiPreview").style.background=v;
  }
});
$("profileEmoji").addEventListener("input",()=>$("profileEmojiPreview").textContent=$("profileEmoji").value.trim()||"★");
$("cancelProfileEditBtn").addEventListener("click",()=>{
  const id=$("profileMemberSlug").value; $("profileForm").classList.add("hidden"); $("profileView").classList.remove("hidden"); renderProfileView(id);
});
$("profileForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const memberId=$("profileMemberSlug").value; const m=memberById(memberId); if(!m)return;
  let color=$("profileColor").value.trim().toUpperCase();
  if(!/^#[0-9A-F]{6}$/.test(color)){toast("Color phải có dạng #RRGGBB",true);return}
  const payload={
    member_slug:memberId,
    stage_name:$("profileStageName").value.trim(),
    birth_date:$("profileBirthDate").value||null,
    roles:lines("profileRoles"),
    mbti:$("profileMbti").value.trim(),
    zodiac:$("profileZodiac").value.trim(),
    profile_color:color,
    emoji:$("profileEmoji").value.trim(),
    pre_debut_songs:lines("profilePreDebut"),
    stats:collectBarRows("statsEditor"),
    languages:collectBarRows("languagesEditor"),
    facts:lines("profileFacts")
  };
  const btn=$("saveProfileBtn"); btn.disabled=true;
  const {error}=await sb.from("team_member_profiles").upsert(payload,{onConflict:"member_slug"});
  btn.disabled=false; if(error){toast(error.message,true);return}
  await activity(`cập nhật profile của ${m.name}`);
  await refreshProfiles();
  $("profileForm").classList.add("hidden"); $("profileView").classList.remove("hidden"); renderProfileView(memberId); toast("Profile saved");
});

function closeModal(id){$(id).classList.add("hidden")}

document.querySelectorAll(".close-modal").forEach(btn=>btn.addEventListener("click",()=>closeModal(btn.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(bg=>bg.addEventListener("click",e=>{if(e.target===bg)bg.classList.add("hidden")}));
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));

$("quickAddBtn").addEventListener("click",()=>openProjectModal());
$("globalSearch").addEventListener("input",e=>{searchQuery=e.target.value.trim();render()});
$("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));

function toast(message,isError=false){
  const el=document.createElement("div");
  el.className=`toast${isError?" error":""}`;
  el.textContent=message;
  $("toastWrap").appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

boot();
