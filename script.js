const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Global States
let currentTool = 'patch';
let currentInkColor = '#ef4444'; // สีเริ่มต้นเป็นสีแดงสด
let currentScale = 1.0;
let pdfDoc = null;
let originalPdfBytes = null;
let originalFileName = 'Sunita_Document';

let documentPatches = {};
let undoStack = [];
let redoStack = [];

const THAI_FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Regular.ttf';
let cachedFontBytes = null;

let sigCanvas, sigCtx, isDrawingSig = false, sigColor = '#0033aa', uploadedSigBase64 = null;

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
}

function recordAction(action) {
    undoStack.push(action);
    redoStack = [];
}

function undoAction() {
    if (undoStack.length === 0) {
        showToast("ไม่พบรายการย้อนกลับ");
        return;
    }
    const act = undoStack.pop();
    redoStack.push(act);
    act.undo();
    showToast("ย้อนกลับรายการล่าสุดแล้วค่ะ");
}

function redoAction() {
    if (redoStack.length === 0) {
        showToast("ไม่มีรายการทำซ้ำ");
        return;
    }
    const act = redoStack.pop();
    undoStack.push(act);
    act.redo();
    showToast("ทำซ้ำรายการแล้วค่ะ");
}

window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoAction();
    }
});

function resetApp() {
    if (confirm("ต้องการเริ่มงานใหม่และล้างเอกสารปัจจุบันหรือไม่คะ?")) {
        pdfDoc = null;
        originalPdfBytes = null;
        documentPatches = {};
        undoStack = [];
        redoStack = [];
        originalFileName = "Sunita_Document";
        currentScale = 1.0;
        const container = document.getElementById('document-container');
        container.innerHTML = `
            <div class="welcome-box">
                <div class="welcome-avatar-wrap">
                    <img src="cat-avatar.png" alt="Cat Logo" class="welcome-cat-avatar" onerror="this.parentElement.innerHTML='<div class=\\'welcome-icon\\'><i class=\\'fa-solid fa-file-pdf\\'></i></div>'">
                </div>
                <h2>ยินดีต้อนรับสู่ Sunita PDF Studio</h2>
                <p>เครื่องมือตรวจแก้เอกสาร ลบคำผิด ดูดสีเนียนสนิท วาดกรอบสี่เหลี่ยม วงรี ชี้เป้าแก้ไข และส่งออกคมชัดระดับเวกเตอร์</p>
                <button onclick="document.getElementById('upload-pdf').click()" class="btn-open-file">
                    <i class="fa-solid fa-arrow-up-from-bracket"></i> เลือกไฟล์ PDF เพื่อเริ่มงาน
                </button>
            </div>
        `;
        showToast("รีเซ็ตระบบพร้อมเริ่มงานใหม่แล้วค่ะ");
    }
}

async function handleFileOpen(e) {
    const file = e.target.files[0];
    if (!file) return;
    originalFileName = file.name.replace(/\.[^/.]+$/, "");
    
    showToast("กำลังอ่านข้อมูลเอกสาร...");
    originalPdfBytes = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: originalPdfBytes.slice(0) }).promise;
    
    documentPatches = {};
    undoStack = [];
    redoStack = [];
    const container = document.getElementById('document-container');
    container.innerHTML = '';
    currentScale = 1.0;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        await renderPage(i, container);
    }

    setTool('patch');
    showToast(`เปิดเอกสารเรียบร้อย (${pdfDoc.numPages} หน้า) - แตะคำเพื่อแก้ได้เลยค่ะ`);
}

async function renderPage(pageNum, container) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });

    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.pageNumber = pageNum;
    wrapper.style.width = (viewport.width / 2) + 'px';
    wrapper.style.height = (viewport.height / 2) + 'px';

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-page-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    wrapper.appendChild(pdfCanvas);

    const annotCanvas = document.createElement('canvas');
    annotCanvas.className = 'annotation-canvas';
    annotCanvas.width = viewport.width;
    annotCanvas.height = viewport.height;
    wrapper.appendChild(annotCanvas);

    // SVG สำหรับวาดเส้นโยงระหว่างรูปทรงกับกล่องคอมเมนต์สีแดง
    const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.setAttribute('class', 'leader-lines-svg');
    wrapper.appendChild(svgLayer);

    const patchLayer = document.createElement('div');
    patchLayer.className = 'patch-layer';
    wrapper.appendChild(patchLayer);

    container.appendChild(wrapper);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

    const textContent = await page.getTextContent();
    const displayViewport = page.getViewport({ scale: 1.0 });

    const pageTextMetadata = textContent.items.map(item => {
        const tx = pdfjsLib.Util.transform(displayViewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        const [left, top] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);

        return {
            x: left,
            y: top - fontHeight,
            width: item.width,
            height: fontHeight,
            fontSize: fontHeight,
            text: item.str,
            fontName: item.fontName || '',
            pdfX: item.transform[4],
            pdfY: item.transform[5],
            viewportY: top
        };
    });

    bindSmartPatchEngine(wrapper, pageNum, pdfCanvas, pageTextMetadata);
    bindDrawingEngine(annotCanvas, pageNum);
}

function initTabletGestures() {
    const workspaceEl = document.querySelector('.workspace');
    let initialDistance = 0;
    let initialTouchScale = 1.0;
    let isPinching = false;

    workspaceEl.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialDistance = Math.hypot(dx, dy);
            initialTouchScale = currentScale;
        }
    }, { passive: false });

    workspaceEl.addEventListener('touchmove', (e) => {
        if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDistance = Math.hypot(dx, dy);

            if (initialDistance > 0) {
                const factor = currentDistance / initialDistance;
                let targetScale = initialTouchScale * factor;
                targetScale = Math.max(0.5, Math.min(3.0, targetScale));
                currentScale = targetScale;

                const container = document.getElementById('document-container');
                if (container) {
                    container.style.transform = `scale(${currentScale})`;
                }
            }
        }
    }, { passive: false });

    workspaceEl.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            isPinching = false;
            initialDistance = 0;
        }
    });
}

function getPageAccurateCoords(e, wrapper) {
    const rect = wrapper.getBoundingClientRect();
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;

    const nativeW = parseFloat(wrapper.style.width);
    const nativeH = parseFloat(wrapper.style.height);

    const x = ((clientX - rect.left) / rect.width) * nativeW;
    const y = ((clientY - rect.top) / rect.height) * nativeH;

    return {
        x: Math.max(0, Math.min(nativeW, x)),
        y: Math.max(0, Math.min(nativeH, y))
    };
}

