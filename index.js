import { getContext } from '../../../extensions.js';
import { getRequestHeaders } from '../../../../script.js';

const FAB_ID = 'cc-fab';
const MODAL_ID = 'cc-modal';
const FAB_POS_KEY = 'cc-fab-pos';
const FAB_HIDDEN_KEY = 'cc-fab-hidden';

let pendingFiles = [];
let convertedMessages = [];
let extractedNames = [];

jQuery(async () => {
    waitForBody();
});

function waitForBody() {
    if (document.body) {
        createFab();
        createSettingsPanel();
    } else {
        setTimeout(waitForBody, 200);
    }
}

/* ═══════════════ 悬浮球 ═══════════════ */

function createFab() {
    if (document.getElementById(FAB_ID)) return;

    const fab = document.createElement('div');
    fab.id = FAB_ID;
    fab.className = 'cc-fab';
    fab.title = '聊天记录转换器（拖动可移动位置）';
    fab.innerHTML = '<i class="fa-solid fa-file-import"></i><span class="cc-fab-badge">0</span>';
    document.body.appendChild(fab);

    if (localStorage.getItem(FAB_HIDDEN_KEY) === '1') fab.classList.add('cc-fab-hidden');

    const savedPos = localStorage.getItem(FAB_POS_KEY);
    if (savedPos) {
        try {
            const pos = JSON.parse(savedPos);
            const maxL = Math.max(0, window.innerWidth - 60);
            const maxT = Math.max(0, window.innerHeight - 60);
            fab.style.left = Math.min(Math.max(0, pos.left), maxL) + 'px';
            fab.style.top = Math.min(Math.max(0, pos.top), maxT) + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        } catch {}
    }

    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    let lastLeft = 0, lastTop = 0;

    const onPointerDown = e => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        isDragging = true;
        hasMoved = false;
        const rect = fab.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        origLeft = rect.left;
        origTop = rect.top;
        lastLeft = origLeft;
        lastTop = origTop;
        fab.style.transition = 'none';
        try { fab.setPointerCapture(e.pointerId); } catch {}
        fab.addEventListener('pointermove', onPointerMove);
        fab.addEventListener('pointerup', onPointerUp);
        fab.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = e => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
        let nl = origLeft + dx;
        let nt = origTop + dy;
        nl = Math.max(0, Math.min(window.innerWidth - 56, nl));
        nt = Math.max(0, Math.min(window.innerHeight - 56, nt));
        lastLeft = nl;
        lastTop = nt;
        fab.style.left = nl + 'px';
        fab.style.top = nt + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        fab.style.transition = '';
        fab.removeEventListener('pointermove', onPointerMove);
        fab.removeEventListener('pointerup', onPointerUp);
        fab.removeEventListener('pointercancel', onPointerUp);
        if (hasMoved) localStorage.setItem(FAB_POS_KEY, JSON.stringify({ left: lastLeft, top: lastTop }));
    };

    fab.addEventListener('pointerdown', onPointerDown);
    fab.addEventListener('click', () => {
        if (hasMoved) { hasMoved = false; return; }
        openModal();
    });
}

function updateBadge(count) {
    const fab = document.getElementById(FAB_ID);
    if (!fab) return;
    const badge = fab.querySelector('.cc-fab-badge');
    if (count > 0) {
        fab.classList.add('cc-fab-has-data');
        if (badge) badge.textContent = count > 99 ? '99+' : String(count);
    } else {
        fab.classList.remove('cc-fab-has-data');
    }
}

/* ═══════════════ 通用工具 ═══════════════ */

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nowIso() { return new Date().toISOString(); }

function isTimeLine(line) {
    const s = line.trim();
    const timeRegex = /^(?:星期[一二三四五六日]\s*[，,]?\s*)?\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?(?:\s*[，,]?\s*\d{1,2}:\d{2}(?::\d{2})?)?$/;
    return timeRegex.test(s);
}

/* ═══════════════ 智能提取名字 ═══════════════ */

