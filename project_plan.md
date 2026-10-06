# Chess Tutor Project Plan

## 1. Overview

Build a desktop-first chess application whose primary purpose is to teach the user while they play. It also serves as a playable opponent and a post-game analysis tool. The initial release is a single-user desktop application with local game storage. The architecture should leave room for a hosted multi-user SaaS product later without adding cloud infrastructure to the first version.

The core teaching model combines a rules-aware game engine, chess engine analysis, and natural-language coaching:

- `python-chess` owns the authoritative board state, legal move validation, game record, and game outcome.
- Stockfish calculates candidate moves and evaluates positions.
- An OpenAI LLM turns selected engine findings and game context into verbal teaching explanations.
- The application calibrates difficulty to the user's demonstrated skill, while allowing manual adjustment.
- Voice interaction is a core product goal, supported by a graphical board and conventional controls.

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
- A mobile-first interface; desktop is the initial target because microphone and speaker use matter.

## 4. Product experience and UX

### Main play screen

- Show a clear graphical chessboard with legal-move affordances, last-move highlighting, and accessible piece contrast.
- Provide move history, game controls (new game, resign, undo if enabled, review), and a compact status area for turn, clocks if introduced, and game result.
- Include a conversation area for spoken and typed interaction, with a visible microphone state and a text transcript.
- Offer settings for opponent strength and coaching preferences without interrupting a game.

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

- Use Stockfish to select legal candidate moves and evaluate positions.
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

1. **Desktop UI** — board rendering, input, conversation, settings, and review navigation.
2. **Application/session coordinator** — sequences user actions, game events, engine requests, persistence, and tutor requests.
3. **Game rules and records (`python-chess`)** — canonical board, legal moves, PGN/FEN handling, clocks if added, and game result. No other component may mutate the canonical position.
4. **Opponent/analysis service (Stockfish)** — candidate moves, position evaluation, principal variations, and analysis metadata. Its output is advisory to the coordinator; the selected move must still be checked against the canonical legal move set.
5. **Tutor service (OpenAI LLM)** — transforms a bounded, structured context into explanation or hint language. It does not adjudicate legality, invent engine evaluations, or directly change the board.
6. **Voice adapter** — speech-to-text and text-to-speech integration, transcript/state management, interruption, and error handling. Keep this behind an interface so providers can change.
7. **Persistence (SQLite)** — stores only played games and the minimum derived information needed for skill adaptation and review.
8. **Skill model** — estimates overall and phase-specific strength from game evidence, with manual adjustment and confidence tracking.

The coordinator passes explicit, typed context between modules. Keep LLM prompts grounded in engine output and the actual game record. Do not expose arbitrary local data to the LLM.

## 7. Proposed stack

These are implementation proposals where the planning conversation did not prescribe a specific framework:

- **Language:** Python for application logic and integration with `python-chess` and Stockfish.
- **Rules and records:** `python-chess` as the authoritative game state and referee.
- **Chess engine:** Stockfish as a locally run UCI engine, with configurable search limits.
- **Desktop UI:** choose a Python desktop framework after a small interaction prototype; PySide/Qt is a reasonable candidate for a polished board, menus, and audio controls.
- **Database:** SQLite, accessed through a small repository layer and versioned migrations.
- **LLM:** OpenAI API through a tutor-service interface. Keep credentials outside the database and provide clear configuration/error handling.
- **Voice:** provider-backed speech recognition and speech synthesis behind replaceable adapters. Select exact services after validating latency, quality, privacy, and platform support.
- **Packaging:** a desktop installer/package for the target operating systems, with Stockfish distribution/licensing reviewed as part of release planning.

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

## 10. Stockfish and LLM interaction flow

### Opponent move

1. Receive a user move from UI or voice and parse it against the current legal moves.
2. Apply it through `python-chess`; update the canonical PGN and position.
3. Ask Stockfish for candidate moves/evaluation using a time or node budget appropriate to desktop responsiveness.
4. Choose an opponent move at the configured skill target. Apply deliberate strength limiting in the opponent policy, not by asking the LLM to choose a move.
5. Validate the selected move against `python-chess` legal moves and apply it through the rules layer.
6. Persist the move/game state and update skill evidence as appropriate.
7. Wait for the user to ask before providing coaching.

### On-demand explanation or hint

1. Classify the user's request into explanation, hint, position analysis, or review follow-up.
2. Collect a minimal context bundle: current FEN, relevant move history, whose move it is, skill estimate/confidence, user request, and relevant Stockfish lines/evaluations.
3. Ask Stockfish for additional analysis if current evidence is insufficient.
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

1. Desktop window with a graphical standard chessboard, move list, and basic game controls.
2. Local single-user game against Stockfish with opponent strength configured slightly above the user's initial/manual skill estimate.
3. `python-chess` authoritative rules, legal moves, game endings, and PGN export/storage.
4. SQLite persistence for played games and basic overall skill estimate.
5. Typed on-demand questions, explanations, and hints using Stockfish-backed context and the OpenAI LLM.
6. Post-game review of a small set of key tactical and strategic moments.
7. Voice input/output prototype integrated through adapter interfaces, with visible state and typed fallback. Voice remains a core goal; if provider integration delays the first playable build, keep the architecture and UX path in place and ship voice in the earliest follow-up milestone.
8. Basic settings for manual skill adjustment and explanation depth.

## 13. Milestones

### Milestone 1 — Technical and interaction prototype

- Confirm desktop framework, board interaction, Stockfish invocation, and voice-provider feasibility.
- Define the skill scale and structured interfaces for engine/tutor/voice modules.
- Validate that the target desktop environment supports the intended microphone and speaker flow.

### Milestone 2 — Reliable local chess game

- Build the board, move list, game coordinator, `python-chess` rules flow, and Stockfish opponent.
- Add game persistence and PGN round-trip.
- Handle engine unavailability and illegal/malformed input without corrupting game state.

### Milestone 3 — Tutor and review

- Add typed questions, engine-grounded explanations, graduated hints, and post-game review.
- Tune explanation depth and ensure the LLM cannot alter game state or claim unsupported calculations.

### Milestone 4 — Voice interaction

- Add speech input/output, transcripts, listening/speaking indicators, interruption, and ambiguity handling.
- Test spoken move resolution against legal moves and noisy/ambiguous input.

### Milestone 5 — Adaptive strength and refinement

- Add automatic skill updates, manual adjustment, opponent target tuning, and confidence display/handling.
- Add phase-specific estimates when sufficient evidence exists.
- Refine packaging, recovery behavior, accessibility, and onboarding.

## 14. Testing and quality plan

- **Rules integrity:** verify legal move handling, check/checkmate, stalemate, draws, resignation, PGN save/load, and recovery from invalid input.
- **Engine boundary:** verify selected Stockfish moves are legal and tied to the requested position; test timeout and process failure behavior.
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
- **Desktop packaging and Stockfish distribution add complexity:** prototype early and review platform and licensing needs before release.
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

- Target operating systems and final desktop UI framework.
- Exact speech recognition and synthesis providers, including whether local speech options are viable.
- OpenAI model/configuration and user-facing credential setup.
- Skill-estimate scale, update rules, confidence thresholds, and manual-override policy.
- Stockfish version, strength-limiting method, and per-move analysis budgets.
- Whether to support clocks, undo, custom positions, and in-progress game recovery in the MVP.
- Whether transcripts are stored; default should be ephemeral unless a concrete feature requires retention.
- Packaging, update, and engine licensing/distribution approach.
