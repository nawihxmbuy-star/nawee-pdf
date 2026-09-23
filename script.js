const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];

if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
    console.error("ไม่สามารถเชื่อมต่อไลบรารี PDF.js ได้ กรุณาตรวจสอบลิงก์ Script ในหน้า HTML นะคะ");
}

// -------------------------------------------------------------
// ตัวแปรสถานะระบบและเครื่องมือ
// -------------------------------------------------------------
let currentScale = 1.0;
let currentTool = 'pan'; // pan, pen, eraser, text, edit-text, whiteout
let currentActiveColor = "#22d3ee"; 
let currentBrushSize = 6;

let currentTextActiveColor = "#f59e0b";
let currentTextSize = 24;

let pdfDoc = null;
let originalPdfBytes = null; // ไบนารีต้นฉบับสำหรับส่งออกผ่าน pdf-lib
let currentFileMode = "pdf"; 
let initialDistance = 0;
let startScale = 1.0;
let originalFileName = "Nawee_Document";

let container = null;
let workspace = null;
let appTitle = null;
let activeDraggableNode = null; 
let eraserShape = 'circle';

// คลังเก็บประวัติการแก้ไขแบบ Vector รายหน้า { [pageNum]: { textEdits: [], whiteouts: [], images: [] } }
let pdfPatches = {};

// ลิงก์ดาวน์โหลดฟอนต์ Sarabun สำหรับฝังใน PDF (Vector Thai Font)
const THAI_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts/ofl/sarabun/Sarabun-Regular.ttf';
let cachedFontBytes = null;

// ตัวแปรสำหรับโมดอลแก้ไขข้อความ
let currentTargetEdit = null;

// ตัวแปรสำหรับลายเซ็นและรูปภาพ
let sigPadCanvas = null;
let sigPadCtx = null;
let isDrawingSig = false;
let sigCurrentColor = "#000000";
let uploadedSigBase64 = null;

// ตัวแปรไฟล์แนบแชท AI
let currentAttachedImage = null;
let currentAttachedVideo = null;
let currentAttachedDoc = null;
let currentAttachedDocName = "";

