const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Global States
let currentTool = 'text';
let currentInkColor = '#ef4444';
let currentScale = 1.0;
let pdfDoc = null;
let originalPdfBytes = null;
let originalFileName = 'Sunita_Document';

let documentPatches = {};
let undoStack = [];
let redoStack = [];

// Active Staged Objects
let activeTextNode = null;
let activeShapeObj = null;

let cachedRegularFontBytes = null;
let cachedBoldFontBytes = null;

let sigCanvas, sigCtx, isDrawingSig = false, sigColor = '#0033aa', uploadedSigBase64 = null;

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function recordAction(action) {
    undoStack.push(action);
    redoStack = [];
}

function undoAction() {
    if (undoStack.length === 0) return showToast("ไม่พบรายการย้อนกลับ");
    const act = undoStack.pop();
    redoStack.push(act);
    act.undo();
    showToast("ย้อนกลับรายการล่าสุดแล้วค่ะ");
}

function redoAction() {
    if (redoStack.length === 0) return showToast("ไม่มีรายการทำซ้ำ");
    const act = redoStack.pop();
    undoStack.push(act);
    act.redo();
    showToast("ทำซ้ำรายการแล้วค่ะ");
}

// Keyboard Shortcuts
let isSpacePressed = false;
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Enter') {
            commitActiveStages();
        }
        return;
    }

    if (e.code === 'Space' && !isSpacePressed) {
        isSpacePressed = true;
        document.body.classList.add('panning-mode');
        document.getElementById('workspace').style.cursor = 'grab';
    } else if (e.key === 'Enter') {
        commitActiveStages();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoAction();
    } else if (e.key.toLowerCase() === 't') setTool('text');
    else if (e.key.toLowerCase() === 'r') setTool('rect');
    else if (e.key.toLowerCase() === 'c') setTool('cloud');
    else if (e.key.toLowerCase() === 'p') setTool('pen');
    else if (e.key.toLowerCase() === 'e') setTool('eraser');
    else if (e.key.toLowerCase() === 'v') setTool('pan');
    else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteActiveObject();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isSpacePressed = false;
        document.body.classList.remove('panning-mode');
        setTool(currentTool);
    }
});

window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoomDoc(delta);
    }
}, { passive: false });

