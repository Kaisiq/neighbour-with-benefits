# Bad Neighbors

Adults-only neighbor negotiations, settled by Plinko. Two modes: **Neighbor with Benefits** (requester owes a return favor; neighbor drops) and **Dispute** (two demands plus four alternative settlements).

## Run

Node 22+, no dependencies or build step:

```sh
npm start
```

Open `http://localhost:3000`. Create a board, read the six outcomes, accept the stakes, and copy the neighbor invite. Open that invite on another device or browser tab, accept, and drop. Disputes allow either participant to drop; favors allow only the invited neighbor. Each board records one result on the server, including across restarts. Both devices see approvals and results automatically.

## Host with Docker / Kuso

Use the included Dockerfile, container port **3000**, and your domain. Mount a persistent volume at **/app/data** so boards survive redeploys. Run one replica: storage is a small JSON file intended for hackathon traffic. No database, build command, or package installation needed.

```sh
docker build -t bad-neighbors .
docker run -d --name bad-neighbors -p 3000:3000 -v bad-neighbors-data:/app/data bad-neighbors
```

Configure HTTPS on the hosting platform for clipboard access. Invite links are private access credentials; there are no user accounts. Anyone with an owner/neighbor link can act as that participant. This is social play, not a legally enforceable settlement. Never submit secrets or sensitive personal details. Rooms persist until the host archives/deletes `rooms.json` while the service is stopped.

## Optional AI

The app works immediately with a built-in house deck that estimates effort from the request. It is labeled **House deck**, not AI. Dispute fallback alternatives are deliberately generic and need participant review.

For request-specific generated options, set `LLM_BASE_URL` (ending in `/v1`, or your provider's equivalent), `LLM_API_KEY`, and `LLM_MODEL` in your host's environment. The endpoint must support `/chat/completions` and JSON response format. Credentials stay server-side. Both demands/requests and participant names are sent to that provider. Invalid or unavailable AI responses fall back to the labeled house deck. Both participants review the full generated board before approving.

For local environment variables, copy `.env.example` to `.env` and run `node --env-file=.env server.js`. `npm start` uses host-provided environment variables.

Every pocket has a 1/6 probability using Node's cryptographic RNG. The animation illustrates the recorded draw; it does not compute the outcome. No money is collected. Heat controls innuendo and costumes; sexual acts and exposure are not part of the generated obligations.

No automated tests were added, as requested. Validate through the browser at desktop and mobile sizes.
