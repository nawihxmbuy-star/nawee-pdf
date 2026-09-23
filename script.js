const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];

if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// สถานะแอปและเครื่องมือ
let currentScale = 1.0;
let currentTool = 'edit-text'; // ค่าเริ่มต้นให้เป็นโหมดแตะแก้ทันทีเหมือนโปรแกรมโปร
let currentActiveColor = "#22d3ee"; 
let currentBrushSize = 6;

let pdfDoc = null;
let originalPdfBytes = null; 
let initialDistance = 0;
let startScale = 1.0;
let originalFileName = "Nawee_Document";

let container = null;
let workspace = null;
let appTitle = null;
let eraserShape = 'circle';

// คลังเก็บประวัติการแก้ไขแบบ Vector รายหน้า { [pageNum]: { textEdits: [], whiteouts: [], images: [] } }
let pdfPatches = {};

// ลิงก์ฟอนต์ Sarabun สำหรับฝัง Vector
const THAI_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts/ofl/sarabun/Sarabun-Regular.ttf';
let cachedFontBytes = null;

// ตัวแปรสำหรับลายเซ็นและรูปภาพ
let sigPadCanvas = null;
let sigPadCtx = null;
let isDrawingSig = false;
let sigCurrentColor = "#000000";
let uploadedSigBase64 = null;

function showNotification(msg) {
    const div = document.createElement('div');
    div.className = 'custom-notification';
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transform = 'translateX(40px)';
        div.style.transition = 'all 0.3s ease';
        setTimeout(() => div.remove(), 400);
    }, 2200);
}
window.alert = function(msg) { showNotification(msg); };

async function loadThaiFont() {
    if (!cachedFontBytes) {
        showNotification("กำลังเตรียมโมดูลฟอนต์ภาษาไทย...");
        const res = await fetch(THAI_FONT_URL);
        cachedFontBytes = await res.arrayBuffer();
    }
    return cachedFontBytes;
}

// -------------------------------------------------------------
// เริ่มงานใหม่
// -------------------------------------------------------------
function resetApp() {
    if (confirm("ต้องการเริ่มงานใหม่และล้างเอกสารปัจจุบันหรือไม่คะ?")) {
        pdfDoc = null;
        originalPdfBytes = null;
        pdfPatches = {};
        originalFileName = "Nawee_Document";
        currentScale = 1.0;
        if (container) {
            container.innerHTML = `
                <div class="initial-notice">
                    <p><i class="fa-solid fa-cloud-arrow-up" style="font-size: 48px; color: var(--accent-color); margin-bottom: 15px;"></i></p>
                    <p>ยินดีต้อนรับสู่ Nawee PDF Studio</p>
                    <p style="font-size: 13px; color: #64748b; margin-top: 8px;">กดปุ่ม <b>"เปิดไฟล์"</b> ด้านบนเพื่อเริ่มแก้ไขเอกสารแบบแนบเนียนค่ะ</p>
                </div>
            `;
            container.style.transform = 'scale(1)';
        }
        const uploadInput = document.getElementById('upload');
        if (uploadInput) uploadInput.value = '';
        showNotification("เริ่มงานใหม่เรียบร้อยแล้วค่ะ");
    }
}

