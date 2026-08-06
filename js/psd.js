/* ============================================================================
   js/psd.js — PSD read/write (TRLE.PSD)

   Wraps ag-psd. Two things this module exists to solve:

   1. WEIGHT. The ag-psd bundle is ~830 KB (≈172 KB over the wire) — comparable
      to the whole rest of AtlasTool's own JS. It used to load eagerly on every
      page load, so people who only ever touch PNG paid for it. It is now
      LAZY-LOADED on first PSD use, exactly like Babylon in preview3d.js. The
      version is PINNED: an unpinned CDN URL floats to whatever npm tags latest,
      and a breaking release would silently break export in production.

   2. BLOCKING. readPsd and writePsd are both synchronous and CPU-heavy, which
      collides with the hard "never encode/serialise on the main thread" rule in
      PERFORMANCE.md. A five-layer 4096² atlas is seconds of frozen UI. So the
      work runs in a Worker built from a Blob URL that importScripts() the CDN
      bundle. We exchange ImageData rather than canvases — ag-psd's `useImageData`
      read option and its `imageData` layer field mean the worker never needs
      canvas support, and ImageData's backing buffer is transferable, so handing
      pixels across costs no copy.

   file:// gotcha (same family as the tutorial.js one): a blob: worker there gets
   an opaque origin and importScripts() of an https: URL is blocked. So there is
   a main-thread fallback that loads the bundle with a <script> tag and does the
   work inline. Slower and it janks, but it works when the tool is opened off
   disk instead of served.
============================================================================ */
window.TRLE = window.TRLE || {};

