# Bad Neighbors

Adults-only neighbor negotiations, settled by Plinko. Two modes: **Neighbor with Benefits** (requester owes a return favor; neighbor drops) and **Dispute** (two demands plus four alternative settlements).

## Run

Node 22+, no dependencies or build step:

```sh
npm start
```

Open `http://localhost:3000`. Create a board, read the six outcomes, accept the stakes, and copy the neighbor invite. Open that invite on another device or browser tab, accept, and drop. Disputes allow either participant to drop; favors allow only the invited neighbor. Each board records one result on the server, including across restarts. Both devices see approvals and results automatically.

The interface is split into focused pages: `/` chooses a mode, `/favor` and `/dispute` collect the request, `/board` reviews and approves outcomes, `/play` runs Plinko, and `/result` shows the saved settlement. Board links retain their private access token in the URL fragment. Older root-page invite links still open the review page.

## Host with Docker / Kuso

Use the included Dockerfile, container port **3000**, and your domain. Mount a persistent volume at **/app/data** so boards survive redeploys. Run one replica: storage is a small JSON file intended for hackathon traffic. No database, build command, or package installation needed.

```sh
docker build -t bad-neighbors .
docker run -d --name bad-neighbors -p 3000:3000 -v bad-neighbors-data:/app/data bad-neighbors
```

Configure HTTPS on the hosting platform for clipboard access. Invite links are private access credentials; there are no user accounts. Anyone with an owner/neighbor link can act as that participant. This is social play, not a legally enforceable settlement. Never submit secrets or sensitive personal details. Rooms persist until the host archives/deletes `rooms.json` while the service is stopped.

## DeepSeek

The app works immediately with a built-in house deck that estimates effort from the request. It is labeled **House deck**, not AI. Dispute fallback alternatives are deliberately generic and need participant review.

Set `DEEPSEEK_API_KEY` privately in Kuso's runtime environment, then redeploy. The app defaults to `https://api.deepseek.com` and `deepseek-flash`, with thinking disabled for quick board generation. No SDK or extra dependency is required. Optional overrides: `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL`.

For local development, copy `.env.example` to the ignored `.env` file, enter your key there privately, and run `npm start`. Local `.env` files load automatically; host-provided variables take precedence. The Docker image does not include `.env`; pass runtime variables through your hosting platform or Docker's `--env-file .env` option.

Edit **`prompts/board.txt`** to tune the generation voice, then restart or redeploy. `DEEPSEEK_PROMPT_FILE` can point to a different server-side prompt file. The prompt connects every option to the actual request and balances effort, cost and embarrassment. Heat selects cheeky, raunchy or foul-mouthed adult comedy. Favor outcomes explicitly name the requester as owing the return favor. In disputes, the server preserves the two original demands regardless of model output. Both participants review all six outcomes before approving.

Requests use JSON output with a 2,000-token cap and a 45-second timeout. Invalid, incomplete, duplicate-title or unavailable responses fall back to a clearly labeled house deck. The server logs a failure category without credentials or request content. A **DeepSeek generated** label appears only after a valid response. No key means the house deck is used and labeled as unconfigured.

Credentials and prompt files stay server-side. Participant names and requests are sent to DeepSeek when configured. Existing `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` variables remain supported for compatible providers; `DEEPSEEK_*` overrides them.

Provider references: [DeepSeek quick start](https://api-docs.deepseek.com/) and [JSON output](https://api-docs.deepseek.com/guides/json_mode/).

Every pocket has a 1/6 probability using Node's cryptographic RNG. The animation illustrates the recorded draw; it does not compute the outcome. No money is collected. Heat controls innuendo and costumes; sexual acts and exposure are not part of the generated obligations.

No automated tests were added, as requested. Validate through the browser at desktop and mobile sizes.
