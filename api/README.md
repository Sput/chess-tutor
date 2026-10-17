# Local chess service

The Python service owns the canonical chess position. It accepts a player's move, validates it with `python-chess`, asks Maia-3 for a human-like reply, and returns the updated FEN and SAN move list. Stockfish is a separate analysis engine used only when the user requests an analysis.

## Requirements

- Python 3.10 or newer
- Maia-3 installed in the API environment
- Stockfish available on `PATH`, or `STOCKFISH_EXECUTABLE` set to its UCI binary

## Run

From the repository root:

```sh
cd api
uv sync
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

In another terminal:

```sh
cd web
npm run dev
```

Open http://127.0.0.1:5173. The Vite development server forwards `/api` requests to the Python service on port 8001. To use a different API address, set `CHESS_TUTOR_API_URL` before starting Vite.

Maia-3's 5M CPU model downloads from Hugging Face the first time the engine is used. To download it before starting a game, run `uv run maia3-cache --model maia3-5m` from `api/`.

Optional environment settings:

- `MAIA_EXECUTABLE`: override the Maia-3 UCI command
- `MAIA_MODEL`: Maia-3 model alias (default `maia3-5m`)
- `MAIA_ELO`: opponent Elo input sent to Maia-3 (default `1200`)
- `MAIA_DEVICE`: inference device (default `cpu`)
- `STOCKFISH_EXECUTABLE`: path to Stockfish if it is not on `PATH`
- `STOCKFISH_ANALYSIS_TIME`: Stockfish analysis time in seconds (default `1.0`)
- `STOCKFISH_RESIGN_TIME`: Stockfish time per position when checking Maia's resignation threshold and player move quality (default `0.3` seconds)
- `STOCKFISH_REVIEW_TIME`: Stockfish time per position in a post-game review (default `0.2` seconds)
- `STOCKFISH_THREADS`: engine worker threads (default `2`)
- `STOCKFISH_HASH_MB`: Stockfish hash size in MB (default `128`)
- `OPENAI_API_KEY`: enables natural-language coaching through OpenAI's Responses API
- `CHESS_TUTOR_DB_PATH`: SQLite file location (default `api/.data/chess_tutor.sqlite3`)

The service keeps the current board in memory and saves it to SQLite after each completed turn. On API restart, the most recent active game is restored. Starting a new game archives the unfinished one so it can be resumed later. The database includes versioned schema migrations and is ignored by Git.

## On-demand coaching

The coach uses Stockfish analysis for hints, explanations of Maia's latest move, and position summaries. When `OPENAI_API_KEY` is configured, a natural-language tutor uses OpenAI's Responses API to answer the player's question using the current FEN, recent SAN move history, coaching detail setting, and Stockfish findings. It cannot change the board or make engine claims beyond the supplied analysis. The API request sets `store` to `false`.

The question and game context are sent to OpenAI only when the player asks for coaching. The tutor uses GPT-6 Luna with medium reasoning effort. Without an API key, the app uses its local engine-backed explanations. If the OpenAI call fails, it returns the same local explanation as a fallback and displays the request failure reason in the chat. To enable the tutor, export the key in the terminal before starting the API:

```sh
export OPENAI_API_KEY="your-api-key"
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Opponent strength can be set from 400 to 1800 Elo in 50-point steps. Maia-3 accepts values in this range, though settings below its usual range may behave unpredictably. The API applies the target to Maia's UCI `Elo` option without restarting the engine. A manually entered player rating (100–3000 in 50-point steps) and coaching detail are also saved in SQLite.

The Saved games panel can restore a saved game and download it in PGN format. After a game is complete, **Review game** runs a quick Stockfish pass over each position, identifies up to six notable evaluation swings, and lets you select each move to inspect the resulting board and top engine line. If OpenAI is configured, it also writes a short teaching summary; otherwise the review shows a local summary. Review labels are estimates at the configured per-position analysis time, not exact probabilities. The API exposes `GET /api/games`, `POST /api/games/{id}/load`, `POST /api/games/{id}/review`, and `GET /api/games/{id}/pgn` for these actions.

The player can resign an active game using the **Resign** control. Resignation is saved as a completed `0-1` result with `resignation` termination in SQLite and PGN.

Maia-3 automatically resigns when Stockfish evaluates it at `-10.0` pawns or worse for three consecutive player turns. The counter is saved with the game, and the evaluation uses the configured resignation analysis time. Automatic resignation requires Stockfish to be available; without it, Maia continues playing.

After a player move, Stockfish compares the position before and after the move. It reports a **Mistake** when the evaluation drops by at least 1.0 pawn and a **Blunder** at 2.0 pawns or more, including its preferred move, principal line, and estimated evaluation swing. The app runs a 0.3-second analysis for each position by default, so this adds roughly 0.6 seconds of engine time per player turn.
