const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];

if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
    console.error("ไม่สามารถเชื่อมต่อไลบรารี PDF.js ได้ กรุณาตรวจสอบลิงก์ Script ในหน้า HTML นะคะ");
}

// ==========================================================================
// 🌍 ตัวแปรส่วนกลางของระบบ (Global Variables)
// ==========================================================================
let currentScale = 1.0;
let currentTool = 'pan'; 
let currentActiveColor = "#22d3ee"; 
let currentBrushSize = 6;

let currentTextActiveColor = "#f59e0b";
let currentTextSize = 24;

let pdfDoc = null;
let currentFileMode = "pdf"; 
let initialDistance = 0;
let startScale = 1.0;
let originalFileName = "Nawee_Document";

let container = null;
let workspace = null;
let appTitle = null;
let activeDraggableNode = null; 
let eraserShape = 'circle';

// คลังเก็บไฟล์สะสมที่ผู้ใช้เลือกไว้ชั่วคราวเพื่อส่งไปพร้อมแชท AI
let selectedFilesArray = [];

// ==========================================================================
// 🛠️ ฟังก์ชันเครื่องมือทั่วไป (Utility Functions)
// ==========================================================================
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

// ระบบพรีวิววงกลมยางลบใต้เมาส์
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

// ==========================================================================
// 🔤 ระบบจัดการกล่องข้อความลอยอิสระ (Text Node Management)
// ==========================================================================
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
function deselectTextNode() {
    clearActiveDraggableNode();
    closeTextSheet();
}

// ==========================================================================
// 📥 ตัวดักจับเหตุการณ์หลักเมื่อโหลดหน้า UI (Main DOM Content Loaded)
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    container = document.getElementById('pdf-container');
    workspace = document.querySelector('.workspace');
    appTitle = document.getElementById('app-title');
    
    const uploadInput = document.getElementById('upload');
    if (uploadInput) uploadInput.addEventListener('change', handleFileOpen);
    
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
                const floatingTextColor = document.getElementById('floating-text-color');
                if (floatingTextColor) floatingTextColor.value = currentTextActiveColor;
            }
        });
    }

    const textSizeSlider = document.getElementById('text-size-slider');
    const textSizeLabel = document.getElementById('text-size-val');
    if (textSizeSlider && textSizeLabel) {
        textSizeSlider.addEventListener('input', (e) => {
            currentTextSize = parseInt(e.target.value);
            textSizeLabel.innerText = currentTextSize + 'px';
            if (activeDraggableNode) {
                activeDraggableNode.style.fontSize = currentTextSize + 'px';
            }
        });
    }

    const floatingTextColor = document.getElementById('floating-text-color');
    if (floatingTextColor) {
        floatingTextColor.addEventListener('input', (e) => {
            currentTextActiveColor = e.target.value;
            document.querySelectorAll('.text-palette-dot').forEach(d => d.classList.remove('active'));
            if (activeDraggableNode) {
                activeDraggableNode.style.color = currentTextActiveColor;
                activeDraggableNode.style.borderColor = currentTextActiveColor;
                const textColorPicker = document.getElementById('text-color-picker');
                if (textColorPicker) textColorPicker.value = currentTextActiveColor;
            }
        });
    }

    // คลิกเลือกจุดจานสีด่วนฝั่ง ปากกา
    document.querySelectorAll('.pen-palette-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            const pickedColor = e.target.getAttribute('data-color');
            if (pickedColor) {
                currentActiveColor = pickedColor;
                if (colorPicker) colorPicker.value = pickedColor;
                updateBrushPreview();
                document.querySelectorAll('.pen-palette-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
            }
        });
    });

    // คลิกเลือกจุดจานสีด่วนฝั่ง ข้อความลอย
    document.querySelectorAll('.text-palette-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            const pickedColor = e.target.getAttribute('data-color');
            if (pickedColor) {
                currentTextActiveColor = pickedColor;
                if (textColorPicker) textColorPicker.value = pickedColor;
                if (floatingTextColor) floatingTextColor.value = pickedColor;
                if (activeDraggableNode) {
                    activeDraggableNode.style.color = pickedColor;
                    activeDraggableNode.style.borderColor = pickedColor;
                }
                document.querySelectorAll('.text-palette-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
            }
        });
    });

    updateBrushPreview();
    setTool('pan');
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-wrapper')) closeAllPopups();
        if (!e.target.closest('.custom-draggable-text-node') && !e.target.closest('#text-settings-panel') && !e.target.closest('.toolbar') && !e.target.closest('.text-node-floating-bar') && !e.target.closest('.word-formatting-bar') && !e.target.closest('#text-node-bottom-bar')) {
            clearActiveDraggableNode();
        }
    });

    // ระบบตรวจจับการซูมด้วยนิ้วสัมผัสบนมือถือ (Pinch to Zoom)
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
    }
});

