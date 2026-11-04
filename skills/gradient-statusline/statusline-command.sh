#!/usr/bin/env bash
# Two-line truecolor status line for Claude Code: gradient usage bars, repo, branch, cost, model.

# --- config ---
# Segments: model context session weekly repo branch lines cost. Order = display order; omit to hide.
TOP="model context session weekly"
BOTTOM="repo branch lines cost"
L_MODEL="Model"
L_SESSION="5-hour"
L_WEEKLY="Week"
L_NO_BRANCH="no branch"
L_NA="n/a"
L_ULTRACODE="UltraCode"
# Weekday abbreviations Sunday..Saturday, shown before reset times that are not today.
DAYS="Sun Mon Tue Wed Thu Fri Sat"
# --- end config ---

input=$(cat)

IFS=$'\x1f' read -r repo_name project_dir ctx_pct session_pct weekly_pct cost added removed model effort session_reset weekly_reset ultracode <<<"$(echo "$input" | SL_DAYS="$DAYS" node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
const j=JSON.parse(d);
const s=v=>(v===undefined||v===null)?"":String(v);
const days=process.env.SL_DAYS.split(" ");
const reset=o=>{
 if(!o) return "";
 const v=o.resets_at??o.reset_at??o.resets_at_unix??o.reset_at_unix;
 if(v===undefined||v===null) return "";
 const t=typeof v==="number"?new Date(v<1e11?v*1000:v):new Date(v);
 if(isNaN(t)) return "";
 const p=n=>String(n).padStart(2,"0");
 const hm=p(t.getHours())+":"+p(t.getMinutes());
 return t.toDateString()===new Date().toDateString()?hm:days[t.getDay()]+" "+hm;
};
const out=[
 s(j.workspace&&j.workspace.repo&&j.workspace.repo.name),
 s(j.workspace&&j.workspace.project_dir)||s(j.cwd),
 s(j.context_window&&j.context_window.used_percentage)||"0",
 s(j.rate_limits&&j.rate_limits.five_hour&&j.rate_limits.five_hour.used_percentage),
 s(j.rate_limits&&j.rate_limits.seven_day&&j.rate_limits.seven_day.used_percentage),
 s(j.cost&&j.cost.total_cost_usd)||"0",
 s(j.cost&&j.cost.total_lines_added)||"0",
 s(j.cost&&j.cost.total_lines_removed)||"0",
 s(j.model&&j.model.display_name)||"Claude",
 (()=>{
  // effort-statusline-bridge (optional plugin) writes the level auto-effort-picker holds per session.
  const lvl=s(j.effort&&j.effort.level);
  try{
   const f=require("path").join(require("os").homedir(),".claude","mods-state","effort-statusline-bridge",s(j.session_id)+".json");
   const held=JSON.parse(require("fs").readFileSync(f,"utf8")).line.split(" ")[0];
   if(held&&held!==lvl) return held+" (auto)";
  }catch{}
  return lvl;
 })(),
 reset(j.rate_limits&&j.rate_limits.five_hour),
 reset(j.rate_limits&&j.rate_limits.seven_day),
 (()=>{
  // effort-statusline-bridge (optional plugin) also writes the ultracode session toggle (null while
  // unknown) and whether the running turn opted in by keyword; otherwise the "ultracode" setting as
  // Claude Code resolves it: local over project over user settings.
  const fs=require("fs"),path=require("path"),home=require("os").homedir();
  try{
   const f=path.join(home,".claude","mods-state","effort-statusline-bridge",s(j.session_id)+".json");
   const m=JSON.parse(fs.readFileSync(f,"utf8"));
   if(m.turn===true||m.session===true) return "1";
   if(m.session===false) return "";
  }catch{}
  const dir=s(j.workspace&&j.workspace.project_dir)||s(j.cwd);
  const files=[path.join(home,".claude","settings.json")];
  if(dir) files.push(path.join(dir,".claude","settings.json"),path.join(dir,".claude","settings.local.json"));
  let on=false;
  for(const f of files){
   try{const v=JSON.parse(fs.readFileSync(f,"utf8")).ultracode;if(typeof v==="boolean") on=v;}catch{}
  }
  return on?"1":"";
 })()
];
process.stdout.write(out.join("\x1f"));
});
')"
[ -z "$repo_name" ] && repo_name=$(basename "$project_dir")

branch=$(git -C "$project_dir" branch --show-current 2>/dev/null)