function extractNamesFromText(text) {
    const lines = text.split(/\r?\n/);
    const counts = {};
    
    // 极其严格的黑名单，防止抓取状态栏和系统标签
    const excludes = new Set([
        '时间', '正文', '记忆区', '状态栏', '事少心情好', '地球不好混', 'IM', 'MESSAGES', 
        'Q&A', 'INTERVIEW', 'FORUM', 'ANONYMOUS', 'STM', 'LTM', 'PM', 'Core',
        '心情', '关系', '动作', '衣着', '备注', '标签', '当前', '系统', '旁白', 
        '好感', '欲望', '着装', '记忆存档', '短期记忆', '长期记忆', '事件',
        '人物', '对话', '指令', '设定', '背景', '环境', '状态', '地点', '情节',
        '正文', '视角', '翻译', '原文', '中文', '标签', '正文', '通知', '系统消息'
    ]);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 1. <[时间](名字)> 格式提取
        const mm = line.match(/^<\[(.*?)\]\((.*?)\)>\s*(.*)$/);
        if (mm) {
            let rawName = mm[2].trim().replace(/^\(|\)$/g, '');
            if (rawName && rawName.length <= 15 && !excludes.has(rawName)) {
                counts[rawName] = (counts[rawName] || 0) + 1;
            }
            continue;
        }

        // 2. 名字: 或 名字： 格式提取
        const m = line.match(/^([^：:\n]{1,15})[：:]\s*(.*)$/);
        if (m) {
            const possibleName = m[1].trim();
            
            // 排除章节（第七十八节）、括号包裹、数字开头、以及黑名单词汇
            const isChapter = /^第.*?[节章卷]/.test(possibleName);
            const isBadPattern = /^[\[\(（【]/.test(possibleName) || /^[0-9]/.test(possibleName);
            
            if (!isChapter && !isBadPattern && !excludes.has(possibleName)) {
                counts[possibleName] = (counts[possibleName] || 0) + 1;
            }
        }
    }

    // 过滤掉出现次数太少的，至少出现2次才能被认为是高频角色
    const sorted = Object.keys(counts)
        .filter(k => counts[k] >= 2)
        .sort((a, b) => counts[b] - counts[a]);
        
    return sorted;
}

/* ═══════════════ 清理核心 ═══════════════ */

function cleanText(text, mode, removeText, removeRules, keepRules) {
    if (!text) return text;
    let result = text;

    if (mode === 'auto') {
        result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
        result = result.replace(/<script[\s\S]*?<\/script>/gi, '');

        if (removeText) {
            result = result.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '');
            result = result.replace(/<comment\b[^>]*>[\s\S]*?<\/comment>/gi, '');
        }

        const placeholders = [];
        if (keepRules && keepRules.length > 0) {
            keepRules.forEach(rule => {
                if (!rule.start || !rule.end) return;
                const startEsc = escapeRegExp(rule.start);
                const endEsc = escapeRegExp(rule.end);
                const reg = new RegExp(`(${startEsc}[\\s\\S]*?${endEsc})`, 'gi');
                result = result.replace(reg, (match) => {
                    placeholders.push(match);
                    return `___PROTECTED_${placeholders.length - 1}___`;
                });
            });
        }

        result = result.replace(/<br\s*\/?>/gi, '\n');
        result = result.replace(/<\/p>/gi, '\n');
        result = result.replace(/<[^>]+>/g, '');

        placeholders.forEach((content, i) => {
            result = result.replace(`___PROTECTED_${i}___`, content);
        });

    } else if (mode === 'custom') {
        for (let rule of removeRules) {
            if (!rule.start || !rule.end) continue;
            const startEsc = escapeRegExp(rule.start);
            const endEsc = escapeRegExp(rule.end);
            
            if (removeText) {
                const reg = new RegExp(startEsc + '[\\s\\S]*?' + endEsc, 'gi');
                result = result.replace(reg, '');
            } else {
                const reg = new RegExp(startEsc + '|' + endEsc, 'gi');
                result = result.replace(reg, '');
            }
        }
    }

    result = result.replace(/\n{3,}/g, '\n\n').trim();
    return result;
}

/* ═══════════════ TXT 解析 ═══════════════ */

function parseTxt(text, opts) {
    const { detectMarkers, charName, userName, keepTime, roleMap } = opts;
    const lines = text.split(/\r?\n/);
    const messages = [];
    let currentSpeaker = null;
    let currentText = [];

    const cName = (charName || '').trim().toLowerCase();
    const uName = (userName || '').trim().toLowerCase();

    const flush = () => {
        if (!currentText.length) { currentSpeaker = null; return; }
        let body = currentText.join('\n').trim();
        currentText = [];
        if (!body) { currentSpeaker = null; return; }

        body = cleanText(body, opts.removeType, opts.removeText, opts.removeRules, opts.keepRules);
        if (!body) { currentSpeaker = null; return; }

        if (currentSpeaker === null) {
            const isUser = opts.otherMode === 'user';
            const isSystem = opts.otherMode === 'system';
            const isIgnore = opts.otherMode === 'ignore';
            if (!isIgnore) {
                messages.push({
                    name: isUser ? userName : (isSystem ? 'System' : charName),
                    is_user: isUser,
                    is_system: isSystem,
                    send_date: nowIso(),
                    mes: body,
                    extra: {}
                });
            }
        } else {
            const s = currentSpeaker.toLowerCase();
            let isUser = false;
            let isSystem = false;
            let finalName = currentSpeaker;

            // 查映射表
            const mappedRole = roleMap[s];
            if (mappedRole === 'user') {
                isUser = true;
                finalName = userName;
            } else if (mappedRole === 'system') {
                isSystem = true;
            } else if (mappedRole === 'char') {
                isUser = false;
                finalName = charName;
            } 
            // 内置后备
            else if (s === '系统' || s === '旁白' || s === 'system' || s === '时间') {
                isSystem = true;
            } else if (s === '我' || s === 'user' || (uName && s.includes(uName))) {
                isUser = true;
                finalName = userName;
            } else if (cName && s.includes(cName)) {
                isUser = false;
                finalName = charName;
            } else {
                // 未识别
                isUser = opts.otherMode === 'user';
                isSystem = opts.otherMode === 'system';
            }

            if (opts.otherMode !== 'ignore' || isUser || isSystem || finalName === charName) {
                messages.push({
                    name: isSystem ? finalName : (isUser ? userName : charName),
                    is_user: isUser,
                    is_system: isSystem,
                    send_date: nowIso(),
                    mes: body,
                    extra: {}
                });
            }
        }
        currentSpeaker = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();

        if (keepTime && isTimeLine(line)) {
            flush();
            messages.push({
                name: '时间',
                is_user: false,
                is_system: true,
                send_date: nowIso(),
                mes: `**${line}**`,
                extra: {}
            });
            continue;
        }

        if (!line) {
            if (currentText.length > 0) currentText.push(raw);
            continue;
        }
        
        if (/^-\s*"[^"]*"\s*拍了拍\s*"[^"]*"\s*-$/.test(line)) continue;

        // 严格强切格式1
        if (detectMarkers) {
            const mm = line.match(/^<\[(.*?)\]\((.*?)\)>\s*(.*)$/);
            if (mm) {
                flush();
                let rawName = mm[2].trim();
                if (rawName.startsWith('(') && rawName.endsWith(')')) {
                    rawName = rawName.substring(1, rawName.length - 1).trim();
                }
                currentSpeaker = rawName;
                if (mm[3].trim()) currentText.push(mm[3]);
                continue;
            }
        }

        // 严格强切格式2
        const m = line.match(/^([^：:\n]{1,30})[：:]\s*(.*)$/);
        if (m) {
            const possibleName = m[1].trim();
            const lowerPos = possibleName.toLowerCase();
            
            const isChapter = /^第.*?[节章卷]/.test(possibleName);
            const isExcluded = ['时间', '正文', '记忆区', '状态栏', '事少心情好', '地球不好混', 'IM', 'MESSAGES', 'Q&A', 'INTERVIEW', 'FORUM', 'ANONYMOUS', 'STM', 'LTM', 'PM', 'Core'].includes(possibleName);
            
            let isKnown = false;
            if (roleMap[lowerPos]) isKnown = true;
            if (cName && lowerPos.includes(cName)) isKnown = true;
            if ((uName && lowerPos.includes(uName)) || possibleName === '我') isKnown = true;
            if (possibleName === '系统' || possibleName === '旁白') isKnown = true;

            if (isKnown && !isChapter && !isExcluded) {
                flush();
                currentSpeaker = possibleName;
                if (m[2].trim() || m[2] === '') {
                    currentText.push(m[2]);
                }
                continue;
            }
        }

        currentText.push(raw);
    }
    flush();
    return messages;
}

