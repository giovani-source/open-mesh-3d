import './style.css';
import { Viewer3D } from './viewer.js';
import { MeshGenerator } from './generator.js';

class StudioApp {
  constructor() {
    this.viewer = null;
    this.currentImage = null;
    this.currentEngine = 'relief'; // 'relief' or 'volumetric'
    this.currentProcessed = null;

    this.options = {
      targetWidth: 80,
      reliefHeight: 8,
      baseThickness: 3,
      resolution: 140,
      smoothing: 1,
      shape: 'coin',
      invertDepth: false,
      maxThickness: 20
    };

    this.init();
  }

  init() {
    // 1. Initialize 3D Viewport
    const container = document.getElementById('canvas-container');
    this.viewer = new Viewer3D(container);

    // 2. Setup Event Listeners
    this.bindDropzone();
    this.bindPresets();
    this.bindEngineTabs();
    this.bindSliders();
    this.bindToolbar();
    this.bindMaterials();
    this.bindExports();
    this.bindModals();

    // 3. Load default sample
    this.loadSampleImage('/samples/dragon_coin.jpg');
  }

  loadSampleImage(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.updateImagePreview(img.src);
      this.generateModel();
    };
    img.src = url;
  }

  updateImagePreview(src) {
    const preview = document.getElementById('image-preview');
    const prompt = document.getElementById('dropzone-prompt');
    preview.src = src;
    preview.classList.remove('hidden');
    prompt.classList.add('hidden');
  }

  bindDropzone() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-active');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-active');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-active');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleFile(e.target.files[0]);
      }
    });
  }

  handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecione um arquivo de imagem válido (PNG, JPG, WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.currentImage = img;
        this.updateImagePreview(e.target.result);
        
        // Remove active from preset thumbnails
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
        
        this.generateModel();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  bindPresets() {
    const presets = {
      dragon: { url: '/samples/dragon_coin.jpg', shape: 'coin', height: 8, base: 3 },
      robot: { url: '/samples/robot_toy.jpg', shape: 'rect', height: 12, base: 2 },
      statue: { url: '/samples/statue_bust.jpg', shape: 'circle', height: 14, base: 4 }
    };

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = btn.dataset.sample;
        const config = presets[key];
        if (!config) return;

        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Apply config
        this.options.shape = config.shape;
        document.getElementById('param-shape').value = config.shape;
        this.options.reliefHeight = config.height;
        document.getElementById('param-height').value = config.height;
        document.getElementById('val-height').textContent = `${config.height} mm`;
        this.options.baseThickness = config.base;
        document.getElementById('param-base').value = config.base;
        document.getElementById('val-base').textContent = `${config.base} mm`;

        this.loadSampleImage(config.url);
      });
    });
  }

  bindEngineTabs() {
    document.querySelectorAll('.engine-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.engine-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentEngine = tab.dataset.engine;

        const baseGroup = document.getElementById('group-base');
        const shapeGroup = document.getElementById('param-shape').closest('.param-group');

        if (this.currentEngine === 'volumetric') {
          baseGroup.style.display = 'none';
          shapeGroup.style.display = 'none';
        } else {
          baseGroup.style.display = 'flex';
          shapeGroup.style.display = 'flex';
        }

        this.generateModel();
      });
    });
  }

  bindSliders() {
    const bindRange = (id, valId, unit, optKey, parseFn = parseFloat) => {
      const slider = document.getElementById(id);
      const valDisplay = document.getElementById(valId);
      slider.addEventListener('input', () => {
        const val = parseFn(slider.value);
        this.options[optKey] = val;
        valDisplay.textContent = unit === 'res' ? `${val}x${val}` : `${val} ${unit}`;
      });
      slider.addEventListener('change', () => {
        this.generateModel();
      });
    };

    bindRange('param-width', 'val-width', 'mm', 'targetWidth');
    bindRange('param-height', 'val-height', 'mm', 'reliefHeight');
    bindRange('param-base', 'val-base', 'mm', 'baseThickness');
    bindRange('param-res', 'val-res', 'res', 'resolution', parseInt);
    bindRange('param-smooth', 'val-smooth', 'Nível', 'smoothing', parseInt);

    const shapeSelect = document.getElementById('param-shape');
    shapeSelect.addEventListener('change', () => {
      this.options.shape = shapeSelect.value;
      this.generateModel();
    });

    const invertCheck = document.getElementById('param-invert');
    invertCheck.addEventListener('change', () => {
      this.options.invertDepth = invertCheck.checked;
      this.generateModel();
    });

    const genBtn = document.getElementById('btn-generate');
    genBtn.addEventListener('click', () => {
      this.generateModel();
    });
  }

  bindToolbar() {
    // View camera buttons
    document.querySelectorAll('.top-toolbar .tool-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.top-toolbar .tool-btn[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.viewer.setCameraView(btn.dataset.view);
      });
    });

    // Bed toggle
    const bedBtn = document.getElementById('btn-toggle-bed');
    bedBtn.addEventListener('click', () => {
      const active = bedBtn.classList.toggle('active');
      this.viewer.setBedVisible(active);
    });

    // Wireframe toggle
    const wireBtn = document.getElementById('btn-toggle-wireframe');
    wireBtn.addEventListener('click', () => {
      const active = wireBtn.classList.toggle('active');
      this.viewer.setWireframe(active);
    });
  }

  bindMaterials() {
    document.querySelectorAll('.mat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.mat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.viewer.applyMaterial(pill.dataset.mat);
      });
    });
  }

  bindExports() {
    const getBaseName = () => {
      return `modelo_3d_${Date.now()}`;
    };

    document.getElementById('btn-export-stl-bin').addEventListener('click', () => {
      const res = this.viewer.exportSTL(`${getBaseName()}.stl`, true);
      if (res) this.showStatusToast(`Arquivo STL (Binário) baixado! ${(res.sizeBytes / 1024).toFixed(1)} KB`);
    });

    document.getElementById('btn-export-stl-ascii').addEventListener('click', () => {
      const res = this.viewer.exportSTL(`${getBaseName()}_ascii.stl`, false);
      if (res) this.showStatusToast(`Arquivo STL (ASCII) baixado! ${(res.sizeBytes / 1024).toFixed(1)} KB`);
    });

    document.getElementById('btn-export-obj').addEventListener('click', () => {
      const res = this.viewer.exportOBJ(`${getBaseName()}.obj`);
      if (res) this.showStatusToast(`Arquivo OBJ baixado! ${(res.sizeBytes / 1024).toFixed(1)} KB`);
    });

    document.getElementById('btn-export-glb').addEventListener('click', () => {
      this.viewer.exportGLB(`${getBaseName()}.glb`);
      this.showStatusToast('Arquivo GLB (com textura) baixado!');
    });
  }

  bindModals() {
    const guideModal = document.getElementById('modal-guide');
    const backendModal = document.getElementById('modal-backend');

    document.getElementById('btn-open-guide').addEventListener('click', () => guideModal.classList.remove('hidden'));
    document.getElementById('btn-close-guide').addEventListener('click', () => guideModal.classList.add('hidden'));
    document.getElementById('btn-ok-guide').addEventListener('click', () => guideModal.classList.add('hidden'));

    document.getElementById('btn-open-backend').addEventListener('click', () => backendModal.classList.remove('hidden'));
    document.getElementById('btn-close-backend').addEventListener('click', () => backendModal.classList.add('hidden'));
    document.getElementById('btn-ok-backend').addEventListener('click', () => backendModal.classList.add('hidden'));

    [guideModal, backendModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });
  }

  showStatusToast(msg) {
    const status = document.getElementById('gen-status');
    status.textContent = msg;
    status.style.color = '#34d399';
    setTimeout(() => {
      status.textContent = 'Modelo pronto para visualização';
      status.style.color = '';
    }, 4000);
  }

  generateModel() {
    if (!this.currentImage) return;

    const statusEl = document.getElementById('gen-status');
    statusEl.textContent = 'Processando malha 3D e normais...';

    // Extract image data
    this.currentProcessed = MeshGenerator.getImageData(this.currentImage, this.options.resolution);
    this.viewer.setTextureFromCanvas(this.currentProcessed.canvas);

    let result;
    if (this.currentEngine === 'relief') {
      result = MeshGenerator.createWatertightRelief(this.currentProcessed, {
        targetWidth: this.options.targetWidth,
        reliefHeight: this.options.reliefHeight,
        baseThickness: this.options.baseThickness,
        invertDepth: this.options.invertDepth,
        smoothing: this.options.smoothing,
        shape: this.options.shape
      });
    } else {
      result = MeshGenerator.createVolumetric360(this.currentProcessed, {
        targetWidth: this.options.targetWidth,
        maxThickness: this.options.reliefHeight * 2,
        smoothing: this.options.smoothing
      });
    }

    // Set model in 3D viewer
    this.viewer.setModel(result.geometry, result.dimensions);

    // Calculate 3D print metrics
    const metrics = MeshGenerator.estimatePrintMetrics(result.geometry, 15);

    // Update UI numbers
    document.getElementById('metric-x').textContent = `${result.dimensions.width.toFixed(1)} mm`;
    document.getElementById('metric-y').textContent = `${result.dimensions.depth.toFixed(1)} mm`;
    document.getElementById('metric-z').textContent = `${result.dimensions.height.toFixed(1)} mm`;
    document.getElementById('metric-triangles').textContent = `${result.stats.triangles.toLocaleString()} tris`;
    document.getElementById('metric-vol').textContent = `${metrics.volumeCm3} cm³`;
    document.getElementById('metric-weight').textContent = `~${metrics.weightGrams} g`;
    document.getElementById('metric-time').textContent = `~${metrics.printTimeString}`;

    statusEl.textContent = `Modelo gerado com sucesso (${result.stats.triangles.toLocaleString()} triângulos)`;
  }
}

// Start application
window.addEventListener('DOMContentLoaded', () => {
  new StudioApp();
});
