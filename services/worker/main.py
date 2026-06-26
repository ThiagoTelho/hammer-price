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
EVENTS_CHANNEL = f"room:{ROOM_ID}:events"   # mesmo canal que o gateway assina
PRICED_ITEMS = ["COPPER", "SILVER", "GOLD", "DIAMOND"]  # MIMIC é penalidade, não tem preço


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


def compute_prices(cfg: dict, supply: dict) -> dict:
    """Preço por escassez relativa: base * clamp(1 + k*(alvo - oferta)/alvo, piso, teto).

    Quanto mais itens de um tipo entram em circulação (oferta sobe), mais o preço cai —
    recompensa o contrarianismo (ver docs/03 §6).
    """
    items = cfg.get("items", {})
    market = cfg.get("market", {})
    k = float(market.get("sensitivity_k", 0.5))
    floor = float(market.get("floor_multiplier", 0.4))
    ceil = float(market.get("ceil_multiplier", 1.8))
    target = float(market.get("target_supply", 5)) or 1.0
    prices = {}
    for item in PRICED_ITEMS:
        base = items.get(item)
        if base is None:
            continue
        s = supply.get(item, 0)
        factor = 1.0 + k * (target - s) / target
        factor = max(floor, min(ceil, factor))
        prices[item] = round(base * factor)
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
    supply: dict = defaultdict(int)

    def publish_market() -> None:
        prices = compute_prices(cfg, supply)
        if rds is not None:
            try:
                # Snapshot do mercado escrito no PRIMÁRIO; o Redis replica para a réplica,
                # de onde o gateway lê (read/write split — ver docs/04-arquitetura.md).
                rds.set("market:prices", json.dumps(prices))
                rds.publish(EVENTS_CHANNEL, json.dumps({"type": "MARKET_UPDATED", "prices": prices}))
            except Exception as exc:  # noqa: BLE001
                print(f"worker: falha ao escrever/publicar mercado ({exc})", flush=True)
        print(f"worker: MARKET_UPDATED {prices}", flush=True)

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
    print(f"worker: consumindo '{QUEUE}' no exchange '{EXCHANGE}' — Ctrl+C para sair", flush=True)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
