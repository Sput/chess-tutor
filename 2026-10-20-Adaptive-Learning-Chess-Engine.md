# Using Adaptive Agents to get better at chess

## Objective

I've discovered recently that somewhere along the way my son got significantly better than me at chess. There was a time not that long ago that I could still beat him half the time, but now its not even close. In order to improve my skills I decided to build a chess teaching app. It was important that it increase in difficulty as I got better. This application also had the added benefit of using two different applications to load data into the context used by an LLM to help coach me. You play against Maia-3, an engine designed to produce human-like moves, while the app keeps the official board position and validates every move. When I want help, or have questions about the board position, Stockfish analyzes the position and supplies concrete evaluations and candidate lines. It will offer a hint with increasing levels of verbose-ness, explain a move, or answer a question in natural language. After the game, you can inspect notable moments. The goal is not to replace independent thinking, but to make useful feedback available to help develop thinking for later when I play my son.

![Game board for chess learner](/images/game_screen.png)

## Goals

I had three goals as to how the player interacted with the application. First, difficulty should be editable: players can select Maia-3's opponent strength, and the app remembers a player rating to help choose a sensible starting level for future games. My research says people learn best when they succeed 85% of the time, I'm still doing play testing to see if I succeeded at that. Second, coaching should turn engine analysis into understandable guidance. Stockfish provides chess-specific evidence; gpt-6-luna explains that evidence conversationally and answers the player's question. Third, the product should support skill development rather than merely report wins and losses. I wanted to be able to request hints, review mistakes and blunders, and examine key moments after a game. Coaching is passive, it only shows up when I request it, otherwise its silent (except when I make what Stockfish calls a "blunder", then it will speak up).

![Engine calling out a blunder](/images/blunder.png)

## Architecture

The browser interface is built with React, TypeScript, and Vite. It communicates with a Python FastAPI service, which owns the chess position, validates moves with python-chess, and stores games and player settings in SQLite. Maia-3 and Stockfish have separate jobs: Maia-3 supplies opponent moves at a chosen strength, while Stockfish analyzes positions and produces candidate lines for feedback and reviews. I could have used Stockfish for both, but its ELO only goes down to 1200, which is too high for me right now. The OpenAI Responses API turns a compact bundle of game context and Stockfish findings into natural-language coaching. The language model cannot change the board; rules and engine analysis remain authoritative. If OpenAI is unavailable or unconfigured, local engine-backed explanations remain available (and there is a notice in the UI that it is unavailable).

![Gambit question](/images/gambit_question.png)

## ELO Scoring

In the opening scene of the movie "The Social Network" Mark Zuckerberg and his roommates figure out the formula for Elo scores by drawing on their dorm window. This movie had be beleive this was some complicated formula. Turns out, its pretty simple.  The rating change depends on the game result and the difference between the player's rating and the opponent's configured rating: beating a stronger opponent earns more than beating a weaker one, while losing to a lower-rated opponent costs more. Players can enter a starting rating, and the app records subsequent changes. Maia-3's configured strength serves as the opponent rating for this calculation.  Below is the formula for calculating Elo in python:

![ELO code](/images/ELO_code.png)

## Adaptive Difficulty

The application saves the player's rating and uses it to choose Maia-3's default strength for a new game: the nearest 50-point level below the rating, bounded by Maia-3's supported 400–1800 range. Players can also change the opponent strength manually in 50-point steps, including during a game. The player rating is updated after completed games, so later starting levels can reflect results. However, the app does not yet automatically infer skill from move quality or dynamically adjust difficulty during play.

![Recommend move](/images/recommend_move.png)

## Developing Skill Through Feedback

Practice becomes more valuable when you can connect outcomes to decisions. After a move, Stockfish will identify significant evaluation drops "blunders" or minor mistakes "errors" and show a preferred alternative, a principal line, and the approximate swing. The coach can explain those findings without claiming to know why Maia-3 chose a move or inventing analysis that the engine did not provide. I can also request a hint before committing, ask why the opponent moved, or explore a position. After a game, a review highlights selected evaluation swings and lets players revisit the board after each moment. Used together, these features encourage reflection: try a plan, see what changed, and carry one lesson into the next game.
