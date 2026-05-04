# Cansat Telemetry App

Project structure:

- `backend/` Flask API and radio telemetry reader
- `frontend/` React + TypeScript + Blueprint.js dashboard
- `issues/` local task tracking

Default local ports:

- backend: `5001`
- frontend: `3000`

Run backend:

```bash
source /Users/dan/Documents/Cansat/.venv/bin/activate
pip install -r /Users/dan/Documents/Cansat/backend/requirements.txt
python /Users/dan/Documents/Cansat/backend/app.py