// -------------------------------------------------------------
// DOM Ready
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    container = document.getElementById('pdf-container');
    workspace = document.querySelector('.workspace');
    appTitle = document.getElementById('app-title');
    
    const uploadInput = document.getElementById('upload');
    if (uploadInput) uploadInput.addEventListener('change', handleFileOpen);
    
    // ตั้งค่าจานสีและแปรง
    const colorPicker = document.getElementById('color-picker');
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            currentActiveColor = e.target.value;
            document.querySelectorAll('.pen-palette-dot').forEach(d => d.classList.remove('active'));
            updateBrushPreview();
        });
    }

    const brushSlider = document.getElementById('brush-size-slider');
    const brushLabel = document.getElementById('brush-size-val');
    if (brushSlider && brushLabel) {
        brushSlider.addEventListener('input', (e) => {
            currentBrushSize = parseInt(e.target.value);
            brushLabel.innerText = currentBrushSize + 'px';
            updateBrushPreview();
        });
    }

    document.querySelectorAll('.pen-palette-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            const picked = e.target.getAttribute('data-color');
            if (picked) {
                currentActiveColor = picked;
                if (colorPicker) colorPicker.value = picked;
                updateBrushPreview();
                document.querySelectorAll('.pen-palette-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
            }
        });
    });

    // ซูมสองนิ้วบนมือถือ/แท็บเล็ต
    if (workspace) {
        workspace.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                initialDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                startScale = currentScale; 
            }
        }, { passive: true });

        workspace.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault(); 
                let newDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                if (initialDistance > 0) {
                    let scaleChange = newDistance / initialDistance;
                    let nextScale = startScale * scaleChange;
                    if (nextScale > 0.5 && nextScale < 3.5) {
                        currentScale = nextScale;
                        applyZoom();
                    }
                }
            }
        }, { passive: false });
    }

    initSignaturePad();
    updateBrushPreview();
    setTool('edit-text');
});

// -------------------------------------------------------------
// โหลดและเรนเดอร์เอกสาร PDF (ไม่มีตัวหนังสือซ้อน 100%)
// -------------------------------------------------------------
async function handleFileOpen(e) {
    try {
        const file = e.target.files[0];
        if (!file) return;
        originalFileName = file.name.replace(/\.[^/.]+$/, "");
        
        showNotification("กำลังอ่านข้อมูลเอกสาร...");
        originalPdfBytes = await file.arrayBuffer();
        
        pdfDoc = await pdfjsLib.getDocument({ data: originalPdfBytes.slice(0) }).promise;
        pdfPatches = {}; 
        container.innerHTML = '';
        currentScale = 1.0;
        applyZoom();

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            await renderSinglePage(i);
        }
        
        setTool(currentTool);
        showNotification(`โหลดเอกสารเสร็จเรียบร้อย (${pdfDoc.numPages} หน้า) - ดับเบิ้ลคลิกที่คำเพื่อแก้ได้เลยค่ะ`);
    } catch (error) {
        alert("เกิดข้อผิดพลาดในการโหลดไฟล์: " + error.message);
    }
}

async function renderSinglePage(pageNumber) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.pageNumber = pageNumber;
    pageWrapper.style.width = (viewport.width / 2) + 'px';
    pageWrapper.style.height = (viewport.height / 2) + 'px';

    // 1. PDF Canvas
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-page-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pageWrapper.appendChild(pdfCanvas);

    // 2. Drawing Canvas
    const drawingCanvas = document.createElement('canvas');
    drawingCanvas.className = 'drawing-page-canvas';
    drawingCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    pageWrapper.appendChild(drawingCanvas);

    // 3. Text Overlay Layer
    const textOverlayLayer = document.createElement('div');
    textOverlayLayer.className = 'text-overlay-layer';
    pageWrapper.appendChild(textOverlayLayer);
    container.appendChild(pageWrapper);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

    // ดึงตำแหน่งตัวหนังสือจริงสำหรับ In-place Edit
    const textContent = await page.getTextContent();
    const displayViewport = page.getViewport({ scale: 1.0 });

    textContent.items.forEach(item => {
        if (!item.str || item.str.trim() === "") return;
        const [left, top] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontSize = Math.hypot(item.transform[0], item.transform[1]);

        const textSpan = document.createElement('div');
        textSpan.className = 'word-text-node';
        textSpan.style.left = left + 'px';
        textSpan.style.top = (top - fontSize) + 'px';
        textSpan.style.fontSize = fontSize + 'px';
        textSpan.style.lineHeight = fontSize + 'px';
        textSpan.style.height = fontSize + 'px';
        textSpan.innerText = item.str;

        // ข้อมูลพิกัด PDF แท้
        textSpan.dataset.pdfX = item.transform[4];
        textSpan.dataset.pdfY = item.transform[5];
        textSpan.dataset.fontSize = fontSize;
        textSpan.dataset.itemWidth = item.width;
        textSpan.dataset.originalText = item.str;
        textSpan.dataset.pageNumber = pageNumber;

        // ดับเบิ้ลคลิก (หรือแตะ 2 ครั้ง) เพื่อเริ่มแก้ไขตรงจุดนั้นทันที (In-place Edit)
        textSpan.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            startInPlaceEdit(textSpan, pageNumber, item);
        });

        textOverlayLayer.appendChild(textSpan);
    });

    bindDrawingEngine(drawingCanvas);
    bindWhiteoutEngine(pageWrapper, pageNumber);
}

