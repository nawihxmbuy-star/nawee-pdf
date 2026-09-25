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
    setTimeout(() => toast.remove(), 2200);
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

// ซูมเอกสารด้วย Ctrl + Mouse Wheel (คีย์ลัดงานเขียนแบบ)
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
                <p>คลิกตัวเลขหรือข้อความไหนก็ได้เพื่อแก้คำทันที หมุนองศาอิสระ ลากย้ายได้เนียนสนิท คมชัดระดับเวกเตอร์</p>
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
    showToast(`เปิดเอกสารเรียบร้อย (${pdfDoc.numPages} หน้า) - คลิกตัวเลขเพื่อแก้ได้ทันทีค่ะ`);
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

    // 🎯 Interactive Glyph Overlay Layer (สำหรับคลิกตรวจจับตัวหนังสือเหมือน Acrobat)
    const glyphLayer = document.createElement('div');
    glyphLayer.className = 'glyph-interactive-layer';
    wrapper.appendChild(glyphLayer);

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

        const isBold = item.fontName ? (/bold|black|heavy|medium|semibold/i.test(item.fontName)) : false;

        return {
            x: left,
            y: top - fontHeight,
            width: item.width,
            height: fontHeight,
            fontSize: fontHeight,
            text: item.str,
            fontName: item.fontName || '',
            fontWeight: isBold ? '700' : '400',
            rotation: snappedRotation
        };
    });

    renderClickableGlyphs(wrapper, pageNum, pdfCanvas, glyphLayer, pageTextMetadata);
    bindDrawingEngine(annotCanvas, pageNum);
}

