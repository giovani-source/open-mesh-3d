/**
 * Forge3D AI - Cloud AI Service Connector
 * Suporta Google Gemini Vision, Meshy AI e Microsoft TRELLIS
 */

export class CloudAIService {
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

    let endpoint = 'https://api.meshy.ai/v2/image-to-3d';
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
    return modelResult;
  }
}
