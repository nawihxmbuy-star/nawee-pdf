const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Global States
let currentTool = 'patch';
let currentInkColor = '#ef4444';
let currentScale = 1.0;
let pdfDoc = null;
let originalPdfBytes = null;
let originalFileName = 'Sunita_Document';

let documentPatches = {};
let undoStack = [];
let redoStack = [];

// ฟอนต์ภาษาไทยแท้สำหรับ Vector PDF (Regular + Bold)
const THAI_FONT_REGULAR_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Regular.ttf';
const THAI_FONT_BOLD_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Bold.ttf';

let cachedRegularFontBytes = null;
let cachedBoldFontBytes = null;

let sigCanvas, sigCtx, isDrawingSig = false, sigColor = '#0033aa', uploadedSigBase64 = null;

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
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

// 🎯 ซูมเอกสารด้วย Ctrl + Mouse Wheel (คีย์ลัดงานเขียนแบบ CAD/Drawing)
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomStep = 0.08;
        if (e.deltaY < 0) {
            zoomDoc(zoomStep);
        } else {
            zoomDoc(-zoomStep);
        }
    }
}, { passive: false });

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
    showToast(`เปิดเอกสารเรียบร้อย (${pdfDoc.numPages} หน้า) - พร้อมแก้ไขค่ะ`);
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

        const angleRad = Math.atan2(item.transform[1], item.transform[0]);
        let angleDeg = Math.round(angleRad * (180 / Math.PI));
        if (angleDeg < 0) angleDeg += 360;
        const snappedRotation = (Math.round(angleDeg / 90) * 90) % 360;

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
            viewportY: top,
            rotation: snappedRotation
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
                targetScale = Math.max(0.4, Math.min(3.5, targetScale));
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
        centerX >= item.x - 4 && centerX <= item.x + item.width + 4 &&
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
            text: target.text,
            rotation: target.rotation || 0
        };
    }

    return {
        fontSize: 10,
        fontWeight: '400',
        text: '',
        rotation: 0
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
            e.target.closest('.floating-patch-text') || e.target.closest('.custom-draggable-sig')) return;

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
                boxLeft = hit.x;
                boxTop = hit.y;
                boxWidth = Math.max(16, hit.width + 2);
                boxHeight = hit.height;
            } else {
                boxLeft = Math.max(0, startX - 25);
                boxTop = Math.max(0, startY - 8);
                boxWidth = 50;
                boxHeight = 16;
            }
        }

        if (boxWidth < 4 || boxHeight < 4) return;

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

    const shapeNode = document.createElement('div');
    shapeNode.className = `shape-interactive-node shape-${type}`;
    shapeNode.style.left = left + 'px';
    shapeNode.style.top = top + 'px';
    shapeNode.style.width = width + 'px';
    shapeNode.style.height = height + 'px';
    shapeNode.style.setProperty('--shape-color', initialColor);

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

    const handles = [];
    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
        const h = document.createElement('div');
        h.className = `shape-handle handle-${pos}`;
        shapeNode.appendChild(h);
        handles.push(h);
    });

    const leaderLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leaderLine.setAttribute('stroke', initialColor);
    leaderLine.setAttribute('stroke-width', '2');
    leaderLine.setAttribute('stroke-linecap', 'round');
    leaderLine.setAttribute('stroke-dasharray', '3,3');
    leaderLine.style.display = 'none';
    svgLayer.appendChild(leaderLine);

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

        const shapeCenterX = sL + (sW / 2);
        const shapeCenterY = sT + (sH / 2);

        const bubbleCenterX = bL + (bW / 2);
        const bubbleCenterY = bT + (bH / 2);

        let anchorX = shapeCenterX;
        let anchorY = shapeCenterY;

        if (bubbleCenterY < sT) anchorY = sT;
        else if (bubbleCenterY > sT + sH) anchorY = sT + sH;

        if (bubbleCenterX < sL) anchorX = sL;
        else if (bubbleCenterX > sL + sW) anchorX = sL + sW;

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
            y: wH - (bT + bH),
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
        showToast("ยืนยันรูปทรงและข้อความชี้เป้าเรียบร้อย");
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
// กล่อง Input: หมุนกึ่งกลาง ไม่เหวี่ยง + จบงานเป็น Draggable Text
// -------------------------------------------------------------
function createInPlaceInputBox(wrapper, pageNum, pdfCanvas, left, top, width, height, colors, matchedOrig) {
    const layer = wrapper.querySelector('.patch-layer');

    const fontSize = matchedOrig && matchedOrig.fontSize ? matchedOrig.fontSize : 10;
    let currentWeight = matchedOrig && matchedOrig.fontWeight ? matchedOrig.fontWeight : '400';
    let currentRotation = matchedOrig && matchedOrig.rotation !== undefined ? matchedOrig.rotation : 0;
    
    const insetLeft = left;
    const insetTop = top;
    let insetWidth = Math.max(20, width);
    const tightBoxHeight = Math.max(fontSize + 2, Math.round(fontSize * 1.15));

    const node = document.createElement('div');
    node.className = 'active-patch-node';
    node.style.left = insetLeft + 'px';
    node.style.top = insetTop + 'px';
    node.style.width = insetWidth + 'px';
    node.style.height = tightBoxHeight + 'px';
    node.style.background = colors.bg.hex;
    // 🎯 หมุนจากกึ่งกลางตัวกล่อง ป้องกันการเหวี่ยงกระเด็น
    node.style.transformOrigin = 'center center';
    node.style.transform = `rotate(${currentRotation}deg)`;

    const nudgeBar = document.createElement('div');
    nudgeBar.className = 'nudge-toolbar';
    nudgeBar.innerHTML = `
        <button type="button" class="nudge-btn ${currentWeight === '700' ? 'active' : ''}" id="nb-bold" title="สลับตัวหนา/ตัวปกติ"><strong>B</strong></button>
        <button type="button" class="nudge-btn" id="nb-rotate" title="หมุนองศา"><i class="fa-solid fa-rotate"></i> <span id="rot-deg">${currentRotation}°</span></button>
        <button type="button" class="nudge-btn btn-done" id="nb-done" title="ตกลง"><i class="fa-solid fa-check"></i> ตกลง</button>
    `;
    node.appendChild(nudgeBar);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = matchedOrig && matchedOrig.text ? matchedOrig.text : '';
    input.placeholder = 'พิมพ์ตัวเลข/ข้อความ...';
    input.className = 'patch-input-inline';
    input.style.color = colors.text.hex;
    input.style.fontSize = fontSize + 'px';
    input.style.fontWeight = currentWeight;
    input.style.lineHeight = '1';
    node.appendChild(input);

    input.addEventListener('input', () => {
        const tempSpan = document.createElement('span');
        tempSpan.style.font = `${currentWeight} ${fontSize}px 'Sarabun', sans-serif`;
        tempSpan.style.visibility = 'hidden';
        tempSpan.innerText = input.value || input.placeholder;
        document.body.appendChild(tempSpan);
        const textW = tempSpan.offsetWidth + 6;
        tempSpan.remove();

        if (textW > insetWidth) {
            node.style.width = textW + 'px';
        }
    });

    nudgeBar.querySelector('#nb-bold').onclick = (e) => {
        e.stopPropagation();
        currentWeight = currentWeight === '700' ? '400' : '700';
        input.style.fontWeight = currentWeight;
        nudgeBar.querySelector('#nb-bold').classList.toggle('active', currentWeight === '700');
    };

    nudgeBar.querySelector('#nb-rotate').onclick = (e) => {
        e.stopPropagation();
        currentRotation = (currentRotation + 90) % 360;
        node.style.transform = `rotate(${currentRotation}deg)`;
        nudgeBar.querySelector('#rot-deg').innerText = `${currentRotation}°`;
    };

    nudgeBar.querySelector('#nb-done').onclick = (e) => {
        e.stopPropagation();
        commitToDraggableNode();
    };

    layer.appendChild(node);
    setTimeout(() => { input.focus(); input.select(); }, 50);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitToDraggableNode();
        else if (e.key === 'Escape') node.remove();
    });

    function commitToDraggableNode() {
        const text = input.value.trim();
        const finalW = parseFloat(node.style.width) || insetWidth;
        node.remove();
        if (!text) return;

        // ถมสีพื้นลบคำเดิมบน Canvas แบบแนบชิด (Zero-Bleed) ไม่ตัดเส้นแบบ
        const ctx = pdfCanvas.getContext('2d');
        const ratioX = pdfCanvas.width / parseFloat(pdfCanvas.style.width || (pdfCanvas.width / 2));
        const ratioY = pdfCanvas.height / parseFloat(pdfCanvas.style.height || (pdfCanvas.height / 2));
        
        ctx.save();
        ctx.translate((insetLeft + (finalW / 2)) * ratioX, (insetTop + (tightBoxHeight / 2)) * ratioY);
        ctx.rotate((currentRotation * Math.PI) / 180);
        ctx.fillStyle = colors.bg.hex;
        ctx.fillRect(-(finalW * ratioX) / 2, -(tightBoxHeight * ratioY) / 2, finalW * ratioX, tightBoxHeight * ratioY);
        ctx.restore();

        // สร้าง Element ข้อความแบบยกย้ายอิสระ (Draggable Floating Text)
        createFloatingTextItem(wrapper, pageNum, pdfCanvas, insetLeft, insetTop, finalW, tightBoxHeight, text, fontSize, currentWeight, currentRotation, colors, matchedOrig);
    }
}

