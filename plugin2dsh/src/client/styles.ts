export const CSS = `
.dip{--dip-accent:#b27942;--dip-line:color-mix(in srgb,currentColor 14%,transparent);--dip-wash:color-mix(in srgb,currentColor 4%,transparent);color:inherit;font:inherit;min-height:100%;padding:24px 28px;box-sizing:border-box}
.dip *{box-sizing:border-box}
.dip-header{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:8px 0 24px;border-bottom:1px solid var(--dip-line)}
.dip h1{font-size:29px;letter-spacing:-.8px;margin:10px 0}
.dip h2{font-size:14px}
.dip h3{font-size:15px;margin:0}
.dip p{line-height:1.7}
.dip-header p,.dip-muted{opacity:.58;font-size:12px;margin:6px 0}
.dip-eyebrow{font-size:10px;letter-spacing:1.8px;opacity:.65}
.dip-status{font-size:12px;display:flex;align-items:center;gap:8px}
.dip-dot{width:7px;height:7px;border-radius:100%;background:#75977b}
.dip-offline{background:#bc744f}
.dip-toolbar,.dip-editor-bar,.dip-project-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0}
.dip-editor-bar,.dip-project-bar{justify-content:space-between}
.dip-project-bar{padding-bottom:16px;border-bottom:1px solid var(--dip-line);margin-top:0}
.dip-project-bar small{display:block;margin-top:5px;opacity:.5}
.dip button,.dip-file{font:inherit;font-size:12px;cursor:pointer;background:transparent;color:inherit;border:1px solid var(--dip-line);border-radius:6px;padding:7px 11px;line-height:1.4}
.dip button:hover,.dip-file:hover{background:var(--dip-wash)}
.dip button:disabled{opacity:.4;cursor:default}
.dip .dip-primary{background:var(--dip-accent);color:white;border-color:var(--dip-accent)}
.dip input:not([type=checkbox]),.dip textarea,.dip select{width:100%;font:inherit;font-size:13px;line-height:1.65;color:inherit;background:transparent;border:1px solid var(--dip-line);border-radius:6px;padding:10px;outline-offset:3px}
.dip input:focus,.dip textarea:focus{outline:1px solid var(--dip-accent)}
.dip textarea{min-height:110px;resize:vertical}
.dip label:not(.dip-file):not(.dip-inline){display:grid;gap:8px;font-size:12px;margin:18px 0}
.dip .dip-inline{display:flex;align-items:center;gap:7px;font-size:12px}
.dip-file{display:inline-block;position:relative;overflow:hidden}
.dip-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
.dip-new{display:flex;gap:8px;max-width:550px;margin-bottom:16px}
.dip-new button{white-space:nowrap}
.dip-new-item{display:grid;gap:6px;margin:12px 0}
.dip-workspace{display:grid;grid-template-columns:210px minmax(0,1fr);gap:28px;margin-top:20px}
.dip-nav{border-right:1px solid var(--dip-line);padding-right:18px;min-width:0}
.dip-nav h2{font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:.5;margin:18px 0 10px}
.dip-nav>button{display:block;width:100%;text-align:left;border:0;margin-bottom:4px;overflow-wrap:anywhere}
.dip-nav button small{display:block;opacity:.5;font-size:10px;margin-top:5px}
.dip-nav .dip-nav-active{background:color-mix(in srgb,var(--dip-accent) 12%,transparent);color:var(--dip-accent)}
.dip hr{border:0;border-top:1px solid var(--dip-line);margin:18px 0}
.dip-main{min-width:0;padding-bottom:30px}
.dip-empty{padding:80px 20px;text-align:center}
.dip-empty span{font-size:20px}
.dip-empty p{font-size:13px;opacity:.5}
.dip .dip-manuscript{min-height:430px;font-size:15px;line-height:1.95;padding:20px}
.dip-stats{font-size:11px;opacity:.5;text-align:right;margin:10px 0 20px}
.dip-notice,.dip-error{font-size:12px;padding:10px 14px;border-radius:5px;margin:10px 0;overflow-wrap:anywhere}
.dip-notice{background:color-mix(in srgb,#75977b 12%,transparent)}
.dip-error,.dip-conflict{background:color-mix(in srgb,#c96a58 10%,transparent);padding:14px}
.dip-agent{margin-top:30px;border-top:1px solid var(--dip-line);padding-top:18px;font-size:12px}
.dip-agent summary,.dip-card summary{cursor:pointer}
.dip-agent textarea{margin:10px 0;font-size:11px}
.dip-agent small{display:block;opacity:.5;margin-top:12px;overflow-wrap:anywhere}
.dip-card{border:1px solid var(--dip-line);padding:16px;border-radius:8px;margin:16px 0}
.dip-card small{display:block;opacity:.55;font-size:10px;margin:10px 0;overflow-wrap:anywhere}
.dip-diff{font-size:12px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--dip-line);padding:12px;max-height:450px;overflow:auto}
.dip-diff-line{display:block;white-space:pre-wrap}
.dip-add{background:color-mix(in srgb,#68a77c 20%,transparent)}
.dip-remove{background:color-mix(in srgb,#ce7666 20%,transparent)}
.dip-preview{min-height:430px;line-height:1.9;overflow-wrap:anywhere;padding:20px;border:1px solid var(--dip-line);border-radius:6px}
.dip-preview pre{white-space:pre-wrap;background:var(--dip-wash);padding:12px}
.dip-preview a{color:var(--dip-accent)}
.dip-preview h1{font-size:25px}
.dip-preview h2{font-size:21px}
.dip-preview h3{font-size:18px}
@media(max-width:760px){.dip{padding:16px}
.dip-workspace{grid-template-columns:155px minmax(0,1fr);gap:15px}
.dip-status{display:none}
.dip h1{font-size:24px}
.dip-nav{padding-right:10px}}
@media(max-width:520px){.dip-workspace{grid-template-columns:1fr}
.dip-nav{border-right:0;border-bottom:1px solid var(--dip-line);max-height:220px;overflow:auto}}
`
