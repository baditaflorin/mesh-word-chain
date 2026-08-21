import { useEffect, useMemo, useState } from "react";
import {
  MeshNameInput,
  createClockSync,
  useNamedPeer,
  useRotatingTurn,
  useRoster,
  useSharedCollection,
  useSharedTimer,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

const ROUND_MS = 180_000;
const TURN_MS = 30_000;
const COLLECTION_KEY = "mesh-word-chain:words";
const TIMER_KEY = "mesh-word-chain:round-timer";
const GAME_KEY = "mesh-word-chain:game";

export type ChainWord = {
  id: string;
  value: string;
  firstLetter: string;
  lastLetter: string;
  authorId: string;
  createdAt: number;
};

type Props = { room: YRoom | null; config: MeshConfig };

function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function normalizeWord(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isChainWord(value: string): boolean {
  return /^[a-z]+(?:[ -][a-z]+)*$/i.test(value) && value.length >= 2 && value.length <= 48;
}

export function isValidNextWord(word: string, previous?: ChainWord): boolean {
  return isChainWord(word) && (!previous || word[0] === previous.lastLetter);
}

function isValidEntry(value: unknown): value is ChainWord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChainWord>;
  return (
    typeof item.id === "string" &&
    typeof item.value === "string" &&
    typeof item.firstLetter === "string" &&
    typeof item.lastLetter === "string" &&
    typeof item.authorId === "string" &&
    typeof item.createdAt === "number" &&
    isChainWord(item.value) &&
    item.firstLetter === item.value[0] &&
    item.lastLetter === item.value.at(-1)
  );
}

function shortPeerId(peerId: string): string {
  return `Player ${peerId.slice(0, 5)}`;
}

function wordId(peerId: string): string {
  return `${peerId}:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function Feature({ room, config }: Props) {
  const namedPeer = useNamedPeer(config, room);
  const roster = useRoster(room);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [gameRevision, refreshGame] = useState(0);
  const clock = useMemo(() => createClockSync(room?.provider ?? null), [room?.provider]);
  const chain = useSharedCollection<ChainWord>(room, COLLECTION_KEY, { validate: isValidEntry });
  const round = useSharedTimer(room, TIMER_KEY, { durationMs: ROUND_MS, clock });
  const turn = useRotatingTurn(room, clock, { slotMs: TURN_MS, order: "stable" });

  useEffect(() => () => clock.destroy(), [clock]);
  useEffect(() => {
    if (!room) return;
    const game = room.doc.getMap<unknown>(GAME_KEY);
    const onChange = () => refreshGame((version) => version + 1);
    game.observe(onChange);
    return () => game.unobserve(onChange);
  }, [room]);

  const game = room?.doc.getMap<unknown>(GAME_KEY);
  const roundNumber = (game?.get("round") as number | undefined) ?? 0;
  const words = chain.items.filter(isValidEntry);
  const previous = words.at(-1);
  const duplicate = words.some((item) => item.value === normalizeWord(draft));
  const displayName = (peerId: string) => namedPeer.nameOf(peerId) || shortPeerId(peerId);
  const canPlay = !!room && round.state === "running" && turn.isMyTurn;
  const promptLetter = previous?.lastLetter?.toUpperCase() ?? "any letter";
  void gameRevision;

  const startRound = () => {
    if (!room) return;
    room.doc.transact(() => {
      chain.clear();
      const sharedGame = room.doc.getMap<unknown>(GAME_KEY);
      sharedGame.set("round", roundNumber + 1);
      sharedGame.set("startedAt", clock.meshNow());
    });
    round.start(ROUND_MS);
    setDraft("");
    setNotice("Fresh round started. The first player can set the chain.");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = normalizeWord(draft);
    if (!room || round.state !== "running") {
      setNotice("Start a round before adding a word.");
      return;
    }
    if (!turn.isMyTurn) {
      setNotice("Wait for your highlighted turn.");
      return;
    }
    if (!isChainWord(value)) {
      setNotice("Use a 2–48 letter word; spaces and hyphens are okay.");
      return;
    }
    if (!isValidNextWord(value, previous)) {
      setNotice(`Your word needs to start with “${promptLetter}”.`);
      return;
    }
    if (words.some((item) => item.value === value)) {
      setNotice("That word is already in this chain.");
      return;
    }
    const added = chain.add({
      id: wordId(room.peerId),
      value,
      firstLetter: value[0]!,
      lastLetter: value.at(-1)!,
      authorId: room.peerId,
      createdAt: clock.meshNow(),
    });
    if (added) {
      setDraft("");
      setNotice(`${value} added — next letter: ${value.at(-1)!.toUpperCase()}.`);
    } else {
      setNotice("That word could not be added. Try a different word.");
    }
  };

  const turnName = turn.currentPeerId ? displayName(turn.currentPeerId) : "Waiting for players";
  const roundActive = round.state === "running";

  return (
    <main className="word-chain-page">
      <section className="word-chain-hero" aria-labelledby="word-chain-title">
        <div>
          <p className="word-chain-kicker">Mesh Word Chain</p>
          <h1 id="word-chain-title">Keep the word moving.</h1>
          <p className="word-chain-intro">
            Take turns adding a word that begins with the final letter of the one before it. One
            room, one live chain, no central game server.
          </p>
        </div>
        <div className="round-clock" aria-live="polite">
          <span>Round {roundNumber || "—"}</span>
          <strong>
            {roundActive
              ? formatMs(round.remainingMs ?? 0)
              : round.state === "finished"
                ? "Done"
                : "Ready"}
          </strong>
          <small>{roundActive ? "shared round clock" : "three minute rounds"}</small>
        </div>
      </section>

      <section className="game-grid" aria-label="Word chain game">
        <section className="chain-panel" aria-labelledby="chain-heading">
          <div className="panel-heading">
            <div>
              <p className="word-chain-kicker">The chain</p>
              <h2 id="chain-heading">
                {words.length ? `${words.length} words in play` : "Set the first word"}
              </h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={startRound}
              disabled={!room}
            >
              {roundActive ? "Restart round" : "Start round"}
            </button>
          </div>
          {words.length ? (
            <ol className="word-list">
              {words.map((item, index) => (
                <li key={item.id}>
                  <span className="word-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="chain-word">{item.value}</span>
                  <span className="word-author">{displayName(item.authorId)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-chain">
              <span aria-hidden="true">Aa</span>
              <p>Any valid word can open the chain once the round begins.</p>
            </div>
          )}
        </section>

        <aside className="turn-panel" aria-labelledby="turn-heading">
          <p className="word-chain-kicker">Turn clock</p>
          <h2 id="turn-heading">{roundActive ? turnName : "Start when ready"}</h2>
          <div className="turn-countdown" aria-live="polite">
            {roundActive ? formatMs(turn.msToNextTurn) : "0:30"}
          </div>
          <div className="turn-progress" aria-hidden="true">
            <span style={{ width: `${roundActive ? Math.round(turn.progress * 100) : 0}%` }} />
          </div>
          <p>
            {roundActive
              ? turn.isMyTurn
                ? "Your turn — make the chain count."
                : `Next up: ${turn.nextPeerId ? displayName(turn.nextPeerId) : "a player"}.`
              : "The turn order appears when a round starts."}
          </p>
          <div className="presence-line">
            <span className={room ? "presence-dot connected" : "presence-dot"} />
            {room
              ? `${roster.present.length || 1} player${roster.present.length === 1 ? "" : "s"} here`
              : "Connecting to room…"}
          </div>
        </aside>

        <section className="play-panel" aria-labelledby="play-heading">
          <div>
            <p className="word-chain-kicker">Your move</p>
            <h2 id="play-heading">Starts with {promptLetter}</h2>
          </div>
          <MeshNameInput
            label="Player name"
            value={namedPeer.name}
            onChange={namedPeer.setName}
            placeholder="Choose a name"
            maxLength={32}
          />
          <form onSubmit={submit}>
            <label htmlFor="next-word">Next word</label>
            <div className="word-entry">
              <input
                id="next-word"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={previous ? `${promptLetter.toLowerCase()}…` : "Start the chain"}
                maxLength={48}
                autoComplete="off"
                disabled={!canPlay}
              />
              <button className="primary-button" type="submit" disabled={!canPlay || duplicate}>
                Add word
              </button>
            </div>
          </form>
          <p className="play-help" aria-live="polite">
            {notice ||
              (canPlay
                ? "Only new words keep the chain alive."
                : roundActive
                  ? "The highlighted player writes next."
                  : "Start a round to play.")}
          </p>
        </section>
      </section>
    </main>
  );
}
