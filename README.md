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
- `api/` — funciones serverless (login, catálogo, subida/descarga de Excel)
- `data/catalogo-inicial.json` — catálogo semilla (se usa como respaldo si
  todavía no se subió ningún Excel desde `/admin`, o si falla la lectura del
  almacenamiento)
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
  `/admin` no puede publicar actualizaciones de precios.

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