function analyzeBoxColors(canvas, x, y, width, height) {
    const ctx = canvas.getContext('2d');
    const scaleFactorX = canvas.width / parseFloat(canvas.style.width || (canvas.width / 2));
    const scaleFactorY = canvas.height / parseFloat(canvas.style.height || (canvas.height / 2));

    const sLeft = Math.max(0, Math.floor(x * scaleFactorX));
    const sTop = Math.max(0, Math.floor(y * scaleFactorY));
    const sWidth = Math.max(1, Math.floor(width * scaleFactorX));
    const sHeight = Math.max(1, Math.floor(height * scaleFactorY));

    try {
        const imgData = ctx.getImageData(sLeft, sTop, sWidth, sHeight).data;
        const colorCounts = {};

        for (let i = 0; i < imgData.length; i += 4) {
            if (imgData[i + 3] < 128) continue;
            const r = Math.round(imgData[i] / 4) * 4;
            const g = Math.round(imgData[i + 1] / 4) * 4;
            const b = Math.round(imgData[i + 2] / 4) * 4;
            const key = `${r},${g},${b}`;
            colorCounts[key] = (colorCounts[key] || 0) + 1;
        }

        const sortedColors = Object.keys(colorCounts).sort((a, b) => colorCounts[b] - colorCounts[a]);
        const bgKey = sortedColors[0] || '255,255,255';
        const [bgR, bgG, bgB] = bgKey.split(',').map(Number);
        const bgBrightness = (bgR * 299 + bgG * 587 + bgB * 114) / 1000;

        const textColors = {};
        for (let i = 0; i < imgData.length; i += 4) {
            if (imgData[i + 3] < 200) continue;
            const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
            const bness = (r * 299 + g * 587 + b * 114) / 1000;
            const diff = Math.abs(bness - bgBrightness);

            if (diff >= 60) {
                const qr = Math.round(r / 6) * 6;
                const qg = Math.round(g / 6) * 6;
                const qb = Math.round(b / 6) * 6;
                const k = `${qr},${qg},${qb}`;
                textColors[k] = (textColors[k] || 0) + 1;
            }
        }

        const sortedText = Object.keys(textColors).sort((a, b) => textColors[b] - textColors[a]);
        let textR, textG, textB;

        if (sortedText.length > 0) {
            [textR, textG, textB] = sortedText[0].split(',').map(Number);
        } else {
            textR = bgBrightness < 128 ? 255 : 17;
            textG = bgBrightness < 128 ? 255 : 24;
            textB = bgBrightness < 128 ? 255 : 39;
        }

        const toHex = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
        const clampRatio = (val) => Math.min(1.0, Math.max(0.0, val / 255));

        return {
            bg: { 
                r: clampRatio(bgR), g: clampRatio(bgG), b: clampRatio(bgB), 
                hex: `#${toHex(bgR)}${toHex(bgG)}${toHex(bgB)}` 
            },
            text: { 
                r: clampRatio(textR), g: clampRatio(textG), b: clampRatio(textB), 
                hex: `#${toHex(textR)}${toHex(textG)}${toHex(textB)}` 
            }
        };
    } catch (e) {
        return {
            bg: { r: 1, g: 1, b: 1, hex: '#ffffff' },
            text: { r: 0.07, g: 0.09, b: 0.15, hex: '#111827' }
        };
    }
}

function getMatchedOriginalText(boxLeft, boxTop, boxWidth, boxHeight, textMetadata) {
    if (!textMetadata || textMetadata.length === 0) return null;

    const centerX = boxLeft + (boxWidth / 2);
    const centerY = boxTop + (boxHeight / 2);

    let target = textMetadata.find(item => 
        centerX >= item.x - 3 && centerX <= item.x + item.width + 3 &&
        centerY >= item.y - 4 && centerY <= item.y + item.height + 4 &&
        item.text && item.text.trim() !== ''
    );

    if (target) {
        const isBold = target.fontName ? (/bold|black|heavy|medium|semibold/i.test(target.fontName)) : false;
        const realFontSize = Math.round(target.fontSize);

        return {
            fontSize: Math.max(8, Math.min(32, realFontSize)),
            origX: target.x,
            origY: target.y,
            viewportY: target.viewportY,
            origPdfY: target.pdfY,
            origWidth: target.width,
            fontWeight: isBold ? '700' : '400',
            text: target.text
        };
    }

    return {
        fontSize: 9,
        fontWeight: '400',
        text: ''
    };
}

