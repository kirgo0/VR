'use strict';

let gl;
let surface;
let soundSphere;
let shProgram;
let bgProgram;
let spaceball;
let stereoCam;

let videoElem;
let videoTexture;
let videoReady = false;

let bgQuadBuffer;
let bgTexBuffer;

let modelCenter = [0, 0, 0];

let sensorClient;
let audioController;

let sourcePosition = [0, 0, 0];
let sourceAngle = 0;


function ShaderProgram(name, program) {
    this.name = name;
    this.prog = program;

    this.iAttribVertex = -1;
    this.iColor = -1;
    this.iModelViewMatrix = -1;
    this.iProjectionMatrix = -1;

    this.Use = function () { gl.useProgram(this.prog); };
}


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


function readAudioUiParams() {
    const filterFreq = parseFloat(document.getElementById('filterFreq').value);
    const filterGain = parseFloat(document.getElementById('filterGain').value);
    const radius = parseFloat(document.getElementById('sourceRadius').value);
    const height = parseFloat(document.getElementById('sourceHeight').value);

    document.getElementById('filterFreqVal').textContent = filterFreq.toFixed(0) + ' Hz';
    document.getElementById('filterGainVal').textContent =
        (filterGain >= 0 ? '+' : '') + filterGain.toFixed(0) + ' dB';
    document.getElementById('sourceRadiusVal').textContent = radius.toFixed(2);
    document.getElementById('sourceHeightVal').textContent = height.toFixed(2);

    if (audioController && audioController.started) {
        audioController.setFilterParams(filterFreq, filterGain, 0.8);
        audioController.setFilterEnabled(document.getElementById('enableLowShelf').checked);
    }

    return { radius, height };
}


function updateSensorStatus() {
    if (!sensorClient) return;

    const stateEl = document.getElementById('sensorState');
    const fresh = (Date.now() - sensorClient.lastSampleTime) < 1000;

    if (sensorClient.connected && fresh) {
        stateEl.textContent = 'connected';
        stateEl.className = 'ok';
    } else if (sensorClient.connected) {
        stateEl.textContent = 'no samples';
        stateEl.className = 'bad';
    } else {
        stateEl.textContent = 'disconnected';
        stateEl.className = 'bad';
    }

    document.getElementById('axVal').textContent = sensorClient.ax.toFixed(2);
    document.getElementById('ayVal').textContent = sensorClient.ay.toFixed(2);
    document.getElementById('azVal').textContent = sensorClient.az.toFixed(2);

    document.getElementById('sxVal').textContent = sourcePosition[0].toFixed(2);
    document.getElementById('syVal').textContent = sourcePosition[1].toFixed(2);
    document.getElementById('szVal').textContent = sourcePosition[2].toFixed(2);
}


function updateSoundSourcePosition() {
    const params = readAudioUiParams();

    const useTilt = document.getElementById('useTilt').checked;

    /*
     * Tangible interface mapping:
     *
     * The phone tilt controls the angular position of the sound source.
     * ax and ay are used as a 2D control vector.
     *
     * When the sensor is unavailable, the source slowly rotates automatically
     * so the scene is still demonstrable on desktop.
     */
    if (useTilt && sensorClient && sensorClient._init) {
        const ax = sensorClient.ax;
        const ay = sensorClient.ay;

        sourceAngle = Math.atan2(ax, ay);
    } else {
        sourceAngle += 0.01;
    }

    const x = modelCenter[0] + params.radius * Math.cos(sourceAngle);
    const y = modelCenter[1] + params.height;
    const z = modelCenter[2] + params.radius * Math.sin(sourceAngle);

    sourcePosition[0] = x;
    sourcePosition[1] = y;
    sourcePosition[2] = z;

    /*
     * WebAudio listener coordinates are not the same as model coordinates after
     * we push the WebGL model into the scene. We use the same scene offset for
     * the audio source so the panner position corresponds to the visible sphere.
     */
    const distance = -(stereoCam.mConvergence - 2.0);

    if (audioController && audioController.started) {
        audioController.setSourcePosition(x, y, z + distance);
    }
}


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


function drawModel(model, color, projection, modelView) {
    shProgram.Use();

    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, projection);
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, modelView);

    gl.bindBuffer(gl.ARRAY_BUFFER, model.iVertexBuffer);
    gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribVertex);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, model.iIndexBuffer);

    gl.uniform4fv(shProgram.iColor, color);
    model.Draw();
}


function drawSurfaceWireframe(projection, modelView) {
    shProgram.Use();

    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, projection);
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, modelView);

    gl.bindBuffer(gl.ARRAY_BUFFER, surface.iVertexBuffer);
    gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribVertex);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, surface.iIndexBuffer);

    gl.depthFunc(gl.LEQUAL);
    gl.uniform4fv(shProgram.iColor, [1.0, 1.0, 1.0, 1.0]);
    surface.DrawWireframe();
}


function drawStereoEye(projection, eyeViewMatrix) {
    /*
     * The surface patch stays still.
     * No phone tilt and no trackball rotation are applied to the surface.
     */
    const surfaceModel = m4.identity();

    const surfaceMV = m4.multiply(eyeViewMatrix, surfaceModel);

    drawModel(surface, [0.12, 0.12, 0.12, 1.0], projection, surfaceMV);
    drawSurfaceWireframe(projection, surfaceMV);

    /*
     * The red sphere is the moving sound source.
     * It rotates around the geometrical center of the patch.
     */
    let sphereModel = m4.translation(sourcePosition[0], sourcePosition[1], sourcePosition[2]);
    const sphereMV = m4.multiply(eyeViewMatrix, sphereModel);

    drawModel(soundSphere, [1.0, 0.08, 0.04, 1.0], projection, sphereMV);
}


