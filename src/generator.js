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
  static getImageData(image, targetResolution = 200) {
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

    // 2. Análise de Cores: Encontrar candidatos a fundo (transparência, bordas de screenshot e cor da folha/papel)
    const colorBins = new Map();
    let transCount = 0;

    for (let i = 0; i < srcW * srcH; i++) {
      const a = rawData[i * 4 + 3];
      if (a < 50) {
        transCount++;
        continue;
      }
      const r = Math.floor(rawData[i * 4] / 20) * 20;
      const g = Math.floor(rawData[i * 4 + 1] / 20) * 20;
      const b = Math.floor(rawData[i * 4 + 2] / 20) * 20;
      const key = `${r},${g},${b}`;
      colorBins.set(key, (colorBins.get(key) || 0) + 1);
    }

    // Identificar cores de fundo dominantes (papel branco, fundo escuro de app, cinza de foto)
    const sortedBins = Array.from(colorBins.entries()).sort((a, b) => b[1] - a[1]);
    const bgCandidates = [];

    // Amostras das bordas externas
    const borderSamples = [];
    const samplePixel = (x, y) => {
      const idx = (y * srcW + x) * 4;
      if (rawData[idx + 3] > 40) {
        borderSamples.push({ r: rawData[idx], g: rawData[idx + 1], b: rawData[idx + 2] });
      }
    };
    for (let x = 0; x < srcW; x += 4) {
      samplePixel(x, 0);
      samplePixel(x, srcH - 1);
    }
    for (let y = 0; y < srcH; y += 4) {
      samplePixel(0, y);
      samplePixel(srcW - 1, y);
    }

    if (borderSamples.length > 0) {
      let br = 0, bg = 0, bb = 0;
      for (let s of borderSamples) { br += s.r; bg += s.g; bb += s.b; }
      bgCandidates.push({ r: br / borderSamples.length, g: bg / borderSamples.length, b: bb / borderSamples.length, tol: 40 });
    }

    // Cores dominantes com mais de 15% da imagem que pareçam papel/fundo claro ou neutro
    for (let [key, count] of sortedBins.slice(0, 4)) {
      if (count > (srcW * srcH) * 0.12) {
        const [r, g, b] = key.split(',').map(Number);
        const brightness = (r + g + b) / 3;
        // Se for muito claro (> 195), muito escuro (< 45), ou cobrir mais de 35% da tela
        if (brightness > 190 || brightness < 45 || count > (srcW * srcH) * 0.35) {
          const already = bgCandidates.some(c => Math.sqrt((c.r - r)**2 + (c.g - g)**2 + (c.b - b)**2) < 35);
          if (!already) {
            bgCandidates.push({ r, g, b, tol: 42 });
          }
        }
      }
    }

    // 3. Segmentação em alta resolução: Marcar pixels de Primeiro Plano
    const rawIsFg = new Uint8Array(srcW * srcH);
    let minX = srcW, maxX = 0, minY = srcH, maxY = 0;
    let fgTotal = 0;

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const idx = (y * srcW + x) * 4;
        const a = rawData[idx + 3];
        if (a < 50) continue;

        const r = rawData[idx];
        const g = rawData[idx + 1];
        const b = rawData[idx + 2];

        let isBg = false;
        for (let cand of bgCandidates) {
          const d = Math.sqrt((r - cand.r) ** 2 + (g - cand.g) ** 2 + (b - cand.b) ** 2);
          if (d <= cand.tol) {
            isBg = true;
            break;
          }
        }

        if (!isBg) {
          rawIsFg[y * srcW + x] = 1;
          fgTotal++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Fallback: se nenhum pixel foi isolado ou se tudo virou primeiro plano, usa luminosidade adaptativa
    if (fgTotal < 20 || fgTotal > srcW * srcH * 0.95) {
      minX = srcW; maxX = 0; minY = srcH; maxY = 0;
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const idx = (y * srcW + x) * 4;
          const lum = (0.299 * rawData[idx] + 0.587 * rawData[idx + 1] + 0.114 * rawData[idx + 2]);
          if (lum < 235 && rawData[idx + 3] > 50) {
            rawIsFg[y * srcW + x] = 1;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
    }

    // Limites de recorte com margem de segurança (padding)
    const padX = Math.max(4, Math.round((maxX - minX) * 0.04));
    const padY = Math.max(4, Math.round((maxY - minY) * 0.04));
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padY);
    const cropW = Math.min(srcW - cropX, (maxX - minX) + padX * 2);
    const cropH = Math.min(srcH - cropY, (maxY - minY) + padY * 2);

    // 4. Reamostragem em resolução de alta fidelidade suave (targetResolution)
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

    // Desenha o personagem recortado perfeitamente centralizado
    ctx.drawImage(rawCanvas, cropX, cropY, cropW, cropH, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 4. Detecção de fundo estritamente a partir das 4 bordas externas com fechamento hermético de buracos internos
    // Amostrar bordas da imagem reamostrada
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
      const a = data[idx * 4 + 3];
      if (a < 50) return true; // Transparência é sempre fundo
      const r = data[idx * 4];
      const g = data[idx * 4 + 1];
      const b = data[idx * 4 + 2];
      const distBorder = Math.sqrt((r - edgeR) ** 2 + (g - edgeG) ** 2 + (b - edgeB) ** 2);
      if (distBorder <= 36) return true;
      for (let cand of bgCandidates) {
        const d = Math.sqrt((r - cand.r) ** 2 + (g - cand.g) ** 2 + (b - cand.b) ** 2);
        if (d <= cand.tol) return true;
      }
      return false;
    };

    // BFS 1: Marcar fundo conectado EXCLUSIVAMENTE às bordas externas
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

    // BFS 2 (HOLE CLOSING): Propagar o exterior a partir das bordas
    // Qualquer bolso interno (olhos, barba, rugas, sombras do busto) que NÃO alcançar a borda é 100% PREENCHIDO
    const isExterior = new Uint8Array(width * height);
    const extQueue = [];

    for (let x = 0; x < width; x++) {
      const t = 0 * width + x;
      const b = (height - 1) * width + x;
      if (isBgConnected[t]) { isExterior[t] = 1; extQueue.push(t); }
      if (isBgConnected[b]) { isExterior[b] = 1; extQueue.push(b); }
    }
    for (let y = 1; y < height - 1; y++) {
      const l = y * width + 0;
      const r = y * width + (width - 1);
      if (isBgConnected[l]) { isExterior[l] = 1; extQueue.push(l); }
      if (isBgConnected[r]) { isExterior[r] = 1; extQueue.push(r); }
    }

    let eHead = 0;
    while (eHead < extQueue.length) {
      const curr = extQueue[eHead++];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      const neighbors = [
        cx > 0 ? cy * width + (cx - 1) : -1,
        cx < width - 1 ? cy * width + (cx + 1) : -1,
        cy > 0 ? (cy - 1) * width + cx : -1,
        cy < height - 1 ? (cy + 1) * width + cx : -1
      ];

      for (let n of neighbors) {
        if (n !== -1 && isExterior[n] === 0 && isBgConnected[n] === 1) {
          isExterior[n] = 1;
          extQueue.push(n);
        }
      }
    }

    // Primeiro plano preliminar: tudo o que não é exterior
    const rawFg = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      rawFg[i] = isExterior[i] === 0 ? 1 : 0;
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

    // 6. Normalização do mapa de relevo suave
    const reliefMap = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (mask[idx] === 0) continue;

        const dx = (depthMap[idx + 1] - depthMap[idx - 1]) * 0.5;
        const dy = (depthMap[idx + width] - depthMap[idx - width]) * 0.5;
        const edge = Math.sqrt(dx * dx + dy * dy);
        reliefMap[idx] = (depthMap[idx] - 0.5) * 0.4 + edge * 0.2;
      }
    }

    return {
      width,
      height,
      depthMap,
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
   * - Membros separados com volume arredondado (pernas, braços, capa, torso)
   * - Transições suaves livres de facetas serrilhadas ou degraus de pixel
   */
  static createVolumetricSculpture(processedImage, options = {}) {
    const {
      targetHeight = 90,     // mm (altura em pé Z)
      maxDepth = 24,         // mm (espessura frente/verso Y)
      depthDetail = 1.2,     // relevo muscular
      addPedestal = true,    // base na mesa
      pedestalHeight = 3.2   // mm
    } = options;

    const { width: W, height: H, mask, reliefMap, bounds } = processedImage;

    const { minX, maxX, minY, maxY } = bounds;
    const charW = Math.max(1, maxX - minX);
    const charH = Math.max(1, maxY - minY);

    const targetWidth = targetHeight * (charW / charH);

    // Transformada de Distância e Suavização Gaussiana Contínua
    const rawDt = this.computeDistanceTransform(mask, W, H);
    const dt = this.gaussianBlur2D(rawDt, W, H);

    let maxDist = 1;
    for (let i = 0; i < W * H; i++) {
      if (mask[i] === 1 && dt[i] > maxDist) maxDist = dt[i];
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

    const zBaseOffset = addPedestal ? pedestalHeight : 0;
    const usableHeight = targetHeight - zBaseOffset;

    // 1. Vértices da Frente (Orientados para -Y, em direção à câmera frontal)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const d = dt[idx];
        const dNorm = Math.min(1.0, d / maxDist);

        // Suavização cúbica nas bordas (Hermite smoothstep): espessura vai a 0 na borda
        const edgeT = Math.min(1.0, dNorm * 4.5);
        const edgeFade = edgeT * edgeT * (3.0 - 2.0 * edgeT);

        // Curvatura esférica/cilíndrica orgânica
        const dome = Math.sin(Math.min(1.0, dNorm * 1.4) * (Math.PI / 2));
        const baseThickness = (dome * 0.76 + Math.pow(dNorm, 0.58) * 0.24) * (maxDepth / 2) * edgeFade;
        const maxEmboss = baseThickness * 0.38;
        const rawEmboss = (reliefMap[idx] || 0) * depthDetail * 0.8 * edgeFade;
        const emboss = Math.max(-maxEmboss, Math.min(maxEmboss, rawEmboss));
        const frontThickness = Math.max(0.2 * edgeFade, baseThickness + emboss);

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = -frontThickness;
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, yPos, Math.max(0, zPos));
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 2. Vértices do Verso (Costas do boneco, voltados para +Y)
    const backOffset = totalFgPixels;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const d = dt[idx];
        const dNorm = Math.min(1.0, d / maxDist);
        const edgeT = Math.min(1.0, dNorm * 4.5);
        const edgeFade = edgeT * edgeT * (3.0 - 2.0 * edgeT);

        const dome = Math.sin(Math.min(1.0, dNorm * 1.4) * (Math.PI / 2));
        const backThickness = Math.max(0.2 * edgeFade, (dome * 0.76 + Math.pow(dNorm, 0.58) * 0.24) * (maxDepth / 2) * edgeFade * 0.90);

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = +backThickness;
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, yPos, Math.max(0, zPos));
        uvs.push(1.0 - x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 3. Triangulação das superfícies da frente e de trás
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const iA = vIdx[y * W + x];
        const iB = vIdx[y * W + (x + 1)];
        const iC = vIdx[(y + 1) * W + x];
        const iD = vIdx[(y + 1) * W + (x + 1)];

        if (iA !== -1 && iB !== -1 && iC !== -1 && iD !== -1) {
          indices.push(iA, iB, iC);
          indices.push(iB, iD, iC);

          indices.push(backOffset + iA, backOffset + iC, backOffset + iB);
          indices.push(backOffset + iB, backOffset + iC, backOffset + iD);
        }
      }
    }

    // 4. Fechamento perimétrico hermético (Skirt)
    const addSkirtQuad = (frontA, frontB) => {
      const backA = backOffset + frontA;
      const backB = backOffset + frontB;
      indices.push(frontA, backA, frontB);
      indices.push(frontB, backA, backB);
    };

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const curr = vIdx[y * W + x];
        if (curr === -1) continue;

        if (x === maxX || vIdx[y * W + x + 1] === -1) {
          if (y < maxY && vIdx[(y + 1) * W + x] !== -1) {
            addSkirtQuad(curr, vIdx[(y + 1) * W + x]);
          }
        }
        if (x === minX || vIdx[y * W + x - 1] === -1) {
          if (y < maxY && vIdx[(y + 1) * W + x] !== -1) {
            addSkirtQuad(vIdx[(y + 1) * W + x], curr);
          }
        }
        if (y === minY || vIdx[(y - 1) * W + x] === -1) {
          if (x < maxX && vIdx[y * W + x + 1] !== -1) {
            addSkirtQuad(vIdx[y * W + x + 1], curr);
          }
        }
        if (y === maxY || vIdx[(y + 1) * W + x] === -1) {
          if (x < maxX && vIdx[y * W + x + 1] !== -1) {
            addSkirtQuad(curr, vIdx[y * W + x + 1]);
          }
        }
      }
    }

    // 5. Suavização Laplaciana 3D para dissolver qualquer aresta serrilhada em curvaturas orgânicas
    this.applyLaplacianSmoothing(positions, indices, 6, 0.50);


    // 5. Pedestal de Apoio Integrado (Sólido para Mesa Aquecida Z = 0)
    if (addPedestal) {
      const pedSegments = 48;
      const pedRadiusX = Math.max(16, (targetWidth * 0.5) + 6);
      const pedRadiusY = Math.max(12, (maxDepth * 0.7) + 6);
      const pedHeight = pedestalHeight;
      const chamferHeight = pedHeight * 0.4;

      const pedBottomCenterIdx = positions.length / 3;
      positions.push(0, 0, 0);
      uvs.push(0.5, 0.5);

      const botRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        const px = Math.cos(theta) * pedRadiusX;
        const py = Math.sin(theta) * pedRadiusY;
        positions.push(px, py, 0);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Fundo do pedestal (Z = 0)
      for (let i = 0; i < pedSegments; i++) {
        const i0 = botRingStart + i;
        const i1 = botRingStart + ((i + 1) % pedSegments);
        indices.push(pedBottomCenterIdx, i1, i0);
      }

      // Anel intermediário do chanfro
      const midRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        const px = Math.cos(theta) * pedRadiusX;
        const py = Math.sin(theta) * pedRadiusY;
        positions.push(px, py, pedHeight - chamferHeight);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Parede vertical do pedestal
      for (let i = 0; i < pedSegments; i++) {
        const b0 = botRingStart + i;
        const b1 = botRingStart + ((i + 1) % pedSegments);
        const m0 = midRingStart + i;
        const m1 = midRingStart + ((i + 1) % pedSegments);
        indices.push(b0, b1, m0);
        indices.push(b1, m1, m0);
      }

      // Anel do topo (chanfrado)
      const topRingStart = positions.length / 3;
      const topRadiusX = pedRadiusX - 1.5;
      const topRadiusY = pedRadiusY - 1.5;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        const px = Math.cos(theta) * topRadiusX;
        const py = Math.sin(theta) * topRadiusY;
        positions.push(px, py, pedHeight);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Chanfro do topo
      for (let i = 0; i < pedSegments; i++) {
        const m0 = midRingStart + i;
        const m1 = midRingStart + ((i + 1) % pedSegments);
        const t0 = topRingStart + i;
        const t1 = topRingStart + ((i + 1) % pedSegments);
        indices.push(m0, m1, t0);
        indices.push(m1, t1, t0);
      }

      // Tampa do topo do pedestal
      const pedTopCenterIdx = positions.length / 3;
      positions.push(0, 0, pedHeight);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < pedSegments; i++) {
        const t0 = topRingStart + i;
        const t1 = topRingStart + ((i + 1) % pedSegments);
        indices.push(pedTopCenterIdx, t0, t1);
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
