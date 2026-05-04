// SensorClient.js
'use strict';

/*
 * SensorClient
 * ============
 *
 * Connects to the bridge WebSocket (default ws://<same-host>:8081) and
 * keeps the latest accelerometer sample in `this.ax/ay/az`.
 *
 * The accelerometer measures the gravity vector (when the phone is roughly
 * still). With a single 3-vector we can recover only TILT — pitch & roll —
 * but not yaw (rotation around gravity is unobservable from gravity alone).
 *
 * Convention: in iOS Core Motion the device frame is
 *     +X right, +Y up (toward home button on top), +Z out of screen.
 * When the phone is held upright and still, the accelerometer reports
 * approximately (0, -1, 0) in g (raw) or (0, +1, 0) for the "gravity" channel
 * depending on sign convention. We don't care about which sign — we just need
 * a unit vector "g_hat" pointing along world-down in device coords.
 *
 * Tilt-only orientation matrix:
 *   We build a rotation R such that R * (0,1,0)^T = -g_hat (the world-up
 *   direction expressed in device frame). Equivalently, R rotates the model's
 *   local up-axis to align with the phone's measured up. Yaw is left at zero.
 *
 *   Formula: rotation about axis = (g_hat × (0,1,0)), angle = acos(-g_hat.y).
 *
 * The matrix is exposed as `this.getTiltMatrix()` in the same column-major
 * 16-element layout used elsewhere in the project (compatible with m4.js).
 */

function SensorClient(opts) {
    opts = opts || {};

    this.url = opts.url || (
        (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host +
        '/sensor-ws'
    );

    console.log('[SensorClient] url =', this.url);

    this.ax = 0;
    this.ay = 0;
    this.az = 0;
    this.connected = false;
    this.lastSampleTime = 0;

    this.alpha = (opts.alpha !== undefined) ? opts.alpha : 0.15;
    this._fx = 0;
    this._fy = 0;
    this._fz = 0;
    this._init = false;

    this._ws = null;
    this._connect();
}

SensorClient.prototype._connect = function () {
    const self = this;
    try {
        self._ws = new WebSocket(self.url);
    } catch (e) {
        console.warn('[SensorClient] cannot construct WebSocket:', e);
        setTimeout(self._connect.bind(self), 2000);
        return;
    }

    self._ws.onopen = function () {
        self.connected = true;
        console.log('[SensorClient] connected to', self.url);
    };

    self._ws.onmessage = function (ev) {
        try {
            const m = JSON.parse(ev.data);
            if (typeof m.ax === 'number') self.ax = m.ax;
            if (typeof m.ay === 'number') self.ay = m.ay;
            if (typeof m.az === 'number') self.az = m.az;
            self.lastSampleTime = m.t || Date.now();

            // Low-pass filter
            if (!self._init) {
                self._fx = self.ax; self._fy = self.ay; self._fz = self.az;
                self._init = true;
            } else {
                const a = self.alpha;
                self._fx = a * self.ax + (1 - a) * self._fx;
                self._fy = a * self.ay + (1 - a) * self._fy;
                self._fz = a * self.az + (1 - a) * self._fz;
            }
        } catch (_) { /* ignore malformed frame */ }
    };

    self._ws.onclose = function () {
        if (self.connected) console.log('[SensorClient] disconnected, retrying...');
        self.connected = false;
        setTimeout(self._connect.bind(self), 1500);
    };

    self._ws.onerror = function () {
        // onclose will fire next; let the reconnect logic handle it.
        try { self._ws.close(); } catch (_) { }
    };
};

/*
 * Build the tilt-only rotation matrix from the smoothed gravity vector.
 *
 * Returns a 16-element column-major Float32Array (compatible with m4.js).
 * If we have no sample yet, returns the identity matrix.
 */
SensorClient.prototype.getTiltMatrix = function () {
    const I = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);

    if (!this._init) return I;

    let gx = this._fx, gy = this._fy, gz = this._fz;
    let len = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (len < 1e-4) return I;
    gx /= len; gy /= len; gz /= len;

    // Determine sign convention from the dominant axis at "rest". We assume the
    // phone is roughly upright when the page first loads; whichever sign of Y
    // we see at startup, we treat as "up". Cheap heuristic: if Y is negative
    // (raw accelerometer convention on iOS is g pointing in -Y when upright),
    // we flip the whole vector so that the resulting "up_in_device" points +Y.
    if (gy < 0) { gx = -gx; gy = -gy; gz = -gz; }

    // Now (gx, gy, gz) approximates "world-up expressed in device coords".
    // We want a rotation R that takes the model-space up axis (0,1,0) onto
    // this vector. Using Rodrigues' formula with axis = (0,1,0) × (gx,gy,gz)
    // and angle = acos((0,1,0) · (gx,gy,gz)) = acos(gy).

    // axis = (0,1,0) × (gx,gy,gz) = (1*gz - 0*gy, 0*gx - 0*gz, 0*gy - 1*gx)
    //                              = (gz, 0, -gx)
    let kx = gz, ky = 0, kz = -gx;
    const klen = Math.sqrt(kx * kx + ky * ky + kz * kz);
    if (klen < 1e-6) {
        // Already aligned (or anti-aligned). cos(angle)=gy: if gy≈1 → identity,
        // if gy≈-1 → 180° rotation around +X (rare; phone upside down).
        if (gy > 0) return I;
        return new Float32Array([
            1, 0, 0, 0,
            0, -1, 0, 0,
            0, 0, -1, 0,
            0, 0, 0, 1,
        ]);
    }
    kx /= klen; ky /= klen; kz /= klen;

    const cosA = Math.max(-1, Math.min(1, gy));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA)); // angle ∈ [0, π]
    const C = 1 - cosA;

    // Rodrigues' rotation matrix around unit axis k (column-major / m4-style)
    const m00 = cosA + kx * kx * C;
    const m01 = ky * kx * C + kz * sinA;
    const m02 = kz * kx * C - ky * sinA;

    const m10 = kx * ky * C - kz * sinA;
    const m11 = cosA + ky * ky * C;
    const m12 = kz * ky * C + kx * sinA;

    const m20 = kx * kz * C + ky * sinA;
    const m21 = ky * kz * C - kx * sinA;
    const m22 = cosA + kz * kz * C;

    return new Float32Array([
        m00, m01, m02, 0,
        m10, m11, m12, 0,
        m20, m21, m22, 0,
        0, 0, 0, 1,
    ]);
};