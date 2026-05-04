# Cansat Telemetry App

Real-time FPV telemetry dashboard with a Flask backend, React + TypeScript frontend, serial radio ingest, and live CHMI radar.

## Project structure

- `backend/` Flask API and radio telemetry reader
- `frontend/` React + TypeScript + Blueprint.js dashboard
- `issues/` local task tracking

## Default local ports

- backend: `5001`
- frontend: `3000`

## Run backend

```bash
source /Users/dan/Documents/Cansat/.venv/bin/activate
pip install -r /Users/dan/Documents/Cansat/backend/requirements.txt
python /Users/dan/Documents/Cansat/backend/app.py
```

## Run frontend

```bash
cd /Users/dan/Documents/Cansat/frontend
npm install
npm start
```

## Run full stack

Open two terminals.

Terminal 1:

```bash
source /Users/dan/Documents/Cansat/.venv/bin/activate
python /Users/dan/Documents/Cansat/backend/app.py
```

Terminal 2:

```bash
cd /Users/dan/Documents/Cansat/frontend
npm start
```

Then open:

```text
http://localhost:3000
```

## Notes

- The backend auto-connects to the preferred serial radio device when available.
- The frontend reads telemetry from the backend API and SSE stream.
- The CHMI panel shows the latest live radar image for the Czech Republic.