TRLE.PSD = (function () {
    'use strict';

    // Pinned. Do not float this to @latest — see header.
    const AG_PSD_CDN = 'https://cdn.jsdelivr.net/npm/ag-psd@31.0.2/dist/bundle.js';

    /* ---- File sniffing ---------------------------------------------------
       PSD's MIME type is as unreliable as TGA's (often empty, sometimes
       image/vnd.adobe.photoshop), so extension first. .psb is the large-document
       variant and ag-psd reads it with the same entry point. */
    function isPSDFile(file) {
        return /\.ps[bd]$/i.test(file.name || '') ||
               /photoshop/i.test(file.type || '');
    }

    /* ---- Worker ----------------------------------------------------------
       Built from a Blob so there's no extra file to ship and no build step.
       One worker is reused for every job; jobs are tagged with an id because
       nothing stops two imports overlapping. */
    const WORKER_SRC = `
        importScripts(${JSON.stringify(AG_PSD_CDN)});

        // ag-psd only auto-wires its canvas factory when \`document\` exists, and
        // in a worker it doesn't — so readPsd's internal createImageData() throws
        // and every read silently falls back to the blocking main-thread path.
        // OffscreenCanvas + the ImageData constructor are the worker equivalents.
        // (Without this the worker "works" for writes and quietly never runs a
        // read, which is exactly the case the validator now pins down.)
        self.agPsd.initializeCanvas(
            (w, h) => new OffscreenCanvas(Math.max(1, w || 1), Math.max(1, h || 1)),
            (w, h) => new ImageData(Math.max(1, w || 1), Math.max(1, h || 1))
        );

        // Flatten PSD groups into a plain list. Groups carry no pixels of their
        // own, so only leaves with imageData are worth returning.
        function flatten(children, out, prefix) {
            for (const layer of children || []) {
                const name = (prefix ? prefix + '/' : '') + (layer.name || '');
                if (layer.children && layer.children.length) {
                    flatten(layer.children, out, name);
                } else if (layer.imageData) {
                    out.push({
                        name: name,
                        width: layer.imageData.width,
                        height: layer.imageData.height,
                        data: layer.imageData.data,
                        left: layer.left || 0,
                        top: layer.top || 0,
                        hidden: !!layer.hidden,
                        opacity: layer.opacity == null ? 1 : layer.opacity,
                        blendMode: layer.blendMode || 'normal'
                    });
                }
            }
            return out;
        }

        self.onmessage = function (e) {
            const msg = e.data;
            try {
                if (msg.op === 'read') {
                    const psd = self.agPsd.readPsd(msg.buffer, {
                        useImageData: true,   // no canvas needed in here
                        skipThumbnail: true   // we never show the embedded preview
                    });
                    const layers = flatten(psd.children, [], '');
                    const composite = psd.imageData ? {
                        width: psd.imageData.width,
                        height: psd.imageData.height,
                        data: psd.imageData.data
                    } : null;
                    const transfer = layers.map(l => l.data.buffer);
                    if (composite) transfer.push(composite.data.buffer);
                    self.postMessage({
                        id: msg.id, ok: true,
                        result: { width: psd.width, height: psd.height, composite: composite, layers: layers }
                    }, transfer);
                } else if (msg.op === 'write') {
                    const toPixels = (p) => ({ data: p.data, width: p.width, height: p.height });
                    const doc = {
                        width: msg.width,
                        height: msg.height,
                        imageData: msg.composite ? toPixels(msg.composite) : undefined,
                        children: msg.layers.map(l => ({
                            name: l.name,
                            imageData: toPixels(l),
                            // Explicit bounds: with no canvas to measure, ag-psd
                            // has nothing else to infer the layer rect from.
                            left: 0, top: 0, right: l.width, bottom: l.height
                        }))
                    };
                    const buf = self.agPsd.writePsd(doc, { generateThumbnail: false });
                    self.postMessage({ id: msg.id, ok: true, result: buf }, [buf]);
                }
            } catch (err) {
                self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
            }
        };
    `;

    let _worker = null;          // live Worker, or null if unavailable/failed
    let _workerDead = false;     // true once we've decided to use the fallback
    let _jobId = 0;
    const _jobs = new Map();

    function getWorker() {
        if (_workerDead) return null;
        if (_worker) return _worker;
        try {
            const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
            _worker = new Worker(url);
            URL.revokeObjectURL(url);
            _worker.onmessage = (e) => {
                const job = _jobs.get(e.data.id);
                if (!job) return;
                _jobs.delete(e.data.id);
                e.data.ok ? job.resolve(e.data.result) : job.reject(new Error(e.data.error));
            };
            // importScripts failing (file://, offline, CDN down) surfaces here.
            _worker.onerror = () => { killWorker(new Error('PSD worker failed to start')); };
            return _worker;
        } catch (err) {
            _workerDead = true;
            return null;
        }
    }

    /* Retire the worker and fail every job still waiting on it, so callers can
       retry on the main-thread path instead of hanging forever. */
    function killWorker(err) {
        _workerDead = true;
        if (_worker) { try { _worker.terminate(); } catch (e) {} _worker = null; }
        for (const [, job] of _jobs) job.reject(err);
        _jobs.clear();
    }

    function runInWorker(msg, transfer) {
        const worker = getWorker();
        if (!worker) return Promise.reject(new Error('no worker'));
        return new Promise((resolve, reject) => {
            msg.id = ++_jobId;
            _jobs.set(msg.id, { resolve, reject });
            worker.postMessage(msg, transfer || []);
        });
    }

    /* ---- Main-thread fallback -------------------------------------------- */
    let _scriptPromise = null;
    function loadAgPsd() {
        if (window.agPsd) return Promise.resolve(window.agPsd);
        if (_scriptPromise) return _scriptPromise;
        _scriptPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = AG_PSD_CDN; s.async = true;
            s.onload  = () => window.agPsd ? resolve(window.agPsd) : reject(new Error('ag-psd global missing'));
            s.onerror = () => { _scriptPromise = null; reject(new Error('Could not load the PSD library — check your connection.')); };
            document.head.appendChild(s);
        });
        return _scriptPromise;
    }

    /* ---- Pixel helpers ---------------------------------------------------- */
    function pixelsToCanvas(p) {
        const c = document.createElement('canvas');
        c.width = p.width; c.height = p.height;
        const data = p.data instanceof Uint8ClampedArray ? p.data : new Uint8ClampedArray(p.data);
        c.getContext('2d').putImageData(new ImageData(data, p.width, p.height), 0, 0);
        return c;
    }

    function canvasToPixels(canvas) {
        const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        return { data: img.data, width: img.width, height: img.height };
    }

    /* Layers land at their own offset inside the document; AtlasTool wants every
       layer as a full-size image so it can be sliced on the same grid as the
       composite. Pad anything smaller than the document into place. */
    function padToDocument(layer, docW, docH) {
        if (layer.left === 0 && layer.top === 0 && layer.width === docW && layer.height === docH) {
            return pixelsToCanvas(layer);
        }
        const c = document.createElement('canvas');
        c.width = docW; c.height = docH;
        c.getContext('2d').drawImage(pixelsToCanvas(layer), layer.left, layer.top);
        return c;
    }

    /* ---- Public: read ----------------------------------------------------- */
    /* Resolves to { width, height, composite, layers } where `composite` is a
       canvas (or null when the file was saved without "Maximize Compatibility")
       and `layers` is [{ name, canvas, hidden, opacity, blendMode }] with every
       canvas padded to full document size. */
    function read(file) {
        return file.arrayBuffer().then(buf => {
            const decode = (raw) => ({
                width: raw.width,
                height: raw.height,
                composite: raw.composite ? pixelsToCanvas(raw.composite) : null,
                layers: raw.layers.map(l => ({
                    name: l.name,
                    canvas: padToDocument(l, raw.width, raw.height),
                    hidden: l.hidden,
                    opacity: l.opacity,
                    blendMode: l.blendMode
                }))
            });

            return runInWorker({ op: 'read', buffer: buf }, [buf])
                .then(decode)
                .catch(() => {
                    // Worker unavailable (file://) or crashed — do it inline.
                    // Re-read the buffer: the first one was transferred away.
                    return file.arrayBuffer().then(buf2 => loadAgPsd().then(agPsd => {
                        const psd = agPsd.readPsd(buf2, { useImageData: true, skipThumbnail: true });
                        const layers = [];
                        (function walk(children, prefix) {
                            for (const layer of children || []) {
                                const name = (prefix ? prefix + '/' : '') + (layer.name || '');
                                if (layer.children && layer.children.length) walk(layer.children, name);
                                else if (layer.imageData) layers.push({
                                    name,
                                    width: layer.imageData.width, height: layer.imageData.height,
                                    data: layer.imageData.data,
                                    left: layer.left || 0, top: layer.top || 0,
                                    hidden: !!layer.hidden,
                                    opacity: layer.opacity == null ? 1 : layer.opacity,
                                    blendMode: layer.blendMode || 'normal'
                                });
                            }
                        })(psd.children, '');
                        return decode({
                            width: psd.width, height: psd.height,
                            composite: psd.imageData || null,
                            layers
                        });
                    }));
                });
        });
    }

    /* ---- Public: write ---------------------------------------------------- */
    /* `layers` is [{ name, canvas }]; `composite` is the flattened canvas stored
       as the document preview (what other software shows before it parses
       layers). Resolves to a Blob ready for the export ZIP. */
    function write(opts) {
        const width  = opts.width;
        const height = opts.height;
        const composite = opts.composite ? canvasToPixels(opts.composite) : null;
        const layers = (opts.layers || []).map(l => {
            const p = canvasToPixels(l.canvas);
            p.name = l.name;
            return p;
        });

        const transfer = layers.map(l => l.data.buffer);
        if (composite) transfer.push(composite.data.buffer);

        const toBlob = (buf) => new Blob([buf], { type: 'image/vnd.adobe.photoshop' });

        return runInWorker({ op: 'write', width, height, composite, layers }, transfer)
            .then(toBlob)
            .catch(() => loadAgPsd().then(agPsd => {
                // Fallback re-reads pixels: the ImageData buffers above were
                // transferred to the worker and are detached now.
                const doc = {
                    width, height,
                    canvas: opts.composite || undefined,
                    children: (opts.layers || []).map(l => ({ name: l.name, canvas: l.canvas }))
                };
                return toBlob(agPsd.writePsd(doc, { generateThumbnail: false }));
            }));
    }

    return { isPSDFile, read, write, loadAgPsd };
})();