// -------------------------------------------------------------
// ระบบ In-place Inline Edit (ดับเบิ้ลคลิกแก้ตรงจุดนั้นทันทีแบบ Word / Acrobat)
// -------------------------------------------------------------
function startInPlaceEdit(domNode, pageNumber, itemData) {
    if (domNode.classList.contains('is-actively-editing')) return;

    const originalText = domNode.dataset.originalText || domNode.innerText;
    domNode.classList.add('is-actively-editing');
    domNode.setAttribute('contenteditable', 'true');
    domNode.focus();

    // คลุมดำข้อความเดิมทั้งหมดเพื่อให้พร้อมพิมพ์ทับ
    const range = document.createRange();
    range.selectNodeContents(domNode);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finishEdit() {
        domNode.removeAttribute('contenteditable');
        domNode.classList.remove('is-actively-editing');
        const newText = domNode.innerText.trim();

        if (newText === '' || newText === originalText) {
            // ไม่มีการเปลี่ยนคำ
            if (newText === '') domNode.innerText = originalText;
            domNode.classList.remove('is-patched');
            return;
        }

        // ปิดทับคำเดิมและบันทึกลง Patch
        domNode.classList.add('is-patched');

        if (!pdfPatches[pageNumber]) pdfPatches[pageNumber] = { textEdits: [], whiteouts: [], images: [] };

        pdfPatches[pageNumber].textEdits.push({
            x: parseFloat(domNode.dataset.pdfX),
            y: parseFloat(domNode.dataset.pdfY),
            fontSize: parseFloat(domNode.dataset.fontSize),
            oldText: originalText,
            newText: newText,
            width: parseFloat(domNode.dataset.itemWidth) || 50,
        });

        showNotification("แก้ไขข้อความเรียบร้อยแล้วค่ะ");
    }

    // กด Enter เพื่อยืนยัน หรือคลิกออกข้างนอกเพื่อบันทึก
    domNode.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            domNode.blur();
        }
    });

    domNode.addEventListener('blur', function onBlur() {
        domNode.removeEventListener('blur', onBlur);
        finishEdit();
    });
}

