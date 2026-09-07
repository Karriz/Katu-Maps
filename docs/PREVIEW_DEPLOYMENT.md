# Same-repository Pages preview

Production stays at `/Katu-Maps/`; one disposable preview lives at
`/Katu-Maps/preview/`. Tag releases replace the entire site and remove previews.

## Initial activation

1. Merge the setup PR into `main`.
2. Publish a new normal `v*.*.*` tag containing these changes. Its workflow saves
   the exact production archive on the GitHub Release and publishes
   `deployment.json` with that archive's identity. Keep those release assets.
3. Open production once to allow the updated service worker to activate. Older
   installed workers may otherwise still intercept preview requests; if stale,
   reload production before reopening the preview.
4. In Actions, choose **Deploy preview → Run workflow**, leave the workflow branch
   at `main`, and enter `main`, a branch name, a commit SHA, or a PR number.
5. Open the preview link in the workflow summary on your phone.

The selected code must contain the preview-support changes (merge/rebase older
branches first). Only same-repository PRs are accepted. Check the selected code
before running: previews execute on the same browser origin as production and
are not a security sandbox. The workflow is manual, not triggered for arbitrary
external PRs.

## Behaviour

- Production files are downloaded from the exact archive identified by the live
  site's metadata, never rebuilt from an assumed latest tag. Missing metadata or
  archive fails before deployment; existing older releases need the activation
  release above, not a guessed rebuild.
- Preview and production workflows share a concurrency group with cancellation
  disabled. GitHub may replace pending jobs; rerun a displaced request if needed.
- Builds resolve their target to a commit before checkout. The preview build job
  receives no provider secrets or publishing permissions, and does not retain
  checkout credentials. API features requiring keys may be unavailable there.
- The separate deploy job uses publishing scripts from the workflow's trusted
  revision on main and preserves production files while adding `/preview/`.
- Preview settings/favourites/viewport/recovery keys are namespaced; production
  keys stay unchanged. Previews share their own settings between revisions.
- Preview builds have a visible source/commit label and omit manifest registration
  and install prompts. The production service worker bypasses preview requests.
- A tag deploy removes the preview. Run the preview workflow again to recreate it.
- No additional repository, hosting provider or cross-repository token is needed.
  The existing `github-pages` environment must allow `main` as well as release
  tags. If its rules currently allow only tags, a repository administrator must
  add `main` under Settings → Environments → github-pages.

## Verification

Run `python -m unittest discover -s scripts -p 'test_*.py'` to check archive
composition and rejection of unsafe archive entries. Build the app with
`VITE_APP_PREVIEW=true VITE_PREVIEW_LABEL='Preview · local' npm run build -- --base=/Katu-Maps/preview/`.
Check the hosted root and preview after initial deployment, verify the commit
label, asset loading, isolated favourites and lack of install prompts. Full
GitHub Pages/OIDC deployment requires a merged workflow and an activation release;
local checks cannot establish that those account settings are configured.