// ==========================================================================
// 💾 ระบบฐานข้อมูลภายในเครื่อง (IndexedDB Storage)
// ==========================================================================
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
        
        const drawingsState = [];
        document.querySelectorAll('.drawing-page-canvas').forEach((canvas, idx) => {
            drawingsState.push({ index: idx, dataUrl: canvas.toDataURL() });
        });

        const documentState = {
            docName: originalFileName,
            fileMode: currentFileMode,
            containerHTML: container.innerHTML, 
            drawings: drawingsState,
            savedAt: new Date().toISOString()
        };
        
        store.put(documentState);
        alert("บันทึกข้อมูลลงระบบความปลอดภัยจำลองสำเร็จ!");
    } catch (error) {
        alert("เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูลภายในเครื่องค่ะ");
    }
}

// ==========================================================================
// 🔄 ระบบแปลงโหมดและส่งออกไฟล์ (Modes & File Export)
// ==========================================================================
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
function triggerWordToPdf() { closeAllPopups(); switchFileMode('pdf'); alert("แปลงเลเยอร์แก้ไขกลับสู่โหมดสายตาหลักเสร็จสิ้น!"); }

function getPDFOptions() {
    const element = document.getElementById('pdf-container');
    const firstPage = element ? element.querySelector('.page-wrapper') : null;
    let pdfWidth = 794, pdfHeight = 1123;
    if (firstPage) {
        pdfWidth = parseFloat(firstPage.style.width) || firstPage.offsetWidth || 794;
        pdfHeight = parseFloat(firstPage.style.height) || firstPage.offsetHeight || 1123;
    }
    return {
        margin: 0, 
        filename: `${originalFileName}_Output.pdf`, 
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { 
            scale: 2, 
            useCORS: true, 
            logging: false, 
            backgroundColor: '#ffffff', 
            windowWidth: pdfWidth, 
            width: pdfWidth,       
            scrollX: 0,
            scrollY: 0,
            x: 0,                  
            y: 0
        },
        jsPDF: { unit: 'px', format: [pdfWidth, pdfHeight], orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait' },
        pagebreak: { mode: 'slice' }
    };
}

async function exportToPDFFile() {
    closeAllPopups(); if (!pdfDoc) { alert("ไม่พบข้อมูลเอกสารเพื่อส่งออกค่ะ!"); return; }
    if (typeof html2pdf === 'undefined') { alert("ไม่พบไลบรารีส่งออกไฟล์ภายนอกค่ะ"); return; }
    
    const originalScale = currentScale;
    const element = document.getElementById('pdf-container');
    const originalScrollTop = workspace ? workspace.scrollTop : 0;
    const originalScrollLeft = workspace ? workspace.scrollLeft : 0;
    
    if (workspace) {
        workspace.scrollTop = 0;
        workspace.scrollLeft = 0;
    }

    const originalTransform = element ? element.style.transform : '';
    const originalTransformOrigin = element ? element.style.transformOrigin : '';

    if (element) {
        element.style.transform = 'scale(1)';
        element.style.transformOrigin = 'top left';
    }
    currentScale = 1.0; 
    clearActiveDraggableNode();

    const firstPage = element ? element.querySelector('.page-wrapper') : null;
    let pdfWidth = 794, pdfHeight = 1123;
    if (firstPage) {
        pdfWidth = parseFloat(firstPage.style.width) || firstPage.offsetWidth || 794;
        pdfHeight = parseFloat(firstPage.style.height) || firstPage.offsetHeight || 1123;
    }

    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        #pdf-container { padding: 0 !important; margin: 0 !important; gap: 0 !important; display: block !important; width: ${pdfWidth}px !important; min-width: ${pdfWidth}px !important; max-width: ${pdfWidth}px !important; transform: none !important; }
        .page-wrapper { margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; display: block !important; page-break-inside: avoid !important; break-inside: avoid !important; width: ${pdfWidth}px !important; min-width: ${pdfWidth}px !important; max-width: ${pdfWidth}px !important; height: ${pdfHeight}px !important; position: relative !important; }
        .text-overlay-layer { overflow: visible !important; position: absolute !important; }
        .pdf-page-canvas, .drawing-page-canvas { width: 100% !important; height: 100% !important; }
        .custom-draggable-text-node { border: none !important; background: transparent !important; }
        .text-node-controls, .text-node-floating-bar { display: none !important; }
    `;
    document.head.appendChild(styleTag);

    try {
        await html2pdf().set(getPDFOptions()).from(element).save();
    } catch (e) {
        alert("เกิดข้อผิดพลาดในการดาวน์โหลดค่ะ");
    } finally {
        styleTag.remove(); 
        if (element) {
            element.style.transform = originalTransform;
            element.style.transformOrigin = originalTransformOrigin;
        }
        if (workspace) {
            workspace.scrollTop = originalScrollTop;
            workspace.scrollLeft = originalScrollLeft;
        }
        currentScale = originalScale; 
        applyZoom();
    }
}

async function shareToLine() {
    closeAllPopups(); if (!pdfDoc) { alert("ไม่พบเอกสารในการแชร์ค่ะ!"); return; }
    const originalScale = currentScale; 
    const element = document.getElementById('pdf-container');
    const originalScrollTop = workspace ? workspace.scrollTop : 0;
    const originalScrollLeft = workspace ? workspace.scrollLeft : 0;
    
    if (workspace) {
        workspace.scrollTop = 0;
        workspace.scrollLeft = 0;
    }

    const originalTransform = element ? element.style.transform : '';
    const originalTransformOrigin = element ? element.style.transformOrigin : '';

    if (element) {
        element.style.transform = 'scale(1)';
        element.style.transformOrigin = 'top left';
    }
    currentScale = 1.0; 
    clearActiveDraggableNode();

    const firstPage = element ? element.querySelector('.page-wrapper') : null;
    let pdfWidth = 794, pdfHeight = 1123;
    if (firstPage) {
        pdfWidth = parseFloat(firstPage.style.width) || firstPage.offsetWidth || 794;
        pdfHeight = parseFloat(firstPage.style.height) || firstPage.offsetHeight || 1123;
    }

    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        #pdf-container { padding: 0 !important; margin: 0 !important; gap: 0 !important; display: block !important; width: ${pdfWidth}px !important; min-width: ${pdfWidth}px !important; max-width: ${pdfWidth}px !important; transform: none !important; }
        .page-wrapper { margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; display: block !important; page-break-inside: avoid !important; break-inside: avoid !important; width: ${pdfWidth}px !important; min-width: ${pdfWidth}px !important; max-width: ${pdfWidth}px !important; height: ${pdfHeight}px !important; position: relative !important; }
        .text-overlay-layer { overflow: visible !important; position: absolute !important; }
        .pdf-page-canvas, .drawing-page-canvas { width: 100% !important; height: 100% !important; }
        .custom-draggable-text-node { border: none !important; background: transparent !important; }
        .text-node-controls, .text-node-floating-bar { display: none !important; }
    `;
    document.head.appendChild(styleTag);

    try {
        const pdfBlob = await html2pdf().set(getPDFOptions()).from(element).outputPdf('blob');
        const file = new File([pdfBlob], `${originalFileName}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Share PDF', text: 'แชร์รายงานจาก Nawee Studio' });
        } else {
            alert("ไม่สามารถแชร์ตรงไปยัง LINE ได้ ระบบดาวน์โหลดไฟล์เข้าสู่อุปกรณ์แทนนะคะ");
            exportToPDFFile();
        }
    } catch (e) { exportToPDFFile(); }
    finally { 
        styleTag.remove();
        if (element) {
            element.style.transform = originalTransform;
            element.style.transformOrigin = originalTransformOrigin;
        }
        if (workspace) {
            workspace.scrollTop = originalScrollTop;
            workspace.scrollLeft = originalScrollLeft;
        }
        currentScale = originalScale; 
        applyZoom();
    }
}

function formatWord(command, value = null) {
    if (activeDraggableNode) {
        const span = activeDraggableNode.querySelector('span');
        if (!span) return;
        if (command === 'bold') {
            span.style.fontWeight = (span.style.fontWeight === 'bold' || span.style.fontWeight === '700') ? 'normal' : 'bold';
        } else if (command === 'italic') {
            span.style.fontStyle = (span.style.fontStyle === 'italic') ? 'normal' : 'italic';
        } else if (command === 'underline') {
            span.style.textDecoration = (span.style.textDecoration === 'underline') ? 'none' : 'underline';
        }
        return; 
    }
    if (currentFileMode === 'word') {
        document.execCommand(command, false, value);
    }
}

function clearActiveDraggableNode() {
    if (activeDraggableNode) {
        activeDraggableNode.style.borderColor = 'transparent';
        activeDraggableNode.classList.remove('is-active-focused');
        activeDraggableNode = null;
    }
}

function scrollWorkspace(direction) {
    if (!workspace) return;
    const pageHeight = workspace.clientHeight - 100;
    if (direction === 'next') workspace.scrollTop += pageHeight;
    else workspace.scrollTop -= pageHeight;
}

function toggleDropdown(menuId) {
    const targetMenu = document.getElementById(menuId);
    if (!targetMenu) return;
    const isOpen = targetMenu.classList.contains('show');
    closeAllPopups();
    if (!isOpen) targetMenu.classList.add('show');
}
function closeAllPopups() { document.querySelectorAll('.dropdown-popup').forEach(m => m.classList.remove('show')); }

function updateBrushPreview() {
    const preview = document.getElementById('brush-preview');
    if (preview) { preview.style.width = currentBrushSize + 'px'; preview.style.height = currentBrushSize + 'px'; preview.style.backgroundColor = currentActiveColor; }
}

// ==========================================================================
// 📄 ระบบดึงข้อมูล เรนเดอร์ และวาดเขียนเอกสาร (PDF Render & Drawing Engine)
// ==========================================================================
async function handleFileOpen(e) {
    try {
        const file = e.target.files[0]; if (!file) return;
        originalFileName = file.name.replace(/\.[^/.]+$/, ""); 
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        container.innerHTML = ''; currentScale = 1.0; applyZoom();

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 2.5 }); 

            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-wrapper';
            pageWrapper.style.width = (viewport.width / 2) + 'px';
            pageWrapper.style.height = (viewport.height / 2) + 'px';

            const pdfCanvas = document.createElement('canvas');
            pdfCanvas.className = 'pdf-page-canvas';
            pdfCanvas.width = viewport.width; pdfCanvas.height = viewport.height;
            pageWrapper.appendChild(pdfCanvas);

            const drawingCanvas = document.createElement('canvas');
            drawingCanvas.className = 'drawing-page-canvas';
            drawingCanvas.width = viewport.width; drawingCanvas.height = viewport.height;
            pageWrapper.appendChild(drawingCanvas);

            const textOverlayLayer = document.createElement('div');
            textOverlayLayer.className = 'text-overlay-layer';
            pageWrapper.appendChild(textOverlayLayer);
            container.appendChild(pageWrapper);

            await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

            const displayViewport = page.getViewport({ scale: 1.25 });
            const textContent = await page.getTextContent();
            
            textContent.items.forEach(item => {
                if (!item.str || item.str.trim() === "") return;
                const [left, txY] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                const fontHeight = Math.abs(item.transform[3]) * 1.25; 
                const top = txY - fontHeight;

                const textNode = document.createElement('div');
                textNode.className = 'word-text-node';
                textNode.setAttribute('contenteditable', 'false');
                textNode.style.left = left + 'px'; textNode.style.top = top + 'px';
                textNode.style.fontSize = fontHeight + 'px';
                
                const calculatedWidth = item.width * 1.25;
                if (calculatedWidth > 0) textNode.style.width = calculatedWidth + 'px';
                textNode.innerText = item.str;
                textNode.addEventListener('input', () => textNode.classList.add('is-edited'));
                textOverlayLayer.appendChild(textNode);
            });
            bindDrawingEngine(drawingCanvas);
        }
        switchFileMode(currentFileMode);
    } catch (error) { alert("เกิดข้อผิดพลาดในการโหลดชีทสเปซ: " + error.message); }
}

function bindDrawingEngine(canvas) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false; let lastX = 0, lastY = 0;

    if (!canvas.undoStack) { canvas.undoStack = [canvas.toDataURL()]; canvas.redoStack = []; }

    function getCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: ((clientX - rect.left) / rect.width) * canvas.width, y: ((clientY - rect.top) / rect.height) * canvas.height };
    }
    function startAction(e) {
        if (currentTool === 'pan' || currentTool === 'text' || (e.touches && e.touches.length > 1)) return;
        const coords = getCoords(e); isDrawing = true; lastX = coords.x; lastY = coords.y;
    }
    function moveAction(e) {
        if (!isDrawing || currentTool === 'pan' || currentTool === 'text' || (e.touches && e.touches.length > 1)) return;
        const coords = getCoords(e);
        ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(coords.x, coords.y);

        if (currentTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = currentActiveColor;
            ctx.lineWidth = currentBrushSize * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
        } else if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = currentBrushSize * 12;
            ctx.lineCap = (eraserShape === 'square') ? 'square' : 'round'; ctx.lineJoin = (eraserShape === 'square') ? 'miter' : 'round'; ctx.stroke();
        }
        lastX = coords.x; lastY = coords.y;
    }
    const stopAction = () => {
        if (isDrawing) {
            isDrawing = false; const currentState = canvas.toDataURL();
            if (canvas.undoStack[canvas.undoStack.length - 1] !== currentState) { canvas.undoStack.push(currentState); canvas.redoStack = []; }
        }
    };
    canvas.addEventListener('mousedown', startAction); canvas.addEventListener('mousemove', moveAction);
    canvas.addEventListener('mouseup', stopAction); canvas.addEventListener('mouseleave', stopAction);
    canvas.addEventListener('touchstart', (ev) => { if (ev.touches.length === 1 && currentTool !== 'pan' && currentTool !== 'text') startAction(ev); }, {passive: true});
    canvas.addEventListener('touchmove', (ev) => { if (ev.touches.length === 1 && currentTool !== 'pan' && currentTool !== 'text') { ev.preventDefault(); moveAction(ev); } }, {passive: false});
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

function getActivePageWrapper() {
    const wrappers = document.querySelectorAll('.page-wrapper'); if (wrappers.length === 0) return null;
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

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) activeBtn.classList.add('active');

    const penPanel = document.getElementById('pen-settings-panel');
    const textPanel = document.getElementById('text-settings-panel');
    const toggleShapeBtn = document.getElementById('btn-toggle-shape');

    if (penPanel) penPanel.style.display = (tool === 'pen' || tool === 'eraser') ? 'flex' : 'none';
    if (toggleShapeBtn) toggleShapeBtn.style.display = (tool === 'eraser') ? 'inline-block' : 'none';
    if (textPanel) textPanel.style.display = (tool === 'text') ? 'flex' : 'none';

    if (workspace) {
        if (tool === 'pan') { workspace.style.cursor = 'grab'; workspace.style.overflow = 'auto'; }
        else if (tool === 'text') { workspace.style.cursor = 'text'; workspace.style.overflow = 'auto'; }
        else { workspace.style.cursor = 'crosshair'; workspace.style.overflow = 'hidden'; }
    }
    clearActiveDraggableNode();
}

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
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0; 
    
    function dragStart(ev) {
        if (node.classList.contains('is-editing')) return; 
        isDraggingNode = true;
        const pageX = ev.touches ? ev.touches[0].pageX : ev.pageX;
        const pageY = ev.touches ? ev.touches[0].pageY : ev.pageY;
        
        startX = pageX;
        startY = pageY;
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
        
        let targetLeft = startLeft + deltaX;
        let targetTop = startTop + deltaY;
        
        const parent = node.parentElement; 
        if (parent) {
            const halfWidth = node.offsetWidth / 2;
            const halfHeight = node.offsetHeight / 2;
            if (targetLeft < halfWidth) targetLeft = halfWidth; 
            if (targetLeft > parent.offsetWidth - halfWidth) targetLeft = parent.offsetWidth - halfWidth; 
            if (targetTop < halfHeight) targetTop = halfHeight; 
            if (targetTop > parent.offsetHeight - halfHeight) targetTop = parent.offsetHeight - halfHeight; 
        }
        
        node.style.left = targetLeft + 'px'; 
        node.style.top = targetTop + 'px';
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

document.addEventListener('DOMContentLoaded', () => {
    if (workspace) {
        workspace.addEventListener('click', (e) => {
            if (currentTool === 'text' && !e.target.closest('.custom-draggable-text-node') && !e.target.closest('.toolbar') && !e.target.closest('.text-node-floating-bar') && !e.target.closest('#text-node-bottom-bar')) {
                createDraggableTextNode(e);
            }
        });
    }
});

// ==========================================================================
// 🤖 [COMPLETE SYSTEM] ระบบผู้ช่วย AI (Gemini 2.5 Flash มัลติโมดอล + เจนภาพ)
// ==========================================================================

/**
 * 1. ฟังก์ชันเปิด-ปิด แถบผู้ช่วย AI Sidebar
 */
function toggleAiSidebar() {
    const sidebar = document.getElementById('ai-sidebar');
    if (sidebar) sidebar.classList.toggle('open');
}

/**
 * 2. ฟังก์ชันเปิด-ปิด ป๊อปอัพเมนูมัลติมีเดีย (+)
 */
function toggleMediaPopup() {
    const popup = document.getElementById('media-popup');
    if (!popup) return;
    popup.style.display = (popup.style.display === 'flex') ? 'none' : 'flex';
}

/**
 * 3. ฟังก์ชันคลิกเลือกประเภทมัลติมีเดียข้างในป๊อปอัพเพื่อเปิดหน้าต่างไฟล์ของระบบ
 */
function triggerMediaInput(type) {
    const inputId = type === 'image' ? 'ai-image-input' : 'ai-video-input';
    const fileInput = document.getElementById(inputId);
    if (fileInput) fileInput.click();
    toggleMediaPopup();
}

/**
 * 4. ฟังก์ชันดักจับสถานะเมื่อไฟล์ถูกเลือกเข้ามา (ทั้งจากปุ่มเอกสารด่วนและป๊อปอัพ)
 */
function handleFileSelect(type) {
    let inputId = '';
    if (type === 'document') inputId = 'ai-document-input';
    else if (type === 'image') inputId = 'ai-image-input';
    else if (type === 'video') inputId = 'ai-video-input';

    const fileInput = document.getElementById(inputId);
    if (!fileInput || !fileInput.files.length) return;

    const files = Array.from(fileInput.files);
    files.forEach(file => {
        file.customType = type;
        selectedFilesArray.push(file);
    });

    renderFilePreviews();
    fileInput.value = '';
}

/**
 * 5. ฟังก์ชันจัดการเรนเดอร์ UI กล่องพรีวิวไฟล์ขึ้นหน้าจอ (#file-preview-container)
 */
function renderFilePreviews() {
    const previewContainer = document.getElementById('file-preview-container');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';

    if (selectedFilesArray.length === 0) {
        previewContainer.style.display = 'none';
        return;
    }

    previewContainer.style.display = 'flex';
    previewContainer.style.flexWrap = 'wrap';

    selectedFilesArray.forEach((file, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'ai-preview-item';
        previewItem.style.marginRight = '8px';
        previewItem.style.marginBottom = '4px';
        
        const shortName = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
        
        let icon = '📄';
        if (file.customType === 'image') icon = '🖼️';
        if (file.customType === 'video') icon = '🎬';

        previewItem.innerHTML = `
            <div style="background: rgba(255,255,255,0.06); padding: 5px 10px; border-radius: 6px; font-size: 12px; display: flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.1); color: #f8fafc;">
                <span>${icon} ${shortName}</span>
            </div>
            <span class="remove-preview-btn" onclick="removeSelectedFile(${index})">&times;</span>
        `;
        
        previewContainer.appendChild(previewItem);
    });
}

/**
 * 6. ฟังก์ชันสำหรับลบไฟล์ออกจากคลังสะสมชั่วคราวเมื่อกดกากบาท
 */
function removeSelectedFile(index) {
    selectedFilesArray.splice(index, 1);
    renderFilePreviews();
}

/**
 * 7. ฟังก์ชันเชื่อมต่อ Gemini API (เวอร์ชันมัลติโมดอลรองรับดวงตา AI - มุ่งตรงไปที่รุ่น 2.5 Flash)
 */
async function callGeminiAPI(promptText, imageParts = []) {
    const keyInput = document.getElementById('ai-api-key');
    const API_KEY = keyInput ? keyInput.value.trim() : "";
    if(!API_KEY) return "❌ โปรดใส่ Gemini API Key ของคุณนาวีในแถบด้านบนก่อนเริ่มส่งคำสั่งนะคะ";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    const parts = [{ text: promptText }];
    
    imageParts.forEach(img => {
        parts.push({
            inlineData: {
                mimeType: img.mimeType,
                data: img.base64
            }
        });
    });

    try {
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

/**
 * 8. ฟังก์ชันส่งคำกรอกแชท (อ่าน Text หน้าปัจจุบัน + ระบบวิเคราะห์ไฟล์แนบภาพ + ฟีเจอร์วาดรูป)
 */
async function sendAiQuestion() {
    const input = document.getElementById('ai-input'); if (!input) return;
    const userText = input.value.trim();

    if (!userText && selectedFilesArray.length === 0) return;

    // 🎨 ระบบดักจับคำสั่งเพื่อเจนภาพทันทีด้วย Pollinations AI
    if (userText.startsWith("วาดรูป") || userText.startsWith("สร้างภาพ")) {
        appendAiMessage("user", userText);
        input.value = '';
        appendAiMessage("system", "🎨 กำลังจินตนาการลายเส้นและวาดภาพให้คุณนาวีสักครู่นะคะ...");
        
        const promptKeyword = userText.replace(/วาดรูป|สร้างภาพ/g, "").trim();
        const cleanPrompt = encodeURIComponent(promptKeyword || "beautiful futuristic digital art");
        
        setTimeout(() => {
            const randomSeed = Math.floor(Math.random() * 99999);
            const generatedImageUrl = `https://image.pollinations.ai/p/${cleanPrompt}?width=600&height=600&seed=${randomSeed}&enhance=true`;
            
            const imageTemplate = `
                <div style="margin-top: 8px; border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 15px rgba(0,0,0,0.3); max-width: 100%;">
                    <img src="${generatedImageUrl}" alt="AI Generated Image" style="width: 100%; display: block; object-fit: cover;">
                </div>
                <p style="margin-top: 8px; color: #22d3ee; font-weight: 500;">✨ หนูวาดรูป "${promptKeyword || 'ภาพศิลปะดิจิทัล'}" เสร็จเรียบร้อยแล้วค่ะคุณนาวี!</p>
            `;
            appendAiMessage("ai", imageTemplate);
        }, 1800);

        selectedFilesArray = [];
        renderFilePreviews();
        return; 
    }

    let pageText = "";
    const activePage = getActivePageWrapper();
    if (activePage) activePage.querySelectorAll('.word-text-node').forEach(node => pageText += node.innerText + " ");

    let userDisplayHtml = userText;
    if (selectedFilesArray.length > 0) {
        const fileListText = selectedFilesArray.map(f => {
            let icon = '📄';
            if (f.customType === 'image') icon = '🖼️';
            if (f.customType === 'video') icon = '🎬';
            return `${icon} ${f.name}`;
        }).join('<br>');
        userDisplayHtml += userText ? `<br><br><b>📎 รายการไฟล์แนบ:</b><br>${fileListText}` : `<b>📎 ส่งไฟล์แนบ:</b><br>${fileListText}`;
    }

    appendAiMessage("user", userDisplayHtml);
    input.value = '';

    const filesToProcess = [...selectedFilesArray];
    selectedFilesArray = [];
    renderFilePreviews();

    // แปลงไฟล์ภาพถ่ายเป็น Base64
    const imageParts = [];
    for (let file of filesToProcess) {
        if (file.customType === 'image') {
            try {
                const base64Data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = error => reject(error);
                });
                imageParts.push({ mimeType: file.type, base64: base64Data });
            } catch (err) {
                console.error("ผิดพลาดในการแปลงไฟล์ภาพ:", err);
            }
        }
    }

    let finalPrompt = "";
    if (pageText.trim() !== "") {
        finalPrompt += `ข้อมูลธรรมดาจากหน้าชีตปัจจุบัน:\n"""\n${pageText}\n"""\n`;
    }
    finalPrompt += `คำสั่งหรือคำถามของผู้ใช้: ${userText}`;
    
    const nonImages = filesToProcess.filter(f => f.customType !== 'image');
    if (nonImages.length > 0) {
        finalPrompt += `\n\n[หมายเหตุระบบ: มีไฟล์แนบประเภทอื่นพ่วงมาด้วยจำนวน ${nonImages.length} ไฟล์ ซึ่ง AI รับรู้ชื่อเรียบร้อยแล้ว]`;
    }

    appendAiMessage("system", "⚡ กำลังประมวลผลวิเคราะห์ข้อความและภาพถ่ายให้คุณนาวีค่ะ...");
    
    const aiResult = await callGeminiAPI(finalPrompt, imageParts);
    const formattedResult = aiResult.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width:100%; border-radius:8px; margin-top:8px;">');
    appendAiMessage("ai", formattedResult);
}

