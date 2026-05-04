// Model.js
'use strict';

function deg2rad(angle) {
    return angle * Math.PI / 180;
}


function Vertex(p) {
    this.p = p;
    this.normal = [];
    this.triangles = [];
}

function Triangle(v0, v1, v2) {
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.normal = [];
    this.tangent = [];
}


// Constructor
function Model(name) {
    this.name = name;
    this.iVertexBuffer = gl.createBuffer();
    this.iIndexBuffer = gl.createBuffer();
    this.count = 0;

    this.BufferData = function (vertices, indices) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STREAM_DRAW);

        this.count = indices.length;
    };

    this.Draw = function () {
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    };

    this.DrawWireframe = function () {
        for (let p = 0; p < this.count; p += 3)
            gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, p);
    };
}


/* -----------------------------------------------------------
 * Parabolic Humming-Top
 * -----------------------------------------------------------
 *
 * Surface of revolution. The profile is a parabola
 *   r(t) = R * (1 - t^2),   t in [-1, 1]
 *   y(t) = H * t
 * which gives radius 0 at t = ±1 (the two pointed tips of the top)
 * and radius R at t = 0 (the equator — widest part).
 *
 * Revolved about the y-axis with angle phi in [0, 2*pi):
 *   x = R*(1 - t^2) * cos(phi)
 *   y = H * t
 *   z = R*(1 - t^2) * sin(phi)
 *
 * The shape has its center of mass at the origin (by symmetry),
 * so it's perfectly suited for "rotation around the center of mass".
 *
 * Parameters R, H, and the tessellation density can be tuned via
 * the params object.
 * -----------------------------------------------------------
 */
function CreateSurfaceData(data, params) {
    params = params || {};
    const R = params.R !== undefined ? params.R : 1.0;   // max radius (at equator)
    const H = params.H !== undefined ? params.H : 1.5;   // half-height
    const slicesPhi = params.slicesPhi !== undefined ? params.slicesPhi : 64;    // around y-axis
    const stacksT = params.stacksT !== undefined ? params.stacksT : 48;    // along y-axis (must be even-ish for a clean equator)

    const vertices = [];
    const triangles = [];

    // Generate a (stacksT+1) x (slicesPhi+1) grid of vertices.
    // We duplicate the seam at phi = 0 = 2*pi for clean wireframe lines.
    for (let i = 0; i <= stacksT; i++) {
        const t = -1 + 2 * (i / stacksT);          // t in [-1, 1]
        const r = R * (1 - t * t);                 // parabolic radius
        const y = H * t;

        for (let j = 0; j <= slicesPhi; j++) {
            const phi = (j / slicesPhi) * 2 * Math.PI;
            const x = r * Math.cos(phi);
            const z = r * Math.sin(phi);
            vertices.push(new Vertex([x, y, z]));
        }
    }

    const stride = slicesPhi + 1;

    // Build triangles. For each quad in the (i, j) grid:
    //
    //   v0 ---- v1
    //   |  \    |
    //   |   \   |
    //   v2 ---- v3
    //
    //   v0 = (i,   j  )
    //   v1 = (i,   j+1)
    //   v2 = (i+1, j  )
    //   v3 = (i+1, j+1)
    //
    // Triangles: (v0, v2, v3) and (v0, v3, v1).
    //
    // At the very tips (i = 0 or i = stacksT - 1) the profile radius is
    // zero, so all (i, j) in that row degenerate to a single point —
    // the resulting "triangles" will have two coincident vertices,
    // which is harmless visually (zero area, ignored by the rasterizer).
    for (let i = 0; i < stacksT; i++) {
        for (let j = 0; j < slicesPhi; j++) {
            const v0 = i * stride + j;
            const v1 = i * stride + (j + 1);
            const v2 = (i + 1) * stride + j;
            const v3 = (i + 1) * stride + (j + 1);

            const t0 = new Triangle(v0, v2, v3);
            const t1 = new Triangle(v0, v3, v1);

            const i0 = triangles.length;
            triangles.push(t0);
            vertices[v0].triangles.push(i0);
            vertices[v2].triangles.push(i0);
            vertices[v3].triangles.push(i0);

            const i1 = triangles.length;
            triangles.push(t1);
            vertices[v0].triangles.push(i1);
            vertices[v3].triangles.push(i1);
            vertices[v1].triangles.push(i1);
        }
    }

    // Pack into typed arrays
    data.verticesF32 = new Float32Array(vertices.length * 3);
    for (let i = 0, len = vertices.length; i < len; i++) {
        data.verticesF32[i * 3 + 0] = vertices[i].p[0];
        data.verticesF32[i * 3 + 1] = vertices[i].p[1];
        data.verticesF32[i * 3 + 2] = vertices[i].p[2];
    }

    data.indicesU16 = new Uint16Array(triangles.length * 3);
    for (let i = 0, len = triangles.length; i < len; i++) {
        data.indicesU16[i * 3 + 0] = triangles[i].v0;
        data.indicesU16[i * 3 + 1] = triangles[i].v1;
        data.indicesU16[i * 3 + 2] = triangles[i].v2;
    }
}