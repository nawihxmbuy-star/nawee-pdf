const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];

if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
    console.error("ไม่สามารถเชื่อมต่อไลบรารี PDF.js ได้ กรุณาตรวจสอบลิงก์ Script ในหน้า HTML นะคะ");
}

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
let activeDraggableNode = null; // ตัวแปรหลักสำหรับเก็บกล่องข้อความลอยที่กำลังถูกเลือกใช้งานอยู่ปัจจุบัน
let eraserShape = 'circle';

// ✨ ✨ [NEW v2.0] ตัวแปรความจำสำหรับเก็บประวัติการคุยกับ AI ต่อเนื่อง (Chat History)
let geminiChatHistory = [];

// ฟังก์ชันเสริมสำหรับบันทึกสถานะแชทลงเครื่องแบบเรียลไทม์ (Chat Persistence)
function saveChatToLocalStorage() {
    const chatBox = document.getElementById('ai-chat-box');
    if (chatBox) {
        localStorage.setItem('nawee_studio_chat_html', chatBox.innerHTML);
    }
    localStorage.setItem('nawee_studio_chat_history', JSON.stringify(geminiChatHistory));
}

// ฟังก์ชันแปลงค่าสี RGB จากเบราว์เซอร์ให้เป็น Hex เพื่อซิงค์กับช่องเลือกสี
function rgbToHex(rgb) {
    if (!rgb || !rgb.startsWith('rgb')) return rgb;
    const rgbValues = rgb.match(/\d+/g);
    if (!rgbValues || rgbValues.length < 3) return null;
    return "#" + rgbValues.slice(0,3).map(x => {
        const hex = parseInt(x).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join("");
}

// --- UI: ระบบแสดงการแจ้งเตือน Custom Notification ---
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

// --- UI: พรีวิวยางลบขยับตามเมาส์ ---
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

// --- UI: ฟังก์ชันสำหรับเลือกกล่องข้อความเก่าขึ้นมาแก้ไขย้อนหลัง ---
function selectTextNode(node) {
    clearActiveDraggableNode();
    activeDraggableNode = node;
    node.style.borderColor = node.style.color || currentTextActiveColor;
    node.classList.add('is-active-focused');

    // ซิงค์ค่าขนาดฟอนต์ของกล่องที่จิ้ม กลับมาแสดงบนสไลเดอร์ควบคุมด้านล่าง
    const textSizeSlider = document.getElementById('text-size-slider');
    const textSizeLabel = document.getElementById('text-size-val');
    if (textSizeSlider && textSizeLabel) {
        const size = parseInt(node.style.fontSize) || 24;
        textSizeSlider.value = size;
        textSizeLabel.innerText = size + 'px';
        currentTextSize = size;
    }
    
    // ซิงค์ค่าสีของกล่องที่จิ้ม กลับมาแสดงบนตัวเลือกสีหลักและตัวเลือกสีลอยด้านล่าง
    const hexColor = rgbToHex(node.style.color) || currentTextActiveColor;
    const textColorPicker = document.getElementById('text-color-picker');
    if (textColorPicker) textColorPicker.value = hexColor;
    
    const floatingTextColor = document.getElementById('floating-text-color');
    if (floatingTextColor) floatingTextColor.value = hexColor;
    
    currentTextActiveColor = hexColor;
    openCenterTextInput();
}

// --- UI: เปิด/ปิดแผง Bottom Sheet ---
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

// ฟังก์ชันเสริมสำหรับควบคุมตกแต่งข้อความลอยล่างสุด
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

// 🌐 ยุบรวมการตั้งค่าและดักจับ Event ต่างๆ ไว้ที่สัญญานโหลดหน้าจอหลักจุดเดียว
document.addEventListener('DOMContentLoaded', () => {
    container = document.getElementById('pdf-container');
    workspace = document.querySelector('.workspace');
    appTitle = document.getElementById('app-title');
    const chatBox = document.getElementById('ai-chat-box');
    
    // 💾 [NEW v2.0 - Chat Persistence] โหลดข้อความแชทเก่าและประวัติจากหน่วยความจำเครื่องกลับมาแสดงผลอัตโนมัติ
    if (chatBox) {
        const savedChatHtml = localStorage.getItem('nawee_studio_chat_html');
        const savedHistory = localStorage.getItem('nawee_studio_chat_history');
        
        if (savedChatHtml) {
            chatBox.innerHTML = savedChatHtml;
            chatBox.scrollTop = chatBox.scrollHeight;
        }
        if (savedHistory) {
            try {
                geminiChatHistory = JSON.parse(savedHistory);
            } catch (e) {
                console.error("โหลดประวัติแชทล้มเหลว:", e);
            }
        }
    }

    const uploadInput = document.getElementById('upload');
    if (uploadInput) uploadInput.addEventListener('change', handleFileOpen);
    
    // 💾 [NEW v2.0] ระบบจำจำ API Key อัตโนมัติด้วย LocalStorage
    const keyInput = document.getElementById('ai-api-key');
    if (keyInput) {
        keyInput.value = localStorage.getItem('gemini_api_key') || '';
        keyInput.addEventListener('input', (e) => {
            localStorage.setItem('gemini_api_key', e.target.value.trim());
        });
    }

    const colorPicker = document.getElementById('color-picker');
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            currentActiveColor = e.target.value;
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
    
    // 🟢 เลือกสีจากแผงหลักแล้วให้ข้อความเปลี่ยนสีตามทันทีแบบ Real-time (ใช้ได้ทุกกล่องที่เลือก)
    const textColorPicker = document.getElementById('text-color-picker');
    if (textColorPicker) {
        textColorPicker.addEventListener('input', (e) => {
            currentTextActiveColor = e.target.value;
            if (activeDraggableNode) {
                activeDraggableNode.style.color = currentTextActiveColor;
                activeDraggableNode.style.borderColor = currentTextActiveColor;
                const floatingTextColor = document.getElementById('floating-text-color');
                if (floatingTextColor) floatingTextColor.value = currentTextActiveColor;
            }
        });
    }

    // 🟢 เลื่อนสไลเดอร์ปรับขนาดแล้วให้ข้อความขยายใหญ่ตามทันทีแบบ Real-time (ใช้ได้ทุกกล่องที่เลือก)
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

    // 🟢 ปรับเปลี่ยนสีจากแผงควบคุมลอยด้านล่าง (Bottom Bar) แบบย้อนหลังและเรียลไทม์
    const floatingTextColor = document.getElementById('floating-text-color');
    if (floatingTextColor) {
        floatingTextColor.addEventListener('input', (e) => {
            currentTextActiveColor = e.target.value;
            if (activeDraggableNode) {
                activeDraggableNode.style.color = currentTextActiveColor;
                activeDraggableNode.style.borderColor = currentTextActiveColor;
                const textColorPicker = document.getElementById('text-color-picker');
                if (textColorPicker) textColorPicker.value = currentTextActiveColor;
            }
        });
    }

    // 💬 [UX UPGRADE] อำนวยความสะดวกให้กดปุ่ม Enter เพื่อส่งข้อความแชทหา AI ได้ทันที
    const aiInput = document.getElementById('ai-input');
    if (aiInput) {
        aiInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // สกัดกั้นการขึ้นบรรทัดใหม่
                sendAiQuestion();  // เรียกฟังก์ชันส่งคำถามทันที
            }
        });
    }

    updateBrushPreview();
    setTool('pan');
    
    // 🟢 [RE-ORGANIZED] ย้ายระบบคลิกพื้นที่ทำงานว่างเพื่อสร้างกล่องข้อความลอยมารวมไว้ที่นี่
    if (workspace) {
        workspace.addEventListener('click', (e) => {
            if (currentTool === 'text' && !e.target.closest('.custom-draggable-text-node') && !e.target.closest('.toolbar') && !e.target.closest('.text-node-floating-bar') && !e.target.closest('#text-node-bottom-bar')) {
                createDraggableTextNode(e);
            }
        });

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

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-wrapper')) closeAllPopups();
        if (!e.target.closest('.custom-draggable-text-node') && !e.target.closest('#text-settings-panel') && !e.target.closest('.toolbar') && !e.target.closest('.text-node-floating-bar') && !e.target.closest('.word-formatting-bar') && !e.target.closest('#text-node-bottom-bar')) {
            clearActiveDraggableNode();
        }
    });
});

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

