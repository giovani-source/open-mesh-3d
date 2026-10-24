import './style.css';
import { Viewer3D } from './viewer.js';
import { MeshGenerator } from './generator.js';

class StudioApp {
  constructor() {
    this.viewer = null;
    this.currentImage = null;
    this.currentImageSrc = null;

    this.options = {
      targetHeight: 90,     // mm no eixo Z (altura em pé)
      maxDepth: 24,         // mm no eixo Y (volume do corpo)
      depthDetail: 1.2,     // intensidade de relevo muscular/dobras
      addPedestal: true,    // base sólida chanfrada para a mesa aquecida
      engineMode: 'volumetric' // 'volumetric' ou 'relief'
    };

    this.init();
  }

  init() {
    const container = document.getElementById('canvas-container');
    this.viewer = new Viewer3D(container);

    this.bindDropzones();
    this.bindPresets();
    this.bindEngineTabs();
    this.bindSliders();
    this.bindToolbar();
    this.bindMaterials();
    this.bindExports();
    this.bindModals();

    // Carrega o Superman como modelo inicial de demonstração
    this.loadSampleImage('./samples/superman.png');
  }

  loadSampleImage(url) {
    const statusEl = document.getElementById('gen-status');
    if (statusEl) statusEl.textContent = 'Carregando imagem de amostra...';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.currentImageSrc = url;
      this.updateImagePreview(url);
      this.generate3DModel();
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

  bindDropzones() {
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
      alert('Selecione uma imagem válida (PNG, JPG, WEBP).');
      return;
    }

    const statusEl = document.getElementById('gen-status');
    statusEl.textContent = 'Processando sua imagem e gerando escultura 3D...';
    statusEl.style.color = '#00f2fe';

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.currentImage = img;
        this.currentImageSrc = e.target.result;
        this.updateImagePreview(e.target.result);
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
        this.generate3DModel();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  bindPresets() {
    const presets = {
      superman: { url: './samples/superman.png', height: 90, depth: 24, mode: 'volumetric' },
      robot: { url: './samples/robot_toy.jpg', height: 85, depth: 26, mode: 'volumetric' },
      dragon: { url: './samples/dragon_coin.jpg', height: 75, depth: 14, mode: 'relief' },
      statue: { url: './samples/statue_bust.jpg', height: 85, depth: 25, mode: 'volumetric' }
    };

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sample;
        const config = presets[key];
        if (!config) return;

        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.options.targetHeight = config.height;
        this.options.maxDepth = config.depth;
        this.options.engineMode = config.mode;

        document.getElementById('param-height').value = config.height;
        document.getElementById('val-height').textContent = `${config.height} mm`;
        document.getElementById('param-depth').value = config.depth;
        document.getElementById('val-depth').textContent = `${config.depth} mm`;

        // Atualizar abas de modo
        document.querySelectorAll('.engine-tab').forEach(tab => {
          if (tab.dataset.engine === config.mode) {
            tab.classList.add('active');
          } else {
            tab.classList.remove('active');
          }
        });

        this.loadSampleImage(config.url);
      });
    });
  }

  bindEngineTabs() {
    document.querySelectorAll('.engine-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.engine-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.options.engineMode = tab.dataset.engine;

        const groupPedestal = document.getElementById('group-pedestal');
        if (this.options.engineMode === 'relief') {
          if (groupPedestal) groupPedestal.style.display = 'none';
        } else {
          if (groupPedestal) groupPedestal.style.display = 'flex';
        }

        this.generate3DModel();
      });
    });
  }

  bindSliders() {
    const heightSlider = document.getElementById('param-height');
    const heightVal = document.getElementById('val-height');
    heightSlider.addEventListener('input', () => {
      this.options.targetHeight = parseFloat(heightSlider.value);
      heightVal.textContent = `${this.options.targetHeight} mm`;
    });
    heightSlider.addEventListener('change', () => {
      this.generate3DModel();
    });

    const depthSlider = document.getElementById('param-depth');
    const depthVal = document.getElementById('val-depth');
    depthSlider.addEventListener('input', () => {
      this.options.maxDepth = parseFloat(depthSlider.value);
      depthVal.textContent = `${this.options.maxDepth} mm`;
    });
    depthSlider.addEventListener('change', () => {
      this.generate3DModel();
    });

    const pedestalCheck = document.getElementById('check-pedestal');
    if (pedestalCheck) {
      pedestalCheck.addEventListener('change', () => {
        this.options.addPedestal = pedestalCheck.checked;
        this.generate3DModel();
      });
    }

    const detailSlider = document.getElementById('param-detail');
    const detailVal = document.getElementById('val-detail');
    if (detailSlider) {
      detailSlider.addEventListener('input', () => {
        this.options.depthDetail = parseFloat(detailSlider.value);
        let label = 'Natural';
        if (this.options.depthDetail <= 0.4) label = 'Suave';
        else if (this.options.depthDetail >= 1.8) label = 'Realçado';
        detailVal.textContent = `${label} (${this.options.depthDetail.toFixed(1)})`;
      });
      detailSlider.addEventListener('change', () => {
        this.generate3DModel();
      });
    }

    document.getElementById('btn-generate').addEventListener('click', () => {
      this.generate3DModel();
    });
  }

  /**
   * Converte a imagem na Escultura 3D Volumétrica Real
   */
  generate3DModel() {
    if (!this.currentImage) return;

    const statusEl = document.getElementById('gen-status');
    statusEl.textContent = 'Processando silhueta e esculpindo anatomia 3D...';
    statusEl.style.color = '#00f2fe';

    try {
      const processed = MeshGenerator.getImageData(this.currentImage, 180);
      this.viewer.setTextureFromCanvas(processed.canvas);

      let result;
      if (this.options.engineMode === 'relief') {
        result = MeshGenerator.createReliefPlaque(processed, {
          targetWidth: this.options.targetHeight * 0.8,
          baseThickness: 3.0,
          reliefDepth: this.options.maxDepth * 0.5
        });
      } else {
        result = MeshGenerator.createVolumetricSculpture(processed, {
          targetHeight: this.options.targetHeight,
          maxDepth: this.options.maxDepth,
          depthDetail: this.options.depthDetail,
          addPedestal: this.options.addPedestal,
          pedestalHeight: 3.2
        });
      }

      this.viewer.setModel(result.geometry, result.dimensions);
      const metrics = MeshGenerator.estimatePrintMetrics(result.geometry, 15);

      document.getElementById('metric-x').textContent = `${result.dimensions.width.toFixed(1)} mm`;
      document.getElementById('metric-y').textContent = `${result.dimensions.depth.toFixed(1)} mm`;
      document.getElementById('metric-z').textContent = `${result.dimensions.height.toFixed(1)} mm`;
      document.getElementById('metric-triangles').textContent = `${result.stats.triangles.toLocaleString()} tris`;
      document.getElementById('metric-vol').textContent = `${metrics.volumeCm3} cm³`;
      document.getElementById('metric-weight').textContent = `~${metrics.weightGrams} g`;
      document.getElementById('metric-time').textContent = `~${metrics.printTimeString}`;

      statusEl.textContent = `Escultura 3D gerada com sucesso! (${result.stats.triangles.toLocaleString()} triângulos manifold)`;
      statusEl.style.color = '#34d399';
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Aviso ao processar imagem: ${err.message}`;
      statusEl.style.color = '#f87171';
    }
  }

  bindToolbar() {
    document.querySelectorAll('.top-toolbar .tool-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.top-toolbar .tool-btn[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.viewer.setCameraView(btn.dataset.view);
      });
    });

    const bedBtn = document.getElementById('btn-toggle-bed');
    bedBtn.addEventListener('click', () => {
      const active = bedBtn.classList.toggle('active');
      this.viewer.setBedVisible(active);
    });

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
    const getBaseName = () => `forge3d_escultura_${Date.now()}`;

    document.getElementById('btn-export-stl-bin').addEventListener('click', () => {
      const res = this.viewer.exportSTL(`${getBaseName()}.stl`, true);
      if (res) {
        alert(`Arquivo STL Binário baixado com sucesso (${(res.sizeBytes / 1024).toFixed(1)} KB)!\nPronto para abrir diretamente no Bambu Studio, Cura ou PrusaSlicer.`);
      }
    });

    document.getElementById('btn-export-obj').addEventListener('click', () => {
      this.viewer.exportOBJ(`${getBaseName()}.obj`);
    });

    document.getElementById('btn-export-glb').addEventListener('click', () => {
      this.viewer.exportGLB(`${getBaseName()}.glb`);
    });
  }

  bindModals() {
    const guideModal = document.getElementById('modal-guide');
    document.getElementById('btn-open-guide').addEventListener('click', () => {
      guideModal.classList.remove('hidden');
    });
    document.getElementById('btn-close-guide').addEventListener('click', () => {
      guideModal.classList.add('hidden');
    });
    document.getElementById('btn-ok-guide').addEventListener('click', () => {
      guideModal.classList.add('hidden');
    });
  }
}

// Inicia o estúdio quando o DOM estiver pronto
window.addEventListener('DOMContentLoaded', () => {
  new StudioApp();
});