// -------------------------------------------------------------
// Element ข้อความลอย: จับลากย้ายตรงไหนก็ได้ + ปุ่มลบ + ดับเบิลคลิกแก้คำ
// -------------------------------------------------------------
function createFloatingTextItem(wrapper, pageNum, pdfCanvas, left, top, width, height, text, fontSize, fontWeight, rotation, colors, matchedOrig) {
    const layer = wrapper.querySelector('.patch-layer');
    const wH = parseFloat(wrapper.style.height);

    const item = document.createElement('div');
    item.className = 'floating-patch-text';
    item.style.position = 'absolute';
    item.style.left = left + 'px';
    item.style.top = top + 'px';
    item.style.minWidth = width + 'px';
    item.style.height = height + 'px';
    item.style.background = colors.bg.hex;
    item.style.color = colors.text.hex;
    item.style.fontSize = fontSize + 'px';
    item.style.fontWeight = fontWeight;
    item.style.transformOrigin = 'center center';
    item.style.transform = `rotate(${rotation}deg)`;
    item.style.cursor = 'grab';
    item.style.zIndex = '98';
    item.style.display = 'inline-flex';
    item.style.alignItems = 'center';
    item.style.padding = '0 2px';
    item.style.border = '1px dashed var(--accent)';
    item.style.borderRadius = '3px';
    item.style.pointerEvents = 'auto';
    item.innerText = text;

    const delBtn = document.createElement('span');
    delBtn.innerHTML = '&times;';
    delBtn.style.cssText = 'position:absolute; top:-7px; right:-7px; width:15px; height:15px; background:#ef4444; color:#fff; border-radius:50%; font-size:10px; display:none; align-items:center; justify-content:center; cursor:pointer; border:1px solid #fff;';
    item.appendChild(delBtn);

    item.onmouseenter = () => delBtn.style.display = 'flex';
    item.onmouseleave = () => delBtn.style.display = 'none';

    layer.appendChild(item);

    if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [], shapes: [] };

    const patchData = {
        boxLeft: left,
        patchBoxY: wH - (top + height),
        width: width,
        height: height,
        text: text,
        fontSize: fontSize,
        fontWeight: fontWeight,
        rotation: rotation,
        bgColor: colors.bg,
        textColor: colors.text
    };
    documentPatches[pageNum].patches.push(patchData);

    function syncPosition() {
        const curL = parseFloat(item.style.left);
        const curT = parseFloat(item.style.top);
        patchData.boxLeft = curL;
        patchData.patchBoxY = wH - (curT + height);
    }

    // ลากย้ายตำแหน่งอย่างอิสระ (Drag & Drop)
    let isDragging = false, startX = 0, startY = 0, origL = left, origT = top;
    item.addEventListener('pointerdown', (e) => {
        if (e.target === delBtn) return;
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        origL = parseFloat(item.style.left);
        origT = parseFloat(item.style.top);
        item.style.cursor = 'grabbing';
        item.setPointerCapture(e.pointerId);
    });

    item.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - startX) / currentScale;
        const dy = (e.clientY - startY) / currentScale;
        item.style.left = (origL + dx) + 'px';
        item.style.top = (origT + dy) + 'px';
        syncPosition();
    });

    item.addEventListener('pointerup', () => {
        if (isDragging) {
            isDragging = false;
            item.style.cursor = 'grab';
            syncPosition();
            showToast("ย้ายตำแหน่งข้อความเรียบร้อยค่ะ");
        }
    });

    // ดับเบิลคลิกเพื่อแก้คำ
    item.addEventListener('dblclick', () => {
        documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
        item.remove();
        createInPlaceInputBox(wrapper, pageNum, pdfCanvas, parseFloat(item.style.left), parseFloat(item.style.top), width, height, colors, { ...matchedOrig, text: text, rotation: rotation });
    });

    // ลบข้อความ
    delBtn.onclick = (e) => {
        e.stopPropagation();
        documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
        item.remove();
        showToast("ลบข้อความแล้วค่ะ");
    };

    recordAction({
        undo: () => {
            item.style.display = 'none';
            documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
        },
        redo: () => {
            item.style.display = 'inline-flex';
            documentPatches[pageNum].patches.push(patchData);
        }
    });
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
// ส่งออก Vector PDF (คมชัด 100% รองรับ Rotation + Sarabun-Bold)
// -------------------------------------------------------------
async function exportVectorPDF() {
    if (!originalPdfBytes) { alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!"); return; }

    try {
        showToast("กำลังสร้างไฟล์ PDF คมชัดระดับเวกเตอร์...");
        const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
        const loadedPdf = await PDFDocument.load(originalPdfBytes);
        
        let thaiFontRegular = null;
        let thaiFontBold = null;
        try {
            loadedPdf.registerFontkit(fontkit);
            if (!cachedRegularFontBytes) {
                const res = await fetch(THAI_FONT_REGULAR_URL);
                if (!res.ok) throw new Error("โหลด Sarabun-Regular ล้มเหลว");
                cachedRegularFontBytes = await res.arrayBuffer();
            }
            if (!cachedBoldFontBytes) {
                const res = await fetch(THAI_FONT_BOLD_URL);
                if (!res.ok) throw new Error("โหลด Sarabun-Bold ล้มเหลว");
                cachedBoldFontBytes = await res.arrayBuffer();
            }
            thaiFontRegular = await loadedPdf.embedFont(cachedRegularFontBytes);
            thaiFontBold = await loadedPdf.embedFont(cachedBoldFontBytes);
        } catch (fontErr) {
            console.warn("สลับใช้ฟอนต์มาตรฐานแทน:", fontErr);
            thaiFontRegular = await loadedPdf.embedFont(StandardFonts.Helvetica);
            thaiFontBold = await loadedPdf.embedFont(StandardFonts.HelveticaBold);
        }

        const pages = loadedPdf.getPages();

        for (let pageNum in documentPatches) {
            const pIdx = parseInt(pageNum) - 1;
            if (pIdx < 0 || pIdx >= pages.length) continue;
            const targetPage = pages[pIdx];
            const pData = documentPatches[pageNum];

            // 1. เรนเดอร์กล่องข้อความ (พร้อมคำนวณจุดหมุนในระบบ PDF)
            if (pData.patches) {
                pData.patches.forEach(pt => {
                    const safeBgR = Math.min(1.0, Math.max(0.0, pt.bgColor.r));
                    const safeBgG = Math.min(1.0, Math.max(0.0, pt.bgColor.g));
                    const safeBgB = Math.min(1.0, Math.max(0.0, pt.bgColor.b));

                    const safeTxtR = Math.min(1.0, Math.max(0.0, pt.textColor.r));
                    const safeTxtG = Math.min(1.0, Math.max(0.0, pt.textColor.g));
                    const safeTxtB = Math.min(1.0, Math.max(0.0, pt.textColor.b));

                    const isBold = (pt.fontWeight === '700' || pt.fontWeight === 'bold');
                    const selectedFont = isBold ? thaiFontBold : thaiFontRegular;
                    const rot = pt.rotation || 0;

                    if (rot === 0) {
                        targetPage.drawRectangle({
                            x: pt.boxLeft,
                            y: pt.patchBoxY,
                            width: pt.width,
                            height: pt.height,
                            color: rgb(safeBgR, safeBgG, safeBgB),
                        });
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + 2,
                            y: pt.patchBoxY + 3,
                            size: pt.fontSize,
                            font: selectedFont,
                            color: rgb(safeTxtR, safeTxtG, safeTxtB),
                        });
                    } else if (rot === 90) {
                        targetPage.drawRectangle({
                            x: pt.boxLeft + pt.width,
                            y: pt.patchBoxY,
                            width: pt.width,
                            height: pt.height,
                            color: rgb(safeBgR, safeBgG, safeBgB),
                            rotate: degrees(90)
                        });
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + pt.width - 3,
                            y: pt.patchBoxY + 2,
                            size: pt.fontSize,
                            font: selectedFont,
                            color: rgb(safeTxtR, safeTxtG, safeTxtB),
                            rotate: degrees(90)
                        });
                    } else if (rot === 180) {
                        targetPage.drawRectangle({
                            x: pt.boxLeft + pt.width,
                            y: pt.patchBoxY + pt.height,
                            width: pt.width,
                            height: pt.height,
                            color: rgb(safeBgR, safeBgG, safeBgB),
                            rotate: degrees(180)
                        });
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + pt.width - 2,
                            y: pt.patchBoxY + pt.height - 3,
                            size: pt.fontSize,
                            font: selectedFont,
                            color: rgb(safeTxtR, safeTxtG, safeTxtB),
                            rotate: degrees(180)
                        });
                    } else if (rot === 270) {
                        targetPage.drawRectangle({
                            x: pt.boxLeft,
                            y: pt.patchBoxY + pt.height,
                            width: pt.width,
                            height: pt.height,
                            color: rgb(safeBgR, safeBgG, safeBgB),
                            rotate: degrees(270)
                        });
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + 3,
                            y: pt.patchBoxY + pt.height - 2,
                            size: pt.fontSize,
                            font: selectedFont,
                            color: rgb(safeTxtR, safeTxtG, safeTxtB),
                            rotate: degrees(270)
                        });
                    }
                });
            }

            // 2. เรนเดอร์รูปทรง + เส้นโยง + กล่องคอมเมนต์สีแดง (Shapes & Callouts)
            if (pData.shapes) {
                pData.shapes.forEach(sh => {
                    const hexToRgb = (hex) => {
                        const num = parseInt(String(hex).replace('#', ''), 16);
                        return rgb(
                            Math.min(1, Math.max(0, (num >> 16 & 255) / 255)),
                            Math.min(1, Math.max(0, (num >> 8 & 255) / 255)),
                            Math.min(1, Math.max(0, (num & 255) / 255))
                        );
                    };
                    const shapeColor = hexToRgb(sh.color || '#ef4444');

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

                    const noteText = (sh.callout && sh.callout.text) ? sh.callout.text.trim() : (sh.note ? sh.note.trim() : '');
                    if (noteText) {
                        const calloutColor = shapeColor;
                        const textPaddingX = 8;
                        const boxHeight = 22;
                        const boxWidth = Math.max(70, noteText.length * 8 + (textPaddingX * 2));
                        
                        const boxX = (sh.callout && sh.callout.x !== undefined) ? sh.callout.x : (sh.x + sh.width + 10);
                        const boxY = (sh.callout && sh.callout.y !== undefined) ? sh.callout.y : (sh.y + sh.height);

                        const startX = sh.x + (sh.width / 2);
                        const startY = sh.y + (sh.height / 2);
                        const endX = boxX + (boxWidth / 2);
                        const endY = boxY + (boxHeight / 2);

                        targetPage.drawLine({
                            start: { x: startX, y: startY },
                            end: { x: endX, y: endY },
                            thickness: 1.5,
                            color: calloutColor,
                            dashArray: [3, 3]
                        });

                        targetPage.drawRectangle({
                            x: boxX,
                            y: boxY,
                            width: boxWidth,
                            height: boxHeight,
                            color: calloutColor,
                        });

                        targetPage.drawText(noteText, {
                            x: boxX + textPaddingX,
                            y: boxY + 6,
                            size: 11,
                            font: thaiFontBold,
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
    if (currentScale > 3.5) currentScale = 3.5;
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