function bindSmartPatchEngine(wrapper, pageNum, pdfCanvas, textMetadata) {
    let startX = 0, startY = 0;
    let isDragging = false;
    let selectionBox = null;
    let touchStartTime = 0;

    wrapper.addEventListener('pointerdown', (e) => {
        if (currentTool !== 'patch' && currentTool !== 'rect' && currentTool !== 'circle') return;
        if (e.target.closest('.active-patch-node') || e.target.closest('.nudge-toolbar') || 
            e.target.closest('.shape-interactive-node') || e.target.closest('.shape-callout-bubble') ||
            e.target.closest('.custom-draggable-sig')) return;

        const coords = getPageAccurateCoords(e, wrapper);
        startX = coords.x;
        startY = coords.y;
        touchStartTime = Date.now();
        isDragging = true;

        selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box';
        if (currentTool === 'circle') selectionBox.style.borderRadius = '50%';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        wrapper.querySelector('.patch-layer').appendChild(selectionBox);
    });

    wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging || !selectionBox) return;
        const coords = getPageAccurateCoords(e, wrapper);

        const w = Math.abs(coords.x - startX);
        const h = Math.abs(coords.y - startY);
        selectionBox.style.width = w + 'px';
        selectionBox.style.height = h + 'px';
        selectionBox.style.left = Math.min(startX, coords.x) + 'px';
        selectionBox.style.top = Math.min(startY, coords.y) + 'px';
    });

    wrapper.addEventListener('pointerup', () => {
        if (!isDragging || !selectionBox) return;
        isDragging = false;

        let boxWidth = parseFloat(selectionBox.style.width) || 0;
        let boxHeight = parseFloat(selectionBox.style.height) || 0;
        let boxLeft = parseFloat(selectionBox.style.left) || 0;
        let boxTop = parseFloat(selectionBox.style.top) || 0;
        selectionBox.remove();
        selectionBox = null;

        const touchDuration = Date.now() - touchStartTime;

        if (boxWidth < 18 && boxHeight < 18 && touchDuration < 450 && currentTool === 'patch') {
            const hit = textMetadata.find(item => 
                startX >= item.x - 6 && startX <= item.x + item.width + 6 &&
                startY >= item.y - 6 && startY <= item.y + item.height + 6
            );

            if (hit) {
                const lineItems = textMetadata
                    .filter(item => Math.abs(item.y - hit.y) <= 4 && item.text && item.text.trim() !== '')
                    .sort((a, b) => a.x - b.x);

                const hitIdx = lineItems.findIndex(item => item === hit);

                let startWord = hit;
                for (let i = hitIdx - 1; i >= 0; i--) {
                    const prev = lineItems[i];
                    const gap = startWord.x - (prev.x + prev.width);
                    if (gap > 6 || /\s$/.test(prev.text) || /^\s/.test(startWord.text)) break;
                    startWord = prev;
                }

                let endWord = hit;
                for (let i = hitIdx + 1; i < lineItems.length; i++) {
                    const next = lineItems[i];
                    const gap = next.x - (endWord.x + endWord.width);
                    if (gap > 6 || /\s$/.test(endWord.text) || /^\s/.test(next.text)) break;
                    endWord = next;
                }

                boxLeft = startWord.x;
                boxTop = Math.min(hit.y, startWord.y, endWord.y);
                boxWidth = Math.max(16, (endWord.x + endWord.width) - startWord.x + 2);
                boxHeight = Math.max(hit.height, startWord.height, endWord.height);
            } else {
                boxLeft = Math.max(0, startX - 30);
                boxTop = Math.max(0, startY - 8);
                boxWidth = 70;
                boxHeight = 16;
            }
        }

        if (boxWidth < 6 || boxHeight < 6) return;

        if (currentTool === 'rect' || currentTool === 'circle') {
            createInteractiveShape(wrapper, pageNum, boxLeft, boxTop, boxWidth, boxHeight, currentTool, currentInkColor);
            return;
        }

        const colors = analyzeBoxColors(pdfCanvas, boxLeft, boxTop, boxWidth, boxHeight);
        const matchedOrig = getMatchedOriginalText(boxLeft, boxTop, boxWidth, boxHeight, textMetadata);

        createInPlaceInputBox(wrapper, pageNum, pdfCanvas, boxLeft, boxTop, boxWidth, boxHeight, colors, matchedOrig);
    });
}

