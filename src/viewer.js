import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Viewer3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentMesh = null;
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
    this.scene.background = new THREE.Color(0x0e1320);

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    this.camera.position.set(120, 130, 140);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.15;
    this.controls.target.set(0, 0, 15);
    this.controls.update();

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
  }

  initLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.position.set(100, 160, 120);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.scene.add(this.keyLight);

    const rimLight = new THREE.DirectionalLight(0x70a1ff, 0.9);
    rimLight.position.set(-100, -120, -60);
    this.scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0xffeedd, 0.5);
    fillLight.position.set(-80, 100, 80);
    this.scene.add(fillLight);
  }

  initPrinterBed() {
    this.bedGroup = new THREE.Group();
    const bedWidth = 220;
    const bedLength = 220;

    const bedGeo = new THREE.BoxGeometry(bedWidth, bedLength, 4);
    const bedMat = new THREE.MeshStandardMaterial({
      color: 0x181e2b,
      roughness: 0.8,
      metalness: 0.2
    });
    this.bedMesh = new THREE.Mesh(bedGeo, bedMat);
    this.bedMesh.position.set(0, 0, -2);
    this.bedMesh.receiveShadow = true;
    this.bedGroup.add(this.bedMesh);

    const grid = new THREE.GridHelper(bedWidth, 22, 0x00f2fe, 0x27384e);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, 0.05);
    this.bedGroup.add(grid);

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

  setModel(geometry, dimensions) {
    while (this.modelGroup.children.length > 0) {
      const obj = this.modelGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.modelGroup.remove(obj);
    }

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

    const targetZ = dimensions ? dimensions.height / 2 : 15;
    this.controls.target.set(0, 0, targetZ);
  }

  /**
   * Carrega modelo GLB retornado pela IA da Meshy / Trellis
   */
  async loadGLBFromUrl(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          while (this.modelGroup.children.length > 0) {
            const obj = this.modelGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            this.modelGroup.remove(obj);
          }

          const model = gltf.scene;
          
          // Calcular caixa envolvente e centralizar na mesa
          const bbox = new THREE.Box3().setFromObject(model);
          const size = bbox.getSize(new THREE.Vector3());
          const center = bbox.getCenter(new THREE.Vector3());

          // Escalar para caber confortavelmente na mesa de impressão (aprox 80mm de altura)
          const maxDim = Math.max(size.x, size.y, size.z);
          const targetScale = maxDim > 0 ? 80 / maxDim : 1;
          model.scale.set(targetScale, targetScale, targetScale);

          // Recalcular após escala
          bbox.setFromObject(model);
          const scaledCenter = bbox.getCenter(new THREE.Vector3());
          model.position.x = -scaledCenter.x;
          model.position.y = -scaledCenter.y;
          model.position.z = -bbox.min.z; // Apoiar os pés na mesa a Z=0

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

          const finalBox = new THREE.Box3().setFromObject(model);
          const finalSize = finalBox.getSize(new THREE.Vector3());

          this.controls.target.set(0, 0, finalSize.z / 2);

          resolve({
            dimensions: {
              width: finalSize.x,
              depth: finalSize.y,
              height: finalSize.z
            },
            stats: {
              triangles: Math.round(totalTriangles),
              vertices: totalVertices,
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
    switch (mode) {
      case 'texture':
        return new THREE.MeshStandardMaterial({
          map: this.currentTexture || null,
          color: this.currentTexture ? 0xffffff : 0x00d2d3,
          roughness: 0.45,
          metalness: 0.15
        });

      case 'pla_gold':
        return new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          roughness: 0.25,
          metalness: 0.85
        });

      case 'pla_silver':
        return new THREE.MeshStandardMaterial({
          color: 0xdcdde1,
          roughness: 0.2,
          metalness: 0.9
        });

      case 'pla_stealth':
        return new THREE.MeshStandardMaterial({
          color: 0x1e272e,
          roughness: 0.85,
          metalness: 0.05
        });

      case 'clay':
        return new THREE.MeshStandardMaterial({
          color: 0xf5f6fa,
          roughness: 0.65,
          metalness: 0.05
        });

      case 'normals':
        return new THREE.MeshNormalMaterial();

      default:
        return new THREE.MeshStandardMaterial({ color: 0x4bcffa });
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
    switch (view) {
      case 'iso':
        this.camera.position.set(120, 130, 140);
        break;
      case 'top':
        this.camera.position.set(0, 0, 220);
        break;
      case 'front':
        this.camera.position.set(0, -200, 30);
        break;
      case 'side':
        this.camera.position.set(200, 0, 30);
        break;
    }
    this.controls.update();
  }

  exportSTL(filename = 'modelo_3d.stl', isBinary = true) {
    const targetObj = this.currentModel || this.currentMesh;
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

  exportOBJ(filename = 'modelo_3d.obj') {
    const targetObj = this.currentModel || this.currentMesh;
    if (!targetObj) return null;
    const exporter = new OBJExporter();
    const result = exporter.parse(targetObj);

    const blob = new Blob([result], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.obj') ? filename : `${filename}.obj`;
    link.click();
    URL.revokeObjectURL(link.href);

    return { sizeBytes: blob.size };
  }

  exportGLB(filename = 'modelo_3d.glb') {
    const targetObj = this.currentModel || this.currentMesh;
    if (!targetObj) return;
    const exporter = new GLTFExporter();
    exporter.parse(
      targetObj,
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
