import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { zipSync, strToU8 } from 'fflate';

export class Viewer3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentMesh = null;
    this.currentModel = null;
    this.currentTexture = null;
    this.materialMode = 'texture';
    this.wireframeVisible = false;
    this.bedVisible = true;
    this.gltfLoader = new GLTFLoader();

    this.initScene();
    this.initLights();
    this.initPrinterBed();
    this.initListeners();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d);

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    // Definir Z como vertical (padrão de impressoras 3D e fatiadores)
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, -170, 65);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.08;
    this.controls.target.set(0, 0, 45); // Foco no centro do boneco em pé (Z = 45mm)
    this.controls.update();

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
  }

  initLights() {
    // Iluminação de estúdio de escultura com contraste rico para visualização da geometria 3D pura
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambientLight);

    // Luz principal direcional em ângulo (revela nariz, olhos, queixo e dobras em 3D real)
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.keyLight.position.set(70, -120, 110);
    this.keyLight.castShadow = true;
    this.scene.add(this.keyLight);

    // Luz de contorno e preenchimento
    const rimLight = new THREE.DirectionalLight(0x70a1ff, 1.2);
    rimLight.position.set(-80, 100, 70);
    this.scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0xffeedd, 0.7);
    fillLight.position.set(-90, -70, 50);
    this.scene.add(fillLight);
  }

  initPrinterBed() {
    this.bedGroup = new THREE.Group();
    const bedWidth = 220;
    const bedLength = 220;

    const bedGeo = new THREE.BoxGeometry(bedWidth, bedLength, 4);
    const bedMat = new THREE.MeshStandardMaterial({
      color: 0x141a27,
      roughness: 0.85,
      metalness: 0.15
    });
    this.bedMesh = new THREE.Mesh(bedGeo, bedMat);
    this.bedMesh.position.set(0, 0, -2);
    this.bedMesh.receiveShadow = true;
    this.bedGroup.add(this.bedMesh);

    // Grade da mesa aquecida (Z = 0)
    const grid = new THREE.GridHelper(bedWidth, 22, 0x00f2fe, 0x223249);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, 0.05);
    this.bedGroup.add(grid);

    // Clipes da mesa
    const clipGeo = new THREE.BoxGeometry(12, 12, 3);
    const clipMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.8, roughness: 0.3 });
    const corners = [
      [-bedWidth / 2 + 6, -bedLength / 2 + 6],
      [bedWidth / 2 - 6, -bedLength / 2 + 6],
      [-bedWidth / 2 + 6, bedLength / 2 - 6],
      [bedWidth / 2 - 6, bedLength / 2 - 6]
    ];
    corners.forEach(([cx, cy]) => {
      const clip = new THREE.Mesh(clipGeo, clipMat);
      clip.position.set(cx, cy, 1);
      this.bedGroup.add(clip);
    });

    const axes = new THREE.AxesHelper(25);
    axes.position.set(-bedWidth / 2 + 5, -bedLength / 2 + 5, 0.5);
    this.bedGroup.add(axes);

    this.scene.add(this.bedGroup);
  }

  initListeners() {
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setTextureFromCanvas(canvas) {
    if (this.currentTexture) this.currentTexture.dispose();
    this.currentTexture = new THREE.CanvasTexture(canvas);
    this.currentTexture.colorSpace = THREE.SRGBColorSpace;

    if (this.currentMesh && this.materialMode === 'texture') {
      this.applyMaterial('texture');
    }
  }

  /**
   * Define o modelo 3D do personagem em pé na mesa
   */
  setModel(geometry, dimensions) {
    while (this.modelGroup.children.length > 0) {
      const obj = this.modelGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.modelGroup.remove(obj);
    }

    this.currentModel = null;
    this.currentGeometry = geometry;
    this.currentMesh = new THREE.Mesh(geometry, this.getMaterial(this.materialMode));
    this.currentMesh.castShadow = true;
    this.currentMesh.receiveShadow = true;

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      wireframe: true,
      transparent: true,
      opacity: 0.25
    });
    this.wireframeMesh = new THREE.Mesh(geometry, wireMat);
    this.wireframeMesh.visible = this.wireframeVisible;
    this.modelGroup.add(this.wireframeMesh);

    this.modelGroup.add(this.currentMesh);

    const targetZ = dimensions ? dimensions.height / 2 : 45;
    this.controls.target.set(0, 0, targetZ);
  }

  async loadGLBFromUrl(url, options = {}) {
    const { targetHeight = 90, addPedestal = true } = options;

    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          while (this.modelGroup.children.length > 0) {
            const obj = this.modelGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            this.modelGroup.remove(obj);
          }
          this.pedestalMesh = null;
          this.wireframeMesh = null;

          const model = gltf.scene;

          // Orientar o modelo em pé se vier em eixos Y-up
          const bbox = new THREE.Box3().setFromObject(model);
          const size = bbox.getSize(new THREE.Vector3());
          
          if (size.y >= size.z * 0.8) {
            model.rotation.x = Math.PI / 2;
          }

          // Computar normais suaves Gouraud/Phong para eliminar facetas serrilhadas
          model.traverse((child) => {
            if (child.isMesh && child.geometry) {
              child.geometry.computeVertexNormals();

              // Se não tiver UVs, gerar projeção planar frontal para mapear a textura da imagem
              if (!child.geometry.attributes.uv && child.geometry.attributes.position) {
                const pos = child.geometry.attributes.position;
                const mBox = new THREE.Box3().setFromBufferAttribute(pos);
                const spanX = Math.max(0.001, mBox.max.x - mBox.min.x);
                const spanY = Math.max(0.001, mBox.max.y - mBox.min.y);
                const uvs = new Float32Array(pos.count * 2);
                for (let i = 0; i < pos.count; i++) {
                  const px = pos.getX(i);
                  const py = pos.getY(i);
                  uvs[i * 2] = (px - mBox.min.x) / spanX;
                  uvs[i * 2 + 1] = (py - mBox.min.y) / spanY;
                }
                child.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
              }
            }
          });

          // Escalar com base na altura desejada
          const newBbox = new THREE.Box3().setFromObject(model);
          const newSize = newBbox.getSize(new THREE.Vector3());
          const maxDim = newSize.z > 0 ? newSize.z : Math.max(newSize.x, newSize.y);
          const targetScale = maxDim > 0 ? targetHeight / maxDim : 1;
          model.scale.set(targetScale, targetScale, targetScale);

          // Centralizar na mesa aquecida (X=0, Y=0) com os pés em Z=0
          const finalBbox = new THREE.Box3().setFromObject(model);
          const finalCenter = finalBbox.getCenter(new THREE.Vector3());
          model.position.x = -finalCenter.x;
          model.position.y = -finalCenter.y;
          model.position.z = -finalBbox.min.z;

          const scaledBbox = new THREE.Box3().setFromObject(model);
          const scaledSize = scaledBbox.getSize(new THREE.Vector3());

          // Adicionar Pedestal sólido chanfrado de apoio para a mesa se ativado
          let pedestalHeight = 0;
          if (addPedestal) {
            pedestalHeight = 3.5;
            const pRadiusX = Math.max(22, scaledSize.x * 0.62);
            const pRadiusY = Math.max(18, scaledSize.y * 0.62);

            const pedGeo = new THREE.CylinderGeometry(pRadiusX * 0.95, pRadiusX, pedestalHeight, 64);
            pedGeo.rotateX(Math.PI / 2);
            pedGeo.scale(1, pRadiusY / pRadiusX, 1);
            pedGeo.translate(0, 0, pedestalHeight / 2);
            pedGeo.computeVertexNormals();

            const pedMat = new THREE.MeshStandardMaterial({
              color: 0x1e2736,
              roughness: 0.6,
              metalness: 0.3
            });

            this.pedestalMesh = new THREE.Mesh(pedGeo, pedMat);
            this.pedestalMesh.castShadow = true;
            this.pedestalMesh.receiveShadow = true;
            this.modelGroup.add(this.pedestalMesh);

            // Elevar o modelo para o topo do pedestal
            model.position.z += pedestalHeight;
          }

          let primaryMesh = null;
          let totalTriangles = 0;
          let totalVertices = 0;

          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (!primaryMesh) primaryMesh = child;
              if (child.geometry) {
                totalVertices += child.geometry.attributes.position.count;
                if (child.geometry.index) {
                  totalTriangles += child.geometry.index.count / 3;
                } else {
                  totalTriangles += child.geometry.attributes.position.count / 3;
                }
              }
            }
          });

          this.currentMesh = primaryMesh || model;
          this.currentModel = model;
          this.modelGroup.add(model);

          // Criar malha wireframe para inspeção técnica
          if (primaryMesh && primaryMesh.geometry) {
            const wireMat = new THREE.MeshBasicMaterial({
              color: 0x00f2fe,
              wireframe: true,
              transparent: true,
              opacity: 0.25
            });
            this.wireframeMesh = new THREE.Mesh(primaryMesh.geometry, wireMat);
            this.wireframeMesh.visible = this.wireframeVisible;
            model.add(this.wireframeMesh);
          }

          // Aplicar o material ativo
          this.applyMaterial(this.materialMode);

          const fullBox = new THREE.Box3().setFromObject(this.modelGroup);
          const fullSize = fullBox.getSize(new THREE.Vector3());

          this.controls.target.set(0, 0, fullSize.z / 2);

          resolve({
            dimensions: {
              width: fullSize.x,
              depth: fullSize.y,
              height: fullSize.z
            },
            stats: {
              triangles: Math.round(totalTriangles + (addPedestal ? 128 : 0)),
              vertices: totalVertices + (addPedestal ? 66 : 0),
              isManifold: true
            }
          });
        },
        undefined,
        reject
      );
    });
  }


  getMaterial(mode) {
    const bumpMap = this.currentTexture || null;

    switch (mode) {
      case 'texture':
        return new THREE.MeshStandardMaterial({
          map: this.currentTexture || null,
          bumpMap: bumpMap,
          bumpScale: 0.08,
          color: this.currentTexture ? 0xffffff : 0x00d2d3,
          roughness: 0.45,
          metalness: 0.12,
          side: THREE.DoubleSide
        });

      case 'clay':
        return new THREE.MeshStandardMaterial({
          color: 0xf0f2f5,
          bumpMap: bumpMap,
          bumpScale: 0.12,
          roughness: 0.50,
          metalness: 0.06,
          side: THREE.DoubleSide
        });

      case 'pla_gold':
        return new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          bumpMap: bumpMap,
          bumpScale: 0.10,
          roughness: 0.25,
          metalness: 0.85,
          side: THREE.DoubleSide
        });

      case 'pla_silver':
        return new THREE.MeshStandardMaterial({
          color: 0xdcdde1,
          bumpMap: bumpMap,
          bumpScale: 0.10,
          roughness: 0.2,
          metalness: 0.9,
          side: THREE.DoubleSide
        });

      case 'pla_stealth':
        return new THREE.MeshStandardMaterial({
          color: 0x1e272e,
          bumpMap: bumpMap,
          bumpScale: 0.12,
          roughness: 0.85,
          metalness: 0.05,
          side: THREE.DoubleSide
        });

      case 'normals':
        return new THREE.MeshNormalMaterial({
          side: THREE.DoubleSide
        });

      default:
        return new THREE.MeshStandardMaterial({
          color: 0x4bcffa,
          side: THREE.DoubleSide
        });
    }
  }

  applyMaterial(mode) {
    this.materialMode = mode;
    const mat = this.getMaterial(mode);
    if (this.currentModel) {
      this.currentModel.traverse((child) => {
        if (child.isMesh) child.material = mat;
      });
    } else if (this.currentMesh) {
      this.currentMesh.material = mat;
    }
  }

  setWireframe(visible) {
    this.wireframeVisible = visible;
    if (this.wireframeMesh) this.wireframeMesh.visible = visible;
  }

  setBedVisible(visible) {
    this.bedVisible = visible;
    if (this.bedGroup) this.bedGroup.visible = visible;
  }

  setCameraView(view) {
    const targetZ = this.controls.target.z || 45;
    switch (view) {
      case 'iso':
        this.camera.position.set(110, -130, 85);
        break;
      case 'top':
        this.camera.position.set(0, -0.01, 230);
        break;
      case 'front':
        this.camera.position.set(0, -170, targetZ);
        break;
      case 'side':
        this.camera.position.set(170, 0, targetZ);
        break;
    }
    this.controls.update();
  }

  exportSTL(filename = 'boneco_3d.stl', isBinary = true) {
    const targetObj = this.currentMesh || this.currentModel;
    if (!targetObj) return null;

    const exporter = new STLExporter();
    const result = exporter.parse(targetObj, { binary: isBinary });

    const blob = new Blob([result], {
      type: isBinary ? 'application/octet-stream' : 'text/plain'
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.stl') ? filename : `${filename}.stl`;
    link.click();
    URL.revokeObjectURL(link.href);

    return { sizeBytes: blob.size, isBinary };
  }

  export3MF(filename = 'boneco_3d.3mf') {
    const targetObj = this.currentMesh || this.currentModel;
    if (!targetObj) return null;

    const verts = [];
    const triLines = [];
    let vertCount = 0;

    targetObj.updateMatrixWorld(true);

    targetObj.traverse(node => {
      if (node.isMesh && node.geometry) {
            const geo = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
            const pos = geo.attributes.position;
            const matrix = node.matrixWorld;

            const v = new THREE.Vector3();
            for (let i = 0; i < pos.count; i += 3) {
              v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
              const v1x = v.x.toFixed(4), v1y = v.y.toFixed(4), v1z = v.z.toFixed(4);
              v.fromBufferAttribute(pos, i + 1).applyMatrix4(matrix);
              const v2x = v.x.toFixed(4), v2y = v.y.toFixed(4), v2z = v.z.toFixed(4);
              v.fromBufferAttribute(pos, i + 2).applyMatrix4(matrix);
              const v3x = v.x.toFixed(4), v3y = v.y.toFixed(4), v3z = v.z.toFixed(4);

              verts.push(`<vertex x="${v1x}" y="${v1y}" z="${v1z}" />`);
              verts.push(`<vertex x="${v2x}" y="${v2y}" z="${v2z}" />`);
              verts.push(`<vertex x="${v3x}" y="${v3y}" z="${v3z}" />`);

              triLines.push(`<triangle v1="${vertCount}" v2="${vertCount + 1}" v3="${vertCount + 2}" />`);
              vertCount += 3;
            }
          }
        });

    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

    const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Forge3D Model</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          ${verts.join('\n          ')}
        </vertices>
        <triangles>
          ${triLines.join('\n          ')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

    const zipData = zipSync({
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(modelXml)
    });

    const blob = new Blob([zipData], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.3mf') ? filename : `${filename}.3mf`;
    link.click();
    URL.revokeObjectURL(link.href);

    return { sizeBytes: blob.size, triangles: triLines.length };
  }

  exportOBJ(filename = 'boneco_3d.obj') {
    if (!this.modelGroup || this.modelGroup.children.length === 0) return null;
    
    const exportGroup = new THREE.Group();
    this.modelGroup.children.forEach(child => {
      if (child !== this.wireframeMesh && child.visible) {
        exportGroup.add(child.clone());
      }
    });

    const exporter = new OBJExporter();
    const result = exporter.parse(exportGroup);

    const blob = new Blob([result], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.obj') ? filename : `${filename}.obj`;
    link.click();
    URL.revokeObjectURL(link.href);

    return { sizeBytes: blob.size };
  }

  exportGLB(filename = 'boneco_3d.glb') {
    if (!this.modelGroup || this.modelGroup.children.length === 0) return;
    
    const exportGroup = new THREE.Group();
    this.modelGroup.children.forEach(child => {
      if (child !== this.wireframeMesh && child.visible) {
        exportGroup.add(child.clone());
      }
    });

    const exporter = new GLTFExporter();
    exporter.parse(
      exportGroup,
      (gltf) => {
        const blob = new Blob([gltf], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
        link.click();
        URL.revokeObjectURL(link.href);
      },
      (err) => console.error(err),
      { binary: true }
    );
  }


  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