// -------------------------------------------------------------
// Interactive Shape + Draggable Callout with Leader Line
// -------------------------------------------------------------
function createInteractiveShape(wrapper, pageNum, left, top, width, height, type, initialColor) {
    const layer = wrapper.querySelector('.patch-layer');
    const svgLayer = wrapper.querySelector('.leader-lines-svg');

    // 1. ตัวรูปทรงหลัก (Rectangle หรือ Circle)
    const shapeNode = document.createElement('div');
    shapeNode.className = `shape-interactive-node shape-${type}`;
    shapeNode.style.left = left + 'px';
    shapeNode.style.top = top + 'px';
    shapeNode.style.width = width + 'px';
    shapeNode.style.height = height + 'px';
    shapeNode.style.setProperty('--shape-color', initialColor);

    // ทูลบาร์ด่วนสำหรับตั้งค่า
    const toolbar = document.createElement('div');
    toolbar.className = 'shape-quick-toolbar';
    toolbar.innerHTML = `
        <span class="shape-color-dot" style="background:#ef4444" data-c="#ef4444"></span>
        <span class="shape-color-dot" style="background:#0033aa" data-c="#0033aa"></span>
        <span class="shape-color-dot" style="background:#111827" data-c="#111827"></span>
        <span class="shape-color-dot" style="background:#10b981" data-c="#10b981"></span>
        <input type="text" class="shape-note-input" placeholder="พิมพ์ข้อความชี้เป้า...">
        <button type="button" class="shape-confirm-btn" title="ยืนยันการตั้งค่า"><i class="fa-solid fa-check"></i> ตกลง</button>
        <button type="button" class="shape-del-btn" title="ลบ"><i class="fa-solid fa-trash-can"></i></button>
    `;
    shapeNode.appendChild(toolbar);

    // ด้ามจับยืดขยายมุม (Resize Handles)
    const handles = [];
    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
        const h = document.createElement('div');
        h.className = `shape-handle handle-${pos}`;
        shapeNode.appendChild(h);
        handles.push(h);
    });

    // 2. เส้นโยง Leader Line (SVG Line)
    const leaderLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leaderLine.setAttribute('stroke', initialColor);
    leaderLine.setAttribute('stroke-width', '2');
    leaderLine.setAttribute('stroke-linecap', 'round');
    leaderLine.setAttribute('stroke-dasharray', '3,3');
    leaderLine.style.display = 'none';
    svgLayer.appendChild(leaderLine);

    // 3. กล่องคอมเมนต์สีแดง (Draggable Red Callout Bubble)
    const calloutBubble = document.createElement('div');
    calloutBubble.className = 'shape-callout-bubble';
    calloutBubble.style.display = 'none';
    calloutBubble.style.setProperty('--shape-color', initialColor);
    calloutBubble.innerHTML = `
        <span class="callout-text"></span>
        <i class="fa-solid fa-pen callout-edit-icon" title="ดับเบิลคลิกเพื่อแก้คำ"></i>
    `;
    layer.appendChild(calloutBubble);

    let currentColor = initialColor;
    let noteText = '';
    const noteInput = toolbar.querySelector('.shape-note-input');

    // ข้อมูลสถานะของ Callout
    let calloutX = left + 10;
    let calloutY = Math.max(10, top - 36);

    const shapeData = {
        type: type,
        x: left,
        y: 0,
        width: width,
        height: height,
        color: currentColor,
        callout: null
    };

    function updateLeaderLine() {
        if (!noteText || calloutBubble.style.display === 'none') {
            leaderLine.style.display = 'none';
            return;
        }

        const sL = parseFloat(shapeNode.style.left) || 0;
        const sT = parseFloat(shapeNode.style.top) || 0;
        const sW = parseFloat(shapeNode.style.width) || 0;
        const sH = parseFloat(shapeNode.style.height) || 0;

        const bL = parseFloat(calloutBubble.style.left) || 0;
        const bT = parseFloat(calloutBubble.style.top) || 0;
        const bW = calloutBubble.offsetWidth || 70;
        const bH = calloutBubble.offsetHeight || 24;

        // จุดยึดรูปทรง (ขอบที่ใกล้กับกล่องคอมเมนต์ที่สุด)
        const shapeCenterX = sL + (sW / 2);
        const shapeCenterY = sT + (sH / 2);

        // จุดยึดของกล่องคอมเมนต์ (กึ่งกลางกล่อง)
        const bubbleCenterX = bL + (bW / 2);
        const bubbleCenterY = bT + (bH / 2);

        let anchorX = shapeCenterX;
        let anchorY = shapeCenterY;

        if (bubbleCenterY < sT) anchorY = sT; // กล่องอยู่ข้างบน
        else if (bubbleCenterY > sT + sH) anchorY = sT + sH; // กล่องอยู่ข้างล่าง

        if (bubbleCenterX < sL) anchorX = sL; // กล่องอยู่ทางซ้าย
        else if (bubbleCenterX > sL + sW) anchorX = sL + sW; // กล่องอยู่ทางขวา

        leaderLine.setAttribute('x1', anchorX);
        leaderLine.setAttribute('y1', anchorY);
        leaderLine.setAttribute('x2', bubbleCenterX);
        leaderLine.setAttribute('y2', bubbleCenterY);
        leaderLine.setAttribute('stroke', currentColor);
        leaderLine.style.display = 'block';

        const wH = parseFloat(wrapper.style.height) || 0;
        shapeData.callout = {
            text: noteText,
            x: bL,
            y: wH - (bT + bH), // แปลงเป็นระบบพิกัด PDF จากมุมล่างซ้าย
            width: bW,
            height: bH,
            anchorX: anchorX,
            anchorY: wH - anchorY,
            color: currentColor
        };
    }

    function syncShapeToData() {
        if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [], shapes: [] };
        if (!documentPatches[pageNum].shapes) documentPatches[pageNum].shapes = [];

        const curL = parseFloat(shapeNode.style.left) || 0;
        const curT = parseFloat(shapeNode.style.top) || 0;
        const curW = parseFloat(shapeNode.style.width) || 0;
        const curH = parseFloat(shapeNode.style.height) || 0;
        const wH = parseFloat(wrapper.style.height) || 0;

        shapeData.x = curL;
        shapeData.y = wH - (curT + curH);
        shapeData.width = curW;
        shapeData.height = curH;
        shapeData.color = currentColor;

        updateLeaderLine();

        if (!documentPatches[pageNum].shapes.includes(shapeData)) {
            documentPatches[pageNum].shapes.push(shapeData);
        }
    }

    toolbar.querySelectorAll('.shape-color-dot').forEach(dot => {
        dot.onclick = (e) => {
            e.stopPropagation();
            currentColor = dot.dataset.c;
            shapeNode.style.setProperty('--shape-color', currentColor);
            calloutBubble.style.setProperty('--shape-color', currentColor);
            syncShapeToData();
        };
    });

    toolbar.querySelector('.shape-del-btn').onclick = (e) => {
        e.stopPropagation();
        shapeNode.remove();
        calloutBubble.remove();
        leaderLine.remove();
        if (documentPatches[pageNum] && documentPatches[pageNum].shapes) {
            documentPatches[pageNum].shapes = documentPatches[pageNum].shapes.filter(s => s !== shapeData);
        }
        showToast("ลบรูปทรงแล้วค่ะ");
    };

    // ลากรูปทรงหลัก (Move Shape)
    let isMovingShape = false, startSX = 0, startSY = 0, origSL = left, origST = top;
    shapeNode.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.shape-handle') || e.target.closest('.shape-quick-toolbar')) return;
        isMovingShape = true;
        startSX = e.clientX; startSY = e.clientY;
        origSL = parseFloat(shapeNode.style.left);
        origST = parseFloat(shapeNode.style.top);
        shapeNode.setPointerCapture(e.pointerId);
    });
    shapeNode.addEventListener('pointermove', (e) => {
        if (!isMovingShape) return;
        const dx = (e.clientX - startSX) / currentScale;
        const dy = (e.clientY - startSY) / currentScale;
        shapeNode.style.left = (origSL + dx) + 'px';
        shapeNode.style.top = (origST + dy) + 'px';
        syncShapeToData();
    });
    shapeNode.addEventListener('pointerup', () => {
        if (isMovingShape) {
            isMovingShape = false;
            syncShapeToData();
        }
    });

    // 🎯 ลากกล่องคอมเมนต์สีแดง (Move Callout Bubble อิสระไปทั่วหน้าจอ)
    let isMovingCallout = false, startBX = 0, startBY = 0, origBL = 0, origBT = 0;
    calloutBubble.addEventListener('pointerdown', (e) => {
        isMovingCallout = true;
        startBX = e.clientX; startBY = e.clientY;
        origBL = parseFloat(calloutBubble.style.left) || 0;
        origBT = parseFloat(calloutBubble.style.top) || 0;
        calloutBubble.setPointerCapture(e.pointerId);
        e.stopPropagation();
    });
    calloutBubble.addEventListener('pointermove', (e) => {
        if (!isMovingCallout) return;
        const dx = (e.clientX - startBX) / currentScale;
        const dy = (e.clientY - startBY) / currentScale;
        calloutBubble.style.left = (origBL + dx) + 'px';
        calloutBubble.style.top = (origBT + dy) + 'px';
        updateLeaderLine();
    });
    calloutBubble.addEventListener('pointerup', () => {
        if (isMovingCallout) {
            isMovingCallout = false;
            syncShapeToData();
        }
    });

    function confirmShape() {
        noteText = noteInput.value.trim();
        if (noteText) {
            calloutBubble.querySelector('.callout-text').innerText = noteText;
            calloutBubble.style.display = 'flex';
            if (!calloutBubble.style.left) {
                calloutBubble.style.left = calloutX + 'px';
                calloutBubble.style.top = calloutY + 'px';
            }
        } else {
            calloutBubble.style.display = 'none';
            shapeData.callout = null;
        }

        toolbar.style.display = 'none';
        handles.forEach(h => h.style.display = 'none');
        syncShapeToData();
        showToast("ยืนยันรูปทรงและข้อความชี้เป้าเรียบร้อย (ลากกล่องแดงไปวางตำแหน่งที่ต้องการได้เลย)");
    }

    toolbar.querySelector('.shape-confirm-btn').onclick = (e) => {
        e.stopPropagation();
        confirmShape();
    };

    noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.stopPropagation();
            confirmShape();
        }
    });

    // ดับเบิลคลิกเพื่อแก้ไขข้อความ
    shapeNode.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        toolbar.style.display = 'flex';
        handles.forEach(h => h.style.display = 'block');
        noteInput.focus();
    });
    calloutBubble.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        toolbar.style.display = 'flex';
        handles.forEach(h => h.style.display = 'block');
        noteInput.focus();
    });

    layer.appendChild(shapeNode);
    syncShapeToData();

    recordAction({
        undo: () => { 
            shapeNode.style.display = 'none';
            calloutBubble.style.display = 'none';
            leaderLine.style.display = 'none';
            if (documentPatches[pageNum] && documentPatches[pageNum].shapes) {
                documentPatches[pageNum].shapes = documentPatches[pageNum].shapes.filter(s => s !== shapeData);
            }
        },
        redo: () => { 
            shapeNode.style.display = 'block'; 
            if (noteText) {
                calloutBubble.style.display = 'flex';
                leaderLine.style.display = 'block';
            }
            syncShapeToData();
        }
    });
}