// -------------------------------------------------------------
// ระบบลากบล็อกลบคำเดิม (Whiteout Engine)
// -------------------------------------------------------------
function bindWhiteoutEngine(pageWrapper, pageNumber) {
    let startX = 0, startY = 0;
    let isCreatingBox = false;
    let tempBox = null;

    function onPointerDown(e) {
        if (currentTool !== 'whiteout') return;
        const rect = pageWrapper.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        startX = (clientX - rect.left) / currentScale;
        startY = (clientY - rect.top) / currentScale;
        isCreatingBox = true;

        tempBox = document.createElement('div');
        tempBox.className = 'whiteout-box';
        tempBox.style.left = startX + 'px';
        tempBox.style.top = startY + 'px';
        pageWrapper.querySelector('.text-overlay-layer').appendChild(tempBox);
    }

    function onPointerMove(e) {
        if (!isCreatingBox || !tempBox) return;
        if (e.cancelable) e.preventDefault();
        const rect = pageWrapper.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const currentX = (clientX - rect.left) / currentScale;
        const currentY = (clientY - rect.top) / currentScale;

        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        tempBox.style.width = width + 'px';
        tempBox.style.height = height + 'px';
        tempBox.style.left = Math.min(startX, currentX) + 'px';
        tempBox.style.top = Math.min(startY, currentY) + 'px';
    }

    function onPointerUp() {
        if (!isCreatingBox || !tempBox) return;
        isCreatingBox = false;

        const width = parseFloat(tempBox.style.width);
        const height = parseFloat(tempBox.style.height);

        if (width < 6 || height < 6) {
            tempBox.remove();
            return;
        }

        const wrapperHeight = parseFloat(pageWrapper.style.height);
        const boxLeft = parseFloat(tempBox.style.left);
        const boxTop = parseFloat(tempBox.style.top);
        const pdfY = wrapperHeight - (boxTop + height);

        if (!pdfPatches[pageNumber]) pdfPatches[pageNumber] = { textEdits: [], whiteouts: [], images: [] };
        pdfPatches[pageNumber].whiteouts.push({
            x: boxLeft,
            y: pdfY,
            width: width,
            height: height
        });

        tempBox.title = "ดับเบิ้ลคลิกเพื่อลบบล็อกนี้";
        tempBox.addEventListener('dblclick', () => {
            tempBox.remove();
            showNotification("ลบบล็อกปิดข้อความแล้วค่ะ");
        });

        showNotification("สร้างบล็อกลบข้อความแล้วค่ะ");
    }

    pageWrapper.addEventListener('mousedown', onPointerDown);
    pageWrapper.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    pageWrapper.addEventListener('touchstart', onPointerDown, { passive: true });
    pageWrapper.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
}

