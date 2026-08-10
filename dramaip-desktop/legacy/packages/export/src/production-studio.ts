import type {
  EditorTimelineClip,
  EditorTimelineManifest,
  ReviewPackageManifest,
} from '@sdns/core'

export interface EditorExportWarning {
  code: 'missing_media' | 'edl_flattened' | 'edl_still_slate' | 'transition_degraded' | 'subtitle_sidecar'
  clipId?: string
  message: string
}

export interface EditorExportPreflight {
  canExport: boolean
  blockers: string[]
  warnings: EditorExportWarning[]
  totalDurationSeconds: number
}

export interface Cmx3600Export {
  content: string
  warnings: EditorExportWarning[]
}

export function validateReviewPackageManifest(manifest: ReviewPackageManifest): string[] {
  const issues: string[] = []
  if (manifest.format !== 'dramaip-review' || manifest.version !== 1) issues.push('不支持的审片包格式或版本')
  if (!manifest.packageId || !manifest.projectId || !manifest.adaptationProjectId || !manifest.episodeId) issues.push('审片包缺少生产范围标识')
  if (!manifest.title.trim() || manifest.title.length > 200) issues.push('审片包标题无效')
  const ids = new Set<string>()
  for (const item of manifest.media) {
    if (ids.has(item.id)) issues.push(`媒体 ID 重复：${item.id}`)
    ids.add(item.id)
    if (!item.shotId || !item.label.trim()) issues.push(`媒体 ${item.id} 缺少镜头或标签`)
    if (!isSafeRelativePath(item.relativePath)) issues.push(`媒体路径不安全：${item.relativePath}`)
    if (!/^(image|video|audio)\//.test(item.mimeType)) issues.push(`媒体类型不允许：${item.mimeType}`)
    if ((item.sizeBytes ?? 0) < 0 || (item.durationSeconds ?? 0) < 0) issues.push(`媒体 ${item.id} 的大小或时长无效`)
  }
  return issues
}

export function renderOfflineReviewHtml(manifest: ReviewPackageManifest): string {
  const issues = validateReviewPackageManifest(manifest)
  if (issues.length) throw new Error(issues.join('；'))
  const safeManifest = JSON.stringify(manifest).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(manifest.title)} · DramaIP 离线审片</title>
  <style>
    :root{color-scheme:dark;background:#101214;color:#eef0f2;font:15px/1.5 system-ui,sans-serif}body{margin:0}.shell{max-width:1120px;margin:auto;padding:24px}.muted{color:#9ca4ad}.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:18px}.card{border:1px solid #30363d;border-radius:12px;background:#171a1f;padding:14px}.shot{width:100%;text-align:left;border:1px solid #30363d;background:#20242a;color:inherit;padding:10px;border-radius:8px;margin:4px 0}.shot[aria-current=true]{border-color:#69a9ff}.viewer img,.viewer video{width:100%;max-height:68vh;object-fit:contain;background:#090a0b;border-radius:8px}input,textarea,select,button{font:inherit}input,textarea,select{box-sizing:border-box;width:100%;background:#0e1013;color:inherit;border:1px solid #3b424b;border-radius:7px;padding:8px}textarea{min-height:84px}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1}button{border:1px solid #4b5664;border-radius:7px;background:#26303b;color:inherit;padding:8px 12px;cursor:pointer}button.primary{background:#1e64bb}.comment{border-top:1px solid #30363d;padding:8px 0;white-space:pre-wrap}@media(max-width:780px){.grid{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body>
<main class="shell">
  <h1>${escapeHtml(manifest.title)}</h1>
  <p class="muted">离线审片包 · 不含小说原文、Prompt、API Key 或生产母版。意见仅保存在此浏览器，导出 JSON 后交回制作方。</p>
  <div class="grid">
    <section class="card viewer" aria-label="审片媒体"><div id="viewer"></div><div id="shotMeta" class="muted"></div></section>
    <aside>
      <section class="card"><h2>镜头</h2><div id="shots"></div></section>
      <section class="card"><h2>添加意见</h2><label>审片人<input id="author" maxlength="80" autocomplete="name"></label><label>时间码（秒）<input id="timecode" type="number" min="0" step=".01"></label><label>决定<select id="decision"><option value="note">仅评论</option><option value="approve">通过</option><option value="return">退回</option><option value="request_changes">要求修改</option></select></label><label>意见<textarea id="body" maxlength="4000"></textarea></label><button id="save" class="primary">保存意见</button><button id="download">导出 review JSON</button><div id="comments"></div></section>
    </aside>
  </div>
</main>
<script>
const manifest=${safeManifest};
const storageKey='dramaip-review:'+manifest.packageId;
let active=manifest.media[0]||null;
let comments=read();
function read(){try{const value=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(value)?value:[]}catch{return[]}}
function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function select(item){active=item;render()}
function render(){
  document.getElementById('shots').innerHTML=manifest.media.map((item,index)=>'<button class="shot" aria-current="'+(active&&item.id===active.id)+'" data-index="'+index+'">'+esc(item.label)+'</button>').join('');
  document.querySelectorAll('[data-index]').forEach(button=>button.onclick=()=>select(manifest.media[Number(button.dataset.index)]));
  const viewer=document.getElementById('viewer');
  if(!active)viewer.innerHTML='<p class="muted">没有可审媒体</p>';
  else if(active.mimeType.startsWith('video/'))viewer.innerHTML='<video controls preload="metadata" src="'+encodeURI(active.relativePath)+'"></video>';
  else if(active.mimeType.startsWith('audio/'))viewer.innerHTML='<audio controls src="'+encodeURI(active.relativePath)+'"></audio>';
  else viewer.innerHTML='<img src="'+encodeURI(active.relativePath)+'" alt="'+esc(active.label)+'">';
  document.getElementById('shotMeta').textContent=active?active.label+' · 镜头 '+active.shotId:'';
  document.getElementById('comments').innerHTML=comments.slice().reverse().map(item=>'<div class="comment"><b>'+esc(item.decision)+'</b> · '+esc(item.authorAlias||'匿名')+(item.timecodeSeconds===undefined?'':' · '+item.timecodeSeconds+'s')+'<br>'+esc(item.body||item.note||'')+'</div>').join('');
}
document.getElementById('save').onclick=()=>{
  if(!active)return;
  const body=document.getElementById('body').value.trim(),decision=document.getElementById('decision').value;
  if(!body&&decision==='note')return;
  comments.push({id:crypto.randomUUID(),packageId:manifest.packageId,shotId:active.shotId,timecodeSeconds:Number(document.getElementById('timecode').value)||undefined,authorAlias:document.getElementById('author').value.trim()||undefined,decision,body,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  localStorage.setItem(storageKey,JSON.stringify(comments));document.getElementById('body').value='';render();
};
document.getElementById('download').onclick=()=>{
  const payload={format:'dramaip-review-comments',version:1,packageId:manifest.packageId,exportedAt:new Date().toISOString(),comments};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='review-'+manifest.packageId+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
render();
</script>
</body>
</html>`
}

export function preflightEditorTimeline(manifest: EditorTimelineManifest): EditorExportPreflight {
  const blockers: string[] = []
  const warnings: EditorExportWarning[] = []
  if (manifest.format !== 'dramaip-editor-timeline' || manifest.version !== 1) blockers.push('不支持的时间线格式或版本')
  if (![24, 25, 30].includes(manifest.frameRate)) blockers.push('帧率必须为 24、25 或 30')
  if (manifest.width <= 0 || manifest.height <= 0) blockers.push('画面尺寸无效')
  if (!manifest.clips.length) blockers.push('时间线没有镜头')
  const ids = new Set<string>()
  for (const clip of manifest.clips) {
    if (ids.has(clip.id)) blockers.push(`镜头 ID 重复：${clip.id}`)
    ids.add(clip.id)
    if (clip.durationSeconds <= 0) blockers.push(`镜头 ${clip.name} 时长必须大于 0`)
    if (clip.sourceInSeconds < 0 || clip.sourceOutSeconds < clip.sourceInSeconds) blockers.push(`镜头 ${clip.name} 源时间范围无效`)
    if (!clip.sourcePath) warnings.push({ code: 'missing_media', clipId: clip.id, message: `${clip.name} 没有媒体路径，将以占位镜头输出。` })
    if (clip.transition && clip.transition !== 'cut') warnings.push({ code: 'transition_degraded', clipId: clip.id, message: `${clip.name} 的 ${clip.transition} 在 EDL 中会降级。` })
    if (clip.subtitle) warnings.push({ code: 'subtitle_sidecar', clipId: clip.id, message: `${clip.name} 的字幕通过 SRT sidecar 交付。` })
  }
  if (manifest.clips.some((clip) => clip.mediaKind === 'still')) {
    warnings.push({ code: 'edl_still_slate', message: 'EDL 无法可靠表达静帧时长；静帧镜头需生成 slate 代理后再 relink。' })
  }
  return {
    canExport: blockers.length === 0,
    blockers,
    warnings,
    totalDurationSeconds: manifest.clips.reduce((sum, clip) => Math.max(sum, clip.startSeconds + clip.durationSeconds), 0),
  }
}

export function renderFcpxml110(manifest: EditorTimelineManifest): string {
  const preflight = preflightEditorTimeline(manifest)
  if (!preflight.canExport) throw new Error(preflight.blockers.join('；'))
  const totalDuration = secondsToRational(preflight.totalDurationSeconds, manifest.frameRate)
  const resources = manifest.clips.map((clip, index) => {
    const id = `r${index + 2}`
    const src = clip.sourcePath ? toRelativeMediaUri(clip.sourcePath) : `media/slates/${safeFileName(clip.name)}.png`
    return `    <asset id="${id}" name="${escapeXml(clip.name)}" src="${escapeXml(src)}" start="0s" duration="${secondsToRational(Math.max(clip.sourceOutSeconds, clip.durationSeconds), manifest.frameRate)}" hasVideo="1" format="r1"/>`
  }).join('\n')
  const clips = manifest.clips.map((clip, index) => {
    const offset = secondsToRational(clip.startSeconds, manifest.frameRate)
    const duration = secondsToRational(clip.durationSeconds, manifest.frameRate)
    const start = secondsToRational(clip.sourceInSeconds, manifest.frameRate)
    const role = clip.dialogue ? 'dialogue' : clip.narration ? 'narration' : 'video'
    return `          <asset-clip name="${escapeXml(clip.name)}" ref="r${index + 2}" offset="${offset}" start="${start}" duration="${duration}" audioRole="${role}"/>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormatRateUndefined" frameDuration="1/${manifest.frameRate}s" width="${manifest.width}" height="${manifest.height}"/>
${resources}
  </resources>
  <library>
    <event name="${escapeXml(manifest.title)}">
      <project name="${escapeXml(manifest.title)}">
        <sequence format="r1" duration="${totalDuration}" tcStart="0s" tcFormat="NDF">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`
}

export function renderCmx3600Edl(manifest: EditorTimelineManifest): Cmx3600Export {
  const preflight = preflightEditorTimeline(manifest)
  if (!preflight.canExport) throw new Error(preflight.blockers.join('；'))
  const warnings = [
    ...preflight.warnings,
    { code: 'edl_flattened' as const, message: 'CMX 3600 仅输出扁平主视频轨；多轨音频、字幕和复杂转场通过 sidecar 与报告交付。' },
  ]
  const lines = [`TITLE: ${asciiLabel(manifest.title)}`, 'FCM: NON-DROP FRAME', '']
  manifest.clips.forEach((clip, index) => {
    const sourceIn = clip.mediaKind === 'still' ? 0 : clip.sourceInSeconds
    const sourceOut = clip.mediaKind === 'still' ? clip.durationSeconds : clip.sourceOutSeconds
    lines.push(
      `${String(index + 1).padStart(3, '0')}  ${reelName(clip)} V     C        ${toTimecode(sourceIn, manifest.frameRate)} ${toTimecode(sourceOut, manifest.frameRate)} ${toTimecode(clip.startSeconds, manifest.frameRate)} ${toTimecode(clip.startSeconds + clip.durationSeconds, manifest.frameRate)}`,
      `* FROM CLIP NAME: ${asciiLabel(clip.name)}`,
      clip.sourcePath ? `* SOURCE FILE: ${clip.sourcePath}` : `* SOURCE FILE MISSING: media/slates/${safeFileName(clip.name)}.mp4`,
      '',
    )
  })
  return { content: `${lines.join('\n')}\n`, warnings }
}

export function renderSrt(manifest: EditorTimelineManifest): string {
  return manifest.clips.flatMap((clip) => {
    const text = clip.subtitle?.trim() || clip.dialogue?.trim() || clip.narration?.trim()
    return text ? [{ clip, text }] : []
  }).map(({ clip, text }, index) => `${index + 1}\n${toSrtTime(clip.startSeconds)} --> ${toSrtTime(clip.startSeconds + clip.durationSeconds)}\n${text}\n`).join('\n')
}

export function renderEditorMediaCsv(manifest: EditorTimelineManifest): string {
  const header = ['clipId', 'shotId', 'name', 'mediaKind', 'sourcePath', 'timelineStart', 'duration', 'sourceIn', 'sourceOut']
  const rows = manifest.clips.map((clip) => [
    clip.id,
    clip.shotId,
    clip.name,
    clip.mediaKind,
    clip.sourcePath ?? '',
    clip.startSeconds,
    clip.durationSeconds,
    clip.sourceInSeconds,
    clip.sourceOutSeconds,
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes('\0') || value.includes('\\')) return false
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

function secondsToRational(seconds: number, frameRate: number): string {
  const frames = Math.max(0, Math.round(seconds * frameRate))
  return frames === 0 ? '0s' : `${frames}/${frameRate}s`
}

function toTimecode(seconds: number, frameRate: number): string {
  const totalFrames = Math.max(0, Math.round(seconds * frameRate))
  const frames = totalFrames % frameRate
  const totalSeconds = Math.floor(totalFrames / frameRate)
  const secs = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return [hours, minutes, secs, frames].map((value) => String(value).padStart(2, '0')).join(':')
}

function toSrtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const ms = milliseconds % 1000
  const totalSeconds = Math.floor(milliseconds / 1000)
  const secs = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function reelName(clip: EditorTimelineClip): string {
  return `S${clip.shotId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`.slice(0, 8).padEnd(8, '0')
}

function asciiLabel(value: string): string {
  const label = value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_').trim()
  return (label || 'DRAMAIP').slice(0, 120)
}

function safeFileName(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'clip'
}

function toRelativeMediaUri(value: string): string {
  const fileName = value.replace(/\\/g, '/').split('/').pop() || 'media'
  return `media/${encodeURIComponent(fileName)}`
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[char]!)
}