function resetApp() {
    if (confirm("ต้องการเริ่มงานใหม่และล้างเอกสารปัจจุบันหรือไม่คะ?")) {
        pdfDoc = null;
        originalPdfBytes = null;
        documentPatches = {};
        undoStack = [];
        redoStack = [];
        activeTextNode = null;
        activeShapeObj = null;
        originalFileName = "Sunita_Document";
        currentScale = 1.0;
        const container = document.getElementById('document-container');
        container.innerHTML = `
            <div class="welcome-box">
                <div class="welcome-avatar-wrap">
                    <img src="cat-avatar.png" alt="Cat Logo" class="welcome-cat-avatar" onerror="this.parentElement.innerHTML='<div class=\\'welcome-icon\\'><i class=\\'fa-solid fa-drafting-compass\\'></i></div>'">
                </div>
                <h2>Sunita Studio CAD Engine</h2>
                <p>ระบบ Live Ribbon ปรับแต่งข้อความ สีพื้นหลัง เมฆตรวจแบบสดๆ • ส่งออกเวกเตอร์ PDF 100%</p>
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
    
    showToast("กำลังอ่านโครงสร้างเอกสาร CAD...");
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

    setTool('text');
    showToast(`เปิดเอกสารสำเร็จ (${pdfDoc.numPages} หน้า) - ดับเบิลคลิกเพื่อแก้คำได้เลยค่ะ`);
}

// --------------------------------------------------------------------------
// 1. ENGINE RENDER & MATRIX DECONSTRUCTION
// --------------------------------------------------------------------------
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
    svgLayer.setAttribute('class', 'vector-shapes-svg');
    wrapper.appendChild(svgLayer);

    const patchLayer = document.createElement('div');
    patchLayer.className = 'patch-layer';
    wrapper.appendChild(patchLayer);

    const glyphLayer = document.createElement('div');
    glyphLayer.className = 'glyph-interactive-layer';
    wrapper.appendChild(glyphLayer);

    container.appendChild(wrapper);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

    const textContent = await page.getTextContent();
    const displayViewport = page.getViewport({ scale: 1.0 });

    const pageTextMetadata = textContent.items.map(item => {
        const tx = pdfjsLib.Util.transform(displayViewport.transform, item.transform);
        const a = tx[0], b = tx[1], c = tx[2], d = tx[3], e = tx[4], f = tx[5];

        const fontHeight = Math.hypot(c, d);
        const angleRad = Math.atan2(b, a);
        let angleDeg = Math.round(angleRad * (180 / Math.PI));
        if (angleDeg < 0) angleDeg += 360;

        const isBold = item.fontName ? (/bold|black|heavy|medium|semibold/i.test(item.fontName)) : false;
        const textLen = Math.max(12, item.width);

        const ascenderOffset = fontHeight * 0.78;
        const rad = (angleDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const centerX = e + (textLen / 2) * cos - (ascenderOffset - fontHeight / 2) * sin;
        const centerY = f + (textLen / 2) * sin + (ascenderOffset - fontHeight / 2) * cos;

        return {
            baselineX: e, baselineY: f,
            centerX: centerX, centerY: centerY,
            left: centerX - textLen / 2,
            top: centerY - fontHeight / 2,
            width: textLen, height: fontHeight,
            fontSize: fontHeight, text: item.str,
            fontWeight: isBold ? '700' : '400',
            rotation: angleDeg
        };
    });

    bindCadTextEngine(wrapper, pageNum, pdfCanvas, glyphLayer, pageTextMetadata);
    bindDrawingEngine(annotCanvas, pageNum);
    bindShapeEngine(wrapper, pageNum, svgLayer);
}

// --------------------------------------------------------------------------
// 2. DYNAMIC 8-POINT RING INPAINTING
// --------------------------------------------------------------------------
function samplePerimeterBackground(canvas, cx, cy, w, h, rad) {
    const ctx = canvas.getContext('2d');
    const scaleFactorX = canvas.width / parseFloat(canvas.style.width || (canvas.width / 2));
    const scaleFactorY = canvas.height / parseFloat(canvas.style.height || (canvas.height / 2));

    const sCX = cx * scaleFactorX;
    const sCY = cy * scaleFactorY;
    const sHalfW = (w * scaleFactorX) / 2 + 4;
    const sHalfH = (h * scaleFactorY) / 2 + 4;

    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const sampleOffsets = [
        { x: -sHalfW, y: -sHalfH }, { x: 0, y: -sHalfH }, { x: sHalfW, y: -sHalfH },
        { x: sHalfW, y: 0 },
        { x: sHalfW, y: sHalfH }, { x: 0, y: sHalfH }, { x: -sHalfW, y: sHalfH },
        { x: -sHalfW, y: 0 }
    ];

    let rArr = [], gArr = [], bArr = [];
    sampleOffsets.forEach(pt => {
        const rotX = Math.round(sCX + (pt.x * cos - pt.y * sin));
        const rotY = Math.round(sCY + (pt.x * sin + pt.y * cos));
        if (rotX >= 0 && rotX < canvas.width && rotY >= 0 && rotY < canvas.height) {
            const pixel = ctx.getImageData(rotX, rotY, 1, 1).data;
            rArr.push(pixel[0]); gArr.push(pixel[1]); bArr.push(pixel[2]);
        }
    });

    if (rArr.length === 0) return '#ffffff';

    const median = arr => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    };

    const toHex = n => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
    return `#${toHex(median(rArr))}${toHex(median(gArr))}${toHex(median(bArr))}`;
}

// --------------------------------------------------------------------------
// 3. IN-PLACE UNIVERSAL TEXT & ACTIVE STAGING
// --------------------------------------------------------------------------
function bindCadTextEngine(wrapper, pageNum, pdfCanvas, glyphLayer, textMetadata) {
    glyphLayer.innerHTML = '';

    textMetadata.forEach(meta => {
        if (!meta.text || meta.text.trim() === '') return;

        const hitEl = document.createElement('div');
        hitEl.className = 'glyph-hitbox';
        hitEl.style.left = meta.left + 'px';
        hitEl.style.top = meta.top + 'px';
        hitEl.style.width = meta.width + 'px';
        hitEl.style.height = meta.height + 'px';
        hitEl.style.transformOrigin = 'center center';
        hitEl.style.transform = `rotate(${meta.rotation}deg)`;
        hitEl.title = `ดับเบิลคลิกแก้ไข: ${meta.text}`;

        hitEl.ondblclick = (e) => {
            e.stopPropagation();
            openInPlaceEditor(wrapper, pageNum, pdfCanvas, meta.left, meta.top, meta.width, meta.height, meta.text, meta.fontSize, meta.fontWeight, meta.rotation, true);
        };

        glyphLayer.appendChild(hitEl);
    });

    wrapper.addEventListener('click', (e) => {
        if (currentTool !== 'text') return;
        if (e.target.closest('.glyph-hitbox') || e.target.closest('.cad-text-node') || e.target.closest('.cad-inline-editor')) return;

        commitActiveStages();
        const coords = getPageAccurateCoords(e, wrapper);
        openInPlaceEditor(wrapper, pageNum, pdfCanvas, coords.x - 20, coords.y - 8, 40, 16, '', 11, '400', 0, false);
    });
}

function openInPlaceEditor(wrapper, pageNum, pdfCanvas, left, top, width, height, initialText, fontSize, fontWeight, rotation, isReplacingOriginal) {
    commitActiveStages();
    const layer = wrapper.querySelector('.patch-layer');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialText;
    input.className = 'cad-inline-editor';
    input.style.position = 'absolute';
    input.style.left = left + 'px';
    input.style.top = top + 'px';
    input.style.width = Math.max(width + 4, 30) + 'px';
    input.style.height = (height + 2) + 'px';
    input.style.fontSize = fontSize + 'px';
    input.style.fontWeight = fontWeight;
    input.style.transformOrigin = 'center center';
    input.style.transform = `rotate(${rotation}deg)`;
    layer.appendChild(input);

    setTimeout(() => { input.focus(); input.select(); }, 20);

    input.addEventListener('input', () => {
        const tempSpan = document.createElement('span');
        tempSpan.style.font = `${fontWeight} ${fontSize}px 'Sarabun', sans-serif`;
        tempSpan.style.visibility = 'hidden';
        tempSpan.innerText = input.value || ' ';
        document.body.appendChild(tempSpan);
        input.style.width = (tempSpan.offsetWidth + 8) + 'px';
        tempSpan.remove();
    });

    let committed = false;
    function commit() {
        if (committed) return;
        committed = true;
        const text = input.value.trim();
        const finalW = parseFloat(input.style.width) || width;
        input.remove();
        if (!text) return;

        const ctx = pdfCanvas.getContext('2d');
        const ratioX = pdfCanvas.width / parseFloat(wrapper.style.width);
        const ratioY = pdfCanvas.height / parseFloat(wrapper.style.height);

        const rad = (rotation * Math.PI) / 180;
        const cX = (left + (finalW / 2)) * ratioX;
        const cY = (top + (height / 2)) * ratioY;
        const clearW = (finalW * ratioX) + (4 * ratioX);
        const clearH = (height * ratioY) + (4 * ratioY);

        const sampledBg = samplePerimeterBackground(pdfCanvas, left + finalW / 2, top + height / 2, finalW, height, rad);

        let previousImageData = null;
        const snapBoxSize = Math.ceil(Math.max(clearW, clearH) * 1.6);
        const snapX = Math.max(0, Math.floor(cX - snapBoxSize / 2));
        const snapY = Math.max(0, Math.floor(cY - snapBoxSize / 2));

        if (isReplacingOriginal) {
            previousImageData = ctx.getImageData(snapX, snapY, snapBoxSize, snapBoxSize);

            ctx.save();
            ctx.translate(cX, cY);
            ctx.rotate(rad);
            ctx.fillStyle = sampledBg;
            ctx.fillRect(-clearW / 2, -clearH / 2, clearW, clearH);
            ctx.restore();
        }

        const cadNode = createCadTextNode(wrapper, pageNum, pdfCanvas, left, top, finalW, height, text, fontSize, fontWeight, rotation, sampledBg, isReplacingOriginal);

        recordAction({
            undo: () => {
                if (previousImageData) ctx.putImageData(previousImageData, snapX, snapY);
                cadNode.remove();
                if (documentPatches[pageNum]) {
                    documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== cadNode.patchData);
                }
            },
            redo: () => {
                if (isReplacingOriginal) {
                    ctx.save();
                    ctx.translate(cX, cY);
                    ctx.rotate(rad);
                    ctx.fillStyle = sampledBg;
                    ctx.fillRect(-clearW / 2, -clearH / 2, clearW, clearH);
                    ctx.restore();
                }
                layer.appendChild(cadNode);
                documentPatches[pageNum].patches.push(cadNode.patchData);
            }
        });
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { committed = true; input.remove(); }
    });
    input.addEventListener('blur', commit);
}