// -------------------------------------------------------------
// ระบบ Native Click-to-Edit: สร้าง Hitbox ไฮไลต์คลิกตรงไหนแก้ตรงนั้น
// -------------------------------------------------------------
function renderClickableGlyphs(wrapper, pageNum, pdfCanvas, glyphLayer, textMetadata) {
    glyphLayer.innerHTML = '';
    
    textMetadata.forEach(meta => {
        if (!meta.text || meta.text.trim() === '') return;

        const hitEl = document.createElement('div');
        hitEl.className = 'glyph-hitbox';
        hitEl.style.left = meta.x + 'px';
        hitEl.style.top = meta.y + 'px';
        hitEl.style.width = Math.max(14, meta.width) + 'px';
        hitEl.style.height = meta.height + 'px';
        hitEl.style.transformOrigin = 'center center';
        hitEl.style.transform = `rotate(${meta.rotation}deg)`;
        hitEl.title = `คลิกเพื่อแก้ไข: ${meta.text}`;

        hitEl.onclick = (e) => {
            e.stopPropagation();
            if (currentTool !== 'patch') return;

            const colors = analyzeBoxColorsAdvanced(pdfCanvas, meta.x, meta.y, meta.width, meta.height);
            createInPlaceInputBox(wrapper, pageNum, pdfCanvas, meta.x, meta.y, meta.width, meta.height, colors, meta);
        };

        glyphLayer.appendChild(hitEl);
    });

    // ถ้าคลิกพื้นที่ว่างในโหมด patch ให้สร้างกล่องเพิ่มข้อความใหม่ได้อิสระ
    wrapper.addEventListener('click', (e) => {
        if (currentTool !== 'patch') return;
        if (e.target.closest('.glyph-hitbox') || e.target.closest('.active-patch-container') || e.target.closest('.floating-patch-text')) return;

        const coords = getPageAccurateCoords(e, wrapper);
        const defaultColors = {
            bg: { r: 1, g: 1, b: 1, hex: '#ffffff' },
            text: { r: 0.07, g: 0.09, b: 0.15, hex: '#111827' }
        };
        createInPlaceInputBox(wrapper, pageNum, pdfCanvas, coords.x - 30, coords.y - 8, 60, 16, defaultColors, {
            text: '', fontSize: 10, fontWeight: '400', rotation: 0
        });
    });
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

// -------------------------------------------------------------
// 4-Corner Edge Color Sampling (ดูดสีขอบรอบด้าน เนียนแม้ไม่ใช่สีขาว)
// -------------------------------------------------------------
function analyzeBoxColorsAdvanced(canvas, x, y, width, height) {
    const ctx = canvas.getContext('2d');
    const scaleFactorX = canvas.width / parseFloat(canvas.style.width || (canvas.width / 2));
    const scaleFactorY = canvas.height / parseFloat(canvas.style.height || (canvas.height / 2));

    const sLeft = Math.max(0, Math.floor(x * scaleFactorX));
    const sTop = Math.max(0, Math.floor(y * scaleFactorY));
    const sWidth = Math.max(1, Math.floor(width * scaleFactorX));
    const sHeight = Math.max(1, Math.floor(height * scaleFactorY));

    try {
        // สุ่มเก็บตัวอย่างสีจากขอบนอก 4 มุม
        const samples = [
            ctx.getImageData(Math.max(0, sLeft - 2), Math.max(0, sTop - 2), 1, 1).data,
            ctx.getImageData(Math.min(canvas.width - 1, sLeft + sWidth + 2), Math.max(0, sTop - 2), 1, 1).data,
            ctx.getImageData(Math.max(0, sLeft - 2), Math.min(canvas.height - 1, sTop + sHeight + 2), 1, 1).data,
            ctx.getImageData(Math.min(canvas.width - 1, sLeft + sWidth + 2), Math.min(canvas.height - 1, sTop + sHeight + 2), 1, 1).data
        ];

        let avgR = 0, avgG = 0, avgB = 0;
        samples.forEach(s => { avgR += s[0]; avgG += s[1]; avgB += s[2]; });
        avgR = Math.round(avgR / 4);
        avgG = Math.round(avgG / 4);
        avgB = Math.round(avgB / 4);

        const bgBrightness = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
        const textR = bgBrightness < 128 ? 255 : 17;
        const textG = bgBrightness < 128 ? 255 : 24;
        const textB = bgBrightness < 128 ? 255 : 39;

        const toHex = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
        const clampRatio = (val) => Math.min(1.0, Math.max(0.0, val / 255));

        return {
            bg: { 
                r: clampRatio(avgR), g: clampRatio(avgG), b: clampRatio(avgB), 
                hex: `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}` 
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

// -------------------------------------------------------------
// กล่อง Input: แถบปุ่มอยู่นิ่งแนวนอน + หมุนเฉพาะข้อความ + ตัวเลือกลบพื้นหลัง
// -------------------------------------------------------------
function createInPlaceInputBox(wrapper, pageNum, pdfCanvas, left, top, width, height, colors, matchedOrig) {
    const layer = wrapper.querySelector('.patch-layer');

    const fontSize = matchedOrig && matchedOrig.fontSize ? matchedOrig.fontSize : 10;
    let currentWeight = matchedOrig && matchedOrig.fontWeight ? matchedOrig.fontWeight : '400';
    let currentRotation = matchedOrig && matchedOrig.rotation !== undefined ? matchedOrig.rotation : 0;
    let isTransparentBg = false;
    
    const insetLeft = left;
    const insetTop = top;
    let insetWidth = Math.max(20, width);
    const tightBoxHeight = Math.max(fontSize + 2, Math.round(fontSize * 1.15));

    const containerNode = document.createElement('div');
    containerNode.className = 'active-patch-container';
    containerNode.style.position = 'absolute';
    containerNode.style.left = insetLeft + 'px';
    containerNode.style.top = insetTop + 'px';
    containerNode.style.zIndex = '100';

    // แถบปุ่มลอยนิ่งในแนวนอนระดับสายตาเสมอ
    const nudgeBar = document.createElement('div');
    nudgeBar.className = 'nudge-toolbar';
    nudgeBar.style.position = 'absolute';
    nudgeBar.style.top = '-40px';
    nudgeBar.style.left = '0';
    nudgeBar.style.whiteSpace = 'nowrap';
    nudgeBar.innerHTML = `
        <button type="button" class="nudge-btn ${currentWeight === '700' ? 'active' : ''}" id="nb-bold" title="สลับตัวหนา/ตัวปกติ"><strong>B</strong></button>
        <button type="button" class="nudge-btn" id="nb-rotate" title="หมุนองศา"><i class="fa-solid fa-rotate"></i> <span id="rot-deg">${currentRotation}°</span></button>
        <button type="button" class="nudge-btn" id="nb-trans" title="เปิด/ปิดพื้นหลังโปร่งใส"><i class="fa-solid fa-eye-slash"></i> โปร่งใส</button>
        <button type="button" class="nudge-btn btn-done" id="nb-done" title="ตกลง"><i class="fa-solid fa-check"></i> ตกลง</button>
    `;
    containerNode.appendChild(nudgeBar);

    const node = document.createElement('div');
    node.className = 'active-patch-node';
    node.style.width = insetWidth + 'px';
    node.style.height = tightBoxHeight + 'px';
    node.style.background = colors.bg.hex;
    node.style.transformOrigin = 'center center';
    node.style.transform = `rotate(${currentRotation}deg)`;
    node.style.display = 'flex';
    node.style.alignItems = 'center';
    containerNode.appendChild(node);

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

    nudgeBar.querySelector('#nb-trans').onclick = (e) => {
        e.stopPropagation();
        isTransparentBg = !isTransparentBg;
        node.style.background = isTransparentBg ? 'transparent' : colors.bg.hex;
        nudgeBar.querySelector('#nb-trans').classList.toggle('active', isTransparentBg);
    };

    nudgeBar.querySelector('#nb-done').onclick = (e) => {
        e.stopPropagation();
        commitToDraggableNode();
    };

    layer.appendChild(containerNode);
    setTimeout(() => { input.focus(); input.select(); }, 50);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitToDraggableNode();
        else if (e.key === 'Escape') containerNode.remove();
    });

    function commitToDraggableNode() {
        const text = input.value.trim();
        const finalW = parseFloat(node.style.width) || insetWidth;
        containerNode.remove();
        if (!text) return;

        // ถ้าไม่ได้เลือกโหมดโปร่งใส ให้ถมสีขอบเนียนสนิทลบคำเดิม
        if (!isTransparentBg) {
            const ctx = pdfCanvas.getContext('2d');
            const ratioX = pdfCanvas.width / parseFloat(pdfCanvas.style.width || (pdfCanvas.width / 2));
            const ratioY = pdfCanvas.height / parseFloat(pdfCanvas.style.height || (pdfCanvas.height / 2));
            
            const centerX = (insetLeft + (finalW / 2)) * ratioX;
            const centerY = (insetTop + (tightBoxHeight / 2)) * ratioY;

            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate((currentRotation * Math.PI) / 180);
            ctx.fillStyle = colors.bg.hex;
            
            const clearW = finalW * ratioX;
            const clearH = tightBoxHeight * ratioY;
            ctx.fillRect(-clearW / 2, -clearH / 2, clearW, clearH);
            ctx.restore();
        }

        createFloatingTextItem(wrapper, pageNum, pdfCanvas, insetLeft, insetTop, finalW, tightBoxHeight, text, fontSize, currentWeight, currentRotation, isTransparentBg ? { bg: { hex: 'transparent' }, text: colors.text } : colors, matchedOrig);
    }
}

// -------------------------------------------------------------
// Floating Text Item: ลากย้ายได้อิสระ + ปรับตำแหน่งเรียบร้อย
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
    item.style.background = colors.bg.hex || '#ffffff';
    item.style.color = colors.text.hex || '#111827';
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
        isTransparent: colors.bg.hex === 'transparent',
        bgColor: colors.bg.r !== undefined ? colors.bg : { r: 1, g: 1, b: 1 },
        textColor: colors.text
    };
    documentPatches[pageNum].patches.push(patchData);

    function syncPosition() {
        const curL = parseFloat(item.style.left);
        const curT = parseFloat(item.style.top);
        patchData.boxLeft = curL;
        patchData.patchBoxY = wH - (curT + height);
    }

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

    item.addEventListener('dblclick', () => {
        documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
        item.remove();
        createInPlaceInputBox(wrapper, pageNum, pdfCanvas, parseFloat(item.style.left), parseFloat(item.style.top), width, height, colors, { ...matchedOrig, text: text, rotation: rotation });
    });

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

// -------------------------------------------------------------
// ส่งออก Vector PDF (100% Vector Output พร้อม Rotation)
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

            if (pData.patches) {
                pData.patches.forEach(pt => {
                    const safeBgR = Math.min(1.0, Math.max(0.0, pt.bgColor.r || 1));
                    const safeBgG = Math.min(1.0, Math.max(0.0, pt.bgColor.g || 1));
                    const safeBgB = Math.min(1.0, Math.max(0.0, pt.bgColor.b || 1));

                    const safeTxtR = Math.min(1.0, Math.max(0.0, pt.textColor.r));
                    const safeTxtG = Math.min(1.0, Math.max(0.0, pt.textColor.g));
                    const safeTxtB = Math.min(1.0, Math.max(0.0, pt.textColor.b));

                    const isBold = (pt.fontWeight === '700' || pt.fontWeight === 'bold');
                    const selectedFont = isBold ? thaiFontBold : thaiFontRegular;
                    const rot = pt.rotation || 0;

                    if (!pt.isTransparent) {
                        if (rot === 0) {
                            targetPage.drawRectangle({
                                x: pt.boxLeft, y: pt.patchBoxY, width: pt.width, height: pt.height,
                                color: rgb(safeBgR, safeBgG, safeBgB),
                            });
                        } else if (rot === 90) {
                            targetPage.drawRectangle({
                                x: pt.boxLeft + pt.width, y: pt.patchBoxY, width: pt.width, height: pt.height,
                                color: rgb(safeBgR, safeBgG, safeBgB), rotate: degrees(90)
                            });
                        } else if (rot === 180) {
                            targetPage.drawRectangle({
                                x: pt.boxLeft + pt.width, y: pt.patchBoxY + pt.height, width: pt.width, height: pt.height,
                                color: rgb(safeBgR, safeBgG, safeBgB), rotate: degrees(180)
                            });
                        } else if (rot === 270) {
                            targetPage.drawRectangle({
                                x: pt.boxLeft, y: pt.patchBoxY + pt.height, width: pt.width, height: pt.height,
                                color: rgb(safeBgR, safeBgG, safeBgB), rotate: degrees(270)
                            });
                        }
                    }

                    if (rot === 0) {
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + 2, y: pt.patchBoxY + 3, size: pt.fontSize,
                            font: selectedFont, color: rgb(safeTxtR, safeTxtG, safeTxtB),
                        });
                    } else if (rot === 90) {
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + pt.width - 3, y: pt.patchBoxY + 2, size: pt.fontSize,
                            font: selectedFont, color: rgb(safeTxtR, safeTxtG, safeTxtB), rotate: degrees(90)
                        });
                    } else if (rot === 180) {
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + pt.width - 2, y: pt.patchBoxY + pt.height - 3, size: pt.fontSize,
                            font: selectedFont, color: rgb(safeTxtR, safeTxtG, safeTxtB), rotate: degrees(180)
                        });
                    } else if (rot === 270) {
                        targetPage.drawText(pt.text, {
                            x: pt.boxLeft + 3, y: pt.patchBoxY + pt.height - 2, size: pt.fontSize,
                            font: selectedFont, color: rgb(safeTxtR, safeTxtG, safeTxtB), rotate: degrees(270)
                        });
                    }
                });
            }
        }

        // วาดเลเยอร์ Freehand Canvas
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
});
