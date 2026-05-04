// StereoCamera.js
'use strict';

function StereoCamera(
    Convergence,
    EyeSeparation,
    AspectRatio,
    FOV,
    NearClippingDistance,
    FarClippingDistance
) {
    this.mConvergence = Convergence;
    this.mEyeSeparation = EyeSeparation;
    this.mAspectRatio = AspectRatio;
    this.mFOV = FOV;                       // radians
    this.mNearClippingDistance = NearClippingDistance;
    this.mFarClippingDistance = FarClippingDistance;

    // Kept for backwards-compat with existing main.js code
    Object.defineProperty(this, 'eyeSeparation', {
        get: function () { return this.mEyeSeparation; }
    });

    this.calcLeftFrustum = function () {
        const top = this.mNearClippingDistance * Math.tan(this.mFOV / 2);
        const bottom = -top;

        const a = this.mAspectRatio * Math.tan(this.mFOV / 2) * this.mConvergence;
        const b = a - this.mEyeSeparation / 2;
        const c = a + this.mEyeSeparation / 2;

        const left = -b * this.mNearClippingDistance / this.mConvergence;
        const right = c * this.mNearClippingDistance / this.mConvergence;

        return m4.frustum(left, right, bottom, top,
            this.mNearClippingDistance, this.mFarClippingDistance);
    };

    this.calcRightFrustum = function () {
        const top = this.mNearClippingDistance * Math.tan(this.mFOV / 2);
        const bottom = -top;

        const a = this.mAspectRatio * Math.tan(this.mFOV / 2) * this.mConvergence;
        const b = a - this.mEyeSeparation / 2;
        const c = a + this.mEyeSeparation / 2;

        const left = -c * this.mNearClippingDistance / this.mConvergence;
        const right = b * this.mNearClippingDistance / this.mConvergence;

        return m4.frustum(left, right, bottom, top,
            this.mNearClippingDistance, this.mFarClippingDistance);
    };

    // For zero-parallax background (webcam) we want a symmetric frustum
    // that matches the FOV/aspect/clipping of the stereo pair.
    this.calcSymmetricFrustum = function () {
        const top = this.mNearClippingDistance * Math.tan(this.mFOV / 2);
        const bottom = -top;
        const right = top * this.mAspectRatio;
        const left = -right;
        return m4.frustum(left, right, bottom, top,
            this.mNearClippingDistance, this.mFarClippingDistance);
    };
}