// --------------------------------------------------------------------------
// 4. CAD TEXT NODE, RESIZE HANDLE & LIVE RIBBON
// --------------------------------------------------------------------------
function createCadTextNode(wrapper, pageNum, pdfCanvas, left, top, width, height, text, fontSize, fontWeight, rotation, bgColor, hasSolidBg) {
    const layer = wrapper.querySelector('.patch-layer');
    const wH = parseFloat(wrapper.style.height);

    const node = document.createElement('div');
    node.className = 'cad-text-node selected';
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.minWidth = width + 'px';
    node.style.height = height + 'px';
    node.style.fontSize = fontSize + 'px';
    node.style.fontWeight = fontWeight;
    node.style.color = '#111827';
    node.style.background = hasSolidBg ? (bgColor || '#ffffff') : 'transparent';
    node.style.transform = `rotate(${rotation}deg)`;
    node.innerText = text;

    // Lollipop Rotation Handle
    const rotStem = document.createElement('div');
    rotStem.className = 'cad-rot-stem';
    const rotHandle = document.createElement('div');
    rotHandle.className = 'cad-rot-handle';
    node.appendChild(rotStem);
    node.appendChild(rotHandle);

    layer.appendChild(node);

    const patchData = {
        boxLeft: left,
        boxTop: top,
        patchBoxY: wH - (top + height),
        width: width,
        height: height,
        text: text,
        fontSize: fontSize,
        fontWeight: fontWeight,
        rotation: rotation,
        textColor: '#111827',
        bgColor: node.style.background
    };

    if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [], shapes: [] };
    documentPatches[pageNum].patches.push(patchData);
    node.patchData = patchData;

    // ติดตั้งจุด Resize Handle ที่ขอบขวาเพื่อคลิกลากปรับขนาดกล่องได้
    attachResizeHandle(node, patchData);

    node.deleteSelf = () => {
        node.remove();
        documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
        activeTextNode = null;
        showToast("ลบข้อความแล้วค่ะ");
    };

    node.ondblclick = (e) => {
        e.stopPropagation();
        node.deleteSelf();
        openInPlaceEditor(wrapper, pageNum, pdfCanvas, parseFloat(node.style.left), parseFloat(node.style.top), width, height, text, patchData.fontSize, patchData.fontWeight, patchData.rotation, false);
    };

    // หมุนอิสระ 360° (กด Shift ค้างเพื่อล็อกฉาก 90°)
    let isRotating = false;
    rotHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        isRotating = true;
        rotHandle.setPointerCapture(e.pointerId);
    });

    rotHandle.addEventListener('pointermove', (e) => {
        if (!isRotating) return;
        const rect = node.getBoundingClientRect();
        const centerScreenX = rect.left + rect.width / 2;
        const centerScreenY = rect.top + rect.height / 2;

        let angleRad = Math.atan2(e.clientY - centerScreenY, e.clientX - centerScreenX);
        let angleDeg = Math.round(angleRad * (180 / Math.PI)) + 90;
        if (angleDeg < 0) angleDeg += 360;

        if (e.shiftKey) angleDeg = (Math.round(angleDeg / 90) * 90) % 360;

        patchData.rotation = angleDeg;
        node.style.transform = `rotate(${angleDeg}deg)`;
        syncTextRibbon(node);
    });

    rotHandle.addEventListener('pointerup', () => { isRotating = false; });

    // ลากย้ายตำแหน่ง
    let isDragging = false, startX = 0, startY = 0, origL = left, origT = top;
    node.addEventListener('pointerdown', (e) => {
        if (e.target === rotHandle || e.target.classList.contains('cad-resize-handle')) return;
        selectTextNode(node);
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        origL = parseFloat(node.style.left);
        origT = parseFloat(node.style.top);
        node.setPointerCapture(e.pointerId);
    });

    node.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - startX) / currentScale;
        const dy = (e.clientY - startY) / currentScale;
        node.style.left = (origL + dx) + 'px';
        node.style.top = (origT + dy) + 'px';
        patchData.boxLeft = origL + dx;
        patchData.boxTop = origT + dy;
        patchData.patchBoxY = wH - ((origT + dy) + height);
    });

    node.addEventListener('pointerup', () => { isDragging = false; });

    selectTextNode(node);
    return node;
}

