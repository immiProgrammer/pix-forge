# PixForge landing site

An independent Vite + React + TypeScript site in the pnpm/Turborepo workspace.

From the repository root:

```sh
pnpm install
pnpm dev:web
pnpm build:web
pnpm --filter @pixforge/web preview
```

Development uses port **5174**. Deploy **`apps/web/dist`** as a static site after `pnpm build:web`. On a monorepo-aware host, install from the repository root with `pnpm install --frozen-lockfile`, use `pnpm build:web` as the build command, and set that output directory. No server or Tauri dependencies are needed by the website.

## Docker and Dokploy

The repository-root `Dockerfile` builds the website and serves static files with Nginx on port **8080**. No Node.js runs in production. See [the Dokploy guide](../../docs/DOKPLOY.md) for direct repository deployment, registry credentials, optional automatic deployment, and build arguments. The site publishing workflow is `.github/workflows/site.yml`.

## Theme and content

- `src/theme.css`: independent light/dark colors matching the desktop palette.
- `src/fonts.css`: local Newsreader and Roboto faces, preloaded in `index.html`.
- `src/useTheme.ts`: saved Light/Dark/System preference.
- `src/landing.css` and `src/showcase.css`: layout, graphics, and screenshots.
- `src/App.tsx`: page content, actual app screenshots, and animated FAQ.

The workspace screenshots follow the site's light/dark theme. Comparison and list screenshots are static captures of the desktop app. The hero's product collage is decorative. The grid background fades before the format strip.

## Releases and source links

Copy `.env.example` to `.env.local` and optionally set:

```dotenv
VITE_RELEASES_URL=https://github.com/immiProgrammer/pix-forge/releases/latest
VITE_GITHUB_URL=https://github.com/immiProgrammer/pix-forge
```

These are the built-in defaults. To override them, set HTTPS links at build time on the hosting service. There is no AI account connection, analytics integration, or external image request at runtime.

## Image credits

The workspace illustration uses locally bundled, resized sneaker photos from Unsplash:

- [Red sneaker](https://images.unsplash.com/photo-1542291026-7eec264c27ff), image ID `photo-1542291026-7eec264c27ff`.
- Image IDs `photo-1549298916-b41d501d3772`, `photo-1600185365926-3a2ce3cdb9eb`, and `photo-1600269452121-4f2416e55c28` from [Unsplash](https://unsplash.com/).
- The hero uses [headphones](https://images.unsplash.com/photo-1505740420928-5e560c06d30e), [skincare products](https://images.unsplash.com/photo-1608571423902-eed4a5ad8108), and a [ceramic cup](https://images.unsplash.com/photo-1514228742587-6b1558fcca3d), also downloaded from Unsplash.

Photos are used under the [Unsplash License](https://unsplash.com/license). Font packages and other third-party dependencies retain their respective licenses.
