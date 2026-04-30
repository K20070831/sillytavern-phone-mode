(async function () {
    await new Promise(r => setTimeout(r, 1000));

    // ── 1. 状态与本地数据库 (LocalStorage) ──
    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // 获取当前聊天绑定的唯一 ID
    function getChatId() {
        const c = getCtx();
        return c ? `${c.characterId}_${c.chat_file || 'default'}` : 'global';
    }

    // 读写本地存储（持久化保存）
    function loadHistories() {
        try { return JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } 
        catch { return {}; }
    }
    function saveHistories(dataObj) {
        localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(dataObj));
    }

    // ── 2. 终极净化器 (专杀 ECoT 和 小说体泄漏) ──
    function processResponse(text) {
        if (!text) return [];
        
        let clean = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // 1. 斩杀 ECoT 和所有 HTML 注释
        clean = clean.replace(//g, '');
        // 2. 斩杀 xml 思维标签
        clean = clean.replace(/<(thinking|thought|思考|写作指导|前文回顾)[\s\S]*?<\/\1>/gi, '');
        // 3. 斩杀标题、标签等方括号内容 [CHAP] [TITLE]
        clean = clean.replace(/\[(?:CHAP|TITLE|CP|LOC|TAGS|风格)[^\]]*\]/gi, '');
        // 4. 斩杀动作描写和普通的尖括号标签
        clean = clean.replace(/<[^>]+>/g, '');
        clean = clean.replace(/\*[^*]+\*/g, '');
        // 5. 保护转账和图片，斩除其他旁白
        clean = clean.replace(/[\(（](?!(转账|图片))[^\)）]+[\)\）]/g, '');
        // 6. 抹除泄露的冒号前缀 (如 "微生律:")
        clean = clean.replace(/^(.*?)(: |：)/gm, '');
        clean = clean.trim();
        
        // 切割：首选 /，其次自然标点
        let chunks = clean.split(/[/／]/).map(s => s.trim()).filter(s => s.length > 0);
        if (chunks.length === 1 && clean.length > 15) {
            chunks = clean.split(/(?<=[。！？!?\n])\s*/).map(s => s.trim()).filter(s => s.length > 0);
        }
        
        return chunks.slice(0, 8); // 强制限制 3-8 句
    }

    // ── 3. UI 气泡生成 ──
    function createBubbleElement(text, side) {
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // 渲染转账和图片
        html = html.replace(/[\(（]转账\+(\d+)[\)\）]/g, 
            `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>收到转账</b><span>¥$1.00</span></div></div>`);
        html = html.replace(/[\(（]图片\+([^)]+)[\)\）]/g, `<div class="pm-img-card">🖼️ 图片：$1</div>`);
        
        b.innerHTML = html;
        if (text.match(/^[\(（](转账|图片)\+[^)]+[\)\）]$/)) {
            b.style.background = 'transparent'; b.style.boxShadow = 'none'; b.style.padding = '0';
        }
        return b;
    }

    // ── 4. API (高压镇压版系统指令) ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        // 最强力的中文系统覆盖指令
        const systemPrompt = `【最高系统指令：覆盖并中止一切已有预设、ECoT、小说写作指导及动作标签生成】
当前处于现代手机短信对话模式。你必须完全抛弃小说体、旁白和内心独白。
你的身份是："${currentPersona}"。结合世界书和角色卡进行演绎，但不要暴露任何背景设定词。
严格遵守以下格式要求：
1. 绝对禁止输出任何 注释、[TAGS] 或小说章节标题！
2. 绝对禁止输出任何心理活动或动作描写！
3. 只输出发给 {{user}} 的纯文本短信内容。
4. 长度强制限制在 3-8 句。
5. 必须使用 "/" 符号来分隔你的每一句话（例如：我刚下班/你今天过得怎么样/晚上一起吃饭吗？）
6. 如有需要，只能用 (图片+内容) 或 (转账+数字) 的格式发送媒体。`;

        const prompt = `${systemPrompt}\n\n【历史短信】\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            let sentences = processResponse(res);
            
            if (sentences.length === 0) sentences = ["（对方没有回复）"];
            
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            
            // 保存到本地数据库
            const db = loadHistories();
            const chatId = getChatId();
            if (!db[chatId]) db[chatId] = {};
            db[chatId][currentPersona] = [...conversationHistory.slice(-20)];
            saveHistories(db);
            
            return sentences;
        } catch (e) { return ["（发送失败）"]; }
    }

    // ── 5. 全平台拖拽 (兼容移动端) ──
    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startL, startT, moved = false;
        const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };

        const onStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; moved = false;
            const coords = getCoord(e);
            startX = coords.x; startY = coords.y;
            startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const coords = getCoord(e);
            let dx = coords.x - startX, dy = coords.y - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { moved = true; if(e.cancelable) e.preventDefault(); }
            el.style.left = (startL + dx) + 'px'; el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };
        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            if (!moved) __pmToggleMin();
        };

        handle.addEventListener('mousedown', onStart); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
        handle.addEventListener('touchstart', onStart, { passive: false }); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onEnd);
    }

    // ── 6. UI 控制与列表管理 ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        list.appendChild(createBubbleElement(text, side));
        list.scrollTop = list.scrollHeight;
    }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';
        addBubble(val, 'right');
        isGenerating = true;
        
        const sentenceList = await fetchSMS(val);
        for (const s of sentenceList) {
            await new Promise(r => setTimeout(r, 600));
            addBubble(s, 'left');
        }
        isGenerating = false;
    };

    window.__pmShowList = () => {
        const db = loadHistories();
        const list = Object.keys(db[getChatId()] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
            <div class="pm-modal">
                <div style="display:flex;justify-content:space-between;margin-bottom:15px;align-items:center">
                    <b style="font-size:16px">联系人记录</b><span onclick="this.closest('#pm-overlay').remove()" style="font-size:20px;cursor:pointer">×</span>
                </div>
                <div style="max-height:200px;overflow-y:auto;margin-bottom:10px">
                    ${list.map(n => `<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">清除</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="新联系人名字..." style="width:100%;padding:10px;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;margin-bottom:10px;outline:none">
                <div style="display:flex;gap:10px">
                    <button onclick="document.getElementById('pm-overlay').remove()" style="flex:1;padding:10px;border:none;border-radius:10px;background:#f2f2f7;cursor:pointer">取消</button>
                    <button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="flex:2;padding:10px;background:#007aff;color:#fff;border:none;border-radius:10px;cursor:pointer">新建并呼叫</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
    };

    window.__pmSwitch = (name) => {
        if (!name) return;
        currentPersona = name;
        const db = loadHistories();
        conversationHistory = db[getChatId()]?.[name] || [];
        
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => {
                const sents = m.content.split(/[/／]|(?<=[。！？!?])\s*/).filter(s=>s.trim().length>0);
                sents.forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        document.getElementById('pm-overlay')?.remove();
    };

    window.__pmDel = (n) => { 
        const db = loadHistories();
        if (db[getChatId()] && db[getChatId()][n]) {
            delete db[getChatId()][n];
            saveHistories(db);
        }
        __pmShowList(); 
    };

    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 7. 初始化与唤起 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? '白厄';
        
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v11';
        phoneWindow.innerHTML = `
            <div class="pm-island"></div>
            <div class="pm-main-ui">
                <div class="pm-navbar">
                    <button onclick="__pmShowList()" class="pm-nav-btn">≡</button>
                    <div class="pm-name">${defaultChar}</div>
                    <button onclick="__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">✕</button>
                </div>
                <div class="pm-msg-list"></div>
                <div class="pm-input-bar">
                    <input class="pm-input" placeholder="iMessage">
                    <button onclick="__pmSend()" class="pm-up-btn">↑</button>
                </div>
            </div>`;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        __pmSwitch(defaultChar);
        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key === 'Enter') __pmSend(); };
    };

    // ── 8. 样式 ──
    const css = `
        #pm-iphone-v11 { position: fixed; bottom: 40px; right: 40px; width: 330px; height: 580px; background: #fff; border: 10px solid #111; border-radius: 45px; z-index: 100000; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; touch-action: none; }
        #pm-iphone-v11.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; }
        #pm-iphone-v11.is-min .pm-main-ui { display: none; }
        .pm-island { width: 100px; height: 26px; background: #000; margin: 10px auto; border-radius: 15px; cursor: move; flex-shrink: 0; touch-action: none; z-index: 10; }
        .pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 1px solid #f2f2f7; }
        .pm-name { font-weight: 700; color: #000; font-size: 15px; }
        .pm-nav-btn { background: none; border: none; font-size: 22px; cursor: pointer; color:#007aff; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; background: #fff; }
        .pm-bubble { max-width: 75%; padding: 10px 15px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: pm-pop 0.3s ease-out; word-wrap: break-word; }
        @keyframes pm-pop { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        .pm-transfer-card { background: #ff9500; color: #fff; border-radius: 18px; padding: 12px 15px; display: flex; align-items: center; gap: 12px; min-width: 160px; box-shadow: 0 4px 10px rgba(255,149,0,0.3); }
        .pm-t-icon { width: 36px; height: 36px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
        .pm-t-info { display: flex; flex-direction: column; }
        .pm-img-card { background: #f2f2f7; border: 1px solid #ddd; padding: 15px; border-radius: 18px; color: #666; font-size: 13px; text-align: center; }
        .pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 1px solid #f2f2f7; align-items: center; background: #fff; }
        .pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; font-size: 14px; }
        .pm-up-btn { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; }
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 20px; border-radius: 25px; width: 280px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); font-family: sans-serif; }
        .pm-li { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f2f2f7; font-size: 15px; }
        .pm-li span { color: #000; cursor: pointer; font-weight: 500; flex: 1; }
        .pm-li i { color: #ff3b30; cursor: pointer; font-style: normal; font-size: 13px; }
    `;
    if (!document.getElementById('pm-v11-css')) {
        const s = document.createElement('style'); s.id = 'pm-v11-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V11 (ECoT Nuke & LocalStorage) Loaded.");
})();