// -------------------------------------------------------------
// ฟังก์ชัน Utility ทั่วไป
// -------------------------------------------------------------
function rgbToHex(rgb) {
    if (!rgb || !rgb.startsWith('rgb')) return rgb;
    const rgbValues = rgb.match(/\d+/g);
    if (!rgbValues || rgbValues.length < 3) return null;
    return "#" + rgbValues.slice(0,3).map(x => {
        const hex = parseInt(x).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join("");
}

function showNotification(msg) {
    const div = document.createElement('div');
    div.className = 'custom-notification';
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transform = 'translateX(50px)';
        div.style.transition = 'all 0.3s ease';
        setTimeout(() => div.remove(), 500);
    }, 2500);
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
// ระบบพรีวิวยางลบ
// -------------------------------------------------------------
const eraserCursor = document.createElement('div');
eraserCursor.id = 'eraser-cursor-preview';
document.body.appendChild(eraserCursor);

function updateEraserCursorPosition(e) {
    if (currentTool !== 'eraser') {
        eraserCursor.style.display = 'none';
        return;
    }
    eraserCursor.style.display = 'block';
    const size = currentBrushSize * 8;
    eraserCursor.style.width = size + 'px';
    eraserCursor.style.height = size + 'px';
    eraserCursor.style.borderRadius = (eraserShape === 'square') ? '0px' : '50%';
    eraserCursor.style.left = (e.clientX - size / 2) + 'px';
    eraserCursor.style.top = (e.clientY - size / 2) + 'px';
}
document.addEventListener('mousemove', updateEraserCursorPosition);

function toggleEraserShape() {
    eraserShape = (eraserShape === 'circle') ? 'square' : 'circle';
    showNotification("เปลี่ยนรูปทรงยางลบเป็น: " + (eraserShape === 'circle' ? 'วงกลม ⭕' : 'สี่เหลี่ยม 🔲'));
}

// -------------------------------------------------------------
// รีเซ็ตแอปและเริ่มงานใหม่
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
                    <p>ยินดีต้อนรับสู่ระบบ กรุณากดปุ่ม <b>"เปิดไฟล์"</b> ด้านบนเพื่อเริ่มต้นทำงานค่ะ</p>
                </div>
            `;
            container.style.transform = 'scale(1)';
        }
        clearActiveDraggableNode();
        closeTextSheet();
        const uploadInput = document.getElementById('upload');
        if (uploadInput) uploadInput.value = '';
        showNotification("เริ่มงานใหม่เรียบร้อยแล้วค่ะ");
    }
}

// -------------------------------------------------------------
// ฟังก์ชันจัดการข้อความลอย (Floating Text)
// -------------------------------------------------------------
function selectTextNode(node) {
    clearActiveDraggableNode();
    activeDraggableNode = node;
    node.style.borderColor = node.style.color || currentTextActiveColor;
    node.classList.add('is-active-focused');

    const textSizeSlider = document.getElementById('text-size-slider');
    const textSizeLabel = document.getElementById('text-size-val');
    if (textSizeSlider && textSizeLabel) {
        const size = parseInt(node.style.fontSize) || 24;
        textSizeSlider.value = size;
        textSizeLabel.innerText = size + 'px';
        currentTextSize = size;
    }
    
    const hexColor = rgbToHex(node.style.color) || currentTextActiveColor;
    const textColorPicker = document.getElementById('text-color-picker');
    if (textColorPicker) textColorPicker.value = hexColor;
    
    const floatingTextColor = document.getElementById('floating-text-color');
    if (floatingTextColor) floatingTextColor.value = hexColor;
    
    currentTextActiveColor = hexColor;
    
    document.querySelectorAll('.text-palette-dot').forEach(dot => {
        const dotColor = dot.getAttribute('data-color');
        if(dotColor && dotColor.toLowerCase() === hexColor.toLowerCase()) dot.classList.add('active');
        else dot.classList.remove('active');
    });

    openCenterTextInput();
}

function openCenterTextInput() {
    const bottomSheet = document.getElementById('text-node-bottom-bar');
    if (bottomSheet) {
        bottomSheet.classList.add('active');
        const currentPicker = document.getElementById('floating-text-color');
        if (currentPicker && activeDraggableNode) {
            currentPicker.value = rgbToHex(activeDraggableNode.style.color) || currentTextActiveColor;
        }
    }
}

function closeTextSheet() {
    const bottomSheet = document.getElementById('text-node-bottom-bar');
    if (bottomSheet) bottomSheet.classList.remove('active');
}

function changeActiveNodeSize(amount) {
    if (activeDraggableNode) {
        let currentSize = parseInt(activeDraggableNode.style.fontSize) || 24;
        let newSize = currentSize + amount;
        if (newSize >= 12 && newSize <= 100) {
            activeDraggableNode.style.fontSize = newSize + 'px';
            const textSizeSlider = document.getElementById('text-size-slider');
            const textSizeLabel = document.getElementById('text-size-val');
            if (textSizeSlider && textSizeLabel) {
                textSizeSlider.value = newSize;
                textSizeLabel.innerText = newSize + 'px';
            }
        }
    }
}

function deleteActiveTextNode() {
    if (activeDraggableNode) {
        activeDraggableNode.remove();
        activeDraggableNode = null;
        closeTextSheet();
    }
}

function clearActiveDraggableNode() {
    if (activeDraggableNode) {
        activeDraggableNode.style.borderColor = 'transparent';
        activeDraggableNode.classList.remove('is-active-focused');
        activeDraggableNode = null;
    }
}

function formatFloatingText(command) {
    if (!activeDraggableNode) return;
    const span = activeDraggableNode.querySelector('span');
    if (!span) return;
    if (command === 'bold') {
        span.style.fontWeight = (span.style.fontWeight === 'bold' || span.style.fontWeight === '700') ? 'normal' : 'bold';
    } else if (command === 'italic') {
        span.style.fontStyle = (span.style.fontStyle === 'italic') ? 'normal' : 'italic';
    } else if (command === 'underline') {
        span.style.textDecoration = (span.style.textDecoration === 'underline') ? 'none' : 'underline';
    }
}

// -------------------------------------------------------------
// การตั้งค่าเริ่มต้นระบบ (DOM Ready)
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

    const textColorPicker = document.getElementById('text-color-picker');
    if (textColorPicker) {
        textColorPicker.addEventListener('input', (e) => {
            currentTextActiveColor = e.target.value;
            document.querySelectorAll('.text-palette-dot').forEach(d => d.classList.remove('active'));
            if (activeDraggableNode) {
                activeDraggableNode.style.color = currentTextActiveColor;
                activeDraggableNode.style.borderColor = currentTextActiveColor;
            }
        });
    }

    const floatingTextColor = document.getElementById('floating-text-color');
    if (floatingTextColor) {
        floatingTextColor.addEventListener('input', (e) => {
            currentTextActiveColor = e.target.value;
            if (activeDraggableNode) {
                activeDraggableNode.style.color = currentTextActiveColor;
                activeDraggableNode.style.borderColor = currentTextActiveColor;
            }
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

    document.querySelectorAll('.text-palette-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            const picked = e.target.getAttribute('data-color');
            if (picked) {
                currentTextActiveColor = picked;
                if (textColorPicker) textColorPicker.value = picked;
                if (floatingTextColor) floatingTextColor.value = picked;
                if (activeDraggableNode) {
                    activeDraggableNode.style.color = picked;
                    activeDraggableNode.style.borderColor = picked;
                }
                document.querySelectorAll('.text-palette-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
            }
        });
    });

    // ป้องกันการคลิกหลุด
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-wrapper')) closeAllPopups();
        if (!e.target.closest('.media-menu-container')) {
            const popup = document.getElementById('media-popup');
            if (popup) popup.style.display = 'none';
        }
        if (!e.target.closest('.custom-draggable-text-node') && 
            !e.target.closest('#text-settings-panel') && 
            !e.target.closest('.toolbar') && 
            !e.target.closest('.text-node-floating-bar') && 
            !e.target.closest('.word-formatting-bar') && 
            !e.target.closest('#text-node-bottom-bar')) {
            clearActiveDraggableNode();
        }
    });

    // ระบบซูมสัมผัสสองนิ้ว (Pinch to zoom)
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
                    if (nextScale > 0.4 && nextScale < 4.0) {
                        currentScale = nextScale;
                        applyZoom();
                    }
                }
            }
        }, { passive: false });

        workspace.addEventListener('click', (e) => {
            if (currentTool === 'text' && 
                !e.target.closest('.custom-draggable-text-node') && 
                !e.target.closest('.toolbar') && 
                !e.target.closest('.text-node-floating-bar') && 
                !e.target.closest('#text-node-bottom-bar')) {
                createDraggableTextNode(e);
            }
        });
    }

    initSignaturePad();
    updateBrushPreview();
    setTool('pan');
});

// -------------------------------------------------------------
// การโหลดและเรนเดอร์เอกสาร PDF (Lazy/Page-by-page Engine)
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
        showNotification(`โหลดเอกสารเสร็จเรียบร้อย (${pdfDoc.numPages} หน้า)`);
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

    // Canvas สำหรับแสดงผลหน้า PDF ต้นฉบับ
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-page-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pageWrapper.appendChild(pdfCanvas);

    // Canvas สำหรับชั้นวาดเขียน / ไฮไลต์ / ยางลบ
    const drawingCanvas = document.createElement('canvas');
    drawingCanvas.className = 'drawing-page-canvas';
    drawingCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    pageWrapper.appendChild(drawingCanvas);

    // Layer สำหรับกล่องข้อความ และเครื่องมือแก้ไข Vector
    const textOverlayLayer = document.createElement('div');
    textOverlayLayer.className = 'text-overlay-layer';
    pageWrapper.appendChild(textOverlayLayer);
    container.appendChild(pageWrapper);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

    // สกัดคำเพื่อทำโหมด "แตะแก้คำเดิมแบบแนบเนียน"
    const textContent = await page.getTextContent();
    const displayViewport = page.getViewport({ scale: 1.0 });

    textContent.items.forEach(item => {
        if (!item.str || item.str.trim() === "") return;
        const [left, top] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontSize = Math.hypot(item.transform[0], item.transform[1]);

        const textSpan = document.createElement('div');
        textSpan.className = 'word-text-node editable-target';
        textSpan.style.left = left + 'px';
        textSpan.style.top = (top - fontSize) + 'px';
        textSpan.style.fontSize = fontSize + 'px';
        textSpan.style.height = fontSize + 'px';
        textSpan.innerText = item.str;

        // ฝังพิกัดจริงของ PDF ไว้อ้างอิง
        textSpan.dataset.pdfX = item.transform[4];
        textSpan.dataset.pdfY = item.transform[5];
        textSpan.dataset.fontSize = fontSize;
        textSpan.dataset.itemWidth = item.width;
        textSpan.dataset.pageNumber = pageNumber;

        textSpan.addEventListener('click', (ev) => {
            if (currentTool === 'edit-text') {
                ev.stopPropagation();
                openTextEditModal(textSpan);
            }
        });

        textOverlayLayer.appendChild(textSpan);
    });

    bindDrawingEngine(drawingCanvas);
    bindWhiteoutEngine(pageWrapper, pageNumber);
}

// -------------------------------------------------------------
// ระบบแตะแก้ไขข้อความเดิมแบบแนบเนียน (Modal & Vector Store)
// -------------------------------------------------------------
function openTextEditModal(domNode) {
    currentTargetEdit = domNode;
    const modal = document.getElementById('text-edit-modal');
    const oldTextDiv = document.getElementById('modal-old-text');
    const newTextInput = document.getElementById('modal-new-text');
    const fontSizeInput = document.getElementById('modal-font-size');
    const textColorInput = document.getElementById('modal-text-color');

    if (!modal) return;
    oldTextDiv.innerText = domNode.innerText;
    newTextInput.value = domNode.innerText;
    fontSizeInput.value = Math.round(parseFloat(domNode.dataset.fontSize)) || 14;
    textColorInput.value = "#000000";

    modal.style.display = 'flex';
    setTimeout(() => newTextInput.focus(), 100);
}

function closeTextEditModal() {
    const modal = document.getElementById('text-edit-modal');
    if (modal) modal.style.display = 'none';
    currentTargetEdit = null;
}

function confirmTextPatch() {
    if (!currentTargetEdit) return;
    const newTextInput = document.getElementById('modal-new-text');
    const fontSizeInput = document.getElementById('modal-font-size');
    const textColorInput = document.getElementById('modal-text-color');

    const newText = newTextInput.value;
    const fontSize = parseFloat(fontSizeInput.value) || 14;
    const textColor = textColorInput.value || "#000000";
    const pageNum = parseInt(currentTargetEdit.dataset.pageNumber);

    // อัปเดตการแสดงผลบนหน้าจอทันที
    currentTargetEdit.innerText = newText;
    currentTargetEdit.style.fontSize = fontSize + 'px';
    currentTargetEdit.style.color = textColor;
    currentTargetEdit.style.background = "#ffffff";

    if (!pdfPatches[pageNum]) pdfPatches[pageNum] = { textEdits: [], whiteouts: [], images: [] };

    pdfPatches[pageNum].textEdits.push({
        x: parseFloat(currentTargetEdit.dataset.pdfX),
        y: parseFloat(currentTargetEdit.dataset.pdfY),
        fontSize: fontSize,
        oldText: currentTargetEdit.dataset.text,
        newText: newText,
        width: parseFloat(currentTargetEdit.dataset.itemWidth) || 50,
        color: textColor
    });

    closeTextEditModal();
    showNotification("บันทึกการแก้ไขข้อความแนบเนียนแล้วค่ะ");
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

        // แปลงพิกัดหน้าจอเป็นพิกัด PDF (แกน Y ของ PDF เริ่มจากล่างขึ้นบน)
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

        // ดับเบิ้ลคลิกเพื่อลบบล็อกนี้ทิ้ง
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

    // ระบบลากย้ายตำแหน่งลายเซ็น
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
        
        // บันทึกตำแหน่งและรูปภาพลง State Store
        const pageNum = parseInt(activePage.dataset.pageNumber);
        const wrapperHeight = parseFloat(activePage.style.height);
        const w = parseFloat(sigNode.style.width);
        const h = parseFloat(sigNode.style.height);
        const left = parseFloat(sigNode.style.left);
        const top = parseFloat(sigNode.style.top);

        if (!pdfPatches[pageNum]) pdfPatches[pageNum] = { textEdits: [], whiteouts: [], images: [] };
        pdfPatches[pageNum].images.push({
            x: left,
            y: wrapperHeight - (top + h),
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
    showNotification("วางลายเซ็นลงบนหน้าเอกสารเรียบร้อยแล้วค่ะ สามารถลากปรับตำแหน่งได้เลย");
}

// -------------------------------------------------------------
// ระบบส่งออก Vector PDF แท้ ด้วย pdf-lib (ไม่บวม คมชัด 100%)
// -------------------------------------------------------------
async function exportToPDFFile() {
    closeAllPopups();
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

        // นำการแก้ไขและรอยวาดทั้งหมดมาประมวลผลทีละหน้า
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

            // 2. ลบคำเดิมและพิมพ์คำใหม่ด้วยฟอนต์ไทยแท้ (Text Edits)
            if (patches.textEdits) {
                patches.textEdits.forEach(edit => {
                    // วาดกล่องสีขาวลบคำเดิม
                    targetPage.drawRectangle({
                        x: edit.x,
                        y: edit.y - (edit.fontSize * 0.2),
                        width: edit.width + 4,
                        height: edit.fontSize * 1.25,
                        color: rgb(1, 1, 1),
                    });

                    // พิมพ์คำใหม่ลงไปแทนที่
                    targetPage.drawText(edit.newText, {
                        x: edit.x,
                        y: edit.y,
                        size: edit.fontSize,
                        font: thaiFont,
                        color: rgb(0, 0, 0),
                    });
                });
            }

            // 3. ฝังรูปลายเซ็นและตราประทับ (Signatures/Images)
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

        // แปลงภาพวาดจาก Canvas แต่ละหน้ามาฝังลง Vector PDF ด้วย
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

        // เซฟและดาวน์โหลดไฟล์
        const pdfResultBytes = await loadedPdf.save();
        const blob = new Blob([pdfResultBytes], { type: 'application/pdf' });
        const downloadUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${originalFileName}_ProEdited.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);

        showNotification("ส่งออกไฟล์ PDF คมชัดระดับเวกเตอร์สำเร็จแล้วค่ะ!");
    } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการประมวลผล PDF: " + err.message);
    }
}

// -------------------------------------------------------------
// ระบบ Canvas วาดเขียน (Drawing Engine)
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
// การสลับเครื่องมือและการจัดมุมมอง (Tool Manager)
// -------------------------------------------------------------
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) activeBtn.classList.add('active');

    // สลับคลาส body เพื่อช่วยในการควบคุม pointer-events ของ CSS
    document.body.className = document.body.className.replace(/tool-\S+/g, '').trim();
    document.body.classList.add(`tool-${tool}`);

    const penPanel = document.getElementById('pen-settings-panel');
    const textPanel = document.getElementById('text-settings-panel');
    const toggleShapeBtn = document.getElementById('btn-toggle-shape');

    if (penPanel) penPanel.style.display = (tool === 'pen' || tool === 'eraser') ? 'flex' : 'none';
    if (toggleShapeBtn) toggleShapeBtn.style.display = (tool === 'eraser') ? 'inline-block' : 'none';
    if (textPanel) textPanel.style.display = (tool === 'text') ? 'flex' : 'none';

    if (workspace) {
        if (tool === 'pan') { workspace.style.cursor = 'grab'; workspace.style.overflow = 'auto'; }
        else if (tool === 'text') { workspace.style.cursor = 'text'; workspace.style.overflow = 'auto'; }
        else if (tool === 'edit-text') { workspace.style.cursor = 'pointer'; workspace.style.overflow = 'auto'; }
        else if (tool === 'whiteout') { workspace.style.cursor = 'crosshair'; workspace.style.overflow = 'hidden'; }
        else { workspace.style.cursor = 'crosshair'; workspace.style.overflow = 'hidden'; }
    }
    clearActiveDraggableNode();
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
function zoomIn() { currentScale += 0.15; if (currentScale > 4.0) currentScale = 4.0; applyZoom(); }
function zoomOut() { currentScale -= 0.15; if (currentScale < 0.4) currentScale = 0.4; applyZoom(); }

function scrollWorkspace(direction) {
    if (!workspace) return;
    const pageHeight = workspace.clientHeight - 100;
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

function toggleDropdown(menuId) {
    const targetMenu = document.getElementById(menuId);
    if (!targetMenu) return;
    const isOpen = targetMenu.classList.contains('show');
    closeAllPopups();
    if (!isOpen) targetMenu.classList.add('show');
}
function closeAllPopups() { document.querySelectorAll('.dropdown-popup').forEach(m => m.classList.remove('show')); }

function switchFileMode(mode) {
    currentFileMode = mode;
    currentScale = 1.0; 
    if (mode === 'word') {
        document.body.className = "mode-word";
        if (appTitle) appTitle.innerHTML = 'PDF Pro <small class="badge" style="background:#2b579a;">WORD MODE</small>';
        document.querySelectorAll('.word-text-node').forEach(node => node.setAttribute('contenteditable', 'true'));
    } else {
        document.body.className = "mode-pdf";
        if (appTitle) appTitle.innerHTML = 'PDF Pro <small class="badge">PDF MODE</small>';
        document.querySelectorAll('.word-text-node').forEach(node => node.setAttribute('contenteditable', 'false'));
    }
    setTool(currentTool);
    applyZoom();
}
function triggerPdfToWord() { closeAllPopups(); if (!pdfDoc) { alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!"); return; } switchFileMode('word'); }
function triggerWordToPdf() { closeAllPopups(); switchFileMode('pdf'); alert("สลับกลับสู่โหมด PDF สำเร็จค่ะ"); }

// -------------------------------------------------------------
// ฟังก์ชันสร้างข้อความลอยอิสระ (Create Draggable Text)
// -------------------------------------------------------------
function createDraggableTextNode(e) {
    if (currentTool !== 'text') return;
    const activePage = getActivePageWrapper(); if (!activePage) return;
    const overlay = activePage.querySelector('.text-overlay-layer'); if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left) / currentScale; const y = (clientY - rect.top) / currentScale;

    const node = document.createElement('div');
    node.className = 'custom-draggable-text-node';
    node.style.left = x + 'px'; node.style.top = y + 'px';
    node.style.color = currentTextActiveColor; node.style.fontSize = currentTextSize + 'px';
    node.style.border = `1px dashed ${currentTextActiveColor}`;

    const span = document.createElement('span');
    span.setAttribute('contenteditable', 'true');
    span.style.outline = 'none'; span.style.minWidth = '50px'; span.style.display = 'inline-block';
    span.innerText = 'พิมพ์ข้อความ...';
    node.appendChild(span);

    span.addEventListener('click', (ev) => {
        ev.stopPropagation();
        node.classList.add('is-editing');
        span.focus();
    });

    span.addEventListener('blur', () => {
        node.classList.remove('is-editing');
        if (span.innerText.trim() === '' || span.innerText === 'พิมพ์ข้อความ...') { 
            node.remove(); 
            closeTextSheet(); 
        }
    });

    let isDraggingNode = false; 
    let startX = 0, startY = 0, startLeft = 0, startTop = 0; 
    
    function dragStart(ev) {
        if (node.classList.contains('is-editing')) return; 
        isDraggingNode = true;
        const pageX = ev.touches ? ev.touches[0].pageX : ev.pageX;
        const pageY = ev.touches ? ev.touches[0].pageY : ev.pageY;
        startX = pageX; startY = pageY;
        startLeft = parseFloat(node.style.left) || 0;
        startTop = parseFloat(node.style.top) || 0;
        selectTextNode(node);
    }

    function dragMove(ev) {
        if (!isDraggingNode) return;
        if (ev.cancelable) ev.preventDefault(); 
        const pageX = ev.touches ? ev.touches[0].pageX : ev.pageX;
        const pageY = ev.touches ? ev.touches[0].pageY : ev.pageY;
        const deltaX = (pageX - startX) / currentScale;
        const deltaY = (pageY - startY) / currentScale;
        node.style.left = (startLeft + deltaX) + 'px'; 
        node.style.top = (startTop + deltaY) + 'px';
    }

    function dragEnd() { isDraggingNode = false; }

    node.addEventListener('mousedown', dragStart); 
    document.addEventListener('mousemove', dragMove); 
    document.addEventListener('mouseup', dragEnd);
    
    node.addEventListener('touchstart', dragStart, {passive: true}); 
    document.addEventListener('touchmove', dragMove, {passive: false}); 
    document.addEventListener('touchend', dragEnd);

    overlay.appendChild(node);
    selectTextNode(node);
    node.classList.add('is-editing');
    setTimeout(() => { span.focus(); document.execCommand('selectAll', false, null); }, 60);
}

// -------------------------------------------------------------
// IndexedDB & แชร์เอกสาร
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
            fileMode: currentFileMode,
            patches: pdfPatches,
            savedAt: new Date().toISOString()
        };
        
        store.put(documentState);
        alert("บันทึกประวัติการแก้ไขลงฐานข้อมูลภายในเครื่องสำเร็จ!");
    } catch (error) {
        alert("เกิดข้อผิดพลาดในการบันทึกฐานข้อมูลค่ะ");
    }
}

async function shareToLine() {
    closeAllPopups();
    if (!originalPdfBytes) { alert("ไม่พบเอกสารในการแชร์ค่ะ!"); return; }
    try {
        showNotification("กำลังเตรียมไฟล์สำหรับแชร์...");
        exportToPDFFile();
    } catch (e) {
        alert("ระบบดาวน์โหลดไฟล์เข้าสู่อุปกรณ์แทนนะคะ");
    }
}

// -------------------------------------------------------------
// ผู้ช่วยอัจฉริยะ AI Studio (Gemini 2.5 Flash & Pollinations)
// -------------------------------------------------------------
function toggleAiSidebar() {
    const sidebar = document.getElementById('ai-sidebar');
    if (sidebar) sidebar.classList.toggle('open');
}

function toggleMediaPopup() {
    const popup = document.getElementById('media-popup');
    if (popup) popup.style.display = popup.style.display === 'none' ? 'flex' : 'none';
}

function triggerMediaInput(type) {
    const popup = document.getElementById('media-popup');
    if (popup) popup.style.display = 'none';
    if (type === 'image') document.getElementById('ai-image-input').click();
    if (type === 'video') document.getElementById('ai-video-input').click();
}

function handleFileSelect(type) {
    const previewContainer = document.getElementById('file-preview-container');
    if (!previewContainer) return;

    if (type === 'image') {
        const input = document.getElementById('ai-image-input');
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentAttachedImage = e.target.result;
                currentAttachedVideo = null;
                currentAttachedDoc = null;
                renderFilePreview('image', currentAttachedImage);
            };
            reader.readAsDataURL(input.files[0]);
        }
    } else if (type === 'video') {
        const input = document.getElementById('ai-video-input');
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentAttachedVideo = e.target.result;
                currentAttachedImage = null;
                currentAttachedDoc = null;
                renderFilePreview('video', input.files[0].name);
            };
            reader.readAsDataURL(input.files[0]);
        }
    } else if (type === 'document') {
        const input = document.getElementById('ai-document-input');
        if (input.files && input.files[0]) {
            currentAttachedDocName = input.files[0].name;
            const reader = new FileReader();
            reader.onload = (e) => {
                currentAttachedDoc = e.target.result;
                currentAttachedImage = null;
                currentAttachedVideo = null;
                renderFilePreview('document', currentAttachedDocName);
            };
            reader.readAsText(input.files[0]);
        }
    }
}

function renderFilePreview(type, dataOrName) {
    const previewContainer = document.getElementById('file-preview-container');
    previewContainer.style.display = 'flex';
    if (type === 'image') {
        previewContainer.innerHTML = `
            <div class="ai-preview-item">
                <img src="${dataOrName}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);">
                <div class="remove-preview-btn" onclick="clearAttachedFile()">×</div>
            </div>
        `;
    } else if (type === 'video') {
        previewContainer.innerHTML = `
            <div class="ai-preview-item" style="color: #fff; font-size: 11px; background: rgba(255,255,255,0.08); padding: 6px 10px; border-radius: 6px; display: flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.1);">
                <i class="fa-solid fa-video" style="color: #c084fc;"></i> <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${dataOrName}</span>
                <div class="remove-preview-btn" onclick="clearAttachedFile()">×</div>
            </div>
        `;
    } else if (type === 'document') {
        previewContainer.innerHTML = `
            <div class="ai-preview-item" style="color: #fff; font-size: 11px; background: rgba(255,255,255,0.08); padding: 6px 10px; border-radius: 6px; display: flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.1);">
                <i class="fa-solid fa-file-lines" style="color: #94a3b8;"></i> <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${dataOrName}</span>
                <div class="remove-preview-btn" onclick="clearAttachedFile()">×</div>
            </div>
        `;
    }
}

function clearAttachedFile() {
    currentAttachedImage = null;
    currentAttachedVideo = null;
    currentAttachedDoc = null;
    currentAttachedDocName = "";
    document.getElementById('ai-image-input').value = "";
    document.getElementById('ai-video-input').value = "";
    document.getElementById('ai-document-input').value = "";
    const previewContainer = document.getElementById('file-preview-container');
    if (previewContainer) {
        previewContainer.style.display = 'none';
        previewContainer.innerHTML = '';
    }
}

async function callGeminiAPI(promptText, base64Image = null) {
    const keyInput = document.getElementById('ai-api-key');
    const API_KEY = keyInput ? keyInput.value.trim() : "";
    if(!API_KEY) return "❌ โปรดใส่ Gemini API Key ของคุณนาวีในแถบด้านบนก่อนเริ่มส่งคำสั่งนะคะ";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    try {
        const parts = [{ text: promptText }];
        if (base64Image && base64Image.includes(',')) {
            const mimeType = base64Image.substring(base64Image.indexOf(":") + 1, base64Image.indexOf(";"));
            const base64Data = base64Image.substring(base64Image.indexOf(",") + 1);
            parts.push({
                inlineData: { mimeType: mimeType, data: base64Data }
            });
        }

        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: parts }] })
        });
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        return "❌ คีย์เชื่อมต่อไม่ถูกต้อง หรือเน็ตเวิร์กขัดข้องชั่วคราวค่ะ";
    }
}

async function sendAiQuestion() {
    const input = document.getElementById('ai-input'); if (!input) return;
    const userText = input.value.trim(); 
    if (!userText && !currentAttachedImage && !currentAttachedVideo && !currentAttachedDoc) return;

    if (currentAttachedImage) appendAiMessage("user", currentAttachedImage, "image");
    if (currentAttachedVideo) appendAiMessage("user", currentAttachedVideo, "video");
    if (currentAttachedDoc) appendAiMessage("user", `📎 ไฟล์แนบ: ${currentAttachedDocName}`, "text");
    if (userText) appendAiMessage("user", userText, "text");

    input.value = '';

    let pageText = "";
    const activePage = getActivePageWrapper();
    if (activePage) activePage.querySelectorAll('.word-text-node').forEach(node => pageText += node.innerText + " ");

    let finalPrompt = "";
    if (pageText.trim() !== "") finalPrompt += `บริบทข้อความในเอกสารหน้าปัจจุบัน:\n"""\n${pageText}\n"""\n`;
    if (currentAttachedDoc) finalPrompt += `บริบทจากไฟล์แนบ (${currentAttachedDocName}):\n"""\n${currentAttachedDoc}\n"""\n`;
    
    finalPrompt += `คำถาม/คำสั่ง: ${userText || "โปรดช่วยวิเคราะห์รูปภาพหรือข้อมูลที่แนบนี้ทีค่ะ"}\n\n`;
    finalPrompt += `กติกา: วิเคราะห์เป็นภาษาไทยกระชับและเป็นมิตร หากผู้ใช้สั่งให้วาดภาพให้ส่งกลับมาเป็น Markdown รูปภาพของ Pollinations.ai เท่านั้นค่ะ`;

    const imageToSend = currentAttachedImage;
    clearAttachedFile();

    appendAiMessage("system", "⚡ กำลังคิดคำตอบให้คุณนาวีค่ะ...");
    const result = await callGeminiAPI(finalPrompt, imageToSend);
    appendAiMessage("ai", result, "text");
}

async function askAiToSummary() {
    appendAiMessage("user", "โปรดสรุปข้อมูลหน้านี้ให้ทีครับ");
    let pageText = "";
    const activePage = getActivePageWrapper();
    if (activePage) activePage.querySelectorAll('.word-text-node').forEach(node => pageText += node.innerText + " ");
    
    if(!pageText.trim()) { appendAiMessage("ai", "❌ หน้านี้ไม่มีข้อความให้อ่านวิเคราะห์ค่ะ"); return; }
    
    appendAiMessage("system", "⚡ กำลังอ่านวิเคราะห์รายงานตารางหน้านี้ให้ค่ะ...");
    const prompt = `จงสรุปสาระสำคัญ ตัวเลข หรือตารางข้อมูลจากรายงานหน้านี้อย่างเป็นขั้นเป็นตอนและถูกต้อง:\n"""\n${pageText}\n"""`;
    const result = await callGeminiAPI(prompt);
    appendAiMessage("ai", result, "text");
}

function appendAiMessage(sender, content, type = 'text') {
    const chatBox = document.getElementById('ai-chat-box'); if (!chatBox) return;
    
    if (sender === 'system') {
        const tempMsg = document.createElement('div');
        tempMsg.className = 'ai-message system-msg temp-status'; tempMsg.innerText = content;
        chatBox.appendChild(tempMsg); chatBox.scrollTop = chatBox.scrollHeight; return;
    }
    
    const tempStatus = chatBox.querySelector('.temp-status'); if (tempStatus) tempStatus.remove();

    const msgDiv = document.createElement('div'); msgDiv.className = `ai-message ${sender}-msg`;
    
    if (type === 'image') {
        const img = document.createElement('img');
        img.src = content; img.className = 'chat-media-render';
        msgDiv.appendChild(img);
    } else if (type === 'video') {
        const video = document.createElement('video');
        video.src = content; video.className = 'chat-media-render'; video.controls = true;
        msgDiv.appendChild(video);
    } else {
        const markdownImageRegex = /!\[(.*?)\]\((.*?)\)/g;
        if (markdownImageRegex.test(content)) {
            msgDiv.innerHTML = content.replace(markdownImageRegex, (match, alt, url) => {
                return `<div style="margin-top: 6px;"><img src="${url}" alt="${alt}" class="chat-media-render"></div>`;
            });
        } else {
            msgDiv.innerText = content;
        }
    }
    
    chatBox.appendChild(msgDiv); 
    chatBox.scrollTop = chatBox.scrollHeight;
}

// -------------------------------------------------------------
// ลงทะเบียน Service Worker สำหรับการทำงาน PWA ออฟไลน์
// -------------------------------------------------------------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => console.log('Service Worker ลงทะเบียนสำเร็จ:', reg.scope))
            .catch(err => console.error('การลงทะเบียน Service Worker ล้มเหลว:', err));
    });
}
