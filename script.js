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

document.addEventListener('DOMContentLoaded', () => {
    container = document.getElementById('pdf-container');
    workspace = document.querySelector('.workspace');
    appTitle = document.getElementById('app-title');
    
    const uploadInput = document.getElementById('upload');
    if (uploadInput) {
        uploadInput.addEventListener('change', handleFileOpen);
    }
    
    const colorPicker = document.getElementById('color-picker');
    if (colorPicker) {
        colorPicker.value = currentActiveColor;
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
    
    const textColorPicker = document.getElementById('text-color-picker');
    if (textColorPicker) {
        textColorPicker.value = currentTextActiveColor;
        textColorPicker.addEventListener('input', (e) => {
            currentTextActiveColor = e.target.value;
        });
    }

    const textSizeSlider = document.getElementById('text-size-slider');
    const textSizeLabel = document.getElementById('text-size-val');
    if (textSizeSlider && textSizeLabel) {
        textSizeSlider.addEventListener('input', (e) => {
            currentTextSize = parseInt(e.target.value);
            textSizeLabel.innerText = currentTextSize + 'px';
        });
    }

    updateBrushPreview();
    setTool('pan');
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-wrapper')) {
            closeAllPopups();
        }
    });

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

function updateBrushPreview() {
    const preview = document.getElementById('brush-preview');
    if (preview) {
        preview.style.width = currentBrushSize + 'px';
        preview.style.height = currentBrushSize + 'px';
        preview.style.backgroundColor = currentActiveColor;
    }
}

const DB_NAME = "NaweeStudio_Database_V2";
const STORE_NAME = "DocumentStore";

function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "docName" });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveToDatabase() {
    if (!pdfDoc) {
        alert("ไม่พบข้อมูลเอกสารสำหรับการบันทึกค่ะ!");
        return;
    }
    try {
        const db = await initDatabase();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        
        const drawingsState = [];
        document.querySelectorAll('.drawing-page-canvas').forEach((canvas, idx) => {
            drawingsState.push({
                index: idx,
                dataUrl: canvas.toDataURL()
            });
        });

        const documentState = {
            docName: originalFileName,
            fileMode: currentFileMode,
            containerHTML: container.innerHTML, 
            drawings: drawingsState,
            savedAt: new Date().toISOString()
        };
        
        store.put(documentState);
        alert("บันทึกข้อมูลเรียบร้อยแล้วค่ะ!");
    } catch (error) {
        console.error(error);
        alert("เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูลภายในเครื่องค่ะ");
    }
}

function switchFileMode(mode) {
    currentFileMode = mode;
    currentScale = 1.0; 
    
    if (mode === 'word') {
        document.body.className = "mode-word";
        if (appTitle) appTitle.innerHTML = 'Nawee Word <small class="badge" style="background:#2b579a;">WORD MODE</small>';
        
        document.querySelectorAll('.word-text-node').forEach(node => {
            node.setAttribute('contenteditable', 'true');
        });
    } else {
        document.body.className = "mode-pdf";
        if (appTitle) appTitle.innerHTML = 'Nawee PDF <small class="badge">PDF MODE</small>';
        
        document.querySelectorAll('.word-text-node').forEach(node => {
            node.setAttribute('contenteditable', 'false');
        });
    }
    setTool(currentTool);
    applyZoom();
}

function triggerPdfToWord() {
    closeAllPopups();
    if (!pdfDoc) {
        alert("กรุณาเปิดไฟล์ PDF ก่อนค่ะ!");
        return;
    }
    switchFileMode('word');
}

function triggerWordToPdf() {
    closeAllPopups();
    switchFileMode('pdf');
    alert("ระบบซิงค์ข้อความแก้ไขล่าสุดกลับเข้าสู่เลเยอร์แสดงผลหลักเสร็จสิ้นแล้วค่ะ!");
}

function getPDFOptions() {
    return {
        margin: [0, 0, 0, 0],
        filename: `${originalFileName || 'Nawee_Document'}_Studio_Output.pdf`,
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
        },
        jsPDF: { 
            unit: 'mm', 
            format: 'a4', 
            orientation: 'portrait' 
        },
        pagebreak: { mode: ['css', 'legacy'], before: '.page-wrapper' }
    };
}

