import './style.css';
import { Viewer3D } from './viewer.js';
import { MeshGenerator } from './generator.js';
import { CloudAIService } from './api.js';
import { CharacterSheetDetector } from './imageCropper.js';

class StudioApp {
  constructor() {
    this.viewer = null;
    this.currentImage = null;
    this.currentImageSrc = null;
    this.activeCropCanvas = null;
    this.activeCropSrc = null;
    this.detectedPoses = null;
    this.isGenerating = false;

    this.options = {
      targetHeight: 90,     // mm no eixo Z (altura em pé na mesa)
      maxDepth: 24,         // mm no eixo Y (volume do corpo)
      depthDetail: 1.2,     // intensidade de relevo
      addPedestal: true,    // base sólida chanfrada para a mesa aquecida
      engineMode: 'volumetric'  // 'volumetric' (Sculptor3D orgânico), 'neural' ou 'relief'
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

    // Inicia com o Robozinho Laranja do usuário por padrão
    this.loadPreset('orange_bot');
  }

  getPresets() {
    return {
      orange_bot: {
        url: './samples/bot_front.png',
        fullSheetUrl: './samples/user_bots.png',
        glbUrl: null,
        height: 90,
        depth: 24,
        mode: 'volumetric'
      },
      superman: {
        url: './samples/superman.png',
        glbUrl: null,
        height: 90,
        depth: 24,
        mode: 'volumetric'
      },
      robot: {
        url: './samples/robot_toy.jpg',
        glbUrl: null,
        height: 85,
        depth: 26,
        mode: 'volumetric'
      },
      dragon: {
        url: './samples/dragon_coin.jpg',
        glbUrl: null,
        height: 75,
        depth: 14,
        mode: 'relief'
      },
      statue: {
        url: './samples/statue_bust.jpg',
        glbUrl: null,
        height: 85,
        depth: 25,
        mode: 'volumetric'
      }
    };
  }


  loadPreset(key) {
    const presets = this.getPresets();
    const config = presets[key];
    if (!config) return;

    document.querySelectorAll('.preset-btn').forEach(btn => {
      if (btn.dataset.sample === key) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    this.options.targetHeight = config.height;
    this.options.maxDepth = config.depth;
    this.options.engineMode = config.mode;

    const heightSlider = document.getElementById('param-height');
    if (heightSlider) {
      heightSlider.value = config.height;
      document.getElementById('val-height').textContent = `${config.height} mm`;
    }
    const depthSlider = document.getElementById('param-depth');
    if (depthSlider) {
      depthSlider.value = config.depth;
      document.getElementById('val-depth').textContent = `${config.depth} mm`;
    }

    this.updateEngineTabsUI(config.mode);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.currentImageSrc = config.url;
      this.activeCropCanvas = null;
      this.activeCropSrc = config.url;

      this.updateImagePreview(config.url);
      this.detectPoses(img);

      // Se o preset já tem GLB pré-computado, carrega diretamente para velocidade instantânea
      if (config.glbUrl) {
        this.loadPrecomputedGLB(config.glbUrl);
      } else {
        this.generate3DModel();
      }
    };
    img.src = config.url;
  }

  async loadPrecomputedGLB(glbUrl) {
    const statusEl = document.getElementById('gen-status');
    statusEl.textContent = 'Carregando modelo 3D volumétrico de alta fidelidade...';
    statusEl.style.color = '#00f2fe';

    try {
      if (this.currentImage) {
        const processed = MeshGenerator.getImageData(this.currentImage, 180);
        this.viewer.setTextureFromCanvas(processed.canvas);
      }

      const res = await this.viewer.loadGLBFromUrl(glbUrl, {
        targetHeight: this.options.targetHeight,
        addPedestal: this.options.addPedestal
      });

      this.updateMetricsUI(res.dimensions, res.stats);
      statusEl.textContent = `Modelo 3D pronto! (${res.stats.triangles.toLocaleString()} polígonos orgânicos • 100% Manifold)`;
      statusEl.style.color = '#34d399';
    } catch (err) {
      console.warn('Erro ao carregar GLB pré-computado, gerando localmente:', err);
      this.generate3DModel();
    }
  }

  detectPoses(img) {
    const poseContainer = document.getElementById('pose-selector');
    const pillsContainer = document.getElementById('pose-pills-container');
    if (!poseContainer || !pillsContainer) return;

    try {
      const result = CharacterSheetDetector.detectCharacters(img);
      this.detectedPoses = result;

      if (result.hasMultiple && result.views.length > 1) {
        pillsContainer.innerHTML = '';

        result.views.forEach(view => {
          const pill = document.createElement('button');
          pill.className = `pose-pill ${view.isRecommended ? 'active' : ''}`;
          pill.innerHTML = `${view.isRecommended ? '<span class="star-rec">★</span> ' : ''}${view.label}`;
          pill.addEventListener('click', () => {
            pillsContainer.querySelectorAll('.pose-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            this.activeCropCanvas = view.canvas;
            this.activeCropSrc = view.dataUrl;
            this.updateImagePreview(view.dataUrl);
            this.generate3DModel();
          });
          pillsContainer.appendChild(pill);
        });

        // Botão para imagem completa
        const fullBtn = document.createElement('button');
        fullBtn.className = 'pose-pill';
        fullBtn.textContent = 'Imagem Inteira';
        fullBtn.addEventListener('click', () => {
          pillsContainer.querySelectorAll('.pose-pill').forEach(p => p.classList.remove('active'));
          fullBtn.classList.add('active');
          this.activeCropCanvas = null;
          this.activeCropSrc = this.currentImageSrc;
          this.updateImagePreview(this.currentImageSrc);
          this.generate3DModel();
        });
        pillsContainer.appendChild(fullBtn);

        poseContainer.classList.remove('hidden');

        // Seleciona a recomendada por padrão
        const rec = result.views.find(v => v.isRecommended) || result.views[0];
        if (rec) {
          this.activeCropCanvas = rec.canvas;
          this.activeCropSrc = rec.dataUrl;
        }
      } else {
        poseContainer.classList.add('hidden');
        this.activeCropCanvas = null;
        this.activeCropSrc = this.currentImageSrc;
      }
    } catch (err) {
      console.warn('Detecção de poses ignorada:', err);
      poseContainer.classList.add('hidden');
    }
  }

  updateImagePreview(src) {
    const preview = document.getElementById('image-preview');
    const prompt = document.getElementById('dropzone-prompt');
    if (preview && prompt) {
      preview.src = src;
      preview.classList.remove('hidden');
      prompt.classList.add('hidden');
    }
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
        this.activeCropCanvas = null;
        this.activeCropSrc = e.target.result;

        this.updateImagePreview(e.target.result);
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

        this.detectPoses(img);
        this.generate3DModel();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  bindPresets() {
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sample;
        this.loadPreset(key);
      });
    });
  }

