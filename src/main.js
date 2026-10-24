import './style.css';
import { Viewer3D } from './viewer.js';
import { MeshGenerator } from './generator.js';
import { CloudAIService } from './api.js';

class StudioApp {
  constructor() {
    this.viewer = null;
    this.currentImage = null;
    this.currentEngine = 'cloud_meshy'; // 'cloud_meshy', 'volumetric', 'relief'
    this.isMultiView = false;

    this.multiImages = {
      front: null,
      side: null,
      back: null
    };

    this.options = {
      targetWidth: 80,
      reliefHeight: 20,
      baseThickness: 3,
      resolution: 140,
      smoothing: 2,
      shape: 'rect',
      invertDepth: false
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
    this.bindEngineTabs();
    this.bindSliders();
    this.bindToolbar();
    this.bindMaterials();
    this.bindExports();
    this.bindModals();
    this.bindApiModal();

    this.updateApiKeyBadge();

    // Load default sample
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

      // Ensure cloud engine is selected for multi-view
      const cloudTab = document.querySelector('.engine-tab[data-engine="cloud_meshy"]');
      if (cloudTab) cloudTab.click();
    });
  }

  loadSampleImage(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.updateImagePreview(img.src);
      this.generateLocalVolumetric();
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

        // Se for no motor cloud, executa ou avisa; caso contrário, gera local
        if (this.currentEngine === 'cloud_meshy') {
          this.triggerCloudGeneration();
        } else {
          this.generateLocalVolumetric();
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
      robot: { url: './samples/robot_toy.jpg', engine: 'volumetric', width: 70, height: 28 },
      dragon: { url: './samples/dragon_coin.jpg', engine: 'relief', width: 80, height: 8 },
      statue: { url: './samples/statue_bust.jpg', engine: 'volumetric', width: 80, height: 32 }
    };

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sample;
        const config = presets[key];
        if (!config) return;

        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.options.targetWidth = config.width;
        document.getElementById('param-width').value = config.width;
        document.getElementById('val-width').textContent = `${config.width} mm`;

        this.options.reliefHeight = config.height;
        document.getElementById('param-height').value = config.height;
        document.getElementById('val-height').textContent = `${config.height} mm`;

        const targetTab = document.querySelector(`.engine-tab[data-engine="${config.engine}"]`);
        if (targetTab) targetTab.click();

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
        const smoothGroup = document.getElementById('group-smooth');

        if (this.currentEngine === 'relief') {
          baseGroup.style.display = 'flex';
          smoothGroup.style.display = 'flex';
        } else if (this.currentEngine === 'volumetric') {
          baseGroup.style.display = 'none';
          smoothGroup.style.display = 'flex';
        } else {
          // cloud_meshy
          baseGroup.style.display = 'none';
          smoothGroup.style.display = 'none';
        }

        const genBtnText = document.getElementById('btn-generate-text');
        if (this.currentEngine === 'cloud_meshy') {
          genBtnText.textContent = 'Gerar Boneco 3D com IA Meshy';
        } else {
          genBtnText.textContent = 'Gerar Modelo 3D Agora';
        }
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
        valDisplay.textContent = `${val} ${unit}`;
      });
      slider.addEventListener('change', () => {
        if (this.currentEngine !== 'cloud_meshy') {
          this.generateLocalVolumetric();
        }
      });
    };

    bindRange('param-width', 'val-width', 'mm', 'targetWidth');
    bindRange('param-height', 'val-height', 'mm', 'reliefHeight');
    bindRange('param-base', 'val-base', 'mm', 'baseThickness');
    bindRange('param-smooth', 'val-smooth', 'Nível', 'smoothing', parseInt);

    document.getElementById('btn-generate').addEventListener('click', () => {
      if (this.currentEngine === 'cloud_meshy') {
        this.triggerCloudGeneration();
      } else {
        this.generateLocalVolumetric();
      }
    });
  }

  async triggerCloudGeneration() {
    const apiKey = CloudAIService.getStoredMeshyKey();
    if (!apiKey) {
      // Abre modal para o usuário inserir chave gratuita
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

      // Carregar GLB no Three.js
      if (resultUrls && resultUrls.glb) {
        progressMsg.textContent = 'Renderizando modelo 3D na mesa...';
        const modelInfo = await this.viewer.loadGLBFromUrl(resultUrls.glb);
        this.updateMetricsFromInfo(modelInfo);
        statusText.textContent = `Boneco 3D gerado com sucesso! (${modelInfo.stats.triangles.toLocaleString()} polígonos)`;
        statusText.style.color = '#34d399';
      }
    } catch (err) {
      alert(`Erro na geração: ${err.message}`);
      statusText.textContent = `Erro: ${err.message}`;
      statusText.style.color = '#ef4444';
    } finally {
      setTimeout(() => {
        progressWrap.classList.add('hidden');
      }, 2000);
    }
  }

  generateLocalVolumetric() {
    if (!this.currentImage) return;

    const statusEl = document.getElementById('gen-status');
    statusEl.textContent = 'Processando geometria 3D...';

    const processed = MeshGenerator.getImageData(this.currentImage, 140);
    this.viewer.setTextureFromCanvas(processed.canvas);

    let result;
    if (this.currentEngine === 'relief') {
      result = MeshGenerator.createWatertightRelief(processed, {
        targetWidth: this.options.targetWidth,
        reliefHeight: this.options.reliefHeight,
        baseThickness: this.options.baseThickness,
        smoothing: this.options.smoothing
      });
    } else {
      // Escultura 360° com isolamento de silhueta (sem fundo quadrado!)
      result = MeshGenerator.createVolumetric360(processed, {
        targetWidth: this.options.targetWidth,
        maxThickness: this.options.reliefHeight,
        smoothing: this.options.smoothing
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

    statusEl.textContent = `Modelo gerado com sucesso (${result.stats.triangles.toLocaleString()} tris)`;
  }

  updateMetricsFromInfo(info) {
    document.getElementById('metric-x').textContent = `${info.dimensions.width.toFixed(1)} mm`;
    document.getElementById('metric-y').textContent = `${info.dimensions.depth.toFixed(1)} mm`;
    document.getElementById('metric-z').textContent = `${info.dimensions.height.toFixed(1)} mm`;
    document.getElementById('metric-triangles').textContent = `${info.stats.triangles.toLocaleString()} tris`;

    const vol = (info.dimensions.width * info.dimensions.depth * info.dimensions.height * 0.45) / 1000;
    const weight = vol * 1.24 * 0.35;
    document.getElementById('metric-vol').textContent = `${vol.toFixed(1)} cm³`;
    document.getElementById('metric-weight').textContent = `~${weight.toFixed(1)} g`;
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
      if (res) alert(`Arquivo STL baixado com sucesso (${(res.sizeBytes / 1024).toFixed(1)} KB) pronto para o Slicer!`);
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
    const keyInput = document.getElementById('meshy-key-input');
    const saveBtn = document.getElementById('btn-save-api');

    document.getElementById('btn-open-api-config').addEventListener('click', () => {
      keyInput.value = CloudAIService.getStoredMeshyKey();
      apiModal.classList.remove('hidden');
    });

    document.getElementById('btn-close-api').addEventListener('click', () => {
      apiModal.classList.add('hidden');
    });

    saveBtn.addEventListener('click', () => {
      CloudAIService.setStoredMeshyKey(keyInput.value);
      this.updateApiKeyBadge();
      apiModal.classList.add('hidden');
      if (keyInput.value.trim()) {
        alert('Chave salva com sucesso no navegador! Agora ao clicar em Gerar, o modelo será gerado na nuvem.');
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new StudioApp();
});
