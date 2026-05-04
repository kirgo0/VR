// main.js
'use strict';

let gl;
let surface;
let shProgram;          // Model shader
let bgProgram;          // Background (webcam) shader
let spaceball;
let stereoCam;

let videoElem;          // <video> element
let videoTexture;       // GL texture sampling the video
let videoReady = false;

let bgQuadBuffer;       // Fullscreen quad position buffer
let bgTexBuffer;        // Fullscreen quad texcoord buffer

// Model center of mass (for rotation around it)
let modelCenter = [0, 0, 0];


function ShaderProgram(name, program) {
    this.name = name;
    this.prog = program;

    this.iAttribVertex = -1;
    this.iColor = -1;
    this.iModelViewMatrix = -1;
    this.iProjectionMatrix = -1;

    this.Use = function () {
        gl.useProgram(this.prog);
    };
}


/* Read current control values from UI sliders */
function readStereoParams() {
    const eyeSep = parseFloat(document.getElementById('eyeSep').value);
    const fovDeg = parseFloat(document.getElementById('fov').value);
    const near = parseFloat(document.getElementById('near').value);
    const conv = parseFloat(document.getElementById('conv').value);

    document.getElementById('eyeSepVal').textContent = eyeSep.toFixed(2);
    document.getElementById('fovVal').textContent = fovDeg.toFixed(0);
    document.getElementById('nearVal').textContent = near.toFixed(1);
    document.getElementById('convVal').textContent = conv.toFixed(1);

    stereoCam.mEyeSeparation = eyeSep;
    stereoCam.mFOV = fovDeg * Math.PI / 180.0;
    stereoCam.mNearClippingDistance = near;
    stereoCam.mConvergence = conv;
}


/* Webcam fullscreen quad — drawn at "zero parallax" (a flat plane behind the model) */
function drawBackground() {
    if (!videoReady) return;

    gl.useProgram(bgProgram.prog);

    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElem);
    } catch (e) {
        return;
    }

    gl.disable(gl.DEPTH_TEST);
    gl.colorMask(true, true, true, true);

    gl.bindBuffer(gl.ARRAY_BUFFER, bgQuadBuffer);
    gl.vertexAttribPointer(bgProgram.iAttribVertex, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(bgProgram.iAttribVertex);

    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexBuffer);
    gl.vertexAttribPointer(bgProgram.iAttribTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(bgProgram.iAttribTexCoord);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.uniform1i(bgProgram.iSampler, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
}


/* Filled polygons (dark) + wireframe overlay for one stereo eye */
function drawStereoEye(projection, modelView) {
    shProgram.Use();
    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, projection);
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, modelView);

    gl.bindBuffer(gl.ARRAY_BUFFER, surface.iVertexBuffer);
    gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribVertex);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, surface.iIndexBuffer);

    // Filled (dark) so wireframe stands out
    gl.uniform4fv(shProgram.iColor, [0.12, 0.12, 0.12, 1.0]);
    surface.Draw();

    // Wireframe (bright) on top
    gl.depthFunc(gl.LEQUAL);
    gl.uniform4fv(shProgram.iColor, [1.0, 1.0, 1.0, 1.0]);
    surface.DrawWireframe();
}


function draw() {
    readStereoParams();

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 1) Webcam first, at zero parallax
    drawBackground();
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 2) Build modelView so the humming-top sits in NEGATIVE parallax
    const trackball = spaceball.getViewMatrix();

    // Rotate around model's center of mass: T(+c) * R * T(-c)
    const toCenter = m4.translation(-modelCenter[0], -modelCenter[1], -modelCenter[2]);
    const fromCenter = m4.translation(modelCenter[0], modelCenter[1], modelCenter[2]);
    let modelLocal = m4.multiply(trackball, toCenter);
    modelLocal = m4.multiply(fromCenter, modelLocal);

    // Push the model in front of convergence -> negative parallax (in front of screen)
    const distance = -(stereoCam.mConvergence - 2.0);
    const pushIntoScene = m4.translation(0, 0, distance);

    let modelView = m4.multiply(pushIntoScene, modelLocal);

    // ---- LEFT EYE (red channel) ----
    let leftProj = stereoCam.calcLeftFrustum();
    let leftMV = m4.multiply(m4.translation(stereoCam.mEyeSeparation / 2, 0, 0), modelView);

    gl.colorMask(true, false, false, true);
    drawStereoEye(leftProj, leftMV);

    gl.clear(gl.DEPTH_BUFFER_BIT);

    // ---- RIGHT EYE (cyan = green + blue) ----
    let rightProj = stereoCam.calcRightFrustum();
    let rightMV = m4.multiply(m4.translation(-stereoCam.mEyeSeparation / 2, 0, 0), modelView);

    gl.colorMask(false, true, true, true);
    drawStereoEye(rightProj, rightMV);

    gl.colorMask(true, true, true, true);
}


