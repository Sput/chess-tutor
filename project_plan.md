# Chess Tutor Project Plan

## 1. Overview

Build a browser-based chess application whose primary purpose is to teach the user while they play. It also serves as a playable opponent and a post-game analysis tool. The initial release is a single-user application with local game storage. The architecture should leave room for a hosted multi-user SaaS product later without requiring cloud infrastructure for the first version.

The core teaching model combines a rules-aware game engine, chess engine analysis, and natural-language coaching:

- `python-chess` owns the authoritative board state, legal move validation, game record, and game outcome.
- Maia-3 selects human-like opponent moves at a configured skill target.
- Stockfish calculates candidate moves and evaluates positions for requested analysis and review.
- An OpenAI LLM turns selected engine findings and game context into verbal teaching explanations.
- The application calibrates difficulty to the user's demonstrated skill, while allowing manual adjustment.
- Voice interaction is a core product goal, supported by a graphical board and conventional controls.

## Implementation status and handoff — 2026-10-16

### Implemented

- Browser UI built with React, TypeScript, Vite, and `react-chessboard`; the board and menus are interactive.
- FastAPI service with `python-chess` as the authoritative rules and board-state layer.
- Maia-3 is used for opponent moves; Stockfish is used for analysis and coaching context.
- Basic game controls, move history, opponent-strength setting, and coaching-detail setting are wired to the API.
- Player Elo is saved in SQLite, starts at 500 unless entered manually, and updates after completed games using the standard Elo formula (K=32) against Maia's configured level. New games default Maia to the nearest 50-point level below the player's rating (bounded by Maia's 400–1800 range); the manual opponent-strength control remains available during a game.
- Player resignation is available during an active game and persists the result and resignation termination to SQLite and PGN.
- Maia-3 automatically resigns after Stockfish evaluates it at −10.0 pawns or worse for three consecutive player turns; the losing streak is persisted with the game.
- Stockfish flags player moves that lose at least 1.0 pawn as mistakes and at least 2.0 pawns as blunders, with the preferred move, principal line, and evaluation swing shown in the coach conversation.
- On-demand hints, position explanations, and explanations of Maia's moves use Stockfish findings. An optional OpenAI Responses API tutor adds natural-language coaching; the local fallback remains available when the API key is not configured. The LLM cannot change the board.
- **Live coaching verified:** the chat shows user questions and coach replies, scrolls through the conversation, and GPT-6 Luna with medium reasoning is responding as expected.
- SQLite persistence has been implemented for games, moves, and user settings. Games are autosaved, the latest active game is restored on service startup, unfinished games are archived when a new game starts, saved games can be loaded, and games can be downloaded as PGN.
- **Persistence complete:** manual checks have passed, including saved-game loading after a server restart.
- The Vite development proxy defaults to API port `8001`; `CHESS_TUTOR_API_URL` can override the API address.

### Not yet verified or still to build

- Post-game review of key moments is implemented and manually verified. Manual opponent-strength control is implemented from 400 to 1800 Elo in 50-point steps; the newly added lower settings, automatic resignation, and move-quality feedback need playtesting. Automatic skill estimation is not implemented yet.
- Voice work is deferred because this computer has no audio hardware; revisit it on an audio-capable computer.
- The quality checks listed in §14 remain to be run.

### Resume here

1. **Complete:** Add manual opponent-strength control using 50-point Elo steps from 400 through 1800. Maia-3 accepts an integer Elo input and interpolates the skill conditioning continuously; lower settings are exploratory and need playtesting.
2. Resume voice work on an audio-capable computer when available.
3. Implement automatic skill estimation and phase-specific estimates as a later refinement.

## 2. Goals

- Make it easy to play a complete game against an opponent that is slightly better than the user.
- Teach on demand, at a level appropriate to the user's current ability.
- Explain the opponent's moves when asked and provide hints when requested.
- Offer a useful post-game review of tactical and strategic decisions.
- Track skill automatically and allow the user to adjust the estimated skill manually.
- If practical, maintain separate skill estimates for opening, middlegame, and endgame.
- Store played games locally in SQLite; do not require a cloud database.
- Make spoken interaction with the tutor a first-class part of the experience.

## 3. Non-goals for the initial release

- A fixed lesson sequence or prescribed curriculum.
- Multiplayer, accounts, social features, or cloud synchronization.
- A cloud database or server-dependent game session.
- Replacing engine calculation with LLM-generated chess judgments.
- Storing unrelated personal data or collecting a broad behavioral profile.
- A mobile-first interface; the initial browser experience targets desktop-sized screens while remaining usable across platforms.

## 4. Product experience and UX

### Main play screen

- Show a clear graphical chessboard with legal-move affordances, last-move highlighting, and accessible piece contrast.
- Provide move history, game controls (new game, resign, undo if enabled, review), and a compact status area for turn, clocks if introduced, and game result.
- Include a conversation area for spoken and typed interaction, with a visible microphone state and a text transcript.
- Offer settings for opponent strength and coaching preferences without interrupting a game.
- Provide manual Maia strength control from 400 to 1800 Elo in 50-point steps.

### Coaching behavior

- Coaching waits until the user asks. Do not interrupt normal play with unsolicited lessons or analysis.
- Support explicit requests such as “Why did it move there?”, “Give me a hint,” and “Explain this position.”
- Explain an opponent move when asked, separating what the engine indicates from the teaching explanation.
- Hints should be graduated: begin with a concept or candidate area, then become more concrete if requested. Avoid revealing the best move immediately unless the user asks.
- Match vocabulary and depth to the user's skill estimate and the user's selected preference.
- After the game, offer a review of key moments, tactics, strategic plans, and recurring patterns. Keep review navigable by move and board position.

### Voice interaction

- Treat voice as a core interaction path, not an optional add-on.
- Allow spoken questions and spoken answers, with text input/output as a reliable fallback.
- Show whether the app is listening, processing, or speaking; provide a clear way to stop playback and correct a misheard request.
- Keep spoken explanations concise by default and allow follow-up questions for detail.

## 5. Functional requirements

### Game play

- Start, play, and finish standard chess games against the local opponent.
- Enforce all legal-move rules and game-ending conditions through `python-chess`.
- Save completed and in-progress played games locally, subject to a clear persistence policy.
- Provide a graphical board and move list; support keyboard/mouse interaction alongside voice.

### Opponent

- Use Maia-3 to choose human-like opponent moves; use Stockfish for position evaluation and principal variations.
- Configure the opponent to play slightly better than the user's current estimated level rather than always choosing the engine's strongest move.
- Make the difficulty adjustment bounded and predictable, and allow manual override.
- Preserve legal play even when analysis, LLM, or voice services fail.

### Tutor and review

- Respond to on-demand questions about moves, plans, threats, tactics, and strategic concepts.
- Offer hints only on request.
- Explain opponent moves on request.
- Generate post-game review using engine-backed evidence, covering both tactical and strategic concepts.
- Do not follow a fixed curriculum; adapt explanations to current position, user request, and observed skill.

### Skill tracking

- Automatically update a skill estimate from played games and observed decisions, using engine evaluation as evidence.
- Permit manual adjustment and make the current estimate visible/editable.
- Where supported by sufficient data, track opening, middlegame, and endgame separately.
- Avoid presenting a small sample as a precise rating. Track confidence or sample size internally and communicate uncertainty plainly.

## 6. Architecture and responsibility boundaries

Use separable modules so that game correctness remains independent from teaching services.

1. **Web UI** — browser-based board rendering, input, conversation, settings, and review navigation.
2. **Application/session coordinator** — sequences user actions, game events, engine requests, persistence, and tutor requests.
3. **Game rules and records (`python-chess`)** — canonical board, legal moves, PGN/FEN handling, clocks if added, and game result. No other component may mutate the canonical position.
4. **Opponent service (Maia-3)** — human-like move predictions at a configurable Elo target through UCI. Its output is advisory; the selected move must still be checked against the canonical legal move set.
5. **Analysis service (Stockfish)** — position evaluation, candidate lines, and analysis metadata for on-demand explanations and review. Its output is advisory and tied to the position being analyzed.
6. **Tutor service (OpenAI LLM)** — transforms a bounded, structured context into explanation or hint language. It does not adjudicate legality, invent engine evaluations, or directly change the board.
7. **Voice adapter** — speech-to-text and text-to-speech integration, transcript/state management, interruption, and error handling. Keep this behind an interface so providers can change.
8. **Persistence (SQLite)** — stores only played games and the minimum derived information needed for skill adaptation and review.
9. **Skill model** — estimates overall and phase-specific strength from game evidence, with manual adjustment and confidence tracking.

The coordinator passes explicit, typed context between modules. Keep LLM prompts grounded in engine output and the actual game record. Do not expose arbitrary local data to the LLM.

## 7. Proposed stack

These are implementation proposals where the planning conversation did not prescribe a specific framework:

- **Language:** Python for application logic and integration with `python-chess`, Maia-3, and Stockfish.
- **Rules and records:** `python-chess` as the authoritative game state and referee.
- **Opponent engine:** Maia-3 as a UCI engine using its human move predictions and Elo input; begin with its 5M CPU model.
- **Analysis engine:** Stockfish as a locally run UCI engine with configurable search limits, used for analysis and review rather than opponent moves.
- **Web UI:** React and TypeScript in a modern browser, using the MIT-licensed `react-chessboard` component for board rendering and interaction. The UI communicates with a Python service through a typed API; keep local versus hosted deployment open until the first prototype clarifies the tradeoffs.
- **Database:** SQLite, accessed through a small repository layer and versioned migrations.
- **LLM:** OpenAI API through a tutor-service interface. Keep credentials outside the database and provide clear configuration/error handling.
- **Voice:** provider-backed speech recognition and speech synthesis behind replaceable adapters. Select exact services after validating latency, quality, privacy, and platform support.
- **Packaging:** initially serve the web UI through the chosen local or hosted Python service. Review platform and engine packaging needs before release.

## 8. Data model and proposed SQLite schema

Persist only games played and the data needed to restore, review, and learn from those games. Do not persist unrelated voice recordings by default. Store transcripts only if they are necessary for a requested feature and the user has a clear setting for that behavior.

### `games`

- `id` — primary key (UUID or integer).
- `started_at`, `ended_at` — timestamps.
- `result` — white win, black win, draw, resignation, or other canonical outcome.
- `termination` — checkmate, resignation, draw agreement, timeout, etc.
- `user_color` — white or black.
- `opponent_profile` — local opponent configuration/version used for the game.
- `initial_fen` — nullable; supports nonstandard starts if later enabled.
- `pgn` — canonical portable game record.
- `final_fen` — final board position.
- `created_at`, `updated_at` — persistence metadata.

### `game_moves`

Optional normalized move table for efficient review and analysis; the PGN remains the canonical portable record.

- `game_id` — foreign key to `games`.
- `ply` — move index, unique within game.
- `uci`, `san`, `fen_after` — move and resulting position.
- `clock_ms` — nullable if clocks are introduced.
- `user_move` — whether the user made the move.
- `engine_eval_cp` and `engine_mate` — nullable engine evidence, with score perspective documented.
- `best_line_uci` — nullable principal variation for review.
- Primary key: (`game_id`, `ply`).

### `skill_estimates`

- `scope` — `overall`, `opening`, `middlegame`, or `endgame`.
- `estimate` — internal scalar or rating-like estimate; define its scale before implementation.
- `confidence` — uncertainty or evidence strength.
- `games_count` — evidence count used for this estimate.
- `updated_at` — latest update time.
- Primary key: `scope`.

### `user_settings`

Although settings need not contain sensitive information, store only what is needed for local behavior:

- `key`, `value`, `updated_at`.
- Include manual skill override, preferred explanation depth, voice settings, and opponent adjustment where useful.
- Do not store API secrets here; use the operating system's secure credential storage.

Add database schema versioning and migrations from the first persisted release. Keep derived evaluations distinguishable from source game moves so they can be regenerated.

## 9. Adaptive skill model

Start with an explainable model rather than a complex hidden rating system.

- Maintain an overall estimate and, if enough evidence exists, phase estimates for opening, middlegame, and endgame.
- Use game outcomes, move quality signals (such as engine evaluation loss), and position phase as evidence. Do not treat a single blunder or result as a stable measure of ability.
- Weight observations conservatively and track confidence/sample size.
- Provide a manual control that can seed or override the estimate. Keep automatic observations able to refine the estimate according to a clearly defined policy.
- Select explanations by combining estimated skill, confidence, and the user's stated preference. When uncertain, use accessible language and offer more detail on request.
- Set the opponent target modestly above the estimate, with a configurable cap/floor and manual override. Validate through playtesting that it feels challenging without being punitive.
- Do not label phase-specific skill as reliable until enough relevant positions have been observed; fall back to the overall estimate.

The scale, update equations, confidence thresholds, and behavior for manual override remain implementation decisions to settle with empirical playtesting.

## 10. Maia-3, Stockfish, and LLM interaction flow

### Opponent move

1. Receive a user move from UI or voice and parse it against the current legal moves.
2. Apply it through `python-chess`; update the canonical PGN and position.
3. Ask Maia-3 for a human-like move at the configured Elo using its UCI interface and one-node inference.
4. Validate the selected move against `python-chess` legal moves and apply it through the rules layer.
6. Persist the move/game state and update skill evidence as appropriate.
7. Wait for the user to ask before providing coaching.

### On-demand explanation or hint

1. Classify the user's request into explanation, hint, position analysis, or review follow-up.
2. Collect a minimal context bundle: current FEN, relevant move history, whose move it is, skill estimate/confidence, user request, and relevant Stockfish lines/evaluations.
3. Ask Stockfish for additional analysis if current evidence is insufficient; do not treat Maia-3's human-game WDL or compatibility score as a search evaluation.
4. Prompt the LLM to explain the supplied evidence in the requested depth. Require it to distinguish a concrete engine-backed threat/line from a general strategic idea and avoid unsupported certainty.
5. For hints, progressively reveal information and do not provide the complete move unless the user asks.
6. Return text to the conversation UI and optionally speak it through the voice adapter.

LLM failures must not interrupt a game. Engine data should be checked for freshness and tied to a specific position hash/FEN so explanations cannot accidentally refer to a later position.

## 11. Voice interaction flow

1. The user activates push-to-talk or an explicit listening mode; show a visible listening indicator.
2. Capture speech and pass it to speech recognition; retain the transcript for immediate request handling.
3. Confirm or clarify ambiguous move notation before changing the board. Any spoken chess move must be resolved against legal moves in the current position.
4. Route a question to the tutor flow, or a move command to the game coordinator.
5. Generate a text response first, then send it to speech synthesis if enabled.
6. Allow interruption/stop, display the response transcript, and provide a text alternative when voice services fail.

Do not rely on speech recognition alone to mutate the board. `python-chess` remains the final legality check. Provide controls and settings for microphone access and speech behavior; default to not retaining raw audio.

## 12. MVP scope

1. Browser-based interface with a graphical standard chessboard, move list, and basic game controls.
2. Local single-user game against Maia-3 with opponent strength configured near the user's initial/manual skill estimate.
3. `python-chess` authoritative rules, legal moves, game endings, and PGN export/storage.
4. SQLite persistence for played games and basic overall skill estimate.
5. Typed on-demand questions, explanations, and hints using Stockfish-backed context and the OpenAI LLM.
6. Post-game review of a small set of key tactical and strategic moments.
7. Voice input/output prototype integrated through adapter interfaces, with visible state and typed fallback. Voice remains a core goal; if provider integration delays the first playable build, keep the architecture and UX path in place and ship voice in the earliest follow-up milestone.
8. Basic settings for manual skill adjustment and explanation depth.

## 13. Milestones

### Milestone 1 — Technical and interaction prototype

- **Status: Core browser and engine integration implemented; voice feasibility remains open.**
- Confirm the web frontend, board interaction, Maia-3 opponent, Stockfish analysis service, and voice-provider feasibility.
- Define the skill scale and structured interfaces for engine/tutor/voice modules.
- Validate browser microphone and speaker support for the intended voice flow.

### Milestone 2 — Reliable local chess game

- **Status: Complete for the current local-game scope; persistence behavior has been manually checked and accepted.**
- Build the board, move list, game coordinator, `python-chess` rules flow, Maia-3 opponent, and Stockfish analysis service.
- Add game persistence and PGN round-trip.
- Handle engine unavailability and illegal/malformed input without corrupting game state.

### Milestone 3 — Tutor and review

- **Status: On-demand coaching, live GPT-6 Luna integration, conversation UI, and Stockfish-grounded post-game review are implemented and manually verified.**
- Add typed questions, engine-grounded explanations, graduated hints, and post-game review.
- Tune explanation depth and ensure the LLM cannot alter game state or claim unsupported calculations.

### Milestone 4 — Voice interaction

- **Status: Deferred until work resumes on a computer with audio hardware.**
- Add speech input/output, transcripts, listening/speaking indicators, interruption, and ambiguity handling.
- Test spoken move resolution against legal moves and noisy/ambiguous input.

### Milestone 5 — Adaptive strength and refinement

- **Status: Manual opponent-strength adjustment is implemented in 50-point steps from 400 to 1800 Elo. Automatic skill updates and phase estimates remain later work.**
- Add automatic skill updates, manual adjustment, opponent target tuning, and confidence display/handling.
- Add phase-specific estimates when sufficient evidence exists.
- Refine packaging, recovery behavior, accessibility, and onboarding.

## 14. Testing and quality plan

- **Rules integrity:** verify legal move handling, check/checkmate, stalemate, draws, resignation, PGN save/load, and recovery from invalid input.
- **Engine boundary:** verify Maia-3 moves are legal and tied to the requested position; verify Stockfish analysis is tied to the requested position; test timeout and process failure behavior.
- **Tutor grounding:** use representative positions to check that explanations reflect supplied engine lines, are understandable at varied skill levels, and do not invent certainty. Test graduated hints and “explain opponent move” requests.
- **Skill adaptation:** simulate varied game outcomes and move-quality evidence; check bounds, manual adjustment, confidence behavior, and phase fallback.
- **Persistence:** test schema migrations, game round-trip, interrupted sessions, and database recovery behavior.
- **Voice:** test clear/noisy speech, ambiguous moves, correction, interruption, provider errors, and text fallback.
- **UX/accessibility:** check board legibility, keyboard/mouse use, visible voice states, and no unsolicited coaching during normal play.
- **End-to-end play:** complete representative games and review them from stored records.

## 15. Risks and mitigations

- **LLM gives incorrect chess explanations:** ground prompts in Stockfish evidence, label uncertainty, keep the engine/rules authoritative, and evaluate with known positions.
- **Engine strength is frustrating or inconsistent:** begin with bounded opponent settings, tune against real play, and expose manual controls.
- **Skill estimates overreact to limited data:** track confidence/sample size, damp updates, and fall back to the overall estimate.
- **Voice misrecognizes a move:** confirm ambiguity and validate every move through legal moves before application.
- **Voice or LLM service is unavailable:** keep the game playable and provide typed/local fallbacks where possible.
- **Engine packaging and distribution add complexity:** keep Maia-3 and Stockfish behind separate UCI adapters and review platform needs before release.
- **External service privacy and cost:** minimize sent context, avoid raw-audio retention by default, disclose when cloud services are used, and allow voice/tutor features to fail independently of local play.
- **Engine analysis adds latency:** use bounded searches, cache by position, and provide responsive progress/status feedback.

## 16. Future SaaS considerations

Keep the initial app local and single-user. If a SaaS version is pursued later:

- Add explicit accounts, authentication, authorization, and per-user data isolation.
- Define consent, retention, deletion, export, and privacy policies before syncing games or transcripts.
- Introduce a server API and cloud database only when multi-device sync or hosted features require them.
- Move secrets and provider calls to a secure service boundary where appropriate; protect against abuse and manage API cost.
- Revisit engine execution capacity, concurrency, rate limits, observability, backups, and service availability.
- Add schema migration and synchronization conflict policies for local/offline games.
- Preserve a local-play path where practical and make cloud-dependent capabilities clear.

These are future design considerations, not requirements for the MVP.

## 17. Decisions to resolve during implementation

- Local-service versus hosted deployment for the initial web application.
- Exact speech recognition and synthesis providers, including whether local speech options are viable.
- OpenAI model/configuration and user-facing credential setup.
- Skill-estimate scale, update rules, confidence thresholds, and manual-override policy.
- Maia-3 model/Elo configuration and Stockfish version and analysis budgets.
- Whether to support clocks, undo, custom positions, and in-progress game recovery in the MVP.
- Whether transcripts are stored; default should be ephemeral unless a concrete feature requires retention.
- Packaging, update, and engine licensing/distribution approach.
