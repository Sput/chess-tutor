from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import chess
import chess.pgn


DEFAULT_DB_PATH = Path(__file__).parent / ".data" / "chess_tutor.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class GameStore:
    """SQLite storage for game records and the small set of app preferences."""

    def __init__(self, path: Optional[str] = None) -> None:
        configured = path or os.environ.get("CHESS_TUTOR_DB_PATH")
        self.path = Path(configured).expanduser() if configured else DEFAULT_DB_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def migrate(self) -> None:
        migrations = {
            1: [
                """CREATE TABLE games (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
                    result TEXT,
                    termination TEXT,
                    user_color TEXT NOT NULL,
                    initial_fen TEXT NOT NULL,
                    pgn TEXT NOT NULL,
                    final_fen TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )""",
                """CREATE TABLE game_moves (
                    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                    ply INTEGER NOT NULL,
                    uci TEXT NOT NULL,
                    san TEXT NOT NULL,
                    fen_after TEXT NOT NULL,
                    user_move INTEGER NOT NULL CHECK (user_move IN (0, 1)),
                    PRIMARY KEY (game_id, ply)
                )""",
                "CREATE INDEX games_recent_idx ON games(updated_at DESC, id DESC)",
            ],
            2: [
                """CREATE TABLE user_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )""",
            ],
            3: [
                "ALTER TABLE games ADD COLUMN maia_losing_streak INTEGER NOT NULL DEFAULT 0",
            ],
            4: [
                "ALTER TABLE games ADD COLUMN rating_applied INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE games ADD COLUMN player_rating_before INTEGER",
                "ALTER TABLE games ADD COLUMN player_rating_after INTEGER",
                "ALTER TABLE games ADD COLUMN player_rating_delta INTEGER",
                "ALTER TABLE games ADD COLUMN opponent_rating INTEGER",
            ],
        }
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            applied = {
                row[0]
                for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
            }
            for version in sorted(migrations):
                if version in applied:
                    continue
                for statement in migrations[version]:
                    connection.execute(statement)
                connection.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (version, utc_now()),
                )

    def create_game(self) -> int:
        now = utc_now()
        board = chess.Board()
        pgn = self.make_pgn(board, board.fen(), None)
        with self.connect() as connection:
            cursor = connection.execute(
                """INSERT INTO games
                   (started_at, status, user_color, initial_fen, pgn, final_fen, created_at, updated_at)
                   VALUES (?, 'active', 'white', ?, ?, ?, ?, ?)""",
                (now, board.fen(), pgn, board.fen(), now, now),
            )
            return int(cursor.lastrowid)

    @staticmethod
    def make_pgn(
        board: chess.Board,
        initial_fen: str,
        result: Optional[str],
        started_at: Optional[str] = None,
        termination: Optional[str] = None,
    ) -> str:
        root = chess.Board(initial_fen)
        record = chess.pgn.Game()
        record.headers["Event"] = "Chess Tutor Game"
        record.headers["Site"] = "Local"
        started = datetime.fromisoformat(started_at) if started_at else datetime.now(timezone.utc)
        record.headers["Date"] = started.strftime("%Y.%m.%d")
        record.headers["White"] = "You"
        record.headers["Black"] = "Maia-3"
        record.headers["Result"] = result or "*"
        if termination:
            record.headers["Termination"] = termination
        if root.fen() != chess.Board().fen():
            record.setup(root)

        node = record
        replay = root.copy()
        for move in board.move_stack:
            node = node.add_variation(move)
            replay.push(move)
        return record.accept(chess.pgn.StringExporter(headers=True, variations=False, comments=False)).strip()

    def resign_game(
        self,
        game_id: int,
        board: chess.Board,
        initial_fen: str,
        started_at: Optional[str] = None,
        result: str = "0-1",
        maia_losing_streak: int = 0,
    ) -> None:
        now = utc_now()
        pgn = self.make_pgn(board, initial_fen, result, started_at, "resignation")
        replay = chess.Board(initial_fen)
        move_rows = []
        for ply, move in enumerate(board.move_stack, start=1):
            san = replay.san(move)
            user_move = int(replay.turn == chess.WHITE)
            replay.push(move)
            move_rows.append((game_id, ply, move.uci(), san, replay.fen(), user_move))
        with self.connect() as connection:
            connection.execute(
                """UPDATE games SET ended_at = ?, status = 'completed', result = ?, termination = 'resignation',
                   pgn = ?, final_fen = ?, maia_losing_streak = ?, updated_at = ? WHERE id = ? AND status = 'active'""",
                (now, result, pgn, board.fen(), maia_losing_streak, now, game_id),
            )
            connection.execute("DELETE FROM game_moves WHERE game_id = ?", (game_id,))
            connection.executemany(
                """INSERT INTO game_moves(game_id, ply, uci, san, fen_after, user_move)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                move_rows,
            )

    def set_maia_losing_streak(self, game_id: int, streak: int) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE games SET maia_losing_streak = ?, updated_at = ? WHERE id = ? AND status = 'active'",
                (streak, utc_now(), game_id),
            )

    def save_position(
        self, game_id: int, board: chess.Board, initial_fen: str,
        started_at: Optional[str] = None, maia_losing_streak: Optional[int] = None,
    ) -> None:
        now = utc_now()
        outcome = board.outcome()
        status = "completed" if outcome else "active"
        result = outcome.result() if outcome else None
        termination = outcome.termination.name.lower() if outcome else None
        pgn = self.make_pgn(board, initial_fen, result, started_at)

        replay = chess.Board(initial_fen)
        move_rows = []
        for ply, move in enumerate(board.move_stack, start=1):
            san = replay.san(move)
            user_move = int(replay.turn == chess.WHITE)
            replay.push(move)
            move_rows.append((game_id, ply, move.uci(), san, replay.fen(), user_move))

        with self.connect() as connection:
            connection.execute(
                """UPDATE games SET ended_at = ?, status = ?, result = ?, termination = ?,
                   pgn = ?, final_fen = ?, maia_losing_streak = COALESCE(?, maia_losing_streak),
                   updated_at = ? WHERE id = ?""",
                (now if outcome else None, status, result, termination, pgn, board.fen(), maia_losing_streak, now, game_id),
            )
            connection.execute("DELETE FROM game_moves WHERE game_id = ?", (game_id,))
            connection.executemany(
                """INSERT INTO game_moves(game_id, ply, uci, san, fen_after, user_move)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                move_rows,
            )

    def abandon(self, game_id: int) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE games SET status = 'abandoned', updated_at = ? WHERE id = ? AND status = 'active'",
                (utc_now(), game_id),
            )

    def activate(self, game_id: int) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE games SET status = 'active', updated_at = ? WHERE id = ? AND status = 'abandoned'",
                (utc_now(), game_id),
            )

    def load_game(self, game_id: int) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if row is None:
                return None
            moves = connection.execute(
                "SELECT ply, uci, san, fen_after, user_move FROM game_moves WHERE game_id = ? ORDER BY ply",
                (game_id,),
            ).fetchall()
            game = dict(row)
            game["moves"] = [dict(move) for move in moves]
            return game

    def latest_active_game(self) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id FROM games WHERE status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 1"
            ).fetchone()
        return self.load_game(int(row["id"])) if row else None

    def list_games(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT g.id, g.started_at, g.ended_at, g.status, g.result, g.termination,
                          g.final_fen, COUNT(m.ply) AS move_count
                   FROM games g LEFT JOIN game_moves m ON m.game_id = g.id
                   GROUP BY g.id ORDER BY g.updated_at DESC, g.id DESC LIMIT ?""",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_pgn(self, game_id: int) -> Optional[str]:
        with self.connect() as connection:
            row = connection.execute("SELECT pgn FROM games WHERE id = ?", (game_id,)).fetchone()
            return str(row["pgn"]) if row else None

    def get_setting(self, key: str) -> Optional[str]:
        with self.connect() as connection:
            row = connection.execute("SELECT value FROM user_settings WHERE key = ?", (key,)).fetchone()
            return str(row["value"]) if row else None

    def set_settings(self, values: Dict[str, str]) -> None:
        now = utc_now()
        with self.connect() as connection:
            connection.executemany(
                """INSERT INTO user_settings(key, value, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
                [(key, value, now) for key, value in values.items()],
            )

    def apply_game_rating(self, game_id: int, opponent_rating: int, k_factor: int = 32) -> Optional[Dict[str, int]]:
        """Apply a completed game's Elo result once and persist the rating change."""
        with self.connect() as connection:
            game = connection.execute(
                "SELECT status, result, rating_applied FROM games WHERE id = ?", (game_id,)
            ).fetchone()
            if game is None or game["status"] != "completed" or game["result"] not in ("1-0", "0-1", "1/2-1/2"):
                return None
            if game["rating_applied"]:
                row = connection.execute(
                    "SELECT player_rating_before, player_rating_after, player_rating_delta, opponent_rating "
                    "FROM games WHERE id = ?", (game_id,)
                ).fetchone()
                return {
                    "before": int(row["player_rating_before"]),
                    "after": int(row["player_rating_after"]),
                    "delta": int(row["player_rating_delta"]),
                    "opponent_rating": int(row["opponent_rating"]),
                }

            setting = connection.execute(
                "SELECT value FROM user_settings WHERE key = 'player_rating'"
            ).fetchone()
            before = int(setting["value"]) if setting and setting["value"] else 500
            score = 1.0 if game["result"] == "1-0" else 0.0 if game["result"] == "0-1" else 0.5
            expected = 1.0 / (1.0 + 10.0 ** ((opponent_rating - before) / 400.0))
            after = max(100, min(3000, int(round(before + k_factor * (score - expected)))))
            delta = after - before
            now = utc_now()
            connection.execute(
                "INSERT INTO user_settings(key, value, updated_at) VALUES ('player_rating', ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (str(after), now),
            )
            connection.execute(
                """UPDATE games SET rating_applied = 1, player_rating_before = ?,
                   player_rating_after = ?, player_rating_delta = ?, opponent_rating = ?, updated_at = ?
                   WHERE id = ?""",
                (before, after, delta, opponent_rating, now, game_id),
            )
            return {"before": before, "after": after, "delta": delta, "opponent_rating": opponent_rating}

    def get_game_rating_change(self, game_id: int) -> Optional[Dict[str, int]]:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT player_rating_before, player_rating_after, player_rating_delta, opponent_rating
                   FROM games WHERE id = ? AND rating_applied = 1""",
                (game_id,),
            ).fetchone()
            if row is None:
                return None
            return {
                "before": int(row["player_rating_before"]),
                "after": int(row["player_rating_after"]),
                "delta": int(row["player_rating_delta"]),
                "opponent_rating": int(row["opponent_rating"]),
            }


def restore_board(game: Dict[str, Any]) -> chess.Board:
    board = chess.Board(game["initial_fen"])
    for move_record in game["moves"]:
        move = chess.Move.from_uci(move_record["uci"])
        if move not in board.legal_moves:
            raise ValueError(f"Saved game {game['id']} contains an illegal move at ply {move_record['ply']}.")
        board.push(move)
    return board