// -------------------------------------------------------------
// ระบบเซ็นลายเซ็นสด & อัปโหลดรูปภาพตราประทับ
// -------------------------------------------------------------
function initSignaturePad() {
    sigPadCanvas = document.getElementById('signature-pad');
    if (!sigPadCanvas) return;
    sigPadCtx = sigPadCanvas.getContext('2d');
    sigPadCtx.lineWidth = 2.5;
    sigPadCtx.lineCap = 'round';
    sigPadCtx.lineJoin = 'round';

    function getSigCoords(e) {
        const rect = sigPadCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function startSig(e) {
        isDrawingSig = true;
        const coords = getSigCoords(e);
        sigPadCtx.beginPath();
        sigPadCtx.moveTo(coords.x, coords.y);
    }
    function moveSig(e) {
        if (!isDrawingSig) return;
        if (e.cancelable) e.preventDefault();
        const coords = getSigCoords(e);
        sigPadCtx.strokeStyle = sigCurrentColor;
        sigPadCtx.lineTo(coords.x, coords.y);
        sigPadCtx.stroke();
    }
    function stopSig() { isDrawingSig = false; }

    sigPadCanvas.addEventListener('mousedown', startSig);
    sigPadCanvas.addEventListener('mousemove', moveSig);
    window.addEventListener('mouseup', stopSig);

    sigPadCanvas.addEventListener('touchstart', startSig, { passive: true });
    sigPadCanvas.addEventListener('touchmove', moveSig, { passive: false });
    window.addEventListener('touchend', stopSig);
}

function openSignatureModal() {
    const modal = document.getElementById('signature-modal');
    if (modal) modal.style.display = 'flex';
    clearSignaturePad();
    switchSigTab('draw');
}
function closeSignatureModal() {
    const modal = document.getElementById('signature-modal');
    if (modal) modal.style.display = 'none';
}
function clearSignaturePad() {
    if (sigPadCtx && sigPadCanvas) sigPadCtx.clearRect(0, 0, sigPadCanvas.width, sigPadCanvas.height);
}
function setSigColor(color) { sigCurrentColor = color; }

function switchSigTab(tab) {
    document.getElementById('tab-draw-sig').className = tab === 'draw' ? 'active' : '';
    document.getElementById('tab-upload-sig').className = tab === 'upload' ? 'active' : '';
    document.getElementById('sig-draw-pane').style.display = tab === 'draw' ? 'block' : 'none';
    document.getElementById('sig-upload-pane').style.display = tab === 'upload' ? 'block' : 'none';
}

function handleSigFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        uploadedSigBase64 = ev.target.result;
        const preview = document.getElementById('sig-img-preview');
        preview.src = uploadedSigBase64;
        document.getElementById('sig-upload-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function insertSignatureToDoc() {
    let base64Data = null;
    const isDrawMode = document.getElementById('tab-draw-sig').classList.contains('active');
    if (isDrawMode) {
        base64Data = sigPadCanvas.toDataURL('image/png');
    } else {
        base64Data = uploadedSigBase64;
    }

    if (!base64Data) {
        alert("กรุณาวาดลายเซ็นหรืออัปโหลดรูปภาพก่อนค่ะ!");
        return;
    }

    const activePage = getActivePageWrapper();
    if (!activePage) { alert("ไม่พบหน้าเอกสารเป้าหมายค่ะ"); return; }
    const overlay = activePage.querySelector('.text-overlay-layer');

    const sigNode = document.createElement('div');
    sigNode.className = 'custom-draggable-sig-node';
    sigNode.style.width = '140px';
    sigNode.style.height = '60px';
    sigNode.style.left = '50%';
    sigNode.style.top = '50%';

    const img = document.createElement('img');
    img.src = base64Data;
    sigNode.appendChild(img);

    const removeBtn = document.createElement('div');
    removeBtn.className = 'sig-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = (e) => { e.stopPropagation(); sigNode.remove(); };
    sigNode.appendChild(removeBtn);

    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function onDragStart(e) {
        isDragging = true;
        startX = e.touches ? e.touches[0].pageX : e.pageX;
        startY = e.touches ? e.touches[0].pageY : e.pageY;
        startLeft = parseFloat(sigNode.style.left) || 0;
        startTop = parseFloat(sigNode.style.top) || 0;
    }
    function onDragMove(e) {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        const pageX = e.touches ? e.touches[0].pageX : e.pageX;
        const pageY = e.touches ? e.touches[0].pageY : e.pageY;
        const dx = (pageX - startX) / currentScale;
        const dy = (pageY - startY) / currentScale;
        sigNode.style.left = (startLeft + dx) + 'px';
        sigNode.style.top = (startTop + dy) + 'px';
    }
    function onDragEnd() {
        if (!isDragging) return;
        isDragging = false;
        
        const pageNum = parseInt(activePage.dataset.pageNumber);
        const wrapperHeight = parseFloat(activePage.style.height);
        const w = parseFloat(sigNode.style.width);
        const h = parseFloat(sigNode.style.height);
        const left = parseFloat(sigNode.style.left);
        const top = parseFloat(sigNode.style.top);

        if (!pdfPatches[pageNum]) pdfPatches[pageNum] = { textEdits: [], whiteouts: [], images: [] };
        pdfPatches[pageNum].images.push({
            x: left - (w / 2),
            y: wrapperHeight - (top + (h / 2)),
            width: w,
            height: h,
            base64: base64Data
        });
    }

    sigNode.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    sigNode.addEventListener('touchstart', onDragStart, { passive: true });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    overlay.appendChild(sigNode);
    closeSignatureModal();
    showNotification("วางลายเซ็นเรียบร้อยแล้ว สามารถลากปรับตำแหน่งได้ค่ะ");
}

// -------------------------------------------------------------
// ส่งออก Vector PDF แท้ ด้วย pdf-lib (คมกริบ 100% ตัวหนังสือไม่บวม)
// -------------------------------------------------------------
async function exportToPDFFile() {
    if (!originalPdfBytes) {
        alert("ไม่พบข้อมูลเอกสารเพื่อส่งออกค่ะ!");
        return;
    }

    try {
        showNotification("กำลังประกอบร่างไฟล์ PDF แท้ กรุณารอสักครู่...");
        const { PDFDocument, rgb } = PDFLib;
        const loadedPdf = await PDFDocument.load(originalPdfBytes);
        loadedPdf.registerFontkit(fontkit);

        const fontBytes = await loadThaiFont();
        const thaiFont = await loadedPdf.embedFont(fontBytes);
        const pages = loadedPdf.getPages();

        for (let pageNum in pdfPatches) {
            const pageIndex = parseInt(pageNum) - 1;
            if (pageIndex < 0 || pageIndex >= pages.length) continue;
            
            const targetPage = pages[pageIndex];
            const patches = pdfPatches[pageNum];

            // 1. วาดบล็อกลบคำ (Whiteouts)
            if (patches.whiteouts) {
                patches.whiteouts.forEach(box => {
                    targetPage.drawRectangle({
                        x: box.x,
                        y: box.y,
                        width: box.width,
                        height: box.height,
                        color: rgb(1, 1, 1),
                    });
                });
            }

            // 2. ลบคำเดิมและพิมพ์คำใหม่
            if (patches.textEdits) {
                patches.textEdits.forEach(edit => {
                    targetPage.drawRectangle({
                        x: edit.x,
                        y: edit.y - (edit.fontSize * 0.2),
                        width: edit.width + 4,
                        height: edit.fontSize * 1.25,
                        color: rgb(1, 1, 1),
                    });

                    targetPage.drawText(edit.newText, {
                        x: edit.x,
                        y: edit.y,
                        size: edit.fontSize,
                        font: thaiFont,
                        color: rgb(0, 0, 0),
                    });
                });
            }

            // 3. ฝังรูปลายเซ็นและตราประทับ
            if (patches.images) {
                for (const imgData of patches.images) {
                    try {
                        const imgBytes = await fetch(imgData.base64).then(r => r.arrayBuffer());
                        const embeddedImg = await loadedPdf.embedPng(imgBytes);
                        targetPage.drawImage(embeddedImg, {
                            x: imgData.x,
                            y: imgData.y,
                            width: imgData.width,
                            height: imgData.height,
                        });
                    } catch (err) {
                        console.warn("ไม่สามารถฝังภาพลง PDF:", err);
                    }
                }
            }
        }

        // ฝังเส้นวาด Canvas
        const wrappers = document.querySelectorAll('.page-wrapper');
        for (let idx = 0; idx < wrappers.length; idx++) {
            const wrapper = wrappers[idx];
            const drawCanvas = wrapper.querySelector('.drawing-page-canvas');
            if (drawCanvas && drawCanvas.undoStack && drawCanvas.undoStack.length > 1) {
                try {
                    const drawDataUrl = drawCanvas.toDataURL('image/png');
                    const imgBytes = await fetch(drawDataUrl).then(r => r.arrayBuffer());
                    const embeddedDraw = await loadedPdf.embedPng(imgBytes);
                    const targetPage = pages[idx];
                    targetPage.drawImage(embeddedDraw, {
                        x: 0,
                        y: 0,
                        width: targetPage.getWidth(),
                        height: targetPage.getHeight(),
                    });
                } catch (e) {
                    console.warn("ข้ามการฝัง Canvas หน้า:", idx + 1);
                }
            }
        }

        const pdfResultBytes = await loadedPdf.save();
        const blob = new Blob([pdfResultBytes], { type: 'application/pdf' });
        const downloadUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${originalFileName}_Edited.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);

        showNotification("ส่งออกไฟล์ PDF เวกเตอร์แท้คมกริบสำเร็จแล้วค่ะ!");
    } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการประมวลผล PDF: " + err.message);
    }
}

