import { Client } from '@gradio/client';

/**
 * Forge3D AI - Cloud AI Service Connector
 * Suporta Tencent Hunyuan3D-2 (Nativo Grátis), Google Gemini Vision e Meshy AI
 */

export class CloudAIService {
  static async toBlob(input) {
    if (!input) return null;
    if (input instanceof Blob) return input;
    if (typeof input === 'string') {
      const res = await fetch(input);
      return await res.blob();
    }
    return null;
  }

  /**
   * Gera modelo 3D volumétrico real 360° através da IA Tencent Hunyuan3D-2 (100% Gratuito, sem necessidade de API key)
   * Suporta imagem única ou multi-ângulos (Frente, Lado, Costas) para máxima riqueza de detalhes
   */
  static async generateWithHunyuan3D(inputOrOptions, onProgress = () => {}) {
    onProgress({ stage: 'connecting', percent: 12, message: 'Conectando ao cluster neural Hunyuan3D-2 (100% Gratuito)...' });
    
    let frontBlob = null;
    let sideBlob = null;
    let backBlob = null;

    if (inputOrOptions && typeof inputOrOptions === 'object' && !(inputOrOptions instanceof Blob)) {
      frontBlob = await this.toBlob(inputOrOptions.front || inputOrOptions.imageUrl || inputOrOptions.image);
      sideBlob = await this.toBlob(inputOrOptions.side || inputOrOptions.profile);
      backBlob = await this.toBlob(inputOrOptions.back);
    } else {
      frontBlob = await this.toBlob(inputOrOptions);
    }

    if (!frontBlob) {
      throw new Error('Nenhuma imagem frontal fornecida.');
    }

    const hasMultiView = Boolean(sideBlob || backBlob);
    onProgress({
      stage: 'uploading',
      percent: 25,
      message: hasMultiView 
        ? 'Enviando múltiplos ângulos (Frente, Lado, Costas) para a IA...' 
        : 'Enviando imagem para a IA 3D...'
    });

    const hfToken = this.getStoredHfToken();
    const connectOpts = hfToken ? { hf_token: hfToken } : {};
    const app = await Client.connect('tencent/Hunyuan3D-2', connectOpts);
    
    onProgress({
      stage: 'generating',
      percent: 45,
      message: hasMultiView
        ? 'IA combinando 3 ângulos para escultura 360° com ultra detalhes...'
        : 'IA esculpindo anatomia 360° com redes neurais...'
    });

    let simPercent = 45;
    const interval = setInterval(() => {
      if (simPercent < 88) {
        simPercent += 5;
        onProgress({ stage: 'generating', percent: simPercent, message: `Modelando geometria orgânica 360°: ${simPercent}%...` });
      }
    }, 1500);

    try {
      const result = await app.predict('/shape_generation', {
        caption: null,
        image: frontBlob,
        mv_image_front: frontBlob,
        mv_image_back: backBlob || null,
        mv_image_left: sideBlob || null,
        mv_image_right: null,
        steps: 15,
        guidance_scale: 5.0,
        seed: 1234,
        octree_resolution: 256,
        check_box_rembg: true,
        num_chunks: 8000,
        randomize_seed: true
      });

      clearInterval(interval);
      onProgress({ stage: 'finalizing', percent: 92, message: 'Finalizando malha manifold 360° para fatiamento...' });

      let glbUrl = null;
      if (Array.isArray(result.data) && result.data[0]?.value) {
        glbUrl = result.data[0].value.url || result.data[0].value;
      }

      if (!glbUrl) {
        throw new Error('A IA concluiu o processamento mas o arquivo 3D não foi retornado.');
      }

      onProgress({ stage: 'done', percent: 100, message: 'Modelo 3D 360° gerado com sucesso!' });
      return { glbUrl, rawData: result.data };
    } catch (err) {
      clearInterval(interval);
      throw err;
    }
  }

  static getStoredHfToken() {
    return localStorage.getItem('forge3d_hf_token') || '';
  }

  static setStoredHfToken(token) {
    if (token) {
      localStorage.setItem('forge3d_hf_token', token.trim());
    } else {
      localStorage.removeItem('forge3d_hf_token');
    }
  }

  static getStoredGeminiKey() {
    return localStorage.getItem('forge3d_gemini_api_key') || '';
  }

  static setStoredGeminiKey(key) {
    if (key) {
      localStorage.setItem('forge3d_gemini_api_key', key.trim());
    } else {
      localStorage.removeItem('forge3d_gemini_api_key');
    }
  }

  static getStoredMeshyKey() {
    return localStorage.getItem('forge3d_meshy_api_key') || '';
  }

  static setStoredMeshyKey(key) {
    if (key) {
      localStorage.setItem('forge3d_meshy_api_key', key.trim());
    } else {
      localStorage.removeItem('forge3d_meshy_api_key');
    }
  }

  /**
   * Gera um modelo 3D através da API oficial da Meshy (com suporte a imagem única ou 3 ângulos Multi-View)
   */
  static async generateWithMeshy(apiKey, options, onProgress) {
    if (!apiKey) {
      throw new Error('Chave da Meshy não informada. Insira sua chave gratuita msy_... nas configurações.');
    }

    const { imageUrl, frontUrl, sideUrl, backUrl, isMultiView = false, aiModel = 'meshy-4' } = options;

    onProgress({ stage: 'uploading', percent: 15, message: 'Enviando imagens para a nuvem da Meshy...' });

    let endpoint = 'https://api.meshy.ai/openapi/v1/image-to-3d';
    let payload = {};

    if (isMultiView && (frontUrl || sideUrl || backUrl)) {
      endpoint = 'https://api.meshy.ai/v2/multi-view-to-3d';
      payload = {
        images: [
          frontUrl || imageUrl,
          sideUrl || frontUrl || imageUrl,
          backUrl || frontUrl || imageUrl
        ].filter(Boolean),
        ai_model: aiModel,
        topology: 'triangle',
        should_remesh: true
      };
    } else {
      payload = {
        image_url: imageUrl,
        ai_model: aiModel,
        topology: 'triangle',
        should_remesh: true,
        enable_pbr: true
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `Erro da API Meshy (${response.status})`);
    }

    const { result: taskId } = await response.json();
    onProgress({ stage: 'processing', percent: 30, message: 'IA da Meshy construindo geometria 360°...' });

    const checkEndpoint = `${endpoint}/${taskId}`;
    let isDone = false;
    let modelResult = null;

    while (!isDone) {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const checkRes = await fetch(checkEndpoint, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!checkRes.ok) continue;

      const data = await checkRes.json();
      const progress = data.progress || 0;
      onProgress({
        stage: data.status,
        percent: Math.min(95, 25 + Math.round(progress * 0.7)),
        message: `Construindo modelo 3D volumétrico: ${progress}%`
      });

      if (data.status === 'SUCCEEDED') {
        isDone = true;
        modelResult = data.model_urls;
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        throw new Error(data.task_error?.message || 'Falha na geração do modelo 3D pela IA.');
      }
    }

    onProgress({ stage: 'downloading', percent: 98, message: 'Baixando modelo 3D para visualização na mesa...' });
    return {
      glbUrl: modelResult?.glb,
      stlUrl: modelResult?.stl,
      objUrl: modelResult?.obj,
      ...modelResult
    };
  }
}