/* ═══════════════ JSON 解析 ═══════════════ */

function parseJson(text, opts) {
    const { charName, userName } = opts;

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return parseTxt(text, opts);
    }

    let arr = null;
    if (Array.isArray(data)) arr = data;
    else if (Array.isArray(data.messages)) arr = data.messages;
    else if (Array.isArray(data.chat)) arr = data.chat;
    else if (Array.isArray(data.data)) arr = data.data;
    else if (Array.isArray(data.history)) arr = data.history;

    if (!arr) return parseTxt(text, opts);

    const messages = [];

    for (const item of arr) {
        if (typeof item === 'string') {
            messages.push(...parseTxt(item, opts));
            continue;
        }
        if (!item || typeof item !== 'object') continue;

        let textContent = item.mes ?? item.content ?? item.text ?? item.message;
        if (typeof textContent === 'string') {
            textContent = cleanText(textContent, opts.removeType, opts.removeText, opts.removeRules, opts.keepRules);
            if (!textContent) continue;
        }

        if (item.mes !== undefined && item.name !== undefined) {
            const isUser = item.is_user ?? (item.name === userName);
            let name = item.name;
            if (isUser) name = userName;
            else if (!item.is_system) name = charName;
            messages.push({
                name,
                is_user: !!isUser,
                is_system: !!item.is_system,
                send_date: item.send_date || nowIso(),
                mes: String(textContent),
                extra: item.extra || {}
            });
            continue;
        }

        if (item.role !== undefined && textContent !== undefined) {
            const isUser = item.role === 'user';
            const isSystem = item.role === 'system';
            messages.push({
                name: isUser ? userName : charName,
                is_user: isUser,
                is_system: isSystem,
                send_date: nowIso(),
                mes: String(textContent),
                extra: {}
            });
            continue;
        }

        const speaker = item.name ?? item.speaker ?? item.from ?? item.role;
        if (textContent !== undefined && speaker !== undefined) {
            const msg = makeMsg(String(speaker), String(textContent), opts);
            if (msg) messages.push(msg);
            continue;
        }
    }

    return messages;
}

/* ═══════════════ 弹窗 ═══════════════ */

