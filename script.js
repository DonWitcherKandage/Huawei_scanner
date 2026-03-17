const canvas = document.getElementById('canvas');
const c = canvas.getContext('2d');
const scanLineEl = document.getElementById('scanLine');

let points = [];
let scanningFingers = {};
let scanProgress = {};
let scanComplete = false; // Track scan completion state
let twoFingerStartTime = null; // Track when 2+ fingers started
const TWO_FINGER_DELAY = 800; // 0.8 second delay for responsive feel
// pointer image for finger markers
const pointerImg = new Image();
pointerImg.src = 'Images/Asset 3.png';
// natural size and visible-center of the PNG (computed onload)
let pointerNatural = { w: 0, h: 0 };
let pointerVisibleCenter = { x: 0, y: 0 };
const pointerAngles = {}; // id -> angle radians

// When the image loads, compute the bounding box of non-transparent pixels
pointerImg.addEventListener('load', () => {
    pointerNatural.w = pointerImg.naturalWidth || pointerImg.width;
    pointerNatural.h = pointerImg.naturalHeight || pointerImg.height;
    try {
        const off = document.createElement('canvas');
        off.width = pointerNatural.w;
        off.height = pointerNatural.h;
        const oc = off.getContext('2d');
        oc.clearRect(0, 0, off.width, off.height);
        oc.drawImage(pointerImg, 0, 0);
        const data = oc.getImageData(0, 0, off.width, off.height).data;
        let minX = off.width, minY = off.height, maxX = 0, maxY = 0;
        let found = false;
        for (let y = 0; y < off.height; y++) {
            for (let x = 0; x < off.width; x++) {
                const i = (y * off.width + x) * 4 + 3; // alpha channel
                const a = data[i];
                if (a > 10) { // threshold
                    found = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (found) {
            pointerVisibleCenter.x = (minX + maxX) / 2;
            pointerVisibleCenter.y = (minY + maxY) / 2;
            // Manual adjustment: move the center point down slightly to better align with finger
            pointerVisibleCenter.y += 8; // Adjust this value as needed
        } else {
            // fallback to geometric center
            pointerVisibleCenter.x = pointerNatural.w / 2;
            pointerVisibleCenter.y = pointerNatural.h / 2 + 8; // Also adjust fallback
        }
    } catch (err) {
        // reading image data can fail in some browser security contexts; fallback to center
        pointerVisibleCenter.x = pointerImg.width / 2;
        pointerVisibleCenter.y = pointerImg.height / 2 + 8; // Manual adjustment for finger centering
    }
});

// particles.js emitter containers mapped by touch identifier
const emitterContainers = {}; // id -> { el, pJSEntry }
const emittersRoot = (() => document.getElementById('particle-emitters') || (() => {
    const root = document.createElement('div');
    root.id = 'particle-emitters';
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
    return root;
})())();
// emitter control
let emittersActive = false;
const EMITTER_SIZE = 360; // px - larger radius per user request
// Connection and performance settings (unused - particles.js used instead)

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
//

// Removed fingerprint line drawing — only rotating pointer image will be drawn now.
//
function loop() {
    // Handle canvas resize
    if (canvas.height !== window.innerHeight || canvas.width !== window.innerWidth) {
        resizeCanvas();
    }

    // Clear canvas completely (no trail effect)
    c.clearRect(0, 0, canvas.width, canvas.height);

    // Update scan progress for each finger
    for (let id in scanningFingers) {
        if (!scanProgress[id]) {
            scanProgress[id] = 0;
        }
        scanProgress[id] = Math.min(1, scanProgress[id] + 0.03);
    }

    // Draw rotating pointer image for each touch point (no fingerprint lines)
    for (let i = 0; i < points.length; i++) {
        const touch = points[i];
        const identifier = touch.identifier || 0;
        const angle = pointerAngles[identifier] || 0;
        if (pointerImg.complete && pointerNatural.w > 0) {
            const size = 64; // image display size (square)
            const scale = size / pointerNatural.w;
            // compute scaled visual-center and draw so that the visual center maps to (0,0)
            const scaledCx = pointerVisibleCenter.x * scale;
            const scaledCy = pointerVisibleCenter.y * scale;
            c.save();
            c.translate(touch.clientX, touch.clientY);
            c.rotate(angle);
            c.drawImage(pointerImg, -scaledCx, -scaledCy, size, size);
            c.restore();
        } else if (pointerImg.complete) {
            // fallback: center the image
            const size = 64;
            c.save();
            c.translate(touch.clientX, touch.clientY);
            c.rotate(angle);
            c.drawImage(pointerImg, -size / 2, -size / 2, size, size);
            c.restore();
        }
        // increment angle slowly
        pointerAngles[identifier] = (pointerAngles[identifier] || 0) + 0.02;
    }

    // Track timing for 2+ finger activation
    if (points.length >= 2 && twoFingerStartTime === null) {
        twoFingerStartTime = Date.now();
    } else if (points.length < 2) {
        twoFingerStartTime = null;
    }

    // Check if all five fingers present and fully scanned (immediate activation)
    let allComplete = false;
    if (points.length === 5) {
        allComplete = true;
        for (let i = 0; i < points.length; i++) {
            const id = points[i].identifier || 0;
            if (!scanProgress[id] || scanProgress[id] < 1) {
                allComplete = false;
                break;
            }
        }
    }

    // Check for 2+ finger delayed activation (fallback activation)
    let twoFingerDelayComplete = false;
    if (points.length >= 2 && twoFingerStartTime !== null && !emittersActive) {
        const timeElapsed = Date.now() - twoFingerStartTime;
        if (timeElapsed >= TWO_FINGER_DELAY) {
            twoFingerDelayComplete = true;
        }
    }

    // Activate emitters when either condition is met: 5-finger complete OR 2+ finger delay
    if ((allComplete || twoFingerDelayComplete) && !emittersActive) {
        // Mark scan as complete for persistence logic
        scanComplete = true;
        
        for (let i = 0; i < points.length; i++) {
            const t = points[i];
            const id = t.identifier || 0;
            createEmitterForId(id);
            const emitter = emitterContainers[id];
            if (emitter && emitter.el) {
                emitter.el.style.left = `${t.clientX}px`;
                emitter.el.style.top = `${t.clientY}px`;
                // Add smooth fade-in with slight delay for each emitter
                setTimeout(() => {
                    if (emitter.el) {
                        emitter.el.classList.add('fade-in');
                    }
                }, i * 100); // 100ms delay between each emitter
            }
        }
        
        // Start scanning line animation after all particles have faded in
        setTimeout(() => {
            if (scanLineEl) {
                scanLineEl.classList.add('active');
            }
        }, (points.length - 1) * 100 + 300); // Wait for all particles to fade in
        
        emittersActive = true;
    }

    // Keep particles active - don't deactivate when fingers are lifted
    // This ensures particles and scanning line persist on screen
    /*
    // Deactivate emitters if condition fails (fingers lifted or progress reset)
    if (!allComplete && emittersActive) {
        for (const id in emitterContainers) {
            const emitter = emitterContainers[id];
            if (emitter && emitter.el) {
                // Fade out smoothly before destroying
                emitter.el.classList.remove('fade-in');
                setTimeout(() => {
                    destroyEmitter(id);
                }, 300); // Wait for fade-out to complete
            } else {
                destroyEmitter(id);
            }
        }
        emittersActive = false;
    }
    */

    // If emitters are active, keep them positioned on the current points
     if (emittersActive) {
        for (let i = 0; i < points.length; i++) {
            const t = points[i];
            const id = t.identifier || 0;
            const emitter = emitterContainers[id];
            if (emitter && emitter.el) {
                emitter.el.style.left = `${t.clientX}px`;
                emitter.el.style.top = `${t.clientY}px`;
            }
        }
    }

    requestAnimationFrame(loop);
}

function positionHandler(e) {
    if (e.type === 'touchstart' || e.type === 'touchmove') {
        points = Array.from(e.touches);
        
        // Track which fingers are being scanned
        const currentIds = {};
        for (let i = 0; i < e.touches.length; i++) {
            const id = e.touches[i].identifier;
            currentIds[id] = true;
            scanningFingers[id] = true;
            if (pointerAngles[id] === undefined) pointerAngles[id] = Math.random() * Math.PI * 2;
        }
        
        // Remove fingers that are no longer touching
        for (let id in scanningFingers) {
            if (!currentIds[id]) {
                delete scanningFingers[id];
                delete scanProgress[id];
                // Only destroy emitter if scan is not complete
                // This preserves particles after 5-finger scan completion
                if (emitterContainers[id] && !scanComplete) {
                    destroyEmitter(id);
                }
                // cleanup pointer angle
                if (pointerAngles[id] !== undefined) delete pointerAngles[id];
            }
        }
        
        e.preventDefault();
    } else if (e.type === 'mousemove') {
        // For desktop testing with mouse
        points = [{ clientX: e.clientX, clientY: e.clientY, identifier: 0 }];
        scanningFingers[0] = true;
    }
}

function clearHandler(e) {
    points = [];
    scanningFingers = {};
    scanProgress = {};
    // Don't destroy emitters or scanning line if scan is complete
    // This preserves particles and scanning animation after hands are lifted
    if (!scanComplete) {
        // destroy all emitters only if scan not complete
        for (const id in emitterContainers) {
            destroyEmitter(id);
        }
        // Hide scanning line if scan not complete
        if (scanLineEl) {
            scanLineEl.classList.remove('active');
        }
    }
    // cleanup pointer angles
    for (const k in pointerAngles) delete pointerAngles[k];
}

// Reset function to make the scan repeatable
function resetScan() {
    // Clear scan complete state
    scanComplete = false;
    
    // Reset emitter state
    emittersActive = false;
    
    // Reset timing state
    twoFingerStartTime = null;
    
    // Clear all particles
    for (const id in emitterContainers) {
        destroyEmitter(id);
    }
    
    // Hide scanning line
    if (scanLineEl) {
        scanLineEl.classList.remove('active');
    }
    
    // Reset all tracking variables
    points = [];
    scanningFingers = {};
    scanProgress = {};
    for (const k in pointerAngles) delete pointerAngles[k];
}

// Add double-tap detection for reset
let lastTapTime = 0;
document.addEventListener('click', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;
    
    // Double tap within 500ms resets the scan
    if (tapLength < 500 && tapLength > 0) {
        resetScan();
        e.preventDefault();
    }
    lastTapTime = currentTime;
});

// Add keyboard shortcut for reset (R key or Space)
document.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R' || e.key === ' ') {
        resetScan();
        e.preventDefault();
    }
});

