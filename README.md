# Career Path Explorer

A career path exploration tool that helps users discover and plan their professional journey. The app pairs a React SPA (development on webpack-dev-server) with an Express API and MongoDB.

## Quick start

### Prerequisites

- **Node.js** 18 LTS or newer (recommended; required by current Mongoose and Webpack toolchains)
- **MongoDB** (local instance, Docker, or Atlas connection string)
- **npm** (or yarn)

After installing Node.js, open a **new** terminal and run `node --version` and `npm --version`. If either command is not found, restart the terminal or IDE and confirm Node is on your `PATH`.

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

   `npm install` reads `package.json`, installs into `node_modules/`, and updates `package-lock.json`; first run may take a few minutes.

2. **Environment variables**

   Copy `env-template.txt` to `.env` in the project root and set at least:

   ```env
   MONGODB_URI=mongodb://localhost:27017/career-path-explorer
   JWT_SECRET=your-secret-key-here
   EMAIL_USER=your-gmail@gmail.com
   EMAIL_PASS=your-app-password
   OPENAI_API_KEY=your-api-key-here
   ```

   Optional (OpenAI-compatible providers): `OPENAI_BASE_URL`, `OPENAI_MODEL` — see comments in `env-template.txt`.

   **Secrets:** Use a long random `JWT_SECRET` (e.g. `openssl rand -hex 32`). Never commit `.env` or real secret values. `server.js` exits on startup if `JWT_SECRET` is missing or empty.

