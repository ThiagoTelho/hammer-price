"""Worker de background do Hammer Price (esqueleto da Fase 1).

Nesta fase o worker apenas: carrega o balance.yaml, conecta a RabbitMQ e Redis,
declara o exchange/fila de eventos e fica vivo consumindo (sem lógica de negócio).
A engine de mercado, avaliação de coleções e reconciliação entram na Fase 5
(ver docs/04-arquitetura.md e docs/07-contratos-api.md).
"""
from __future__ import annotations

import os
import sys
import time

import pika
import redis
import yaml

EXCHANGE = "hammerprice"          # topic exchange (ver docs/07-contratos-api.md §3)
QUEUE = "worker.events"
# Tópicos que o worker passará a tratar na Fase 5.
ROUTING_KEYS = ["box.opened", "item.sold", "item.burned", "ledger.entry", "match.tick"]


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


def connect_redis() -> redis.Redis | None:
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
    print("worker: iniciando (esqueleto da Fase 1)", flush=True)
    load_balance()
    connect_redis()

    conn = connect_rabbit()
    channel = conn.channel()
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    channel.queue_declare(queue=QUEUE, durable=True)
    for key in ROUTING_KEYS:
        channel.queue_bind(exchange=EXCHANGE, queue=QUEUE, routing_key=key)

    def on_message(ch, method, _props, body):
        # Fase 5: despachar por routing_key para market/collections/reconcile.
        print(f"worker: evento {method.routing_key}: {body!r}", flush=True)
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
