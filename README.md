<<<<<<< HEAD
<<<<<<< HEAD
# Aviofanatix
Aviofanatix Dashboard for Radiomaster FPV Data.
=======
=======
>>>>>>> issue-005-chmi-single-live-radar-panel
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
```

Run frontend:

```bash
cd /Users/dan/Documents/Cansat/frontend
npm install
npm start
```

Run the terminal telemetry dashboard directly:

```bash
source /Users/dan/Documents/Cansat/.venv/bin/activate
python /Users/dan/Documents/Cansat/backend/fpv_radio_live.py
```
<<<<<<< HEAD
>>>>>>> 9dab241 (init)
=======
>>>>>>> issue-005-chmi-single-live-radar-panel
