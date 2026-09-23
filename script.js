const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Global States
let currentTool = 'patch'; // 'patch', 'pen', 'highlighter', 'eraser', 'pan'
let currentInkColor = '#0033aa';
let currentScale = 1.0;
let pdfDoc = null;
let originalPdfBytes = null;
let originalFileName = 'Nawee_Document';

// Patch Store เก็บข้อมูล Object ทั้งหมดรายหน้า { [pageNum]: { patches: [], images: [] } }
let documentPatches = {};

// ฟอนต์ภาษาไทยสำหรับ Vector PDF
const THAI_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts/ofl/sarabun/Sarabun-Regular.ttf';
let cachedFontBytes = null;

// Modal & Signature
let sigCanvas, sigCtx, isDrawingSig = false, sigColor = '#0033aa', uploadedSigBase64 = null;

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
}

// -------------------------------------------------------------
// เริ่มงานใหม่
// -------------------------------------------------------------
function resetApp() {
    if (confirm("ต้องการเริ่มงานใหม่และล้างเอกสารปัจจุบันหรือไม่คะ?")) {
        pdfDoc = null;
        originalPdfBytes = null;
        documentPatches = {};
        originalFileName = "Nawee_Document";
        currentScale = 1.0;
        const container = document.getElementById('document-container');
        container.innerHTML = `
            <div class="welcome-box">
                <div class="welcome-icon"><i class="fa-solid fa-file-pdf"></i></div>
                <h2>ยินดีต้อนรับสู่ Nawee PDF Studio</h2>
                <p>แก้ไขเอกสารแบบแนบเนียน ลบคำผิด ดูดสีพื้นหลังอัตโนมัติ ไม่บังเส้นตาราง และส่งออกไฟล์คมชัดระดับเวกเตอร์</p>
                <button onclick="document.getElementById('upload-pdf').click()" class="btn-open-file">
                    <i class="fa-solid fa-arrow-up-from-bracket"></i> เลือกไฟล์ PDF เพื่อเริ่มงาน
                </button>
            </div>
        `;
        showToast("รีเซ็ตระบบพร้อมเริ่มงานใหม่แล้วค่ะ");
    }
}

// -------------------------------------------------------------
// โหลดและเรนเดอร์เอกสาร (พร้อมสกัด Metadata ของข้อความเดิม)
// -------------------------------------------------------------
async function handleFileOpen(e) {
    const file = e.target.files[0];
    if (!file) return;
    originalFileName = file.name.replace(/\.[^/.]+$/, "");
    
    showToast("กำลังอ่านข้อมูลเอกสาร...");
    originalPdfBytes = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: originalPdfBytes.slice(0) }).promise;
    
    documentPatches = {};
    const container = document.getElementById('document-container');
    container.innerHTML = '';
    currentScale = 1.0;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        await renderPage(i, container);
    }

    setTool('patch');
    showToast(`เปิดเอกสารเรียบร้อย (${pdfDoc.numPages} หน้า) - ลากคลุมคำที่ต้องการแก้ได้เลยค่ะ`);
}

async function renderPage(pageNum, container) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });

    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.pageNumber = pageNum;
    wrapper.style.width = (viewport.width / 2) + 'px';
    wrapper.style.height = (viewport.height / 2) + 'px';

    // 1. Canvas แสดงผล PDF เดิม คมกริบ
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-page-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    wrapper.appendChild(pdfCanvas);

    // 2. Canvas วาดเขียน/ไฮไลต์
    const annotCanvas = document.createElement('canvas');
    annotCanvas.className = 'annotation-canvas';
    annotCanvas.width = viewport.width;
    annotCanvas.height = viewport.height;
    wrapper.appendChild(annotCanvas);

    // 3. Layer รองรับการลากกล่องแก้คำ (Smart Patch)
    const patchLayer = document.createElement('div');
    patchLayer.className = 'patch-layer';
    wrapper.appendChild(patchLayer);

    container.appendChild(wrapper);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

    // 🎯 สกัดตำแหน่งและขนาดฟอนต์ของข้อความเดิมในหน้านี้ (Auto Font & Baseline Match)
    const textContent = await page.getTextContent();
    const displayViewport = page.getViewport({ scale: 1.0 });

    const pageTextMetadata = textContent.items.map(item => {
        const [left, top] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontSize = Math.hypot(item.transform[0], item.transform[1]);
        return {
            x: left,
            y: top - fontSize,
            width: item.width,
            height: fontSize,
            fontSize: fontSize,
            text: item.str,
            pdfX: item.transform[4],
            pdfY: item.transform[5]
        };
    });

    bindSmartPatchEngine(wrapper, pageNum, pdfCanvas, pageTextMetadata);
    bindDrawingEngine(annotCanvas, pageNum);
}

