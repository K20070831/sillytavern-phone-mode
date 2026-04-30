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

    // ── 2. 核心：全平台拖拽引擎（适配手机触摸） ──
    function bindIsland(el, handle) {
        let isDragging = false;
        let startX, startY, startL, startT;
        let moved = false;

        // 统一获取坐标的工具函数
        const getCoord = (e) => {
            if (e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const onStart = (e) => {
            // 防止点击按钮时触发拖拽
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            moved = false;
            const coords = getCoord(e);
            startX = coords.x;
            startY = coords.y;
            startL = el.offsetLeft;
            startT = el.offsetTop;
            
            el.style.transition = 'none'; // 拖拽时即时跟随，关闭动画
            
            // 手机端防止拖动时页面跟着滚动
            if (e.type === 'touchstart') {
                // 不建议在这里直接 preventDefault，以免影响点击
            }
        };

        const onMove = (e) => {
            if (!isDragging) return;
            
            const coords = getCoord(e);
            let dx = coords.x - startX;
            let dy = coords.y - startY;

            // 移动阈值判断
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                moved = true;
                // 如果是手机触摸移动，强制阻止系统侧滑或下拉刷新
                if (e.cancelable) e.preventDefault(); 
            }

            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto';
            el.style.right = 'auto';
        };

        const onEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            
            // 如果位移很小，视为“点击”灵动岛，触发最小化
            if (!moved) {
                __pmToggleMin();
            }
        };

        // 绑定鼠标事件
        handle.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);

        // 绑定手机触摸事件 (关键修复)
        handle.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    }

    // ── 3. 文本处理与分句 (保持V9的高强度过滤) ──
    function processResponse(text) {
        if (!text) return [];
        let clean = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        clean = clean.replace(/<(thinking|thought|思考)>[\s\S]*?<\/\1>/gi, '')
                     .replace(/\*[^*]+\*/g, '')
                     .replace(/[\(（](?!(转账|图片))[^\)）]+[\)\）]/g, '')
                     .trim();
        
        let chunks = clean.split(/[/／]/).map(s => s.trim()).filter(s => s.length > 0);
        if (chunks.length === 1 && clean.length > 20) {
            chunks = clean.split(/(?<=[。！？!?\n])\s*/).map(s => s.trim()).filter(s => s.length > 0);
        }
        return chunks.slice(0, 8);
    }

    // ── 4. 渲染气泡 ──
    function createBubbleElement(text, side) {
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // 转账渲染
        html = html.replace(/[\(（]转账\+(\d+)[\)\）]/g, 
            `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>收到转账</b><span>¥$1.00</span></div></div>`);
        // 图片渲染
        html = html.replace(/[\(（]图片\+([^)]+)[\)\）]/g, `<div class="pm-img-card">🖼️ 图片：$1</div>`);
        
        b.innerHTML = html;
        if (text.match(/^[\(（](转账|图片)\+[^)]+[\)\）]$/)) {
            b.style.background = 'transparent'; b.style.boxShadow = 'none'; b.style.padding = '0';
        }
        return b;
    }

    // ── 5. API 呼叫 ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });
        const systemPrompt = `[SYSTEM: SMS_MODE] 
1. YOU ARE: "${currentPersona}". (Load {{persona}} & {{worldbook}}).
2. DO NOT ACT AS {{user}}. NO <thinking>.
3. FORMAT: 3-8 short messages separated by "/". 
4. NO NARRATION. PURE TEXT ONLY.`;

        const prompt = `${systemPrompt}\n\n[History]\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            let sentences = processResponse(res);
            if (sentences.length === 0) sentences = ["..."];
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            saveStore();
            return sentences;
        } catch (e) { return ["（发送失败）"]; }
    }

    function saveStore() {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
    }

    // ── 6. UI 交互 ──
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
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
            <div class="pm-modal">
                <div style="display:flex;justify-content:space-between;margin-bottom:15px"><b>联系人管理</b><span onclick="this.closest('#pm-overlay').remove()">✕</span></div>
                <div style="max-height:200px;overflow-y:auto">
                    ${list.map(n => `<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">移除</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="新名字..." style="width:100%;padding:8px;margin-top:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                <button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="width:100%;margin-top:10px;padding:10px;background:#007aff;color:#fff;border:none;border-radius:10px">添加并切换</button>
            </div>`;
        document.body.appendChild(ov);
    };

    window.__pmSwitch = (name) => {
        if (!name) return;
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => {
                const sents = m.content.split(/[/／]|(?<=[。！？!?])\s*/);
                sents.forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        if(document.getElementById('pm-overlay')) document.getElementById('pm-overlay').remove();
    };

    window.__pmDel = (n) => { delete window.__pmHistories[`${getCtx().characterId}_${getCtx().chat_file || 'default'}`][n]; __pmShowList(); };
    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 7. 初始化 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v10';
        phoneWindow.innerHTML = `
            <div class="pm-island"></div>
            <div class="pm-main-ui">
                <div class="pm-navbar">
                    <button onclick="__pmShowList()" class="pm-nav-btn">≡</button>
                    <div class="pm-name">${defaultChar}</div>
                    <button onclick="__pmEnd()" class="pm-nav-btn" style="color:red">✕</button>
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

    const css = `
        #pm-iphone-v10 {
            position: fixed; bottom: 40px; right: 40px; width: 330px; height: 580px;
            background: #fff; border: 10px solid #111; border-radius: 45px;
            z-index: 100000; display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 20px 50px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            touch-action: none; /* 关键：禁止浏览器默认手势，交给JS处理 */
        }
        #pm-iphone-v10.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; }
        #pm-iphone-v10.is-min .pm-main-ui { display: none; }
        .pm-island { 
            width: 100px; height: 26px; background: #000; margin: 10px auto; 
            border-radius: 15px; cursor: move; flex-shrink: 0;
            touch-action: none; /* 灵动岛必须禁止手势以触发拖拽 */
        }
        .pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 1px solid #f2f2f7; }
        .pm-name { font-weight: 700; color: #000; font-size: 15px; }
        .pm-nav-btn { background: none; border: none; font-size: 22px; cursor: pointer; color:#007aff; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; background: #fff; }
        .pm-bubble { max-width: 75%; padding: 10px 15px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: pm-pop 0.3s ease-out; word-wrap: break-word; }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        .pm-transfer-card { background: #ff9500; color: #fff; border-radius: 18px; padding: 12px 15px; display: flex; align-items: center; gap: 12px; min-width: 160px; }
        .pm-t-icon { width: 36px; height: 36px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
        .pm-t-info { display: flex; flex-direction: column; }
        .pm-img-card { background: #f2f2f7; border: 1px solid #ddd; padding: 15px; border-radius: 18px; color: #666; font-size: 13px; text-align: center; }
        .pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 1px solid #f2f2f7; align-items: center; background: #fff; }
        .pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; font-size: 14px; }
        .pm-up-btn { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; }
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 20px; border-radius: 25px; width: 280px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); font-family: sans-serif; }
        .pm-li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f2f2f7; font-size: 14px; }
        .pm-li span { color: #007aff; cursor: pointer; }
        .pm-li i { color: #ff3b30; cursor: pointer; font-style: normal; }
    `;

    if (!document.getElementById('pm-v10-css')) {
        const s = document.createElement('style'); s.id = 'pm-v10-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V10 (Mobile Touch Fix) Loaded.");
})();
