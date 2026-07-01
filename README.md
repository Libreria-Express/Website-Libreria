# Librería Express — Sitio web (estático)

Sitio estático en **HTML + CSS + JS** (sin build, sin dependencias). Listo para Vercel.

## Archivos
- `index.html` — toda la página y los textos
- `estilos.css` — diseño y colores de marca
- `script.js` — envío de los formularios por WhatsApp
- `logo.svg` — logo de la marca
- `favicon.svg` — ícono de la pestaña (camioneta del logo)
- `og-image.svg` — imagen al compartir el enlace en redes
- `vercel.json` — config de Vercel (URLs limpias + headers + cache)
- `robots.txt` / `sitemap.xml` — SEO

## Ver en local
Doble clic en `index.html`, o servir la carpeta:
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