// -------------------------------------------------------------
// Canvas Drawing Engine
// -------------------------------------------------------------
function bindDrawingEngine(canvas) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false; 
    let lastX = 0, lastY = 0;

    if (!canvas.undoStack) { canvas.undoStack = [canvas.toDataURL()]; canvas.redoStack = []; }

    function getCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { 
            x: ((clientX - rect.left) / rect.width) * canvas.width, 
            y: ((clientY - rect.top) / rect.height) * canvas.height 
        };
    }
    function startAction(e) {
        if (currentTool !== 'pen' && currentTool !== 'eraser') return;
        if (e.touches && e.touches.length > 1) return;
        const coords = getCoords(e); 
        isDrawing = true; 
        lastX = coords.x; 
        lastY = coords.y;
    }
    function moveAction(e) {
        if (!isDrawing || (currentTool !== 'pen' && currentTool !== 'eraser')) return;
        if (e.touches && e.touches.length > 1) return;
        const coords = getCoords(e);
        ctx.beginPath(); 
        ctx.moveTo(lastX, lastY); 
        ctx.lineTo(coords.x, coords.y);

        if (currentTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.strokeStyle = currentActiveColor;
            ctx.lineWidth = currentBrushSize * 2; 
            ctx.lineCap = 'round'; 
            ctx.lineJoin = 'round'; 
            ctx.stroke();
        } else if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out'; 
            ctx.lineWidth = currentBrushSize * 12;
            ctx.lineCap = (eraserShape === 'square') ? 'square' : 'round'; 
            ctx.lineJoin = (eraserShape === 'square') ? 'miter' : 'round'; 
            ctx.stroke();
        }
        lastX = coords.x; 
        lastY = coords.y;
    }
    const stopAction = () => {
        if (isDrawing) {
            isDrawing = false; 
            const currentState = canvas.toDataURL();
            if (canvas.undoStack[canvas.undoStack.length - 1] !== currentState) { 
                canvas.undoStack.push(currentState); 
                canvas.redoStack = []; 
            }
        }
    };
    canvas.addEventListener('mousedown', startAction); 
    canvas.addEventListener('mousemove', moveAction);
    canvas.addEventListener('mouseup', stopAction); 
    canvas.addEventListener('mouseleave', stopAction);
    canvas.addEventListener('touchstart', (ev) => { 
        if (ev.touches.length === 1 && (currentTool === 'pen' || currentTool === 'eraser')) startAction(ev); 
    }, {passive: true});
    canvas.addEventListener('touchmove', (ev) => { 
        if (ev.touches.length === 1 && (currentTool === 'pen' || currentTool === 'eraser')) { 
            ev.preventDefault(); 
            moveAction(ev); 
        } 
    }, {passive: false});
    canvas.addEventListener('touchend', stopAction);
}