// ระบบ Resize Handle ดึงยืดขยายขนาดกล่องข้อความ
function attachResizeHandle(node, patchData) {
    const resizeEl = document.createElement('div');
    resizeEl.className = 'cad-resize-handle';
    node.appendChild(resizeEl);

    let isResizing = false, startX = 0, initialW = 0;

    resizeEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        initialW = parseFloat(node.style.minWidth || node.style.width) || patchData.width;
        resizeEl.setPointerCapture(e.pointerId);
    });

    resizeEl.addEventListener('pointermove', (e) => {
        if (!isResizing) return;
        const dx = (e.clientX - startX) / currentScale;
        const newW = Math.max(20, initialW + dx);
        node.style.minWidth = newW + 'px';
        node.style.width = newW + 'px';
        patchData.width = newW;
    });

    resizeEl.addEventListener('pointerup', () => { isResizing = false; });
}

// --------------------------------------------------------------------------
// 5. LIVE REVISION CLOUD & SHAPE ENGINE
// --------------------------------------------------------------------------
function generateCloudPath(x1, y1, x2, y2) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const width = maxX - minX, height = maxY - minY;

    if (width < 10 || height < 10) return '';

    const arcRadius = 14;
    let path = `M ${minX} ${minY}`;

    for (let x = minX; x < maxX; x += arcRadius * 1.5) {
        const nextX = Math.min(x + arcRadius * 1.5, maxX);
        const midX = (x + nextX) / 2;
        path += ` Q ${midX} ${minY - arcRadius} ${nextX} ${minY}`;
    }
    for (let y = minY; y < maxY; y += arcRadius * 1.5) {
        const nextY = Math.min(y + arcRadius * 1.5, maxY);
        const midY = (y + nextY) / 2;
        path += ` Q ${maxX + arcRadius} ${midY} ${maxX} ${nextY}`;
    }
    for (let x = maxX; x > minX; x -= arcRadius * 1.5) {
        const nextX = Math.max(x - arcRadius * 1.5, minX);
        const midX = (x + nextX) / 2;
        path += ` Q ${midX} ${maxY + arcRadius} ${nextX} ${maxY}`;
    }
    for (let y = maxY; y > minY; y -= arcRadius * 1.5) {
        const nextY = Math.max(y - arcRadius * 1.5, minY);
        const midY = (y + nextY) / 2;
        path += ` Q ${minX - arcRadius} ${midY} ${minX} ${nextY}`;
    }
    path += ' Z';
    return path;
}

