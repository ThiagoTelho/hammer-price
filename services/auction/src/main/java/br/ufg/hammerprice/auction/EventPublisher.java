package br.ufg.hammerprice.auction;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.MessageProperties;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

/**
 * Publica os eventos do leilão de forma ASSÍNCRONA (o emissor não espera):
 *  - <b>Redis Pub/Sub</b> (canal {@code room:{roomId}:events}): broadcast de baixa latência,
 *    consumido pelo gateway e difundido aos clientes WebSocket (paradigma publish-subscribe).
 *  - <b>RabbitMQ</b> (exchange {@code hammerprice}, tipo topic): eventos DURÁVEIS para o
 *    worker (paradigma messaging) — ex.: {@code box.opened} dispara o recálculo de mercado.
 *
 * <p>É a contraparte assíncrona do caminho síncrono (gRPC PlaceBid/OpenBox): a confirmação
 * do lance volta bloqueante ao autor, enquanto o evento é difundido a todos sem espera.
 *
 * <p><b>Resiliência:</b> se Redis/RabbitMQ estiverem indisponíveis, loga e segue — o leilão
 * continua funcionando (a corretude do dinheiro é síncrona via gRPC, independente disto).
 */
public final class EventPublisher {

    public static final String EXCHANGE = "hammerprice";

    private final String roomId;
    private final String roomChannel;
    private final ObjectMapper json = new ObjectMapper();
    private final JedisPool redis;     // null se indisponível
    private final Channel mqChannel;   // null se indisponível (canal RabbitMQ)

    public EventPublisher(String roomId, String redisUrl, String rabbitUrl) {
        this.roomId = roomId;
        this.roomChannel = "room:" + roomId + ":events";
        this.redis = initRedis(redisUrl);
        this.mqChannel = initRabbit(rabbitUrl);
    }

    private static Channel initRabbit(String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        ConnectionFactory f = new ConnectionFactory();
        try {
            f.setUri(url);
        } catch (Exception e) {
            System.err.println("auction: RABBITMQ_URL inválida (" + e.getMessage() + "); messaging desativado");
            return null;
        }
        // RabbitMQ pode demorar a aceitar conexões mesmo após o healthcheck; tenta com backoff.
        for (int attempt = 1; attempt <= 10; attempt++) {
            try {
                Channel ch = f.newConnection("auction").createChannel();
                ch.exchangeDeclare(EXCHANGE, "topic", true); // durável
                System.out.println("auction: RabbitMQ conectado em " + url);
                return ch;
            } catch (Exception e) {
                System.err.println("auction: RabbitMQ ainda não pronto (tentativa " + attempt + "); aguardando…");
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return null;
                }
            }
        }
        System.err.println("auction: RabbitMQ indisponível após retries; messaging desativado");
        return null;
    }

    private static JedisPool initRedis(String url) {
        try {
            if (url == null || url.isBlank()) {
                return null;
            }
            JedisPool pool = new JedisPool(URI.create(url));
            try (Jedis j = pool.getResource()) {
                j.ping();
            }
            System.out.println("auction: Redis Pub/Sub conectado em " + url);
            return pool;
        } catch (Exception e) {
            System.err.println("auction: Redis indisponível (" + e.getMessage() + "); broadcast desativado");
            return null;
        }
    }

    // ---- eventos do jogo (montam o payload no formato das mensagens WS) ----

    public void roundStarted(int round, String boxId, String boxType, long currentBid,
                             String leader, long timerMs, Map<String, Integer> odds, long endsAt) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "ROUND_STARTED");
        ev.put("round", round);
        ev.put("box", boxView(boxId, boxType, currentBid, leader, timerMs, odds));
        ev.put("endsAt", endsAt);
        broadcast(ev);
        // Evento durável para o worker (manutenção/métricas da partida).
        mq("round.started", mapOf("roomId", roomId, "round", round, "boxId", boxId,
                "boxType", boxType, "odds", odds));
    }

    public void bidPlaced(String boxId, String leader, long amount, long timerMs) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "BID_PLACED");
        ev.put("boxId", boxId);
        ev.put("leader", leader);
        ev.put("amount", amount);
        ev.put("timerMs", timerMs);
        broadcast(ev);
    }

    public void boxSold(String boxId, String boxType, String winner, long price) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "BOX_SOLD");
        ev.put("boxId", boxId);
        ev.put("boxType", boxType);
        ev.put("winner", winner);
        ev.put("price", price);
        broadcast(ev);
    }

    public void roundEnded(int round, String boxId, String winner, long price) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "ROUND_ENDED");
        ev.put("round", round);
        ev.put("boxId", boxId);
        ev.put("winner", winner.isEmpty() ? null : winner);
        ev.put("price", price);
        broadcast(ev);
    }

    public void boxOpened(String boxId, String player, String item, boolean isMimic) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "BOX_OPENED");
        ev.put("boxId", boxId);
        ev.put("player", player);
        ev.put("item", item);
        ev.put("isMimic", isMimic);
        broadcast(ev);
        // Item entrou em circulação → o worker recalcula o mercado (messaging durável).
        mq("box.opened", mapOf("roomId", roomId, "boxId", boxId, "player", player,
                "item", item, "isMimic", isMimic));
    }

    private static Map<String, Object> boxView(String boxId, String boxType, long currentBid,
                                               String leader, long timerMs, Map<String, Integer> odds) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("boxId", boxId);
        b.put("boxType", boxType);
        b.put("currentBid", currentBid);
        b.put("leader", leader);
        b.put("timerMs", timerMs);
        b.put("odds", odds);
        return b;
    }

    private static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }

    /** Broadcast de baixa latência (Redis Pub/Sub) para o gateway difundir aos clientes. */
    private void broadcast(Map<String, Object> ev) {
        if (redis == null) {
            return;
        }
        try (Jedis j = redis.getResource()) {
            j.publish(roomChannel, json.writeValueAsString(ev));
        } catch (Exception e) {
            System.err.println("auction: falha ao publicar no Redis: " + e.getMessage());
        }
    }

    /** Publicação durável (RabbitMQ). {@code synchronized}: um {@link Channel} não é
     *  thread-safe e os eventos vêm de threads diferentes (gRPC + cronômetro de rodada). */
    private synchronized void mq(String routingKey, Map<String, Object> payload) {
        if (mqChannel == null) {
            return;
        }
        try {
            mqChannel.basicPublish(EXCHANGE, routingKey, MessageProperties.PERSISTENT_TEXT_PLAIN,
                    json.writeValueAsBytes(payload));
        } catch (Exception e) {
            System.err.println("auction: falha ao publicar no RabbitMQ: " + e.getMessage());
        }
    }

    public void close() {
        if (redis != null) {
            redis.close();
        }
        try {
            if (mqChannel != null) {
                mqChannel.close();
                mqChannel.getConnection().close();
            }
        } catch (Exception ignored) {
            // encerramento best-effort
        }
    }
}