function undoAction() {
    const activePage = getActivePageWrapper(); if (!activePage) return;
    const canvas = activePage.querySelector('.drawing-page-canvas');
    if (canvas && canvas.undoStack && canvas.undoStack.length > 1) {
        const current = canvas.undoStack.pop(); canvas.redoStack.push(current);
        const prevState = canvas.undoStack[canvas.undoStack.length - 1];
        const ctx = canvas.getContext('2d'); const img = new Image();
        img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
        img.src = prevState;
    }
}
function redoAction() {
    const activePage = getActivePageWrapper(); if (!activePage) return;
    const canvas = activePage.querySelector('.drawing-page-canvas');
    if (canvas && canvas.redoStack && canvas.redoStack.length > 0) {
        const nextState = canvas.redoStack.pop(); canvas.undoStack.push(nextState);
        const ctx = canvas.getContext('2d'); const img = new Image();
        img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
        img.src = nextState;
    }
}
function clearCurrentDrawings() {
    const activePage = getActivePageWrapper(); if (!activePage) return;
    const canvas = activePage.querySelector('.drawing-page-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
        const currentState = canvas.toDataURL(); canvas.undoStack.push(currentState); canvas.redoStack = [];
        showNotification("ล้างหน้าประวัติวาดเขียนแล้วค่ะ");
    }
}

