// ==UserScript==
// @name         ChatGPT Universal Exporter Enhanced (Fixed)
// @description  Robust ZIP exporter with JSON/Markdown/HTML, safer intercept, full-thread export, and retries.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// @license      MIT
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // --- 配置与全局变量 Config & globals ---
    const BASE_DELAY = 600;
    const JITTER = 400;
    const PAGE_LIMIT = 100;
    let accessToken = null;
    let capturedWorkspaceIds = new Set();

    // 导出格式配置 Export formats
    let exportFormats = { json: true, markdown: true, html: true };

    // --- 网络拦截与信息捕获 Network intercept (minimal & safe) ---
    (function interceptNetwork() {
        const rawFetch = window.fetch;
        function isSameOriginResource(res) {
            try {
                const url = typeof res === 'string' ? new URL(res, location.href) : new URL(res.url, location.href);
                return url.origin === location.origin;
            } catch (_) { return true; }
        }
        function getHeaderValueFromAny(hLike, name) {
            if (!hLike) return null;
            try {
                if (hLike instanceof Headers) return hLike.get(name) || hLike.get(name.toLowerCase());
                if (Array.isArray(hLike)) {
                    const found = hLike.find(p => Array.isArray(p) && (String(p[0]).toLowerCase() === name.toLowerCase()));
                    return found ? found[1] : null;
                }
                if (typeof hLike === 'object') return hLike[name] || hLike[name.toLowerCase()] || null;
                if (typeof hLike === 'string' && name.toLowerCase() === 'authorization') return hLike;
            } catch (_) {}
            return null;
        }
        window.fetch = function(resource, options) {
            try {
                if (isSameOriginResource(resource)) {
                    const headerCandidates = [];
                    if (resource && typeof Request !== 'undefined' && resource instanceof Request) {
                        headerCandidates.push(resource.headers);
                    }
                    if (options && options.headers) {
                        headerCandidates.push(options.headers);
                    }
                    for (const hc of headerCandidates) {
                        tryCaptureToken(getHeaderValueFromAny(hc, 'Authorization'));
                        const wid = getHeaderValueFromAny(hc, 'ChatGPT-Account-Id');
                        if (wid && !capturedWorkspaceIds.has(wid)) {
                            capturedWorkspaceIds.add(wid);
                            try { console.log('🎯 [Fetch] 捕获 Workspace ID:', wid); } catch(_){}
                        }
                    }
                }
            } catch (_) {}
            return rawFetch.apply(this, arguments);
        };

        const rawOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function () {
            this.addEventListener('readystatechange', () => {
                if (this.readyState === 4) {
                    try {
                        const auth = this.getRequestHeader && this.getRequestHeader('Authorization');
                        tryCaptureToken(auth);
                        const id = this.getRequestHeader && this.getRequestHeader('ChatGPT-Account-Id');
                        if (id && !capturedWorkspaceIds.has(id)) {
                            capturedWorkspaceIds.add(id);
                            try { console.log('🎯 [XHR] 捕获 Workspace ID:', id); } catch(_){}
                        }
                    } catch (_) {}
                }
            });
            return rawOpen.apply(this, arguments);
        };
    })();

    function tryCaptureToken(headerLike) {
        let h = null;
        try {
            if (!headerLike) { h = null; }
            else if (typeof headerLike === 'string') { h = headerLike; }
            else if (headerLike instanceof Headers) { h = headerLike.get('Authorization') || headerLike.get('authorization'); }
            else if (Array.isArray(headerLike)) {
                const found = headerLike.find(e => Array.isArray(e) && String(e[0]).toLowerCase() === 'authorization');
                h = found ? found[1] : null;
            } else if (typeof headerLike === 'object') {
                h = headerLike.Authorization || headerLike.authorization || null;
            }
        } catch (_) {}
        if (h && /^Bearer\s+(.+)/i.test(h)) {
            const token = h.replace(/^Bearer\s+/i, '');
            if (token && token.toLowerCase() !== 'dummy') {
                accessToken = token;
            }
        }
    }

    async function ensureAccessToken() {
        if (accessToken) return accessToken;
        try {
            const session = await (await fetch('/api/auth/session?unstable_client=true')).json();
            if (session.accessToken) {
                accessToken = session.accessToken;
                return accessToken;
            }
        } catch (_) {}
        alert('无法获取 Access Token。请刷新页面或打开任意一个对话后再试。');
        return null;
    }

    // --- 辅助函数 Helpers ---
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const jitter = () => BASE_DELAY + Math.random() * JITTER;
    const sanitizeFilename = (name) => name.replace(/[\/\\?%*:|"<>]/g, '-').trim();

    function getOaiDeviceId() {
        const cookieString = document.cookie;
        const match = cookieString.match(/oai-did=([^;]+)/);
        return match ? match[1] : null;
    }

    async function fetchWithRetry(input, init = {}, retries = 3) {
        let attempt = 0;
        while (true) {
            try {
                const res = await fetch(input, init);
                if (res.ok) return res;
                if (attempt < retries && (res.status === 429 || res.status >= 500)) {
                    await sleep(BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER);
                    attempt++;
                    continue;
                }
                return res;
            } catch (err) {
                if (attempt < retries) {
                    await sleep(BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER);
                    attempt++;
                    continue;
                }
                throw err;
            }
        }
    }

    function buildHeaders(workspaceId) {
        const headers = { 'Authorization': `Bearer ${accessToken}` };
        const did = getOaiDeviceId();
        if (did) headers['oai-device-id'] = did;
        if (workspaceId) headers['ChatGPT-Account-Id'] = workspaceId;
        return headers;
    }

    function generateUniqueFilename(convData, extension = 'json') {
        const convId = String(convData.conversation_id || '').trim();
        const idPart = convId || Math.random().toString(36).slice(2, 10);
        const ts = convData.create_time ? new Date(convData.create_time * 1000) : new Date();
        const tsPart = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
        let baseName = convData.title;
        if (!baseName || baseName.trim().toLowerCase() === 'new chat') {
            baseName = 'Untitled Conversation';
        }
        return `${sanitizeFilename(baseName)}_${idPart}_${tsPart}.${extension}`;
    }

    function downloadFile(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    // --- Conversation parsing (full mapping sorted by time) ---
    function parseConversation(convData) {
        const mapping = convData.mapping || {};
        const msgs = [];
        for (const key in mapping) {
            const node = mapping[key];
            const message = node && node.message;
            if (!message || !message.content || !message.content.parts) continue;
            const role = message.author && message.author.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const content = message.content.parts.join('\n');
            if (!content || !content.trim()) continue;
            msgs.push({
                role,
                content,
                createTime: message.create_time,
                model: (message.metadata && message.metadata.model_slug) || ''
            });
        }
        msgs.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
        return {
            title: convData.title || 'Untitled Conversation',
            createTime: convData.create_time,
            updateTime: convData.update_time,
            conversationId: convData.conversation_id,
            model: convData.default_model_slug || '',
            messages: msgs
        };
    }

    // --- Markdown 转换函数 Markdown converter ---
    function convertToMarkdown(convData) {
        const parsed = parseConversation(convData);
        let md = '';
        md += `# ${parsed.title}\n\n`;
        md += `**Conversation ID:** \`${parsed.conversationId}\`\n\n`;
        if (parsed.model) md += `**Model:** ${parsed.model}\n\n`;
        if (parsed.createTime) md += `**Created:** ${new Date(parsed.createTime * 1000).toLocaleString()}\n\n`;
        if (parsed.updateTime) md += `**Last Updated:** ${new Date(parsed.updateTime * 1000).toLocaleString()}\n\n`;
        md += `---\n\n`;
        parsed.messages.forEach((msg, index) => {
            const roleLabel = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
            const timestamp = msg.createTime ? ` (${new Date(msg.createTime * 1000).toLocaleString()})` : '';
            md += `## ${roleLabel}${timestamp}\n\n`;
            md += `${msg.content}\n\n`;
            if (index < parsed.messages.length - 1) md += `---\n\n`;
        });
        return md;
    }

    // --- HTML 转换函数 HTML converter (code-block safe) ---
    function convertToHTML(convData) {
        const parsed = parseConversation(convData);
        const escapeHtml = (text) => { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; };
        const renderContent = (content) => {
            let html = escapeHtml(content);
            const blocks = [];
            html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                const idx = blocks.length;
                const blockHtml = `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
                blocks.push(blockHtml);
                return `[[[CODE_BLOCK_${idx}]]]`;
            });
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
            html = html.replace(/\n/g, '<br>');
            html = html.replace(/\[\[\[CODE_BLOCK_(\d+)]]]/g, (_, i) => blocks[Number(i)]);
            return html;
        };

        let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(parsed.title)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6; color: #333; background: #f5f5f5; padding: 20px;
        }
        .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 30px; }
        .header h1 { font-size: 28px; margin-bottom: 15px; }
        .metadata { font-size: 14px; opacity: 0.95; }
        .metadata-item { margin: 5px 0; }
        .conversation { padding: 20px; }
        .message { margin-bottom: 25px; padding: 20px; border-radius: 8px; position: relative; }
        .message.user { background: #e3f2fd; border-left: 4px solid #2196f3; }
        .message.assistant { background: #f3e5f5; border-left: 4px solid #9c27b0; }
        .message-header { display: flex; align-items: center; margin-bottom: 12px; font-weight: 600; font-size: 16px; }
        .message.user .message-header { color: #1976d2; }
        .message.assistant .message-header { color: #7b1fa2; }
        .role-icon { font-size: 20px; margin-right: 8px; }
        .timestamp { font-size: 12px; color: #666; margin-left: auto; font-weight: normal; }
        .message-content { font-size: 15px; line-height: 1.7; }
        pre { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 6px; overflow-x: auto; margin: 10px 0; }
        code { font-family: "Consolas", "Monaco", "Courier New", monospace; font-size: 14px; }
        .message-content > code { background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 3px; font-size: 13px; }
        a { color: #1976d2; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .footer { text-align: center; padding: 20px; color: #999; font-size: 13px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${escapeHtml(parsed.title)}</h1>
            <div class="metadata">
                <div class="metadata-item"><strong>Conversation ID:</strong> ${escapeHtml(parsed.conversationId)}</div>
                ${parsed.model ? `<div class="metadata-item"><strong>Model:</strong> ${escapeHtml(parsed.model)}</div>` : ''}
                ${parsed.createTime ? `<div class="metadata-item"><strong>Created:</strong> ${new Date(parsed.createTime * 1000).toLocaleString()}</div>` : ''}
                ${parsed.updateTime ? `<div class="metadata-item"><strong>Last Updated:</strong> ${new Date(parsed.updateTime * 1000).toLocaleString()}</div>` : ''}
            </div>
        </div>
        <div class="conversation">`;

        parsed.messages.forEach((msg) => {
            const roleClass = msg.role;
            const roleIcon = msg.role === 'user' ? '👤' : '🤖';
            const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
            const timestamp = msg.createTime ? new Date(msg.createTime * 1000).toLocaleString() : '';
            html += `
            <div class="message ${roleClass}">
                <div class="message-header">
                    <span class="role-icon">${roleIcon}</span>
                    <span>${roleLabel}</span>
                    ${timestamp ? `<span class="timestamp">${timestamp}</span>` : ''}
                </div>
                <div class="message-content">
                    ${renderContent(msg.content)}
                </div>
            </div>`;
        });

        html += `
        </div>
        <div class="footer">Exported by ChatGPT Universal Exporter Enhanced v8.3.1</div>
    </div>
</body>
</html>`;
        return html;
    }

    // --- 导出流程 Export process ---
    async function startExportProcess(mode, workspaceId, formats) {
        const btn = document.getElementById('gpt-rescue-btn');
        btn.disabled = true;
        if (!await ensureAccessToken()) { btn.disabled = false; btn.textContent = 'Export Conversations'; return; }
        try {
            const zip = new JSZip();
            btn.textContent = '📂 获取项目外对话…';
            const orphanIds = await collectIds(btn, workspaceId, null);
            for (let i = 0; i < orphanIds.length; i++) {
                btn.textContent = `📥 根目录 (${i + 1}/${orphanIds.length})`;
                const convData = await getConversation(orphanIds[i], workspaceId);
                if (formats.json) zip.file(generateUniqueFilename(convData, 'json'), JSON.stringify(convData, null, 2));
                if (formats.markdown) zip.file(generateUniqueFilename(convData, 'md'), convertToMarkdown(convData));
                if (formats.html) zip.file(generateUniqueFilename(convData, 'html'), convertToHTML(convData));
                await sleep(jitter());
            }
            btn.textContent = '🔍 获取项目列表…';
            const projects = await getProjects(workspaceId);
            for (const project of projects) {
                const projectFolder = zip.folder(sanitizeFilename(project.title));
                btn.textContent = `📂 项目: ${project.title}`;
                const projectConvIds = await collectIds(btn, workspaceId, project.id);
                if (projectConvIds.length === 0) continue;
                for (let i = 0; i < projectConvIds.length; i++) {
                    btn.textContent = `📥 ${project.title.substring(0,10)}... (${i + 1}/${projectConvIds.length})`;
                    const convData = await getConversation(projectConvIds[i], workspaceId);
                    if (formats.json) projectFolder.file(generateUniqueFilename(convData, 'json'), JSON.stringify(convData, null, 2));
                    if (formats.markdown) projectFolder.file(generateUniqueFilename(convData, 'md'), convertToMarkdown(convData));
                    if (formats.html) projectFolder.file(generateUniqueFilename(convData, 'html'), convertToHTML(convData));
                    await sleep(jitter());
                }
            }
            btn.textContent = '📦 生成 ZIP 文件…';
            const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
            const date = new Date().toISOString().slice(0, 10);
            const filename = mode === 'team' ? `chatgpt_team_backup_${workspaceId}_${date}.zip` : `chatgpt_personal_backup_${date}.zip`;
            downloadFile(blob, filename);
            alert(`✅ 导出完成！`);
            btn.textContent = '✅ 完成';
        } catch (e) {
            console.error("导出过程中发生严重错误", e);
            alert(`导出失败: ${e.message}。详情请查看控制台（F12 -> Console）。`);
            btn.textContent = '⚠️ Error';
        } finally {
            setTimeout(() => { btn.disabled = false; btn.textContent = 'Export Conversations'; }, 3000);
        }
    }

    // --- API 调用函数 API helpers ---
    async function getProjects(workspaceId) {
        if (!workspaceId) return [];
        const r = await fetchWithRetry(`/backend-api/gizmos/snorlax/sidebar`, { headers: buildHeaders(workspaceId) });
        if (!r.ok) { console.warn(`获取项目(Gizmo)列表失败 (${r.status})`); return []; }
        const data = await r.json();
        const projects = [];
        data.items?.forEach(item => { if (item?.gizmo?.id && item?.gizmo?.display?.name) { projects.push({ id: item.gizmo.id, title: item.gizmo.display.name }); } });
        return projects;
    }

    async function collectIds(btn, workspaceId, gizmoId) {
        const all = new Set();
        const headers = buildHeaders(workspaceId);
        if (gizmoId) {
            let cursor = '0';
            do {
                const r = await fetchWithRetry(`/backend-api/gizmos/${gizmoId}/conversations?cursor=${cursor}`, { headers });
                if (!r.ok) throw new Error(`列举项目对话列表失败 (${r.status})`);
                const j = await r.json();
                j.items?.forEach(it => all.add(it.id));
                cursor = j.cursor;
                await sleep(jitter());
            } while (cursor);
        } else {
            for (const is_archived of [false, true]) {
                let offset = 0, has_more = true, page = 0;
                do {
                    btn.textContent = `📂 项目外对话 (${is_archived ? 'Archived' : 'Active'} p${++page})`;
                    const r = await fetchWithRetry(`/backend-api/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated${is_archived ? '&is_archived=true' : ''}`, { headers });
                    if (!r.ok) throw new Error(`列举项目外对话列表失败 (${r.status})`);
                    const j = await r.json();
                    if (j.items && j.items.length > 0) {
                        j.items.forEach(it => all.add(it.id));
                        has_more = j.items.length === PAGE_LIMIT;
                        offset += j.items.length;
                    } else { has_more = false; }
                    await sleep(jitter());
                } while (has_more);
            }
        }
        return Array.from(all);
    }

    async function getConversation(id, workspaceId) {
        const headers = buildHeaders(workspaceId);
        const r = await fetchWithRetry(`/backend-api/conversation/${id}`, { headers });
        if (!r.ok) throw new Error(`获取对话详情失败 conv ${id} (${r.status})`);
        const j = await r.json();
        j.__fetched_at = new Date().toISOString();
        return j;
    }

    // --- 工作空间自动检测 Workspace detection ---
    function detectAllWorkspaceIds() {
        const foundIds = new Set(capturedWorkspaceIds);
        try {
            const data = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
            const accounts = data?.props?.pageProps?.user?.accounts;
            if (accounts) { Object.values(accounts).forEach(acc => { if (acc?.account?.id) foundIds.add(acc.account.id); }); }
        } catch (e) {}
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (key.includes('account') || key.includes('workspace')) {
                    const value = localStorage.getItem(key);
                    if (!value) continue;
                    if (/^ws-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.replace(/"/g, ''))) {
                        foundIds.add(value.replace(/"/g, ''));
                    } else if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.replace(/"/g, ''))) {
                        foundIds.add(value.replace(/"/g, ''));
                    }
                }
            }
        } catch(e) {}
        try { console.log('🔍 检测到以下 Workspace IDs:', Array.from(foundIds)); } catch(_){}
        return Array.from(foundIds);
    }

    // --- 对话框UI函数 Simple export dialog ---
    function showExportDialog() {
        if (document.getElementById('export-dialog-overlay')) return;
        const overlay = document.createElement('div'); overlay.id = 'export-dialog-overlay';
        Object.assign(overlay.style, { position:'fixed', top:'0', left:'0', width:'100%', height:'100%', background:'rgba(0,0,0,0.45)', zIndex:'99998', display:'flex', alignItems:'center', justifyContent:'center' });
        const dialog = document.createElement('div');
        Object.assign(dialog.style, { background:'#fff', borderRadius:'10px', padding:'18px', width:'460px', boxShadow:'0 6px 24px rgba(0,0,0,.2)', fontFamily:'sans-serif', color:'#333' });
        dialog.innerHTML = `
            <h2 style="margin:0 0 12px 0;font-size:18px;">导出会话</h2>
            <div style="margin-bottom:10px;">
                <label><input type="checkbox" id="fmt-json" checked> JSON</label>
                <label style="margin-left:10px;"><input type="checkbox" id="fmt-md" checked> Markdown</label>
                <label style="margin-left:10px;"><input type="checkbox" id="fmt-html" checked> HTML</label>
            </div>
            <div style="margin:10px 0;">
                <label><input type="radio" name="mode" value="personal" checked> 个人空间</label>
                <label style="margin-left:12px;"><input type="radio" name="mode" value="team"> 团队空间</label>
            </div>
            <div id="team-area" style="display:none;">
                <div style="font-size:12px;color:#555;margin-bottom:6px;">自动检测到的 Workspace IDs（如有）：</div>
                <div id="detected"></div>
                <input type="text" id="team-id" placeholder="或在此粘贴 Team Workspace ID (ws-...)" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
            </div>
            <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:10px;">
                <button id="dlg-cancel" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">取消</button>
                <button id="dlg-start" style="padding:8px 12px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer;font-weight:bold;">开始导出</button>
            </div>
        `;
        overlay.appendChild(dialog); document.body.appendChild(overlay);
        const radioPersonal = dialog.querySelector('input[name="mode"][value="personal"]');
        const radioTeam = dialog.querySelector('input[name="mode"][value="team"]');
        const teamArea = dialog.querySelector('#team-area');
        const detectedDiv = dialog.querySelector('#detected');
        radioTeam.addEventListener('change', () => teamArea.style.display = 'block');
        radioPersonal.addEventListener('change', () => teamArea.style.display = 'none');
        const ids = detectAllWorkspaceIds();
        if (ids.length) { detectedDiv.textContent = ids.join(' , '); }
        dialog.querySelector('#dlg-cancel').onclick = () => document.body.removeChild(overlay);
        dialog.querySelector('#dlg-start').onclick = async () => {
            const formats = { json: dialog.querySelector('#fmt-json').checked, markdown: dialog.querySelector('#fmt-md').checked, html: dialog.querySelector('#fmt-html').checked };
            if (!formats.json && !formats.markdown && !formats.html) { alert('请至少选择一种导出格式！'); return; }
            const mode = radioTeam.checked ? 'team' : 'personal';
            let workspaceId = null;
            if (mode === 'team') {
                const manual = dialog.querySelector('#team-id').value.trim();
                workspaceId = manual || ids[0] || '';
                if (!workspaceId) { alert('请选择或输入一个有效的 Team Workspace ID！'); return; }
            }
            document.body.removeChild(overlay);
            exportFormats.mode = mode; exportFormats.workspaceId = workspaceId;
            startExportProcess(mode, workspaceId, formats);
        };
        overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
    }

    function addBtn() {
        if (document.getElementById('gpt-rescue-btn')) return;
        const b = document.createElement('button'); b.id = 'gpt-rescue-btn'; b.textContent = 'Export Conversations';
        Object.assign(b.style, { position:'fixed', bottom:'24px', right:'24px', zIndex:'99997', padding:'10px 14px', borderRadius:'8px', border:'none', cursor:'pointer', fontWeight:'bold', background:'#10a37f', color:'#fff', fontSize:'14px', boxShadow:'0 3px 12px rgba(0,0,0,.15)', userSelect:'none' });
        b.onclick = showExportDialog; document.body.appendChild(b);
    }

    setTimeout(addBtn, 2000);
})();
