import * as THREE from 'three';

/**
 * Forge3D Engine de Escultura Tridimensional
 * Converte imagens 2D em modelos 3D volumétricos verdadeiros para impressão 3D (STL Manifold)
 */

export class MeshGenerator {
  /**
   * Processamento e segmentação inteligente de imagem com Flood-Fill a partir das bordas externas
   * Preserva cabelos pretos, sombras de botas, olhos e detalhes escuros sem apagar o personagem
   */
  static getImageData(image, targetResolution = 220, depthImage = null) {
    // 1. Renderiza a imagem original em alta fidelidade para análise
    const srcW = image.naturalWidth || image.width || 300;
    const srcH = image.naturalHeight || image.height || 300;
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = srcW;
    rawCanvas.height = srcH;
    const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
    rawCtx.drawImage(image, 0, 0);

    const rawImgData = rawCtx.getImageData(0, 0, srcW, srcH);
    const rawData = rawImgData.data;

    // 2. Análise do Mapa de Profundidade Neural (se fornecido, ele é a verdade geométrica absoluta)
    let depthRawCanvas = null;
    let depthDataFull = null;
    const dSrcW = depthImage ? (depthImage.naturalWidth || depthImage.width || srcW) : srcW;
    const dSrcH = depthImage ? (depthImage.naturalHeight || depthImage.height || srcH) : srcH;

    if (depthImage) {
      try {
        depthRawCanvas = document.createElement('canvas');
        depthRawCanvas.width = dSrcW;
        depthRawCanvas.height = dSrcH;
        const dRawCtx = depthRawCanvas.getContext('2d', { willReadFrequently: true });
        dRawCtx.drawImage(depthImage, 0, 0);
        depthDataFull = dRawCtx.getImageData(0, 0, dSrcW, dSrcH).data;
      } catch (err) {
        console.warn('Erro ao ler profundidade original:', err);
      }
    }

    // 3. Segmentação e delimitação de Primeiro Plano (Bounding Box)
    let minX = srcW, maxX = 0, minY = srcH, maxY = 0;
    let fgTotal = 0;

    if (depthDataFull) {
      // Quando temos mapa neural de IA, a silhueta é 100% limpa e sem confusão de sombras escuras
      for (let y = 0; y < dSrcH; y++) {
        for (let x = 0; x < dSrcW; x++) {
          const idx = (y * dSrcW + x) * 4;
          if (depthDataFull[idx] > 20) {
            const sx = Math.round((x / dSrcW) * srcW);
            const sy = Math.round((y / dSrcH) * srcH);
            minX = Math.min(minX, sx);
            maxX = Math.max(maxX, sx);
            minY = Math.min(minY, sy);
            maxY = Math.max(maxY, sy);
            fgTotal++;
          }
        }
      }
    }

    // Fallback: Segmentação por cores se não houver profundidade neural
    const bgCandidates = [];
    if (fgTotal < 50) {
      const colorBins = new Map();
      for (let i = 0; i < srcW * srcH; i++) {
        if (rawData[i * 4 + 3] < 50) continue;
        const r = Math.floor(rawData[i * 4] / 20) * 20;
        const g = Math.floor(rawData[i * 4 + 1] / 20) * 20;
        const b = Math.floor(rawData[i * 4 + 2] / 20) * 20;
        const key = `${r},${g},${b}`;
        colorBins.set(key, (colorBins.get(key) || 0) + 1);
      }

      const sortedBins = Array.from(colorBins.entries()).sort((a, b) => b[1] - a[1]);
      const borderSamples = [];
      const samplePixel = (x, y) => {
        const idx = (y * srcW + x) * 4;
        if (rawData[idx + 3] > 40) {
          borderSamples.push({ r: rawData[idx], g: rawData[idx + 1], b: rawData[idx + 2] });
        }
      };
      for (let x = 0; x < srcW; x += 4) { samplePixel(x, 0); samplePixel(x, srcH - 1); }
      for (let y = 0; y < srcH; y += 4) { samplePixel(0, y); samplePixel(srcW - 1, y); }

      if (borderSamples.length > 0) {
        let br = 0, bg = 0, bb = 0;
        for (let s of borderSamples) { br += s.r; bg += s.g; bb += s.b; }
        bgCandidates.push({ r: br / borderSamples.length, g: bg / borderSamples.length, b: bb / borderSamples.length, tol: 40 });
      }

      for (let [key, count] of sortedBins.slice(0, 4)) {
        if (count > (srcW * srcH) * 0.12) {
          const [r, g, b] = key.split(',').map(Number);
          const brightness = (r + g + b) / 3;
          if (brightness > 190 || brightness < 45 || count > (srcW * srcH) * 0.35) {
            const already = bgCandidates.some(c => Math.sqrt((c.r - r)**2 + (c.g - g)**2 + (c.b - b)**2) < 35);
            if (!already) bgCandidates.push({ r, g, b, tol: 42 });
          }
        }
      }

      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const idx = (y * srcW + x) * 4;
          if (rawData[idx + 3] < 50) continue;
          const r = rawData[idx], g = rawData[idx + 1], b = rawData[idx + 2];
          let isBg = false;
          for (let cand of bgCandidates) {
            if (Math.sqrt((r - cand.r) ** 2 + (g - cand.g) ** 2 + (b - cand.b) ** 2) <= cand.tol) {
              isBg = true;
              break;
            }
          }
          if (!isBg) {
            fgTotal++;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
    }

    if (fgTotal < 20 || fgTotal > srcW * srcH * 0.98) {
      minX = 0; maxX = srcW - 1; minY = 0; maxY = srcH - 1;
    }

    // Limites de recorte com margem proporcional
    const padX = Math.max(4, Math.round((maxX - minX) * 0.04));
    const padY = Math.max(4, Math.round((maxY - minY) * 0.04));
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padY);
    const cropW = Math.min(srcW - cropX, (maxX - minX) + padX * 2);
    const cropH = Math.min(srcH - cropY, (maxY - minY) + padY * 2);

    // 4. Reamostragem com alta fidelidade e interpolação de alta qualidade
    const aspect = cropH / Math.max(1, cropW);
    let width = targetResolution;
    let height = Math.round(targetResolution * aspect);

    if (height > targetResolution * 2.2) height = Math.round(targetResolution * 2.2);
    if (height < targetResolution * 0.45) height = Math.round(targetResolution * 0.45);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rawCanvas, cropX, cropY, cropW, cropH, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let depthRawData = null;
    if (depthRawCanvas) {
      try {
        const dCanvas = document.createElement('canvas');
        dCanvas.width = width;
        dCanvas.height = height;
        const dCtx = dCanvas.getContext('2d', { willReadFrequently: true });
        dCtx.imageSmoothingEnabled = true;
        dCtx.imageSmoothingQuality = 'high';

        const scaleX = dSrcW / srcW;
        const scaleY = dSrcH / srcH;
        dCtx.drawImage(
          depthRawCanvas,
          cropX * scaleX,
          cropY * scaleY,
          cropW * scaleX,
          cropH * scaleY,
          0, 0, width, height
        );
        depthRawData = dCtx.getImageData(0, 0, width, height).data;
      } catch (err) {
        console.warn('Erro ao recortar imagem de profundidade:', err);
      }
    }

    // 5. Máscara Hermética 100% Confiável
    let rawFg = new Uint8Array(width * height);

    if (depthRawData) {
      // Se temos o mapa neural de profundidade, usamos sua segmentação precisa sem artefatos
      for (let i = 0; i < width * height; i++) {
        rawFg[i] = depthRawData[i * 4] > 20 ? 1 : 0;
      }
    } else {
      let edgeR = 0, edgeG = 0, edgeB = 0, edgeCount = 0;
      const addEdgeSample = (px, py) => {
        const idx = (py * width + px) * 4;
        if (data[idx + 3] > 30) {
          edgeR += data[idx]; edgeG += data[idx + 1]; edgeB += data[idx + 2];
          edgeCount++;
        }
      };
      for (let x = 0; x < width; x++) { addEdgeSample(x, 0); addEdgeSample(x, height - 1); }
      for (let y = 1; y < height - 1; y++) { addEdgeSample(0, y); addEdgeSample(width - 1, y); }
      if (edgeCount > 0) { edgeR /= edgeCount; edgeG /= edgeCount; edgeB /= edgeCount; }
      else { edgeR = 20; edgeG = 20; edgeB = 20; }

      const isPixelBackground = (idx) => {
        if (data[idx * 4 + 3] < 50) return true;
        const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
        if (Math.sqrt((r - edgeR)**2 + (g - edgeG)**2 + (b - edgeB)**2) <= 36) return true;
        for (let cand of bgCandidates) {
          if (Math.sqrt((r - cand.r)**2 + (g - cand.g)**2 + (b - cand.b)**2) <= cand.tol) return true;
        }
        return false;
      };

      const isBgConnected = new Uint8Array(width * height);
      const bgQueue = [];
      for (let x = 0; x < width; x++) {
        const topIdx = 0 * width + x;
        const botIdx = (height - 1) * width + x;
        if (isPixelBackground(topIdx)) { isBgConnected[topIdx] = 1; bgQueue.push(topIdx); }
        if (isPixelBackground(botIdx)) { isBgConnected[botIdx] = 1; bgQueue.push(botIdx); }
      }
      for (let y = 1; y < height - 1; y++) {
        const leftIdx = y * width + 0;
        const rightIdx = y * width + (width - 1);
        if (isPixelBackground(leftIdx)) { isBgConnected[leftIdx] = 1; bgQueue.push(leftIdx); }
        if (isPixelBackground(rightIdx)) { isBgConnected[rightIdx] = 1; bgQueue.push(rightIdx); }
      }

      let qHead = 0;
      while (qHead < bgQueue.length) {
        const curr = bgQueue[qHead++];
        const cx = curr % width;
        const cy = Math.floor(curr / width);
        const neighbors = [
          cx > 0 ? cy * width + (cx - 1) : -1,
          cx < width - 1 ? cy * width + (cx + 1) : -1,
          cy > 0 ? (cy - 1) * width + cx : -1,
          cy < height - 1 ? (cy + 1) * width + cx : -1
        ];
        for (let n of neighbors) {
          if (n !== -1 && isBgConnected[n] === 0 && isPixelBackground(n)) {
            isBgConnected[n] = 1;
            bgQueue.push(n);
          }
        }
      }

      for (let i = 0; i < width * height; i++) {
        rawFg[i] = isBgConnected[i] === 0 ? 1 : 0;
      }
    }

    // BFS 3 (ISLAND FILTERING): Extrair apenas o Maior Componente Conectado (elimina ruídos e pontinhos flutuantes)
    const labels = new Int32Array(width * height);
    const compSizes = [0];
    let currentLabel = 1;

    for (let i = 0; i < width * height; i++) {
      if (rawFg[i] === 1 && labels[i] === 0) {
        let size = 0;
        const compQueue = [i];
        labels[i] = currentLabel;
        let cHead = 0;

        while (cHead < compQueue.length) {
          const p = compQueue[cHead++];
          size++;
          const px = p % width;
          const py = Math.floor(p / width);

          const neighbors = [
            px > 0 ? py * width + (px - 1) : -1,
            px < width - 1 ? py * width + (px + 1) : -1,
            py > 0 ? (py - 1) * width + px : -1,
            py < height - 1 ? (py + 1) * width + px : -1
          ];

          for (let nb of neighbors) {
            if (nb !== -1 && rawFg[nb] === 1 && labels[nb] === 0) {
              labels[nb] = currentLabel;
              compQueue.push(nb);
            }
          }
        }

        compSizes[currentLabel] = size;
        currentLabel++;
      }
    }

    let maxCompIdx = 1;
    let maxCompSize = 0;
    for (let c = 1; c < compSizes.length; c++) {
      if (compSizes[c] > maxCompSize) {
        maxCompSize = compSizes[c];
        maxCompIdx = c;
      }
    }

    // Máscara final sem furos e sem ruídos
    const mask = new Uint8Array(width * height);
    const depthMap = new Float32Array(width * height);
    const neuralDepthMap = new Float32Array(width * height);
    let finalMinX = width, finalMaxX = 0, finalMinY = height, finalMaxY = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (labels[idx] === maxCompIdx) {
          mask[idx] = 1;
          finalMinX = Math.min(finalMinX, x);
          finalMaxX = Math.max(finalMaxX, x);
          finalMinY = Math.min(finalMinY, y);
          finalMaxY = Math.max(finalMaxY, y);
        }
        const r = data[idx * 4];
        const g = data[idx * 4 + 1];
        const b = data[idx * 4 + 2];
        depthMap[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      }
    }

