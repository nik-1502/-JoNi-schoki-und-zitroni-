document.addEventListener('DOMContentLoaded', () => {
    // Führe die App aus, wenn Canvas vorhanden ist (jetzt auf index.html)
    if (document.getElementById('niklas-canvas')) {
        initPaintApp();
        initDashboard();
    }
    if (document.getElementById('quiz-wrapper-niklas')) {
        initQuizApp();
    }
});

function initDashboard() {
    // --- Text Chat Logik ---
    const textAreas = {
        niklas: document.getElementById('niklas-text'),
        jovelyn: document.getElementById('jovelyn-text')
    };

    function saveText(user) {
        const text = textAreas[user].value;
        localStorage.setItem(`${user}_text`, text);
    }

    function loadText(user) {
        const text = localStorage.getItem(`${user}_text`);
        if (text !== null) textAreas[user].value = text;
    }

    // Event Listener für Text
    Object.keys(textAreas).forEach(user => {
        textAreas[user].addEventListener('input', () => saveText(user));
        loadText(user); // Beim Start laden
    });

    // --- Storage Event für Live-Sync (Text & GIFs) ---
    window.addEventListener('storage', (e) => {
        if (e.key.endsWith('_text')) {
            const user = e.key.split('_')[0];
            if (textAreas[user]) loadText(user);
        }
    });

    // --- NEU: Regelmäßiges Neuladen (Polling) ---
    // Prüft alle 2 Sekunden auf neue Texte, falls die 'storage' Events klemmen (häufig bei iOS PWAs)
    setInterval(() => {
        Object.keys(textAreas).forEach(user => {
            // Nur aktualisieren, wenn man gerade NICHT selbst in dieses Feld schreibt
            if (document.activeElement !== textAreas[user]) {
                loadText(user);
            }
        });
    }, 2000);

    // Update beim Wechseln des Tabs oder Öffnen der App
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            Object.keys(textAreas).forEach(user => loadText(user));
        }
    });
    window.addEventListener('focus', () => {
        Object.keys(textAreas).forEach(user => loadText(user));
    });
}