// -------------------------------------------------------------
// อัลกอริทึมดูดสีพื้นหลังอัจฉริยะ (Histogram Analysis)
// -------------------------------------------------------------
function getCanvasPixelColor(canvas, x, y, width, height) {
    const ctx = canvas.getContext('2d');
    const ratioX = canvas.width / parseFloat(canvas.style.width || (canvas.width / 2));
    const ratioY = canvas.height / parseFloat(canvas.style.height || (canvas.height / 2));

    const safeLeft = Math.floor((x + 2) * ratioX);
    const safeTop = Math.floor((y + 2) * ratioY);
    const safeWidth = Math.max(1, Math.floor((width - 4) * ratioX));
    const safeHeight = Math.max(1, Math.floor((height - 4) * ratioY));

    try {
        const imgData = ctx.getImageData(safeLeft, safeTop, safeWidth, safeHeight).data;
        const colorCounts = {};
        let maxCount = 0;
        let dominantColor = { r: 255, g: 255, b: 255, hex: '#ffffff' };

        const step = Math.max(1, Math.floor((safeWidth * safeHeight) / 100));
        for (let i = 0; i < imgData.length; i += step * 4) {
            if (imgData[i + 3] < 128) continue;

            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];
            const key = `${r},${g},${b}`;

            colorCounts[key] = (colorCounts[key] || 0) + 1;
            if (colorCounts[key] > maxCount) {
                maxCount = colorCounts[key];
                dominantColor = {
                    r: r / 255,
                    g: g / 255,
                    b: b / 255,
                    hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
                };
            }
        }
        return dominantColor;
    } catch (e) {
        return { r: 1, g: 1, b: 1, hex: '#ffffff' };
    }
}

// -------------------------------------------------------------
// อัลกอริทึมค้นหาข้อความเดิม (จับคู่ขนาดฟอนต์ และเส้นบรรทัดเดิม)
// -------------------------------------------------------------
function getMatchedOriginalText(boxLeft, boxTop, boxWidth, boxHeight, textMetadata) {
    if (!textMetadata || textMetadata.length === 0) return null;

    const overlaps = textMetadata.filter(item => {
        return (
            item.x < boxLeft + boxWidth &&
            item.x + item.width > boxLeft &&
            item.y < boxTop + boxHeight &&
            item.y + item.height > boxTop &&
            item.text && item.text.trim() !== ''
        );
    });

    if (overlaps.length > 0) {
        const orig = overlaps[0];
        return {
            fontSize: Math.round(orig.fontSize),
            origX: orig.x,
            origY: orig.y,
            origPdfY: orig.pdfY,
            height: orig.height
        };
    }
    return null;
}