function computeCenterOfMass(verticesF32) {
    let cx = 0, cy = 0, cz = 0;
    const n = verticesF32.length / 3;
    for (let i = 0; i < n; i++) {
        cx += verticesF32[i * 3 + 0];
        cy += verticesF32[i * 3 + 1];
        cz += verticesF32[i * 3 + 2];
    }
    return [cx / n, cy / n, cz / n];
}


function initBackground() {
    const bgProg = createProgram(gl, bgVertexShaderSource, bgFragmentShaderSource);
    bgProgram = {
        prog: bgProg,
        iAttribVertex: gl.getAttribLocation(bgProg, 'vertex'),
        iAttribTexCoord: gl.getAttribLocation(bgProg, 'texcoord'),
        iSampler: gl.getUniformLocation(bgProg, 'uSampler'),
    };

    bgQuadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
    ]), gl.STATIC_DRAW);

    bgTexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexBuffer);
    // Mirror X for natural selfie view, flip Y so video isn't upside down
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        1, 1,
        0, 1,
        1, 0,
        0, 0,
    ]), gl.STATIC_DRAW);

    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]));
}


async function startWebcam() {
    videoElem = document.getElementById('webcam');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported — background will be black.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        videoElem.srcObject = stream;

        videoElem.onloadedmetadata = async () => {
            await videoElem.play();
            videoReady = true;
            console.log('Webcam ready:', videoElem.videoWidth, videoElem.videoHeight);
        };
    } catch (err) {
        console.error('Webcam access denied or unavailable:', err);
        document.getElementById('message').innerHTML +=
            `<br><b>Webcam error:</b> ${err.name} — ${err.message}`;
    }
}


function initGL() {
    let prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex = gl.getAttribLocation(prog, 'vertex');
    shProgram.iModelViewMatrix = gl.getUniformLocation(prog, 'ModelViewMatrix');
    shProgram.iProjectionMatrix = gl.getUniformLocation(prog, 'ProjectionMatrix');
    shProgram.iColor = gl.getUniformLocation(prog, 'color');

    let data = {};
    CreateSurfaceData(data, {
        R: 1.0,    // equator radius
        H: 1.5,    // half-height (so total height is 3.0)
        slicesPhi: 64,
        stacksT: 48,
    });

    surface = new Model('ParabolicHummingTop');
    surface.BufferData(data.verticesF32, data.indicesU16);

    modelCenter = computeCenterOfMass(data.verticesF32);

    stereoCam = new StereoCamera(
        14.0,                  // Convergence
        0.7,                   // Eye Separation
        1.0,                   // Aspect Ratio (canvas is 600x600)
        23.0 * Math.PI / 180,  // FOV (radians)
        8.0,                   // Near
        20.0                   // Far
    );

    initBackground();
    startWebcam();

    gl.enable(gl.DEPTH_TEST);
}


function createProgram(gl, vShader, fShader) {
    let vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vShader);
    gl.compileShader(vsh);
    if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
        throw new Error('Error in vertex shader: ' + gl.getShaderInfoLog(vsh));
    }
    let fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fShader);
    gl.compileShader(fsh);
    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
        throw new Error('Error in fragment shader: ' + gl.getShaderInfoLog(fsh));
    }
    let prog = gl.createProgram();
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Link error in program: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
}


function init() {
    let canvas;
    try {
        canvas = document.getElementById('webglcanvas');
        gl = canvas.getContext('webgl');
        if (!gl) throw 'Browser does not support WebGL';
    } catch (e) {
        document.getElementById('canvas-holder').innerHTML =
            '<p>Sorry, could not get a WebGL graphics context.</p>';
        return;
    }

    try {
        initGL();
    } catch (e) {
        document.getElementById('canvas-holder').innerHTML =
            '<p>Sorry, could not initialize the WebGL graphics context: ' + e + '</p>';
        return;
    }

    spaceball = new TrackballRotator(canvas, draw, 0);

    ['eyeSep', 'fov', 'near', 'conv'].forEach(id => {
        document.getElementById(id).addEventListener('input', draw);
    });

    function tick() {
        draw();
        requestAnimationFrame(tick);
    }
    tick();
}