3. **MongoDB**

   The app must be able to reach the database at `MONGODB_URI`. See [MongoDB options](#mongodb-options) below.

4. **Run the app**

   ```bash
   # API + webpack dev server (hot reload)
   npm run dev

   # Or separately:
   npm run dev:server   # API only — http://localhost:3000
   npm run dev:client   # SPA only — http://localhost:3001 (proxies /api and /uploads to 3000)
   ```

5. **URLs**

   - **Main UI (development):** http://localhost:3001  
   - **API:** http://localhost:3000  
   - **Health check:** http://GET localhost:3000/api/health  

   The API server also serves a few static HTML pages under `/`, `/about`, and `/register` from `views/pages/` and static assets from `public/`. User-facing flows are primarily the React app on port 3001 in dev.

### MongoDB options

**Local (default)**  
Install [MongoDB Community Server](https://www.mongodb.com/try/download/community). Use a URI such as `mongodb://localhost:27017/career-path-explorer` in `.env`. On Windows, if you installed MongoDB as a service, check status with `Get-Service MongoDB` (PowerShell) and start with `Start-Service MongoDB` when needed. You can confirm the port is open with `Test-NetConnection -ComputerName localhost -Port 27017`.

**MongoDB Atlas (cloud)**  
1. Create an account and a free (M0) cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register).  
2. Under **Database Access**, add a user with password authentication.  
3. Under **Network Access**, add your IP or, for development only, allow access from anywhere (`0.0.0.0/0`).  
4. **Database → Connect → Connect your application** and copy the SRV connection string. Set `MONGODB_URI` in `.env`, replacing the password placeholder and appending a database name if needed, for example:  
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/career-path-explorer?retryWrites=true&w=majority`  
   URL-encode special characters in the password if you see authentication errors.

**Docker**  
If Docker is available:

```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

Then use `MONGODB_URI=mongodb://localhost:27017/career-path-explorer`.

**Verify**  
After `npm run dev`, the server log should indicate MongoDB connected. Errors such as `ECONNREFUSED` on port 27017 usually mean nothing is listening at that address or `MONGODB_URI` is wrong.

### Windows: PowerShell and npm

On Windows, PowerShell **execution policy** can block npm. Any of these works:

- Run npm via **cmd**: `cmd /c npm install`, `cmd /c npm run dev`, `cmd /c npm test`, etc.  
- Use the **`npm.ps1`** helper in the project root: `.\npm.ps1 install`, `.\npm.ps1 run dev`.  
- Use **Command Prompt (cmd.exe)** and run `npm` commands normally.

### Production build

1. `npm run build` — emits the compiled React app into `public/dist/`.
2. `npm start` — runs `server.js`, which serves `public/` (including `dist/`), **`/api`**, and **`/uploads`** on port **3000** (or `PORT` from `.env`).
3. Open **http://localhost:3000/dist/** for the bundled SPA and use the same host for the API (e.g. **http://localhost:3000/api/...**). If script requests 404 at the site root, set webpack **`output.publicPath`** to **`'/dist/'`** for production builds and rebuild.

## Project structure

```
├── config/                 # Database connection (e.g. database.js)
├── evaluation/             # Offline evaluation runners and output
├── public/                 # Static assets; webpack emits to public/dist/
├── routes/                 # Unused legacy file(s); API lives under src/server/routes/
├── scripts/                # Data builds, migrations, ESCO sync, embedding rebuilds
├── src/
│   ├── client/             # React app (entry: index.js, App.jsx)
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   └── utils/
│   ├── server/
│   │   ├── app.js          # Minimal Express app (e.g. supertest); not the production entry
│   │   ├── controllers/
│   │   ├── middleware/     # auth (JWT), validation, etc.
│   │   ├── models/
│   │   ├── prompts/        # LLM prompt templates
│   │   ├── routes/         # Mounted from server.js
│   │   ├── services/       # Matching, embeddings, ESCO, documents, simulation, etc.
│   │   └── tests/
│   └── uploads/            # Created at runtime: documents/, profile-pictures/ (served at /uploads)
├── views/pages/            # Static HTML served by server.js for a few legacy routes
├── env-template.txt
├── server.js               # Production/dev API entry (listen, mount routes)
└── webpack.config.js
```

## npm scripts

### App and quality

| Script | Purpose |
|--------|---------|
| `npm start` | Production API: `node server.js` |
| `npm run dev` | Concurrent API (nodemon) + webpack dev server |
| `npm run dev:server` | API only |
| `npm run dev:client` | Client only |
| `npm run build` | Production webpack build → `public/dist/` |
| `npm test` | Jest (`src/server/tests/**/*.test.js`) |
| `npm run test:watch` | Jest watch mode |
| `npm run test:coverage` | Jest with coverage |
| `npm run lint` | ESLint |

### Data and maintenance

| Script | Purpose |
|--------|---------|
| `npm run migrate:duplicates` | Career-step duplicate migration |
| `npm run build:skills` | Skill model build (`:force`, `:dry` variants) |
| `npm run build:seniority` | Seniority levels (`:force`, `:dry`) |
| `npm run build:responsibilities` | Key responsibilities (`:force`, `:dry`, `:heuristic`) |
| `npm run rebuild:role-embeddings` | Rebuild role embeddings (`:dry-run`) |
| `npm run sync:esco` | Sync ESCO occupation data |

### Evaluation

| Script | Purpose |
|--------|---------|
| `npm run evaluate` | Run `evaluation/evaluationRunner.js` |
| `npm run evaluate:ranking-tables` | Generate ranking tables markdown under `evaluation/output/` |

## HTTP API (server.js)

All JSON APIs are under `/api` unless noted.

| Prefix | Module |
|--------|--------|
| `/api/health` | Liveness (no auth) |
| `/api/auth` | `src/server/routes/auth.js` |
| `/api/profile` | `src/server/routes/profile.js` |
| `/api/documents` | `src/server/routes/documents.js` |
| `/api/occupations` | `src/server/routes/occupations.js` |
| `/api/share` | `src/server/routes/share.js` |
| `/api/job-analysis` | `src/server/routes/jobAnalysis.js` |

**Simulation & saved-simulation HTTP paths** (methods + `/api/profile/...` suffixes): single canonical table in **[`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §7** — prefer that over duplicating routes in README or feature docs.

**Authentication:** Protected routes expect `Authorization: Bearer <JWT>`. Tokens are issued by the auth controller and verified in `src/server/middleware/auth.js`.

**Uploads:** Files are stored under `src/uploads/` and exposed at `/uploads/...` by the same server that mounts the API.

## Technology stack

### Frontend

- React 18, React Router 6
- MUI (Material UI) 5, Emotion
- Formik, Yup
- Axios (HTTP)
- Webpack 5, Babel
- @dnd-kit (sortable lists / reordering)
- react-dropzone, react-easy-crop (uploads / profile image)

### Backend

- Express.js
- MongoDB with Mongoose
- JWT (`jsonwebtoken`) for API authentication
- express-validator, express-rate-limit, helmet, compression, morgan
- Multer (uploads), Nodemailer (email)
- OpenAI SDK (OpenAI-compatible APIs for prompts / analysis)

The repo still lists Passport-related packages for OAuth strategies; the **running** app in `server.js` does not mount `src/server/index.js`. Use JWT middleware as the source of truth for how requests are authenticated today.

## Features (high level)

- Registration, login, JWT sessions (with token versioning / invalidation)
- Rich profile (personal info, experience, education, certifications, career preferences, documents, profile picture)
- Career simulation with scoring, prioritized lists, saved simulations, share links
- ESCO occupation search and integration
- Job analysis and LLM-assisted extraction (responsibilities, identity text, etc.) where configured
- Document upload and optional profile enrichment
- Offline evaluation tooling under `evaluation/`

## Understanding the codebase

### Backend layout

- **Routes** — URL prefixes and HTTP verbs
- **Controllers** — Parse requests, call services, send responses
- **Models** — Mongoose schemas (e.g. `User`, `CareerPath`, `SimulationPrioritizedItem`)
- **Services** — Matching, embeddings, simulation pipeline, ESCO, documents
- **Middleware** — JWT auth, validation

### Frontend layout

- **Pages** — Route-level screens under `src/client/components/pages/`
- **Contexts** — Auth, navigation guard
- **Hooks** — Shared client logic
- **Common** — Reusable UI (e.g. career step cards)

### Good starting points

1. `server.js` — Middleware, static files, API mounts, uploads
2. `src/client/components/App.jsx` — Client routes
3. `src/server/middleware/auth.js` — Bearer JWT verification
4. `src/server/routes/auth.js` / `authController.js` — Login and tokens
5. `src/server/models/User.js` — Core user document shape
6. `src/server/routes/profile.js` — Profile and simulation APIs
7. `src/client/components/pages/Profile.jsx` / `Simulation.jsx` — Major user flows

### Tests

Integration and unit tests live in `src/server/tests/`. A slim Express app in `src/server/app.js` mounts a subset of routes for tests; production uses `server.js`.

## Additional documentation

Start here when you need behavior or contracts beyond the code:

| Document | Role |
|----------|------|
| **`requirements.md`** | Master **as-built** index; **§11** = Core Features (`### 9.x` labels for citations). Long change history is in git. |
| **`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`** | Simulation **as-built**: inputs, path pool, APIs (**§7** route table), results JSON, profile gate—aligned with current code. |
| **`CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md`** | **Canonical** numeric matching spec: hybrid weights, MMR, exploration, pools; live `POST /api/profile/simulation` pipeline. |
| **`ARCHITECTURE.md`** | Simulation feature architecture (as-built) with pointers to main server/client modules. |
| **`SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`** | Save / dislike / remove semantics for simulation cards. |
| **`REMOVE_CAREER_STEPS_FEATURE.md`** | Remove + list-based replacement, DELETE route, client behavior. |
| **`SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md`** | Updating saved simulations (`PUT` workflow). |
| **`*_REQUIREMENTS.md`** (root) | Other feature-specific specs (profile, UI, ESCO, etc.). |
| **`ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md`** | Occupation synonyms (`altLabels`). |

**Setup / tooling (this README):** Prerequisites, **MongoDB options**, **Windows: PowerShell and npm** (`cmd /c`, `npm.ps1`), env vars, and **Common issues**—consolidated from older standalone setup guides.

## Common issues

- **MongoDB:** Confirm `MONGODB_URI` and that the database is reachable. For Atlas, check username/password in the URI, URL-encoding for special characters in the password, and that **Network Access** allows your IP. If port **27017** is already in use locally, find the conflicting process (e.g. on Windows: `netstat -ano | findstr :27017`) or use a different MongoDB port and update `MONGODB_URI`.
- **Node / npm not recognized:** Install or repair Node.js LTS, then open a **new** terminal. Confirm with `node --version` and `npm --version`.
- **Install / dependency errors:** Check network access, then try deleting `node_modules` and `package-lock.json` and running `npm install` again. On Windows, retry from an elevated terminal if installs fail with permission errors.
- **Ports:** API defaults to 3000; webpack dev server to 3001. Close other apps using those ports, or adjust `PORT`, `server.js` CORS origins, and `webpack.config.js` `devServer` if you change them.
- **LLM features:** Set `OPENAI_API_KEY` (and optional base URL/model) or related calls will fail.
- **Dependencies:** After major pulls, run `npm install`. Periodically run `npm audit` to review reported advisories.

## Development workflow

1. Branch: `git checkout -b feature/your-feature-name`
2. Implement with tests where appropriate
3. `npm test` and `npm run lint`
4. `npm run dev` for manual checks
5. Commit and push

---

Happy coding.
