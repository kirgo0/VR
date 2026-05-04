// bridge-server/server.js
//
// HTTP + WebSocket bridge for PA#2.
//
// Works with:
//   ngrok http 8080
//
// Public URLs become:
//   https://xxxx.ngrok-free.app/          -> web page
//   https://xxxx.ngrok-free.app/sensor    -> Sensor Logger HTTP POST
//   wss://xxxx.ngrok-free.app/sensor-ws   -> browser WebSocket
//

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8080', 10);
const PUSH_INTERVAL = 20;

// -------------------------------------------------------------------------
// In-memory sensor state
// -------------------------------------------------------------------------

let ax = 0;
let ay = 0;
let az = 0;
let lastUpdate = 0;
let postCount = 0;

// -------------------------------------------------------------------------
// Sensor payload extraction
// -------------------------------------------------------------------------

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function toFiniteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function extract(body) {
    // Sensor Logger style:
    // {
    //   payload: [
    //     { name: "accelerometer", values: { x, y, z } },
    //     { name: "gravity", values: { x, y, z } }
    //   ]
    // }
    if (body && Array.isArray(body.payload)) {
        let preferred = null;
        let fallback = null;

        for (const m of body.payload) {
            const name = String(m.name || '').toLowerCase();
            const values = m.values;

            if (!values) continue;

            const x = toFiniteNumber(values.x);
            const y = toFiniteNumber(values.y);
            const z = toFiniteNumber(values.z);

            if (x === null || y === null || z === null) continue;

            if (name === 'gravity') {
                preferred = { x, y, z };
            }

            if (name === 'accelerometer') {
                fallback = { x, y, z };
            }
        }

        return preferred || fallback;
    }

    // SensorLog style:
    // {
    //   "accelerometerAccelerationX(G)": "...",
    //   "accelerometerAccelerationY(G)": "...",
    //   "accelerometerAccelerationZ(G)": "..."
    // }
    if (body && typeof body === 'object') {
        const sx = body['accelerometerAccelerationX(G)'];
        const sy = body['accelerometerAccelerationY(G)'];
        const sz = body['accelerometerAccelerationZ(G)'];

        if (sx !== undefined && sy !== undefined && sz !== undefined) {
            const x = toFiniteNumber(sx);
            const y = toFiniteNumber(sy);
            const z = toFiniteNumber(sz);

            if (x !== null && y !== null && z !== null) {
                return { x, y, z };
            }
        }

        // Generic testing fallback:
        // { x, y, z } or { ax, ay, az }
        const gx = body.x ?? body.ax;
        const gy = body.y ?? body.ay;
        const gz = body.z ?? body.az;

        const x = toFiniteNumber(gx);
        const y = toFiniteNumber(gy);
        const z = toFiniteNumber(gz);

        if (x !== null && y !== null && z !== null) {
            return { x, y, z };
        }
    }

    return null;
}

// -------------------------------------------------------------------------
// Static file serving
// -------------------------------------------------------------------------

const STATIC_ROOT = path.resolve(__dirname, '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.gpu': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath === '/' || urlPath === '') {
        urlPath = '/index.html';
    }

    const filePath = path.normalize(path.join(STATIC_ROOT, urlPath));

    if (!filePath.startsWith(STATIC_ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found: ' + urlPath);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();

        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });

        fs.createReadStream(filePath).pipe(res);
    });
}

// -------------------------------------------------------------------------
// HTTP server
// -------------------------------------------------------------------------

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // POST /sensor — Sensor Logger pushes here.
    if (req.method === 'POST' && urlPath === '/sensor') {
        const chunks = [];
        let total = 0;

        req.on('data', chunk => {
            total += chunk.length;

            if (total > 1024 * 1024) {
                res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Payload too large');
                req.destroy();
                return;
            }

            chunks.push(chunk);
        });

        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                const body = raw ? JSON.parse(raw) : {};
                const v = extract(body);

                if (v) {
                    ax = v.x;
                    ay = v.y;
                    az = v.z;
                    lastUpdate = Date.now();
                    postCount++;

                    broadcastSensor();
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    ok: !!v,
                    ax,
                    ay,
                    az,
                    lastUpdate,
                    postCount,
                    wsClients: wss.clients.size,
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Bad JSON: ' + e.message);
            }
        });

        return;
    }

    // GET /sensor — browser sanity check.
    if (req.method === 'GET' && urlPath === '/sensor') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            ax,
            ay,
            az,
            lastUpdate,
            ageMs: lastUpdate ? Date.now() - lastUpdate : null,
            postCount,
            wsClients: wss.clients.size,
        }));
        return;
    }

    // Optional diagnostic route.
    if (req.method === 'GET' && urlPath === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            ok: true,
            httpPort: HTTP_PORT,
            wsPath: '/sensor-ws',
            staticRoot: STATIC_ROOT,
            postCount,
            wsClients: wss.clients.size,
        }));
        return;
    }

    if (req.method === 'GET') {
        serveStatic(req, res);
        return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
});

// -------------------------------------------------------------------------
// WebSocket server on SAME server/port, path /sensor-ws
// -------------------------------------------------------------------------

const wss = new WebSocketServer({
    server,
    path: '/sensor-ws',
});

wss.on('connection', (ws, req) => {
    console.log(`[bridge] WS client connected: ${req.socket.remoteAddress}`);

    // Send current sample immediately after connection.
    ws.send(JSON.stringify({
        ax,
        ay,
        az,
        t: Date.now(),
        lastUpdate,
    }));

    ws.on('close', () => {
        console.log('[bridge] WS client disconnected');
    });
});

function broadcastSensor() {
    const msg = JSON.stringify({
        ax,
        ay,
        az,
        t: Date.now(),
        lastUpdate,
    });

    for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
            client.send(msg);
        }
    }
}

// Optional steady fan-out. This keeps your previous behavior.
// Even if Sensor Logger posts once per second, the browser receives repeated
// latest samples every 20 ms.
setInterval(() => {
    if (wss.clients.size === 0) return;
    broadcastSensor();
}, PUSH_INTERVAL);

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------

server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[bridge] HTTP + WS listening on http://0.0.0.0:${HTTP_PORT}`);
    console.log(`[bridge] Static app:     http://localhost:${HTTP_PORT}/`);
    console.log(`[bridge] Sensor POST:    http://localhost:${HTTP_PORT}/sensor`);
    console.log(`[bridge] Sensor GET:     http://localhost:${HTTP_PORT}/sensor`);
    console.log(`[bridge] Browser WS:     ws://localhost:${HTTP_PORT}/sensor-ws`);
    console.log(`[bridge] Static root:    ${STATIC_ROOT}`);
});