// -------------------------------------------------------------
// กล่อง Input แก้คำ: ล็อกพิกัดตรงจุด ไม่กระโดด ไม่แลบกินขอบตาราง
// -------------------------------------------------------------
function createInPlaceInputBox(wrapper, pageNum, pdfCanvas, left, top, width, height, colors, matchedOrig) {
    const layer = wrapper.querySelector('.patch-layer');

    const fontSize = matchedOrig && matchedOrig.fontSize ? matchedOrig.fontSize : 9;
    let currentWeight = matchedOrig && matchedOrig.fontWeight ? matchedOrig.fontWeight : '400';
    
    const insetLeft = left;
    const insetTop = top;
    let insetWidth = Math.max(16, width);
    const insetHeight = Math.max(fontSize + 2, Math.round(height));

    const node = document.createElement('div');
    node.className = 'active-patch-node';
    node.style.left = insetLeft + 'px';
    node.style.top = insetTop + 'px';
    node.style.width = insetWidth + 'px';
    node.style.height = insetHeight + 'px';
    node.style.background = colors.bg.hex;

    const nudgeBar = document.createElement('div');
    nudgeBar.className = 'nudge-toolbar';
    nudgeBar.innerHTML = `
        <button type="button" class="nudge-btn ${currentWeight === '700' ? 'active' : ''}" id="nb-bold" title="สลับตัวหนา/ตัวปกติ"><strong>B</strong></button>
        <button type="button" class="nudge-btn" id="nb-left" title="ชิดซ้าย"><i class="fa-solid fa-align-left"></i></button>
        <button type="button" class="nudge-btn" id="nb-center" title="กึ่งกลาง"><i class="fa-solid fa-align-center"></i></button>
        <button type="button" class="nudge-btn" id="nb-right" title="ชิดขวา"><i class="fa-solid fa-align-right"></i></button>
        <button type="button" class="nudge-btn" id="nb-step-left" title="ขยับซ้าย 1px">◀</button>
        <button type="button" class="nudge-btn" id="nb-step-right" title="ขยับขวา 1px">▶</button>
        <button type="button" class="nudge-btn btn-done" id="nb-done" title="ตกลง ประทับลงเอกสาร"><i class="fa-solid fa-check"></i> เสร็จ</button>
    `;
    node.appendChild(nudgeBar);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = matchedOrig && matchedOrig.text ? matchedOrig.text : 'พิมพ์คำใหม่...';
    input.className = 'patch-input-inline';
    input.style.color = colors.text.hex;
    input.style.fontSize = fontSize + 'px';
    input.style.fontWeight = currentWeight;
    input.style.lineHeight = '1';
    node.appendChild(input);

    const textPreview = document.createElement('div');
    textPreview.className = 'patch-text-preview';
    textPreview.style.color = colors.text.hex;
    textPreview.style.fontSize = fontSize + 'px';
    textPreview.style.fontWeight = currentWeight;
    textPreview.style.display = 'none';
    node.appendChild(textPreview);

    let currentOffsetX = 0;
    let currentAlign = 'left';
    let isAdjustMode = false;

    input.addEventListener('input', () => {
        const tempSpan = document.createElement('span');
        tempSpan.style.font = `${currentWeight} ${fontSize}px 'Sarabun', sans-serif`;
        tempSpan.style.visibility = 'hidden';
        tempSpan.style.position = 'absolute';
        tempSpan.innerText = input.value || input.placeholder;
        document.body.appendChild(tempSpan);
        const textW = tempSpan.offsetWidth + 8;
        tempSpan.remove();

        if (textW > insetWidth) {
            node.style.width = textW + 'px';
        }
    });

    function updatePreviewPosition() {
        textPreview.style.textAlign = currentAlign;
        if (currentAlign === 'right') {
            textPreview.style.paddingRight = '2px';
            textPreview.style.paddingLeft = '0px';
        } else if (currentAlign === 'center') {
            textPreview.style.paddingLeft = '0px';
            textPreview.style.paddingRight = '0px';
        } else {
            textPreview.style.paddingLeft = currentOffsetX + 'px';
            textPreview.style.paddingRight = '0px';
        }
    }

    nudgeBar.querySelector('#nb-bold').onclick = (e) => {
        e.stopPropagation();
        currentWeight = currentWeight === '700' ? '400' : '700';
        input.style.fontWeight = currentWeight;
        textPreview.style.fontWeight = currentWeight;
        nudgeBar.querySelector('#nb-bold').classList.toggle('active', currentWeight === '700');
    };

    nudgeBar.querySelector('#nb-step-left').onclick = (e) => {
        e.stopPropagation();
        currentOffsetX -= 1;
        input.style.paddingLeft = Math.max(0, currentOffsetX) + 'px';
        updatePreviewPosition();
    };
    nudgeBar.querySelector('#nb-step-right').onclick = (e) => {
        e.stopPropagation();
        currentOffsetX += 1;
        input.style.paddingLeft = currentOffsetX + 'px';
        updatePreviewPosition();
    };
    nudgeBar.querySelector('#nb-center').onclick = (e) => {
        e.stopPropagation();
        currentAlign = 'center';
        input.style.textAlign = 'center';
        updatePreviewPosition();
    };
    nudgeBar.querySelector('#nb-left').onclick = (e) => {
        e.stopPropagation();
        currentAlign = 'left';
        input.style.textAlign = 'left';
        updatePreviewPosition();
    };
    nudgeBar.querySelector('#nb-right').onclick = (e) => {
        e.stopPropagation();
        currentAlign = 'right';
        input.style.textAlign = 'right';
        updatePreviewPosition();
    };
    nudgeBar.querySelector('#nb-done').onclick = (e) => {
        e.stopPropagation();
        commitFinalToCanvas();
    };

    layer.appendChild(node);
    setTimeout(() => input.focus(), 50);

    function enterAdjustMode() {
        const text = input.value.trim();
        if (!text) {
            node.remove();
            return;
        }

        isAdjustMode = true;
        input.style.display = 'none';
        node.style.border = '1px dashed var(--accent)';

        textPreview.innerText = text;
        textPreview.style.display = 'block';
        updatePreviewPosition();

        showToast("ขยับซ้าย-ขวาเพื่อจัดแนว แล้วกด Enter หรือแตะ 'เสร็จ'");
    }

    function handleKeyNudge(e) {
        if (!isAdjustMode) return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            currentOffsetX -= 1;
            updatePreviewPosition();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            currentOffsetX += 1;
            updatePreviewPosition();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            commitFinalToCanvas();
        }
    }

    window.addEventListener('keydown', handleKeyNudge);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            enterAdjustMode();
        } else if (e.key === 'Escape') {
            window.removeEventListener('keydown', handleKeyNudge);
            node.remove();
        }
    });

    function commitFinalToCanvas() {
        window.removeEventListener('keydown', handleKeyNudge);
        const text = input.value.trim();
        node.remove();

        if (!text) return;

        const ctx = pdfCanvas.getContext('2d');
        const ratioX = pdfCanvas.width / parseFloat(pdfCanvas.style.width || (pdfCanvas.width / 2));
        const ratioY = pdfCanvas.height / parseFloat(pdfCanvas.style.height || (pdfCanvas.height / 2));

        const canvasFontSize = fontSize * ratioY;
        ctx.font = `${currentWeight} ${canvasFontSize}px 'Sarabun', sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidthOnCanvas = metrics.width;
        
        const finalBoxW = parseFloat(node.style.width) || insetWidth;
        const clearWidth = Math.max(finalBoxW * ratioX, textWidthOnCanvas + (4 * ratioX));

        ctx.fillStyle = colors.bg.hex;
        ctx.fillRect(insetLeft * ratioX, insetTop * ratioY, clearWidth, insetHeight * ratioY);

        let drawX = (insetLeft + currentOffsetX) * ratioX;
        if (currentAlign === 'right') {
            drawX = (insetLeft * ratioX) + clearWidth - textWidthOnCanvas - (2 * ratioX);
        } else if (currentAlign === 'center') {
            drawX = (insetLeft * ratioX) + ((clearWidth - textWidthOnCanvas) / 2);
        }

        const drawBaselineY = (insetTop + (fontSize * 0.88)) * ratioY;

        ctx.fillStyle = colors.text.hex;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, drawX, drawBaselineY);

        const wrapperHeight = parseFloat(wrapper.style.height);
        const finalPdfX = drawX / ratioX;
        const finalPdfY = wrapperHeight - insetTop - (fontSize * 0.88);
        const finalBoxY = wrapperHeight - (insetTop + insetHeight);

        if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [], shapes: [] };
        
        const patchData = {
            x: finalPdfX,
            boxLeft: insetLeft,
            y: finalPdfY,
            patchBoxY: finalBoxY,
            width: (clearWidth / ratioX),
            height: insetHeight,
            text: text,
            fontSize: fontSize,
            fontWeight: currentWeight,
            bgColor: colors.bg,
            textColor: colors.text
        };

        documentPatches[pageNum].patches.push(patchData);

        createReEditHotspot(wrapper, pageNum, pdfCanvas, insetLeft, insetTop, (clearWidth / ratioX), insetHeight, colors, matchedOrig, text);
        
        recordAction({
            undo: () => {
                documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
                pdfDoc.getPage(pageNum).then(p => {
                    const vp = p.getViewport({ scale: 2.0 });
                    p.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp });
                });
            },
            redo: () => {
                documentPatches[pageNum].patches.push(patchData);
                ctx.fillStyle = colors.bg.hex;
                ctx.fillRect(insetLeft * ratioX, insetTop * ratioY, clearWidth, insetHeight * ratioY);
                ctx.font = `${currentWeight} ${canvasFontSize}px 'Sarabun', sans-serif`;
                ctx.fillStyle = colors.text.hex;
                ctx.fillText(text, drawX, drawBaselineY);
            }
        });

        showToast("ประทับข้อความลงเอกสารเรียบร้อยแล้วค่ะ");
    }
}

function createReEditHotspot(wrapper, pageNum, pdfCanvas, left, top, width, height, colors, matchedOrig, currentText) {
    const layer = wrapper.querySelector('.patch-layer');
    const hotspot = document.createElement('div');
    hotspot.className = 'canvas-hotspot';
    hotspot.style.left = left + 'px';
    hotspot.style.top = top + 'px';
    hotspot.style.width = width + 'px';
    hotspot.style.height = height + 'px';

    hotspot.addEventListener('dblclick', () => {
        hotspot.remove();
        createInPlaceInputBox(wrapper, pageNum, pdfCanvas, left, top, width, height, colors, matchedOrig);
    });

    layer.appendChild(hotspot);
}

function bindDrawingEngine(canvas, pageNum) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0, lastY = 0;

    function getCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: ((clientX - rect.left) / rect.width) * canvas.width,
            y: ((clientY - rect.top) / rect.height) * canvas.height
        };
    }

    function startDraw(e) {
        if (currentTool !== 'pen' && currentTool !== 'highlighter' && currentTool !== 'eraser') return;
        if (e.touches && e.touches.length > 1) return;
        const c = getCoords(e);
        isDrawing = true; lastX = c.x; lastY = c.y;
    }

    function moveDraw(e) {
        if (!isDrawing) return;
        if (e.cancelable) e.preventDefault();
        const c = getCoords(e);

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(c.x, c.y);

        if (currentTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = currentInkColor;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        } else if (currentTool === 'highlighter') {
            ctx.globalCompositeOperation = 'multiply';
            ctx.strokeStyle = currentInkColor === '#ef4444' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(0, 51, 170, 0.3)';
            ctx.lineWidth = 24;
            ctx.lineCap = 'square';
            ctx.stroke();
        } else if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 30;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        lastX = c.x; lastY = c.y;
    }

    function endDraw() { isDrawing = false; }

    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    window.addEventListener('pointerup', endDraw);
}

function openSignatureModal() {
    document.getElementById('sig-modal').style.display = 'flex';
    clearSigCanvas();
}
function closeSignatureModal() {
    document.getElementById('sig-modal').style.display = 'none';
}
function switchSigTab(tab) {
    document.getElementById('tab-draw').className = tab === 'draw' ? 'active' : '';
    document.getElementById('tab-upload').className = tab === 'upload' ? 'active' : '';
    document.getElementById('pane-draw').style.display = tab === 'draw' ? 'block' : 'none';
    document.getElementById('pane-upload').style.display = tab === 'upload' ? 'block' : 'none';
}
function clearSigCanvas() {
    if (sigCtx && sigCanvas) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}
function setSigInkColor(c) { sigColor = c; }

function handleSigUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        uploadedSigBase64 = ev.target.result;
        document.getElementById('img-preview').src = uploadedSigBase64;
        document.getElementById('preview-upload-box').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function placeSignatureOnDoc() {
    let dataUrl = null;
    const isDraw = document.getElementById('tab-draw').classList.contains('active');
    dataUrl = isDraw ? sigCanvas.toDataURL('image/png') : uploadedSigBase64;

    if (!dataUrl) { alert("กรุณาวาดลายเซ็นหรือเลือกรูปภาพก่อนค่ะ!"); return; }

    const firstPage = document.querySelector('.page-wrapper');
    if (!firstPage) return;
    const layer = firstPage.querySelector('.patch-layer');

    const sigNode = document.createElement('div');
    sigNode.className = 'custom-draggable-sig';
    sigNode.style.width = '140px';
    sigNode.style.height = '60px';
    sigNode.style.left = '50%';
    sigNode.style.top = '50%';

    const img = document.createElement('img');
    img.src = dataUrl;
    sigNode.appendChild(img);

    const del = document.createElement('div');
    del.className = 'btn-del-sig';
    del.innerHTML = '&times;';
    del.onclick = () => sigNode.remove();
    sigNode.appendChild(del);

    let isDrag = false, startX = 0, startY = 0, sL = 0, sT = 0;
    sigNode.addEventListener('pointerdown', (e) => {
        isDrag = true;
        startX = e.clientX; startY = e.clientY;
        sL = parseFloat(sigNode.style.left); sT = parseFloat(sigNode.style.top);
        sigNode.setPointerCapture(e.pointerId);
    });
    sigNode.addEventListener('pointermove', (e) => {
        if (!isDrag) return;
        const dx = (e.clientX - startX) / currentScale;
        const dy = (e.clientY - startY) / currentScale;
        sigNode.style.left = (sL + dx) + 'px';
        sigNode.style.top = (sT + dy) + 'px';
    });
    sigNode.addEventListener('pointerup', () => {
        isDrag = false;
        const pageNum = parseInt(firstPage.dataset.pageNumber);
        const wH = parseFloat(firstPage.style.height);
        const w = 140, h = 60;
        const left = parseFloat(sigNode.style.left);
        const top = parseFloat(sigNode.style.top);

        if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [], shapes: [] };
        documentPatches[pageNum].images.push({
            x: left - (w / 2),
            y: wH - (top + (h / 2)),
            width: w,
            height: h,
            base64: dataUrl
        });
    });

    layer.appendChild(sigNode);
    closeSignatureModal();
    showToast("วางลายเซ็นเรียบร้อยแล้ว ลากเพื่อปรับตำแหน่งได้เลยค่ะ");
}

// -------------------------------------------------------------
// ส่งออก Vector PDF (เรนเดอร์ Shape, เส้นโยง และกล่องคอมเมนต์สีแดงคมชัด)
// -------------------------------------------------------------
async function exportVectorPDF() {
    if (!originalPdfBytes) { alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!"); return; }

    try {
        showToast("กำลังสร้างไฟล์ PDF คมชัดระดับเวกเตอร์...");
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const loadedPdf = await PDFDocument.load(originalPdfBytes);
        
        let thaiFont = null;
        try {
            loadedPdf.registerFontkit(fontkit);
            if (!cachedFontBytes) {
                const res = await fetch(THAI_FONT_URL);
                if (!res.ok) throw new Error("ดาวน์โหลดฟอนต์ล้มเหลว");
                cachedFontBytes = await res.arrayBuffer();
            }
            thaiFont = await loadedPdf.embedFont(cachedFontBytes);
        } catch (fontErr) {
            console.warn("สลับใช้ฟอนต์มาตรฐานแทน:", fontErr);
            thaiFont = await loadedPdf.embedFont(StandardFonts.Helvetica);
        }

        const pages = loadedPdf.getPages();

        for (let pageNum in documentPatches) {
            const pIdx = parseInt(pageNum) - 1;
            if (pIdx < 0 || pIdx >= pages.length) continue;
            const targetPage = pages[pIdx];
            const pData = documentPatches[pageNum];

            // 1. เรนเดอร์การแก้ไขคำในตาราง (Patches)
            if (pData.patches) {
                pData.patches.forEach(pt => {
                    const safeBgR = Math.min(1.0, Math.max(0.0, pt.bgColor.r));
                    const safeBgG = Math.min(1.0, Math.max(0.0, pt.bgColor.g));
                    const safeBgB = Math.min(1.0, Math.max(0.0, pt.bgColor.b));

                    const safeTxtR = Math.min(1.0, Math.max(0.0, pt.textColor.r));
                    const safeTxtG = Math.min(1.0, Math.max(0.0, pt.textColor.g));
                    const safeTxtB = Math.min(1.0, Math.max(0.0, pt.textColor.b));

                    targetPage.drawRectangle({
                        x: pt.boxLeft,
                        y: pt.patchBoxY,
                        width: pt.width,
                        height: pt.height,
                        color: rgb(safeBgR, safeBgG, safeBgB),
                    });

                    targetPage.drawText(pt.text, {
                        x: pt.x,
                        y: pt.y,
                        size: pt.fontSize,
                        font: thaiFont,
                        color: rgb(safeTxtR, safeTxtG, safeTxtB),
                    });
                });
            }

            // 2. เรนเดอร์รูปทรง + เส้นโยง + กล่องคอมเมนต์สีแดง (Shapes & Callouts)
            if (pData.shapes) {
                pData.shapes.forEach(sh => {
                    const hexToRgb = (hex) => {
                        const num = parseInt(hex.replace('#', ''), 16);
                        return rgb(
                            Math.min(1, Math.max(0, (num >> 16 & 255) / 255)),
                            Math.min(1, Math.max(0, (num >> 8 & 255) / 255)),
                            Math.min(1, Math.max(0, (num & 255) / 255))
                        );
                    };
                    const shapeColor = hexToRgb(sh.color);

                    // วาดกรอบสี่เหลี่ยมหรือวงกลม
                    if (sh.type === 'rect') {
                        targetPage.drawRectangle({
                            x: sh.x,
                            y: sh.y,
                            width: sh.width,
                            height: sh.height,
                            borderColor: shapeColor,
                            borderWidth: 2.0,
                        });
                    } else if (sh.type === 'circle') {
                        targetPage.drawEllipse({
                            x: sh.x + (sh.width / 2),
                            y: sh.y + (sh.height / 2),
                            xScale: sh.width / 2,
                            yScale: sh.height / 2,
                            borderColor: shapeColor,
                            borderWidth: 2.0,
                        });
                    }

                    // วาดเส้นโยงและกล่องคอมเมนต์สีแดง (ถ้ามีข้อความ)
                    if (sh.callout && sh.callout.text && sh.callout.text.trim() !== '') {
                        const callout = sh.callout;
                        const calloutColor = hexToRgb(callout.color || sh.color);

                        // ลากเส้นโยง (Leader Line)
                        targetPage.drawLine({
                            start: { x: callout.anchorX, y: callout.anchorY },
                            end: { x: callout.x + (callout.width / 2), y: callout.y + (callout.height / 2) },
                            thickness: 1.5,
                            color: calloutColor,
                            dashArray: [3, 3]
                        });

                        // วาดพื้นหลังกล่องคอมเมนต์สีแดง
                        targetPage.drawRectangle({
                            x: callout.x,
                            y: callout.y,
                            width: callout.width,
                            height: callout.height,
                            color: calloutColor,
                        });

                        // พิมพ์ข้อความสีขาวลงในกล่องคอมเมนต์
                        targetPage.drawText(callout.text, {
                            x: callout.x + 8,
                            y: callout.y + (callout.height * 0.28),
                            size: 11,
                            font: thaiFont,
                            color: rgb(1, 1, 1),
                        });
                    }
                });
            }

            // 3. เรนเดอร์ลายเซ็น/ตราประทับ
            if (pData.images) {
                for (let img of pData.images) {
                    try {
                        const imgB = await fetch(img.base64).then(r => r.arrayBuffer());
                        const embeddedImg = await loadedPdf.embedPng(imgB);
                        targetPage.drawImage(embeddedImg, {
                            x: img.x, y: img.y, width: img.width, height: img.height
                        });
                    } catch (err) {}
                }
            }
        }

        // 4. เรนเดอร์เลเยอร์วาดเขียนไฮไลต์จาก Canvas
        const wrappers = document.querySelectorAll('.page-wrapper');
        for (let idx = 0; idx < wrappers.length; idx++) {
            const c = wrappers[idx].querySelector('.annotation-canvas');
            const targetPage = pages[idx];
            try {
                const drawData = c.toDataURL('image/png');
                const imgBytes = await fetch(drawData).then(r => r.arrayBuffer());
                const embedded = await loadedPdf.embedPng(imgBytes);
                targetPage.drawImage(embedded, {
                    x: 0, y: 0, width: targetPage.getWidth(), height: targetPage.getHeight()
                });
            } catch (e) {}
        }

        const pdfBytes = await loadedPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${originalFileName}_ProEdited.pdf`;
        a.click();
        URL.revokeObjectURL(url);

        showToast("ส่งออกไฟล์ PDF คมชัดระดับเวกเตอร์สำเร็จแล้วค่ะ!");
    } catch (err) {
        alert("เกิดข้อผิดพลาดในการส่งออกไฟล์: " + err.message);
    }
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tool-${tool}`);
    if (btn) btn.classList.add('active');

    document.body.className = document.body.className.replace(/tool-\S+/g, '').trim();
    document.body.classList.add(`tool-${tool}`);

    const ws = document.querySelector('.workspace');
    if (tool === 'pan') ws.style.cursor = 'grab';
    else ws.style.cursor = 'crosshair';
}

function selectInkColor(color, el) {
    currentInkColor = color;
    document.querySelectorAll('.color-circle').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    if (currentTool === 'eraser' || currentTool === 'pan') {
        setTool('pen');
    }
}

function zoomDoc(delta) {
    currentScale += delta;
    if (currentScale < 0.4) currentScale = 0.4;
    if (currentScale > 3.0) currentScale = 3.0;
    const c = document.getElementById('document-container');
    if (c) c.style.transform = `scale(${currentScale})`;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('upload-pdf').addEventListener('change', handleFileOpen);
    initTabletGestures();

    sigCanvas = document.getElementById('sig-canvas');
    if (sigCanvas) {
        sigCtx = sigCanvas.getContext('2d');
        sigCtx.lineWidth = 2.5;
        sigCtx.lineCap = 'round';
        
        function getCoords(e) {
            const r = sigCanvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        sigCanvas.addEventListener('pointerdown', (e) => {
            isDrawingSig = true;
            const c = getCoords(e);
            sigCtx.beginPath();
            sigCtx.moveTo(c.x, c.y);
            sigCanvas.setPointerCapture(e.pointerId);
        });
        sigCanvas.addEventListener('pointermove', (e) => {
            if (!isDrawingSig) return;
            const c = getCoords(e);
            sigCtx.strokeStyle = sigColor;
            sigCtx.lineTo(c.x, c.y);
            sigCtx.stroke();
        });
        window.addEventListener('pointerup', () => isDrawingSig = false);
    }
});
