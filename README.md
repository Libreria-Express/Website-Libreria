# Librería Express — Sitio web

Sitio en **HTML + CSS + JS** (sin build) para la home, más un catálogo de precios
y un panel de administración con funciones serverless de Vercel (`/api`). Listo
para Vercel.

## Archivos
- `index.html` — home de marketing
- `catalogo.html` / `catalogo.css` / `catalogo.js` — catálogo público: buscador,
  filtro por categoría, carrito de pedido (localStorage) y envío por WhatsApp
- `admin.html` / `admin.css` / `admin.js` — panel protegido por contraseña para
  descargar/subir el Excel de precios
- `api/` — funciones serverless (login, catálogo, subida/descarga de Excel,
  subida de imágenes vía GitHub)
- `data/catalogo-inicial.json` — catálogo semilla (se usa como respaldo si
  todavía no se subió ningún Excel desde `/admin`, o si falla la lectura del
  almacenamiento)
- `data/imagenes-asignadas.json` — mapa `id → ruta de imagen`, commiteado a
  git; es la fuente de verdad de las fotos de producto (ver más abajo)
- `imagenes-productos/` — archivos `.webp` de cada foto de producto,
  commiteados a git (no Vercel Blob)
- `estilos.css` — diseño y colores de marca (variables `:root` reutilizadas por
  `catalogo.css` y `admin.css`)
- `script.js` — envío de los formularios de la home por WhatsApp
- `logo.svg`, `favicon.svg`, `og-image.svg` — marca
- `vercel.json` — config de Vercel (URLs limpias + headers + cache + noindex
  de `/admin`)
- `robots.txt` / `sitemap.xml` — SEO

## Variables de entorno (Vercel → Project Settings → Environment Variables)
- `ADMIN_PASSWORD` — contraseña única para entrar a `/admin`
- `ADMIN_SESSION_SECRET` — cadena larga y aleatoria, se usa para firmar la
  cookie de sesión (no la compartas ni la reuses de otro proyecto)
- `BLOB_READ_WRITE_TOKEN` — la crea Vercel automáticamente al conectar un
  **Blob Store** al proyecto (Project → Storage → Create Database → Blob).
  Sin esto, `/catalogo` sigue funcionando con el catálogo inicial, pero
  `/admin` no puede publicar actualizaciones de precios/Excel. **Ya no se usa
  para las fotos de producto** (ver abajo).
- `GITHUB_TOKEN` — Personal Access Token de GitHub con permiso de escritura
  sobre el repo (`contents: write` si es fine-grained, o scope `repo` si es
  classic). Lo usa `/admin` (en producción) para commitear la foto que subís
  o pegás como URL, directo al repo.
- `GITHUB_REPO` — `"owner/nombre-repo"`, ej. `Libreria-Express/Website-Libreria`.
- `GITHUB_BRANCH` — opcional, default `main`. Tiene que ser la rama que Vercel
  usa para autodeployar.
- `SERPAPI_API_KEY` — opcional; solo si corrés la búsqueda con `--engine serpapi`.
  Por defecto se usa DuckDuckGo gratis (`ddgs`).

## Imágenes de producto — cómo funcionan (archivos del repo, no Blob)
Las fotos **no** viven en Vercel Blob (tiene un límite de transferencia muy
chico en el plan gratis y se bloquea fácil). En cambio:
- Cada foto final es un archivo commiteado en `imagenes-productos/{id}.webp`.
- `data/imagenes-asignadas.json` es un mapa `{ "id-del-producto": "/imagenes-productos/id.webp" }`,
  también commiteado a git.
- `api/catalogo.js` lee el catálogo (Blob o respaldo, para precios/categorías)
  y le **pisa el campo `imagen`** de cada producto con lo que diga ese mapa
  (`aplicarImagenesAsignadas` en `api/_catalogo.js`). Así las fotos quedan
  desacopladas del catálogo de precios y no dependen de la cuota de Blob.
- En producción, `/admin` (sección 3) permite subir un archivo **o pegar una
  URL de imagen** por producto. Ambas cosas terminan en `POST /api/admin-imagen`,
  que optimiza la imagen (Sharp, WebP 320×320) y la commitea a GitHub
  (`api/_github.js`, Contents API): un commit para el `.webp` y otro para
  `data/imagenes-asignadas.json`. Ese push dispara el autodeploy de Vercel, así
  que la foto tarda **1–2 minutos** en verse (no es instantáneo como Blob).
  "Descartar" en producción (`/api/admin-imagen-descartar`) hace lo mismo pero
  quitando la entrada del mapa.

