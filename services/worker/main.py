"""Worker de background do Hammer Price — engine de mercado (Fase 5).

Consome eventos do RabbitMQ (paradigma messaging, durável) e, a cada item que entra em
circulação (`box.opened`), recalcula os preços de mercado por **escassez relativa** e
publica `MARKET_UPDATED` no canal Redis Pub/Sub da sala — o gateway difunde aos clientes.
É a 3ª linguagem (Python) fazendo processamento concorrente com os acessos dos clientes.
Ver docs/03-regras-de-negocio.md §6 e docs/04-arquitetura.md.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
from collections import defaultdict

import pika
import redis
import yaml

EXCHANGE = "hammerprice"          # topic exchange (ver docs/07-contratos-api.md §3)
QUEUE = "worker.events"
ROUTING_KEYS = ["box.opened", "item.sold", "ledger.entry", "match.tick", "round.started"]
ROOM_ID = os.environ.get("ROOM_ID", "room-1")
# O mercado é GLOBAL (uma oferta/preço); publica o MARKET_UPDATED no canal de cada sala
# para que TODAS vejam a cotação ao vivo (o gateway assina `room:<sala>:events`).
MARKET_ROOMS = [r.strip() for r in os.environ.get("MARKET_ROOMS", "room-1,room-2").split(",") if r.strip()]
EVENTS_CHANNELS = [f"room:{r}:events" for r in MARKET_ROOMS]
PRICED_ITEMS = ["COPPER", "SILVER", "GOLD", "DIAMOND"]  # MIMIC é penalidade, não tem preço

# Catálogo de EVENTOS DE MERCADO: swings temáticos de preço que dão vida e estratégia de timing
# às vendas. `mult` = fator por item; `all` = fator global. Sorteados pelo worker (dono do mercado).
MARKET_EVENTS = [
    {"kind": "FEVER_GOLD",    "label": "Febre do Ouro",       "emoji": "🔥", "desc": "Ouro disparando!",   "mult": {"GOLD": 1.6}},
    {"kind": "DIAMOND_RUSH",  "label": "Corrida do Diamante", "emoji": "💎", "desc": "Diamante em alta!",   "mult": {"DIAMOND": 1.5}},
    {"kind": "SILVER_BUBBLE", "label": "Bolha da Prata",      "emoji": "🫧", "desc": "Prata bombando!",     "mult": {"SILVER": 1.7}},
    {"kind": "BOOM",          "label": "Mercado Aquecido",    "emoji": "📈", "desc": "Tudo valorizando!",   "all": 1.4},
    {"kind": "CRASH",         "label": "Crash do Mercado",    "emoji": "📉", "desc": "Tudo despencando!",   "all": 0.6},
]


def load_balance() -> dict:
    path = os.environ.get("BALANCE_CONFIG", "/config/balance.yaml")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh) or {}
        print(f"worker: balance.yaml carregado de {path}", flush=True)
        return cfg
    except FileNotFoundError:
        print(f"worker: {path} não encontrado; seguindo com defaults", flush=True)
        return {}


def event_mult(event: dict | None, item: str) -> float:
    """Multiplicador de um EVENTO DE MERCADO sobre um item (1.0 = neutro)."""
    if not event:
        return 1.0
    mult = event.get("mult", {})
    return float(mult.get(item, event.get("all", 1.0)))


def compute_prices(cfg: dict, supply: dict, sentiment: dict | None = None,
                   event: dict | None = None) -> dict:
    """Preço por escassez relativa, COM oscilação de "sentimento" e EVENTOS de mercado.

    Valor justo por escassez: base * (1 + k*(alvo - oferta)/alvo) — quanto mais itens de um
    tipo entram em circulação, mais barato (recompensa o contrarianismo, ver docs/03 §6).
    O {@code sentiment} (passeio aleatório com reversão à média, ~±20%) faz o preço OSCILAR em
    torno do valor justo a cada tick. O {@code event} (Febre do Ouro, Crash…) aplica um swing
    temático por item enquanto ativo. Tudo preso entre piso e teto.
    """
    items = cfg.get("items", {})
    market = cfg.get("market", {})
    k = float(market.get("sensitivity_k", 0.5))
    floor = float(market.get("floor_multiplier", 0.4))
    ceil = float(market.get("ceil_multiplier", 1.8))
    target = float(market.get("target_supply", 5)) or 1.0
    sentiment = sentiment or {}
    prices = {}
    for item in PRICED_ITEMS:
        base = items.get(item)
        if base is None:
            continue
        s = supply.get(item, 0)
        factor = (1.0 + k * (target - s) / target) * sentiment.get(item, 1.0) * event_mult(event, item)
        factor = max(floor, min(ceil, factor))
        prices[item] = max(1, round(base * factor))
    return prices


def connect_redis():
    url = os.environ.get("REDIS_URL", "redis://redis:6379")
    try:
        client = redis.Redis.from_url(url)
        client.ping()
        print(f"worker: conectado ao Redis em {url}", flush=True)
        return client
    except Exception as exc:  # noqa: BLE001 - log e segue
        print(f"worker: Redis indisponível ({exc})", flush=True)
        return None


def connect_rabbit() -> pika.BlockingConnection:
    url = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672")
    params = pika.URLParameters(url)
    # RabbitMQ pode demorar a aceitar conexões mesmo após o healthcheck; tenta com backoff.
    last_exc: Exception | None = None
    for attempt in range(1, 31):
        try:
            conn = pika.BlockingConnection(params)
            print(f"worker: conectado ao RabbitMQ em {url}", flush=True)
            return conn
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            print(f"worker: RabbitMQ ainda não pronto (tentativa {attempt}); aguardando…", flush=True)
            time.sleep(2)
    raise SystemExit(f"worker: não foi possível conectar ao RabbitMQ: {last_exc}")


def main() -> int:
    print("worker: iniciando (engine de mercado — Fase 5)", flush=True)
    cfg = load_balance()
    rds = connect_redis()
    supply: dict = defaultdict(float)  # oferta em circulação por item (float: decai a cada tick)
    sentiment: dict = {item: 1.0 for item in PRICED_ITEMS}  # "humor" de mercado por item (~1.0)
    market_cfg = cfg.get("market", {})
    interval = float(market_cfg.get("recalc_interval_seconds", 5)) or 5.0
    decay = float(market_cfg.get("supply_decay_per_tick", 0.15))  # absorção da oferta por tick
    evt: dict = {"active": None, "ticks": 0}  # evento de mercado em curso (None = nenhum)

    def tick_sentiment() -> None:
        """Passeio aleatório com reversão à média: o mercado oscila ~±25% em torno do valor justo."""
        for item in PRICED_ITEMS:
            drift = random.uniform(-0.09, 0.09)          # choque do tick (oscilação visível)
            revert = (1.0 - sentiment[item]) * 0.15       # puxa de volta para 1.0 (devagar → swings duram)
            sentiment[item] = max(0.75, min(1.25, sentiment[item] + drift + revert))

    def tick_event() -> None:
        """Gerencia o EVENTO DE MERCADO ativo: decai/expira ou, se não há nenhum, sorteia um novo."""
        if evt["active"] is not None:
            evt["ticks"] -= 1
            if evt["ticks"] <= 0:
                print(f"worker: MARKET_EVENT {evt['active']['kind']} terminou", flush=True)
                evt["active"] = None
            return
        if random.uniform(0, 100) < float(market_cfg.get("event_chance_per_tick", 12)):
            tmin = int(market_cfg.get("event_min_ticks", 5))
            tmax = int(market_cfg.get("event_max_ticks", 9))
            evt["ticks"] = random.randint(tmin, max(tmin, tmax))
            ends_at = int(time.time() * 1000) + evt["ticks"] * int(interval * 1000)
            evt["active"] = {**random.choice(MARKET_EVENTS), "endsAt": ends_at}
            print(f"worker: MARKET_EVENT {evt['active']['kind']} por {evt['ticks']} ticks", flush=True)

    def decay_supply() -> None:
        """Absorve a oferta a cada tick (demanda): a escassez REVERTE à média e o preço RECUPERA
        depois de uma rajada de aberturas. Sem isto a oferta só cresce, satura o fator de escassez
        e todo item trava no piso — o bug que esta correção resolve."""
        for item in PRICED_ITEMS:
            supply[item] *= (1.0 - decay)
            if supply[item] < 0.1:        # zera resíduos para a oferta voltar limpa a zero
                supply[item] = 0.0

    def publish_market() -> None:
        active = evt["active"]
        prices = compute_prices(cfg, supply, sentiment, active)
        # Vista pública do evento (sem os multiplicadores internos) embutida no MARKET_UPDATED.
        event_view = {k: active[k] for k in ("kind", "label", "emoji", "desc", "endsAt")} if active else None
        if rds is not None:
            try:
                # Snapshot do mercado escrito no PRIMÁRIO; o Redis replica para a réplica,
                # de onde o gateway lê (read/write split — ver docs/04-arquitetura.md).
                rds.set("market:prices", json.dumps(prices))
                payload = json.dumps({"type": "MARKET_UPDATED", "prices": prices, "event": event_view})
                for ch in EVENTS_CHANNELS:  # mercado é global → publica em todas as salas
                    rds.publish(ch, payload)
            except Exception as exc:  # noqa: BLE001
                print(f"worker: falha ao escrever/publicar mercado ({exc})", flush=True)
        print(f"worker: MARKET_UPDATED {prices}" + (f" [{active['kind']}]" if active else ""), flush=True)

    # Mercado inicial (oferta zero → itens "caros").
    publish_market()

    conn = connect_rabbit()
    channel = conn.channel()
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    channel.queue_declare(queue=QUEUE, durable=True)
    for key in ROUTING_KEYS:
        channel.queue_bind(exchange=EXCHANGE, queue=QUEUE, routing_key=key)

    def on_message(ch, method, _props, body):
        try:
            payload = json.loads(body)
        except Exception:  # noqa: BLE001
            payload = {}
        # Itens entraram em circulação → atualiza a oferta (N unidades) e recalcula o mercado.
        if method.routing_key == "box.opened":
            item = payload.get("item")
            qty = max(1, int(payload.get("quantity", 1) or 1))
            if item in PRICED_ITEMS:
                supply[item] += qty
                print(f"worker: box.opened {qty}x {item} (oferta={supply[item]})", flush=True)
                publish_market()
        ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_consume(queue=QUEUE, on_message_callback=on_message)
    print(f"worker: consumindo '{QUEUE}'; tick de mercado a cada {interval:g}s — Ctrl+C para sair", flush=True)
    try:
        # Processa box.opened por até `interval`s e então dá um tick de mercado:
        # decai a oferta (recuperação) + oscila o sentimento + gerencia o evento, e republica.
        while True:
            conn.process_data_events(time_limit=interval)
            decay_supply()
            tick_sentiment()
            tick_event()
            publish_market()
    except KeyboardInterrupt:
        channel.stop_consuming()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