function bindShapeEngine(wrapper, pageNum, svgLayer) {
    let startX = 0, startY = 0;
    let isDrawingShape = false;
    let tempShape = null;

    wrapper.addEventListener('pointerdown', (e) => {
        if (currentTool !== 'rect' && currentTool !== 'cloud') return;
        commitActiveStages();

        const coords = getPageAccurateCoords(e, wrapper);
        startX = coords.x; startY = coords.y;
        isDrawingShape = true;

        if (currentTool === 'rect') {
            tempShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        } else if (currentTool === 'cloud') {
            tempShape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        }
        tempShape.setAttribute('stroke', currentInkColor);
        tempShape.setAttribute('stroke-width', '2');
        tempShape.setAttribute('fill', 'none');
        tempShape.setAttribute('class', 'active-shape-box');
        svgLayer.appendChild(tempShape);
    });

    wrapper.addEventListener('pointermove', (e) => {
        if (!isDrawingShape || !tempShape) return;
        const coords = getPageAccurateCoords(e, wrapper);

        if (currentTool === 'rect') {
            tempShape.setAttribute('x', Math.min(startX, coords.x));
            tempShape.setAttribute('y', Math.min(startY, coords.y));
            tempShape.setAttribute('width', Math.abs(coords.x - startX));
            tempShape.setAttribute('height', Math.abs(coords.y - startY));
        } else if (currentTool === 'cloud') {
            const d = generateCloudPath(startX, startY, coords.x, coords.y);
            tempShape.setAttribute('d', d);
        }
    });

    wrapper.addEventListener('pointerup', () => {
        if (isDrawingShape && tempShape) {
            isDrawingShape = false;
            activeShapeObj = tempShape;
            showToast("วาดสำเร็จ - ล็อกค่าด้วยการกด Enter หรือคลิกที่ว่างค่ะ");
        }
    });
}

// --------------------------------------------------------------------------
// 6. LIVE RIBBON & COLOR CONTROLLERS (สไลด์เปลี่ยนสีสดทันที oninput)
// --------------------------------------------------------------------------
function selectTextNode(node) {
    commitActiveStages();
    activeTextNode = node;
    activeTextNode.classList.add('selected');
    syncTextRibbon(node);
}

function commitActiveStages() {
    if (activeTextNode) {
        activeTextNode.classList.remove('selected');
        activeTextNode = null;
    }
    if (activeShapeObj) {
        activeShapeObj = null;
    }
}

function deleteActiveObject() {
    if (activeTextNode && activeTextNode.deleteSelf) {
        activeTextNode.deleteSelf();
    } else if (activeShapeObj) {
        activeShapeObj.remove();
        activeShapeObj = null;
        showToast("ลบรูปทรงเรียบร้อยค่ะ");
    }
}

function syncTextRibbon(node) {
    const p = node.patchData;
    document.getElementById('rib-font-size').value = Math.round(p.fontSize);
    document.getElementById('rib-rot-deg').value = Math.round(p.rotation || 0);
    document.getElementById('rib-font-bold').classList.toggle('active', p.fontWeight === '700');

    const isTrans = node.style.background === 'transparent' || !node.style.background;
    document.getElementById('rib-bg-toggle').classList.toggle('active', !isTrans);
}

