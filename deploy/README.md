# This deployment

OpenBot's app, built from this fork, served by the stock OpenBot image, in front of a small
gateway to a 9router (OpenAI-compatible) endpoint.

## Why a fork

The models are named as the router names them (`cx/gpt-6-luna`). OpenBot's server reads thinking
levels from models.dev for the providers it names — `openai`, `anthropic`, `google`, `xai` — and a
model behind a custom `OPENAI_BASE_URL` resolves to `gateway`, which is in no such section. So the
composer's thinking column is always empty for these models, and the server drops an effort it
cannot check. The app therefore carries `GatewayThinking`, one control in the composer, and the
level it sets is applied by the gateway on the way to the router.

## What is here

| Path | What it is |
| --- | --- |
| `app/src/components/channels/composer/gateway-thinking.tsx` | The Thinking control in the composer. Reads and writes `GET`/`POST /effort` on the gateway. |
| `deploy/openbot-gateway.js` | The gateway: forwards `/v1/*` to the router, adding `reasoning.effort` to every model call; holds the level. |
| `deploy/run-openbot.sh` | Runs the pinned OpenBot image with this deployment's app dist and the gateway. |

## Build and deploy

The app is built where `bun` runs, on a machine with room for `node_modules`:

```sh
bun install                      # in this checkout, at the root
cd app && bun run build          # writes app/dist
```

Copy `app/dist` to the server as the app the image serves, then restart the container so the
server reads the new file names — it resolves the app at start-up and a replaced dist on its own
answers 404:

```sh
rsync -a app/dist/ root@sabaraya-server:/root/openbot/app-dist/
ssh root@sabaraya-server /root/openbot/run.sh
```

`APP_DIST_DIR=/app/app-dist` and the read-only bind mount in `deploy/run-openbot.sh` are what make
the built app the one the container serves.

The image is pinned by digest because the app is built from the same commit: a moving `:latest`
could change the API under a dist that no longer matches it.
