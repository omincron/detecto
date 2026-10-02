from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend import config
from backend.routes import detect, history
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
app.include_router(history.router)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Keep the error contract (ARCHITECTURE.md §3.3): 400 with a displayable string
    # detail, instead of FastAPI's default 422 with a list of error objects.
    messages = []
    for err in exc.errors():
        field = ".".join(str(part) for part in err["loc"] if part not in ("query", "body"))
        messages.append(f"{field}: {err['msg']}")
    return JSONResponse(status_code=400, content={"detail": "; ".join(messages)})


@app.get("/health")
def health_check():
    return {"status": "ok"}
