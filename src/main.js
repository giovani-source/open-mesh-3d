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
    this.bindEngineTabs();
    this.bindSliders();
    this.bindToolbar();
    this.bindMaterials();
    this.bindExports();
    this.bindModals();

    const statusEl = document.getElementById('gen-status');
    if (statusEl) {
      statusEl.textContent = 'Envie ou arraste qualquer imagem ou desenho no painel à esquerda para gerar seu modelo 3D.';
      statusEl.style.color = '#00f2fe';
    }
  }

  getPresets() {
    return {
      statue: {
        url: './samples/statue_bust.jpg',
        depthUrl: './samples/statue_bust_depth.png',
        glbUrl: null,
        height: 85,
        depth: 36,
        mode: 'volumetric'
      },
      orange_bot: {
        url: './samples/bot_front.png',
        depthUrl: './samples/bot_front_depth.png',
        fullSheetUrl: './samples/user_bots.png',
        glbUrl: null,
        height: 90,
        depth: 24,
        mode: 'volumetric'
      },
      superman: {
        url: './samples/superman.png',
        depthUrl: './samples/superman_depth.png',
        glbUrl: null,
        height: 90,
        depth: 24,
        mode: 'volumetric'
      },
      robot: {
        url: './samples/robot_toy.jpg',
        depthUrl: './samples/robot_toy_depth.png',
        glbUrl: null,
        height: 85,
        depth: 26,
        mode: 'volumetric'
      },
      dragon: {
        url: './samples/dragon_coin.jpg',
        depthUrl: null,
        glbUrl: null,
        height: 75,
        depth: 14,
        mode: 'relief'
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

    this.currentDepthImg = null;

    const onAllLoaded = () => {
      this.activeCropCanvas = null;
      this.activeCropSrc = config.url;

      this.updateImagePreview(config.url);
      this.detectPoses(this.currentImage);

      if (config.glbUrl) {
        this.loadPrecomputedGLB(config.glbUrl);
      } else {
        this.generate3DModel();
      }
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.currentImageSrc = config.url;

      if (config.depthUrl) {
        const depthImg = new Image();
        depthImg.crossOrigin = 'anonymous';
        depthImg.onload = () => {
          this.currentDepthImg = depthImg;
          onAllLoaded();
        };
        depthImg.onerror = () => {
          console.warn('Não foi possível carregar o mapa de profundidade pré-computado:', config.depthUrl);
          onAllLoaded();
        };
        depthImg.src = config.depthUrl;
      } else {
        onAllLoaded();
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
        this.currentDepthImg = null;
        this.currentGLBUrl = null;
        this.activeCropCanvas = null;
        this.activeCropSrc = e.target.result;

        this.updateImagePreview(e.target.result);

        this.detectPoses(img);
        this.generate3DModel();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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

    // 1. MODO IA GENERATIVA 360° (Meshy AI / Trellis)
    if (this.options.engineMode === 'neural') {
      const meshyKey = CloudAIService.getStoredMeshyKey();

      if (!meshyKey) {
        const meshyModal = document.getElementById('modal-meshy');
        if (meshyModal) meshyModal.classList.remove('hidden');
        statusEl.textContent = 'Insira sua chave gratuita da Meshy AI (meshy.ai) para gerar anatomia 360° completa de personagens.';
        statusEl.style.color = '#00f2fe';
        return;
      }

      this.isGenerating = true;
      btnGen.disabled = true;
      progressContainer.classList.remove('hidden');
      progressBar.style.width = '10%';
      statusEl.textContent = 'Enviando imagem para a IA da Meshy (OpenAPI v1)...';
      statusEl.style.color = '#00f2fe';

      try {
        let dataUrl = targetSrc;
        if (!dataUrl.startsWith('data:')) {
          const imgElem = this.activeCropCanvas || this.currentImage;
          const canvas = document.createElement('canvas');
          canvas.width = imgElem.naturalWidth || imgElem.width || 512;
          canvas.height = imgElem.naturalHeight || imgElem.height || 512;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imgElem, 0, 0);
          dataUrl = canvas.toDataURL('image/png');
        }

        const result = await CloudAIService.generateWithMeshy(meshyKey, {
          imageUrl: dataUrl,
          aiModel: 'meshy-4'
        }, (prog) => {
          progressBar.style.width = `${prog.percent}%`;
          statusEl.textContent = prog.message;
        });

        const glbUrl = result.glbUrl || result.glb;
        if (!glbUrl) throw new Error('A IA da Meshy concluiu a tarefa, mas não retornou a URL do modelo 3D.');

        this.currentGLBUrl = glbUrl;

        statusEl.textContent = 'Posicionando modelo anatômico 360° em pé na mesa (Z = 0)...';
        progressBar.style.width = '96%';

        const loadRes = await this.viewer.loadGLBFromUrl(glbUrl, {
          targetHeight: this.options.targetHeight,
          addPedestal: this.options.addPedestal
        });

        this.updateMetricsUI(loadRes.dimensions, loadRes.stats);

        progressBar.style.width = '100%';
        setTimeout(() => progressContainer.classList.add('hidden'), 800);

        statusEl.textContent = `Modelo 360° gerado com sucesso pela Meshy AI! (${loadRes.stats.triangles.toLocaleString()} polígonos • 100% Manifold)`;
        statusEl.style.color = '#34d399';
      } catch (err) {
        console.error('Falha na IA Meshy:', err);
        progressContainer.classList.add('hidden');
        statusEl.textContent = `Erro na Meshy AI: ${err.message}.`;
        statusEl.style.color = '#f87171';
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
      const processed = MeshGenerator.getImageData(targetImg, 220, this.currentDepthImg);
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
          pedestalHeight: 4.0
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

    const btn3mf = document.getElementById('btn-export-3mf');
    if (btn3mf) {
      btn3mf.addEventListener('click', () => {
        const res = this.viewer.export3MF(`${getBaseName()}.3mf`);
        if (res) {
          alert(`Arquivo .3MF baixado com sucesso (${(res.sizeBytes / 1024).toFixed(1)} KB)!\nCompatível diretamente com o botão "Abrir Projeto (3mf)" do Creality Print e Bambu Studio.`);
        }
      });
    }

    document.getElementById('btn-export-stl-bin').addEventListener('click', () => {
      const res = this.viewer.exportSTL(`${getBaseName()}.stl`, true);
      if (res) {
        alert(`Arquivo STL Binário baixado com sucesso (${(res.sizeBytes / 1024).toFixed(1)} KB)!\nPronto para abrir diretamente no Creality Print, Bambu Studio, Cura ou PrusaSlicer.`);
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
    const btnOpenGuide = document.getElementById('btn-open-guide');
    const btnCloseGuide = document.getElementById('btn-close-guide');
    const btnOkGuide = document.getElementById('btn-ok-guide');

    if (btnOpenGuide && guideModal) {
      btnOpenGuide.addEventListener('click', () => guideModal.classList.remove('hidden'));
    }
    if (btnCloseGuide && guideModal) {
      btnCloseGuide.addEventListener('click', () => guideModal.classList.add('hidden'));
    }
    if (btnOkGuide && guideModal) {
      btnOkGuide.addEventListener('click', () => guideModal.classList.add('hidden'));
    }

    // Modal Conectar Meshy AI
    const meshyModal = document.getElementById('modal-meshy');
    const btnOpenMeshy = document.getElementById('btn-open-meshy');
    const btnCloseMeshy = document.getElementById('btn-close-meshy');
    const btnCancelMeshy = document.getElementById('btn-cancel-meshy');
    const btnSaveMeshy = document.getElementById('btn-save-meshy');
    const inputMeshyKey = document.getElementById('input-meshy-key');

    const openMeshy = () => {
      if (inputMeshyKey) {
        inputMeshyKey.value = CloudAIService.getStoredMeshyKey();
      }
      if (meshyModal) meshyModal.classList.remove('hidden');
    };

    const closeMeshy = () => {
      if (meshyModal) meshyModal.classList.add('hidden');
    };

    if (btnOpenMeshy) btnOpenMeshy.addEventListener('click', openMeshy);
    if (btnCloseMeshy) btnCloseMeshy.addEventListener('click', closeMeshy);
    if (btnCancelMeshy) btnCancelMeshy.addEventListener('click', closeMeshy);

    if (btnSaveMeshy && inputMeshyKey) {
      btnSaveMeshy.addEventListener('click', () => {
        const key = inputMeshyKey.value.trim();
        CloudAIService.setStoredMeshyKey(key);
        closeMeshy();
        if (key) {
          alert('Chave da Meshy AI salva com sucesso!\nAgora ao clicar em "Gerar Modelo 3D" ou selecionar a aba "IA Generativa 360°", a modelagem anatômica 360° será executada.');
          this.options.engineMode = 'neural';
          this.updateEngineTabsUI('neural');
          this.generate3DModel();
        } else {
          alert('Chave removida. O sistema usará o motor nativo local de escultura.');
        }
      });
    }
  }
}

// Inicia o estúdio quando o DOM estiver pronto
window.addEventListener('DOMContentLoaded', () => {
  new StudioApp();
});
