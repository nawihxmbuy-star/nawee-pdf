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
let selectedNode = null;

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

// Keyboard Shortcuts (AutoCAD & Bluebeam Style)
let isSpacePressed = false;
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space' && !isSpacePressed) {
        isSpacePressed = true;
        document.body.classList.add('panning-mode');
        document.getElementById('workspace').style.cursor = 'grab';
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
        if (selectedNode && selectedNode.deleteSelf) selectedNode.deleteSelf();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isSpacePressed = false;
        document.body.classList.remove('panning-mode');
        setTool(currentTool);
    }
});

// Ctrl + MouseWheel Zooming (Centered at cursor)
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
        originalFileName = "Sunita_Document";
        currentScale = 1.0;
        const container = document.getElementById('document-container');
        container.innerHTML = `
            <div class="welcome-box">
                <div class="welcome-avatar-wrap">
                    <img src="cat-avatar.png" alt="Cat Logo" class="welcome-cat-avatar" onerror="this.parentElement.innerHTML='<div class=\\'welcome-icon\\'><i class=\\'fa-solid fa-drafting-compass\\'></i></div>'">
                </div>
                <h2>Sunita Studio CAD Engine</h2>
                <p>ดับเบิลคลิกเพื่อแก้คำสดบนแบบ • หมุนอิสระ 360° • เมฆตรวจแบบ Revision Cloud • Vector PDF 100%</p>
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
        const fontHeight = Math.hypot(tx[2], tx[3]);
        const [left, top] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);

        const angleRad = Math.atan2(item.transform[1], item.transform[0]);
        let angleDeg = Math.round(angleRad * (180 / Math.PI));
        if (angleDeg < 0) angleDeg += 360;

        const isBold = item.fontName ? (/bold|black|heavy|medium|semibold/i.test(item.fontName)) : false;
        const textLen = Math.max(12, item.width);

        // คำนวณจุดกึ่งกลางของข้อความจริง
        const rad = (angleDeg * Math.PI) / 180;
        const centerX = left + (textLen / 2) * Math.cos(rad);
        const centerY = (top - fontHeight / 2) + (textLen / 2) * Math.sin(rad);

        return {
            centerX, centerY,
            left: centerX - textLen / 2,
            top: centerY - fontHeight / 2,
            width: textLen,
            height: fontHeight,
            fontSize: fontHeight,
            text: item.str,
            fontWeight: isBold ? '700' : '400',
            rotation: angleDeg
        };
    });

    bindCadTextEngine(wrapper, pageNum, pdfCanvas, glyphLayer, pageTextMetadata);
    bindDrawingEngine(annotCanvas, pageNum);
    bindShapeEngine(wrapper, pageNum, svgLayer);
}

// -------------------------------------------------------------
// IN-PLACE UNIVERSAL TEXT ENGINE (ดับเบิลคลิกพิมพ์สดบนกระดาษ)
// -------------------------------------------------------------
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

    // คลิกพื้นที่ว่างเพื่อแทรกข้อความใหม่ด่วน (Typewriter Mode)
    wrapper.addEventListener('click', (e) => {
        if (currentTool !== 'text') return;
        if (e.target.closest('.glyph-hitbox') || e.target.closest('.cad-text-node') || e.target.closest('.cad-inline-editor')) return;

        const coords = getPageAccurateCoords(e, wrapper);
        openInPlaceEditor(wrapper, pageNum, pdfCanvas, coords.x - 20, coords.y - 8, 40, 16, '', 11, '400', 0, false);
    });
}

function openInPlaceEditor(wrapper, pageNum, pdfCanvas, left, top, width, height, initialText, fontSize, fontWeight, rotation, isReplacingOriginal) {
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

        // 🎯 ถมสี่เหลี่ยมสีขาวตามพิกัดและมุมหมุนจริงเป๊ะๆ ป้องกันปัญหาตัวหนังสือซ้อนทับกัน
        const rad = (rotation * Math.PI) / 180;
        const cX = (left + (finalW / 2)) * ratioX;
        const cY = (top + (height / 2)) * ratioY;
        const clearW = (finalW * ratioX) + (4 * ratioX);
        const clearH = (height * ratioY) + (4 * ratioY);

        let previousImageData = null;
        const snapBoxSize = Math.ceil(Math.max(clearW, clearH) * 1.5);
        const snapX = Math.max(0, Math.floor(cX - snapBoxSize / 2));
        const snapY = Math.max(0, Math.floor(cY - snapBoxSize / 2));

        if (isReplacingOriginal) {
            previousImageData = ctx.getImageData(snapX, snapY, snapBoxSize, snapBoxSize);

            ctx.save();
            ctx.translate(cX, cY);
            ctx.rotate(rad);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-clearW / 2, -clearH / 2, clearW, clearH);
            ctx.restore();
        }

        const cadNode = createCadTextNode(wrapper, pageNum, pdfCanvas, left, top, finalW, height, text, fontSize, fontWeight, rotation);

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
                    ctx.fillStyle = '#ffffff';
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

// -------------------------------------------------------------
// BOUNDING BOX + FREE ROTATE HANDLE (ก้านหมุน 360° + ล็อกฉาก SHIFT)
// -------------------------------------------------------------
function createCadTextNode(wrapper, pageNum, pdfCanvas, left, top, width, height, text, fontSize, fontWeight, rotation) {
    const layer = wrapper.querySelector('.patch-layer');
    const wH = parseFloat(wrapper.style.height);

    const node = document.createElement('div');
    node.className = 'cad-text-node selected';
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.width = width + 'px';
    node.style.height = height + 'px';
    node.style.fontSize = fontSize + 'px';
    node.style.fontWeight = fontWeight;
    node.style.color = '#111827';
    node.style.transform = `rotate(${rotation}deg)`;
    node.innerText = text;

    // ก้านหมุน Lollipop Handle
    const rotStem = document.createElement('div');
    rotStem.className = 'cad-rot-stem';
    const rotHandle = document.createElement('div');
    rotHandle.className = 'cad-rot-handle';
    node.appendChild(rotStem);
    node.appendChild(rotHandle);

    // ปุ่มกากบาทลบ
    const delBadge = document.createElement('div');
    delBadge.className = 'cad-del-badge';
    delBadge.innerHTML = '&times;';
    node.appendChild(delBadge);

    layer.appendChild(node);
    selectNode(node);

    let currentRot = rotation;
    const patchData = {
        boxLeft: left,
        patchBoxY: wH - (top + height),
        width: width,
        height: height,
        text: text,
        fontSize: fontSize,
        fontWeight: fontWeight,
        rotation: currentRot,
        textColor: { r: 0.07, g: 0.09, b: 0.15 }
    };

    if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [], shapes: [] };
    documentPatches[pageNum].patches.push(patchData);
    node.patchData = patchData;

    node.deleteSelf = () => {
        node.remove();
        documentPatches[pageNum].patches = documentPatches[pageNum].patches.filter(p => p !== patchData);
        showToast("ลบข้อความแล้วค่ะ");
    };
    delBadge.onclick = (e) => { e.stopPropagation(); node.deleteSelf(); };

    // ดับเบิลคลิกเพื่อแก้คำซ้ำ
    node.ondblclick = (e) => {
        e.stopPropagation();
        node.deleteSelf();
        openInPlaceEditor(wrapper, pageNum, pdfCanvas, parseFloat(node.style.left), parseFloat(node.style.top), width, height, text, fontSize, fontWeight, currentRot, false);
    };

    // หมุนอิสระ 360° ด้วยก้านหมุน (กด Shift ค้างเพื่อล็อกมุมฉาก 90°)
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

        // กด Shift ค้างเพื่อล็อกฉาก 90°
        if (e.shiftKey) {
            angleDeg = (Math.round(angleDeg / 90) * 90) % 360;
        }

        currentRot = angleDeg;
        node.style.transform = `rotate(${currentRot}deg)`;
        patchData.rotation = currentRot;
    });

    rotHandle.addEventListener('pointerup', () => { isRotating = false; });

    // ลากย้ายตำแหน่งอย่างอิสระ
    let isDragging = false, startX = 0, startY = 0, origL = left, origT = top;
    node.addEventListener('pointerdown', (e) => {
        if (e.target === rotHandle || e.target === delBadge) return;
        selectNode(node);
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
        patchData.patchBoxY = wH - ((origT + dy) + height);
    });

    node.addEventListener('pointerup', () => { isDragging = false; });

    return node;
}

function selectNode(node) {
    if (selectedNode && selectedNode !== node) selectedNode.classList.remove('selected');
    selectedNode = node;
    if (selectedNode) selectedNode.classList.add('selected');
}

window.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.cad-text-node')) {
        if (selectedNode) { selectedNode.classList.remove('selected'); selectedNode = null; }
    }
});

// --------------------------------------------------------------------------
// REVISION CLOUD & RECTANGLE ENGINE (มาร์กจุดตรวจแบบมาตรฐานระดับ CAD)
// --------------------------------------------------------------------------
function generateCloudPath(x1, y1, x2, y2) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const width = maxX - minX, height = maxY - minY;

    if (width < 10 || height < 10) return '';

    const arcRadius = 14; // รัศมีลอนคลื่นก้อนเมฆมาตรฐาน
    let path = `M ${minX} ${minY}`;

    // ขอบบน (ซ้ายไปขวา)
    for (let x = minX; x < maxX; x += arcRadius * 1.5) {
        const nextX = Math.min(x + arcRadius * 1.5, maxX);
        const midX = (x + nextX) / 2;
        path += ` Q ${midX} ${minY - arcRadius} ${nextX} ${minY}`;
    }
    // ขวา (บนลงล่าง)
    for (let y = minY; y < maxY; y += arcRadius * 1.5) {
        const nextY = Math.min(y + arcRadius * 1.5, maxY);
        const midY = (y + nextY) / 2;
        path += ` Q ${maxX + arcRadius} ${midY} ${maxX} ${nextY}`;
    }
    // ล่าง (ขวาไปซ้าย)
    for (let x = maxX; x > minX; x -= arcRadius * 1.5) {
        const nextX = Math.max(x - arcRadius * 1.5, minX);
        const midX = (x + nextX) / 2;
        path += ` Q ${midX} ${maxY + arcRadius} ${nextX} ${maxY}`;
    }
    // ซ้าย (ล่างขึ้นบน)
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
        if (isDrawingShape) {
            isDrawingShape = false;
            showToast(currentTool === 'cloud' ? "วาด Revision Cloud เรียบร้อยค่ะ" : "วาดกรอบสี่เหลี่ยมเรียบร้อยค่ะ");
        }
    });
}

// -------------------------------------------------------------
// PANNING & DRAWING ENGINE
// -------------------------------------------------------------
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

// Spacebar / Middle-Click Pan System
const wsEl = document.querySelector('.workspace');
let isPanning = false, panStartX = 0, panStartY = 0, scrollStartL = 0, scrollStartT = 0;

wsEl.addEventListener('pointerdown', (e) => {
    if (isSpacePressed || currentTool === 'pan' || e.button === 1) { // 1 = Middle Click
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

// -------------------------------------------------------------
// SIGNATURE MODAL HANDLERS
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// VECTOR PDF EXPORT (คมชัด 100%)
// -------------------------------------------------------------
async function exportVectorPDF() {
    if (!originalPdfBytes) return alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!");

    try {
        showToast("กำลังส่งออกเวกเตอร์ PDF คมชัดสูง...");
        const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
        const loadedPdf = await PDFDocument.load(originalPdfBytes);
        
        let thaiFontRegular, thaiFontBold;
        try {
            loadedPdf.registerFontkit(fontkit);
            if (!cachedRegularFontBytes) cachedRegularFontBytes = await fetch(THAI_FONT_REGULAR_URL).then(r => r.arrayBuffer());
            if (!cachedBoldFontBytes) cachedBoldFontBytes = await fetch(THAI_FONT_BOLD_URL).then(r => r.arrayBuffer());
            thaiFontRegular = await loadedPdf.embedFont(cachedRegularFontBytes);
            thaiFontBold = await loadedPdf.embedFont(cachedBoldFontBytes);
        } catch (e) {
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
                    const isBold = pt.fontWeight === '700';
                    const font = isBold ? thaiFontBold : thaiFontRegular;
                    targetPage.drawText(pt.text, {
                        x: pt.boxLeft + 2,
                        y: pt.patchBoxY + 3,
                        size: pt.fontSize,
                        font: font,
                        color: rgb(0.07, 0.09, 0.15),
                        rotate: degrees(pt.rotation || 0)
                    });
                });
            }
        }

        // Render Canvas Freehand Annotation
        const wrappers = document.querySelectorAll('.page-wrapper');
        for (let i = 0; i < wrappers.length; i++) {
            const c = wrappers[i].querySelector('.annotation-canvas');
            const targetPage = pages[i];
            const imgData = c.toDataURL('image/png');
            const imgBytes = await fetch(imgData).then(r => r.arrayBuffer());
            const embedded = await loadedPdf.embedPng(imgBytes);
            targetPage.drawImage(embedded, { x: 0, y: 0, width: targetPage.getWidth(), height: targetPage.getHeight() });
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
        alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
    }
}

function setTool(tool) {
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

    document.getElementById('active-color-input').onchange = (e) => {
        currentInkColor = e.target.value;
    };

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