async function handleFileOpen(e) {
    try {
        const file = e.target.files[0]; if (!file) return;
        originalFileName = file.name.replace(/\.[^/.]+$/, ""); 
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        container.innerHTML = ''; currentScale = 1.0; applyZoom();
        
        geminiChatHistory = []; 
        localStorage.removeItem('nawee_studio_chat_html');
        localStorage.removeItem('nawee_studio_chat_history');
        const chatBox = document.getElementById('ai-chat-box');
        if (chatBox) chatBox.innerHTML = '';

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
            scrollY: 0
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

    const penColorGroup = document.getElementById('pen-color-group') || (penPanel ? penPanel.querySelector('.panel-item') : null);
    if (penColorGroup) {
        penColorGroup.style.display = (tool === 'eraser') ? 'none' : 'flex';
    }

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

    let isDraggingNode = false; let startX = 0, startY = 0;
    
    function dragStart(ev) {
        if (node.classList.contains('is-editing')) return; 
        isDraggingNode = true;
        const pageX = ev.touches ? ev.touches[0].pageX : ev.pageX;
        const pageY = ev.touches ? ev.touches[0].pageY : ev.pageY;
        startX = pageX - parseFloat(node.style.left); 
        startY = pageY - parseFloat(node.style.top);
        selectTextNode(node);

        document.addEventListener('mousemove', dragMove); 
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchmove', dragMove, { passive: false }); 
        document.addEventListener('touchend', dragEnd);
    }

    function dragMove(ev) {
        if (!isDraggingNode) return;
        if (ev.cancelable) ev.preventDefault();
        const pageX = ev.touches ? ev.touches[0].pageX : ev.pageX;
        const pageY = ev.touches ? ev.touches[0].pageY : ev.pageY;
        node.style.left = (pageX - startX) + 'px'; 
        node.style.top = (pageY - startY) + 'px';
    }

    function dragEnd() { 
        if (isDraggingNode) {
            isDraggingNode = false; 
            document.removeEventListener('mousemove', dragMove);
            document.removeEventListener('mouseup', dragEnd);
            document.removeEventListener('touchmove', dragMove);
            document.removeEventListener('touchend', dragEnd);
        }
    }

    node.addEventListener('mousedown', dragStart); 
    node.addEventListener('touchstart', dragStart, {passive: true}); 

    overlay.appendChild(node);
    
    selectTextNode(node);
    node.classList.add('is-editing');
    setTimeout(() => { span.focus(); document.execCommand('selectAll', false, null); }, 60);
}


// ==========================================
// 🔥🔥🔥 [UPGRADED v2.0] AI GEMINI PRO STUDIO ENGINE
// ==========================================

async function captureActivePageBase64() {
    const activePage = getActivePageWrapper();
    if (!activePage) return null;
    if (typeof html2canvas === 'undefined') {
        console.warn("ไม่พบไลบรารี html2canvas กรุณาใส่ Script แท็กเชื่อมต่อในหน้า HTML นะคะ");
        return null;
    }
    try {
        const tempCanvas = await html2canvas(activePage, {
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            scale: 1.2 
        });
        return tempCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    } catch (error) {
        console.error("สแกนและถ่ายภาพหน้าจอผิดพลาด:", error);
        return null;
    }
}

async function streamGeminiPayload(contents, onChunkReceived, onDone, onError) {
    const keyInput = document.getElementById('ai-api-key');
    const API_KEY = keyInput ? keyInput.value.trim() : "";
    if(!API_KEY) {
        onError("❌ โปรดใส่ Gemini API Key ในแถบด้านบนก่อนเริ่มส่งคำสั่งนะคะ");
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key=${API_KEY}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: contents })
        });

        if (!response.ok) throw new Error(`HTTP status ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let accumulatedText = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const regex = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
            let currentTextSnapshot = "";
            let match;

            while ((match = regex.exec(buffer)) !== null) {
                let cleanedText = match[1]
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
                currentTextSnapshot += cleanedText;
            }

            if (currentTextSnapshot.length > accumulatedText.length) {
                let newPiece = currentTextSnapshot.substring(accumulatedText.length);
                accumulatedText = currentTextSnapshot;
                onChunkReceived(newPiece);
            }
        }
        onDone(accumulatedText);

    } catch (e) {
        console.error(e);
        onError("❌ การเชื่อมต่อล้มเหลว คีย์อาจไม่ถูกต้อง หรือเน็ตเวิร์กขัดข้องชั่วคราวค่ะ");
    }
}

function toggleAiSidebar() {
    const sidebar = document.getElementById('ai-sidebar');
    if (sidebar) sidebar.classList.toggle('open');
}

async function sendAiQuestion() {
    const input = document.getElementById('ai-input'); if (!input) return;
    const userText = input.value.trim(); if (!userText) return;

    appendAiMessage("user", userText); input.value = '';
    saveChatToLocalStorage(); 
    
    let pageText = "";
    const activePage = getActivePageWrapper();
    if (activePage) activePage.querySelectorAll('.word-text-node').forEach(node => pageText += node.innerText + " ");

    appendAiMessage("system", "⚡ กำลังอ่านวิเคราะห์ข้อมูลและรูปภาพหน้าจอให้คุณนาวีค่ะ...");

    const base64Screen = await captureActivePageBase64();

    let currentTurnParts = [];
    if (base64Screen) {
        currentTurnParts.push({
            inline_data: { mime_type: "image/jpeg", data: base64Screen }
        });
    }

    let finalPrompt = pageText.trim() !== "" ? 
        `ข้อมูลตัวหนังสือที่อ่านได้จากเอกสารหน้าปัจจุบัน:\n"""\n${pageText}\n"""\nคำถามเพิ่มเติมจากผู้ใช้: ${userText}\n(คำแนะนำสำหรับ AI: จงดูภาพถ่ายหน้าจอประกอบควบคู่กับตัวหนังสือ เพื่อตรวจสอบตาราง รูปวาดเขียน ไฮไลต์ หรือจุดที่ผู้ใช้วงไว้ แล้วอธิบายเป็นภาษาไทยอย่างกระชับและเป็นมิตร)` : userText;

    currentTurnParts.push({ text: finalPrompt });

    geminiChatHistory.push({ role: "user", parts: currentTurnParts });

    const aiMessageDiv = createStreamingAiMessageElement();

    await streamGeminiPayload(geminiChatHistory, 
        (newChunk) => {
            if (aiMessageDiv) {
                aiMessageDiv.innerText += newChunk;
                const chatBox = document.getElementById('ai-chat-box');
                if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
                saveChatToLocalStorage(); 
            }
        },
        (fullResponseText) => {
            geminiChatHistory.push({ role: "model", parts: [{ text: fullResponseText }] });
            saveChatToLocalStorage(); 
        },
        (errorMsg) => {
            if (aiMessageDiv) {
                aiMessageDiv.innerText = errorMsg;
                saveChatToLocalStorage();
            }
        }
    );
}

async function askAiToSummary() {
    appendAiMessage("user", "โปรดสรุปข้อมูลหน้านี้ให้ทีครับ");
    saveChatToLocalStorage();
    
    let pageText = "";
    const activePage = getActivePageWrapper();
    if (activePage) activePage.querySelectorAll('.word-text-node').forEach(node => pageText += node.innerText + " ");
    
    appendAiMessage("system", "⚡ กำลังสแกนโครงสร้างหน้าจอรวมถึงรอยปากกาไฮไลต์เพื่อสรุปผลค่ะ...");

    const base64Screen = await captureActivePageBase64();

    let currentTurnParts = [];
    if (base64Screen) {
        currentTurnParts.push({
            inline_data: { mime_type: "image/jpeg", data: base64Screen }
        });
    }

    const prompt = `จงสรุปสาระสำคัญ ตัวเลข ผลลัพธ์ หรือตารางข้อมูลจากรายงานหน้านี้อย่างเป็นขั้นเป็นตอนและถูกต้องสูงสุด หากบนหน้าจอมีโครงสร้างภาพ แผนภูมิ หรือรอยเขียนปากกา/ยางลบลบข้อความใดๆ ให้รวมองค์ประกอบภาพเหล่านั้นมาวิเคราะห์ร่วมด้วยอย่างมีหลักการ:\n"""\n${pageText}\n"""`;
    currentTurnParts.push({ text: prompt });

    geminiChatHistory.push({ role: "user", parts: currentTurnParts });

    const aiMessageDiv = createStreamingAiMessageElement();

    await streamGeminiPayload(geminiChatHistory, 
        (newChunk) => {
            if (aiMessageDiv) {
                aiMessageDiv.innerText += newChunk;
                const chatBox = document.getElementById('ai-chat-box');
                if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
                saveChatToLocalStorage(); 
            }
        },
        (fullResponseText) => {
            geminiChatHistory.push({ role: "model", parts: [{ text: fullResponseText }] });
            saveChatToLocalStorage(); 
        },
        (errorMsg) => {
            if (aiMessageDiv) {
                aiMessageDiv.innerText = errorMsg;
                saveChatToLocalStorage();
            }
        }
    );
}

function createStreamingAiMessageElement() {
    const chatBox = document.getElementById('ai-chat-box'); if (!chatBox) return null;
    const tempStatus = chatBox.querySelector('.temp-status'); if (tempStatus) tempStatus.remove();

    const msgDiv = document.createElement('div'); 
    msgDiv.className = `ai-message ai-msg`;
    msgDiv.innerText = ""; 
    chatBox.appendChild(msgDiv); 
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

function createStreamingAiMessageElement() {
    const chatBox = document.getElementById('ai-chat-box'); if (!chatBox) return null;
    const tempStatus = chatBox.querySelector('.temp-status'); if (tempStatus) tempStatus.remove();

    const msgDiv = document.createElement('div'); 
    msgDiv.className = `ai-message ai-msg`;
    msgDiv.innerText = ""; 
    chatBox.appendChild(msgDiv); 
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

function appendAiMessage(sender, text) {
    const chatBox = document.getElementById('ai-chat-box'); if (!chatBox) return;
    if (sender === 'system') {
        const tempMsg = document.createElement('div');
        tempMsg.className = 'ai-message system-msg temp-status'; tempMsg.innerText = text;
        chatBox.appendChild(tempMsg); chatBox.scrollTop = chatBox.scrollHeight; return;
    }
    const tempStatus = chatBox.querySelector('.temp-status'); if (tempStatus) tempStatus.remove();

    const msgDiv = document.createElement('div'); msgDiv.className = `ai-message ${sender}-msg`;
    msgDiv.innerText = text; chatBox.appendChild(msgDiv); chatBox.scrollTop = chatBox.scrollHeight;
}


// ==========================================================
// 🛡️ [NEW v2.5] ระบบตรวจจับและขอยืนยันการอัปเดตอย่างปลอดภัย (Safe PWA Update)
// ==========================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
    .then(reg => {
        
        function promptUserToUpdate(waitingWorker) {
            const userAccepted = confirm(
                "✨ [Nawee Studio] พบการอัปเดตระบบเวอร์ชันใหม่ล่าสุด!\n\n" +
                "คุณต้องการเปลี่ยนผ่านระบบและเริ่มหน้าแอปใหม่ตอนนี้เลยไหมคะ?\n" +
                "--------------------------------------------------\n" +
                "⚠️ หากคุณกำลังติดงานพิมพ์ วาดแบบ หรือทำงานค้างอยู่ ให้กด 'ยกเลิก (Cancel)' เพื่อเซฟงานก่อนได้ค่ะ ระบบจะไม่รีโหลดจนกว่าคุณจะพร้อม"
            );

            if (userAccepted) {
                waitingWorker.postMessage({ type: 'SKIP_WAITING' });
            }
        }

        if (reg.waiting) {
            promptUserToUpdate(reg.waiting);
        }

        reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            promptUserToUpdate(installingWorker);
                        }
                    }
                };
            }
        };

    }).catch(err => console.error("Service Worker Registration Failed:", err));

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            window.location.reload();
            refreshing = true;
        }
    });
}