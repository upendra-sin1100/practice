# Infosys SE Prep

Practice the seven Infosys Software Engineer mock papers. The frontend is a Next.js app and the backend contains the Python parser and SQLite database.

## Project Layout

- `frontend/infosys-prep` - Next.js practice interface
- `backend/infosys_prep` - Python database and ingestion code
- `backend/papers` - PDF and DOCX question papers

## First-Time Setup

From PowerShell:

```powershell
cd D:\practice
D:\practice\.venv\Scripts\Activate.ps1
python -m pip install -r .\backend\infosys_prep\requirements.txt
cd .\frontend\infosys-prep
npm install
```

## Initialize the Backend Database

Run this from `D:\practice`:

```powershell
cd D:\practice\backend\infosys_prep
D:\practice\.venv\Scripts\python.exe -c "import database, ingestion; database.init_db(); ingestion.ingest_all(print)"
```

The backend uses SQLite at `backend/infosys_prep/data/app.db`. The current app does not connect to Supabase yet.

## Run the Frontend

Open a second PowerShell terminal:

```powershell
cd D:\practice\frontend\infosys-prep
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The development and production scripts use Webpack because Turbopack native bindings are unavailable in the current Windows environment.

## Regenerate Frontend Paper Data

If the source papers change, run:

```powershell
cd D:\practice\frontend\infosys-prep
D:\practice\.venv\Scripts\python.exe .\scripts\parse_papers.py
```

This updates `src/data/papers.json` from the files in `backend/papers`.

## Production Build

```powershell
cd D:\practice\frontend\infosys-prep
npm run build
npm run start
```