function initLiveRibbonEvents() {
    const textColorInput = document.getElementById('rib-text-color');
    const bgColorInput = document.getElementById('rib-bg-color');
    const fontSizeInput = document.getElementById('rib-font-size');
    const rotInput = document.getElementById('rib-rot-deg');

    // 🎯 สไลด์สีตัวหนังสือ: 'input' เปลี่ยนสีตามนิ้วสดๆ ทันที
    textColorInput.addEventListener('input', (e) => {
        const val = e.target.value;
        currentInkColor = val;
        if (activeTextNode) {
            activeTextNode.style.color = val;
            activeTextNode.patchData.textColor = val;
        }
        if (activeShapeObj) {
            activeShapeObj.setAttribute('stroke', val);
        }
    });

    // 🎯 สไลด์สีพื้นหลัง: เปลี่ยนสีสดๆ ทันที
    bgColorInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (activeTextNode) {
            activeTextNode.style.background = val;
            activeTextNode.patchData.bgColor = val;
            document.getElementById('rib-bg-toggle').classList.add('active');
        }
    });

    // 🎯 หลอดดูดสีจากหน้าจอ (EyeDropper API)
    document.getElementById('rib-text-eyedropper').onclick = async () => {
        if (!window.EyeDropper) {
            return showToast("เบราว์เซอร์ไม่รองรับ EyeDropper ให้เลือกสีจากจานสีแทนค่ะ");
        }
        try {
            const eyeDropper = new EyeDropper();
            const result = await eyeDropper.open();
            if (result && result.sRGBHex) {
                textColorInput.value = result.sRGBHex;
                currentInkColor = result.sRGBHex;
                if (activeTextNode) {
                    activeTextNode.style.color = result.sRGBHex;
                    activeTextNode.patchData.textColor = result.sRGBHex;
                }
                showToast(`ดูดสี ${result.sRGBHex} เรียบร้อยค่ะ`);
            }
        } catch (e) {}
    };

    // ปุ่มสลับพื้นหลัง ทึบ/โปร่ง
    document.getElementById('rib-bg-toggle').onclick = () => {
        if (!activeTextNode) return;
        const curBg = activeTextNode.style.background;
        const isTrans = curBg === 'transparent' || !curBg;
        const colorVal = bgColorInput.value || '#ffffff';
        activeTextNode.style.background = isTrans ? colorVal : 'transparent';
        activeTextNode.patchData.bgColor = activeTextNode.style.background;
        document.getElementById('rib-bg-toggle').classList.toggle('active', isTrans);
    };

    // ปรับขนาดฟอนต์ A+ / A-
    document.getElementById('rib-font-inc').onclick = () => {
        if (!activeTextNode) return;
        activeTextNode.patchData.fontSize += 1;
        activeTextNode.style.fontSize = activeTextNode.patchData.fontSize + 'px';
        fontSizeInput.value = Math.round(activeTextNode.patchData.fontSize);
    };

    document.getElementById('rib-font-dec').onclick = () => {
        if (!activeTextNode || activeTextNode.patchData.fontSize <= 4) return;
        activeTextNode.patchData.fontSize -= 1;
        activeTextNode.style.fontSize = activeTextNode.patchData.fontSize + 'px';
        fontSizeInput.value = Math.round(activeTextNode.patchData.fontSize);
    };

    fontSizeInput.addEventListener('input', () => {
        if (!activeTextNode) return;
        const val = Math.max(4, parseInt(fontSizeInput.value) || 10);
        activeTextNode.style.fontSize = val + 'px';
        activeTextNode.patchData.fontSize = val;
    });

    document.getElementById('rib-font-bold').onclick = () => {
        if (!activeTextNode) return;
        const isBold = activeTextNode.patchData.fontWeight === '700';
        activeTextNode.patchData.fontWeight = isBold ? '400' : '700';
        activeTextNode.style.fontWeight = activeTextNode.patchData.fontWeight;
        document.getElementById('rib-font-bold').classList.toggle('active', !isBold);
    };

    document.getElementById('rib-rot-90').onclick = () => {
        if (!activeTextNode) return;
        activeTextNode.patchData.rotation = (Math.round((activeTextNode.patchData.rotation || 0) + 90)) % 360;
        activeTextNode.style.transform = `rotate(${activeTextNode.patchData.rotation}deg)`;
        rotInput.value = activeTextNode.patchData.rotation;
    };

    rotInput.addEventListener('input', () => {
        if (!activeTextNode) return;
        let deg = parseInt(rotInput.value) || 0;
        deg = (deg % 360 + 360) % 360;
        activeTextNode.style.transform = `rotate(${deg}deg)`;
        activeTextNode.patchData.rotation = deg;
    });

    document.getElementById('rib-commit').onclick = commitActiveStages;
    document.getElementById('rib-delete').onclick = deleteActiveObject;
}

