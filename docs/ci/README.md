# CI and deploy

The Claude GitHub App can't write `.github/workflows/`, so these workflow files are kept here for reference only. They are not active.

**Deploy** uses the `gh-pages` branch: build with `BASE=/korean-srs/ npm run build:web`, then push `apps/web/dist` to `gh-pages` (repo Settings → Pages → Source: *Deploy from a branch*, `gh-pages` / root).

**To turn on CI instead,** add `ci.yml` (and `deploy-pages.yml` if you prefer Actions-based deploys) through GitHub's web editor at `.github/workflows/`. Then set Pages → Source to *GitHub Actions*.