async function exportToPDFFile() {
    closeAllPopups();
    if (!pdfDoc) {
        alert("ไม่พบข้อมูลเอกสารเพื่อส่งออกค่ะ!");
        return;
    }
    
    const originalScale = currentScale;
    currentScale = 1.0; 
    applyZoom();

    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        .custom-draggable-text-node { border: none !important; background: transparent !important; }
        .text-node-controls { display: none !important; }
    `;
    document.head.appendChild(styleTag);

    const element = document.getElementById('pdf-container');
    const opt = getPDFOptions();

    html2pdf().set(opt).from(element).save().then(() => {
        styleTag.remove();
        currentScale = originalScale;
        applyZoom();
    });
}

async function shareToLine() {
    closeAllPopups();
    if (!pdfDoc) {
        alert("ไม่พบข้อมูลเอกสารเพื่อส่งออกแชร์ค่ะ!");
        return;
    }

    const originalScale = currentScale;
    currentScale = 1.0; 
    applyZoom();

    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        .custom-draggable-text-node { border: none !important; background: transparent !important; }
        .text-node-controls { display: none !important; }
    `;
    document.head.appendChild(styleTag);

    const element = document.getElementById('pdf-container');
    const opt = getPDFOptions();

    try {
        const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('blob');
        const file = new File([pdfBlob], `${originalFileName}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Nawee Document',
                text: 'ไฟล์ PDF จากแอปพลิเคชันของคุณนาวีค่ะ'
            });
        } else {
            alert("เบราว์เซอร์นี้ไม่รองรับการแชร์ไฟล์โดยตรง ระบบกำลังดาวน์โหลดไฟล์ให้แทนนะคะ");
            html2pdf().set(opt).from(element).save();
        }
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการแชร์:", error);
        html2pdf().set(opt).from(element).save();
    } finally {
        styleTag.remove();
        currentScale = originalScale;
        applyZoom();
    }
}

function formatWord(command, value = null) {
    document.execCommand(command, false, value);
}

function toggleDropdown(menuId) {
    const targetMenu = document.getElementById(menuId);
    if (!targetMenu) return;
    const isOpen = targetMenu.classList.contains('show');
    closeAllPopups();
    if (!isOpen) targetMenu.classList.add('show');
}

function closeAllPopups() {
    document.querySelectorAll('.dropdown-popup').forEach(m => m.classList.remove('show'));
}

async function handleFileOpen(e) {
    try {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!pdfjsLib) {
            alert("ไม่สามารถเปิดไฟล์ได้เนื่องจากหาตัวแปรไลบรารี PDF.js ไม่พบค่ะ");
            return;
        }

        originalFileName = file.name.replace(/\.[^/.]+$/, ""); 
        const arrayBuffer = await file.arrayBuffer();
        
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        pdfDoc = await loadingTask.promise;
        
        container.innerHTML = '';
        currentScale = 1.0;
        applyZoom();

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 3.0 }); 

            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-wrapper';
            pageWrapper.style.width = (viewport.width / 2) + 'px';
            pageWrapper.style.height = (viewport.height / 2) + 'px';

            const pdfCanvas = document.createElement('canvas');
            pdfCanvas.className = 'pdf-page-canvas';
            pdfCanvas.width = viewport.width;
            pdfCanvas.height = viewport.height;
            pageWrapper.appendChild(pdfCanvas);

            const drawingCanvas = document.createElement('canvas');
            drawingCanvas.className = 'drawing-page-canvas';
            drawingCanvas.width = viewport.width;
            drawingCanvas.height = viewport.height;
            pageWrapper.appendChild(drawingCanvas);

            const textOverlayLayer = document.createElement('div');
            textOverlayLayer.className = 'text-overlay-layer';
            pageWrapper.appendChild(textOverlayLayer);

            container.appendChild(pageWrapper);

            await page.render({ 
                canvasContext: pdfCanvas.getContext('2d'), 
                viewport: viewport 
            }).promise;

            const displayViewport = page.getViewport({ scale: 1.5 });
            const textContent = await page.getTextContent();
            
            textContent.items.forEach(item => {
                if (!item.str || item.str.trim() === "") return;
                
                const [left, txY] = displayViewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                const fontHeight = Math.abs(item.transform[3]) * 1.5; 
                const top = txY - fontHeight;

                const textNode = document.createElement('div');
                textNode.className = 'word-text-node';
                textNode.setAttribute('contenteditable', 'false');
                textNode.style.left = left + 'px';
                textNode.style.top = top + 'px';
                textNode.style.fontSize = fontHeight + 'px';
                
                const calculatedWidth = item.width * 1.5;
                if (calculatedWidth > 0) {
                    textNode.style.width = calculatedWidth + 'px';
                }
                
                textNode.innerText = item.str;

                textNode.addEventListener('input', () => {
                    textNode.classList.add('is-edited');
                });

                textOverlayLayer.appendChild(textNode);
            });

            bindDrawingEngine(drawingCanvas);
        }
        
        switchFileMode(currentFileMode);
    } catch (error) {
        console.error("Error loading PDF: ", error);
        alert("เกิดข้อผิดพลาดในการอ่านไฟล์ PDF: " + error.message);
    }
}

function bindDrawingEngine(canvas) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0, lastY = 0;

    if (!canvas.undoStack) {
        canvas.undoStack = [canvas.toDataURL()];
        canvas.redoStack = [];
    }

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
        if (currentTool === 'pan' || currentTool === 'text' || (e.touches && e.touches.length > 1)) return;
        const coords = getCoords(e);
        isDrawing = true;
        lastX = coords.x;
        lastY = coords.y;
    }

    function moveAction(e) {
        if (!isDrawing || currentTool === 'pan' || currentTool === 'text' || (e.touches && e.touches.length > 1)) return;
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
            ctx.lineWidth = 60;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
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
        if (ev.touches.length === 2) return; 
        if (currentTool !== 'pan' && currentTool !== 'text') startAction(ev); 
    }, {passive: true});
    
    canvas.addEventListener('touchmove', (ev) => { 
        if (ev.touches.length === 2) return; 
        if (currentTool !== 'pan' && currentTool !== 'text') { 
            ev.preventDefault(); 
            moveAction(ev); 
        } 
    }, {passive: false});
    
    canvas.addEventListener('touchend', stopAction);
}

function undoAction() {
    const activePage = getActivePageWrapper();
    if (!activePage) return;
    const canvas = activePage.querySelector('.drawing-page-canvas');
    if (canvas && canvas.undoStack && canvas.undoStack.length > 1) {
        const current = canvas.undoStack.pop();
        canvas.redoStack.push(current);
        const prevState = canvas.undoStack[canvas.undoStack.length - 1];
        
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = prevState;
    }
}

function redoAction() {
    const activePage = getActivePageWrapper();
    if (!activePage) return;
    const canvas = activePage.querySelector('.drawing-page-canvas');
    if (canvas && canvas.redoStack && canvas.redoStack.length > 0) {
        const nextState = canvas.redoStack.pop();
        canvas.undoStack.push(nextState);
        
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = nextState;
    }
}

function getActivePageWrapper() {
    const wrappers = document.querySelectorAll('.page-wrapper');
    if (wrappers.length === 0) return null;
    const workspaceRect = workspace.getBoundingClientRect();
    const workspaceCenter = workspaceRect.top + workspaceRect.height / 2;
    
    let closestWrapper = wrappers[0];
    let minDistance = Infinity;
    
    wrappers.forEach(wrapper => {
        const rect = wrapper.getBoundingClientRect();
        const wrapperCenter = rect.top + rect.height / 2;
        const distance = Math.abs(wrapperCenter - workspaceCenter);
        if (distance < minDistance) {
            minDistance = distance;
            closestWrapper = wrapper;
        }
    });
    return closestWrapper;
}

function navigatePage(direction) {
    const wrappers = document.querySelectorAll('.page-wrapper');
    if (wrappers.length === 0) return;
    
    const currentActive = getActivePageWrapper();
    if (!currentActive) return;
    
    let currentIndex = Array.from(wrappers).indexOf(currentActive);
    
    if (direction === 'next') {
        if (currentIndex < wrappers.length - 1) {
            wrappers[currentIndex + 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } else if (direction === 'prev') {
        if (currentIndex > 0) {
            wrappers[currentIndex - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

function openCenterTextInput() {
    const existingModal = document.getElementById('center-text-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'center-text-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px);
        display: flex; justify-content: center; align-items: center; z-index: 20000;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #1e293b; padding: 20px; border-radius: 12px;
        border: 1px solid var(--accent-color); width: 90%; max-width: 420px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 14px;
    `;

    const title = document.createElement('div');
    title.innerHTML = '<i class="fa-solid fa-font"></i> แทรกข้อความลอยอิสระ';
    title.style.cssText = 'color: #fff; font-weight: bold; font-size: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'พิมพ์ข้อความที่ต้องการแทรกตรงนี้...';
    textarea.style.cssText = `
        background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px; padding: 12px; height: 130px; resize: none;
        outline: none; font-family: sans-serif; font-size: 15px; line-height: 1.5;
    `;

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'ยกเลิก';
    cancelBtn.style.cssText = 'background: #334155; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-size: 14px;';
    cancelBtn.onclick = () => { modal.remove(); setTool('pan'); };

    const confirmBtn = document.createElement('button');
    confirmBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> วางข้อความ';
    confirmBtn.style.cssText = 'background: var(--accent-color); color: #0f172a; border: none; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;';
    
    confirmBtn.onclick = () => {
        const text = textarea.value.trim();
        if (text) {
            createNewDraggableText(text);
        }
        modal.remove();
        setTool('pan'); 
    };

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(confirmBtn);
    box.appendChild(title);
    box.appendChild(textarea);
    box.appendChild(btnGroup);
    modal.appendChild(box);
    document.body.appendChild(modal);

    setTimeout(() => textarea.focus(), 50);
}

function createNewDraggableText(text) {
    const activePage = getActivePageWrapper();
    if (!activePage) {
        alert("ไม่พบหน้าเอกสารหลักสำหรับวางข้อความค่ะ กรุณาเปิดไฟล์ก่อนนะคะ");
        return;
    }
    const overlayLayer = activePage.querySelector('.text-overlay-layer');
    if (!overlayLayer) return;

    const node = document.createElement('div');
    node.className = 'custom-draggable-text-node';
    
    const textSpan = document.createElement('span');
    textSpan.innerText = text;
    node.appendChild(textSpan);

    const workspaceRect = workspace.getBoundingClientRect();
    const overlayRect = overlayLayer.getBoundingClientRect();
    const clientX = workspaceRect.left + workspaceRect.width / 2;
    const clientY = workspaceRect.top + workspaceRect.height / 2;
    const left = (clientX - overlayRect.left) / currentScale;
    const top = (clientY - overlayRect.top) / currentScale;

    node.style.cssText = `
        position: absolute; left: ${left}px; top: ${top}px;
        font-size: ${currentTextSize}px; color: ${currentTextActiveColor}; font-family: 'Sarabun', sans-serif;
        white-space: pre-wrap; cursor: move; user-select: none; touch-action: none;
        padding: 6px 10px; border: 1px dashed ${currentTextActiveColor}; border-radius: 6px;
        display: inline-block; transform: translate(-50%, -50%); 
        background: transparent; 
        z-index: 5000;
    `;

    const controlBar = document.createElement('div');
    controlBar.className = 'text-node-controls';
    controlBar.style.cssText = `
        position: absolute; top: -36px; left: 50%; transform: translateX(-50%);
        background: #1e293b; border: 1px solid ${currentTextActiveColor}; border-radius: 6px;
        display: flex; gap: 6px; padding: 4px; z-index: 6000; box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        align-items: center;
    `;

    const commitBtn = document.createElement('button');
    commitBtn.innerHTML = '<i class="fa-solid fa-square-check" style="color: #22c55e;"></i>';
    commitBtn.style.cssText = 'background:none; border:none; padding:2px; cursor:pointer; font-size:16px;';
    commitBtn.title = "ยืนยันล็อกตำแหน่งฝังข้อความ";
    commitBtn.onclick = (e) => {
        e.stopPropagation();
        controlBar.remove();
        node.style.border = 'none';
        node.style.background = 'transparent';
        node.style.cursor = 'default';
        node.style.touchAction = 'auto';
        node.onmousedown = null;
        node.ontouchstart = null;
    };

    const nodeColorPicker = document.createElement('input');
    nodeColorPicker.type = 'color';
    nodeColorPicker.value = currentTextActiveColor;
    nodeColorPicker.style.cssText = 'width:20px; height:20px; border:none; padding:0; cursor:pointer; background:transparent;';
    nodeColorPicker.title = "ปรับเปลี่ยนสีข้อความลอยชิ้นนี้";
    
    nodeColorPicker.oninput = (e) => {
        node.style.color = e.target.value;
        node.style.borderColor = e.target.value;
    };

    const sizeUpBtn = document.createElement('button');
    sizeUpBtn.innerHTML = '<i class="fa-solid fa-plus" style="color:#22d3ee;"></i>';
    sizeUpBtn.style.cssText = 'background:none; border:none; padding:2px; cursor:pointer; font-size:14px;';
    sizeUpBtn.onclick = (e) => {
        e.stopPropagation();
        let currentSize = parseFloat(node.style.fontSize) || 24;
        node.style.fontSize = (currentSize + 3) + 'px';
    };

    const sizeDownBtn = document.createElement('button');
    sizeDownBtn.innerHTML = '<i class="fa-solid fa-minus" style="color:#22d3ee;"></i>';
    sizeDownBtn.style.cssText = 'background:none; border:none; padding:2px; cursor:pointer; font-size:14px;';
    sizeDownBtn.onclick = (e) => {
        e.stopPropagation();
        let currentSize = parseFloat(node.style.fontSize) || 24;
        if (currentSize > 8) node.style.fontSize = (currentSize - 3) + 'px';
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can" style="color:#ef4444;"></i>';
    deleteBtn.style.cssText = 'background:none; border:none; padding:2px; cursor:pointer; font-size:14px;';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if(confirm("ต้องการลบข้อความชิ้นนี้ใช่ไหมคะ?")) node.remove();
    };

    controlBar.appendChild(commitBtn);
    controlBar.appendChild(nodeColorPicker);
    controlBar.appendChild(sizeUpBtn);
    controlBar.appendChild(sizeDownBtn);
    controlBar.appendChild(deleteBtn);
    node.appendChild(controlBar);

    let isDraggingNode = false;
    let startX, startY;
    let initialLeft, initialTop;

    const dragStart = (e) => {
        if (e.target.closest('.text-node-controls') || (e.touches && e.touches.length === 2)) return;
        e.stopPropagation();
        if (e.type === 'touchstart') e.preventDefault();

        isDraggingNode = true;
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;

        initialLeft = parseFloat(node.style.left) || left;
        initialTop = parseFloat(node.style.top) || top;

        document.addEventListener('mousemove', dragMove, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('touchend', dragEnd);
    };

    const dragMove = (e) => {
        if (!isDraggingNode) return;
        e.stopPropagation();
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const dx = (touch.clientX - startX) / currentScale;
        const dy = (touch.clientY - startY) / currentScale;

        node.style.left = (initialLeft + dx) + 'px';
        node.style.top = (initialTop + dy) + 'px';
    };

    const dragEnd = () => {
        isDraggingNode = false;
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchmove', dragMove);
        document.removeEventListener('touchend', dragEnd);
    };

    node.addEventListener('mousedown', dragStart);
    node.addEventListener('touchstart', dragStart, { passive: false });

    node.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!node.querySelector('.text-node-controls')) return; 
        const newText = prompt("แก้ไขเนื้อหาข้อความลอย:", textSpan.innerText);
        if (newText !== null) {
            if (newText.trim() === "") node.remove();
            else textSpan.innerText = newText;
        }
    });

    overlayLayer.appendChild(node);
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const penPanel = document.getElementById('pen-settings-panel');
    const textPanel = document.getElementById('text-settings-panel');
    
    if (penPanel) {
        penPanel.style.display = (currentTool === 'pen') ? 'flex' : 'none';
    }
    if (textPanel) {
        textPanel.style.display = (currentTool === 'text') ? 'flex' : 'none';
    }
    
    if (workspace) {
        if (currentTool === 'pan') {
            workspace.style.cursor = 'grab';
            workspace.style.overflow = 'auto';
        } else {
            workspace.style.cursor = currentTool === 'pen' ? 'crosshair' : (currentTool === 'eraser' ? 'cell' : 'text');
            workspace.style.overflow = 'hidden';
            if (currentTool === 'text') openCenterTextInput();
        }
    }
}

function zoom(direction) {
    if (direction === 'in') {
        currentScale += 0.2;
    } else if (direction === 'out') {
        currentScale = Math.max(0.4, currentScale - 0.2);
    }
    applyZoom();
}

function applyZoom() {
    if (container) {
        container.style.transform = `scale(${currentScale})`;
    }
}
