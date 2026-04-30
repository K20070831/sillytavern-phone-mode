(async function () {
    await new Promise(r => setTimeout(r, 1000));

    // ── 1. 全局状态 ──
    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 2. 终极净化与切割引擎 (Bug修复核心) ──
    function processResponse(text) {
        if (!text) return [];
        
        // 1. 修复转义符Bug：将 &lt; 还原为 <，以便正则精准捕获
        let clean = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // 2. 物理绞杀所有思考链、代码块
        clean = clean.replace(/<(thinking|thought|思考)>[\s\S]*?<\/\1>/gi, '')
                     .replace(/```[\s\S]*?```/g, '');
        
        // 3. 抹除动作描写和旁白，但【绝对保留】(转账+X) 和 (图片+X)
        clean = clean.replace(/\*[^*]+\*/g, '')
                     .replace(/[\(（](?!(转账|图片))[^\)）]+[\)\）]/g, '')
                     .replace(/(当前风格|System|Assistant|Name)[:：].*/gi, '')
                     .replace(/^(.*?)(: |：)/gm, '') // 抹除开头的名字前缀
                     .trim();
        
        // 4. 双轨切割法：优先使用用户要求的 / 进行切割
        let chunks = clean.split(/[/／]/).map(s => s.trim()).filter(s => s.length > 0);
        
        // 如果 AI 偷懒没用 /，再降级使用标点符号切割
        if (chunks.length === 1 && clean.length > 20) {
            chunks = clean.split(/(?<=[。！？!?\n])\s*/).map(s => s.trim()).filter(s => s.length > 0);
        }

        // 强行把控在 3-8 句的范围内
        return chunks.slice(0, 8);
    }

    // ── 3. 气泡渲染引擎 (带富文本支持) ──
    function createBubbleElement(text, side) {
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;

        // 防注入处理，同时解析特殊语法
        let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // 解析转账
        html = html.replace(/[\(（]转账\+(\d+)[\)\）]/g, 
            `<div class="pm-transfer-card">
                <div class="pm-t-icon">¥</div>
                <div class="pm-t-info"><b>收到转账</b><span>¥$1.00</span></div>
            </div>`);

        // 解析图片
        html = html.replace(/[\(（]图片\+([^)]+)[\)\）]/g, 
            `<div class="pm-img-card">🖼️ 图片：$1</div>`);

        b.innerHTML = html;

        // 如果气泡里纯纯只有卡片，去掉默认背景色让其更美观
        if (text.match(/^[\(（](转账|图片)\+[^)]+[\)\）]$/)) {
            b.style.background = 'transparent';
            b.style.padding = '0';
            b.style.boxShadow = 'none';
        }
        return b;
    }

    // ── 4. API 呼叫与强制洗脑指令 ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        // 系统指令升级：直接给出模板，强迫其使用 / 符号
        const systemPrompt = `[CRITICAL SYSTEM OVERRIDE: SMS MODE]
1. YOU ARE EXACTLY: "${currentPersona}". (Load {{persona}} & {{worldbook}}).
2. DO NOT ACT AS {{user}}. DO NOT GENERATE <thinking>.
3. FORMAT: Modern Texting. 3 to 8 short messages.
4. DELIMITER: You MUST separate each message with a slash "/".
5. NO NARRATION, NO ACTIONS. PURE TEXT ONLY.
6. SPECIAL CARDS: Use exact syntax (转账+amount) to send money or (图片+description) to send an image.
7. EXAMPLE: "Hi, I just woke up. / Are you free today? / (图片+Coffee cup) / Let's meet at 5. / (转账+50)"`;

        const prompt = `${systemPrompt}\n\n[History]\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            let sentences = processResponse(res);
            
            // 保底机制：如果全被切空了
            if (sentences.length === 0) sentences = ["（信号不好，未收到完整消息...）"];
            
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            saveStore();
            return sentences;
        } catch (e) { return ["（发送失败，请检查网络设置）"]; }
    }

    function saveStore() {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
    }

    // ── 5. UI 交互与动画引擎 ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        const b = createBubbleElement(text, side);
        list.appendChild(b);
        list.scrollTop = list.scrollHeight;
    }

    function showTyping() {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return null;
        const typing = document.createElement('div');
        typing.className = 'pm-bubble pm-left pm-typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        list.appendChild(typing);
        list.scrollTop = list.scrollHeight;
        return typing;
    }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        
        input.value = '';
        addBubble(val, 'right');
        isGenerating = true;
        
        // 显示正在输入动画
        const typingIndicator = showTyping();

        const sentenceList = await fetchSMS(val);
        
        // 收到回复后移除正在输入
        if (typingIndicator) typingIndicator.remove();

        // 模拟真实打字，按 / 拆分的气泡逐个弹出
        for (const s of sentenceList) {
            await new Promise(r => setTimeout(r, 500 + Math.random()*500));
            addBubble(s, 'left');
        }
        
        isGenerating = false;
    };

    // 拖拽逻辑保持顺滑
    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startL, startT, moved = false;
        handle.onmousedown = (e) => {
            isDragging = true; moved = false;
            startX = e.clientX; startY = e.clientY;
            startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none';
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            let dx = e.clientX - startX, dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };
        document.onmouseup = () => {
            isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            if (!moved) __pmToggleMin();
        };
    }

    // 联系人列表管理
    window.__pmShowList = () => {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
            <div class="pm-modal">
                <div style="display:flex;justify-content:space-between;margin-bottom:15px;align-items:center">
                    <b style="font-size:16px">联系人管理</b>
                    <span onclick="this.closest('#pm-overlay').remove()" style="cursor:pointer;font-size:20px;color:#999">×</span>
                </div>
                <div style="max-height:200px;overflow-y:auto;margin-bottom:10px">
                    ${list.map(n => `<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">移除</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="输入新联系人..." style="width:100%;padding:10px;box-sizing:border-box;border-radius:10px;border:1px solid #ddd;margin-bottom:10px;outline:none">
                <div style="display:flex;gap:10px">
                    <button onclick="document.getElementById('pm-overlay').remove()" style="flex:1;padding:10px;border:none;border-radius:10px;background:#f2f2f7;cursor:pointer">取消</button>
                    <button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="flex:2;padding:10px;background:#007aff;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:bold">呼叫</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
    };

    window.__pmSwitch = (name) => {
        if (!name) return;
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[currentPersona] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = currentPersona;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => {
                const sents = m.content.split(/[/／]|(?<=[。！？!?])\s*/).filter(s=>s.trim().length>0);
                sents.forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        document.getElementById('pm-overlay')?.remove();
    };

    window.__pmDel = (n) => { delete window.__pmHistories[`${getCtx().characterId}_${getCtx().chat_file || 'default'}`][n]; __pmShowList(); };
    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 6. 构建窗口 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v9';
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

    // ── 7. CSS 美学重构 ──
    const css = `
        #pm-iphone-v9 {
            position: fixed; bottom: 40px; right: 40px; width: 340px; height: 600px;
            background: #fff; border: 12px solid #111; border-radius: 50px;
            z-index: 100000; display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 30px 60px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #pm-iphone-v9.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; }
        #pm-iphone-v9.is-min .pm-main-ui { display: none; }
        .pm-island { width: 110px; height: 28px; background: #000; margin: 10px auto; border-radius: 15px; cursor: move; flex-shrink: 0; z-index: 10; }
        .pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 0.5px solid #f2f2f7; }
        .pm-name { font-weight: 700; color: #000; font-size: 16px; }
        .pm-nav-btn { background: none; border: none; font-size: 22px; cursor: pointer; padding: 5px; color:#007aff; }
        
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; background: #fff; }
        .pm-bubble { max-width: 75%; padding: 10px 15px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: pm-pop 0.3s ease-out; word-wrap: break-word; }
        @keyframes pm-pop { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        
        /* 动画与卡片 */
        .pm-typing { padding: 12px 18px; display: flex; gap: 4px; align-items: center; width: fit-content; }
        .pm-typing span { width: 6px; height: 6px; background: #999; border-radius: 50%; animation: typing 1.4s infinite ease-in-out both; }
        .pm-typing span:nth-child(1) { animation-delay: -0.32s; }
        .pm-typing span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        
        .pm-transfer-card { background: #ff9500; color: #fff; border-radius: 18px; padding: 12px 15px; display: flex; align-items: center; gap: 12px; min-width: 160px; box-shadow: 0 4px 10px rgba(255,149,0,0.3); }
        .pm-t-icon { width: 36px; height: 36px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
        .pm-t-info { display: flex; flex-direction: column; }
        .pm-t-info span { font-size: 18px; font-weight: 700; margin-top: 2px; }
        
        .pm-img-card { background: #f2f2f7; border: 1px solid #ddd; padding: 15px; border-radius: 18px; color: #666; font-size: 13px; text-align: center; }
        
        .pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 1px solid #f2f2f7; align-items: center; background: #fff; }
        .pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; font-size: 14px; }
        .pm-up-btn { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; }
        
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 25px; border-radius: 25px; width: 280px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
        .pm-li { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f2f2f7; font-size: 15px; }
        .pm-li span { color: #000; cursor: pointer; font-weight: 500; flex: 1; }
        .pm-li i { color: #ff3b30; cursor: pointer; font-style: normal; font-size: 13px; }
    `;

    if (!document.getElementById('pm-v9-css')) {
        const s = document.createElement('style'); s.id = 'pm-v9-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V9 (The Final Fix) Loaded.");
})();
