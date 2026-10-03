# Detecto — From Demo to Production

Detecto is built as a local, single-user demo: one laptop, one SQLite file, no login.
This document lists what would have to change before it could monitor real spaces
(entrances, classrooms, warehouses), why each change matters, and where it would go in
the current code. Items are grouped by priority.

- **Must have before go-live:** security and data handling. Without these the system
  shouldn't be exposed to a network.
- **Needed at scale:** performance and operations, once there's more than one camera
  or user.
- **Quality over time:** the model and the evaluation.

---

## 1. Must have before go-live

### 1.1 Authentication
**Today:** every endpoint is open. Anyone who can reach the API can upload images,
read the history, or call `DELETE /reset` and wipe it.

**Next step:**
- Put the API behind an identity provider (OIDC: Azure AD, Google Workspace, Keycloak)
  and validate a JWT on every request with a FastAPI dependency, next to `get_storage`
  and `get_detector`.
- Cameras and other machine clients get their own credentials (API keys or client
  certificates), separate from human users, so a camera can be revoked on its own.
- The frontend logs in through the same provider and sends the token from
  `api/client.js`, the only module that talks to the backend.

### 1.2 Roles and permissions
Different people need different powers. A starting set:

| Role | Can |
|---|---|
| **Viewer** (analyst) | Read history, view stats, export |
| **Operator** | Viewer, plus run detections and acknowledge alerts |
| **Admin** | Operator, plus clear history, change thresholds and alert rules, manage users |
| **Device** (camera) | Only `POST /detect` for its own camera ID |

- `DELETE /reset` becomes **admin-only**. Every call is written to an **audit log**:
  who, when, how many records, and from which IP.
- Scope roles to sites if needed (an operator at site A can't see site B's data).

### 1.3 History retention and archiving
**Today:** `/reset` is a hard delete (`DELETE FROM detections`). That matches the brief,
but in a safety context the history is evidence and shouldn't depend on one click.

**Next step:**
- A **retention policy** set by the organisation, e.g. keep 90 days, then archive or
  delete automatically with a scheduled job. Keeping data forever is not the safe
  default either: retention should be as short as the purpose allows.
- **Archive instead of delete:** `/reset` moves rows to cold storage (an archive table,
  or Parquet/CSV files in object storage) or marks them `deleted_at`, and the History
  view hides them. An actual purge stays a separate, admin-only, audited action.
- **Backups** of the database, with a tested restore.
- The CSV export (bonus milestone 6) is the lightweight version: users can download a
  copy before clearing.

### 1.4 Privacy and compliance
People are being observed, so data-protection law applies (e.g. GDPR in the EU).
- **Data minimisation is already in the design:** no images or bounding boxes are
  stored, only counts, confidences, timings and timestamps (ARCHITECTURE.md §3.4).
  Keep it that way unless a feature really needs more.
- If images ever are stored (e.g. snapshots for alerts): encrypt them at rest, keep
  them for a short time, restrict access to them, and consider blurring faces.
- A data-protection impact assessment, signs at monitored entrances, and a documented
  lawful basis are organisational steps, but the system should support them (retention
  settings, export and delete on request, audit trail).

### 1.5 Transport and API hardening
- **HTTPS everywhere**, terminated at a reverse proxy (nginx, Traefik) or the cloud
  load balancer.
- **CORS:** `main.py` allows credentials with all methods and headers for the
  configured origins. In production, list the exact origins, methods and headers.
- **Rate limiting** per user and per device (at the proxy or with a middleware), so
  one client can't saturate inference.
- **Error messages:** the 500 responses currently include the exception text
  (`Inference failed: …`). Return a generic message with a request ID instead, and
  keep the details in the server logs.
- Upload validation (size limit, magic bytes, decode check) is already in place and
  tested. Keep the size limit at the proxy as well.

---

## 2. Needed at scale

