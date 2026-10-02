from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import config
from backend.routes import detect
from backend.services.detector import get_detector


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The model still loads lazily via get_detector(); this just triggers it (plus one
    # dummy inference) before the first request, so request timings exclude warm-up.
    # Resolved through dependency_overrides so tests can swap in a fake detector.
    if config.WARMUP_MODEL:
        detector = app.dependency_overrides.get(get_detector, get_detector)()
        detector.detect(np.zeros((640, 640, 3), dtype=np.uint8))
    yield


app = FastAPI(title="Detecto API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(detect.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