function openModal() {
    if (jQuery('#' + MODAL_ID).length) {
        jQuery('#' + MODAL_ID).show();
        return;
    }

    const context = getContext();
    const character = context.characterId !== undefined
        ? context.characters?.[context.characterId]
        : null;
    const charName = character?.name || '';
    const userName = context.name1 || 'User';

    const html = `
    <div id="${MODAL_ID}" class="cc-modal-overlay">
        <div class="cc-modal">
            <div class="cc-modal-header">
                <span>📂 聊天记录转换器</span>
                <button id="cc-close" class="cc-close-btn">✕</button>
            </div>
            <div class="cc-modal-body">
                <div class="cc-section">
                    <label>1. 选择文件 (TXT/JSON)</label>
                    <div id="cc-drop-zone" class="cc-drop-zone">
                        <p>拖拽 .txt / .json 文件到这里，或</p>
                        <input type="file" id="cc-file-input" accept=".txt,.json,application/json,text/plain" multiple hidden>
                        <button id="cc-select-btn" class="menu_button">选择文件</button>
                        <ul id="cc-file-list" class="cc-file-list"></ul>
                    </div>
                    
                    <!-- 3000字预览区 -->
                    <div id="cc-preview-file-box" style="display:none; margin-top:10px;">
                        <div style="font-size:12px; color:#aaa; margin-bottom:4px; display:flex; justify-content:space-between;">
                            <span>文件前 3000 字预览：</span>
                            <span style="color:#7bb8ff;">请在此确认格式是否切分正确</span>
                        </div>
                        <textarea id="cc-file-text-preview" readonly style="width:100%; height:120px; background:rgba(0,0,0,0.3); color:#ccc; font-size:12px; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); resize:vertical; white-space:pre-wrap; font-family:monospace;"></textarea>
                    </div>

                    <!-- 高频提取标签区 -->
                    <div id="cc-detected-box" style="display:none; margin-top:10px; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span style="font-size:12px; color:#aaa;">提取到的高频发言者（点击标签即可复制）：</span>
                        </div>
                        <div id="cc-detected-tags" style="display:flex; flex-wrap:wrap; gap:6px;"></div>
                    </div>
                </div>

                <div class="cc-section">
                    <label>2. 角色配置</label>
                    <div class="cc-config">
                        <div class="cc-form-row">
                            <label>聊天名称：</label>
                            <input type="text" id="cc-chat-name" placeholder="导入后显示的记录名（留空则自动生成）">
                        </div>
                        <div class="cc-form-row">
                            <label>角色名字：</label>
                            <input type="text" id="cc-char-name" value="${escapeHtml(charName)}" placeholder="你要导入到哪张卡里？">
                        </div>
                        <div class="cc-form-row">
                            <label>你的名字：</label>
                            <input type="text" id="cc-user-name" value="${escapeHtml(userName)}" placeholder="必须与TXT里的用户名一致">
                        </div>
                        <div class="cc-form-row">
                            <label>未识别文本：</label>
                            <select id="cc-other-speaker" class="text_pole">
                                <option value="system" selected>作为系统消息（旁白）</option>
                                <option value="char">作为角色输出</option>
                                <option value="user">作为用户输出</option>
                                <option value="ignore">忽略（直接丢弃）</option>
                            </select>
                        </div>
                        <div class="cc-form-row" style="align-items:flex-start;">
                            <label style="margin-top:8px;">角色映射表：</label>
                            <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                                <div id="cc-role-map-container" style="display:flex; flex-direction:column; gap:6px;"></div>
                                <div style="display:flex; gap:8px;">
                                    <button id="cc-add-role-map" class="menu_button" style="font-size:12px !important;">+ 添加映射</button>
                                    <button id="cc-auto-detect-roles" class="menu_button" style="font-size:12px !important; color:#7bb8ff;">🔍 自动填充高频角色到映射</button>
                                </div>
                                <div style="font-size:12px; color:#888;">支持填 <code>&lt;CHAR&gt;</code> 代表角色，填 <code>&lt;USER&gt;</code> 代表你。冒号不用写！</div>
                            </div>
                        </div>
                        <div class="cc-form-row">
                            <label>去除状态栏：</label>
                            <div style="display:flex; flex-direction:column; gap:8px; flex:1; min-width:0;">
                                <select id="cc-remove-type" class="text_pole">
                                    <option value="none">不处理（保留原样，可能会导致楼层错误）</option>
                                    <option value="auto" selected>自动清理代码（保留文字）</option>
                                    <option value="custom">自定义去除（高级）</option>
                                </select>

                                <div id="cc-auto-keep-box" style="display:flex; flex-direction:column; gap:6px; background:rgba(0,0,0,0.1); padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                                    <div id="cc-auto-keep-container" style="display:flex; flex-direction:column; gap:8px;"></div>
                                    <button id="cc-add-keep" class="menu_button" style="align-self:flex-start; font-size:12px !important;">+ 添加一条保留规则</button>
                                </div>

                                <div id="cc-custom-rules-box" style="display:none; flex-direction:column; gap:6px; background:rgba(0,0,0,0.2); padding:8px; border-radius:6px;">
                                    <div id="cc-custom-rules-container" style="display:flex; flex-direction:column; gap:8px;"></div>
                                    <button id="cc-add-rule" class="menu_button" style="align-self:flex-start; font-size:12px !important;">+ 添加一条删除规则</button>
                                </div>

                                <label style="display:flex; align-items:center; gap:6px; font-size:13px; margin-top:4px; cursor:pointer;">
                                    <input type="checkbox" id="cc-remove-text">
                                    彻底删除特定标签内的文字
                                </label>
                                <button id="cc-preview-remove" class="menu_button" style="align-self:flex-start; font-size:12px !important; padding:4px 10px !important;">👁️ 预览去除效果</button>
                            </div>
                        </div>
                        <div class="cc-form-row">
                            <label>其他选项：</label>
                            <div class="cc-checkbox-group">
                                <label><input type="checkbox" id="cc-merge-msgs" checked> <strong style="color:#7bd88f;">自动合并连续的同名消息</strong></label>
                                <label><input type="checkbox" id="cc-keep-time" checked> 提取并保留时间标记</label>
                                <label><input type="checkbox" id="cc-detect-markers" checked> 识别 &lt;[时间](名字)&gt; 格式</label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="cc-section">
                    <label>3. 预览</label>
                    <div id="cc-preview" class="cc-preview">
                        <p class="cc-placeholder">转换后在此预览…</p>
                    </div>
                    <div id="cc-stats" class="cc-stats"></div>
                </div>
            </div>
            <div class="cc-modal-footer">
                <button id="cc-convert" class="menu_button" disabled>🔄 开始转换</button>
                <button id="cc-download" class="menu_button" disabled>💾 下载 JSONL</button>
                <button id="cc-import" class="menu_button" disabled>📥 导入到角色</button>
            </div>
        </div>
    </div>`;

    jQuery('body').append(html);
    bindModalEvents();
    
    // 默认只加两个
    addRoleMapRow('<CHAR>', 'char');
    addRoleMapRow('<USER>', 'user');
}

