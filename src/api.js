import { Client } from '@gradio/client';

/**
 * Forge3D AI - Cloud AI Service Connector
 * Suporta Tencent Hunyuan3D-2 (Nativo Grátis), Google Gemini Vision e Meshy AI
 */

export class CloudAIService {
  /**
   * Gera modelo 3D volumétrico real 360° através da IA Tencent Hunyuan3D-2 (100% Gratuito, sem necessidade de API key)
   */
  static async generateWithHunyuan3D(imageBlobOrUrl, onProgress = () => {}) {
    onProgress({ stage: 'connecting', percent: 10, message: 'Conectando ao cluster neural Hunyuan3D-2...' });
    
    let imageBlob = imageBlobOrUrl;
    if (typeof imageBlobOrUrl === 'string') {
      const res = await fetch(imageBlobOrUrl);
      imageBlob = await res.blob();
    }

    onProgress({ stage: 'uploading', percent: 25, message: 'Enviando imagem para a IA...' });

    const hfToken = this.getStoredHfToken();
    const connectOpts = hfToken ? { hf_token: hfToken } : {};
    const app = await Client.connect('frogleo/Image-to-3D', connectOpts);
    
    onProgress({ stage: 'generating', percent: 45, message: 'IA esculpindo anatomia 360° com redes neurais...' });

    let simPercent = 45;
    const interval = setInterval(() => {
      if (simPercent < 85) {
        simPercent += 5;
        onProgress({ stage: 'generating', percent: simPercent, message: `Reconstruindo malha orgânica 3D: ${simPercent}%...` });
      }
    }, 2000);

    try {
      const result = await app.predict('/gen_shape', {
        image: imageBlob,
        steps: 12,
        guidance_scale: 5.5,
        seed: 1234,
        octree_resolution: 256,
        num_chunks: 8000,
        target_face_num: 10000,
        randomize_seed: true
      });

      clearInterval(interval);
      onProgress({ stage: 'finalizing', percent: 92, message: 'Finalizando topologia manifold para impressão 3D...' });

      let glbUrl = null;
      let objUrl = null;

      if (Array.isArray(result.data)) {
        if (typeof result.data[2] === 'string' && result.data[2].endsWith('.glb')) {
          glbUrl = `https://frogleo-image-to-3d.hf.space${result.data[2]}`;
        }
        if (result.data[1]?.value?.url) {
          objUrl = result.data[1].value.url;
        } else if (typeof result.data[3] === 'string' && result.data[3].endsWith('.obj')) {
          objUrl = `https://frogleo-image-to-3d.hf.space${result.data[3]}`;
        }
      }

      if (!glbUrl && !objUrl) {
        throw new Error('A IA concluiu o processamento mas o arquivo 3D não foi retornado.');
      }

      onProgress({ stage: 'done', percent: 100, message: 'Modelo 3D volumétrico gerado com sucesso!' });
      return { glbUrl, objUrl, rawData: result.data };
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
