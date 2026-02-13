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
}

function initPaintApp() {
    // --- Canvas-Setup ---
    const myCanvas = document.getElementById('niklas-canvas');
    const friendCanvas = document.getElementById('jovelyn-canvas');
    const wrapperNiklas = document.getElementById('wrapper-niklas');
    const wrapperJovelyn = document.getElementById('wrapper-jovelyn');
    const myCtx = myCanvas.getContext('2d');
    const friendCtx = friendCanvas.getContext('2d');

    // Canvas-Größe an den Container anpassen
    function resizeCanvases() {
        [myCanvas, friendCanvas].forEach(canvas => {
            const wrapper = canvas.parentElement;
            const infoHeight = canvas.previousElementSibling ? canvas.previousElementSibling.offsetHeight : 0;
            const newWidth = wrapper.clientWidth;
            const newHeight = wrapper.clientHeight - infoHeight;

            // Nur neu zeichnen, wenn sich die Größe ändert, um Flackern zu vermeiden
            if (canvas.width !== newWidth || canvas.height !== newHeight) {
                canvas.width = newWidth;
                canvas.height = newHeight;
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

    // --- DOM-Elemente ---
    const brushBtn = document.getElementById('brush-btn');
    const colorBtn = document.getElementById('color-btn');
    const saveBtn = document.getElementById('save-btn');
    const clearBtn = document.getElementById('clear-btn');
    const closeFullscreenBtn = document.getElementById('close-fullscreen-btn');
    const brushPanel = document.getElementById('brush-panel');
    const colorPanel = document.getElementById('color-panel');
    const brushBackBtn = document.getElementById('brush-back-btn');
    const colorBackBtn = document.getElementById('color-back-btn');
    const brushSizeSlider = document.getElementById('brush-size');
    const brushSizeValue = document.getElementById('brush-size-value');
    const brushOpacitySlider = document.getElementById('brush-opacity');
    const brushOpacityValue = document.getElementById('brush-opacity-value');
    const colorPalette = document.getElementById('color-palette');

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
        
        isDrawing = true;
        const canvas = e.target; // Das Canvas, auf das geklickt wurde
        const pos = getEventPosition(canvas, e);
        [lastX, lastY] = [pos.x, pos.y];
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault(); // Verhindert Scrollen während des Zeichnens

        const canvas = e.target;
        const ctx = canvas.getContext('2d');
        const pos = getEventPosition(canvas, e);
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.globalAlpha = brushOpacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.stroke();
        [lastX, lastY] = [pos.x, pos.y];
    }

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        // Pfad beenden nicht zwingend nötig bei dieser Logik, aber sauber
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
            } else {
                panel.classList.add('hidden');
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
        elem.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Verhindert Maus-Emulation und macht es snappier
            callback(e);
        }, { passive: false });
    }

    addTouchBtn(brushBtn, (e) => { e.stopPropagation(); togglePanel(brushPanel, true); });
    addTouchBtn(colorBtn, (e) => { e.stopPropagation(); togglePanel(colorPanel, true); });
    addTouchBtn(brushBackBtn, () => togglePanel(brushPanel, false));
    addTouchBtn(colorBackBtn, () => togglePanel(colorPanel, false));
    
    document.body.addEventListener('click', (e) => {
        if (window.innerWidth >= 768) {
            if (!e.target.closest('.panel')) {
                togglePanel(brushPanel, false);
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
        localStorage.setItem(`${activeUser}_drawing`, dataURL);
        
        // Status auf ROT setzen und mich als letzten Editor speichern
        localStorage.setItem(`${activeUser}_status`, 'red');
        localStorage.setItem(`${activeUser}_last_editor`, deviceId);
        updateStatusDots();
        
        alert('Bild gespeichert und für die andere Person sichtbar!');
    }

    function drawFromStorage(user) {
        const canvas = (user === 'niklas') ? myCanvas : friendCanvas;
        const ctx = (user === 'niklas') ? myCtx : friendCtx;
        const dataURL = localStorage.getItem(`${user}_drawing`);
        
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
        if (confirm('Möchtest du deine Zeichnung wirklich löschen?')) {
            const canvas = (activeUser === 'niklas') ? myCanvas : friendCanvas;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            saveData(); // Speichert den leeren Zustand
        }
    }
    
    function updateStatusDots() {
        const niklasStatus = localStorage.getItem('niklas_status') || 'red';
        const jovelynStatus = localStorage.getItem('jovelyn_status') || 'red';
        document.getElementById('niklas-status').className = `status-dot ${niklasStatus}`;
        document.getElementById('jovelyn-status').className = `status-dot ${jovelynStatus}`;
    }
    
    function markAsSeen() {
        // Wir markieren einfach alles als gesehen, wenn die App öffnet (optional)
        localStorage.setItem('niklas_status', 'green');
        updateStatusDots();
    }

    // --- Fullscreen Logik ---
    function enterFullscreen(user) {
        activeUser = user;
        const wrapper = (user === 'niklas') ? wrapperNiklas : wrapperJovelyn;
        
        wrapper.classList.add('fullscreen');
        document.body.classList.add('mode-fullscreen');
        
        // Status-Logik: Nur auf Grün setzen, wenn ich NICHT der letzte Editor war
        const lastEditor = localStorage.getItem(`${user}_last_editor`);
        if (lastEditor && lastEditor !== deviceId) {
            localStorage.setItem(`${user}_status`, 'green');
            updateStatusDots();
        }
        
        // Kurz warten, damit CSS Transition greift, dann Canvas anpassen
        setTimeout(resizeCanvases, 50);
    }

    function exitFullscreen() {
        activeUser = null;
        document.querySelectorAll('.canvas-wrapper').forEach(el => el.classList.remove('fullscreen'));
        document.body.classList.remove('mode-fullscreen');

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

    window.addEventListener('storage', (e) => {
        if (e.key === 'jovelyn_drawing') drawFromStorage('jovelyn');
        if (e.key === 'niklas_drawing') drawFromStorage('niklas');
        if (e.key.endsWith('_status')) updateStatusDots();
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