### 2.1 Don't block the server during inference
**Today:** `POST /detect` is an `async` route that calls the model synchronously, so
while one image is being processed (~150 ms) the event loop can't serve anything
else, including `/health`.

**Next step:** run inference in a worker thread (`run_in_threadpool`, or make the route
a plain `def`), or move it to a separate inference service (a queue such as Redis or
RabbitMQ, or a model server such as NVIDIA Triton) so the API stays responsive. This
matters as soon as a live camera sends several frames per second.

### 2.2 Faster inference
- **GPU** (CUDA): inference is CPU-only today. A GPU makes it several times faster.
- **Export the model** to ONNX Runtime or TensorRT, and consider FP16/INT8 precision.
- **Batch frames** from several cameras into one model call.
- **Tune per stream:** skip frames (e.g. detect 2–5 times per second rather than on
  every frame) and lower the input resolution for wide shots.

### 2.3 Multiple cameras and sites
**Today:** a record has no idea where it came from.
- Add `camera_id` (and `site_id`) to every record, the `/history` filters and the
  dashboard.
- Store the **model version and threshold** with each record, so the numbers stay
  explainable after a model upgrade (a jump in counts might be the new model, not more
  people).

### 2.4 Database
- **PostgreSQL** instead of SQLite once there are several writers or several API
  instances. The storage layer is already behind a small interface
  (`save`, `list`, `clear` in `services/storage.py`), so this is a contained swap.
- **Schema migrations** with Alembic, instead of `CREATE TABLE IF NOT EXISTS`.
- **Server-side pagination and aggregation** for `/history`: today it returns every
  matching row, and the browser does the paging. With months of data from many
  cameras, the server should page, and charts should use pre-aggregated values
  (per minute or per hour), e.g. with TimescaleDB.

### 2.5 Deployment and operations
- **Containers:** a Dockerfile for the backend (with the model weights baked in and
  checksum-verified, not downloaded at first start) and for the frontend (a static
  build served by nginx or a CDN). Docker Compose or Kubernetes to run them.
- **CI/CD:** run the backend and frontend test suites, a linter and a dependency
  vulnerability scan on every push; deploy only from green builds.
- **Configuration and secrets:** keep using environment variables, but get secrets
  (DB passwords, API keys) from a secrets manager, never from a committed `.env`.
- **Health checks:** split `/health` into *liveness* (the process is up) and
  *readiness* (the model is loaded and the database is reachable), so the orchestrator
  doesn't send traffic too early.

### 2.6 Monitoring and alerting
- **Structured logs** (JSON) with a request ID, user and camera, shipped to a central
  log store.
- **Metrics** (Prometheus/Grafana): request rate, error rate, inference latency (p50,
  p95), queue length, frames per camera.
- **Alerts for the system itself:** a camera that stops sending frames, latency over
  budget, error spikes. For a safety system, "the system is silently down" is the worst
  failure.
- **Frontend error tracking** (e.g. Sentry).

---

## 3. Quality over time

### 3.1 Model and evaluation
- **A bigger, representative test set:** the README's evaluation uses 16 COCO images.
  A real deployment needs hundreds of frames from the actual cameras (their angles,
  lighting and crowd density), labelled once, with the threshold chosen on a separate
  validation split.
- **Fine-tune** on that footage, or on a crowd dataset such as CrowdHuman, to fix the
  weaknesses found (dense crowds, occlusion, low light, statues and dolls).
- **Per-camera thresholds and regions of interest**, configurable by an admin.
- **Monitor drift:** watch the confidence distribution and count patterns per camera.
  A sudden change usually means a moved camera, a dirty lens or new lighting, not new
  behaviour.
- **Version models** and roll them out gradually (shadow mode, then one camera, then
  all), comparing their outputs before switching.

### 3.2 Frontend
- Lazy-load the History page to cut the bundle size (it's over 500 kB today).
- Add an ESLint config and a `lint` step in CI.
- Accessibility and browser checks across Chrome, Firefox and Safari as part of the
  release.