function generateRuleRowHtml(start, end) {
    return `
        <span style="flex-shrink:0; font-size:12px;color:#aaa;">起:</span>
        <input type="text" class="cc-tag-start text_pole" value="${escapeHtml(start)}" style="flex:1; min-width:0; padding: 4px 8px; height: 30px;">
        <span style="flex-shrink:0; font-size:12px;color:#aaa;">止:</span>
        <input type="text" class="cc-tag-end text_pole" value="${escapeHtml(end)}" style="flex:1; min-width:0; padding: 4px 8px; height: 30px;">
        <button class="menu_button cc-detect-tag" title="自动检测标签" style="flex-shrink:0; width:34px; height:30px; padding:0; display:flex; justify-content:center; align-items:center; border-radius:6px;">
            <i class="fa-solid fa-magnifying-glass" style="font-size:14px;"></i>
        </button>
        <button class="menu_button cc-remove-rule" title="删除此规则" style="flex-shrink:0; width:34px; height:30px; padding:0; display:flex; justify-content:center; align-items:center; border-radius:6px; background:rgba(255,80,80,0.2)!important; border-color:rgba(255,80,80,0.4)!important; color:#ffb86c;">
            <i class="fa-solid fa-trash-can" style="font-size:14px;"></i>
        </button>
    `;
}

