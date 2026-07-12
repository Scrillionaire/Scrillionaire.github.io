# Scrillionaire web

Static web and associated-domain source for `scrillionaire.ai`.

GitHub Pages serves the public fallback for Scrillionaire links. The native iOS app and this site
share these canonical routes:

- `/u/{handle}`
- `/groups/new`
- `/groups/{groupId}`
- `/invite/{token}`

The AASA source is `site/.well-known/apple-app-site-association`. The Pages workflow intentionally
builds its own artifact because `actions/upload-pages-artifact@v4` excludes dot-directories and would
otherwise omit `.well-known`.

After deployment, the workflow validates AASA at the exact URL returned by `deploy-pages`. This
checks the default organization Pages domain during bootstrap and automatically checks
`scrillionaire.ai` after GitHub attaches the custom domain.
