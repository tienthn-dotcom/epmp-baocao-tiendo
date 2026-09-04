/**
 * DỜI thư mục dự án CŨ nằm NGOÀI Media về ĐÚNG chỗ:  ePMP/<Dự án>/…  →  ePMP/Media/<Dự án>/…
 * (Chỉ còn Media là cây chuẩn cho mọi dữ liệu công trường — khớp driveArchiveImages + can-media.functions.)
 *  · "Hình ảnh" cấp dự án → dời NGUYÊN FILE vào Media/<Dự án>/Hình ảnh (giữ id → link cũ vẫn sống).
 *  · Thư mục RỖNG còn sót (vd Video/B1..B5 sau khi clip đã dời) → trash.
 *  · Thư mục có file mà không rõ chỗ → GIỮ + cảnh báo, xử tay.
 *   node scripts/media-fold-legacy.mjs        (DRY) | --go (làm thật)
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env","utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2];}
const GO=process.argv.includes("--go");
const ROOT="1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO", S="supportsAllDrives=true&includeItemsFromAllDrives=true", F="application/vnd.google-apps.folder";
const KEEP=new Set(["Media","Nhật ký giám sát","Báo cáo tuân thủ","Ghi chú"]);   // thư mục hệ thống, KHÔNG đụng
const b=new URLSearchParams({client_id:process.env.GDRIVE_OAUTH_CLIENT_ID,client_secret:process.env.GDRIVE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GDRIVE_OAUTH_REFRESH,grant_type:"refresh_token"});
const tj=await(await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b})).json();
const H={Authorization:`Bearer ${tj.access_token}`};
const ls=async p=>((await(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${p}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=1000&${S}`,{headers:H})).json()).files||[]);
const fc=async(p,n)=>(await ls(p)).find(f=>f.name===n&&f.mimeType===F);
const mkdir=async(p,n)=>{const e=await fc(p,n); if(e) return e.id; if(!GO){console.log("      (sẽ tạo folder",n+")"); return "(dry)";}
  return (await(await fetch(`https://www.googleapis.com/drive/v3/files?${S}&fields=id`,{method:"POST",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({name:n,mimeType:F,parents:[p]})})).json()).id;};
const move=async(id,from,to)=>{ if(!GO) return; await fetch(`https://www.googleapis.com/drive/v3/files/${id}?addParents=${to}&removeParents=${from}&${S}&fields=id`,{method:"PATCH",headers:H}); };
const trash=async id=>{ if(!GO) return; await fetch(`https://www.googleapis.com/drive/v3/files/${id}?${S}`,{method:"PATCH",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({trashed:true})}); };
const hasFile=async id=>{ for(const k of await ls(id)){ if(k.mimeType!==F) return true; if(await hasFile(k.id)) return true; } return false; };

let ep=ROOT; for(const s of["DATABASE","ePMP"]) ep=(await fc(ep,s)).id;
const media=(await fc(ep,"Media")).id;
console.log(GO?"=== DỜI THẬT ===":"=== DRY (thêm --go để làm thật) ===");
let moved=0, trashed=0;
for(const proj of await ls(ep)){
  if(proj.mimeType!==F || KEEP.has(proj.name)) continue;
  console.log(`\nDự án ngoài Media: "${proj.name}"`);
  const dest=await mkdir(media, proj.name);
  for(const kind of await ls(proj.id)){
    if(kind.mimeType!==F){ console.log("   [FILE lạc]",kind.name,"→ dời thẳng vào Media/<dự án>"); await move(kind.id,proj.id,dest); moved++; continue; }
    if(kind.name==="Hình ảnh"||kind.name==="Video"){
      // Dời hết FILE sang Media/<dự án>/<Hình ảnh|Video> rồi bỏ vỏ cũ (kể cả các folder con rỗng B1..B5).
      const dk=await mkdir(dest, kind.name);
      const files=[]; const walk=async id=>{ for(const f of await ls(id)){ if(f.mimeType===F) await walk(f.id); else files.push({f,p:id}); } };
      await walk(kind.id);
      console.log(`   dời ${files.length} file "${kind.name}" → Media/${proj.name}/${kind.name}`);
      for(const x of files){ await move(x.f.id, x.p, dk); moved++; }
      console.log(`   trash vỏ cũ "${kind.name}"`); await trash(kind.id); trashed++;
      continue;
    }
    if(!(await hasFile(kind.id))){ console.log(`   trash "${kind.name}" (rỗng)`); await trash(kind.id); trashed++; continue; }
    console.log(`   ⚠ GIỮ "${kind.name}" (còn file, không rõ chỗ) — xử tay`);
  }
  // Cấp DỰ ÁN luôn có ĐỦ 2 thư mục — đúng chuẩn ePMP/Media/<Dự án>/(Hình ảnh | Video).
  for(const k of ["Hình ảnh","Video"]) await mkdir(dest, k);
  if(!(await hasFile(proj.id))){ console.log(`   trash vỏ "${proj.name}" (đã rỗng)`); await trash(proj.id); trashed++; }
}
console.log(`\nDời ${moved} file · trash ${trashed} thư mục rỗng.`);
console.log(GO?"✅ Xong.":"→ thêm --go để làm thật.");
