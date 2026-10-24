import './style.css';
import { Viewer3D } from './viewer.js';
import { MeshGenerator } from './generator.js';
import { CloudAIService } from './api.js';

class StudioApp {
  constructor() {
    this.viewer = null;
    this.currentImage = null;
    this.currentImageSrc = null;
    this.isMultiView = false;

    this.multiImages = {
      front: null,
      side: null,
      back: null
    };

    this.options = {
      targetHeight: 90, // mm (em pé no eixo Z)
      depthRatio: 0.55, // proporção de volume frente/verso
      smoothing: 2
    };

    this.init();
  }

  init() {
    const container = document.getElementById('canvas-container');
    this.viewer = new Viewer3D(container);

    this.bindViewModeToggle();
    this.bindDropzones();
    this.bindMultiSlots();
    this.bindPresets();
    this.bindSliders();
    this.bindToolbar();
    this.bindMaterials();
    this.bindExports();
    this.bindModals();
    this.bindApiModal();

    this.updateApiKeyBadge();

    // Carrega o boneco inicial de exemplo em pé na mesa
    this.loadSampleImage('./samples/robot_toy.jpg');
  }

  updateApiKeyBadge() {
    const key = CloudAIService.getStoredMeshyKey();
    const btnText = document.getElementById('api-btn-text');
    if (key) {
      btnText.textContent = 'IA Meshy Conectada ✓';
    } else {
      btnText.textContent = 'Conectar IA Meshy';
    }
  }

  bindViewModeToggle() {
    const btnSingle = document.getElementById('btn-mode-single');
    const btnMulti = document.getElementById('btn-mode-multi');
    const singleBox = document.getElementById('single-upload-box');
    const multiBox = document.getElementById('multi-upload-box');

    btnSingle.addEventListener('click', () => {
      btnSingle.classList.add('active');
      btnMulti.classList.remove('active');
      singleBox.classList.remove('hidden');
      multiBox.classList.add('hidden');
      this.isMultiView = false;
    });

    btnMulti.addEventListener('click', () => {
      btnMulti.classList.add('active');
      btnSingle.classList.remove('active');
      multiBox.classList.remove('hidden');
      singleBox.classList.add('hidden');
      this.isMultiView = true;
    });
  }

  loadSampleImage(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.currentImageSrc = url;
      this.updateImagePreview(url);
      this.generateUpright3DModel();
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

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.currentImage = img;
        this.currentImageSrc = e.target.result;
        this.updateImagePreview(e.target.result);
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

        // Se houver chave Meshy, tenta nuvem; senão gera o boneco em pé instantâneo
        const key = CloudAIService.getStoredMeshyKey();
        if (key) {
          this.triggerCloudGeneration();
        } else {
          this.generateUpright3DModel();
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  bindMultiSlots() {
    const setupSlot = (slotId, fileId, imgId, key) => {
      const slot = document.getElementById(slotId);
      const fileInput = document.getElementById(fileId);
      const imgPrev = document.getElementById(imgId);
      const placeholder = slot.querySelector('.slot-placeholder');

      slot.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onload = (ev) => {
            imgPrev.src = ev.target.result;
            imgPrev.classList.remove('hidden');
            if (placeholder) placeholder.classList.add('hidden');
            this.multiImages[key] = ev.target.result;
          };
          reader.readAsDataURL(file);
        }
      });
    };

