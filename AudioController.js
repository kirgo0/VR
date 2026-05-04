// AudioController.js
'use strict';

/*
 * Spatial audio controller for PA spatial audio task.
 *
 * Graph:
 *   <audio> -> MediaElementSource -> BiquadFilterNode -> PannerNode -> destination
 *
 * Variant 7 filter:
 *   Low-shelf filter, implemented through BiquadFilterNode.
 *
 * The filter can be enabled/disabled with a checkbox.
 * When disabled, the graph reconnects directly:
 *   <audio> -> PannerNode -> destination
 */

function AudioController(audioElement, opts) {
    opts = opts || {};

    this.audioElement = audioElement;
    this.audioContext = null;
    this.sourceNode = null;
    this.pannerNode = null;
    this.filterNode = null;

    this.filterEnabled = false;

    this.filterFrequency = opts.filterFrequency || 320;
    this.filterGain = opts.filterGain || 10;
    this.filterQ = opts.filterQ || 0.8;

    this.started = false;
}

AudioController.prototype.init = function () {
    if (this.started) return;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
        throw new Error('WebAudio API is not supported in this browser.');
    }

    this.audioContext = new AudioContextCtor();

    this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);

    this.filterNode = this.audioContext.createBiquadFilter();
    this.filterNode.type = 'lowshelf';
    this.filterNode.frequency.value = this.filterFrequency;
    this.filterNode.gain.value = this.filterGain;
    this.filterNode.Q.value = this.filterQ;

    this.pannerNode = this.audioContext.createPanner();

    // HRTF gives stronger left/right spatial perception.
    this.pannerNode.panningModel = 'HRTF';
    this.pannerNode.distanceModel = 'inverse';
    this.pannerNode.refDistance = 1.0;
    this.pannerNode.maxDistance = 50.0;
    this.pannerNode.rolloffFactor = 1.0;
    this.pannerNode.coneInnerAngle = 360;
    this.pannerNode.coneOuterAngle = 360;
    this.pannerNode.coneOuterGain = 0;

    // Listener looks toward -Z, same as the camera convention.
    this.setListenerPosition(0, 0, 0);
    this.setListenerOrientation(0, 0, -1, 0, 1, 0);

    this.reconnectGraph();

    this.started = true;
};

AudioController.prototype.reconnectGraph = function () {
    if (!this.sourceNode || !this.pannerNode || !this.filterNode) return;

    try { this.sourceNode.disconnect(); } catch (_) { }
    try { this.filterNode.disconnect(); } catch (_) { }
    try { this.pannerNode.disconnect(); } catch (_) { }

    if (this.filterEnabled) {
        this.sourceNode.connect(this.filterNode);
        this.filterNode.connect(this.pannerNode);
    } else {
        this.sourceNode.connect(this.pannerNode);
    }

    this.pannerNode.connect(this.audioContext.destination);
};

AudioController.prototype.setFilterEnabled = function (enabled) {
    this.filterEnabled = !!enabled;
    this.reconnectGraph();
};

AudioController.prototype.setFilterParams = function (frequency, gain, q) {
    this.filterFrequency = frequency;
    this.filterGain = gain;
    this.filterQ = q;

    if (!this.filterNode) return;

    const now = this.audioContext ? this.audioContext.currentTime : 0;
    this.filterNode.frequency.setTargetAtTime(frequency, now, 0.02);
    this.filterNode.gain.setTargetAtTime(gain, now, 0.02);
    this.filterNode.Q.setTargetAtTime(q, now, 0.02);
};

AudioController.prototype.setSourcePosition = function (x, y, z) {
    if (!this.pannerNode) return;

    const now = this.audioContext.currentTime;

    if (this.pannerNode.positionX) {
        this.pannerNode.positionX.setTargetAtTime(x, now, 0.02);
        this.pannerNode.positionY.setTargetAtTime(y, now, 0.02);
        this.pannerNode.positionZ.setTargetAtTime(z, now, 0.02);
    } else {
        this.pannerNode.setPosition(x, y, z);
    }
};

AudioController.prototype.setListenerPosition = function (x, y, z) {
    if (!this.audioContext) return;

    const listener = this.audioContext.listener;
    const now = this.audioContext.currentTime;

    if (listener.positionX) {
        listener.positionX.setTargetAtTime(x, now, 0.02);
        listener.positionY.setTargetAtTime(y, now, 0.02);
        listener.positionZ.setTargetAtTime(z, now, 0.02);
    } else {
        listener.setPosition(x, y, z);
    }
};

AudioController.prototype.setListenerOrientation = function (fx, fy, fz, ux, uy, uz) {
    if (!this.audioContext) return;

    const listener = this.audioContext.listener;
    const now = this.audioContext.currentTime;

    if (listener.forwardX) {
        listener.forwardX.setTargetAtTime(fx, now, 0.02);
        listener.forwardY.setTargetAtTime(fy, now, 0.02);
        listener.forwardZ.setTargetAtTime(fz, now, 0.02);

        listener.upX.setTargetAtTime(ux, now, 0.02);
        listener.upY.setTargetAtTime(uy, now, 0.02);
        listener.upZ.setTargetAtTime(uz, now, 0.02);
    } else {
        listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
};

AudioController.prototype.play = async function () {
    this.init();

    if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
    }

    await this.audioElement.play();
};

AudioController.prototype.pause = function () {
    this.audioElement.pause();
};