// -------------------------------------------------------------
// สลับเครื่องมือและการจัดมุมมอง
// -------------------------------------------------------------
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.body.className = document.body.className.replace(/tool-\S+/g, '').trim();
    document.body.classList.add(`tool-${tool}`);

    const penPanel = document.getElementById('pen-settings-panel');
    const toggleShapeBtn = document.getElementById('btn-toggle-shape');

    if (penPanel) penPanel.style.display = (tool === 'pen' || tool === 'eraser') ? 'flex' : 'none';
    if (toggleShapeBtn) toggleShapeBtn.style.display = (tool === 'eraser') ? 'inline-block' : 'none';

    if (workspace) {
        if (tool === 'pan') { workspace.style.cursor = 'grab'; }
        else if (tool === 'edit-text') { workspace.style.cursor = 'text'; }
        else if (tool === 'whiteout') { workspace.style.cursor = 'crosshair'; }
        else { workspace.style.cursor = 'crosshair'; }
    }
}

function getActivePageWrapper() {
    const wrappers = document.querySelectorAll('.page-wrapper'); 
    if (wrappers.length === 0) return null;
    const workspaceRect = workspace.getBoundingClientRect();
    const workspaceCenter = workspaceRect.top + workspaceRect.height / 2;
    let closestWrapper = wrappers[0], minDistance = Infinity;
    wrappers.forEach(wrapper => {
        const rect = wrapper.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - workspaceCenter);
        if (dist < minDistance) { minDistance = dist; closestWrapper = wrapper; }
    });
    return closestWrapper;
}

function applyZoom() { if (container) container.style.transform = `scale(${currentScale})`; }
function zoomIn() { currentScale += 0.15; if (currentScale > 3.5) currentScale = 3.5; applyZoom(); }
function zoomOut() { currentScale -= 0.15; if (currentScale < 0.5) currentScale = 0.5; applyZoom(); }

function scrollWorkspace(direction) {
    if (!workspace) return;
    const pageHeight = workspace.clientHeight - 80;
    if (direction === 'next') workspace.scrollTop += pageHeight;
    else workspace.scrollTop -= pageHeight;
}

function updateBrushPreview() {
    const preview = document.getElementById('brush-preview');
    if (preview) { 
        preview.style.width = currentBrushSize + 'px'; 
        preview.style.height = currentBrushSize + 'px'; 
        preview.style.backgroundColor = currentActiveColor; 
    }
}

function toggleEraserShape() {
    eraserShape = (eraserShape === 'circle') ? 'square' : 'circle';
    showNotification("เปลี่ยนรูปทรงยางลบเป็น: " + (eraserShape === 'circle' ? 'วงกลม ⭕' : 'สี่เหลี่ยม 🔲'));
}

// -------------------------------------------------------------
// IndexedDB
// -------------------------------------------------------------
const DB_NAME = "NaweeStudio_Database_V2";
const STORE_NAME = "DocumentStore";

function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "docName" });
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveToDatabase() {
    if (!pdfDoc) { alert("ไม่พบข้อมูลเอกสารสำหรับการบันทึกค่ะ!"); return; }
    try {
        const db = await initDatabase();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        
        const documentState = {
            docName: originalFileName,
            patches: pdfPatches,
            savedAt: new Date().toISOString()
        };
        
        store.put(documentState);
        alert("บันทึกประวัติการแก้ไขลงเครื่องเรียบร้อยแล้วค่ะ!");
    } catch (error) {
        alert("เกิดข้อผิดพลาดในการบันทึกฐานข้อมูลค่ะ");
    }
}

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
}