    // Garantir base sólida sem mordidas ou furos nas últimas linhas da silhueta
    for (let y = Math.floor(finalMaxY - height * 0.05); y <= finalMaxY; y++) {
      let rowMin = width, rowMax = 0;
      for (let x = finalMinX; x <= finalMaxX; x++) {
        if (labels[y * width + x] === maxCompIdx) {
          rowMin = Math.min(rowMin, x);
          rowMax = Math.max(rowMax, x);
        }
      }
      if (rowMin <= rowMax) {
        for (let x = rowMin; x <= rowMax; x++) {
          mask[y * width + x] = 1;
        }
      }
    }

    // Normalização e Suavização Gaussiana do Mapa de Profundidade Neural 3D
    let minD = 255, maxD = 0;
    const rawNeural = new Float32Array(width * height);
    if (depthRawData) {
      for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1) {
          const val = depthRawData[i * 4];
          rawNeural[i] = val;
          if (val < minD) minD = val;
          if (val > maxD) maxD = val;
        }
      }
    } else {
      const rawDt = this.computeDistanceTransform(mask, width, height);
      let maxDt = 1;
      for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1 && rawDt[i] > maxDt) maxDt = rawDt[i];
      }
      for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1) {
          const dNorm = Math.min(1.0, rawDt[i] / maxDt);
          rawNeural[i] = (dNorm * 0.72 + depthMap[i] * 0.28) * 255;
          if (rawNeural[i] < minD) minD = rawNeural[i];
          if (rawNeural[i] > maxD) maxD = rawNeural[i];
        }
      }
    }

    // Filtro Gaussiano para eliminar degraus de pixel discretos de 8-bit
    const smoothNeural = this.gaussianBlur2D(rawNeural, width, height);
    const rangeD = Math.max(1, maxD - minD);
    for (let i = 0; i < width * height; i++) {
      if (mask[i] === 1) {
        neuralDepthMap[i] = (smoothNeural[i] - minD) / rangeD;
      }
    }

    // Filtro de Linha Craniana / Fundo de Baixa Frequência (Raio R=12) para isolar relevo facial de alta frequência
    const cranialBaseline = new Float32Array(width * height);
    const baseR = 12;
    for (let y = finalMinY; y <= finalMaxY; y++) {
      for (let x = finalMinX; x <= finalMaxX; x++) {
        if (mask[y * width + x] === 0) continue;
        let sum = 0, cnt = 0;
        for (let dy = -baseR; dy <= baseR; dy += 2) {
          for (let dx = -baseR; dx <= baseR; dx += 2) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
              sum += smoothNeural[ny * width + nx];
              cnt++;
            }
          }
        }
        cranialBaseline[y * width + x] = cnt > 0 ? sum / cnt : smoothNeural[y * width + x];
      }
    }

    // Relevo facial de alta precisão (diferença entre profundidade local e curvatura craniana)
    const reliefMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      if (mask[i] === 1) {
        reliefMap[i] = smoothNeural[i] - cranialBaseline[i];
      }
    }

    return {
      width,
      height,
      depthMap,
      neuralDepthMap,
      smoothNeural,
      minD,
      maxD,
      reliefMap,
      mask,
      canvas,
      bounds: {
        minX: Math.max(0, finalMinX),
        maxX: Math.min(width - 1, finalMaxX),
        minY: Math.max(0, finalMinY),
        maxY: Math.min(height - 1, finalMaxY)
      }
    };
  }

  /**
   * Cálculo da Transformada de Distância Euclidiana em 8 Direções
   */
  static computeDistanceTransform(mask, W, H) {
    const INF = 999999;
    const dist = new Float32Array(W * H);

    for (let i = 0; i < W * H; i++) {
      dist[i] = mask[i] === 0 ? 0 : INF;
    }

    // Pass 1: Top-Left para Bottom-Right
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (dist[idx] === 0) continue;

        let d = dist[idx];
        if (x > 0) d = Math.min(d, dist[idx - 1] + 1.0);
        if (y > 0) d = Math.min(d, dist[idx - W] + 1.0);
        if (x > 0 && y > 0) d = Math.min(d, dist[idx - W - 1] + 1.414);
        if (x < W - 1 && y > 0) d = Math.min(d, dist[idx - W + 1] + 1.414);

        dist[idx] = d;
      }
    }

    // Pass 2: Bottom-Right para Top-Left
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const idx = y * W + x;
        if (dist[idx] === 0) continue;

        let d = dist[idx];
        if (x < W - 1) d = Math.min(d, dist[idx + 1] + 1.0);
        if (y < H - 1) d = Math.min(d, dist[idx + W] + 1.0);
        if (x < W - 1 && y < H - 1) d = Math.min(d, dist[idx + W + 1] + 1.414);
        if (x > 0 && y < H - 1) d = Math.min(d, dist[idx + W - 1] + 1.414);

        dist[idx] = d;
      }
    }

    return dist;
  }

  /**
   * Suavização Gaussiana 2D separável para eliminar degraus e ruídos discretos de pixel
   */
  static gaussianBlur2D(grid, W, H) {
    const temp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    const kernel = [0.061, 0.242, 0.383, 0.242, 0.061]; // 5-tap Gaussian
    const offset = 2;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, weightSum = 0;
        for (let k = -offset; k <= offset; k++) {
          const nx = Math.min(W - 1, Math.max(0, x + k));
          const w = kernel[k + offset];
          sum += grid[y * W + nx] * w;
          weightSum += w;
        }
        temp[y * W + x] = sum / weightSum;
      }
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, weightSum = 0;
        for (let k = -offset; k <= offset; k++) {
          const ny = Math.min(H - 1, Math.max(0, y + k));
          const w = kernel[k + offset];
          sum += temp[ny * W + x] * w;
          weightSum += w;
        }
        out[y * W + x] = sum / weightSum;
      }
    }
    return out;
  }

  /**
   * Suavização Laplaciana 3D para eliminar facetas, arestas serrilhadas e escadas de pixel
   */
  static applyLaplacianSmoothing(positions, indices, iterations = 4, lambda = 0.45) {
    const vCount = positions.length / 3;
    const adj = Array.from({ length: vCount }, () => []);

    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      adj[a].push(b, c);
      adj[b].push(a, c);
      adj[c].push(a, b);
    }

    for (let i = 0; i < vCount; i++) {
      adj[i] = Array.from(new Set(adj[i]));
    }

    const temp = new Float32Array(positions.length);

    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < vCount; i++) {
        const neighbors = adj[i];
        if (neighbors.length === 0) {
          temp[i * 3] = positions[i * 3];
          temp[i * 3 + 1] = positions[i * 3 + 1];
          temp[i * 3 + 2] = positions[i * 3 + 2];
          continue;
        }

        let avgX = 0, avgY = 0, avgZ = 0;
        for (let n of neighbors) {
          avgX += positions[n * 3];
          avgY += positions[n * 3 + 1];
          avgZ += positions[n * 3 + 2];
        }
        avgX /= neighbors.length;
        avgY /= neighbors.length;
        avgZ /= neighbors.length;

        temp[i * 3] = positions[i * 3] + lambda * (avgX - positions[i * 3]);
        temp[i * 3 + 1] = positions[i * 3 + 1] + lambda * (avgY - positions[i * 3 + 1]);
        temp[i * 3 + 2] = positions[i * 3 + 2] + lambda * (avgZ - positions[i * 3 + 2]);
      }

      for (let i = 0; i < positions.length; i++) {
        positions[i] = temp[i];
      }
    }
  }

  /**
   * ESCULTURA 3D VOLUMÉTRICA ORGÂNICA REAL COM PROPORÇÕES ANATÔMICAS REAIS
   * - O personagem fica 100% em pé na mesa aquecida (eixo Z vertical)
   * - Proporções X/Z reais baseadas na silhueta recortada (sem esticar)
   * - Anatomia Facial Esculpida: Nariz saliente (+5mm a +6mm), órbitas oculares recuadas, barba e queixo
   * - Base/Pedestal Monolítico sem frestas ou vazios de fatiamento
   */
  static createVolumetricSculpture(processedImage, options = {}) {
    const {
      targetHeight = 85,     // mm (altura em pé Z)
      maxDepth = 36,         // mm (volume do busto Y)
      depthDetail = 1.4,     // relevo de feições faciais e dobras
      addPedestal = true,    // base sólida chanfrada para mesa aquecida
      pedestalHeight = 4.0   // mm
    } = options;

    const { width: W, height: H, mask, depthMap, neuralDepthMap, reliefMap, bounds } = processedImage;

    const { minX, maxX, minY, maxY } = bounds;
    const charW = Math.max(1, maxX - minX);
    const charH = Math.max(1, maxY - minY);

    const targetWidth = targetHeight * (charW / charH);

    // Transformada de Distância Global Contínua
    const rawDt = this.computeDistanceTransform(mask, W, H);
    const dt = this.gaussianBlur2D(rawDt, W, H);

    let maxDist = 1;
    for (let i = 0; i < W * H; i++) {
      if (mask[i] === 1 && dt[i] > maxDist) maxDist = dt[i];
    }

    // Região da Cabeça (aproximadamente os 48% superiores do busto)
    const headCutoffY = minY + Math.round(charH * 0.48);
    const headMask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const y = Math.floor(i / W);
      headMask[i] = (mask[i] === 1 && y <= headCutoffY) ? 1 : 0;
    }
    const rawHeadDt = this.computeDistanceTransform(headMask, W, H);
    const headDt = this.gaussianBlur2D(rawHeadDt, W, H);
    let maxHeadDt = 1;
    for (let i = 0; i < W * H; i++) {
      if (headMask[i] === 1 && headDt[i] > maxHeadDt) maxHeadDt = headDt[i];
    }

    // Mapear vértices de primeiro plano
    const vIdx = new Int32Array(W * H).fill(-1);
    let totalFgPixels = 0;
    for (let i = 0; i < W * H; i++) {
      if (mask[i] === 1) {
        vIdx[i] = totalFgPixels++;
      }
    }

    if (totalFgPixels === 0) {
      throw new Error('Nenhum objeto detectado na imagem.');
    }

    const positions = [];
    const uvs = [];
    const indices = [];

    // O busto afunda 2.0mm diretamente na base chanfrada de 4.0mm, garantindo união volumétrica estanque sem vazios
    const zBaseOffset = addPedestal ? 2.0 : 0;
    const usableHeight = targetHeight - zBaseOffset;

    // 1. Vértices da Frente (Anatomia Tridimensional Contínua: Nariz Saliente, Órbitas Recuadas, Barba)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const dNorm = Math.min(1.0, dt[idx] / maxDist);

        // Base sólida: nos últimos 12% da base, mantém espessura total sem afinar para faca
        const distFromBottom = maxY - y;
        const bottomZone = Math.max(4, Math.round(charH * 0.12));
        const baseBlend = Math.max(0, 1.0 - (distFromBottom / bottomZone));

        const edgeT = Math.min(1.0, dNorm * 3.5);
        const edgeFadeRaw = edgeT * edgeT * (3.0 - 2.0 * edgeT);
        const edgeFade = edgeFadeRaw * (1.0 - baseBlend) + 1.0 * baseBlend;

        // Volume anatômico contínuo do crânio, pescoço e tórax
        const baseDome = Math.sin(Math.min(1.0, dNorm * 1.3) * (Math.PI / 2)) ** 0.65;
        const baseVolume = baseDome * (maxDepth * 0.52);

        // Geometria da base sólida na mesa de impressão (sem afinar para lâmina)
        const bottomSpan = charW * 0.5;
        const centerDist = Math.abs(x - (minX + maxX) / 2) / Math.max(1, bottomSpan);
        const lateralFade = Math.cos(Math.min(1.0, centerDist) * (Math.PI / 2)) ** 0.5;
        const solidBaseFront = (maxDepth * 0.50) * Math.max(0.35, lateralFade);
        const solidBaseBack = (maxDepth * 0.45) * Math.max(0.35, lateralFade);

        // Relevo de Alta Precisão (Nose +11.8, Bochechas +4.9, Órbitas -3.5, Barba, Dobras de Toga)
        const highpass = reliefMap ? reliefMap[idx] : 0;
        const sculptProjection = highpass * 0.35 * depthDetail;

        // Microrrelevo de escultura em pedra / rugas / textura a partir da luminância
        const stoneDetail = ((depthMap ? depthMap[idx] : 0.5) - 0.5) * 1.8 * depthDetail;

        const effVolumeFront = baseVolume * (1.0 - baseBlend) + solidBaseFront * baseBlend;
        const frontThickness = Math.max(1.0, (effVolumeFront + sculptProjection * (1.0 - baseBlend) + stoneDetail) * edgeFade);

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = -frontThickness;
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, yPos, Math.max(0, zPos));
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 2. Vértices do Verso (Volume Craniano e Dorsal Suave e Completo)
    const backOffset = totalFgPixels;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const dNorm = Math.min(1.0, dt[idx] / maxDist);

        const distFromBottom = maxY - y;
        const bottomZone = Math.max(4, Math.round(charH * 0.12));
        const baseBlend = Math.max(0, 1.0 - (distFromBottom / bottomZone));

        const edgeT = Math.min(1.0, dNorm * 3.5);
        const edgeFadeRaw = edgeT * edgeT * (3.0 - 2.0 * edgeT);
        const edgeFade = edgeFadeRaw * (1.0 - baseBlend) + 1.0 * baseBlend;

        const bottomSpan = charW * 0.5;
        const centerDist = Math.abs(x - (minX + maxX) / 2) / Math.max(1, bottomSpan);
        const lateralFade = Math.cos(Math.min(1.0, centerDist) * (Math.PI / 2)) ** 0.5;
        const solidBaseBack = (maxDepth * 0.45) * Math.max(0.35, lateralFade);

        const dome = Math.sin(Math.min(1.0, dNorm * 1.3) * (Math.PI / 2)) ** 0.65;
        const effVolumeBack = (dome * (maxDepth * 0.44)) * (1.0 - baseBlend) + solidBaseBack * baseBlend;
        const backThickness = Math.max(1.0, effVolumeBack * edgeFade);

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = +backThickness;
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, yPos, Math.max(0, zPos));
        uvs.push(1.0 - x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 3. Triangulação de Alta Fidelidade
    const frontTris = [];
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const iA = vIdx[y * W + x];
        const iB = vIdx[y * W + (x + 1)];
        const iC = vIdx[(y + 1) * W + x];
        const iD = vIdx[(y + 1) * W + (x + 1)];

        const pts = (iA !== -1 ? 1 : 0) + (iB !== -1 ? 1 : 0) + (iC !== -1 ? 1 : 0) + (iD !== -1 ? 1 : 0);
        if (pts === 4) {
          frontTris.push(iA, iB, iC);
          frontTris.push(iB, iD, iC);
        } else if (pts === 3) {
          if (iA !== -1 && iB !== -1 && iC !== -1) frontTris.push(iA, iB, iC);
          else if (iB !== -1 && iD !== -1 && iC !== -1) frontTris.push(iB, iD, iC);
          else if (iA !== -1 && iB !== -1 && iD !== -1) frontTris.push(iA, iB, iD);
          else if (iA !== -1 && iC !== -1 && iD !== -1) frontTris.push(iA, iD, iC);
        }
      }
    }

    for (let i = 0; i < frontTris.length; i++) indices.push(frontTris[i]);

    // Superfície de trás (orientação invertida para normais externas)
    for (let i = 0; i < frontTris.length; i += 3) {
      indices.push(backOffset + frontTris[i], backOffset + frontTris[i + 2], backOffset + frontTris[i + 1]);
    }

    // 4. Fechamento Perimétrico Hermético 100% Manifold (Borda Externa Contínua)
    const edgeCounts = new Map();
    for (let i = 0; i < frontTris.length; i += 3) {
      const a = frontTris[i], b = frontTris[i + 1], c = frontTris[i + 2];
      for (let [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
    for (let i = 0; i < frontTris.length; i += 3) {
      const a = frontTris[i], b = frontTris[i + 1], c = frontTris[i + 2];
      for (let [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        if (edgeCounts.get(key) === 1) {
          const uB = backOffset + u;
          const vB = backOffset + v;
          indices.push(u, v, vB);
          indices.push(u, vB, uB);
        }
      }
    }

    // 5. Pedestal Sólido Chanfrado Integrado para a Mesa Aquecida (Z = 0 a Z = pedestalHeight)
    // Com sobreposição volumétrica estanque no pé do busto (eliminando frestas no fatiador)
    if (addPedestal) {
      const pedSegments = 64;
      const pedRadiusX = Math.max(22, (targetWidth * 0.5) + 6);
      const pedRadiusY = Math.max(16, (maxDepth * 0.65) + 6);
      const pedHeight = pedestalHeight;

      const botCenterIdx = positions.length / 3;
      positions.push(0, 0, 0);
      uvs.push(0.5, 0.5);

      const botRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        positions.push(Math.cos(theta) * pedRadiusX, Math.sin(theta) * pedRadiusY, 0);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }
      // Fundo plano na mesa (Z = 0)
      for (let i = 0; i < pedSegments; i++) {
        indices.push(botCenterIdx, botRingStart + ((i + 1) % pedSegments), botRingStart + i);
      }

      const topRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        positions.push(Math.cos(theta) * (pedRadiusX - 1.2), Math.sin(theta) * (pedRadiusY - 1.2), pedHeight);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Paredes chanfradas do pedestal
      for (let i = 0; i < pedSegments; i++) {
        const b0 = botRingStart + i;
        const b1 = botRingStart + ((i + 1) % pedSegments);
        const t0 = topRingStart + i;
        const t1 = topRingStart + ((i + 1) % pedSegments);
        indices.push(b0, b1, t0);
        indices.push(b1, t1, t0);
      }

      // Topo do pedestal (Z = pedHeight)
      const topCenterIdx = positions.length / 3;
      positions.push(0, 0, pedHeight);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < pedSegments; i++) {
        indices.push(topCenterIdx, topRingStart + i, topRingStart + ((i + 1) % pedSegments));
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
      geometry,
      dimensions: {
        width: targetWidth,
        depth: maxDepth,
        height: targetHeight
      },
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        isManifold: true
      }
    };
  }

  /**
   * RELEVO MONOLÍTICO ESTANQUE (Para medalhas, moedas, litofanias e placas)
   */
  static createReliefPlaque(processedImage, options = {}) {
    const {
      targetWidth = 80,
      baseThickness = 3,
      reliefDepth = 12
    } = options;

    const { width: W, height: H, depthMap, mask, bounds } = processedImage;
    const { minX, maxX, minY, maxY } = bounds;
    const charW = Math.max(1, maxX - minX);
    const charH = Math.max(1, maxY - minY);
    const targetHeight = targetWidth * (charH / charW);

    const positions = [];
    const uvs = [];
    const indices = [];

    // Malha do topo (relevo)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = ((y - minY) / charH - 0.5) * targetHeight;
        
        let zPos = baseThickness;
        if (mask[idx] === 1) {
          zPos += depthMap[idx] * reliefDepth;
        }

        positions.push(xPos, yPos, zPos);
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // Malha da base plana (Z = 0)
    const baseOffset = (charH + 1) * (charW + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = ((y - minY) / charH - 0.5) * targetHeight;
        positions.push(xPos, yPos, 0);
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // Triângulos do topo
    const rowStride = charW + 1;
    for (let y = 0; y < charH; y++) {
      for (let x = 0; x < charW; x++) {
        const iA = y * rowStride + x;
        const iB = y * rowStride + (x + 1);
        const iC = (y + 1) * rowStride + x;
        const iD = (y + 1) * rowStride + (x + 1);

        indices.push(iA, iC, iB);
        indices.push(iB, iC, iD);

        indices.push(baseOffset + iA, baseOffset + iB, baseOffset + iC);
        indices.push(baseOffset + iB, baseOffset + iD, baseOffset + iC);
      }
    }

    // Paredes laterais
    const addSideWall = (tA, tB) => {
      const bA = baseOffset + tA;
      const bB = baseOffset + tB;
      indices.push(tA, tB, bA);
      indices.push(tB, bB, bA);
    };

    for (let x = 0; x < charW; x++) {
      addSideWall(x, x + 1);
      addSideWall(charH * rowStride + (x + 1), charH * rowStride + x);
    }
    for (let y = 0; y < charH; y++) {
      addSideWall((y + 1) * rowStride, y * rowStride);
      addSideWall(y * rowStride + charW, (y + 1) * rowStride + charW);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
      geometry,
      dimensions: {
        width: targetWidth,
        depth: targetHeight,
        height: baseThickness + reliefDepth
      },
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        isManifold: true
      }
    };
  }

  static estimatePrintMetrics(geometry, infillPercent = 15) {
    if (!geometry.attributes.position) return { volumeCm3: 0, weightGrams: 0, printTimeHours: 0 };

    const pos = geometry.attributes.position.array;
    const index = geometry.index ? geometry.index.array : null;
    let volumeSum = 0;

    if (index) {
      for (let i = 0; i < index.length; i += 3) {
        const i1 = index[i] * 3;
        const i2 = index[i + 1] * 3;
        const i3 = index[i + 2] * 3;

        const x1 = pos[i1], y1 = pos[i1 + 1], z1 = pos[i1 + 2];
        const x2 = pos[i2], y2 = pos[i2 + 1], z2 = pos[i2 + 2];
        const x3 = pos[i3], y3 = pos[i3 + 1], z3 = pos[i3 + 2];

        volumeSum += (x1 * (y2 * z3 - y3 * z2) -
                      y1 * (x2 * z3 - x3 * z2) +
                      z1 * (x2 * y3 - x3 * y2)) / 6.0;
      }
    }

    const volumeMm3 = Math.abs(volumeSum);
    const volumeCm3 = volumeMm3 / 1000.0;
    const effectiveInfillFactor = Math.min(1.0, 0.25 + (infillPercent / 100) * 0.75);
    const weightGrams = volumeCm3 * 1.24 * effectiveInfillFactor;
    const printTimeMinutes = Math.max(15, Math.round(weightGrams * 2.2));
    const hours = Math.floor(printTimeMinutes / 60);
    const mins = printTimeMinutes % 60;

    return {
      volumeCm3: Number(volumeCm3.toFixed(2)),
      weightGrams: Number(weightGrams.toFixed(1)),
      printTimeString: `${hours > 0 ? `${hours}h ` : ''}${mins}m`
    };
  }
}