function draw() {
    readStereoParams();
    updateSoundSourcePosition();
    updateSensorStatus();

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawBackground();
    gl.clear(gl.DEPTH_BUFFER_BIT);

    /*
     * For the spatial audio task the object does not rotate.
     * The trackball is still reused as a view-control helper only.
     */
    const viewRotation = spaceball ? spaceball.getViewMatrix() : m4.identity();

    const distance = -(stereoCam.mConvergence - 2.0);
    const pushIntoScene = m4.translation(0, 0, distance);
    const baseView = m4.multiply(pushIntoScene, viewRotation);

    const leftProj = stereoCam.calcLeftFrustum();
    const leftView = m4.multiply(m4.translation(stereoCam.mEyeSeparation / 2, 0, 0), baseView);

    gl.colorMask(true, false, false, true);
    drawStereoEye(leftProj, leftView);

    gl.clear(gl.DEPTH_BUFFER_BIT);

    const rightProj = stereoCam.calcRightFrustum();
    const rightView = m4.multiply(m4.translation(-stereoCam.mEyeSeparation / 2, 0, 0), baseView);

    gl.colorMask(false, true, true, true);
    drawStereoEye(rightProj, rightView);

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

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255])
    );
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
    const prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex = gl.getAttribLocation(prog, 'vertex');
    shProgram.iModelViewMatrix = gl.getUniformLocation(prog, 'ModelViewMatrix');
    shProgram.iProjectionMatrix = gl.getUniformLocation(prog, 'ProjectionMatrix');
    shProgram.iColor = gl.getUniformLocation(prog, 'color');

    const surfaceData = {};
    CreateSurfaceData(surfaceData, {
        R: 1.0,
        H: 1.5,
        slicesPhi: 64,
        stacksT: 48
    });

    surface = new Model('ParabolicHummingTop');
    surface.BufferData(surfaceData.verticesF32, surfaceData.indicesU16);

    modelCenter = computeCenterOfMass(surfaceData.verticesF32);

    const sphereData = {};
    CreateSphereData(sphereData, {
        radius: 0.13,
        slices: 32,
        stacks: 16
    });

    soundSphere = new Model('SoundSourceSphere');
    soundSphere.BufferData(sphereData.verticesF32, sphereData.indicesU16);

    stereoCam = new StereoCamera(
        14.0,
        0.7,
        1.0,
        23.0 * Math.PI / 180,
        8.0,
        20.0
    );

    initBackground();
    startWebcam();

    gl.enable(gl.DEPTH_TEST);
}


function createProgram(gl, vShader, fShader) {
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vShader);
    gl.compileShader(vsh);

    if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
        throw new Error('Vertex shader: ' + gl.getShaderInfoLog(vsh));
    }

    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fShader);
    gl.compileShader(fsh);

    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
        throw new Error('Fragment shader: ' + gl.getShaderInfoLog(fsh));
    }

    const prog = gl.createProgram();

    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Link error: ' + gl.getProgramInfoLog(prog));
    }

    return prog;
}


function initAudioControls() {
    const audioElem = document.getElementById('music');

    audioController = new AudioController(audioElem, {
        filterFrequency: parseFloat(document.getElementById('filterFreq').value),
        filterGain: parseFloat(document.getElementById('filterGain').value),
        filterQ: 0.8
    });

    document.getElementById('playAudio').addEventListener('click', async () => {
        try {
            await audioController.play();
            audioController.setFilterEnabled(document.getElementById('enableLowShelf').checked);
            readAudioUiParams();
        } catch (err) {
            console.error('Audio start failed:', err);
            document.getElementById('message').innerHTML +=
                `<br><b>Audio error:</b> ${err.name || 'Error'} — ${err.message || err}`;
        }
    });

    document.getElementById('pauseAudio').addEventListener('click', () => {
        if (audioController) audioController.pause();
    });

    document.getElementById('enableLowShelf').addEventListener('change', () => {
        if (audioController && audioController.started) {
            audioController.setFilterEnabled(document.getElementById('enableLowShelf').checked);
        }
    });

    ['filterFreq', 'filterGain', 'sourceRadius', 'sourceHeight'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            readAudioUiParams();
            draw();
        });
    });

    readAudioUiParams();
}


function init() {
    let canvas;

    try {
        canvas = document.getElementById('webglcanvas');
        gl = canvas.getContext('webgl');

        if (!gl) {
            throw new Error('Browser does not support WebGL');
        }
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

    /*
     * Trackball code is reused from the base project.
     * In this task it is used only to inspect the scene visually.
     * The surface itself does not receive phone tilt rotation anymore.
     */
    spaceball = new TrackballRotator(canvas, draw, 0);

    ['eyeSep', 'fov', 'near', 'conv'].forEach(id => {
        document.getElementById(id).addEventListener('input', draw);
    });

    sensorClient = new SensorClient({ alpha: 0.15 });

    initAudioControls();

    function tick() {
        draw();
        requestAnimationFrame(tick);
    }

    tick();
}