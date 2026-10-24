# Forge3D AI - Estúdio Aberto Imagem ➔ 3D & STL (100% Gratuito)

Uma plataforma completa e aberta para transformar qualquer imagem 2D (fotos, logos, desenhos, esculturas, ilustrações) em **modelos 3D fechados (Manifold)** prontos para impressão 3D em **STL**, **OBJ** e **GLB**, sem limites de créditos ou custos recorrentes.

---

## 🚀 Como Executar o Estúdio Web

1. Abra o terminal na pasta do projeto:
   ```bash
   cd /Users/giovanibassodasilva/.gemini/antigravity-ide/scratch/open-mesh-3d
   ```

2. Inicie o servidor local:
   ```bash
   npm run dev
   ```

3. Abra no navegador:
   ```
   http://127.0.0.1:5173
   ```

---

## ✨ Recursos Principais

### 1. Motores de Geração 3D
- **Relevo Estanque (Manifold STL)**: Algoritmo que projeta o relevo da imagem sobre uma malha sólida com paredes laterais e placa de fundo hermeticamente fechada a `Z = 0`. Slicers como **Bambu Studio, Cura, PrusaSlicer e OrcaSlicer** reconhecem o modelo imediatamente sem nenhum erro de fatiamento.
- **Escultura 360° Volumétrica**: Infla os dois lados da silhueta da imagem gerando um modelo tridimensional arredondado frente e verso.

### 2. Viewport 3D Interativo (Three.js)
- **Mesa de Impressão Aquecida 220x220mm**: Visualização em escala real com eixos X, Y e Z.
- **Materiais e Shaders de Filamento**:
  - Textura original da imagem
  - Filamento PLA Ouro Seda
  - Filamento PLA Prata Metálico
  - Filamento PLA Preto Fosco (Stealth)
  - Cerâmica / Argila de Escultor
  - Mapa de Normais (para inspeção de ângulos e overhangs)
  - Malha de Triângulos (Wireframe)
- **Controles de Câmera**: Vistas Isométrica, Topo, Frente e Lado, além de rotação e zoom livres.

### 3. Ficha Técnica do Fatiador (Slicer-Ready)
- Dimensões reais da peça em milímetros (X, Y, Z configuráveis de 30mm a 200mm).
- Contagem precisa de triângulos e vértices.
- Cálculo de volume real ($cm^3$).
- Estimativa de peso de filamento PLA (em gramas, considerando infill a 15%).
- Estimativa do tempo de impressão 3D (a 60mm/s).

### 4. Exportação Sem Custos
- **Baixar .STL (Binário)**: O formato universal para impressão 3D FDM e Resina (Cura, Bambu, Prusa).
- **Baixar .STL (ASCII)**: Formato de texto para inspeção e ferramentas CAD.
- **Baixar .OBJ**: Compatível com Blender, ZBrush e Maya.
- **Baixar .GLB**: Formato binário compacto com textura para Web, Three.js, Unity e Unreal Engine.

---

## 🧠 Servidor de IA Neural Local (Opcional - TripoSR / Trellis)

Para quem deseja rodar modelos neurais profundos (como o Meshy.ai roda em seus servidores pagos) localmente no computador:

1. Acesse a pasta do backend:
   ```bash
   cd backend
   ```

2. Crie um ambiente virtual e instale as dependências:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Execute o servidor:
   ```bash
   python server.py
   ```
   O servidor iniciará em `http://localhost:8000` com suporte automático a aceleração de hardware (Apple Silicon MPS ou GPU Nvidia CUDA).