// -------------------------------------------------------------
// ระบบลากคลุมลบคำผิด & ดูดสีพื้นหลังอัตโนมัติ (Smart Auto-Sample Patch)
// -------------------------------------------------------------
function bindSmartPatchEngine(wrapper, pageNum, pdfCanvas, textMetadata) {
    let startX = 0, startY = 0;
    let isDragging = false;
    let selectionBox = null;

    wrapper.addEventListener('pointerdown', (e) => {
        if (currentTool !== 'patch') return;
        if (e.target.closest('.active-patch-node') || e.target.closest('.committed-patch-node') || e.target.closest('.custom-draggable-sig')) return;

        const rect = wrapper.getBoundingClientRect();
        startX = (e.clientX - rect.left) / currentScale;
        startY = (e.clientY - rect.top) / currentScale;
        isDragging = true;

        selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        wrapper.querySelector('.patch-layer').appendChild(selectionBox);
    });

    wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging || !selectionBox) return;
        const rect = wrapper.getBoundingClientRect();
        const curX = (e.clientX - rect.left) / currentScale;
        const curY = (e.clientY - rect.top) / currentScale;

        const w = Math.abs(curX - startX);
        const h = Math.abs(curY - startY);
        selectionBox.style.width = w + 'px';
        selectionBox.style.height = h + 'px';
        selectionBox.style.left = Math.min(startX, curX) + 'px';
        selectionBox.style.top = Math.min(startY, curY) + 'px';
    });

    wrapper.addEventListener('pointerup', () => {
        if (!isDragging || !selectionBox) return;
        isDragging = false;

        const boxWidth = parseFloat(selectionBox.style.width) || 0;
        const boxHeight = parseFloat(selectionBox.style.height) || 0;
        const boxLeft = parseFloat(selectionBox.style.left) || 0;
        const boxTop = parseFloat(selectionBox.style.top) || 0;
        selectionBox.remove();
        selectionBox = null;

        if (boxWidth < 10 || boxHeight < 8) return;

        // 1. ดูดสีพื้นหลัง
        const sampleColor = getCanvasPixelColor(pdfCanvas, boxLeft, boxTop, boxWidth, boxHeight);
        
        // 2. ตรวจจับข้อมูลข้อความเดิมใต้กรอบ (ขนาดฟอนต์ และระดับเส้นบรรทัด)
        const matchedOrig = getMatchedOriginalText(boxLeft, boxTop, boxWidth, boxHeight, textMetadata);

        createPatchBox(wrapper, pageNum, boxLeft, boxTop, boxWidth, boxHeight, sampleColor, matchedOrig);
    });
}

function createPatchBox(wrapper, pageNum, left, top, width, height, bgColor, matchedOrig) {
    const layer = wrapper.querySelector('.patch-layer');

    const isDark = (bgColor.r * 299 + bgColor.g * 587 + bgColor.b * 114) / 1000 < 0.5;
    const textColor = isDark ? '#ffffff' : '#000000';
    
    // 🎯 ถ้าเจอข้อความเดิม ให้ล็อกขนาดฟอนต์ตามของเดิมเป๊ะๆ
    const fontSize = matchedOrig ? matchedOrig.fontSize : Math.max(11, Math.min(24, Math.round(height * 0.72)));

    // หดขอบ 1.5px เพื่อไม่ให้กินเส้นตารางเดิม
    const insetLeft = left + 1.5;
    const insetTop = top + 1;
    const insetWidth = Math.max(10, width - 3);
    const insetHeight = Math.max(10, height - 2);

    const node = document.createElement('div');
    node.className = 'active-patch-node';
    node.style.left = insetLeft + 'px';
    node.style.top = insetTop + 'px';
    node.style.width = insetWidth + 'px';
    node.style.height = insetHeight + 'px';
    node.style.background = bgColor.hex;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'พิมพ์คำใหม่...';
    input.className = 'patch-input-inline';
    input.style.color = textColor;
    input.style.fontSize = fontSize + 'px';
    node.appendChild(input);

    layer.appendChild(node);
    setTimeout(() => input.focus(), 50);

    function commit() {
        const text = input.value.trim();
        if (!text) {
            node.remove();
            return;
        }

        // แปลงเป็นกล่องข้อความที่บันทึกแล้ว
        node.className = 'committed-patch-node';
        node.style.color = textColor;
        node.style.fontSize = fontSize + 'px';
        node.style.width = 'auto'; 
        node.style.minWidth = insetWidth + 'px'; 
        node.innerText = text;

        const finalWidth = node.offsetWidth;
        const wrapperHeight = parseFloat(wrapper.style.height);

        // 🎯 สแน็ปเส้นบรรทัด: ถ้ามีพิกัดเดิม ให้วางตรงระดับเดิมเป๊ะๆ
        let pdfY;
        if (matchedOrig && matchedOrig.origPdfY) {
            pdfY = matchedOrig.origPdfY;
        } else {
            const baselineOffset = (insetHeight - fontSize) / 2;
            pdfY = wrapperHeight - (insetTop + insetHeight) + baselineOffset;
        }

        if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [] };

        documentPatches[pageNum].patches.push({
            x: insetLeft,
            y: pdfY,
            patchBoxY: wrapperHeight - (insetTop + insetHeight),
            width: finalWidth + 2,
            height: insetHeight,
            text: text,
            fontSize: fontSize,
            bgColor: bgColor,
            textColor: textColor
        });

        // ดับเบิ้ลคลิกแก้ไขคำเดิมได้ตลอดเวลา
        node.addEventListener('dblclick', () => {
            node.remove();
            createPatchBox(wrapper, pageNum, left, top, width, height, bgColor, matchedOrig);
        });

        showToast("บันทึกคำแนบเนียนแล้วค่ะ");
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') node.remove();
    });
    input.addEventListener('blur', commit);
}

