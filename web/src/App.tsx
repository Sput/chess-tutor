import { useCallback, useEffect, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';

type MoveRecord = { ply: number; uci: string; san: string };
type SavedGame = {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'completed' | 'abandoned';
  result: string | null;
  termination: string | null;
  final_fen: string;
  move_count: number;
};
type GameSnapshot = {
  fen: string;
  game_id: number;
  turn: 'white' | 'black';
  moves: MoveRecord[];
  last_move: string | null;
  is_check: boolean;
  check_square: string | null;
  game_over: boolean;
  result: string | null;
  termination: string | null;
  opponent_engine: string;
  opponent_engine_available: boolean;
  opponent_engine_error: string | null;
  maia_elo: number;
  player_rating: number | null;
  rating_change: { before: number; after: number; delta: number; opponent_rating: number } | null;
  maia_losing_streak: number;
  move_feedback: { label: 'Mistake' | 'Blunder'; message: string } | null;
  move_analysis_notice: string | null;
  can_undo_move: boolean;
  coaching_detail: 'concise' | 'balanced' | 'detailed';
  llm_tutor_available: boolean;
  analysis_engine: string;
  analysis_engine_available: boolean;
  analysis_engine_error: string | null;
};
type AnalysisLine = { rank: number; score_cp_white: number | null; mate_white: number | null; pv_san: string[] };
type AnalysisResult = { fen: string; depth: number; lines: AnalysisLine[] };
type ReviewMoment = {
  ply: number;
  move_number: number;
  side: 'white' | 'black';
  player: 'You' | 'Maia-3';
  san: string;
  label: 'Inaccuracy' | 'Mistake' | 'Blunder';
  loss_cp: number;
  loss_capped: boolean;
  best_move_san: string | null;
  line_san: string[];
  evaluation_before_white: string;
  evaluation_after_white: string;
  fen_before: string;
  fen_after: string;
  turn_after: 'white' | 'black';
  is_check_after: boolean;
  is_checkmate_after: boolean;
  check_square_after: string | null;
};
type GameReview = {
  game_id: number;
  result: string;
  termination: string;
  moments: ReviewMoment[];
  summary: string;
  summary_mode: string;
  fallback_reason: string;
};
type CoachAction = 'hint' | 'explain_move' | 'explain_position' | 'question';
type GameSettings = { maia_elo: number; coaching_detail: GameSnapshot['coaching_detail']; player_rating: number | null };
type ChatMessage = { id: number; role: 'user' | 'coach'; text: string; offersUndo?: boolean };

const openingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? `Request failed (${response.status})`);
  return body as T;
}