### Rellenar el catálogo en lote (herramienta local, sin API paga)
Dos scripts en dos pasos —primero juntar candidatos, después elegir a mano
cuál usar— porque la búsqueda automática **nunca alcanza para confiar sola**:
en pruebas reales, gran parte de los resultados eran de otra cosa (mapas,
comida, logos, gente, contenido de sitios de adultos indexados por
palabras sueltas del nombre del producto). Para mitigarlo:
- Todas las queries de búsqueda anclan el contexto con "librería"/"papelería"
  (nunca se busca el nombre del producto solo).
- `safesearch=on` en DuckDuckGo (`scripts/buscar-imagenes-ddg.py`).
- Lista de dominios bloqueados y palabras negativas en el título —incluye
  sitios/términos de contenido adulto explícito— en
  `DOMINIOS_BLOQUEADOS` / `PALABRAS_NEGATIVAS_TITULO` (`scripts/enrich-imagenes.js`).

Aun así, **revisá siempre a mano** antes de publicar:

```bash
# Una vez: venv + dependencia de búsqueda
python3 -m venv .venv-enrich && .venv-enrich/bin/pip install ddgs

# 1) Buscar hasta 5 candidatos por producto y descargarlos localmente
node scripts/buscar-candidatos.js --limit 30 --only-missing

# 2) Revisar y elegir a mano (abre http://localhost:4321)
npm run candidatos:revisar
```

En la revisión, por cada producto podés: elegir una de las hasta 5 fotos
encontradas, pegar una URL propia ("Usar esta URL") si ninguna sirve, o
descartarlo ("Ninguna sirve", se puede reintentar después con
`--retry-descartados`). Al confirmar, la foto se guarda como archivo en
`imagenes-productos/` y se anota en `data/imagenes-asignadas.json` —**en tu
máquina**. Para publicarla hace falta:
```bash
git add imagenes-productos data/imagenes-asignadas.json
git commit -m "imagenes: agregar fotos revisadas"
git push
```
(Repetí el paso 1 con `--limit` más alto para ir cubriendo el resto del
catálogo; el índice en `data/candidatos/index.json` no se sube a git —está en
`.gitignore`— así que no repite trabajo entre corridas mientras no lo borres.)

## Formato del Excel de precios
`/admin` acepta dos formatos, detectados automáticamente:
- **Export tal cual del sistema interno**: la lista agrupada por familia (una
  fila por categoría con las palabras "Precio"/"PVP", y debajo una fila por
  artículo). Es el formato real que usa la librería — no hace falta
  reformatearlo antes de subirlo.
- **Planilla simple**: una sola hoja con las columnas `Categoria`, `Producto`,
  `Precio` (podés descargar el catálogo actual desde `/admin` como plantilla
  en este formato).

En ambos casos, las filas sin categoría, sin producto o con un precio
inválido se descartan y se avisa cuáles fueron al subir el archivo.

## Ver en local
La home (`index.html`, `catalogo.html`, `admin.html`) es estática, pero
`catalogo.html` y `admin.html` dependen de las funciones `/api`. Para probar
todo junto (incluyendo `/api`) hace falta la CLI de Vercel:
```bash
npm install
npm i -g vercel
vercel link      # una sola vez, asocia la carpeta al proyecto de Vercel
vercel env pull  # trae las variables de entorno configuradas en Vercel
vercel dev
```
Si solo querés ver la home o probar el catálogo con el respaldo inicial (sin
`/api`), alcanza con:
```bash
npx serve .
```

## Desplegar en Vercel

### Opción A — Vercel CLI (lo más rápido)
```bash
npm i -g vercel
cd sitio
vercel          # primer deploy (preview)
vercel --prod   # publicar en producción
```
Cuando pregunte por configuración: framework **Other**, sin build command, output **.** (la carpeta actual).

### Opción B — Desde GitHub (dashboard de Vercel)
1. Subí el proyecto a un repo de GitHub.
2. En vercel.com → **Add New… → Project** → importá el repo.
3. En **Root Directory** elegí `Web/sitio` (¡importante! para que ignore el proyecto React).
4. **Framework Preset:** Other · **Build Command:** vacío · **Output Directory:** vacío.
5. **Deploy**.

## Después de publicar
Reemplazá `https://libreria-express.vercel.app/` por tu dominio final en:
`index.html` (canonical / og:url / og:image), `robots.txt` y `sitemap.xml`.