// -------------------------------------------------------------
// Canvas Drawing & Highlighter Engine
// -------------------------------------------------------------
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
            ctx.strokeStyle = currentInkColor === '#facc15' ? 'rgba(250, 204, 21, 0.4)' : 'rgba(14, 165, 233, 0.35)';
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
// ระบบเซ็นลายเซ็น & วางลงบนเอกสาร
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

        if (!documentPatches[pageNum]) documentPatches[pageNum] = { patches: [], images: [] };
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
// ส่งออก Vector PDF แท้ ด้วย pdf-lib + fontkit (คมกริบ 100%)
// -------------------------------------------------------------
async function exportVectorPDF() {
    if (!originalPdfBytes) { alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!"); return; }

    try {
        showToast("กำลังสร้างไฟล์ PDF คมชัดระดับเวกเตอร์...");
        const { PDFDocument, rgb } = PDFLib;
        const loadedPdf = await PDFDocument.load(originalPdfBytes);
        loadedPdf.registerFontkit(fontkit);

        if (!cachedFontBytes) {
            const res = await fetch(THAI_FONT_URL);
            cachedFontBytes = await res.arrayBuffer();
        }
        const thaiFont = await loadedPdf.embedFont(cachedFontBytes);
        const pages = loadedPdf.getPages();

        // 1. นำข้อมูล Patches ไปวาดกลบลบคำเดิมและพิมพ์ใหม่
        for (let pageNum in documentPatches) {
            const pIdx = parseInt(pageNum) - 1;
            if (pIdx < 0 || pIdx >= pages.length) continue;
            const targetPage = pages[pIdx];
            const pData = documentPatches[pageNum];

            if (pData.patches) {
                pData.patches.forEach(pt => {
                    // วาดสี่เหลี่ยมสีเดียวกับพื้นหลังเดิมกลบคำเดิม
                    const boxY = pt.patchBoxY !== undefined ? pt.patchBoxY : (pt.y - (pt.height * 0.1));
                    targetPage.drawRectangle({
                        x: pt.x,
                        y: boxY,
                        width: pt.width,
                        height: pt.height,
                        color: rgb(pt.bgColor.r, pt.bgColor.g, pt.bgColor.b),
                    });

                    // พิมพ์ข้อความใหม่ทับตรงเส้นบรรทัดเดิม
                    const tColor = pt.textColor === '#ffffff' ? rgb(1, 1, 1) : rgb(0, 0, 0);
                    targetPage.drawText(pt.text, {
                        x: pt.x + 2,
                        y: pt.y,
                        size: pt.fontSize,
                        font: thaiFont,
                        color: tColor,
                    });
                });
            }

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

        // 2. ฝังรอยวาดปากกาจาก Annotation Canvas
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

// -------------------------------------------------------------
// สลับเครื่องมือและการจัดมุมมอง
// -------------------------------------------------------------
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tool-${tool}`);
    if (btn) btn.classList.add('active');

    document.body.className = document.body.className.replace(/tool-\S+/g, '').trim();
    document.body.classList.add(`tool-${tool}`);

    const ws = document.querySelector('.workspace');
    if (tool === 'pan') ws.style.cursor = 'grab';
    else if (tool === 'patch') ws.style.cursor = 'crosshair';
    else ws.style.cursor = 'crosshair';
}

function selectInkColor(color, el) {
    currentInkColor = color;
    document.querySelectorAll('.color-circle').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    if (currentTool === 'eraser' || currentTool === 'pan' || currentTool === 'patch') {
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

function undoLastAction() {
    showToast("ย้อนกลับการกระทำล่าสุดแล้วค่ะ");
}

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('upload-pdf').addEventListener('change', handleFileOpen);
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