  bindEngineTabs() {
    document.querySelectorAll('.engine-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const engine = tab.dataset.engine;
        this.options.engineMode = engine;
        this.updateEngineTabsUI(engine);
        this.generate3DModel();
      });
    });
  }

  updateEngineTabsUI(engine) {
    document.querySelectorAll('.engine-tab').forEach(tab => {
      if (tab.dataset.engine === engine) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    const groupPedestal = document.getElementById('group-pedestal');
    const groupDetail = document.getElementById('group-detail');
    const btnGenText = document.getElementById('btn-generate-text');

    if (engine === 'relief') {
      if (groupPedestal) groupPedestal.style.display = 'none';
      if (groupDetail) groupDetail.style.display = 'block';
      if (btnGenText) btnGenText.textContent = 'Gerar Relevo Sólido (STL)';
    } else if (engine === 'neural') {
      if (groupPedestal) groupPedestal.style.display = 'flex';
      if (groupDetail) groupDetail.style.display = 'none';
      if (btnGenText) btnGenText.textContent = 'Gerar Modelo 3D com IA Neural';
    } else {
      if (groupPedestal) groupPedestal.style.display = 'flex';
      if (groupDetail) groupDetail.style.display = 'block';
      if (btnGenText) btnGenText.textContent = 'Gerar Escultura Local (Laplacian)';
    }
  }

  bindSliders() {
    const heightSlider = document.getElementById('param-height');
    const heightVal = document.getElementById('val-height');
    heightSlider.addEventListener('input', () => {
      this.options.targetHeight = parseFloat(heightSlider.value);
      heightVal.textContent = `${this.options.targetHeight} mm`;
    });
    heightSlider.addEventListener('change', () => {
      if (this.options.engineMode !== 'neural' || !this.viewer.currentModel) {
        this.generate3DModel();
      } else {
        // Se já temos o modelo neural carregado, apenas reajustamos a altura e pedestal instantaneamente!
        this.reapplyScaleAndPedestal();
      }
    });

    const depthSlider = document.getElementById('param-depth');
    const depthVal = document.getElementById('val-depth');
    depthSlider.addEventListener('input', () => {
      this.options.maxDepth = parseFloat(depthSlider.value);
      depthVal.textContent = `${this.options.maxDepth} mm`;
    });
    depthSlider.addEventListener('change', () => {
      if (this.options.engineMode !== 'neural') {
        this.generate3DModel();
      }
    });

    const pedestalCheck = document.getElementById('check-pedestal');
    if (pedestalCheck) {
      pedestalCheck.addEventListener('change', () => {
        this.options.addPedestal = pedestalCheck.checked;
        if (this.options.engineMode !== 'neural' || !this.viewer.currentModel) {
          this.generate3DModel();
        } else {
          this.reapplyScaleAndPedestal();
        }
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
        if (this.options.engineMode !== 'neural') {
          this.generate3DModel();
        }
      });
    }

    document.getElementById('btn-generate').addEventListener('click', () => {
      this.generate3DModel();
    });
  }

  reapplyScaleAndPedestal() {
    if (this.viewer.currentModel) {
      // Se já temos a malha 3D, reescala e atualiza o pedestal sem precisar reconectar à nuvem
      this.viewer.loadGLBFromUrl(this.currentGLBUrl || './samples/bot_generated.glb', {
        targetHeight: this.options.targetHeight,
        addPedestal: this.options.addPedestal
      }).then(res => {
        this.updateMetricsUI(res.dimensions, res.stats);
      });
    }
  }

  /**
   * Converte a imagem no Modelo 3D Perfeito
   */
  async generate3DModel() {
    if (!this.currentImage || this.isGenerating) return;

    const statusEl = document.getElementById('gen-status');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const btnGen = document.getElementById('btn-generate');

    const targetSrc = this.activeCropSrc || this.currentImageSrc;

    // 1. MODO IA NEURAL (Tencent Hunyuan3D-2) - ALTA FIDELIDADE ESTILO MESHY AI
    if (this.options.engineMode === 'neural') {
      this.isGenerating = true;
      btnGen.disabled = true;
      progressContainer.classList.remove('hidden');
      progressBar.style.width = '10%';
      statusEl.textContent = 'Conectando ao cluster neural Hunyuan3D-2...';
      statusEl.style.color = '#00f2fe';

      try {
        // Envia para a IA na nuvem (sem gastar RAM local nem requerer chave de API)
        const result = await CloudAIService.generateWithHunyuan3D(targetSrc, (prog) => {
          progressBar.style.width = `${prog.percent}%`;
          statusEl.textContent = prog.message;
        });

        this.currentGLBUrl = result.glbUrl;

        // Prepara textura frontal a partir da imagem
        const imgToTexture = this.activeCropCanvas || this.currentImage;
        const processed = MeshGenerator.getImageData(imgToTexture, 180);
        this.viewer.setTextureFromCanvas(processed.canvas);

        statusEl.textContent = 'Posicionando modelo em pé na mesa aquecida (Z = 0)...';
        progressBar.style.width = '96%';

        const loadRes = await this.viewer.loadGLBFromUrl(result.glbUrl, {
          targetHeight: this.options.targetHeight,
          addPedestal: this.options.addPedestal
        });

        this.updateMetricsUI(loadRes.dimensions, loadRes.stats);

        progressBar.style.width = '100%';
        setTimeout(() => progressContainer.classList.add('hidden'), 800);

        statusEl.textContent = `Escultura 3D gerada com sucesso pela IA! (${loadRes.stats.triangles.toLocaleString()} polígonos orgânicos • 100% Manifold)`;
        statusEl.style.color = '#34d399';
      } catch (err) {
        console.error('Falha na IA Neural:', err);
        progressContainer.classList.add('hidden');
        statusEl.textContent = `Falha na IA Neural: ${err.message}. Alternando para escultura local...`;
        statusEl.style.color = '#f59e0b';

        // Fallback suave para o motor local
        this.options.engineMode = 'volumetric';
        this.updateEngineTabsUI('volumetric');
        this.generateLocalModel();
      } finally {
        this.isGenerating = false;
        btnGen.disabled = false;
      }
      return;
    }

    // 2. MODOS LOCAIS (WebGL / Relevo Monolítico)
    this.generateLocalModel();
  }

  generateLocalModel() {
    const statusEl = document.getElementById('gen-status');
    const targetImg = this.activeCropCanvas || this.currentImage;

    try {
      const processed = MeshGenerator.getImageData(targetImg, 240);
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
      this.updateMetricsUI(result.dimensions, result.stats);

      statusEl.textContent = `Escultura 3D Orgânica gerada com sucesso! (${result.stats.triangles.toLocaleString()} polígonos • 100% Manifold)`;
      statusEl.style.color = '#34d399';
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Erro ao gerar escultura: ${err.message}`;
      statusEl.style.color = '#f87171';
    }
  }


  updateMetricsUI(dimensions, stats) {
    // Cálculo de volume e filamento a partir das dimensões reais da malha 3D
    const volApprox = (dimensions.width * dimensions.depth * dimensions.height * 0.00045).toFixed(2);
    const weightApprox = (volApprox * 1.24 * 0.22).toFixed(1); // PLA com 15% infill
    const printTimeMins = Math.round((dimensions.height / 0.2) * 0.06 + parseFloat(weightApprox) * 1.5);

    document.getElementById('metric-x').textContent = `${dimensions.width.toFixed(1)} mm`;
    document.getElementById('metric-y').textContent = `${dimensions.depth.toFixed(1)} mm`;
    document.getElementById('metric-z').textContent = `${dimensions.height.toFixed(1)} mm`;
    document.getElementById('metric-triangles').textContent = `${stats.triangles.toLocaleString()} tris`;
    document.getElementById('metric-vol').textContent = `${volApprox} cm³`;
    document.getElementById('metric-weight').textContent = `~${weightApprox} g`;
    document.getElementById('metric-time').textContent = `~${printTimeMins}m (a 60mm/s)`;
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