/**
 * 9. ฟังก์ชันสรุปเนื้อหาหน้านี้อัตโนมัติ (Logic ดั้งเดิมของคุณนาวี)
 */
async function askAiToSummary() {
    appendAiMessage("user", "โปรดสรุปข้อมูลหน้านี้ให้ทีครับ");
    let pageText = "";
    const activePage = getActivePageWrapper();
    if (activePage) activePage.querySelectorAll('.word-text-node').forEach(node => pageText += node.innerText + " ");
    
    if(!pageText.trim()) { appendAiMessage("ai", "❌ หน้านี้ไม่มีข้อความธรรมดาให้ดึงไปวิเคราะห์ค่ะ"); return; }
    
    appendAiMessage("system", "⚡ กำลังอ่านวิเคราะห์รายงานตารางหน้านี้ให้ค่ะ...");
    const prompt = `จงสรุปสาระสำคัญ ตัวเลข หรือตารางข้อมูลจากรายงานหน้านี้อย่างเป็นขั้นเป็นตอนและถูกต้อง:\n"""\n${pageText}\n"""`;
    const result = await callGeminiAPI(prompt, []);
    appendAiMessage("ai", result);
}

/**
 * 10. ฟังก์ชันพ่นข้อความแชทขึ้นหน้าจอ (สลับเป็น innerHTML เพื่อรองรับการแสดงภาพและตัวหนา)
 */
