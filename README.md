# BookWise

BookWise is a full-stack book discovery and recommendation app built with a
React/Vite frontend and a Flask API. It combines catalogue search, popularity
ranking, TF-IDF content similarity, SVD collaborative filtering, a hybrid
recommender, private reader tools, ratings, shelves, and shareable lists.

## Features

- Search 10,000 Goodbooks catalogue titles by title, author, keyword, or genre.
- Popular, hidden-gem, similar-book, and personalized recommendation feeds.
- Hybrid recommendation engine using popularity, content similarity, and SVD.
- User accounts with secure password hashes and HttpOnly authentication cookies.
- Ratings, favorites, reading status, progress tracking, notes, reviews, comments,
  followed authors, custom shelves, private lists, and public share links.
- Recommendation preferences, feedback events, experiments, explanations, and
  reader-specific ranking signals.
- ML dashboard with model comparison and offline evaluation metrics.
- Responsive warm-ivory/gold interface with light and dark themes.

## Technology

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Lucide React |
| Backend | Python 3.12, Flask 3, SQLAlchemy 2 |
| Recommendation models | Popularity, TF-IDF content-based, Truncated SVD, hybrid ensemble |
| Database | SQLite for local development; PostgreSQL for deployment |
| Testing | Python unittest, Vitest, Testing Library, Oxlint |
| Production server | Gunicorn |
| Hosting layout | Render Web Service + Render Static Site |

## Project structure

```text
Book Recomendation/
├── backend/
│   ├── app.py                 # Flask app factory and health endpoint
│   ├── auth.py                # Token/cookie authentication helpers
│   ├── config.py              # Environment-backed configuration
│   ├── database.py            # SQLAlchemy engine, schema creation, catalog seed
│   ├── models/                # SQLAlchemy models
│   ├── recommender/           # Recommendation algorithms and ranking logic
│   ├── routes/                # Books, users, reader, and discovery APIs
│   ├── tests/                 # Backend tests
│   └── wsgi.py                # Gunicorn entry point
├── frontend/
│   ├── src/
│   │   ├── components/        # Shared UI components
│   │   ├── pages/             # Main application pages
│   │   ├── services/          # API clients and configurable API base URL
│   │   └── test/              # Frontend tests
│   ├── package.json
│   └── vite.config.js
├── data/
│   ├── processed/             # Seed catalogue and processed ratings
│   └── raw/                   # Original dataset files
├── artifacts/                 # Evaluation and model artifacts
├── scripts/                   # Smoke tests, evaluation, and validation helpers
├── Dockerfile
├── requirements.lock
└── README.md
```

## Important configuration rule

The Vite development proxy and the Flask server must point to the same backend.
The project uses port `8000` locally by default:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8000
```

Do not commit `.env`. It is ignored by Git. Create it from `.env.example` and
replace the development secret with a strong private value.

## Local setup on Windows

Open PowerShell in the project root.

### 1. Create and activate the Python environment

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.lock
```

If PowerShell blocks activation, run this once in the same PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 2. Create local environment variables

```powershell
Copy-Item .env.example .env
```

The local `.env` should contain at least:

```dotenv
APP_ENV=development
SECRET_KEY=replace-with-a-long-random-local-secret
DATABASE_URL=sqlite:///backend/bookwise.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
AUTH_TOKEN_MAX_AGE=86400
PORT=8000
```

If an old shell-level `PORT=5000` overrides `.env`, clear it before starting:

```powershell
Remove-Item Env:PORT -ErrorAction SilentlyContinue
```

### 3. Initialize the database and start the backend

```powershell
python -m backend.migrate
python -m backend.app
```

The API should print:

```text
Running on http://127.0.0.1:8000
```

Verify it in a second PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

### 4. Install and start the frontend

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>.

The frontend uses `/api` locally through the Vite proxy. For a separately
hosted frontend, set `VITE_API_BASE_URL` to the complete backend API base,
including `/api`, for example:

```dotenv
VITE_API_BASE_URL=https://bookwise-api.onrender.com/api
```

## API overview

Public endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Service and database health |
| GET | `/api/books` | Search and paginate the catalogue |
| GET | `/api/books/<id>` | Book details |
| GET | `/api/books/<id>/similar` | Similar-book recommendations |
| GET | `/api/recommendations/popular` | Popular and hidden-gem shelves |
| GET | `/api/evaluation/metrics` | Offline model metrics |
| GET | `/api/reader/shared/<token>` | Public published-list payload |

Authentication endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Sign in by username or email |
| GET | `/api/auth/me` | Restore the current session |
| POST | `/api/auth/logout` | Clear the authentication cookie |

Private discovery and reader endpoints include:

- `/api/discovery/preferences`
- `/api/discovery/feed`
- `/api/discovery/events`
- `/api/discovery/experiments`
- `/api/reader/books/<id>/...`
- `/api/reader/shelves`
- `/api/reader/progress`
- `/api/reader/authors`
- `/api/reader/lists`

Private requests use the HttpOnly cookie issued by login/register. The browser
client also keeps a bearer token in memory as a fallback; it is not stored in
localStorage.

## Tests and checks

From the project root:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py" -v
python -m compileall -q backend scripts
```

From `frontend/`:

```powershell
npm test
npm run lint
npm run build
```

Run the disposable browser-QA backend without touching the real database:

```powershell
# Terminal 1, from the project root
python -m scripts.smoke_server --port 8019 --frontend-port 5190

