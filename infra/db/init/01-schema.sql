-- Hammer Price — schema inicial (Fase 1).
-- Aplicado automaticamente pelo postgres na primeira subida (volume vazio):
-- arquivos em /docker-entrypoint-initdb.d/ rodam em ordem alfabética.
-- Fonte: docs/09-modelo-de-dados.md. A verdade durável de dinheiro/inventário mora aqui;
-- o estado quente (lance atual, cronômetros) fica no Redis.

-- Salas / partidas -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
    id          text PRIMARY KEY,                 -- 'room-...'
    code        text UNIQUE NOT NULL,             -- código curto de entrada (ex.: '4F2K9')
    host_id     text,                             -- jogador que criou a sala (FK lógica -> players.id)
    status      text NOT NULL DEFAULT 'WAITING'   -- WAITING | RUNNING | ENDED
                CHECK (status IN ('WAITING', 'RUNNING', 'ENDED')),
    started_at  timestamptz,
    ends_at     timestamptz,
    current_round int NOT NULL DEFAULT 0,          -- rodada atual (modelo round-based; 1 caixa por rodada)
    seed        bigint,                            -- seed base do RNG (reprodutibilidade)
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Jogadores ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
    id           text PRIMARY KEY,                 -- 'player-...'
    room_id      text REFERENCES rooms(id),        -- partição lógica
    display_name text,
    balance      bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
    reserved     bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    created_at   timestamptz NOT NULL DEFAULT now()
    -- Invariante: saldo "gastável" = balance - reserved (nunca negativo).
);
CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);

-- Itens de inventário --------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
    id          text PRIMARY KEY,                  -- 'itm-...'
    player_id   text NOT NULL REFERENCES players(id),
    type        text NOT NULL CHECK (type IN ('COPPER', 'SILVER', 'GOLD', 'DIAMOND')),
    state       text NOT NULL DEFAULT 'FREE'       -- FREE | LOCKED_COLLECTION | CONSUMED
                CHECK (state IN ('FREE', 'LOCKED_COLLECTION', 'CONSUMED')),
    acquired_at timestamptz NOT NULL DEFAULT now()
    -- Invariante: um item está em EXATAMENTE um state; vender/queimar só se FREE.
);
CREATE INDEX IF NOT EXISTS idx_items_player ON inventory_items(player_id);

-- Afinidades (sorte controlável) ---------------------------------------------
CREATE TABLE IF NOT EXISTS affinities (
    player_id text NOT NULL REFERENCES players(id),
    type      text NOT NULL,
    points    int  NOT NULL DEFAULT 0 CHECK (points >= 0),  -- 0..teto (cap_pct no balance.yaml)
    PRIMARY KEY (player_id, type)
);

-- Coleções (bônus no patrimônio final) ---------------------------------------
CREATE TABLE IF NOT EXISTS collections (
    id        text PRIMARY KEY,
    player_id text NOT NULL REFERENCES players(id),
    kind      text NOT NULL CHECK (kind IN
                ('COMMON_ALLOY', 'NOBLE_PAIR', 'RAINBOW', 'ROYAL_TRIO', 'LEGENDARY_VAULT')),
    bonus     bigint NOT NULL,                      -- snapshot do bônus aplicado
    formed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_collections_player ON collections(player_id);

-- Ledger (auditoria — base da reconciliação) ---------------------------------
CREATE TABLE IF NOT EXISTS ledger (
    id        bigserial PRIMARY KEY,
    player_id text NOT NULL REFERENCES players(id),
    delta     bigint NOT NULL,                      -- + crédito / - débito
    reason    text   NOT NULL,                      -- BID_SETTLE | RESERVE_RELEASE | ITEM_SELL | MIMIC_PENALTY | ...
    ref       text,                                 -- id da caixa/item relacionado
    ts        timestamptz NOT NULL DEFAULT now()
    -- Invariante: balance(player) = soma dos delta do seu ledger (reconciliação valida).
);
CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger(player_id);

-- Caixas (histórico/resultados; estado vivo fica no Redis) -------------------
CREATE TABLE IF NOT EXISTS boxes (
    id          text PRIMARY KEY,                   -- 'box-...'
    room_id     text REFERENCES rooms(id),          -- partição: a instância de Leilão dona da sala
    round_no    int,                                -- rodada em que a caixa foi ofertada
    box_type    text CHECK (box_type IN ('BRONZE', 'SILVER', 'GOLD', 'VAULT')),
    winner_id   text REFERENCES players(id),        -- preenchido ao arrematar (nulo se expirou sem lances)
    final_price bigint,
    opened_item text                                -- resultado do sorteio
);
CREATE INDEX IF NOT EXISTS idx_boxes_room ON boxes(room_id);
