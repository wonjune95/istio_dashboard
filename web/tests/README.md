# Cluster selection regression checks

Start the frontend with `npm run dev`, install Chromium with `npx playwright install chromium` if needed, and run `npm run test:cluster-selection` from `web`.

The checks replace API responses with fixtures. They verify that a removed cluster selection recovers before capabilities requests, login still works, valid registrations retain their selection, and connection or list failures offer recovery. No Kubernetes API or actual login credentials are used.

Set `ISTIO_DASHBOARD_TEST_URL` to change the frontend URL. Set `ISTIO_DASHBOARD_CHROMIUM_PATH` to use an existing Chromium executable.