function initPaintApp() {
    // --- Canvas-Setup ---
    const myCanvas = document.getElementById('niklas-canvas');
    const friendCanvas = document.getElementById('jovelyn-canvas');
    const wrapperNiklas = document.getElementById('wrapper-niklas');
    const wrapperJovelyn = document.getElementById('wrapper-jovelyn');
    const myCtx = myCanvas.getContext('2d');
    const friendCtx = friendCanvas.getContext('2d');

    // Unterscheidung: Startseite vs. Tier-des-Tages (getrennte Speicherung)
    const isDailyPage = document.body.classList.contains('paint-page');
    const keySuffix = isDailyPage ? '_daily' : '';

    // --- Zoom Helper & State ---
    let isZooming = false;
    let zoomState = { startDist: 0, startScale: 1, startX: 0, startY: 0, initialTx: 0, initialTy: 0 };

    function getDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function updateCanvasTransform(canvas, x, y, scale) {
        canvas.style.transformOrigin = '0 0';
        canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        canvas.dataset.scale = scale;
        canvas.dataset.tx = x;
        canvas.dataset.ty = y;
    }

    function resetZoom(canvas) {
        canvas.style.transform = '';
        delete canvas.dataset.scale;
        delete canvas.dataset.tx;
        delete canvas.dataset.ty;
    }

    // Canvas-Größe an den Container anpassen
    function resizeCanvases() {
        const pixelRatio = 2; // Erhöhte Auflösung für feineres Malen

        [myCanvas, friendCanvas].forEach(canvas => {
            const wrapper = canvas.parentElement;
            const infoHeight = canvas.previousElementSibling ? canvas.previousElementSibling.offsetHeight : 0;
            
            const displayWidth = wrapper.clientWidth;
            const displayHeight = wrapper.clientHeight - infoHeight;

            const newWidth = Math.floor(displayWidth * pixelRatio);
            const newHeight = Math.floor(displayHeight * pixelRatio);

            if (canvas.width !== newWidth || canvas.height !== newHeight) {
                canvas.width = newWidth;
                canvas.height = newHeight;
                resetZoom(canvas); // Zoom zurücksetzen bei Größenänderung
            }
        });
        // Gespeicherte Bilder nach Größenänderung neu laden
        drawFromStorage('niklas');
        drawFromStorage('jovelyn');
    }

    window.addEventListener('resize', resizeCanvases);

    // --- Zeichenstatus ---
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let activeUser = null; // 'niklas' oder 'jovelyn'
    
    // Geräte-ID für Status-Logik (Erstellt eine zufällige ID pro Browser)
    const deviceId = localStorage.getItem('deviceId') || Math.random().toString(36).substr(2, 9);
    localStorage.setItem('deviceId', deviceId);

    // --- Pinsel- & Farbeinstellungen ---
    let brushSize = 5;
    let brushOpacity = 1;
    let brushColor = '#000000';
    let isFillMode = false;
    let isEraser = false;
    let eraserSize = 20;
    let eraserOpacity = 1;
    let isEraserFillMode = false;

    // Cache für den letzten Zeichenstatus, um Flackern beim Neuladen zu verhindern
    const lastDrawState = { niklas: null, jovelyn: null };

    // --- History für Undo/Redo ---
    const history = {
        niklas: { undo: [], redo: [] },
        jovelyn: { undo: [], redo: [] }
    };

    // --- DOM-Elemente ---
    const brushBtn = document.getElementById('brush-btn');
    const eraserBtn = document.getElementById('eraser-btn');
    const colorBtn = document.getElementById('color-btn');
    const saveBtn = document.getElementById('save-btn');
    const clearBtn = document.getElementById('clear-btn');
    const closeFullscreenBtn = document.getElementById('close-fullscreen-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const brushPanel = document.getElementById('brush-panel');
    const eraserPanel = document.getElementById('eraser-panel');
    const colorPanel = document.getElementById('color-panel');
    const brushBackBtn = document.getElementById('brush-back-btn');
    const eraserBackBtn = document.getElementById('eraser-back-btn');
    const colorBackBtn = document.getElementById('color-back-btn');
    const brushSizeSlider = document.getElementById('brush-size');
    const brushSizeValue = document.getElementById('brush-size-value');
    const brushOpacitySlider = document.getElementById('brush-opacity');
    const brushOpacityValue = document.getElementById('brush-opacity-value');
    const fillToggle = document.getElementById('fill-toggle');
    const eraserSizeSlider = document.getElementById('eraser-size');
    const eraserSizeValue = document.getElementById('eraser-size-value');
    const eraserOpacitySlider = document.getElementById('eraser-opacity');
    const eraserOpacityValue = document.getElementById('eraser-opacity-value');
    const eraserFillToggle = document.getElementById('eraser-fill-toggle');
    const colorPalette = document.getElementById('color-palette');
    const customColorPicker = document.getElementById('custom-color');

    // --- Zeichenfunktionen ---
    function getEventPosition(canvas, e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function startDrawing(e) {
        // Nur malen, wenn wir im Fullscreen sind und auf dem richtigen Canvas
        if (!document.body.classList.contains('mode-fullscreen')) return;
        
        // --- Zoom Start (2 Finger) ---
        if (e.touches && e.touches.length === 2) {
            isDrawing = false;
            isZooming = true;
            
            const dist = getDistance(e.touches);
            const center = getCenter(e.touches);
            const canvas = e.target;
            
            const currentScale = parseFloat(canvas.dataset.scale) || 1;
            const currentTx = parseFloat(canvas.dataset.tx) || 0;
            const currentTy = parseFloat(canvas.dataset.ty) || 0;
            
            zoomState.startDist = dist;
            zoomState.startScale = currentScale;
            zoomState.startX = center.x;
            zoomState.startY = center.y;
            zoomState.initialTx = currentTx;
            zoomState.initialTy = currentTy;
            return;
        }
        if (isZooming) return; // Nicht malen, wenn gezoomt wird

        const canvas = e.target; // Das Canvas, auf das geklickt wurde
        const pos = getEventPosition(canvas, e);

        // Füll-Modus Logik
        if ((!isEraser && isFillMode) || (isEraser && isEraserFillMode)) {
            if (activeUser) {
                if (history[activeUser].undo.length > 20) history[activeUser].undo.shift();
                history[activeUser].undo.push(canvas.toDataURL());
                history[activeUser].redo = [];
            }
            floodFill(canvas, Math.floor(pos.x), Math.floor(pos.y), brushColor, isEraser);
            return; // Nicht zeichnen, wenn gefüllt wird
        }

        isDrawing = true;
        [lastX, lastY] = [pos.x, pos.y];

        // Zustand speichern für Undo (bevor der neue Strich beginnt)
        if (activeUser) {
            // Begrenzen auf z.B. 20 Schritte um Speicher zu sparen
            if (history[activeUser].undo.length > 20) history[activeUser].undo.shift();
            history[activeUser].undo.push(canvas.toDataURL());
            history[activeUser].redo = []; // Redo-Stack leeren bei neuer Aktion
        }
    }

    function draw(e) {
        // --- Zoom Move ---
        if (isZooming && e.touches && e.touches.length === 2) {
            e.preventDefault();
            const dist = getDistance(e.touches);
            const center = getCenter(e.touches);
            const canvas = e.target;
            
            const scaleMultiplier = dist / zoomState.startDist;
            let newScale = zoomState.startScale * scaleMultiplier;
            newScale = Math.max(1, Math.min(newScale, 5)); // Limit 1x - 5x
            
            // Berechnung der Verschiebung, damit der Punkt zwischen den Fingern fix bleibt
            const startCenterCanvasX = (zoomState.startX - zoomState.initialTx) / zoomState.startScale;
            const startCenterCanvasY = (zoomState.startY - zoomState.initialTy) / zoomState.startScale;
            
            let newTx = center.x - startCenterCanvasX * newScale;
            let newTy = center.y - startCenterCanvasY * newScale;
            
            // Zurücksetzen auf 100% wenn nahe dran
            if (newScale < 1.05) {
                newScale = 1;
                newTx = 0;
                newTy = 0;
            }
            
            updateCanvasTransform(canvas, newTx, newTy, newScale);
            return;
        }

        if (!isDrawing) return;
        e.preventDefault(); // Verhindert Scrollen während des Zeichnens

        const canvas = e.target;
        const ctx = canvas.getContext('2d');
        const pos = getEventPosition(canvas, e);
        
        // Harte Kanten Logik (Pixel-Art Style)
        const x1 = lastX;
        const y1 = lastY;
        const x2 = pos.x;
        const y2 = pos.y;
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        ctx.save(); // Zustand speichern (für Composite Operation)
        
        if (isEraser) {
            ctx.globalCompositeOperation = 'destination-out'; // Radieren (Transparent machen)
        }

        ctx.fillStyle = brushColor;
        ctx.globalAlpha = isEraser ? eraserOpacity : brushOpacity;
        // Bei Radierer ist die Farbe egal, aber Alpha steuert wie stark radiert wird

        // Interpolation: Wir zeichnen Quadrate entlang der Strecke
        const steps = Math.max(Math.ceil(distance), 1);
        const xInc = dx / steps;
        const yInc = dy / steps;
        
        const currentSize = isEraser ? eraserSize : brushSize;

        for (let i = 0; i <= steps; i++) {
            const x = x1 + xInc * i;
            const y = y1 + yInc * i;
            
            // fillRect erzeugt harte Kanten (kein Anti-Aliasing)
            ctx.fillRect(
                Math.round(x - currentSize / 2), 
                Math.round(y - currentSize / 2), 
                currentSize, 
                currentSize
            );
        }
        
        ctx.restore(); // Zustand wiederherstellen (damit nächstes Mal normal gemalt wird)
        [lastX, lastY] = [pos.x, pos.y];
    }

    function stopDrawing(e) {
        if (isZooming && (!e.touches || e.touches.length < 2)) {
            isZooming = false;
            return;
        }
        if (!isDrawing) return;
        isDrawing = false;
        // Pfad beenden nicht zwingend nötig bei dieser Logik, aber sauber
    }

    // --- Flood Fill Algorithmus ---
    function floodFill(canvas, startX, startY, colorHex, erase = false) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Hex zu RGB + Opacity
        const r = parseInt(colorHex.slice(1, 3), 16);
        const g = parseInt(colorHex.slice(3, 5), 16);
        const b = parseInt(colorHex.slice(5, 7), 16);
        const a = Math.round((erase ? eraserOpacity : brushOpacity) * 255);

        // Startfarbe ermitteln
        const startPos = (startY * width + startX) * 4;
        const startR = data[startPos];
        const startG = data[startPos + 1];
        const startB = data[startPos + 2];
        const startA = data[startPos + 3];

        // Abbruch, wenn Farbe identisch
        if (!erase && startR === r && startG === g && startB === b && startA === a) return;
        if (erase && startA === 0) return; // Bereits transparent

        // Toleranz für Anti-Aliasing (Lücken vermeiden)
        const tolerance = 60; 

        const stack = [[startX, startY]];
        const visited = new Uint8Array(width * height); // Verhindert Endlosschleifen
        
        while (stack.length) {
            const [x, y] = stack.pop();
            const pixelIndex = y * width + x;
            
            if (visited[pixelIndex]) continue;
            
            const pos = pixelIndex * 4;

            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            
            // Prüfen ob Pixel innerhalb der Toleranz zur Startfarbe liegt
            const matchesStartColor = Math.abs(data[pos] - startR) <= tolerance &&
                Math.abs(data[pos + 1] - startG) <= tolerance &&
                Math.abs(data[pos + 2] - startB) <= tolerance &&
                Math.abs(data[pos + 3] - startA) <= tolerance;

            if (matchesStartColor) {
                
                if (erase) {
                    data[pos + 3] = 0; // Transparent machen
                } else {
                    data[pos] = r;
                    data[pos + 1] = g;
                    data[pos + 2] = b;
                    data[pos + 3] = a;
                }
                
                visited[pixelIndex] = 1;

                stack.push([x + 1, y]);
                stack.push([x - 1, y]);
                stack.push([x, y + 1]);
                stack.push([x, y - 1]);
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // --- Event-Listener für das Zeichnen ---
    [myCanvas, friendCanvas].forEach(canvas => {
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);
        
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
    });

    // --- Panel-Sichtbarkeit ---
    function togglePanel(panel, show) {
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            if (show) {
                panel.classList.remove('hidden');
                document.body.classList.add('has-open-panel');
            } else {
                panel.classList.add('hidden');
                document.body.classList.remove('has-open-panel');
            }
        } else { // Desktop
            document.querySelectorAll('.panel').forEach(p => {
                if (p !== panel) p.classList.remove('visible');
            });
            if (show) {
                panel.classList.toggle('visible');
            } else {
                panel.classList.remove('visible');
            }
        }
    }

    // Helper für Touch-Support auf Buttons
    function addTouchBtn(elem, callback) {
        elem.addEventListener('click', callback);
        // touchstart entfernt, da dies auf iOS oft zu Problemen führt.
        // 'click' ist dank user-scalable=no schnell genug und zuverlässiger.
    }

    addTouchBtn(brushBtn, (e) => { 
        e.stopPropagation(); 
        isEraser = false; // Zurück zum Pinsel-Modus
        togglePanel(brushPanel, true); 
        if (eraserPanel) togglePanel(eraserPanel, false);
        if (colorPanel) togglePanel(colorPanel, false);
        // Optional: Visuelles Feedback entfernen
        if (eraserBtn) eraserBtn.style.backgroundColor = '';
        brushBtn.style.backgroundColor = '#ccc';
    });

    if (eraserBtn) {
        addTouchBtn(eraserBtn, (e) => {
            e.stopPropagation();
            isEraser = true; // Radierer aktivieren
            togglePanel(eraserPanel, true);
            togglePanel(brushPanel, false);
            togglePanel(colorPanel, false);
            // Visuelles Feedback
            eraserBtn.style.backgroundColor = '#ccc';
            brushBtn.style.backgroundColor = '';
        });
    }

    addTouchBtn(colorBtn, (e) => { e.stopPropagation(); togglePanel(colorPanel, true); });
    addTouchBtn(brushBackBtn, () => togglePanel(brushPanel, false));
    if (eraserBackBtn) addTouchBtn(eraserBackBtn, () => togglePanel(eraserPanel, false));
    addTouchBtn(colorBackBtn, () => togglePanel(colorPanel, false));
    
    // --- Undo / Redo Funktionen ---
    function performUndo() {
        if (!activeUser || history[activeUser].undo.length === 0) return;
        
        const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
        const ctx = canvas.getContext('2d');
        
        // Aktuellen Stand in Redo speichern
        history[activeUser].redo.push(canvas.toDataURL());
        
        // Letzten Stand aus Undo holen
        const prevState = history[activeUser].undo.pop();
        const img = new Image();
        img.src = prevState;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
    }

    function performRedo() {
        if (!activeUser || history[activeUser].redo.length === 0) return;

        const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
        const ctx = canvas.getContext('2d');

        // Aktuellen Stand in Undo speichern
        history[activeUser].undo.push(canvas.toDataURL());

        // Letzten Stand aus Redo holen
        const nextState = history[activeUser].redo.pop();
        const img = new Image();
        img.src = nextState;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
    }

    if (undoBtn) addTouchBtn(undoBtn, performUndo);
    if (redoBtn) addTouchBtn(redoBtn, performRedo);

    document.body.addEventListener('click', (e) => {
        if (window.innerWidth >= 768) {
            if (!e.target.closest('.panel')) {
                togglePanel(brushPanel, false);
                if (eraserPanel) togglePanel(eraserPanel, false);
                togglePanel(colorPanel, false);
            }
        }
    });

    // --- Pinsel-Einstellungen ---
    brushSizeSlider.addEventListener('input', (e) => {
        brushSize = e.target.value;
        brushSizeValue.textContent = brushSize;
    });

    brushOpacitySlider.addEventListener('input', (e) => {
        brushOpacity = parseFloat(e.target.value);
        brushOpacityValue.textContent = brushOpacity.toFixed(1);
    });

    // --- Radierer-Einstellungen ---
    if (eraserSizeSlider) {
        eraserSizeSlider.addEventListener('input', (e) => {
            eraserSize = e.target.value;
            eraserSizeValue.textContent = eraserSize;
        });
    }
    if (eraserOpacitySlider) {
        eraserOpacitySlider.addEventListener('input', (e) => {
            eraserOpacity = parseFloat(e.target.value);
            eraserOpacityValue.textContent = eraserOpacity.toFixed(1);
        });
    }

    if (fillToggle) {
        fillToggle.addEventListener('change', (e) => {
            isFillMode = e.target.checked;
        });
    }
    if (eraserFillToggle) {
        eraserFillToggle.addEventListener('change', (e) => {
            isEraserFillMode = e.target.checked;
        });
    }

    // --- Custom Color Picker ---
    if (customColorPicker) {
        customColorPicker.addEventListener('input', (e) => {
            brushColor = e.target.value;
            // Markierung von Presets entfernen
            const currentSelected = colorPalette.querySelector('.selected');
            if (currentSelected) currentSelected.classList.remove('selected');
        });
    }

    // --- Farbpaletten-Generierung ---
    function generateColors() {
        // 10 Grundfarben (Spalten)
        const baseColors = [
            '#808080', // Grau
            '#ff0000', // Rot
            '#ff7f00', // Orange
            '#ffff00', // Gelb
            '#00ff00', // Grün
            '#00ffff', // Cyan
            '#0000ff', // Blau
            '#8a2be2', // Violett
            '#ff00ff', // Magenta
            '#8b4513'  // Braun
        ];
        
        // 7 Helligkeitsstufen (Reihen): von Hell (+0.6) bis Dunkel (-0.6)
        const levels = [0.6, 0.4, 0.2, 0, -0.2, -0.4, -0.6];

        colorPalette.innerHTML = '';
        
        levels.forEach(level => {
            baseColors.forEach(baseColor => {
                const color = adjustColorBrightness(baseColor, level);
                
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.backgroundColor = color;
                swatch.dataset.color = color;
                
                if (color === brushColor) swatch.classList.add('selected');
                
                // Touch-Support für Farbfelder
                const selectColor = (e) => {
                    if (e.type === 'touchstart') e.preventDefault();
                    
                    brushColor = swatch.dataset.color;
                    const currentSelected = colorPalette.querySelector('.selected');
                    if (currentSelected) currentSelected.classList.remove('selected');
                    swatch.classList.add('selected');
                    if (customColorPicker) customColorPicker.value = brushColor; // Picker aktualisieren
                    if (window.innerWidth < 768) togglePanel(colorPanel, false);
                };

                swatch.addEventListener('click', selectColor);
                swatch.addEventListener('touchstart', selectColor, { passive: false });

                colorPalette.appendChild(swatch);
            });
        });
    }

    function adjustColorBrightness(hex, factor) {
        // Hex zu RGB
        let r = parseInt(hex.substring(1, 3), 16);
        let g = parseInt(hex.substring(3, 5), 16);
        let b = parseInt(hex.substring(5, 7), 16);

        if (factor > 0) {
            // Aufhellen: Mischung mit Weiß (255)
            r = Math.round(r + (255 - r) * factor);
            g = Math.round(g + (255 - g) * factor);
            b = Math.round(b + (255 - b) * factor);
        } else {
            // Abdunkeln: Mischung mit Schwarz (0)
            const multiplier = 1 + factor;
            r = Math.round(r * multiplier);
            g = Math.round(g * multiplier);
            b = Math.round(b * multiplier);
        }

        const toHex = c => {
            const hexVal = Math.max(0, Math.min(255, c)).toString(16);
            return hexVal.length === 1 ? '0' + hexVal : hexVal;
        };

        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    // --- Speichern, Laden und Löschen ---
    function saveData() {
        if (!activeUser) return;
        const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
        const dataURL = canvas.toDataURL();
        localStorage.setItem(`${activeUser}_drawing${keySuffix}`, dataURL);
        
        // Status auf ROT setzen und mich als letzten Editor speichern
        localStorage.setItem(`${activeUser}_status${keySuffix}`, 'red');
        localStorage.setItem(`${activeUser}_last_editor${keySuffix}`, deviceId);
        updateStatusDots();
        
        alert('Bild gespeichert und für die andere Person sichtbar!');
    }

    function drawFromStorage(user, force = false) {
        const canvas = (user === 'niklas') ? myCanvas : friendCanvas;
        const ctx = (user === 'niklas') ? myCtx : friendCtx;
        const dataURL = localStorage.getItem(`${user}_drawing${keySuffix}`);
        
        // Optimierung: Nur neu zeichnen, wenn sich die Daten geändert haben (oder force=true)
        // Das verhindert Flackern beim automatischen Neuladen
        if (!force && dataURL === lastDrawState[user]) return;
        lastDrawState[user] = dataURL;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (dataURL) {
            const img = new Image();
            img.src = dataURL;
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
        }
    }
    
    function clearCanvas() {
        if (!activeUser) return;
        
        const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
        // Zustand speichern für Undo
        if (history[activeUser].undo.length > 20) history[activeUser].undo.shift();
        history[activeUser].undo.push(canvas.toDataURL());
        history[activeUser].redo = [];

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    function updateStatusDots() {
        const niklasStatus = localStorage.getItem(`niklas_status${keySuffix}`) || 'red';
        const jovelynStatus = localStorage.getItem(`jovelyn_status${keySuffix}`) || 'red';
        document.getElementById('niklas-status').className = `status-dot ${niklasStatus}`;
        document.getElementById('jovelyn-status').className = `status-dot ${jovelynStatus}`;
    }
    
    function markAsSeen() {
        // Wir markieren einfach alles als gesehen, wenn die App öffnet (optional)
        localStorage.setItem(`niklas_status${keySuffix}`, 'green');
        updateStatusDots();
    }

    // --- Fullscreen Logik ---
    function enterFullscreen(user) {
        activeUser = user;
        const wrapper = (user === 'niklas') ? wrapperNiklas : wrapperJovelyn;
        
        wrapper.classList.add('fullscreen');
        document.body.classList.add('mode-fullscreen');
        
        // Status-Logik: Nur auf Grün setzen, wenn ich NICHT der letzte Editor war
        const lastEditor = localStorage.getItem(`${user}_last_editor${keySuffix}`);
        if (lastEditor && lastEditor !== deviceId) {
            localStorage.setItem(`${user}_status${keySuffix}`, 'green');
            updateStatusDots();
        }
        
        // Kurz warten, damit CSS Transition greift, dann Canvas anpassen
        setTimeout(resizeCanvases, 50);
    }

    function exitFullscreen() {
        activeUser = null;
        document.querySelectorAll('.canvas-wrapper').forEach(el => el.classList.remove('fullscreen'));
        document.body.classList.remove('mode-fullscreen');

        // Zoom zurücksetzen beim Verlassen des Vollbilds
        [myCanvas, friendCanvas].forEach(c => resetZoom(c));

        // NEU: Logik zum Wiederherstellen der Ansicht auf der paint.html Seite
        if (document.body.classList.contains('paint-page')) {
            document.querySelectorAll('.field-with-dot').forEach(f => {
                f.style.display = 'flex';
                f.classList.remove('active-field');
            });
            // Die Controls werden durch die CSS-Regeln bei Entfernung von mode-fullscreen automatisch ausgeblendet
        }

        setTimeout(resizeCanvases, 50); // Resize after elements are back
    }

    wrapperNiklas.addEventListener('click', () => { if(!activeUser) enterFullscreen('niklas'); });
    wrapperJovelyn.addEventListener('click', () => { if(!activeUser) enterFullscreen('jovelyn'); });
    addTouchBtn(closeFullscreenBtn, (e) => { e.stopPropagation(); exitFullscreen(); });

    addTouchBtn(saveBtn, saveData);
    addTouchBtn(clearBtn, clearCanvas);
    
    if (refreshBtn) {
        addTouchBtn(refreshBtn, (e) => {
            e.stopPropagation();
            drawFromStorage('niklas', true);
            drawFromStorage('jovelyn', true);
            updateStatusDots();
        });
    }

    window.addEventListener('storage', (e) => {
        if (e.key === `jovelyn_drawing${keySuffix}`) drawFromStorage('jovelyn', true);
        if (e.key === `niklas_drawing${keySuffix}`) drawFromStorage('niklas', true);
        if (e.key.endsWith(`_status${keySuffix}`)) updateStatusDots();
    });

    // --- NEU: Automatisches Neuladen (Polling) ---
    // Aktualisiert die Bilder alle 2 Sekunden, falls Änderungen vorliegen
    setInterval(() => {
        // Nicht aktualisieren, während man selbst malt oder zoomt (vermeidet Ruckler)
        if (!isDrawing && !isZooming) {
            drawFromStorage('niklas');
            drawFromStorage('jovelyn');
            updateStatusDots();
        }
    }, 2000);

    // Update beim Wechseln des Tabs oder Öffnen der App (Wichtig für Mobile!)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            drawFromStorage('niklas', true);
            drawFromStorage('jovelyn', true);
            updateStatusDots();
        }
    });
    window.addEventListener('focus', () => {
        drawFromStorage('niklas', true);
        drawFromStorage('jovelyn', true);
        updateStatusDots();
    });

    // --- Initialisierung ---
    resizeCanvases();
    generateColors();
    updateStatusDots();
    markAsSeen();
}

function initQuizApp() {
    const questions = [
        "Was war unser schönster gemeinsamer Moment bisher?",
        "Was liebst du am meisten an mir?",
        "Wohin würdest du gerne mit mir reisen?",
        "Welches Lied erinnert dich an uns?",
        "Was ist deine liebste Eigenschaft an mir?",
        "Was würdest du gerne mal zusammen kochen?",
        "Was bringt dich immer zum Lachen?",
        "Wie sieht dein perfekter Tag mit mir aus?",
        "Was ist dein größter Traum für unsere Zukunft?",
        "Welche Kleinigkeit mache ich, die du süß findest?"
    ];

    // Frage des Tages basierend auf Datum berechnen
    const today = new Date();
    const dateString = today.toDateString(); // "Fri Oct 27 2023"
    // Einfacher Hash des Datums, um einen Index zu bekommen
    const dayIndex = Math.floor(Date.now() / 86400000); 
    const currentQuestion = questions[dayIndex % questions.length];

    const wrappers = {
        niklas: document.getElementById('quiz-wrapper-niklas'),
        jovelyn: document.getElementById('quiz-wrapper-jovelyn')
    };

    const containers = {
        niklas: document.getElementById('quiz-container-niklas'),
        jovelyn: document.getElementById('quiz-container-jovelyn')
    };

    // Modal Elemente
    const modal = document.getElementById('quiz-modal');
    const modalQuestion = document.getElementById('quiz-question-text');
    const modalInput = document.getElementById('quiz-answer-input');
    const modalDoneBtn = document.getElementById('quiz-done-btn');
    let currentQuizUser = null;

    function openQuizModal(user) {
        currentQuizUser = user;
        
        // Antwort laden
        const savedAnswerKey = `quiz_answer_${user}_${dateString}`;
        const savedAnswer = localStorage.getItem(savedAnswerKey) || "";

        // Modal befüllen
        modalQuestion.textContent = currentQuestion;
        modalInput.value = savedAnswer;
        
        // Modal anzeigen
        modal.classList.remove('hidden');
    }

    function closeQuizModal() {
        modal.classList.add('hidden');
        currentQuizUser = null;
    }

    // Speichern beim Tippen
    modalInput.addEventListener('input', (e) => {
        if (currentQuizUser) {
            const savedAnswerKey = `quiz_answer_${currentQuizUser}_${dateString}`;
            localStorage.setItem(savedAnswerKey, e.target.value);
        }
    });

    // Fertig Button
    modalDoneBtn.addEventListener('click', closeQuizModal);
    modalDoneBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        closeQuizModal();
    }, { passive: false });

    // Klick auf die Kacheln öffnet Modal
    Object.keys(wrappers).forEach(user => {
        wrappers[user].addEventListener('click', () => {
            openQuizModal(user);
        });
    });

    // Live-Sync für Quiz (optional, damit man sieht wenn der andere schreibt)
    window.addEventListener('storage', (e) => {
        if (e.key.startsWith('quiz_answer_') && e.key.endsWith(dateString)) {
            // Hier könnte man die Antwort des anderen live aktualisieren, wenn gewünscht
        }
    });
}