// --------------------------------------------------------------------------
// 7. DRAWING, PANNING & VECTOR PDF EXPORT (แก้ไขเมฆหายและฟอนต์เพี้ยน)
// --------------------------------------------------------------------------
function hexToPdfRgb(hex) {
    if (!hex || hex === 'transparent' || hex === 'none') return null;
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    return PDFLib.rgb((num >> 16) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

async function exportVectorPDF() {
    if (!originalPdfBytes) return alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!");

    try {
        commitActiveStages();
        showToast("กำลังส่งออกเวกเตอร์ PDF และเมฆตรวจแบบ...");

        const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
        const loadedPdf = await PDFDocument.load(originalPdfBytes);
        
        // 🎯 1. ดึงฟอนต์ Sarabun ผ่าน jsDelivr CDN ที่รองรับ CORS แท้จริง
        let thaiFontRegular, thaiFontBold;
        try {
            loadedPdf.registerFontkit(fontkit);
            if (!cachedRegularFontBytes) {
                cachedRegularFontBytes = await fetch('https://cdn.jsdelivr.net/gh/googlefonts/sarabun@main/fonts/ttf/Sarabun-Regular.ttf').then(r => {
                    if (!r.ok) throw new Error("Font fetch failed");
                    return r.arrayBuffer();
                });
            }
            if (!cachedBoldFontBytes) {
                cachedBoldFontBytes = await fetch('https://cdn.jsdelivr.net/gh/googlefonts/sarabun@main/fonts/ttf/Sarabun-Bold.ttf').then(r => {
                    if (!r.ok) throw new Error("Font fetch failed");
                    return r.arrayBuffer();
                });
            }
            thaiFontRegular = await loadedPdf.embedFont(cachedRegularFontBytes);
            thaiFontBold = await loadedPdf.embedFont(cachedBoldFontBytes);
        } catch (e) {
            console.warn("ใช้ฟอนต์มาตรฐานสำรอง", e);
            thaiFontRegular = await loadedPdf.embedFont(StandardFonts.Helvetica);
            thaiFontBold = await loadedPdf.embedFont(StandardFonts.HelveticaBold);
        }

        const pages = loadedPdf.getPages();
        const wrappers = document.querySelectorAll('.page-wrapper');

        for (let i = 0; i < wrappers.length; i++) {
            const wrapper = wrappers[i];
            const pageNum = parseInt(wrapper.dataset.pageNumber || (i + 1));
            const targetPage = pages[i];
            const pageH = targetPage.getHeight();
            const pageW = targetPage.getWidth();

            const nativeW = parseFloat(wrapper.style.width);
            const nativeH = parseFloat(wrapper.style.height);
            const scaleX = pageW / nativeW;
            const scaleY = pageH / nativeH;

            // 🎯 2. เรนเดอร์กล่องพื้นหลังทึบ & ข้อความลงใน PDF
            const pData = documentPatches[pageNum];
            if (pData && pData.patches) {
                for (const pt of pData.patches) {
                    const isBold = pt.fontWeight === '700';
                    const font = isBold ? thaiFontBold : thaiFontRegular;
                    const pdfRot = degrees(360 - (pt.rotation || 0));

                    const pdfX = pt.boxLeft * scaleX;
                    const pdfY = (nativeH - (pt.boxTop + pt.height)) * scaleY;
                    const pdfW = (pt.width || 40) * scaleX;
                    const pdfH = pt.height * scaleY;

                    // ถมกล่องพื้นหลังทึบปิดทับข้อความเดิม
                    if (pt.bgColor && pt.bgColor !== 'transparent') {
                        const bgRgb = hexToPdfRgb(pt.bgColor) || rgb(1, 1, 1);
                        targetPage.drawRectangle({
                            x: pdfX,
                            y: pdfY,
                            width: pdfW,
                            height: pdfH,
                            color: bgRgb,
                            rotate: pdfRot
                        });
                    }

                    let textColorRgb = rgb(0.07, 0.09, 0.15);
                    if (typeof pt.textColor === 'string') {
                        textColorRgb = hexToPdfRgb(pt.textColor) || textColorRgb;
                    }

                    targetPage.drawText(pt.text, {
                        x: pdfX + 2,
                        y: pdfY + (pdfH * 0.22),
                        size: pt.fontSize * scaleY,
                        font: font,
                        color: textColorRgb,
                        rotate: pdfRot
                    });
                }
            }

            // 🎯 3. รวม SVG (ก้อนเมฆ/สี่เหลี่ยม) + Canvas ลายเส้นปากกา ส่งออกไปพร้อมกัน 100%
            const annotCanvas = wrapper.querySelector('.annotation-canvas');
            const svgLayer = wrapper.querySelector('.vector-shapes-svg');

            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = annotCanvas.width;
            exportCanvas.height = annotCanvas.height;
            const expCtx = exportCanvas.getContext('2d');

            expCtx.drawImage(annotCanvas, 0, 0);

            if (svgLayer && svgLayer.children.length > 0) {
                const svgData = new XMLSerializer().serializeToString(svgLayer);
                const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                const svgUrl = URL.createObjectURL(svgBlob);
                
                await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        expCtx.drawImage(img, 0, 0, exportCanvas.width, exportCanvas.height);
                        URL.revokeObjectURL(svgUrl);
                        resolve();
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(svgUrl);
                        resolve();
                    };
                    img.src = svgUrl;
                });
            }

            const mergedImgData = exportCanvas.toDataURL('image/png');
            const imgBytes = await fetch(mergedImgData).then(r => r.arrayBuffer());
            const embedded = await loadedPdf.embedPng(imgBytes);
            targetPage.drawImage(embedded, {
                x: 0,
                y: 0,
                width: pageW,
                height: pageH
            });
        }

        const pdfBytes = await loadedPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${originalFileName}_CAD_Edited.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("ส่งออกไฟล์ PDF เรียบร้อยค่ะ!");

    } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
    }
}

