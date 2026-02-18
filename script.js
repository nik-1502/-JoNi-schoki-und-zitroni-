// --- SERVER KONFIGURATION ---
// Damit die Synchronisation über Geräte hinweg funktioniert:
// Synchronisierung laeuft ueber die API unter /api/state.
// Frontend und API werden gemeinsam vom Render-Webservice ausgeliefert.
const Cloud = {
    apiBase: '/api/state',
    listeners: new Map(),
    pendingWrites: new Map(),
    pollTimer: null,
    pollMs: 1500,
    serverEnabled: false,
    init: async function() {
        await this.pullFromServer();
        this.startPolling();
    },
    set: function(key, value) {
        const strValue = String(value);
        this.pendingWrites.set(key, { value: strValue, at: Date.now(), localOnly: false });
        localStorage.setItem(key, strValue);
        this.notify(key, strValue);
        fetch(`${this.apiBase}/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: strValue })
        })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const pending = this.pendingWrites.get(key);
                if (pending && pending.value === strValue) {
                    this.pendingWrites.delete(key);
                }
                this.serverEnabled = true;
            })
            .catch(() => {
                this.serverEnabled = false;
            });
    },
    holdLocalValue: function(key, value) {
        this.pendingWrites.set(key, { value: String(value), at: Date.now(), localOnly: true });
    },
    clearPending: function(key) {
        this.pendingWrites.delete(key);
    },
    on: function(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);
        const localVal = localStorage.getItem(key);
        if (localVal !== null) callback(localVal);
    },
    notify: function(key, value) {
        const callbacks = this.listeners.get(key);
        if (!callbacks) return;
        callbacks.forEach((cb) => cb(value));
    },
    pullFromServer: async function() {
        try {
            const response = await fetch(this.apiBase, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const state = payload && payload.state ? payload.state : {};
            Object.keys(state).forEach((key) => {
                const serverValue = String(state[key]);
                const localValue = localStorage.getItem(key);
                const pending = this.pendingWrites.get(key);
                if (pending) {
                    if (pending.localOnly) {
                        return; // Lokaler Entwurf darf bis zum expliziten Speichern nicht überschrieben werden
                    }
                    if (pending.value === serverValue) {
                        this.pendingWrites.delete(key);
                    } else if (Date.now() - pending.at < 15000) {
                        return; // Kein Rückschritt auf älteren Serverstand, solange lokaler Write noch frisch ist
                    } else {
                        this.pendingWrites.delete(key);
                    }
                }
                if (localValue !== serverValue) {
                    localStorage.setItem(key, serverValue);
                    this.notify(key, serverValue);
                }
            });
            this.serverEnabled = true;
        } catch (err) {
            this.serverEnabled = false;
        }
    },
    startPolling: function() {
        if (this.pollTimer) return;
        this.pollTimer = setInterval(() => {
            this.pullFromServer();
        }, this.pollMs);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Cloud.init(); // Server-Sync starten

    // Führe die App aus, wenn Canvas vorhanden ist (jetzt auf index.html)
    if (document.getElementById('niklas-canvas')) {
        initPaintApp();
        initDashboard();
    }
    if (document.getElementById('quiz-wrapper-niklas')) {
        initQuizApp();
    }

    // Logik für den globalen Refresh-Button
    const globalRefreshBtn = document.getElementById('global-refresh-btn');
    if (globalRefreshBtn) {
        globalRefreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Wenn wir NICHT auf einer Mal-Seite sind (kein Canvas), machen wir einen normalen Reload
            if (!document.getElementById('niklas-canvas')) {
                location.reload();
            }
            // Falls Canvas existiert, wird das Event in initPaintApp abgefangen und smart synchronisiert
        });
    }
});

function initDashboard() {
    // --- Text Chat Logik ---
    const textAreas = {
        niklas: document.getElementById('niklas-text'),
        jovelyn: document.getElementById('jovelyn-text')
    };
    const textSaveDelayMs = 1200;
    const textSyncState = {
        niklas: { timer: null, pending: false },
        jovelyn: { timer: null, pending: false }
    };

    function saveTextLocal(user) {
        const text = textAreas[user].value;
        localStorage.setItem(`${user}_text`, text);
    }

    function saveTextCloud(user) {
        const text = textAreas[user].value;
        textSyncState[user].pending = false;
        Cloud.set(`${user}_text`, text); // Cloud Save
    }

    function scheduleTextCloudSave(user) {
        if (textSyncState[user].timer) {
            clearTimeout(textSyncState[user].timer);
        }
        textSyncState[user].pending = true;
        textSyncState[user].timer = setTimeout(() => {
            textSyncState[user].timer = null;
            saveTextCloud(user);
        }, textSaveDelayMs);
    }

    function saveText(user) {
        saveTextLocal(user);
        scheduleTextCloudSave(user);
    }

    function flushTextSave(user) {
        saveTextLocal(user);
        if (textSyncState[user].timer) {
            clearTimeout(textSyncState[user].timer);
            textSyncState[user].timer = null;
        }
        saveTextCloud(user);
    }

    function loadText(user) {
        const text = localStorage.getItem(`${user}_text`);
        if (text === null) return;
        if (document.activeElement === textAreas[user]) return;
        if (textSyncState[user].pending) return; // Verhindert Überschreiben mit altem Stand während lokaler Eingabe
        textAreas[user].value = text;
    }

    // Event Listener für Text
    Object.keys(textAreas).forEach(user => {
        textAreas[user].addEventListener('input', () => saveText(user));
        textAreas[user].addEventListener('blur', () => flushTextSave(user));
        loadText(user); // Beim Start laden
        
        // Live-Update aus der Cloud empfangen
        Cloud.on(`${user}_text`, (val) => {
            // Nur updaten, wenn wir nicht selbst tippen
            if (document.activeElement !== textAreas[user]) {
                if (textSyncState[user].pending) return;
                textAreas[user].value = val;
            }
        });
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
    window.addEventListener('pagehide', () => {
        Object.keys(textAreas).forEach(user => flushTextSave(user));
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            Object.keys(textAreas).forEach(user => flushTextSave(user));
        }
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

    function setCrispRendering(ctx) {
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        ctx.msImageSmoothingEnabled = false;
    }
    setCrispRendering(myCtx);
    setCrispRendering(friendCtx);

    // Unterscheidung: Startseite vs. Tier-des-Tages (getrennte Speicherung)
    const isDailyPage = document.body.classList.contains('paint-page');
    const keySuffix = isDailyPage ? '_daily' : '';

    // --- Zoom Helper & State ---
    let isZooming = false;
    let zoomState = {
        startDist: 0,
        startScale: 1,
        startX: 0,
        startY: 0,
        initialTx: 0,
        initialTy: 0,
        startAngle: 0,
        startRotation: 0,
        lastDist: 0,
        lastAngle: 0,
        lastCenterX: 0,
        lastCenterY: 0
    };
    let isRightDragging = false;
    let rightDragCanvas = null;
    let rightDragStartMouse = { x: 0, y: 0 };
    let rightDragStartTransform = { tx: 0, ty: 0, scale: 1, rotation: 0 };

    function getDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getAngle(touches) {
        const dx = touches[1].clientX - touches[0].clientX;
        const dy = touches[1].clientY - touches[0].clientY;
        return Math.atan2(dy, dx);
    }

    function getCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function getTransformedBounds(width, height, tx, ty, scale, rotationDeg) {
        const rad = rotationDeg * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const a = scale * cos;
        const b = scale * sin;
        const c = -scale * sin;
        const d = scale * cos;

        const p1x = tx;
        const p1y = ty;
        const p2x = tx + a * width;
        const p2y = ty + b * width;
        const p3x = tx + c * height;
        const p3y = ty + d * height;
        const p4x = tx + a * width + c * height;
        const p4y = ty + b * width + d * height;

        const minX = Math.min(p1x, p2x, p3x, p4x);
        const maxX = Math.max(p1x, p2x, p3x, p4x);
        const minY = Math.min(p1y, p2y, p3y, p4y);
        const maxY = Math.max(p1y, p2y, p3y, p4y);
        return { minX, maxX, minY, maxY };
    }

    function clampTransformToWrapper(canvas, tx, ty, scale, rotation) {
        const wrapper = canvas.parentElement;
        if (!wrapper) return { tx, ty };

        const wrapperW = wrapper.clientWidth;
        const wrapperH = wrapper.clientHeight;
        if (!wrapperW || !wrapperH) return { tx, ty };

        const cssW = canvas.clientWidth || wrapperW;
        const cssH = canvas.clientHeight || wrapperH;
        const minVisible = 36;
        const maxLeft = wrapperW - minVisible;
        const maxTop = wrapperH - minVisible;

        const bounds = getTransformedBounds(cssW, cssH, tx, ty, scale, rotation);
        let shiftX = 0;
        let shiftY = 0;

        // Horizontal: nie komplett außerhalb lassen
        if (bounds.maxX < minVisible) shiftX = minVisible - bounds.maxX;
        else if (bounds.minX > maxLeft) shiftX = maxLeft - bounds.minX;

        // Vertikal: nie komplett außerhalb lassen
        if (bounds.maxY < minVisible) shiftY = minVisible - bounds.maxY;
        else if (bounds.minY > maxTop) shiftY = maxTop - bounds.minY;

        return { tx: tx + shiftX, ty: ty + shiftY };
    }

    function updateCanvasTransform(canvas, x, y, scale, rotation = 0) {
        const clamped = clampTransformToWrapper(canvas, x, y, scale, rotation);
        canvas.style.transformOrigin = '0 0';
        canvas.style.transform = `translate(${clamped.tx}px, ${clamped.ty}px) rotate(${rotation}deg) scale(${scale})`;
        canvas.dataset.scale = scale;
        canvas.dataset.tx = clamped.tx;
        canvas.dataset.ty = clamped.ty;
        canvas.dataset.rotation = rotation;
        syncGridVisualForCanvas(canvas);
    }

    function resetZoom(canvas) {
        canvas.style.transform = '';
        delete canvas.dataset.scale;
        delete canvas.dataset.tx;
        delete canvas.dataset.ty;
        delete canvas.dataset.rotation;
        syncGridVisualForCanvas(canvas);
    }

    function getCanvasTransform(canvas) {
        return {
            scale: parseFloat(canvas.dataset.scale) || 1,
            tx: parseFloat(canvas.dataset.tx) || 0,
            ty: parseFloat(canvas.dataset.ty) || 0,
            rotation: parseFloat(canvas.dataset.rotation) || 0
        };
    }

    function rotateCanvasAroundViewportCenter(canvas, deltaDeg) {
        const { scale, tx, ty, rotation } = getCanvasTransform(canvas);
        const wrapper = canvas.parentElement;
        const cx = wrapper.clientWidth / 2;
        const cy = wrapper.clientHeight / 2;

        const rotRad = rotation * Math.PI / 180;
        const cos = Math.cos(rotRad);
        const sin = Math.sin(rotRad);
        const a = scale * cos;
        const b = scale * sin;
        const c = -scale * sin;
        const d = scale * cos;
        const det = a * d - b * c || 1;

        // Punkt unter der sichtbaren Mitte vor Rotation bestimmen
        const px = ((cx - tx) * d - (cy - ty) * c) / det;
        const py = (-(cx - tx) * b + (cy - ty) * a) / det;

        const newRotation = rotation + deltaDeg;
        const newRad = newRotation * Math.PI / 180;
        const newCos = Math.cos(newRad);
        const newSin = Math.sin(newRad);
        const na = scale * newCos;
        const nb = scale * newSin;
        const nc = -scale * newSin;
        const nd = scale * newCos;

        // Translation so setzen, dass dieser Punkt in der sichtbaren Mitte bleibt
        const newTx = cx - (na * px + nc * py);
        const newTy = cy - (nb * px + nd * py);
        updateCanvasTransform(canvas, newTx, newTy, scale, newRotation);
    }

    function getCenteredTranslation(canvas, scale, rotation) {
        const wrapper = canvas.parentElement;
        const cssWidth = canvas.clientWidth || wrapper.clientWidth || 1;
        const cssHeight = canvas.clientHeight || wrapper.clientHeight || 1;
        const cx = wrapper.clientWidth / 2;
        const cy = wrapper.clientHeight / 2;

        const rad = rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const a = scale * cos;
        const b = scale * sin;
        const c = -scale * sin;
        const d = scale * cos;

        const midX = cssWidth / 2;
        const midY = cssHeight / 2;
        const tx = cx - (a * midX + c * midY);
        const ty = cy - (b * midX + d * midY);
        return { tx, ty };
    }

    function zoomCanvasAroundViewportPoint(canvas, zoomFactor, viewX, viewY) {
        const { scale, tx, ty, rotation } = getCanvasTransform(canvas);
        let newScale = Math.max(1, Math.min(5, scale * zoomFactor));

        // Local point under cursor before zoom (inverse transform)
        const rotRad = rotation * Math.PI / 180;
        const cos = Math.cos(rotRad);
        const sin = Math.sin(rotRad);
        const a = scale * cos;
        const b = scale * sin;
        const c = -scale * sin;
        const d = scale * cos;
        const det = a * d - b * c || 1;
        const px = ((viewX - tx) * d - (viewY - ty) * c) / det;
        const py = (-(viewX - tx) * b + (viewY - ty) * a) / det;

        // New translation so cursor keeps pointing to the same local point
        const newCos = Math.cos(rotRad);
        const newSin = Math.sin(rotRad);
        const na = newScale * newCos;
        const nb = newScale * newSin;
        const nc = -newScale * newSin;
        const nd = newScale * newCos;
        let newTx = viewX - (na * px + nc * py);
        let newTy = viewY - (nb * px + nd * py);

        if (newScale < 1.02) {
            newScale = 1;
            const centered = getCenteredTranslation(canvas, newScale, rotation);
            newTx = centered.tx;
            newTy = centered.ty;
        }

        updateCanvasTransform(canvas, newTx, newTy, newScale, rotation);
    }

    // Canvas-Größe an den Container anpassen
    function resizeCanvases() {
        const pixelRatio = 2; // Erhöhte Auflösung für feineres Malen
        let resized = false;

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
                setCrispRendering(canvas.getContext('2d'));
                resetZoom(canvas); // Zoom zurücksetzen bei Größenänderung
                resized = true;
            }
        });
        // Gespeicherte Bilder nach Größenänderung neu laden
        drawFromStorage('niklas', resized);
        drawFromStorage('jovelyn', resized);
        syncGridVisualForCanvas(myCanvas);
        syncGridVisualForCanvas(friendCanvas);
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

    // Cache + Render-Token, um Flackern und Race-Conditions beim Neuladen zu verhindern
    const lastDrawState = { niklas: null, jovelyn: null };
    const drawRenderToken = { niklas: 0, jovelyn: 0 };
    const drawingDirty = { niklas: false, jovelyn: false };

    // --- History für Undo/Redo ---
    const history = {
        niklas: { undo: [], redo: [] },
        jovelyn: { undo: [], redo: [] }
    };

    function pushUndoSnapshot(user, canvas) {
        if (!user || !canvas) return;
        if (history[user].undo.length > 20) history[user].undo.shift();
        history[user].undo.push(canvas.toDataURL());
        history[user].redo = [];
    }

    // --- DOM-Elemente ---
    const brushBtn = document.getElementById('brush-btn');
    const eraserBtn = document.getElementById('eraser-btn');
    const colorBtn = document.getElementById('color-btn');
    const fillBtn = document.getElementById('fill-btn');
    const saveBtn = document.getElementById('save-btn');
    const archiveBtn = document.getElementById('archive-btn');
    const clearBtn = document.getElementById('clear-btn');
    const closeFullscreenBtn = document.getElementById('close-fullscreen-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const globalRefreshBtn = document.getElementById('global-refresh-btn');
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
    const gridToggle = document.getElementById('grid-toggle');
    const gridSizeSlider = document.getElementById('grid-size');
    const gridSizeValue = document.getElementById('grid-size-value');
    const eraserSizeSlider = document.getElementById('eraser-size');
    const eraserSizeValue = document.getElementById('eraser-size-value');
    const eraserOpacitySlider = document.getElementById('eraser-opacity');
    const eraserOpacityValue = document.getElementById('eraser-opacity-value');
    const eraserFillToggle = document.getElementById('eraser-fill-toggle');
    const colorPalette = document.getElementById('color-palette');
    const customColorPicker = document.getElementById('custom-color');
    const archiveStoragePrefix = `draw_archive${keySuffix}`;
    const savedSnapshotSuffix = `_saved_snapshot${keySuffix}`;
    let gridEnabled = false;
    let gridSize = 24;
    const gridVisuals = { niklas: null, jovelyn: null };

    function getUserFromCanvas(canvas) {
        return canvas === myCanvas ? 'niklas' : 'jovelyn';
    }

    function ensureGridVisual(user, canvas, wrapper) {
        if (gridVisuals[user]) return gridVisuals[user];
        const overlay = document.createElement('div');
        overlay.className = 'grid-overlay hidden';
        overlay.setAttribute('aria-hidden', 'true');

        const dot = document.createElement('div');
        dot.className = 'grid-anchor-dot hidden';
        dot.setAttribute('aria-hidden', 'true');

        wrapper.appendChild(overlay);
        wrapper.appendChild(dot);
        gridVisuals[user] = { overlay, dot, canvas, wrapper };
        return gridVisuals[user];
    }

    function updateGridPattern(user) {
        const visual = gridVisuals[user];
        if (!visual) return;
        visual.overlay.style.backgroundImage =
            'linear-gradient(rgba(20,20,20,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(20,20,20,0.22) 1px, transparent 1px)';
        visual.overlay.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    }

    function updateGridDotPosition(user) {
        const visual = gridVisuals[user];
        if (!visual || !gridEnabled) return;
        const { canvas, dot, wrapper } = visual;
        const cssWidth = canvas.clientWidth || 1;
        const cssHeight = canvas.clientHeight || 1;
        const { scale, tx, ty, rotation } = getCanvasTransform(canvas);
        const margin = 8;
        const maxX = Math.max(margin, wrapper.clientWidth - margin);
        const maxY = Math.max(margin, wrapper.clientHeight - margin);
        const m = new DOMMatrix()
            .translate(tx, ty)
            .rotate(rotation)
            .scale(scale);
        const anchorLocal = new DOMPoint(cssWidth / 2, Math.max(cssHeight - 8, 0));
        const p = anchorLocal.matrixTransform(m);
        let x = p.x;
        let y = p.y;

        x = Math.max(margin, Math.min(maxX, x));
        y = Math.max(margin, Math.min(maxY, y));
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
    }

    function syncGridVisualForCanvas(canvas) {
        const user = getUserFromCanvas(canvas);
        const visual = gridVisuals[user];
        if (!visual) return;

        visual.overlay.style.transformOrigin = '0 0';
        visual.overlay.style.transform = canvas.style.transform || '';
        updateGridPattern(user);
        updateGridDotPosition(user);
    }

    function updateGridVisibility() {
        Object.keys(gridVisuals).forEach((user) => {
            const visual = gridVisuals[user];
            if (!visual) return;
            visual.overlay.classList.toggle('hidden', !gridEnabled);
            visual.dot.classList.toggle('hidden', !gridEnabled);
            if (gridEnabled) {
                updateGridPattern(user);
                syncGridVisualForCanvas(visual.canvas);
            }
        });
        if (gridToggle) gridToggle.checked = gridEnabled;
        if (gridSizeSlider) gridSizeSlider.value = String(gridSize);
        if (gridSizeValue) gridSizeValue.textContent = String(gridSize);
    }

    function updateToolButtonStates() {
        if (brushBtn) brushBtn.classList.toggle('is-tool-active', !isEraser);
        if (eraserBtn) eraserBtn.classList.toggle('is-tool-active', isEraser);
    }

    function updateFillButtonState() {
        if (fillBtn) fillBtn.classList.toggle('is-fill-active', isFillMode);
        if (fillToggle) fillToggle.checked = isFillMode;
        if (eraserFillToggle) eraserFillToggle.checked = isFillMode;
    }

    ensureGridVisual('niklas', myCanvas, wrapperNiklas);
    ensureGridVisual('jovelyn', friendCanvas, wrapperJovelyn);

    function getArchiveKey(user) {
        return `${archiveStoragePrefix}_${user}`;
    }

    function getSavedSnapshotKey(user) {
        return `${user}${savedSnapshotSuffix}`;
    }

    function getArchiveItems(user) {
        try {
            const raw = localStorage.getItem(getArchiveKey(user));
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    }

    function setArchiveItems(user, items) {
        localStorage.setItem(getArchiveKey(user), JSON.stringify(items));
    }

    function formatArchiveDate(ts) {
        const dt = new Date(ts);
        return dt.toLocaleString('de-DE');
    }

    function makeArchiveName() {
        const now = new Date();
        const datePart = now.toLocaleDateString('de-DE');
        const timePart = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        if (isDailyPage) {
            const animalEl = document.getElementById('daily-animal-text');
            const animalName = animalEl ? animalEl.textContent.trim() : '';
            if (animalName && animalName.toLowerCase() !== 'lade...') {
                return `${animalName} - ${datePart} ${timePart}`;
            }
        }
        return `Bild ${datePart} ${timePart}`;
    }

    function dataUrlToBlob(dataUrl) {
        const parts = dataUrl.split(',');
        const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
        const binary = atob(parts[1] || '');
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    function downloadDataUrl(dataUrl, filename) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function sanitizeFileName(name) {
        return (name || 'bild')
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function shareArchiveImage(item) {
        const safeName = sanitizeFileName(item.name) || 'bild';
        const filename = `${safeName}.png`;
        const blob = dataUrlToBlob(item.dataURL);
        const file = new File([blob], filename, { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: item.name,
                text: 'Gemaltes Bild',
                files: [file]
            });
            return;
        }
        if (navigator.share) {
            await navigator.share({
                title: item.name,
                text: 'Bild zum Speichern',
                url: item.dataURL
            });
            return;
        }
        downloadDataUrl(item.dataURL, filename);
    }

    let saveGalleryModal = null;
    let saveGalleryNameInput = null;
    let saveGalleryList = null;
    let saveGalleryHint = null;
    let saveGalleryDetail = null;
    let saveGalleryDetailImage = null;
    let saveGalleryDetailTitle = null;
    let saveGalleryDetailDate = null;
    let saveGallerySelectedId = null;

    function ensureSaveGalleryModal() {
        if (saveGalleryModal) return;

        const modal = document.createElement('div');
        modal.id = 'save-gallery-modal';
        modal.className = 'modal hidden save-gallery-modal';
        modal.innerHTML = `
            <div class="modal-content save-gallery-content">
                <div class="save-gallery-header">
                    <h3>Bild speichern</h3>
                    <button id="save-gallery-close-btn" class="back-button">Schließen</button>
                </div>
                <input id="save-gallery-name-input" class="save-gallery-name-input" type="text" placeholder="Name für das Bild">
                <div class="save-gallery-actions">
                    <button id="save-gallery-store-btn" class="control-button">Im Archiv speichern</button>
                </div>
                <p id="save-gallery-hint" class="save-gallery-hint"></p>
                <div id="save-gallery-list" class="save-gallery-list"></div>
                <div id="save-gallery-detail" class="save-gallery-detail hidden">
                    <button id="save-gallery-back-btn" class="back-button">Zurück</button>
                    <img id="save-gallery-detail-image" class="save-gallery-detail-image" alt="Archivbild">
                    <div class="save-gallery-detail-meta">
                        <strong id="save-gallery-detail-title"></strong>
                        <span id="save-gallery-detail-date"></span>
                    </div>
                    <div class="save-gallery-detail-actions">
                        <button id="save-gallery-detail-load-btn" class="control-button">Laden</button>
                        <button id="save-gallery-detail-share-btn" class="control-button">Teilen</button>
                        <button id="save-gallery-detail-download-btn" class="control-button">Herunterladen</button>
                        <button id="save-gallery-detail-delete-btn" class="control-button">Löschen</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        saveGalleryModal = modal;
        saveGalleryNameInput = modal.querySelector('#save-gallery-name-input');
        saveGalleryList = modal.querySelector('#save-gallery-list');
        saveGalleryHint = modal.querySelector('#save-gallery-hint');
        saveGalleryDetail = modal.querySelector('#save-gallery-detail');
        saveGalleryDetailImage = modal.querySelector('#save-gallery-detail-image');
        saveGalleryDetailTitle = modal.querySelector('#save-gallery-detail-title');
        saveGalleryDetailDate = modal.querySelector('#save-gallery-detail-date');

        const closeBtn = modal.querySelector('#save-gallery-close-btn');
        const storeBtn = modal.querySelector('#save-gallery-store-btn');
        const backBtn = modal.querySelector('#save-gallery-back-btn');
        const loadBtn = modal.querySelector('#save-gallery-detail-load-btn');
        const shareBtn = modal.querySelector('#save-gallery-detail-share-btn');
        const downloadBtn = modal.querySelector('#save-gallery-detail-download-btn');
        const deleteBtn = modal.querySelector('#save-gallery-detail-delete-btn');

        closeBtn.addEventListener('click', closeSaveGalleryModal);
        storeBtn.addEventListener('click', saveCurrentDrawingToArchive);
        backBtn.addEventListener('click', showSaveGalleryListView);
        loadBtn.addEventListener('click', () => loadArchiveImageToCanvas(saveGallerySelectedId));
        shareBtn.addEventListener('click', () => shareArchiveImageById(saveGallerySelectedId));
        downloadBtn.addEventListener('click', () => downloadArchiveImageById(saveGallerySelectedId));
        deleteBtn.addEventListener('click', () => deleteArchiveImageById(saveGallerySelectedId));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeSaveGalleryModal();
        });
    }

    function showSaveGalleryListView() {
        saveGallerySelectedId = null;
        if (saveGalleryDetail) saveGalleryDetail.classList.add('hidden');
        if (saveGalleryList) saveGalleryList.classList.remove('hidden');
    }

    function showSaveGalleryDetailView(item) {
        if (!item) return;
        saveGallerySelectedId = item.id;
        saveGalleryDetailImage.src = item.dataURL;
        saveGalleryDetailTitle.textContent = item.name;
        saveGalleryDetailDate.textContent = formatArchiveDate(item.createdAt);
        saveGalleryList.classList.add('hidden');
        saveGalleryDetail.classList.remove('hidden');
    }

    function renderSaveGalleryList() {
        ensureSaveGalleryModal();
        if (!activeUser) {
            saveGalleryList.innerHTML = '<p class="save-gallery-empty">Kein Malfeld aktiv.</p>';
            showSaveGalleryListView();
            return;
        }

        const items = getArchiveItems(activeUser).sort((a, b) => b.createdAt - a.createdAt);
        if (!items.length) {
            saveGalleryList.innerHTML = '<p class="save-gallery-empty">Noch keine gespeicherten Bilder.</p>';
            showSaveGalleryListView();
            return;
        }

        saveGalleryList.innerHTML = items.map((item) => `
            <article class="save-gallery-item" data-id="${item.id}">
                <button class="save-gallery-item-main" type="button">
                    <img src="${item.dataURL}" alt="${escapeHtml(item.name)}" class="save-gallery-thumb">
                    <div class="save-gallery-meta">
                        <strong>${escapeHtml(item.name)}</strong>
                    </div>
                </button>
            </article>
        `).join('');

        saveGalleryList.querySelectorAll('.save-gallery-item').forEach((card) => {
            const id = card.dataset.id;
            const open = () => showSaveGalleryDetailView(getArchiveItemById(id));
            card.querySelector('.save-gallery-item-main').addEventListener('click', open);
        });
        showSaveGalleryListView();
    }

    function openSaveGalleryModal() {
        ensureSaveGalleryModal();
        saveGalleryHint.textContent = activeUser ? `Aktives Feld: ${activeUser}` : 'Bitte zuerst ein Feld öffnen.';
        saveGalleryNameInput.value = makeArchiveName();
        renderSaveGalleryList();
        saveGalleryModal.classList.remove('hidden');
    }

    function closeSaveGalleryModal() {
        if (!saveGalleryModal) return;
        saveGalleryModal.classList.add('hidden');
        showSaveGalleryListView();
    }

    function saveCurrentDrawingToArchive() {
        if (!activeUser) return;

        persistDrawingLocally(activeUser);
        syncDrawingToCloud(activeUser);

        const dataURL = localStorage.getItem(`${activeUser}_drawing${keySuffix}`);
        if (!dataURL) return;

        const items = getArchiveItems(activeUser);
        const nextItem = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: (saveGalleryNameInput.value || '').trim() || makeArchiveName(),
            createdAt: Date.now(),
            dataURL
        };
        items.unshift(nextItem);
        setArchiveItems(activeUser, items.slice(0, 120));
        renderSaveGalleryList();
        saveGalleryHint.textContent = 'Bild gespeichert und synchronisiert.';
    }

    function getArchiveItemById(id) {
        if (!activeUser) return null;
        return getArchiveItems(activeUser).find((item) => item.id === id) || null;
    }

    function loadArchiveImageToCanvas(id) {
        const item = getArchiveItemById(id);
        if (!item || !activeUser) return;

        const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
        const ctx = canvas.getContext('2d');
        pushUndoSnapshot(activeUser, canvas); // Vorherigen Stand für Undo sichern
        const img = new Image();
        img.src = item.dataURL;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            persistDrawingLocally(activeUser);
            saveGalleryHint.textContent = 'Bild ins Malfeld geladen.';
            closeSaveGalleryModal();
        };
    }

    async function shareArchiveImageById(id) {
        const item = getArchiveItemById(id);
        if (!item) return;
        try {
            await shareArchiveImage(item);
        } catch (err) {
            // Abbruch durch User oder fehlende Plattformunterstützung
        }
    }

    function downloadArchiveImageById(id) {
        const item = getArchiveItemById(id);
        if (!item) return;
        const safeName = sanitizeFileName(item.name) || 'bild';
        downloadDataUrl(item.dataURL, `${safeName}.png`);
    }

    function deleteArchiveImageById(id) {
        if (!activeUser) return;
        const items = getArchiveItems(activeUser).filter((item) => item.id !== id);
        setArchiveItems(activeUser, items);
        renderSaveGalleryList();
        saveGalleryHint.textContent = 'Bild wurde aus dem Archiv gelöscht.';
    }

    // --- Zeichenfunktionen ---
    function getEventPosition(canvas, e) {
        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // Bei transformiertem Canvas (Zoom/Rotation) den Punkt per inverser Matrix zurückrechnen.
        const rect = canvas.getBoundingClientRect();
        const cssWidth = canvas.clientWidth || rect.width || 1;
        const cssHeight = canvas.clientHeight || rect.height || 1;
        const styleTransform = window.getComputedStyle(canvas).transform;

        if (!styleTransform || styleTransform === 'none') {
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }

        try {
            const m = new DOMMatrix(styleTransform);
            if (!m.is2D || m.a === 0 || m.d === 0) throw new Error('invalid-matrix');

            const corners = [
                new DOMPoint(0, 0).matrixTransform(m),
                new DOMPoint(cssWidth, 0).matrixTransform(m),
                new DOMPoint(0, cssHeight).matrixTransform(m),
                new DOMPoint(cssWidth, cssHeight).matrixTransform(m)
            ];
            const minX = Math.min(...corners.map((p) => p.x));
            const minY = Math.min(...corners.map((p) => p.y));

            const layoutLeft = rect.left - minX;
            const layoutTop = rect.top - minY;

            const localInViewport = new DOMPoint(clientX - layoutLeft, clientY - layoutTop);
            const localCss = localInViewport.matrixTransform(m.inverse());

            const x = (localCss.x / cssWidth) * canvas.width;
            const y = (localCss.y / cssHeight) * canvas.height;

            return {
                x: Math.max(0, Math.min(canvas.width, x)),
                y: Math.max(0, Math.min(canvas.height, y))
            };
        } catch (_err) {
            // Fallback falls Matrix-Berechnung auf einem Gerät nicht unterstützt ist.
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }
    }

    function persistDrawingLocally(user) {
        if (!user) return;
        const canvas = (user === 'niklas') ? myCanvas : friendCanvas;
        const dataURL = canvas.toDataURL();
        localStorage.setItem(`${user}_drawing${keySuffix}`, dataURL);
        lastDrawState[user] = dataURL;
        localStorage.setItem(`${user}_status${keySuffix}`, 'red');
        localStorage.setItem(`${user}_last_editor${keySuffix}`, deviceId);
        Cloud.holdLocalValue(`${user}_drawing${keySuffix}`, dataURL);
        Cloud.holdLocalValue(`${user}_status${keySuffix}`, 'red');
        drawingDirty[user] = true;
        updateStatusDots();
    }

    function syncDrawingToCloud(user) {
        if (!user) return;
        const dataURL = localStorage.getItem(`${user}_drawing${keySuffix}`) || '';
        Cloud.set(`${user}_drawing${keySuffix}`, dataURL);
        Cloud.set(`${user}_status${keySuffix}`, 'red');
        localStorage.setItem(getSavedSnapshotKey(user), dataURL);
        drawingDirty[user] = false;
    }

    function rememberCurrentAsSavedSnapshot(user) {
        const dataURL = localStorage.getItem(`${user}_drawing${keySuffix}`) || '';
        localStorage.setItem(getSavedSnapshotKey(user), dataURL);
    }

    function discardUnsavedChanges(user) {
        if (!user || !drawingDirty[user]) return;
        const snapshot = localStorage.getItem(getSavedSnapshotKey(user));
        if (snapshot === null) return;

        localStorage.setItem(`${user}_drawing${keySuffix}`, snapshot);
        lastDrawState[user] = null;
        Cloud.clearPending(`${user}_drawing${keySuffix}`);
        Cloud.clearPending(`${user}_status${keySuffix}`);
        drawingDirty[user] = false;
        drawFromStorage(user, true);
    }

    function startDrawing(e) {
        // Nur malen, wenn wir im Fullscreen sind und auf dem richtigen Canvas
        if (!document.body.classList.contains('mode-fullscreen')) return;
        if (e.type === 'mousedown' && e.button !== 0) return; // Nur Linksklick zeichnet
        
        // --- Zoom/Rotation Start (2 Finger) ---
        if (e.touches && e.touches.length === 2) {
            e.preventDefault();
            isDrawing = false;
            isZooming = true;
            
            const dist = getDistance(e.touches);
            const center = getCenter(e.touches);
            const angle = getAngle(e.touches);
            const canvas = e.target;
            
            const { scale: currentScale, tx: currentTx, ty: currentTy, rotation: currentRotation } = getCanvasTransform(canvas);
            
            zoomState.startDist = dist;
            zoomState.startScale = currentScale;
            zoomState.startX = center.x;
            zoomState.startY = center.y;
            zoomState.initialTx = currentTx;
            zoomState.initialTy = currentTy;
            zoomState.startAngle = angle;
            zoomState.startRotation = currentRotation;
            zoomState.lastDist = dist;
            zoomState.lastAngle = angle;
            zoomState.lastCenterX = center.x;
            zoomState.lastCenterY = center.y;
            return;
        }
        if (isZooming) return; // Nicht malen, wenn gezoomt wird
        if (e.touches && e.touches.length !== 1) return;

        const canvas = e.target; // Das Canvas, auf das geklickt wurde
        const pos = getEventPosition(canvas, e);

        // Füll-Modus Logik
        if (isFillMode) {
            pushUndoSnapshot(activeUser, canvas);
            floodFill(canvas, Math.floor(pos.x), Math.floor(pos.y), brushColor, isEraser);
            persistDrawingLocally(activeUser);
            return; // Nicht zeichnen, wenn gefüllt wird
        }

        isDrawing = true;
        [lastX, lastY] = [pos.x, pos.y];

        // Zustand speichern für Undo (bevor der neue Strich beginnt)
        pushUndoSnapshot(activeUser, canvas);
    }

    function draw(e) {
        // --- Zoom/Rotation Move ---
        if (isZooming && e.touches && e.touches.length === 2) {
            e.preventDefault();
            const dist = getDistance(e.touches);
            const center = getCenter(e.touches);
            const angle = getAngle(e.touches);
            const canvas = e.target;

            const prevDist = zoomState.lastDist || dist;
            const prevAngle = zoomState.lastAngle || angle;
            const prevCenterX = zoomState.lastCenterX || center.x;
            const prevCenterY = zoomState.lastCenterY || center.y;

            // 1) Zwei-Finger-Verschieben (Pan)
            const panDx = center.x - prevCenterX;
            const panDy = center.y - prevCenterY;
            if (panDx !== 0 || panDy !== 0) {
                const t = getCanvasTransform(canvas);
                updateCanvasTransform(canvas, t.tx + panDx, t.ty + panDy, t.scale, t.rotation);
            }

            // 2) Zoom um Finger-Mittelpunkt
            const zoomFactor = prevDist > 0 ? dist / prevDist : 1;
            if (Math.abs(zoomFactor - 1) > 0.0001) {
                zoomCanvasAroundViewportPoint(canvas, zoomFactor, center.x, center.y);
            }

            // 3) Rotation (gleiches Prinzip wie Desktop: um sichtbare Feldmitte)
            let deltaRad = angle - prevAngle;
            if (deltaRad > Math.PI) deltaRad -= 2 * Math.PI;
            if (deltaRad < -Math.PI) deltaRad += 2 * Math.PI;
            const deltaDeg = deltaRad * 180 / Math.PI;
            if (Math.abs(deltaDeg) > 0.05) {
                rotateCanvasAroundViewportCenter(canvas, deltaDeg);
            }

            // optionales leichtes Einrasten nahe 0°
            const tAfter = getCanvasTransform(canvas);
            if (Math.abs(tAfter.rotation) < 1) {
                updateCanvasTransform(canvas, tAfter.tx, tAfter.ty, tAfter.scale, 0);
            }

            zoomState.lastDist = dist;
            zoomState.lastAngle = angle;
            zoomState.lastCenterX = center.x;
            zoomState.lastCenterY = center.y;
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
            isDrawing = false; // Erst nach neuem Touchstart wieder zeichnen
            return;
        }
        if (!isDrawing) return;
        isDrawing = false;
        persistDrawingLocally(activeUser);
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

        const fillTolerance = 8;
        const eraseTolerance = startA > 180 ? 120 : 90;

        const stack = [[startX, startY]];
        const visited = new Uint8Array(width * height); // Verhindert Endlosschleifen
        
        while (stack.length) {
            const [x, y] = stack.pop();
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            const pixelIndex = y * width + x;
            if (visited[pixelIndex]) continue;
            const pos = pixelIndex * 4;
            
            const pr = data[pos];
            const pg = data[pos + 1];
            const pb = data[pos + 2];
            const pa = data[pos + 3];
            let matchesStartColor;
            if (erase) {
                // Beim Lösch-Fill: verbundene Farbpixel inkl. weicher Randpixel entfernen
                matchesStartColor = pa > 0 &&
                    Math.abs(pr - startR) <= eraseTolerance &&
                    Math.abs(pg - startG) <= eraseTolerance &&
                    Math.abs(pb - startB) <= eraseTolerance;
            } else {
                matchesStartColor =
                    Math.abs(pr - startR) <= fillTolerance &&
                    Math.abs(pg - startG) <= fillTolerance &&
                    Math.abs(pb - startB) <= fillTolerance &&
                    Math.abs(pa - startA) <= fillTolerance;
            }

            if (matchesStartColor) {
                
                if (erase) {
                    data[pos] = 0;
                    data[pos + 1] = 0;
                    data[pos + 2] = 0;
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
    [wrapperNiklas, wrapperJovelyn].forEach((wrapper) => {
        wrapper.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    document.addEventListener('contextmenu', (e) => {
        if (e.target && e.target.closest && e.target.closest('.canvas-wrapper')) {
            e.preventDefault();
        }
    }, true);

    [myCanvas, friendCanvas].forEach(canvas => {
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);
        
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('mousedown', (e) => {
            if (!document.body.classList.contains('mode-fullscreen')) return;
            if (e.button !== 2) return; // Nur Rechtsklick
            const hoveredUser = (canvas === myCanvas) ? 'niklas' : 'jovelyn';
            if (activeUser !== hoveredUser) return;

            e.preventDefault();
            isDrawing = false;
            isRightDragging = true;
            rightDragCanvas = canvas;
            rightDragStartMouse = { x: e.clientX, y: e.clientY };
            const t = getCanvasTransform(canvas);
            rightDragStartTransform = { tx: t.tx, ty: t.ty, scale: t.scale, rotation: t.rotation };
        });
        canvas.addEventListener('wheel', (e) => {
            if (!document.body.classList.contains('mode-fullscreen')) return;
            const hoveredUser = (canvas === myCanvas) ? 'niklas' : 'jovelyn';
            if (activeUser !== hoveredUser) return;

            e.preventDefault();
            if (isRightDragging && rightDragCanvas === canvas) {
                const step = 6;
                rotateCanvasAroundViewportCenter(canvas, e.deltaY < 0 ? step : -step);
                const t = getCanvasTransform(canvas);
                rightDragStartTransform = { tx: t.tx, ty: t.ty, scale: t.scale, rotation: t.rotation };
                rightDragStartMouse = { x: e.clientX, y: e.clientY };
                return;
            }
            const wrapperRect = canvas.parentElement.getBoundingClientRect();
            const cursorX = e.clientX - wrapperRect.left;
            const cursorY = e.clientY - wrapperRect.top;
            const factor = e.deltaY < 0 ? 1.08 : 0.92;
            zoomCanvasAroundViewportPoint(canvas, factor, cursorX, cursorY);
        }, { passive: false });
    });

    window.addEventListener('mousemove', (e) => {
        if (!isRightDragging || !rightDragCanvas) return;
        if ((e.buttons & 2) !== 2) return;
        e.preventDefault();
        const dx = e.clientX - rightDragStartMouse.x;
        const dy = e.clientY - rightDragStartMouse.y;
        // Gleichgerichtet: Maus nach links => Bild nach links
        const newTx = rightDragStartTransform.tx + dx;
        const newTy = rightDragStartTransform.ty + dy;
        updateCanvasTransform(
            rightDragCanvas,
            newTx,
            newTy,
            rightDragStartTransform.scale,
            rightDragStartTransform.rotation
        );
        rightDragStartTransform.tx = newTx;
        rightDragStartTransform.ty = newTy;
        rightDragStartMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button !== 2) return;
        isRightDragging = false;
        rightDragCanvas = null;
    });

    // --- Panel-Sichtbarkeit ---
    function togglePanel(panel, show) {
        if (!panel) return;
        const allPanels = document.querySelectorAll('.panel');
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            if (show) {
                allPanels.forEach((p) => {
                    if (p !== panel) p.classList.add('hidden');
                });
                panel.classList.remove('hidden');
                document.body.classList.add('has-open-panel');
            } else {
                panel.classList.add('hidden');
                const hasOpenPanel = document.querySelector('.panel:not(.hidden)');
                if (!hasOpenPanel) document.body.classList.remove('has-open-panel');
            }
        } else { // Desktop
            if (show) {
                allPanels.forEach((p) => {
                    if (p !== panel) {
                        p.classList.remove('visible');
                        p.classList.add('hidden');
                    }
                });
                panel.classList.remove('hidden');
                panel.classList.add('visible');
            } else {
                panel.classList.remove('visible');
                panel.classList.add('hidden');
            }
        }
    }

    // Helper für Touch-Support auf Buttons
    function addTouchBtn(elem, callback) {
        elem.addEventListener('click', callback);
        // touchstart entfernt, da dies auf iOS oft zu Problemen führt.
        // 'click' ist dank user-scalable=no schnell genug und zuverlässiger.
    }

    function addOpenSettingsGesture(elem, callback) {
        // Desktop: echtes Doppelklick-Event
        elem.addEventListener('dblclick', (e) => {
            e.preventDefault();
            callback(e);
        });

        // Touch (Handy/iPad): Doppeltipp-Erkennung
        let lastTapAt = 0;
        let lastTapX = 0;
        let lastTapY = 0;
        elem.addEventListener('touchend', (e) => {
            if (!e.changedTouches || e.changedTouches.length === 0) return;
            const touch = e.changedTouches[0];
            const now = Date.now();
            const dt = now - lastTapAt;
            const dx = touch.clientX - lastTapX;
            const dy = touch.clientY - lastTapY;
            const nearSameSpot = (dx * dx + dy * dy) < 400; // ~20px

            if (dt > 60 && dt < 360 && nearSameSpot) {
                e.preventDefault();
                callback(e);
            }

            lastTapAt = now;
            lastTapX = touch.clientX;
            lastTapY = touch.clientY;
        }, { passive: false });
    }

    addTouchBtn(brushBtn, (e) => { 
        e.stopPropagation(); 
        isEraser = false; // Zurück zum Pinsel-Modus
        updateToolButtonStates();
    });
    addOpenSettingsGesture(brushBtn, (e) => {
        e.stopPropagation();
        isEraser = false;
        togglePanel(brushPanel, true);
        updateToolButtonStates();
    });

    if (eraserBtn) {
        addTouchBtn(eraserBtn, (e) => {
            e.stopPropagation();
            isEraser = true; // Radierer aktivieren
            updateToolButtonStates();
        });
        addOpenSettingsGesture(eraserBtn, (e) => {
            e.stopPropagation();
            isEraser = true;
            togglePanel(eraserPanel, true);
            updateToolButtonStates();
        });
    }

    if (fillBtn) {
        addTouchBtn(fillBtn, (e) => {
            e.stopPropagation();
            isFillMode = !isFillMode;
            updateFillButtonState();
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
            persistDrawingLocally(activeUser);
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
            persistDrawingLocally(activeUser);
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
            updateFillButtonState();
        });
    }
    if (gridToggle) {
        gridToggle.addEventListener('change', (e) => {
            gridEnabled = e.target.checked;
            updateGridVisibility();
        });
    }
    if (gridSizeSlider) {
        gridSizeSlider.addEventListener('input', (e) => {
            gridSize = parseInt(e.target.value, 10) || 24;
            updateGridVisibility();
        });
    }
    if (eraserFillToggle) {
        eraserFillToggle.addEventListener('change', (e) => {
            isEraserFillMode = e.target.checked;
            isFillMode = e.target.checked;
            updateFillButtonState();
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
        persistDrawingLocally(activeUser);
        syncDrawingToCloud(activeUser);
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
        if (!drawingDirty[user]) {
            rememberCurrentAsSavedSnapshot(user);
        }
        const token = ++drawRenderToken[user];

        if (!dataURL) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        if (dataURL) {
            const img = new Image();
            img.src = dataURL;
            img.onload = () => {
                if (token !== drawRenderToken[user]) return; // Veraltetes Render-Ergebnis verwerfen
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
        }
    }
    
    function clearCanvas() {
        if (!activeUser) return;
        
        const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
        // Zustand speichern für Undo
        pushUndoSnapshot(activeUser, canvas);

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Leeres Bild + Status speichern
        persistDrawingLocally(activeUser);
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
        Cloud.set(`niklas_status${keySuffix}`, 'green'); // Cloud Save
        updateStatusDots();
    }

    // --- Fullscreen Logik ---
    function enterFullscreen(user) {
        activeUser = user;
        const wrapper = (user === 'niklas') ? wrapperNiklas : wrapperJovelyn;
        
        wrapper.classList.add('fullscreen');
        document.body.classList.add('mode-fullscreen');
        updateToolButtonStates();
        updateFillButtonState();
        updateGridVisibility();
        
        // Status-Logik: Nur auf Grün setzen, wenn ich NICHT der letzte Editor war
        const lastEditor = localStorage.getItem(`${user}_last_editor${keySuffix}`);
        if (lastEditor && lastEditor !== deviceId) {
            localStorage.setItem(`${user}_status${keySuffix}`, 'green');
            Cloud.set(`${user}_status${keySuffix}`, 'green'); // Cloud Save
            updateStatusDots();
        }
        
        // Kurz warten, damit CSS Transition greift, dann Canvas anpassen
        setTimeout(resizeCanvases, 50);
    }

    function exitFullscreen() {
        closeSaveGalleryModal();
        activeUser = null;
        isRightDragging = false;
        rightDragCanvas = null;
        document.querySelectorAll('.canvas-wrapper').forEach(el => el.classList.remove('fullscreen'));
        document.body.classList.remove('mode-fullscreen');
        updateGridVisibility();

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
    addTouchBtn(closeFullscreenBtn, (e) => {
        e.stopPropagation();
        if (activeUser) discardUnsavedChanges(activeUser);
        exitFullscreen();
    });

    addTouchBtn(saveBtn, saveData);
    if (archiveBtn) addTouchBtn(archiveBtn, (e) => { e.stopPropagation(); openSaveGalleryModal(); });
    addTouchBtn(clearBtn, clearCanvas);
    
    if (refreshBtn) {
        addTouchBtn(refreshBtn, (e) => {
            e.stopPropagation();
            drawFromStorage('niklas', true);
            drawFromStorage('jovelyn', true);
            updateStatusDots();
        });
    }
    
    if (globalRefreshBtn) {
        addTouchBtn(globalRefreshBtn, (e) => {
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
    
    // --- Cloud Listener für Bilder & Status ---
    Cloud.on(`jovelyn_drawing${keySuffix}`, () => drawFromStorage('jovelyn', true));
    Cloud.on(`niklas_drawing${keySuffix}`, () => drawFromStorage('niklas', true));
    Cloud.on(`niklas_status${keySuffix}`, updateStatusDots);
    Cloud.on(`jovelyn_status${keySuffix}`, updateStatusDots);

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
    updateToolButtonStates();
    updateFillButtonState();
    updateGridVisibility();
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
            Cloud.set(savedAnswerKey, e.target.value); // Cloud Save
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
    
    // Cloud Listener für Quiz
    Object.keys(wrappers).forEach(user => {
        const key = `quiz_answer_${user}_${dateString}`;
        Cloud.on(key, (val) => {
            if (currentQuizUser === user && document.activeElement !== modalInput) {
                modalInput.value = val || '';
            }
        });
    });

    // Live-Sync für Quiz (optional, damit man sieht wenn der andere schreibt)
    window.addEventListener('storage', (e) => {
        if (e.key.startsWith('quiz_answer_') && e.key.endsWith(dateString)) {
            // Hier könnte man die Antwort des anderen live aktualisieren, wenn gewünscht
        }
    });
}