    setupSlot('slot-front', 'file-front', 'img-front-prev', 'front');
    setupSlot('slot-side', 'file-side', 'img-side-prev', 'side');
    setupSlot('slot-back', 'file-back', 'img-back-prev', 'back');
  }

  bindPresets() {
    const presets = {
      robot: { url: './samples/robot_toy.jpg', height: 90 },
      dragon: { url: './samples/dragon_coin.jpg', height: 80 },
      statue: { url: './samples/statue_bust.jpg', height: 85 }
    };

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sample;
        const config = presets[key];
        if (!config) return;

        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.options.targetHeight = config.height;
        document.getElementById('param-height').value = config.height;
        document.getElementById('val-height').textContent = `${config.height} mm`;

        this.loadSampleImage(config.url);
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
      this.generateUpright3DModel();
    });

    const depthSlider = document.getElementById('param-width');
    const depthVal = document.getElementById('val-width');
    depthSlider.addEventListener('input', () => {
      this.options.depthRatio = parseFloat(depthSlider.value) / 100;
      depthVal.textContent = `${Math.round(this.options.targetHeight * this.options.depthRatio)} mm`;
    });
    depthSlider.addEventListener('change', () => {
      this.generateUpright3DModel();
    });

    const smoothSlider = document.getElementById('param-smooth');
    const smoothVal = document.getElementById('val-smooth');
    smoothSlider.addEventListener('input', () => {
      this.options.smoothing = parseInt(smoothSlider.value);
      smoothVal.textContent = `Nível ${this.options.smoothing}`;
    });
    smoothSlider.addEventListener('change', () => {
      this.generateUpright3DModel();
    });

    document.getElementById('btn-generate').addEventListener('click', () => {
      const key = CloudAIService.getStoredMeshyKey();
      if (key) {
        this.triggerCloudGeneration();
      } else {
        this.generateUpright3DModel();
      }
    });
  }

  /**
   * Converte a imagem 2D em um Boneco 3D Volumétrico EM PÉ NA MESA
   */
  generateUpright3DModel() {
    if (!this.currentImage) return;

    const statusEl = document.getElementById('gen-status');
    statusEl.textContent = 'Isolando personagem e gerando corpo 3D em pé...';

    const processed = MeshGenerator.getImageData(this.currentImage, 140);
    this.viewer.setTextureFromCanvas(processed.canvas);

    const result = MeshGenerator.createUprightFigurine(processed, {
      targetHeight: this.options.targetHeight,
      depthRatio: this.options.depthRatio || 0.55,
      smoothing: this.options.smoothing
    });

    this.viewer.setModel(result.geometry, result.dimensions);
    const metrics = MeshGenerator.estimatePrintMetrics(result.geometry, 15);

    document.getElementById('metric-x').textContent = `${result.dimensions.width.toFixed(1)} mm`;
    document.getElementById('metric-y').textContent = `${result.dimensions.depth.toFixed(1)} mm`;
    document.getElementById('metric-z').textContent = `${result.dimensions.height.toFixed(1)} mm`;
    document.getElementById('metric-triangles').textContent = `${result.stats.triangles.toLocaleString()} tris`;
    document.getElementById('metric-vol').textContent = `${metrics.volumeCm3} cm³`;
    document.getElementById('metric-weight').textContent = `~${metrics.weightGrams} g`;
    document.getElementById('metric-time').textContent = `~${metrics.printTimeString}`;

    statusEl.textContent = `Boneco 3D em pé gerado com sucesso! (${result.stats.triangles.toLocaleString()} triângulos)`;
    statusEl.style.color = '#34d399';
  }

  async triggerCloudGeneration() {
    const apiKey = CloudAIService.getStoredMeshyKey();
    if (!apiKey) {
      document.getElementById('modal-api').classList.remove('hidden');
      return;
    }

    const progressWrap = document.getElementById('cloud-progress-wrap');
    const progressFill = document.getElementById('progress-bar-fill');
    const progressMsg = document.getElementById('progress-status-msg');
    const progressPercent = document.getElementById('progress-percent-val');
    const statusText = document.getElementById('gen-status');

    progressWrap.classList.remove('hidden');

    try {
      const resultUrls = await CloudAIService.generateWithMeshy(
        apiKey,
        {
          imageUrl: this.currentImageSrc || this.currentImage?.src,
          frontUrl: this.multiImages.front,
          sideUrl: this.multiImages.side,
          backUrl: this.multiImages.back,
          isMultiView: this.isMultiView,
          aiModel: 'meshy-4'
        },
        (progress) => {
          progressMsg.textContent = progress.message;
          progressPercent.textContent = `${progress.percent}%`;
          progressFill.style.width = `${progress.percent}%`;
        }
      );

      if (resultUrls && resultUrls.glb) {
        progressMsg.textContent = 'Posicionando boneco 3D em pé na mesa...';
        const modelInfo = await this.viewer.loadGLBFromUrl(resultUrls.glb);
        
        document.getElementById('metric-x').textContent = `${modelInfo.dimensions.width.toFixed(1)} mm`;
        document.getElementById('metric-y').textContent = `${modelInfo.dimensions.depth.toFixed(1)} mm`;
        document.getElementById('metric-z').textContent = `${modelInfo.dimensions.height.toFixed(1)} mm`;
        document.getElementById('metric-triangles').textContent = `${modelInfo.stats.triangles.toLocaleString()} tris`;

        const vol = (modelInfo.dimensions.width * modelInfo.dimensions.depth * modelInfo.dimensions.height * 0.45) / 1000;
        const weight = vol * 1.24 * 0.35;
        document.getElementById('metric-vol').textContent = `${vol.toFixed(1)} cm³`;
        document.getElementById('metric-weight').textContent = `~${weight.toFixed(1)} g`;

        statusText.textContent = `Boneco 3D gerado com sucesso via Meshy!`;
        statusText.style.color = '#34d399';
      }
    } catch (err) {
      alert(`Aviso: ${err.message}. Gerando boneco 3D em pé localmente.`);
      this.generateUpright3DModel();
    } finally {
      setTimeout(() => {
        progressWrap.classList.add('hidden');
      }, 2000);
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
    const getBaseName = () => `boneco_3d_${Date.now()}`;

    document.getElementById('btn-export-stl-bin').addEventListener('click', () => {
      const res = this.viewer.exportSTL(`${getBaseName()}.stl`, true);
      if (res) alert(`Modelo Aprovado! Arquivo STL baixado com sucesso (${(res.sizeBytes / 1024).toFixed(1)} KB) pronto para fatiar no Bambu Studio ou Cura!`);
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
    document.getElementById('btn-open-guide').addEventListener('click', () => guideModal.classList.remove('hidden'));
    document.getElementById('btn-close-guide').addEventListener('click', () => guideModal.classList.add('hidden'));
    document.getElementById('btn-ok-guide').addEventListener('click', () => guideModal.classList.add('hidden'));
  }

  bindApiModal() {
    const apiModal = document.getElementById('modal-api');
    const geminiInput = document.getElementById('gemini-key-input');
    const meshyInput = document.getElementById('meshy-key-input');
    const saveBtn = document.getElementById('btn-save-api');

    document.getElementById('btn-open-api-config').addEventListener('click', () => {
      geminiInput.value = CloudAIService.getStoredGeminiKey();
      meshyInput.value = CloudAIService.getStoredMeshyKey();
      apiModal.classList.remove('hidden');
    });

    document.getElementById('btn-close-api').addEventListener('click', () => {
      apiModal.classList.add('hidden');
    });

    saveBtn.addEventListener('click', () => {
      CloudAIService.setStoredGeminiKey(geminiInput.value);
      CloudAIService.setStoredMeshyKey(meshyInput.value);
      this.updateApiKeyBadge();
      apiModal.classList.add('hidden');
      alert('Chaves salvas com sucesso no navegador!');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new StudioApp();
});