function appendAiMessage(sender, text) {
    const chatBox = document.getElementById('ai-chat-box'); if (!chatBox) return;
    if (sender === 'system') {
        const tempMsg = document.createElement('div');
        tempMsg.className = 'ai-message system-msg temp-status'; tempMsg.innerText = text;
        chatBox.appendChild(tempMsg); chatBox.scrollTop = chatBox.scrollHeight; return;
    }
    const tempStatus = chatBox.querySelector('.temp-status'); if (tempStatus) tempStatus.remove();

    const msgDiv = document.createElement('div'); msgDiv.className = `ai-message ${sender}-msg`;
    msgDiv.innerHTML = text;
    chatBox.appendChild(msgDiv); chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * 11. ระบบ UX ช่วยตรวจจับหากกดพื้นที่อื่นภายนอก ให้หุบเมนูป๊อปอัพมัลติมีเดียลงอัตโนมัติ
 */
document.addEventListener('click', (e) => {
    const popup = document.getElementById('media-popup');
    const mediaPlusBtn = document.getElementById('btn-media-plus');
    if (popup && mediaPlusBtn && !popup.contains(e.target) && !mediaPlusBtn.contains(e.target)) {
        popup.style.display = 'none';
    }
});
/**
 * 12. ฟังก์ชันรีเซ็ตแอปพลิเคชันเพื่อเริ่มงานใหม่ (ซ่อมแซมปุ่ม งานใหม่ ใน HTML)
 */
function resetApp() {
    if (confirm("คุณนาวีต้องการล้างหน้าจอเพื่อเริ่มงานใหม่ใช่ไหมคะ? ข้อมูลวาดเขียนที่ไม่ได้เซฟจะสูญหายค่ะ")) {
        pdfDoc = null;
        currentScale = 1.0;
        
        // รีเซ็ตหน้ากระดาษกลับสู่หน้าต่างต้อนรับเริ่มต้น
        const container = document.getElementById('pdf-container');
        if (container) {
            container.innerHTML = `
                <div class="initial-notice">
                    <p><i class="fa-solid fa-cloud-arrow-up" style="font-size: 48px; color: var(--accent-color); margin-bottom: 15px;"></i></p>
                    <p>ยินดีต้อนรับสู่ระบบกรุณากดปุ่ม <b>"เปิดไฟล์"</b> ด้านบนเพื่อเริ่มต้นทำงานค่ะ</p>
                </div>
            `;
        }
        
        // รีเซ็ตล้างกล่องแชท AI คืนสู่สถานะเริ่มต้น
        const chatBox = document.getElementById('ai-chat-box');
        if (chatBox) {
            chatBox.innerHTML = `<div class="ai-message system-msg">สวัสดีค่ะคุณนาวี! ให้หนูช่วยสรุปรายงาน วิเคราะห์ตาราง หรือแปลความหมายข้อมูลในหน้าเอกสารปัจจุบัน พิมพ์บอกได้เลยนะคะ 📝</div>`;
        }
        
        // ล้างคลังไฟล์แนบตกค้าง
        selectedFilesArray = [];
        renderFilePreviews();
        
        // สลับโหมดกลับมาที่ PDF 
        switchFileMode('pdf');
        showNotification("🎨 รีเซ็ตสตูดิโอเริ่มงานใหม่เรียบร้อยแล้วค่ะ");
    }
}