function addRoleMapRow(matchText = '', role = 'char') {
    const container = document.getElementById('cc-role-map-container');
    const row = document.createElement('div');
    row.className = 'cc-role-map-row';
    row.style = 'display:flex; gap:6px; align-items:center; width: 100%;';
    
    const roleOpts = `
        <option value="char" ${role === 'char' ? 'selected' : ''}>角色</option>
        <option value="user" ${role === 'user' ? 'selected' : ''}>用户</option>
        <option value="system" ${role === 'system' ? 'selected' : ''}>系统/旁白</option>
    `;

    row.innerHTML = `
        <input type="text" class="cc-map-match text_pole" value="${escapeHtml(matchText)}" placeholder="匹配词(如 <CHAR>)" style="flex:1; min-width:0; padding: 4px 8px; height: 30px;">
        <select class="cc-map-role text_pole" style="width: 100px; height: 30px; padding: 0 4px;">${roleOpts}</select>
        <button class="menu_button cc-remove-map" style="flex-shrink:0; width:34px; height:30px; padding:0; display:flex; justify-content:center; align-items:center; border-radius:6px; background:rgba(255,80,80,0.2)!important; border-color:rgba(255,80,80,0.4)!important; color:#ffb86c;">
            <i class="fa-solid fa-trash-can" style="font-size:14px;"></i>
        </button>
    `;
    
    row.querySelector('.cc-remove-map').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function bindRuleRowEvents(row) {
    jQuery(row).find('.cc-remove-rule').on('click', () => {
        row.remove();
    });

    jQuery(row).find('.cc-detect-tag').on('click', async () => {
        if (!pendingFiles.length) { toastr?.warning('请先选择文件'); return; }
        const file = pendingFiles[0];
        const text = await file.text();
        
        const regex = /<([a-zA-Z][a-zA-Z0-9\-]*)\b[^>]*>/g;
        let matches = new Set();
        let m;
        while ((m = regex.exec(text)) !== null) {
            if (m[1].toLowerCase() !== 'br' && m[1].toLowerCase() !== 'style' && m[1].toLowerCase() !== 'script') {
                matches.add(m[1]);
            }
        }
        
        if (matches.size === 0) { toastr?.info('未检测到标签'); return; }
        
        const tags = Array.from(matches).sort();
        const overlay = jQuery('<div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;"></div>');
        const box = jQuery('<div style="background:#1e1e1e;border:1px solid #555;border-radius:12px;padding:20px;max-height:80vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;min-width:320px;max-width:400px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.8);"></div>');
        
        box.append('<div style="font-weight:bold; margin-bottom:8px; color:#7bb8ff; font-size:15px;">检测到的标签（点击填入）</div>');
        
        tags.forEach(tagName => {
            const btn = jQuery(`<button class="menu_button" style="width:100%; text-align:left; padding:8px 12px !important; background:rgba(255,255,255,0.05)!important; border:1px solid rgba(255,255,255,0.1); color:#ddd; font-size:13px; border-radius:6px; cursor:pointer;">
                <i class="fa-solid fa-tag" style="margin-right:6px; opacity:0.5;"></i> ${escapeHtml(tagName)}
            </button>`);
            btn.on('click', () => {
                jQuery(row).find('.cc-tag-start').val(`<${tagName}>`);
                jQuery(row).find('.cc-tag-end').val(`</${tagName}>`);
                overlay.remove();
                toastr?.success(`已填入 <${tagName}>`);
            });
            box.append(btn);
        });
        
        const closeBtn = jQuery('<button class="menu_button" style="margin-top:12px; background:rgba(255,80,80,0.2)!important; color:#ffb86c; width:100%; padding:8px; border-radius:6px; font-weight:bold;">取消</button>');
        closeBtn.on('click', () => overlay.remove());
        box.append(closeBtn);
        
        overlay.append(box);
        jQuery('body').append(overlay);
    });
}

function addKeepRuleRow(start = '', end = '') {
    const container = document.getElementById('cc-auto-keep-container');
    const row = document.createElement('div');
    row.className = 'cc-keep-row';
    row.style = 'display:flex; gap:6px; align-items:center; width: 100%;';
    row.innerHTML = generateRuleRowHtml(start, end);
    container.appendChild(row);
    bindRuleRowEvents(row);
}

function addRemoveRuleRow(start = '', end = '') {
    const container = document.getElementById('cc-custom-rules-container');
    const row = document.createElement('div');
    row.className = 'cc-rule-row';
    row.style = 'display:flex; gap:6px; align-items:center; width: 100%;';
    row.innerHTML = generateRuleRowHtml(start, end);
    container.appendChild(row);
    bindRuleRowEvents(row);
}

function bindModalEvents() {
    jQuery('#cc-close').on('click', () => jQuery('#' + MODAL_ID).hide());
    jQuery('#cc-select-btn').on('click', () => jQuery('#cc-file-input').trigger('click'));
    
    jQuery('#cc-file-input').on('change', e => handleFiles(e.target.files));

    // 点击提取的标签复制
    jQuery('#cc-detected-tags').on('click', '.cc-tag-item', function() {
        const name = jQuery(this).data('name');
        navigator.clipboard.writeText(name).then(() => {
            toastr?.success(`已复制：${name}`);
        }).catch(() => {
            toastr?.error('复制失败');
        });
    });

    // 一键生成映射
    jQuery('#cc-auto-detect-roles').on('click', () => {
        if (!extractedNames.length) {
            toastr?.warning('请先选择文件，系统尚未提取到高频名字');
            return;
        }
        const currentMatchStr = jQuery('#cc-role-map-container .cc-map-match').map(function(){ return jQuery(this).val().trim(); }).get();
        
        let added = 0;
        for (let i = 0; i < Math.min(extractedNames.length, 6); i++) {
            const name = extractedNames[i];
            if (!currentMatchStr.includes(name) && name !== '<CHAR>' && name !== '<USER>') {
                addRoleMapRow(name, 'char');
                added++;
            }
        }
        if (added > 0) toastr?.success(`已自动补充 ${added} 个高频角色映射，请手动将“我”或对应名字改成“用户”`);
        else toastr?.info('高频角色已在列表中');
    });
    
    jQuery('#cc-add-role-map').on('click', () => addRoleMapRow('', 'char'));

    jQuery('#cc-remove-type').on('change', function () {
        if (this.value === 'custom') {
            jQuery('#cc-auto-keep-box').hide();
            jQuery('#cc-custom-rules-box').css('display', 'flex');
            if (jQuery('#cc-custom-rules-container').children().length === 0) {
                addRemoveRuleRow('<details>', '</details>');
            }
        } else if (this.value === 'auto') {
            jQuery('#cc-auto-keep-box').css('display', 'flex');
            jQuery('#cc-custom-rules-box').hide();
            if (jQuery('#cc-auto-keep-container').children().length === 0) {
                addKeepRuleRow('', '');
            }
        } else {
            jQuery('#cc-auto-keep-box').hide();
            jQuery('#cc-custom-rules-box').hide();
        }
    });

    jQuery('#cc-add-rule').on('click', () => addRemoveRuleRow('', ''));
    jQuery('#cc-add-keep').on('click', () => addKeepRuleRow('', ''));

    jQuery('#cc-preview-remove').on('click', async () => {
        if (!pendingFiles.length) { toastr?.warning('请先选择文件'); return; }
        const file = pendingFiles[0];
        const text = await file.text();
        
        const removeType = jQuery('#cc-remove-type').val();
        const removeText = jQuery('#cc-remove-text').is(':checked');
        
        const removeRules = [];
        jQuery('#cc-custom-rules-container .cc-rule-row').each(function () {
            const start = jQuery(this).find('.cc-tag-start').val().trim();
            const end = jQuery(this).find('.cc-tag-end').val().trim();
            if (start || end) removeRules.push({ start, end });
        });

        const keepRules = [];
        jQuery('#cc-auto-keep-container .cc-keep-row').each(function () {
            const start = jQuery(this).find('.cc-tag-start').val().trim();
            const end = jQuery(this).find('.cc-tag-end').val().trim();
            if (start || end) keepRules.push({ start, end });
        });
        
        const sample = text.substring(0, 2000) + (text.length > 2000 ? '\n...[内容过长截断]' : '');
        const cleaned = cleanText(sample, removeType, removeText, removeRules, keepRules);
        
        const previewHtml = `
        <div style="margin-bottom:8px;">
            <strong style="color:#7bb8ff;">去除前：</strong>
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; max-height:120px; overflow-y:auto; font-size:12px; white-space:pre-wrap; margin-top:4px; border: 1px solid rgba(255,255,255,0.05);">${escapeHtml(sample)}</div>
        </div>
        <div>
            <strong style="color:#7bd88f;">去除后：</strong>
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; max-height:120px; overflow-y:auto; font-size:12px; white-space:pre-wrap; margin-top:4px; border: 1px solid rgba(255,255,255,0.05);">${escapeHtml(cleaned)}</div>
        </div>
        `;
        
        document.getElementById('cc-preview').innerHTML = `<div style="padding:12px; background:rgba(255,255,255,0.02); border-radius:6px;">${previewHtml}</div>`;
        document.getElementById('cc-stats').textContent = '这是前 2000 字的清理效果对比';
    });

    const dropZone = document.getElementById('cc-drop-zone');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('cc-drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('cc-drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault(); dropZone.classList.remove('cc-drag-over');
        handleFiles(e.dataTransfer.files);
    });

    jQuery('#cc-convert').on('click', convertAll);
    jQuery('#cc-download').on('click', downloadJsonl);
    jQuery('#cc-import').on('click', importToST);
}

