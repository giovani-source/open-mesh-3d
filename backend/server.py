"""
OpenMeshy / Forge3D - Servidor Local de Inteligência Artificial para Geração 3D (TripoSR / Trellis)
Permite gerar modelos 3D completos em GLB/STL a partir de imagens gratuitamente na sua máquina.
"""

import io
import os
import time
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from PIL import Image

app = FastAPI(title="Forge3D Local AI Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model cache
MODEL = None
DEVICE = "mps" if os.uname().sysname == "Darwin" else "cuda" # MPS para Mac Apple Silicon!

@app.on_event("startup")
def startup_event():
    print(f"🚀 Iniciando Forge3D AI Server no dispositivo: {DEVICE}")
    print("Para suporte a TripoSR completo, certifique-se de ter instalado: pip install -r requirements.txt")

@app.get("/health")
def health():
    return {"status": "online", "device": DEVICE, "engine": "TripoSR / Trellis Open Source"}

@app.post("/api/generate-3d")
async def generate_3d(
    image: UploadFile = File(...),
    format: str = Form("stl"), # "stl", "glb", or "obj"
    resolution: int = Form(256),
    remove_bg: bool = Form(True)
):
    """
    Recebe uma imagem 2D, executa a inferência de IA e retorna o modelo 3D em STL ou GLB.
    """
    try:
        contents = await image.read()
        pil_img = Image.open(io.BytesIO(contents)).convert("RGBA")
        
        print(f"📥 Imagem recebida: {pil_img.size}, formato solicitado: {format}")

        # Se TripoSR estiver instalado, executa a inferência do modelo neural
        try:
            from tsr.system import TSR
            from tsr.utils import remove_background, resize_foreground
            import trimesh
            import torch

            global MODEL
            if MODEL is None:
                print("⏳ Carregando pesos do modelo TripoSR (Stability AI)...")
                MODEL = TSR.from_pretrained(
                    "stabilityai/TripoSR",
                    config_name="config.yaml",
                    weight_name="model.ckpt"
                )
                MODEL.to(DEVICE)

            # Pré-processamento
            if remove_bg:
                pil_img = remove_background(pil_img, rembg_session=None)
                pil_img = resize_foreground(pil_img, 0.85)

            # Geração da cena NeRF/TripoSR
            with torch.no_grad():
                scene_codes = MODEL(pil_img, device=DEVICE)
                meshes = MODEL.extract_mesh(scene_codes, resolution=resolution)
                mesh = meshes[0]

            # Exportação
            output_buffer = io.BytesIO()
            if format.lower() == "stl":
                mesh.export(output_buffer, file_type="stl")
                media_type = "application/sla"
                ext = "stl"
            elif format.lower() == "glb":
                mesh.export(output_buffer, file_type="glb")
                media_type = "model/gltf-binary"
                ext = "glb"
            else:
                mesh.export(output_buffer, file_type="obj")
                media_type = "text/plain"
                ext = "obj"

            output_buffer.seek(0)
            return Response(
                content=output_buffer.getvalue(),
                media_type=media_type,
                headers={"Content-Disposition": f"attachment; filename=modelo_gerado_ia.{ext}"}
            )

        except ImportError as e:
            # Fallback informativo com instrução de instalação
            return JSONResponse(
                status_code=200,
                content={
                    "status": "simulation_ready",
                    "message": "Servidor rodando! Para ativar a inferência neural profunda do TripoSR/Trellis, instale os pacotes: pip install -r requirements.txt",
                    "details": str(e)
                }
            )

    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
