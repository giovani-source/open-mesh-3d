import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export class Viewer3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentMesh = null;
    this.currentTexture = null;
    this.materialMode = 'texture';
    this.wireframeVisible = false;
    this.bedVisible = true;

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
    this.camera.position.set(130, 140, 160);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // allow slight under-bed inspection
    this.controls.target.set(0, 0, 10);
    this.controls.update();

    // Group holding the generated model
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
  }

  initLights() {
    // Ambient soft fill
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    // Main Studio Key Light
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.keyLight.position.set(120, 180, 100);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = 10;
    this.keyLight.shadow.camera.far = 500;
    this.keyLight.shadow.camera.left = -150;
    this.keyLight.shadow.camera.right = 150;
    this.keyLight.shadow.camera.top = 150;
    this.keyLight.shadow.camera.bottom = -150;
    this.keyLight.shadow.bias = -0.0005;
    this.scene.add(this.keyLight);

    // Rim/Back light for highlighting 3D relief contours
    const rimLight = new THREE.DirectionalLight(0x70a1ff, 0.8);
    rimLight.position.set(-120, -100, -80);
    this.scene.add(rimLight);

    // Warm Fill Light
    const fillLight = new THREE.DirectionalLight(0xffd32a, 0.4);
    fillLight.position.set(-100, 120, 50);
    this.scene.add(fillLight);
  }

  initPrinterBed() {
    this.bedGroup = new THREE.Group();

    // 220x220mm Standard 3D Print Bed (Ender 3 / Bambu / Prusa scale)
    const bedWidth = 220;
    const bedLength = 220;

    // Bed Plate Geometry
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

    // Heated Bed Grid: 10mm lines
    const grid = new THREE.GridHelper(bedWidth, 22, 0x00f2fe, 0x27384e);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, 0.05);
    this.bedGroup.add(grid);

    // Bed Corner Clips
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

    // XYZ Coordinate Axes Indicator on front-left corner
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
    this.currentTexture.minFilter = THREE.LinearFilter;
    this.currentTexture.magFilter = THREE.LinearFilter;

    if (this.currentMesh && this.materialMode === 'texture') {
      this.applyMaterial('texture');
    }
  }

  setModel(geometry, dimensions) {
    // Clear previous mesh
    while (this.modelGroup.children.length > 0) {
      const obj = this.modelGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.modelGroup.remove(obj);
    }

    this.currentGeometry = geometry;
    this.currentMesh = new THREE.Mesh(geometry, this.getMaterial(this.materialMode));
    this.currentMesh.castShadow = true;
    this.currentMesh.receiveShadow = true;

    // Optional wireframe overlay
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

    // Update orbit target to center of mesh
    const targetZ = dimensions ? dimensions.height / 2 : 10;
    this.controls.target.set(0, 0, targetZ);
  }

  getMaterial(mode) {
    switch (mode) {
      case 'texture':
        return new THREE.MeshStandardMaterial({
          map: this.currentTexture || null,
          color: this.currentTexture ? 0xffffff : 0x00d2d3,
          roughness: 0.45,
          metalness: 0.15,
          flatShading: false
        });

      case 'pla_gold':
        return new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          roughness: 0.25,
          metalness: 0.85,
          flatShading: false
        });

      case 'pla_silver':
        return new THREE.MeshStandardMaterial({
          color: 0xdcdde1,
          roughness: 0.2,
          metalness: 0.9,
          flatShading: false
        });

      case 'pla_stealth':
        return new THREE.MeshStandardMaterial({
          color: 0x1e272e,
          roughness: 0.85,
          metalness: 0.05,
          flatShading: false
        });

      case 'clay':
        return new THREE.MeshStandardMaterial({
          color: 0xf5f6fa,
          roughness: 0.65,
          metalness: 0.05,
          flatShading: false
        });

      case 'cyber_neon':
        return new THREE.MeshStandardMaterial({
          color: 0x05c46b,
          roughness: 0.3,
          metalness: 0.5,
          wireframe: false
        });

      case 'normals':
        return new THREE.MeshNormalMaterial({
          flatShading: false
        });

      default:
        return new THREE.MeshStandardMaterial({ color: 0x4bcffa });
    }
  }

  applyMaterial(mode) {
    this.materialMode = mode;
    if (this.currentMesh) {
      this.currentMesh.material = this.getMaterial(mode);
    }
  }

  setWireframe(visible) {
    this.wireframeVisible = visible;
    if (this.wireframeMesh) {
      this.wireframeMesh.visible = visible;
    }
  }

  setBedVisible(visible) {
    this.bedVisible = visible;
    if (this.bedGroup) {
      this.bedGroup.visible = visible;
    }
  }

  setCameraView(view) {
    const dist = 180;
    switch (view) {
      case 'iso':
        this.camera.position.set(130, 140, 150);
        break;
      case 'top':
        this.camera.position.set(0, 0, 240);
        break;
      case 'front':
        this.camera.position.set(0, -220, 40);
        break;
      case 'side':
        this.camera.position.set(220, 0, 40);
        break;
    }
    this.controls.update();
  }

  exportSTL(filename = 'modelo_3d.stl', isBinary = true) {
    if (!this.currentMesh) return null;
    const exporter = new STLExporter();
    const result = exporter.parse(this.currentMesh, { binary: isBinary });

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
    if (!this.currentMesh) return null;
    const exporter = new OBJExporter();
    const result = exporter.parse(this.currentMesh);

    const blob = new Blob([result], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.obj') ? filename : `${filename}.obj`;
    link.click();
    URL.revokeObjectURL(link.href);

    return { sizeBytes: blob.size };
  }

  exportGLB(filename = 'modelo_3d.glb') {
    if (!this.currentMesh) return;
    const exporter = new GLTFExporter();
    exporter.parse(
      this.currentMesh,
      (gltf) => {
        const blob = new Blob([gltf], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
        link.click();
        URL.revokeObjectURL(link.href);
      },
      (error) => console.error('Error exporting GLB:', error),
      { binary: true }
    );
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