export default function App() {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [ratingDraft, setRatingDraft] = useState<string | null>(null);
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [review, setReview] = useState<GameReview | null>(null);
  const [reviewingGame, setReviewingGame] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [selectedReviewPly, setSelectedReviewPly] = useState<number | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [, setMessage] = useState('Connecting to the game service…');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 0, role: 'coach', text: 'Your tutor is ready when you are. Ask for a hint or an explanation at any time.' },
  ]);
  const nextChatMessageId = useRef(1);
  const chatEndRef = useRef<HTMLDivElement>(null);

  function addChatMessage(role: ChatMessage['role'], text: string, offersUndo = false) {
    const id = nextChatMessageId.current++;
    setChatMessages((current) => [...current, { id, role, text, offersUndo }]);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, coaching]);

  const refreshGame = useCallback(async () => {
    try {
      const snapshot = await apiRequest<GameSnapshot>('/api/game');
      setGame(snapshot);
      setMessage(snapshot.opponent_engine_available
        ? 'Your tutor is ready when you are. Ask for a hint or an explanation at any time.'
        : snapshot.opponent_engine_error ?? 'Maia-3 is unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect to the game service.');
    }
  }, []);

  const refreshSavedGames = useCallback(async () => {
    try {
      const result = await apiRequest<{ games: SavedGame[] }>('/api/games');
      setSavedGames(result.games);
    } catch {
      setSavedGames([]);
    }
  }, []);

  useEffect(() => { void refreshGame(); void refreshSavedGames(); }, [refreshGame, refreshSavedGames]);

  async function submitMove(from: string, to: string, promotion?: string) {
    setBusy(true);
    setPendingPromotion(null);
    try {
      const snapshot = await apiRequest<GameSnapshot>('/api/moves', {
        method: 'POST',
        body: JSON.stringify({ from, to, promotion }),
      });
      setGame(snapshot);
      setReview(null);
      setSelectedReviewPly(null);
      if (snapshot.move_feedback) addChatMessage('coach', snapshot.move_feedback.message, snapshot.can_undo_move);
      else if (snapshot.move_analysis_notice) addChatMessage('coach', snapshot.move_analysis_notice);
      if (snapshot.rating_change) addChatMessage('coach', `Game complete: your Elo changed from ${snapshot.rating_change.before} to ${snapshot.rating_change.after} (${snapshot.rating_change.delta >= 0 ? '+' : ''}${snapshot.rating_change.delta}) against Maia at ${snapshot.rating_change.opponent_rating}.`);
      void refreshSavedGames();
      const lastTwoMoves = snapshot.moves.slice(-2).map((move) => move.san).join(' … ');
      setMessage(snapshot.game_over
        ? `Game over: ${snapshot.result} by ${snapshot.termination}.`
        : `Moves played: ${lastTwoMoves}. Ask if you’d like to discuss the position.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The move could not be sent.';
      setMessage(detail);
      addChatMessage('coach', `I couldn't finish that turn: ${detail}`);
      await refreshGame();
    } finally {
      setBusy(false);
    }
  }

  async function undoFlaggedMove() {
    if (!game?.can_undo_move || busy) return;
    setBusy(true);
    try {
      const snapshot = await apiRequest<GameSnapshot>('/api/game/undo', { method: 'POST' });
      setGame(snapshot);
      setReview(null);
      setSelectedReviewPly(null);
      setChatMessages((current) => current.map((item) => ({ ...item, offersUndo: false })));
      addChatMessage('coach', 'Move undone. You’re back in the position before that move, and it’s your turn again.');
      void refreshSavedGames();
      setMessage('Move undone. It’s your turn again.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not undo that move.';
      addChatMessage('coach', detail);
      await refreshGame();
    } finally {
      setBusy(false);
    }
  }

  function onPieceDrop({ piece, sourceSquare, targetSquare }: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }) {
    if (!targetSquare || busy || !game?.opponent_engine_available || game.turn !== 'white' || game.game_over) return false;
    if (piece.pieceType === 'wP' && targetSquare.endsWith('8')) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      return false;
    }
    void submitMove(sourceSquare, targetSquare);
    return false;
  }

  async function startNewGame() {
    setBusy(true);
    setPendingPromotion(null);
    setReview(null);
    setReviewError(null);
    setSelectedReviewPly(null);
    try {
      const snapshot = await apiRequest<GameSnapshot>('/api/game/new', { method: 'POST' });
      setGame(snapshot);
      void refreshSavedGames();
      setMessage(snapshot.opponent_engine_available
        ? 'New game started. I’ll wait for you to ask before offering coaching.'
        : snapshot.opponent_engine_error ?? 'Maia-3 is unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start a new game.');
    } finally {
      setBusy(false);
    }
  }

  async function resignGame() {
    if (!game || game.game_over || busy || !window.confirm('Resign this game? Maia-3 will be recorded as the winner.')) return;
    setBusy(true);
    try {
      const snapshot = await apiRequest<GameSnapshot>('/api/game/resign', { method: 'POST' });
      setGame(snapshot);
      if (snapshot.rating_change) addChatMessage('coach', `Game complete: your Elo changed from ${snapshot.rating_change.before} to ${snapshot.rating_change.after} (${snapshot.rating_change.delta >= 0 ? '+' : ''}${snapshot.rating_change.delta}) against Maia at ${snapshot.rating_change.opponent_rating}.`);
      setMessage('You resigned. Maia-3 wins.');
      await refreshSavedGames();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not resign this game.');
    } finally {
      setBusy(false);
    }
  }

  async function analyzePosition() {
    setAnalyzing(true);
    try {
      const result = await apiRequest<AnalysisResult>('/api/analysis', {
        method: 'POST',
        body: JSON.stringify({ multipv: 3 }),
      });
      const lines = result.lines.map((line) => {
        const score = line.mate_white !== null
          ? `mate ${line.mate_white > 0 ? '+' : ''}${line.mate_white}`
          : `${((line.score_cp_white ?? 0) / 100).toFixed(1)} pawns for White`;
        return `${line.rank}. ${line.pv_san.join(' ')} (${score})`;
      });
      setMessage(`Stockfish analysis · depth ${result.depth}\n${lines.join('\n')}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Stockfish analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function askCoach(action: CoachAction, question?: string) {
    const requestedFen = game?.fen;
    const prompts: Record<CoachAction, string> = {
      hint: 'Give me a hint',
      explain_move: 'Why did it move there?',
      explain_position: 'Explain this position',
      question: question ?? '',
    };
    addChatMessage('user', prompts[action]);
    setCoaching(true);
    try {
      const result = await apiRequest<{ action: string; reply: string; mode: string; fen: string; fallback_reason?: string }>('/api/coach', {
        method: 'POST',
        body: JSON.stringify({ action, question }),
      });
      if (result.fen !== requestedFen) {
        addChatMessage('coach', 'The position changed while I was preparing that answer. Ask again for an explanation of the current position.');
      } else {
        addChatMessage('coach', result.mode === 'engine_fallback'
          ? `${result.reply}\n\nOpenAI was unavailable${result.fallback_reason ? ` (${result.fallback_reason})` : ''}, so I used the local engine explanation.`
          : result.reply);
      }
    } catch (error) {
      addChatMessage('coach', error instanceof Error ? error.message : 'The coach could not analyze this position.');
    } finally {
      setCoaching(false);
    }
  }

  async function saveSettings(changes: Partial<GameSettings>) {
    if (!game || savingSettings) return;
    setSavingSettings(true);
    try {
      const snapshot = await apiRequest<GameSnapshot>('/api/settings', {
        method: 'POST',
        body: JSON.stringify(changes),
      });
      setGame(snapshot);
    } catch (error) {
      const problem = error instanceof Error ? error.message : 'Could not update game settings.';
      await refreshGame();
      setMessage(problem);
    } finally {
      setSavingSettings(false);
    }
  }

  async function loadSavedGame(gameId: number) {
    setBusy(true);
    setReview(null);
    setReviewError(null);
    setSelectedReviewPly(null);
    try {
      const snapshot = await apiRequest<GameSnapshot>(`/api/games/${gameId}/load`, { method: 'POST' });
      setGame(snapshot);
      setMessage(snapshot.game_over
        ? 'Saved game loaded for review. Start a new game whenever you’re ready.'
        : 'Saved game restored. It is ready to continue.');
      await refreshSavedGames();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the saved game.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewCompletedGame() {
    if (!game?.game_over || reviewingGame) return;
    setReviewingGame(true);
    setReviewError(null);
    setReview(null);
    setSelectedReviewPly(null);
    try {
      const result = await apiRequest<GameReview>(`/api/games/${game.game_id}/review`, { method: 'POST' });
      setReview(result);
      setSelectedReviewPly(result.moments[0]?.ply ?? null);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not review this game.');
    } finally {
      setReviewingGame(false);
    }
  }

  const boardPosition = game?.fen ?? openingFen;
  const selectedMoment = review?.moments.find((moment) => moment.ply === selectedReviewPly) ?? null;
  const displayedBoardPosition = review?.game_id === game?.game_id && selectedMoment
    ? selectedMoment.fen_after
    : boardPosition;
  const selectedReviewIsCurrentGame = review?.game_id === game?.game_id;
  const displayedIsCheck = selectedReviewIsCurrentGame && selectedMoment ? selectedMoment.is_check_after : Boolean(game?.is_check);
  const displayedIsCheckmate = selectedReviewIsCurrentGame && selectedMoment ? selectedMoment.is_checkmate_after : game?.termination === 'checkmate';
  const displayedTurn = selectedReviewIsCurrentGame && selectedMoment ? selectedMoment.turn_after : game?.turn;
  const displayedCheckSquare = selectedReviewIsCurrentGame && selectedMoment ? selectedMoment.check_square_after : game?.check_square ?? null;
  const checkSquareStyles = displayedCheckSquare
    ? { [displayedCheckSquare]: { backgroundColor: 'rgba(207, 67, 57, 0.78)', boxShadow: 'inset 0 0 0 4px rgba(150, 35, 30, 0.92)' } }
    : {};
  const canMove = Boolean(game?.opponent_engine_available && game.turn === 'white' && !game.game_over && !busy && !analyzing && !coaching);
  let playerStatus = game?.turn === 'white' ? 'White · Your turn' : 'White · Waiting for Maia-3';
  if (selectedReviewIsCurrentGame && selectedMoment) {
    if (selectedMoment.is_checkmate_after) {
      playerStatus = game?.result === '1-0' ? 'Review · Checkmate, you won' : 'Review · Checkmate, Maia-3 won';
    } else if (selectedMoment.is_check_after) {
      playerStatus = `Review · Check on ${selectedMoment.turn_after === 'white' ? 'your' : 'Maia-3’s'} king`;
    } else {
      playerStatus = `Review · After ${selectedMoment.move_number}${selectedMoment.side === 'white' ? '.' : '…'} ${selectedMoment.san}`;
    }
  } else if (game?.termination === 'checkmate') {
    playerStatus = game.result === '1-0' ? 'Checkmate · You won' : 'Checkmate · Maia-3 won';
  } else if (game?.game_over) {
    playerStatus = game.termination === 'resignation'
      ? game.result === '1-0' ? 'Maia-3 resigned · You win' : 'You resigned · Maia-3 wins'
      : `Game over · ${game.result}`;
  } else if (game?.is_check) {
    playerStatus = game.turn === 'white' ? 'Check · Your king is attacked' : 'Check · Maia-3 is attacked';
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Chess Tutor home"><span className="brand-mark">♞</span><span>chess<span className="brand-light">tutor</span></span></a>
        <div className="topbar-right"><span className="local-badge"><i /> Local game</span><button className="icon-button" aria-label="Settings">⚙</button><div className="avatar">P</div></div>
      </header>

      <div className="workspace">
        <section className="play-column" aria-label="Chess game">
          <div className="game-heading"><div><p className="eyebrow">PLAY & LEARN</p><h1>A thoughtful game</h1></div><div className="game-controls"><button className="resign-button" onClick={() => void resignGame()} disabled={!game || game.game_over || busy || coaching || analyzing || reviewingGame || savingSettings}>Resign</button><button className="new-game" onClick={startNewGame} disabled={busy || coaching || analyzing || reviewingGame || savingSettings}><span>＋</span> New game</button></div></div>

          <div className="board-card">
            <div className="opponent-row"><div className="player-piece engine-avatar">♟</div><div className="player-info"><strong>Maia-3</strong><span>{busy ? 'Thinking…' : 'Human-like opponent'}</span></div><span className="rating">~{game?.maia_elo ?? 1200}</span></div>
            {displayedIsCheckmate ? <div className="board-state-alert checkmate-alert" role="status"><span className="alert-symbol">♚</span><div><strong>CHECKMATE</strong><span>{game?.result === '1-0' ? 'You won the game.' : 'Maia-3 won the game.'}</span></div></div> : game?.termination === 'resignation' ? <div className="board-state-alert checkmate-alert" role="status"><span className="alert-symbol">♚</span><div><strong>{game.result === '1-0' ? 'MAIA-3 RESIGNS' : 'YOU RESIGNED'}</strong><span>{game.result === '1-0' ? 'You won the game.' : 'Maia-3 won the game.'}</span></div></div> : displayedIsCheck ? <div className="board-state-alert check-alert" role="alert"><span className="alert-symbol">!</span><div><strong>CHECK</strong><span>{displayedTurn === 'white' ? 'Your king is under attack. Find a legal response.' : 'Maia-3’s king is under attack.'}</span></div></div> : null}
            <div className="board-wrap">
              <Chessboard options={{ position: displayedBoardPosition, squareStyles: checkSquareStyles, onPieceDrop, boardOrientation: 'white', allowDragging: canMove, animationDurationInMs: 180, boardStyle: { borderRadius: '8px', boxShadow: '0 3px 18px rgba(32, 45, 39, 0.12)' }, darkSquareStyle: { backgroundColor: '#78917f' }, lightSquareStyle: { backgroundColor: '#edf0e6' }, showNotation: true }} />
              {pendingPromotion && <div className="promotion-shade" role="dialog" aria-label="Choose a promotion piece"><div className="promotion-dialog"><strong>Promote pawn to</strong><div>{[['q', '♕'], ['r', '♖'], ['b', '♗'], ['n', '♘']].map(([piece, glyph]) => <button key={piece} onClick={() => void submitMove(pendingPromotion.from, pendingPromotion.to, piece)} aria-label={`Promote to ${piece}`}>{glyph}</button>)}</div><button className="cancel-promotion" onClick={() => setPendingPromotion(null)}>Cancel</button></div></div>}
            </div>
            <div className="player-row"><div className="player-piece user-avatar">♙</div><div className="player-info"><strong>You</strong><span>{playerStatus}</span></div><span className="rating">{game?.player_rating ? game.player_rating : 'Unrated'}</span></div>
          </div>

          <div className="moves-card"><div className="section-title"><h2>Move history</h2><div className="move-actions"><button className="subtle-button" onClick={analyzePosition} disabled={!game?.analysis_engine_available || analyzing || busy || coaching || reviewingGame}>{analyzing ? 'Analyzing…' : 'Analyze position'}</button>{game?.game_over && <button className="review-button" onClick={() => void reviewCompletedGame()} disabled={!game.analysis_engine_available || reviewingGame}>{reviewingGame ? 'Reviewing game…' : 'Review game'}</button>}</div></div><div className="move-list">{game?.moves.length ? game.moves.map((move) => <span className="move-entry" key={move.ply}><span className="move-number">{move.ply % 2 === 1 ? `${Math.ceil(move.ply / 2)}.` : ''}</span><span className={`move-cell ${selectedReviewPly === move.ply ? 'current' : ''}`}>{move.san}</span></span>) : <span className="empty-moves">Moves will appear here</span>}</div></div>
          {reviewError && <div className="review-card review-error" role="alert">{reviewError}</div>}
          {review && review.game_id === game?.game_id && <section className="review-card" aria-label="Post-game review">
            <div className="review-heading"><div><p className="eyebrow">POST-GAME REVIEW</p><h2>Key moments</h2></div><button className="subtle-button" onClick={() => { setReview(null); setSelectedReviewPly(null); }}>Close</button></div>
            <p className="review-summary">{review.summary}</p>
            {review.summary_mode === 'engine_fallback' && review.fallback_reason && <p className="review-fallback">OpenAI was unavailable ({review.fallback_reason}); this summary uses the local engine review.</p>}
            <p className="review-score-note">Quick Stockfish estimates, not exact probabilities. Evaluation swings are measured from the mover’s perspective.</p>
            {review.moments.length ? <div className="review-moments">{review.moments.map((moment) => <button key={moment.ply} className={`review-moment ${selectedReviewPly === moment.ply ? 'selected' : ''}`} onClick={() => setSelectedReviewPly(moment.ply)}>
              <span className={`review-label ${moment.label.toLowerCase()}`}>{moment.label}</span><strong>{moment.move_number}{moment.side === 'white' ? '.' : '…'} {moment.san}</strong><span>{moment.player} · approx. {moment.loss_capped ? 'at least ' : ''}{(moment.loss_cp / 100).toFixed(1)} pawn swing</span>
            </button>)}</div> : <p className="review-empty">No large evaluation swings were found at this review depth.</p>}
            {selectedMoment && <div className="review-detail"><h3>{selectedMoment.player} played {selectedMoment.san}</h3><p>Stockfish’s evaluation for White changed from {selectedMoment.evaluation_before_white} to {selectedMoment.evaluation_after_white}. The best move it found was <strong>{selectedMoment.best_move_san ?? 'not available'}</strong>.</p>{selectedMoment.line_san.length > 0 && <p className="review-line">Suggested line: {selectedMoment.line_san.join(' ')}</p>}<p className="review-board-note">The board shows the position after this move.</p></div>}
          </section>}
        </section>

        <aside className="tutor-column" aria-label="Tutor panel">
          <div className="tutor-card">
            <div className="tutor-head"><div className="tutor-icon">✦</div><div><p className="eyebrow">YOUR CHESS COACH</p><h2>Ready when you are</h2></div><button className="more-button" aria-label="Tutor options">···</button></div>
            <div className="conversation">
              <div className="chat-transcript" aria-live="polite" aria-label="Conversation with your chess coach">
                {chatMessages.map((item) => <div className={`chat-message ${item.role === 'user' ? 'user-chat-message' : 'coach-message'}`} key={item.id}>
                  {item.role === 'coach' && <span className="coach-avatar">♞</span>}
                  <div className="message-content"><div className="message-meta">{item.role === 'user' ? 'You' : 'Coach'}</div><p>{item.text}</p>{item.offersUndo && game?.can_undo_move && <button className="undo-move-button" onClick={() => void undoFlaggedMove()} disabled={busy} aria-label="Undo the flagged move">↶ Undo move</button>}</div>
                  {item.role === 'user' && <span className="user-chat-avatar">P</span>}
                </div>)}
                {coaching && <div className="chat-message coach-message"><span className="coach-avatar">♞</span><div className="message-content"><div className="message-meta">Coach</div><p>Thinking…</p></div></div>}
                <div ref={chatEndRef} />
              </div>
              <div className="suggestion-label">TRY ASKING</div>
              <div className="suggestions"><button onClick={() => void askCoach('hint')} disabled={coaching || !game?.analysis_engine_available}>{coaching ? 'Thinking…' : 'Give me a hint'} <span>↗</span></button><button onClick={() => void askCoach('explain_move')} disabled={coaching || !game?.analysis_engine_available || !game.moves.length}>Why did it move there? <span>↗</span></button><button onClick={() => void askCoach('explain_position')} disabled={coaching || !game?.analysis_engine_available}>Explain this position <span>↗</span></button></div>
            </div>
            <form className="composer" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const input = new FormData(form).get('question')?.toString().trim(); if (input) { void askCoach('question', input); form.reset(); } }}>
              <input name="question" aria-label="Ask your chess coach" placeholder="Ask your coach anything…" disabled={coaching} />
              <button type="button" className="mic-button" aria-label="Voice input" disabled title="Voice input is planned for a later milestone">◉</button><button type="submit" className="send-button" aria-label="Send question" disabled={coaching || !game?.analysis_engine_available}>↑</button>
            </form>
            <p className="coach-note"><span>✦</span> {game?.llm_tutor_available ? 'Your question and current game context go to OpenAI when you ask.' : 'Local engine coaching · set OPENAI_API_KEY for natural-language answers.'}</p>
          </div>
          <div className="session-card"><div className="section-title"><h2>Game settings</h2><span className="settings-feedback" aria-live="polite">{savingSettings ? 'Saving…' : 'Applies immediately'}</span></div><label className="setting-line"><span>Opponent strength</span><select className="setting-select" aria-label="Opponent strength" value={game?.maia_elo ?? 1200} onChange={(event) => void saveSettings({ maia_elo: Number(event.target.value) })} disabled={!game || !game.opponent_engine_available || savingSettings}>{Array.from({ length: 29 }, (_, index) => 400 + index * 50).map((elo) => <option key={elo} value={elo}>{({400: 'Pawn Pusher', 450: 'Opening Apprentice', 500: 'Castle Cadet', 550: 'Knight in Training', 600: 'Novice', 650: 'Tactics Trainee', 700: 'Bishop’s Buddy', 750: 'Rook Rookie', 800: 'Beginner', 850: 'Endgame Explorer', 900: 'Fork Finder', 950: 'Board Navigator', 1000: 'Casual', 1050: 'Combo Seeker', 1100: 'Pin Practitioner', 1150: 'Position Builder', 1200: 'Learning', 1250: 'Tempo Keeper', 1300: 'Tactical Scout', 1350: 'Plan Maker', 1400: 'Club', 1450: 'Combination Crafter', 1500: 'File Commander', 1550: 'Positional Player', 1600: 'Advanced', 1650: 'King’s Strategist', 1700: 'Tactic Maestro', 1750: 'Board Virtuoso', 1800: 'Expert'} as Record<number, string>)[elo]} · {elo}</option>)}</select></label><label className="setting-line"><span>Your rating</span><input className="setting-select" type="number" min={100} max={3000} step={1} aria-label="Your player rating" placeholder="Enter rating" value={ratingDraft ?? (game?.player_rating == null ? '' : String(game.player_rating))} onChange={(event) => setRatingDraft(event.target.value)} disabled={!game || savingSettings} /></label><div className="rating-actions"><button className="subtle-button" onClick={() => { const parsed = ratingDraft === null ? game?.player_rating : Number(ratingDraft); if (parsed == null || !Number.isInteger(parsed) || parsed < 100 || parsed > 3000) return; void saveSettings({ player_rating: parsed }); setRatingDraft(null); }} disabled={!game || savingSettings || ratingDraft === null}>Update rating</button><span className="settings-feedback">Starting rating · updates after each game</span></div><label className="setting-line"><span>Coaching detail</span><select className="setting-select" aria-label="Coaching detail" value={game?.coaching_detail ?? 'balanced'} onChange={(event) => void saveSettings({ coaching_detail: event.target.value as GameSettings['coaching_detail'] })} disabled={!game || savingSettings}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label></div>
          <div className="session-card saved-games-card"><div className="section-title"><h2>Saved games</h2><button className="subtle-button" onClick={() => void refreshSavedGames()}>Refresh</button></div><label className="saved-game-select-label"><span>Load or resume a game</span><select className="setting-select saved-game-select" aria-label="Load or resume a saved game" value={game ? String(game.game_id) : ''} onChange={(event) => { const id = Number(event.target.value); if (id) void loadSavedGame(id); }} disabled={!savedGames.length || busy || reviewingGame}><option value="" disabled>{savedGames.length ? 'Choose a saved game…' : 'No saved games yet'}</option>{savedGames.map((saved) => <option key={saved.id} value={saved.id}>{new Date(saved.started_at).toLocaleString()} · {saved.status === 'completed' ? saved.result : saved.status === 'abandoned' ? 'unfinished' : 'in progress'} · {saved.move_count} plies</option>)}</select></label><a className="pgn-download" href={game ? `/api/games/${game.game_id}/pgn` : undefined} download={game ? `chess-tutor-game-${game.game_id}.pgn` : undefined} aria-disabled={!game}>Download current game as PGN ↓</a></div>
          <div className="status-line"><span className={`status-dot ${game?.opponent_engine_available ? '' : 'status-dot-off'}`} />{savingSettings ? 'Updating settings' : game?.opponent_engine_available ? busy ? 'Maia-3 is thinking' : game.analysis_engine_available ? `Python rules · Maia-3 opponent · Stockfish analysis · ${game.llm_tutor_available ? 'OpenAI tutor' : 'local tutor'}` : 'Maia-3 opponent · Stockfish unavailable' : game?.opponent_engine_error ?? 'Connecting to game service'}<span className="status-help" title={game?.analysis_engine_error ?? 'Python rules validate moves; Maia-3 plays; Stockfish analyzes; OpenAI turns analysis into explanations when configured.'}>ⓘ</span></div>
        </aside>
      </div>
    </main>
  );
}