async function handleFiles(fileList) {
    pendingFiles = Array.from(fileList).filter(f => /\.(txt|json)$/i.test(f.name));
    const listEl = document.getElementById('cc-file-list');
    listEl.innerHTML = '';
    pendingFiles.forEach(f => {
        const li = document.createElement('li');
        li.textContent = `${f.name}  (${(f.size / 1024).toFixed(1)} KB)`;
        listEl.appendChild(li);
    });

    const hasFiles = pendingFiles.length > 0;
    jQuery('#cc-convert').prop('disabled', !hasFiles);
    jQuery('#cc-download, #cc-import').prop('disabled', true);
    convertedMessages = [];
    updateBadge(0);
    
    document.getElementById('cc-preview').innerHTML = '<p class="cc-placeholder">转换后在此预览…</p>';
    document.getElementById('cc-stats').textContent = '';
    
    // 提取高频名字 & 3000字预览
    if (hasFiles) {
        const file = pendingFiles[0];
        const text = await file.text();
        
        // 预览框
        jQuery('#cc-preview-file-box').show();
        jQuery('#cc-file-text-preview').val(text.substring(0, 3000) + (text.length > 3000 ? '\n\n...[内容已截断，完整内容将被转换]' : ''));
        
        // 高频词提取
        extractedNames = extractNamesFromText(text);
        const tagsContainer = jQuery('#cc-detected-tags');
        tagsContainer.empty();
        
        if (extractedNames.length > 0) {
            jQuery('#cc-detected-box').show();
            // 只展示前 20 个高频词，避免太长
            extractedNames.slice(0, 20).forEach(name => {
                const tag = jQuery(`<span class="cc-tag-item" data-name="${escapeHtml(name)}" style="background:rgba(123,184,255,0.15); color:#7bb8ff; border:1px solid rgba(123,184,255,0.3); padding:2px 8px; border-radius:12px; font-size:12px; cursor:pointer; user-select:none;" title="点击复制">${escapeHtml(name)}</span>`);
                tagsContainer.append(tag);
            });
        } else {
            jQuery('#cc-detected-box').hide();
        }
    } else {
        extractedNames = [];
        jQuery('#cc-detected-box').hide();
        jQuery('#cc-preview-file-box').hide();
    }
}

async function convertAll() {
    const charName = jQuery('#cc-char-name').val().trim();
    const userName = jQuery('#cc-user-name').val().trim();
    const otherMode = jQuery('#cc-other-speaker').val();
    const detectMarkers = jQuery('#cc-detect-markers').is(':checked');
    const keepTime = jQuery('#cc-keep-time').is(':checked');
    
    const removeType = jQuery('#cc-remove-type').val();
    const removeText = jQuery('#cc-remove-text').is(':checked');
    
    // 收集角色映射表，并清洗冒号和空格！
    const roleMap = {};
    jQuery('#cc-role-map-container .cc-role-map-row').each(function () {
        let match = jQuery(this).find('.cc-map-match').val().trim();
        const role = jQuery(this).find('.cc-map-role').val();
        if (match) {
            // 清洗末尾冒号
            match = match.replace(/[：:]\s*$/, '').trim();
            match = match.replace(/<CHAR>/gi, charName).replace(/<USER>/gi, userName);
            roleMap[match.toLowerCase()] = role;
        }
    });

    const removeRules = [];
    jQuery('#cc-custom-rules-container .cc-rule-row').each(function () {
        const start = jQuery(this).find('.cc-tag-start').val().trim();
        const end = jQuery(this).find('.cc-tag-end').val().trim();
        if (start || end) removeRules.push({ start, end });
    });

    const keepRules = [];
    jQuery('#cc-auto-keep-container .cc-keep-row').each(function () {
        const start = jQuery(this).find('.cc-tag-start').val().trim();
        const end = jQuery(this).find('.cc-tag-end').val().trim();
        if (start || end) keepRules.push({ start, end });
    });

    if (!charName) { toastr?.error('请填写角色名称'); return; }
    if (!userName) { toastr?.error('请填写用户名称'); return; }
    if (!pendingFiles.length) { toastr?.error('请先选择文件'); return; }

    const opts = { charName, userName, otherMode, detectMarkers, keepTime, removeType, removeText, removeRules, keepRules, roleMap };
    convertedMessages = [];

    for (const file of pendingFiles) {
        const text = await file.text();
        const isJson = file.name.toLowerCase().endsWith('.json');
        let msgs;
        try {
            msgs = isJson ? parseJson(text, opts) : parseTxt(text, opts);
        } catch (err) {
            console.error('解析失败:', file.name, err);
            toastr?.error(`解析 ${file.name} 失败：${err.message}`);
            continue;
        }
        convertedMessages.push(...msgs);
    }

    renderPreview();
    updateBadge(convertedMessages.length);

    const has = convertedMessages.length > 0;
    jQuery('#cc-download, #cc-import').prop('disabled', !has);
    if (has) toastr?.success(`转换完成，共 ${convertedMessages.length} 条消息`);
}

