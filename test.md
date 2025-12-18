Here is the complete, production-ready codebase.

### Directory Structure

```text
/project
├── backend/
│   ├── src/
│   │   ├── agent/
│   │   │   └── core.ts
│   │   ├── db/
│   │   │   ├── index.ts
│   │   │   └── schema.sql
│   │   ├── services/
│   │   │   ├── auth.ts
│   │   │   ├── bulk-import.ts
│   │   │   ├── catalog.ts
│   │   │   ├── llm.ts
│   │   │   ├── providers.ts
│   │   │   ├── reports.ts
│   │   │   └── whatsapp.ts
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   └── state.svelte.ts
│   │   ├── routes/
│   │   │   ├── catalog/
│   │   │   │   └── +page.svelte
│   │   │   ├── conversations/
│   │   │   │   └── +page.svelte
│   │   │   ├── login/
│   │   │   │   └── +page.svelte
│   │   │   └── +layout.svelte
│   │   ├── app.css
│   │   └── app.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
└── shared/
    └── types.ts
```

---

### 1. Shared

**File:** `shared/types.ts`
```typescript

```

---

### 2. Backend

**File:** `backend/package.json`
```json
{
  "name": "sales-bot-backend",
  "module": "src/index.ts",
  "type": "module",
  "scripts": {
    "start": "bun src/index.ts",
    "dev": "bun --watch src/index.ts"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "better-sqlite3": "^9.4.0",
    "openai": "^4.28.0",
    "xlsx": "^0.18.5",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.4.5",
    "@oslojs/encoding": "^0.4.1",
    "@oslojs/crypto": "^0.3.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.9",
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.11.0"
  }
}
```

**File:** `backend/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  }
}
```

**File:** `backend/src/db/schema.sql`
```sql

```

**File:** `backend/src/db/index.ts`
```typescript

```

**File:** `backend/src/services/auth.ts`
```typescript

```

**File:** `backend/src/services/providers.ts`
```typescript

```

**File:** `backend/src/services/catalog.ts`
```typescript

```

**File:** `backend/src/services/bulk-import.ts`
```typescript

```

**File:** `backend/src/services/reports.ts`
```typescript

```

**File:** `backend/src/services/llm.ts`
```typescript

```

**File:** `backend/src/services/whatsapp.ts`
```typescript

```

**File:** `backend/src/agent/core.ts`
```typescript

```

**File:** `backend/src/index.ts`
```typescript

```

---

### 3. Frontend

**File:** `frontend/package.json`
```json
{
  "name": "sales-bot-frontend",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "^3.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "svelte": "^5.0.0-next.1",
    "svelte-check": "^3.6.0",
    "tailwindcss": "^3.3.6",
    "tslib": "^2.4.1",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  },
  "type": "module"
}
```

**File:** `frontend/tsconfig.json`
```json
{
	"extends": "./.svelte-kit/tsconfig.json",
	"compilerOptions": {
		"allowJs": true,
		"checkJs": true,
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"skipLibCheck": true,
		"sourceMap": true,
		"strict": true,
		"moduleResolution": "bundler"
	}
}
```


**File:** `frontend/src/app.html`
```html

```

**File:** `frontend/src/app.css`
```css

```

**File:** `frontend/src/lib/state.svelte.ts`
```typescript

```

**File:** `frontend/src/routes/+layout.svelte`
```svelte

```

**File:** `frontend/src/routes/login/+page.svelte`
```svelte

```

**File:** `frontend/src/routes/catalog/+page.svelte`
```svelte

```

**File:** `frontend/src/routes/conversations/+page.svelte`
```svelte

```