function createEmitterForId(id) {
    // create container
    const container = document.createElement('div');
    container.className = 'emitter-container';
    container.style.position = 'absolute';
    container.style.left = '0px';
    container.style.top = '0px';
    container.style.width = EMITTER_SIZE + 'px';
    container.style.height = EMITTER_SIZE + 'px';
    container.style.pointerEvents = 'none';
    container.style.transform = 'translate(-50%, -50%)';
    emittersRoot.appendChild(container);

    // unique DOM id for particles.js
    const domId = `pjs-emitter-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    container.id = domId;

    // particles.js config: small particles with line connections
    const cfg = {
        particles: {
            number: { value: 30, density: { enable: false } },
            color: { value: '#9ff' },
            shape: { type: 'circle' },
            opacity: { value: 0.9, anim: { enable: false } },
            size: { value: 3.5, random: true },
            line_linked: { enable: true, distance: Math.floor(EMITTER_SIZE * 0.25), color: '#9ff', opacity: 0.55, width: 1.2 },
            move: { enable: true, speed: 0.9, direction: 'none', out_mode: 'out' }
        },
        interactivity: { detect_on: 'canvas', events: { onhover: { enable: false }, onclick: { enable: false } } },
        retina_detect: true
    };

    // initialize particles.js instance on this container
    /* global particlesJS */
    try {
        particlesJS(domId, cfg);
        emitterContainers[id] = { el: container, domId };
    } catch (err) {
        // fallback: just keep container but no pjs instance
        console.warn('particles.js init failed for emitter', id, err);
        emitterContainers[id] = { el: container, domId: null };
    }
}

function destroyEmitter(id) {
    const e = emitterContainers[id];
    if (!e) return;
    try {
        // particles.js attaches a window.pJSDom entry we can remove
        if (e.domId && window.pJSDom) {
            for (let i = window.pJSDom.length - 1; i >= 0; i--) {
                if (window.pJSDom[i].pJS && window.pJSDom[i].pJS.canvas && window.pJSDom[i].pJS.canvas.el.id === e.domId) {
                    window.pJSDom[i].pJS.fn.vendors.destroypJS();
                    window.pJSDom.splice(i, 1);
                    break;
                }
            }
        }
    } catch (err) {
        // ignore
    }
    // remove element
    if (e.el && e.el.parentNode) e.el.parentNode.removeChild(e.el);
    delete emitterContainers[id];
}

// Particle helpers
/* old custom particle system removed — using particles.js emitters instead */

function init() {
    resizeCanvas();
    
    canvas.addEventListener('mousemove', positionHandler, false);
    canvas.addEventListener('touchstart', positionHandler, false);
    canvas.addEventListener('touchmove', positionHandler, false);
    canvas.addEventListener('touchend', clearHandler, false);
    canvas.addEventListener('touchcancel', clearHandler, false);
    canvas.addEventListener('mouseleave', clearHandler, false);
    
    window.addEventListener('resize', resizeCanvas, false);
    
    loop();
}

// Start the application (called after pressing the access button)
function startApp() {
    const btn = document.getElementById('accessBtn');
    const preload = document.getElementById('preloadBg');
    // create ripple at button center
    if (btn) {
        // full viewport ripple
        const ripple = document.createElement('div');
        ripple.className = 'ripple-full';
        document.body.appendChild(ripple);
        // fade out preload and button together
        if (preload) preload.classList.add('hidden');
        btn.classList.add('hidden');
        // cleanup after animation
        setTimeout(() => { if (ripple && ripple.parentNode) ripple.parentNode.removeChild(ripple); if (preload && preload.parentNode) preload.parentNode.removeChild(preload); if (btn && btn.parentNode) btn.parentNode.removeChild(btn); }, 950);
    } else {
        if (preload) preload.classList.add('hidden');
    }

    // small delay to allow fade-out then initialize
    setTimeout(() => {
        init();
    }, 420);
}

// wire up access button
window.addEventListener('load', () => {
    const btn = document.getElementById('accessBtn');
    if (btn) {
        const tapHandler = (e) => { e.preventDefault(); startApp(); };
        btn.addEventListener('click', tapHandler, false);
        btn.addEventListener('touchstart', tapHandler, false);
    }
}, false);