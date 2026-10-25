# Deploy the PixForge website with Dokploy

The root `Dockerfile` builds only `apps/web`, then copies its static output into
an unprivileged Nginx image. Node.js, pnpm, Rust, and the desktop app are absent
from the runtime image. Nginx listens on **8080**; Dokploy handles the public
domain and HTTPS.

## Option 1: Build directly in Dokploy

1. Create a Dokploy Application and connect this Git repository.
2. Select the branch to deploy and choose the **Dockerfile** build type.
3. Use the repository root (`.`) as the build context and `Dockerfile` as the
   Dockerfile path. Do not use `apps/web` as the context: installation needs the
   root workspace configuration and lockfile.
4. Add your domain and set its container port to **8080**. Enable HTTPS in
   Dokploy. No volume, startup command, or public host port mapping is needed.
5. Deploy. No website link environment variables or build arguments are needed.

The GitHub image-publishing workflow is not needed for this option.

## Option 2: GitHub builds, Dokploy pulls the image

`.github/workflows/site.yml` builds on pushes to `main` or `master` when website
files or shared build/deployment inputs change. Desktop-only and documentation-only
changes do not trigger it. Shared dependency lockfile changes do trigger it. It can
also run manually and pushes `latest`, a short commit tag, and a timestamp tag.

Set these GitHub Actions secrets:

| Secret              | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `REGISTRY_USERNAME` | Account allowed to push to the registry              |
| `REGISTRY_PASSWORD` | Registry password or push token                      |
| `DOKPLOY_API_KEY`   | Optional; enables deployment after a successful push |

The Cloudflare-protected registry also requires these Actions secrets:

| Secret          | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `CF_ACCOUNT_ID` | Cloudflare account containing the runner IP list                  |
| `CF_ZONE_ID`    | Zone protecting the registry                                      |
| `CF_API_TOKEN`  | Token allowed to manage the IP list, WAF rule, and Bot Fight Mode |

The token needs **Account Filter Lists: Edit**, **Zone WAF: Edit** for initial
rule setup, and **Zone Settings: Edit** for the temporary Bot Fight Mode change.

Set these GitHub Actions repository variables:

| Variable                 | Default / purpose                                            |
| ------------------------ | ------------------------------------------------------------ |
| `CONTAINER_REGISTRY`     | `registry.geto.pk` (hostname only)                           |
| `SITE_IMAGE_NAME`        | `pix-forge-site` (may include a registry namespace)          |
| `DOKPLOY_URL`            | Required with the API key; e.g. `https://deploy.example.com` |
| `DOKPLOY_APPLICATION_ID` | Required with the API key; target application ID             |

In Dokploy, create an Application using a Docker image source. Configure registry
pull credentials and this image (adjust it if you changed the variables):

```text
registry.geto.pk/pix-forge-site:latest
```

Attach your domain to container port **8080**. If the optional API settings are
configured, the workflow tells Dokploy to redeploy after pushing. Otherwise,
deploy manually in Dokploy after the workflow succeeds. For a rollback, choose
one of the published `sha-…` tags and redeploy.

The workflow first builds and loads the image locally, then uses
[`bypass-cloudflare-for-github-action@v2.1.0`](https://github.com/xiaotianxt/bypass-cloudflare-for-github-action/tree/v2.1.0)
to allow the runner through Cloudflare and temporarily disable Bot Fight Mode.
After a 25-second propagation wait it logs in, waits 10 seconds, and pushes all
image tags. The action registers job-end cleanup for its IP list and restores
Bot Fight Mode. The optional Dokploy API call runs after the push succeeds.

## Public links

The site links directly to [the latest release](https://github.com/immiProgrammer/pix-forge/releases/latest)
and [the source repository](https://github.com/immiProgrammer/pix-forge).
They are defined in `apps/web/src/App.tsx`. To change them, edit the source and
rebuild the image. No link-related GitHub variables or Docker build arguments
are needed; any previously configured link variables can be removed.

## Local container check

With Docker installed, run from the repository root:

```sh
docker build -t pixforge-site .
docker run --rm -p 8080:8080 pixforge-site
```

Open `http://localhost:8080`. `/health` returns `ok`. Hashed Vite assets use
long-lived caching; HTML revalidates, while stable screenshot/font filenames
have a one-hour cache lifetime.

References: [Dokploy applications](https://docs.dokploy.com/docs/core/applications),
[Dokploy deployment API](https://docs.dokploy.com/docs/core/auto-deploy),
[pnpm Docker builds](https://pnpm.io/docker).