# gradient bar + percentage color + emoji, all in one awk pass
gradient() {
 awk -v pct="$1" '
function setcolor(p,   t,r1,g1,b1,r2,g2,b2) {
 if (p <= 50) { t = p/50; r1=0;g1=200;b1=80; r2=220;g2=200;b2=0 }
 else         { t = (p-50)/50; r1=220;g1=200;b1=0; r2=220;g2=40;b2=20 }
 R = int(r1 + (r2-r1)*t + 0.5)
 G = int(g1 + (g2-g1)*t + 0.5)
 B = int(b1 + (b2-b1)*t + 0.5)
}
BEGIN {
 n = 20
 filled = int((pct/100.0)*n + 0.5)
 if (filled > n) filled = n
 if (filled < 0) filled = 0
 bar = ""
 for (i = 0; i < n; i++) {
   if (i < filled) {
     p = (n > 1) ? (i/(n-1))*100 : 100
     setcolor(p)
     bar = bar sprintf("\033[38;2;%d;%d;%dm█", R, G, B)
   } else {
     bar = bar "\033[38;2;60;60;60m█"
   }
 }
 bar = bar "\033[0m"
 setcolor(pct)
 pcolor = sprintf("\033[38;2;%d;%d;%dm", R, G, B)
 if (pct < 20) emoji = "🟢"
 else if (pct < 70) emoji = "🟡"
 else if (pct < 90) emoji = "🟠"
 else emoji = "🚨"
 printf "%s\x1f%s\x1f%s", bar, pcolor, emoji
}'
}

RESET=$'\e[0m'
DIM=$'\e[38;2;120;120;120m'
YELLOW_BOLD=$'\e[1;38;2;255;215;0m'
CYAN_BOLD=$'\e[1;38;2;0;220;220m'
MAGENTA=$'\e[38;2;210;100;220m'
GREEN=$'\e[38;2;60;200;60m'
RED=$'\e[38;2;220;60;60m'
YELLOW=$'\e[38;2;255;210;40m'
ORANGE=$'\e[38;2;255;140;0m'
BLUE=$'\e[38;2;80;160;255m'
SEP=" ${DIM}|${RESET} "

seg_repo() { printf '%s' "${YELLOW_BOLD}📁 ${repo_name}${RESET}"; }
seg_branch() {
 if [ -n "$branch" ]; then printf '%s' "${CYAN_BOLD}🌿 (${branch})${RESET}"
 else printf '%s' "${DIM}🌿 (${L_NO_BRANCH})${RESET}"; fi
}
seg_lines() {
 awk -v a="$added" -v r="$removed" 'BEGIN{exit !(a>0 || r>0)}' &&
  printf '%s' "${GREEN}+${added}${RESET}${DIM}/${RESET}${RED}-${removed}${RESET}"
}
seg_cost() { printf '%s' "${YELLOW}💰 $(printf '$%.2f' "$cost")${RESET}"; }
# Colors each character of $1 in turn through a rainbow.
rainbow() {
 local c=(255,60,60 255,150,0 255,230,0 60,210,60 0,200,255 90,110,255 200,90,255) i out="" r g b
 # Count characters, not bytes, so a translated label with umlauts stays whole.
 local LC_ALL=C.UTF-8
 for ((i = 0; i < ${#1}; i++)); do
  IFS=, read -r r g b <<<"${c[i % ${#c[@]}]}"
  out+=$'\e[1;38;2;'"$r;$g;${b}m${1:i:1}"
 done
 printf '%s' "$out${RESET}"
}
seg_model() { printf '%s' "${MAGENTA}🤖 ${L_MODEL}: ${model}${effort:+ · 🧠 ${effort}}${RESET}${ultracode:+${MAGENTA} · ⚡ ${RESET}$(rainbow "$L_ULTRACODE")}"; }
seg_context() {
 local bar color emoji
 IFS=$'\x1f' read -r bar color emoji <<<"$(gradient "$ctx_pct")"
 printf '%s' "${MAGENTA}📊 ${RESET}${emoji} ${bar} ${color}$(printf '%.0f' "$ctx_pct")%${RESET}"
}
# usage <pct> <reset> <label> <label color>
usage() {
 [ -z "$1" ] && { printf '%s' "${4}${3}: ${L_NA}${RESET}"; return; }
 local bar color emoji
 IFS=$'\x1f' read -r bar color emoji <<<"$(gradient "$1")"
 printf '%s' "${4}${3}:${RESET} ${emoji} ${bar} ${color}$(printf '%.0f' "$1")%${RESET}${2:+ ${4}↻ ${2}${RESET}}"
}
seg_session() { usage "$session_pct" "$session_reset" "$L_SESSION" "$BLUE"; }
seg_weekly() { usage "$weekly_pct" "$weekly_reset" "$L_WEEKLY" "$ORANGE"; }

# Joins the named segments with SEP; skips empty segments and prints nothing for an empty row.
row() {
 local line="" s v
 for s in $1; do
  v=$(seg_"$s" 2>/dev/null)
  [ -z "$v" ] && continue
  [ -n "$line" ] && line+="$SEP"
  line+="$v"
 done
 [ -n "$line" ] && printf '%s\n' "$line"
}
row "$TOP"
row "$BOTTOM"
exit 0
