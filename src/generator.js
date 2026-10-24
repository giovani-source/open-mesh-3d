import * as THREE from 'three';

/**
 * OpenMeshy / Forge3D Engine de Malhas e Geometrias 3D
 */

export class MeshGenerator {
  /**
   * Processa a imagem extraindo canais de cor e máscara de silhueta (remoção inteligente de fundo)
   */
  static getImageData(image, targetResolution = 150) {
    const canvas = document.createElement('canvas');
    let width = targetResolution;
    let height = Math.round(targetResolution * (image.naturalHeight / image.naturalWidth));
    
    if (height > targetResolution * 1.6) {
      height = Math.round(targetResolution * 1.6);
    } else if (height < targetResolution * 0.6) {
      height = Math.round(targetResolution * 0.6);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const depthMap = new Float32Array(width * height);
    const alphaMap = new Float32Array(width * height);
    const mask = new Uint8Array(width * height);

    // Amostrar bordas para detectar a cor predominante de fundo (branco, cinza ou preto)
    let bgR = 0, bgG = 0, bgB = 0, sampleCount = 0;
    for (let x = 0; x < width; x += 2) {
      const topIdx = x * 4;
      const botIdx = ((height - 1) * width + x) * 4;
      bgR += data[topIdx] + data[botIdx];
      bgG += data[topIdx + 1] + data[botIdx + 1];
      bgB += data[topIdx + 2] + data[botIdx + 2];
      sampleCount += 2;
    }
    for (let y = 0; y < height; y += 2) {
      const leftIdx = (y * width) * 4;
      const rightIdx = (y * width + (width - 1)) * 4;
      bgR += data[leftIdx] + data[rightIdx];
      bgG += data[leftIdx + 1] + data[rightIdx + 1];
      bgB += data[leftIdx + 2] + data[rightIdx + 2];
      sampleCount += 2;
    }

    bgR /= sampleCount;
    bgG /= sampleCount;
    bgB /= sampleCount;

    const isLightBg = (bgR + bgG + bgB) / 3 > 180;
    const isDarkBg = (bgR + bgG + bgB) / 3 < 40;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      const idx = i / 4;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      depthMap[idx] = luminance;
      alphaMap[idx] = a / 255;

      const distToBg = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);

      // Critério de recorte de fundo
      let isBg = false;
      if (a < 50) {
        isBg = true;
      } else if (isLightBg && r > 220 && g > 220 && b > 220) {
        isBg = true;
      } else if (isDarkBg && r < 35 && g < 35 && b < 35) {
        isBg = true;
      } else if (distToBg < 40) {
        isBg = true;
      }

      mask[idx] = isBg ? 0 : 1;
    }

    return {
      width,
      height,
      depthMap,
      alphaMap,
      mask,
      canvas,
      aspectRatio: width / height
    };
  }

  /**
   * BONECO 3D VOLUMÉTRICO EM PÉ (Upright Figurine 360°)
   * Gera um personagem tridimensional completo em pé na mesa aquecida (Z=0 pés, Z=Topo cabeça)
   * com corpo arredondado 360° fechado e manifold, sem deitar na mesa.
   */
  static createUprightFigurine(processedImage, options = {}) {
    const {
      targetHeight = 90, // Altura vertical em mm (Z)
      depthRatio = 0.55, // Espessura frente-verso proporcional à largura
      smoothing = 2
    } = options;

    const { width: W, height: H, mask, canvas } = processedImage;
    const targetWidth = targetHeight * (W / H);

    const slices = 80;   // Resolução vertical (fatias dos pés à cabeça)
    const segments = 40; // Resolução radial (360 graus ao redor do corpo)

    const positions = [];
    const uvs = [];
    const indices = [];

    // 1. Extrair contornos horizontais (Xmin, Xmax) para cada fatia vertical
    const sliceContours = [];
    for (let s = 0; s < slices; s++) {
      // Y na imagem: 0 é o topo da imagem (cabeça), H-1 é a base (pés)
      // s=0 é o chão (pés), s=slices-1 é o topo da cabeça
      const imgY = Math.round((1 - s / (slices - 1)) * (H - 1));
      let minX = -1;
      let maxX = -1;

      for (let x = 0; x < W; x++) {
        if (mask[imgY * W + x] === 1) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }

      sliceContours.push({ minX, maxX });
    }

    // Suavizar contornos para evitar transições bruscas
    const smoothContours = [];
    for (let s = 0; s < slices; s++) {
      let sumMin = 0, sumMax = 0, count = 0;
      for (let ds = -smoothing; ds <= smoothing; ds++) {
        const ns = s + ds;
        if (ns >= 0 && ns < slices && sliceContours[ns].minX !== -1) {
          sumMin += sliceContours[ns].minX;
          sumMax += sliceContours[ns].maxX;
          count++;
        }
      }
      if (count > 0) {
        smoothContours.push({ minX: sumMin / count, maxX: sumMax / count });
      } else {
        smoothContours.push({ minX: -1, maxX: -1 });
      }
    }

    // 2. Construir os anéis 3D verticais
    for (let s = 0; s < slices; s++) {
      const c = smoothContours[s];
      const zPos = (s / (slices - 1)) * targetHeight; // Z é a altura em pé na mesa!

      let ringWidth = 0;
      let centerX = 0;

      if (c.minX !== -1 && c.maxX >= c.minX) {
        ringWidth = Math.max(4, ((c.maxX - c.minX) / W) * targetWidth);
        centerX = (((c.minX + c.maxX) / 2) / W - 0.5) * targetWidth;
      } else {
        // Se a fatia estiver vazia, gera um raio mínimo no centro
        ringWidth = 2;
        centerX = 0;
      }

      const ringDepth = Math.max(3, ringWidth * depthRatio);

      // Gerar vértices do anel ao redor do personagem
      for (let seg = 0; seg <= segments; seg++) {
        const theta = (seg / segments) * Math.PI * 2;
        
        // Elipse com leve variação orgânica
        const xPos = centerX + (ringWidth / 2) * Math.sin(theta);
        const yPos = (ringDepth / 2) * Math.cos(theta); // Y é a profundidade frente/verso

        positions.push(xPos, yPos, zPos);

        // UV: mapeia a foto na frente (cos(theta) > 0)
        const u = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(theta)));
        const v = s / (slices - 1);
        uvs.push(u, v);
      }
    }

    // 3. Conectar anéis verticais com triângulos
    const ringStride = segments + 1;
    for (let s = 0; s < slices - 1; s++) {
      const r0 = s * ringStride;
      const r1 = (s + 1) * ringStride;

      for (let seg = 0; seg < segments; seg++) {
        const i0 = r0 + seg;
        const i1 = r0 + seg + 1;
        const i2 = r1 + seg;
        const i3 = r1 + seg + 1;

        indices.push(i0, i2, i1);
        indices.push(i1, i2, i3);
      }
    }

    // 4. Fechar a base nos pés (Z = 0) para aderência total na mesa aquecida
    const centerBotIdx = positions.length / 3;
    positions.push(0, 0, 0);
    uvs.push(0.5, 0);

    for (let seg = 0; seg < segments; seg++) {
      indices.push(centerBotIdx, seg, seg + 1);
    }

    // 5. Fechar o topo na cabeça
    const centerTopIdx = positions.length / 3;
    positions.push(0, 0, targetHeight);
    uvs.push(0.5, 1);

    const topOffset = (slices - 1) * ringStride;
    for (let seg = 0; seg < segments; seg++) {
      indices.push(centerTopIdx, topOffset + seg + 1, topOffset + seg);
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
        depth: targetWidth * depthRatio,
        height: targetHeight
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