# Terminal 2, from frontend/
$env:VITE_API_PROXY_TARGET="http://127.0.0.1:8019"
npm run dev -- --host 127.0.0.1 --port 5190 --strictPort
```

## Push the project to GitHub

Do not commit `.env`, passwords, database files, tokens, or `node_modules`.

### First push for a new GitHub repository

1. Create an empty repository on GitHub. Do not add a README, `.gitignore`, or
   license there because this project already has them.
2. In PowerShell, from the project root, run:

```powershell
git init
git add .
git status
git commit -m "feat: add BookWise recommendation platform"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPOSITORY` with your actual GitHub values.
GitHub may open a browser for authentication. Never place a GitHub password or
personal access token inside a command that you commit to the project.

### Later changes

```powershell
git status
git add README.md Dockerfile frontend/src/services/config.js frontend/src/services/api.js frontend/src/services/discovery.js frontend/src/services/reader.js
git commit -m "docs: add local and Render deployment guide"
git push
```

If you changed more files intentionally, use `git add .` after reviewing
`git status`.

## Deploy on Render's free options

The recommended production layout is:

```text
Render Static Site  →  Render Web Service  →  PostgreSQL database
        frontend             Flask API              persistent data
```

Do not deploy the production app with SQLite. Render web-service filesystems
are not a safe place for permanent user accounts, ratings, or shelves. Use a
PostgreSQL connection string for deployed data.

Render's free web services spin down after 15 minutes without traffic, so the
first request after inactivity can be slow. This is suitable for a demo,
portfolio project, or class submission, not latency-sensitive production
traffic.

### A. Create the backend Web Service

1. Push the project to GitHub.
2. In Render, choose **New → Web Service** and connect the repository.
3. Use these settings:

| Setting | Value |
|---|---|
| Root Directory | Leave blank |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.lock` |
| Start Command | `gunicorn --bind 0.0.0.0:$PORT --workers 1 --timeout 120 backend.wsgi:app` |
| Health Check Path | `/api/health` |

4. Add these environment variables:

```text
APP_ENV=production
SECRET_KEY=<generate-a-long-random-secret>
DATABASE_URL=<your-PostgreSQL-connection-string>
AUTH_TOKEN_MAX_AGE=86400
AUTH_COOKIE_SECURE=true
CORS_ORIGINS=https://<your-frontend>.onrender.com
```

Do not hard-code `PORT`; Render supplies it at runtime. The application binds
to `0.0.0.0:$PORT` so Render can route traffic to it.

5. Deploy and verify:

```text
https://<your-backend>.onrender.com/api/health
```

The first boot creates the SQLAlchemy tables and seeds the book catalogue from
`data/processed/books_clean.csv` when the books table is empty. For a large
catalogue, allow extra startup time and check the deploy logs.

### B. Create the database

Create a PostgreSQL database in Render if a suitable free database is available
for your account, then copy its internal connection string into the backend's
`DATABASE_URL` environment variable. For real user data, use a database plan
with persistence and backups. Render's free Postgres offering has an expiry
period, so it should not be treated as permanent production storage.

### C. Create the frontend Static Site

1. Choose **New → Static Site** in Render and connect the same repository.
2. Use these settings:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

3. Add this build environment variable:

```text
VITE_API_BASE_URL=https://<your-backend>.onrender.com/api
```

4. Deploy the static site.
5. Copy the final frontend URL and update the backend's `CORS_ORIGINS` to the
   exact HTTPS origin, for example:

```text
CORS_ORIGINS=https://bookwise-frontend.onrender.com
```

6. Redeploy the backend after changing `CORS_ORIGINS`.

### D. Verify the deployed application

Check the API first:

```text
https://<your-backend>.onrender.com/api/health
```

Then open the frontend URL and test this order:

1. Register a new account.
2. Refresh the page and confirm the session is restored.
3. Open **For You** and confirm recommendations load.
4. Open **Reading Room** and create a shelf.
5. Rate a book, add it to a shelf, and reopen it after refresh.
6. Check browser DevTools for failed `/api/` requests.

If the frontend shows CORS errors, check that `CORS_ORIGINS` contains the exact
frontend origin with no trailing slash. If it shows 404 errors for discovery or
reader tools, verify that the frontend `VITE_API_BASE_URL` points to the current
backend URL and that the backend was redeployed from the same commit.

## Optional Docker deployment

The included Dockerfile is compatible with a platform-provided `PORT`:

```powershell
docker build -t bookwise-api .
docker run --rm -p 8000:10000 -e PORT=10000 bookwise-api
```

For Render, the native Python Web Service configuration above is simpler. Use
the Docker runtime only if you specifically want container-based deployment.

## Security and production notes

- Use a unique random `SECRET_KEY` in production.
- Never commit `.env`, database files, credentials, or API tokens.
- Use PostgreSQL for deployed accounts and reader data.
- Keep `AUTH_COOKIE_SECURE=true` when using HTTPS.
- Set `CORS_ORIGINS` to only the real frontend origin(s).
- Back up production data before schema changes.
- The app includes validation and rate limits, but it does not include a full
  moderation/admin workflow for public comments and reviews.

## License and dataset note

This project uses the Goodbooks-10k dataset for development and academic
recommendation experiments. Check the dataset's own licensing and attribution
requirements before redistributing the data or deploying it commercially.
