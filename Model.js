

function deg2rad(angle) {
    return angle * Math.PI / 180;
}


function Vertex(p)
{
    this.p = p;
    this.normal = [];
    this.triangles = [];
}

function Triangle(v0, v1, v2)
{
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

    this.BufferData = function(vertices, indices) {

        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STREAM_DRAW);

        this.count = indices.length;
    }

    this.Draw = function() {

        //gl.drawArrays(gl.LINE_STRIP, 0, this.count);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }

    this.DrawWireframe = function() {

        for (let p=0; p<this.count; p+=3)
            gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, p);
    }
}


function CreateSurfaceData(data)
{
    let vertices = [];
    let triangles = [];

    for (let i=0, ang = 0; i<72; i++, ang+=5) {
        vertices.push( new Vertex( [Math.sin(deg2rad(ang)), 0, Math.cos(deg2rad(ang))] ));
    }

    for (let i=0, ang = 0; i<72; i++, ang+=5) {

        let v0ind = vertices.length;
        vertices.push( new Vertex( [Math.sin(deg2rad(ang)), 1, Math.cos(deg2rad(ang))] ));

        // v0    v2 
        //   o - o
        //   | \ |
        //   o - o
        // v3     v1

        if (i > 0)
        {
            let v1ind = v0ind - 72 -1;
            let v2ind = v0ind - 1;
            let v3ind = v0ind - 72

            let trian = new Triangle(v0ind, v1ind, v2ind);
            let trianInd = triangles.length;

            triangles.push( trian );
            vertices[v0ind].triangles.push(trianInd);
            vertices[v1ind].triangles.push(trianInd);
            vertices[v2ind].triangles.push(trianInd);

            let trian2 = new Triangle(v0ind, v3ind, v1ind);
            let trianInd2 = triangles.length;

            triangles.push( trian2 );
            vertices[v0ind].triangles.push(trianInd2);
            vertices[v3ind].triangles.push(trianInd2);
            vertices[v1ind].triangles.push(trianInd2);

        }

    }

    data.verticesF32 = new Float32Array(vertices.length*3);
    for (let i=0, len=vertices.length; i<len; i++)
    {
        data.verticesF32[i*3 + 0] = vertices[i].p[0];
        data.verticesF32[i*3 + 1] = vertices[i].p[1];
        data.verticesF32[i*3 + 2] = vertices[i].p[2];
    }

    data.indicesU16 = new Uint16Array(triangles.length*3);
    for (let i=0, len=triangles.length; i<len; i++)
    {
        data.indicesU16[i*3 + 0] = triangles[i].v0;
        data.indicesU16[i*3 + 1] = triangles[i].v1;
        data.indicesU16[i*3 + 2] = triangles[i].v2;
    }

}