function renderPreview() {
    const el = document.getElementById('cc-preview');
    const stats = document.getElementById('cc-stats');
    if (!el) return;

    if (!convertedMessages.length) {
        el.innerHTML = '<p class="cc-placeholder">转换后在此预览…</p>';
        if (stats) stats.textContent = '';
        return;
    }

    const shown = convertedMessages.slice(0, 30);
    el.innerHTML = shown.map(m => {
        const cls = m.is_system ? 'sys' : (m.is_user ? 'user' : 'char');
        const tag = m.is_system ? '🔧 系统' : (m.is_user ? '👤 用户' : '🎭 角色');
        const displayName = m.is_system ? m.name : (m.is_user ? '我' : m.name);
        const text = escapeHtml(m.mes);
        const preview = text.length > 300 ? text.slice(0, 300) + '…' : text;
        return `<div class="cc-preview-item ${cls}">
            <div class="cc-preview-header">${tag} · ${escapeHtml(displayName)}</div>
            <div class="cc-preview-text">${preview}</div>
        </div>`;
    }).join('');

    if (stats) {
        const extra = convertedMessages.length > 30 ? '（预览前 30 条）' : '';
        stats.textContent = `共 ${convertedMessages.length} 条消息 ${extra}`;
    }
}

function buildHeader(customName) {
    const context = getContext();
    const character = context.characterId !== undefined ? context.characters?.[context.characterId] : null;
    const charName = character?.name || jQuery('#cc-char-name').val().trim() || 'Character';
    const userName = context.name1 || jQuery('#cc-user-name').val().trim() || 'User';
    
    let createDate = customName;
    if (!createDate) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        createDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} @${pad(now.getHours())}h ${pad(now.getMinutes())}m ${pad(now.getSeconds())}s`;
    }
    
    return { user_name: userName, character_name: charName, create_date: createDate, chat_metadata: {} };
}

function downloadJsonl() {
    if (!convertedMessages.length) return;
    const chatName = jQuery('#cc-chat-name').val().trim();
    const header = buildHeader(chatName);
    const lines = [JSON.stringify(header)];
    for (const m of convertedMessages) lines.push(JSON.stringify(m));
    const blob = new Blob([lines.join('\n')], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chatName || 'chat_import'}_${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importToST() {
    if (!convertedMessages.length) return;

    const context = getContext();
    const character = context.characterId !== undefined
        ? context.characters?.[context.characterId]
        : null;

    if (!character) {
        toastr?.error('请先在酒馆中选择一个角色卡');
        return;
    }

    const charName = character.name;
    const avatarUrl = character.avatar;
    
    let fileName = jQuery('#cc-chat-name').val().trim();
    if (!fileName) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        fileName = `导入 - ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} @${pad(now.getHours())}h ${pad(now.getMinutes())}m ${pad(now.getSeconds())}s`;
    }

    const btn = jQuery('#cc-import');
    const originalText = btn.text();
    btn.prop('disabled', true).text('导入中…');

    try {
        const response = await fetch('/api/chats/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: charName,
                file_name: fileName,
                chat: convertedMessages,
                avatar_url: avatarUrl
            })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(errText || `HTTP ${response.status}`);
        }

        toastr?.success(`已保存为「${fileName}」。刷新页面后可在聊天文件列表中看到。`, '导入成功', { timeOut: 8000 });
        btn.text('✅ 已导入');
    } catch (err) {
        console.error('导入失败:', err);
        toastr?.error(`导入失败：${err.message}`);
        btn.prop('disabled', false).text(originalText);
    }
}

/* ═══════════════ 扩展设置 ═══════════════ */

function createSettingsPanel() {
    const container = document.getElementById('extensions_settings2');
    if (!container) {
        setTimeout(createSettingsPanel, 500);
        return;
    }
    if (document.getElementById('cc-settings-panel')) return;

    const html = `
    <div id="cc-settings-panel" class="chat-converter-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>聊天记录转换器</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="cc-hint">右下角悬浮球可直接打开转换器。</p>
                <div class="cc-settings-row">
                    <input type="checkbox" id="cc-fab-toggle">
                    <label for="cc-fab-toggle">显示悬浮球</label>
                </div>
                <div class="cc-settings-row">
                    <button id="cc-fab-reset" class="menu_button">重置悬浮球位置</button>
                    <button id="cc-open-modal" class="menu_button">打开转换器</button>
                </div>
            </div>
        </div>
    </div>`;
    jQuery('#extensions_settings2').append(html);

    const toggle = document.getElementById('cc-fab-toggle');
    const fab = document.getElementById(FAB_ID);

    toggle.checked = !fab || !fab.classList.contains('cc-fab-hidden');
    jQuery(toggle).on('change', function () {
        const show = this.checked;
        const f = document.getElementById(FAB_ID);
        if (!f) return;
        if (show) {
            f.classList.remove('cc-fab-hidden');
            localStorage.setItem(FAB_HIDDEN_KEY, '0');
        } else {
            f.classList.add('cc-fab-hidden');
            localStorage.setItem(FAB_HIDDEN_KEY, '1');
        }
    });

    jQuery('#cc-fab-reset').on('click', () => {
        const f = document.getElementById(FAB_ID);
        if (!f) return;
        f.style.left = '';
        f.style.top = '';
        f.style.right = '';
        f.style.bottom = '';
        localStorage.removeItem(FAB_POS_KEY);
    });

    jQuery('#cc-open-modal').on('click', openModal);
}