// --------------------------------------------------------------------------
// 8. NAVIGATION, DRAWING & SIGNATURES
// --------------------------------------------------------------------------
function bindDrawingEngine(canvas, pageNum) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false, lastX = 0, lastY = 0;

    function getCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * canvas.width,
            y: ((e.clientY - rect.top) / rect.height) * canvas.height
        };
    }

    canvas.addEventListener('pointerdown', (e) => {
        if (currentTool !== 'pen' && currentTool !== 'eraser') return;
        const c = getCoords(e);
        isDrawing = true; lastX = c.x; lastY = c.y;
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!isDrawing) return;
        const c = getCoords(e);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(c.x, c.y);

        if (currentTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = currentInkColor;
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.stroke();
        } else if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 26;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        lastX = c.x; lastY = c.y;
    });

    window.addEventListener('pointerup', () => { isDrawing = false; });
}

const wsEl = document.querySelector('.workspace');
let isPanning = false, panStartX = 0, panStartY = 0, scrollStartL = 0, scrollStartT = 0;

wsEl.addEventListener('pointerdown', (e) => {
    if (isSpacePressed || currentTool === 'pan' || e.button === 1) {
        isPanning = true;
        panStartX = e.clientX; panStartY = e.clientY;
        scrollStartL = wsEl.scrollLeft; scrollStartT = wsEl.scrollTop;
        wsEl.style.cursor = 'grabbing';
    }
});

window.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    wsEl.scrollLeft = scrollStartL - (e.clientX - panStartX);
    wsEl.scrollTop = scrollStartT - (e.clientY - panStartY);
});

window.addEventListener('pointerup', () => {
    if (isPanning) {
        isPanning = false;
        wsEl.style.cursor = currentTool === 'pan' ? 'grab' : 'crosshair';
    }
});

function getPageAccurateCoords(e, wrapper) {
    const rect = wrapper.getBoundingClientRect();
    const nativeW = parseFloat(wrapper.style.width);
    const nativeH = parseFloat(wrapper.style.height);
    return {
        x: ((e.clientX - rect.left) / rect.width) * nativeW,
        y: ((e.clientY - rect.top) / rect.height) * nativeH
    };
}

// Modal ลายเซ็น
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

    if (!dataUrl) return alert("กรุณาวาดลายเซ็นหรือเลือกรูปภาพก่อนค่ะ!");

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

    layer.appendChild(sigNode);
    closeSignatureModal();
    showToast("วางลายเซ็นเรียบร้อยแล้วค่ะ");
}

function setTool(tool) {
    commitActiveStages();
    currentTool = tool;
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tool-${tool}`);
    if (btn) btn.classList.add('active');

    document.body.className = document.body.className.replace(/tool-\S+/g, '').trim();
    document.body.classList.add(`tool-${tool}`);

    const ws = document.getElementById('workspace');
    if (tool === 'pan') ws.style.cursor = 'grab';
    else if (tool === 'text') ws.style.cursor = 'text';
    else ws.style.cursor = 'crosshair';
}

function zoomDoc(delta) {
    currentScale = Math.max(0.3, Math.min(4.0, currentScale + delta));
    const c = document.getElementById('document-container');
    if (c) c.style.transform = `scale(${currentScale})`;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('upload-pdf').addEventListener('change', handleFileOpen);
    
    document.getElementById('tool-pan').onclick = () => setTool('pan');
    document.getElementById('tool-text').onclick = () => setTool('text');
    document.getElementById('tool-rect').onclick = () => setTool('rect');
    document.getElementById('tool-cloud').onclick = () => setTool('cloud');
    document.getElementById('tool-pen').onclick = () => setTool('pen');
    document.getElementById('tool-eraser').onclick = () => setTool('eraser');
    document.getElementById('btn-open-sig').onclick = openSignatureModal;
    
    document.getElementById('btn-undo').onclick = undoAction;
    document.getElementById('btn-redo').onclick = redoAction;
    document.getElementById('btn-zoom-100').onclick = () => { currentScale = 1.0; zoomDoc(0); };
    document.getElementById('btn-zoom-fit').onclick = () => { currentScale = 0.85; zoomDoc(0); };

    initLiveRibbonEvents();

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
