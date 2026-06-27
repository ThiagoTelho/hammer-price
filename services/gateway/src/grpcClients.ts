// Carrega os contratos .proto em runtime (sem codegen) e expõe um cliente do
// serviço de Leilão. O gateway traduz ações do cliente WebSocket em chamadas
// gRPC SÍNCRONAS ao Leilão.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = resolve(__dirname, "../../../proto");

const packageDef = protoLoader.loadSync(resolve(PROTO_DIR, "auction.proto"), {
  keepCase: false,
  longs: Number,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef) as any;
const AuctionCtor = proto.hammerprice.auction.Auction;

// Cliente de leitura da Carteira (saldo/reservas/inventário) — uma por shard, cacheada.
const walletDef = protoLoader.loadSync(resolve(PROTO_DIR, "wallet.proto"), {
  keepCase: false,
  longs: Number,
  defaults: true,
  oneofs: true,
});
const WalletCtor = (grpc.loadPackageDefinition(walletDef) as any).hammerprice.wallet.Wallet;
const walletByAddr = new Map<string, any>();
function walletAt(addr: string) {
  let c = walletByAddr.get(addr);
  if (!c) {
    c = new WalletCtor(addr, grpc.credentials.createInsecure());
    walletByAddr.set(addr, c);
  }
  return c;
}

// Deadline curto: se a instância dona da sala estiver fora, a chamada falha rápido
// (em vez de pendurar) e o gateway responde "indisponível" ao cliente.
const callOpts = () => ({ deadline: Date.now() + 3000 });

// Particionamento por sala: um cliente gRPC por instância de Leilão (cada sala tem a sua),
// cacheado por endereço. O gateway escolhe o endereço pela sala do cliente.
const clientsByAddr = new Map<string, any>();
function auctionAt(addr: string) {
  let c = clientsByAddr.get(addr);
  if (!c) {
    c = new AuctionCtor(addr, grpc.credentials.createInsecure());
    clientsByAddr.set(addr, c);
  }
  return c;
}

export interface PlaceBidReply {
  accepted: boolean;
  reason: string;
  currentBid: number;
  leader: string;
  timerMs: number;
}

export interface Box {
  boxId: string;
  boxType: string;
  currentBid: number;
  leader: string;
  timerMs: number;
  odds: Record<string, number>; // P pública por item (= a aplicada na abertura)
}

// Estado da sala = rodada atual + a caixa em leilão. `active` é false na pausa entre rodadas.
export interface RoomState {
  round: number;
  active: boolean;
  box: Box;
  endsAt: number;
}

export function placeBid(
  addr: string,
  roomId: string,
  boxId: string,
  playerId: string,
  amount: number,
): Promise<PlaceBidReply> {
  return new Promise((res, rej) => {
    auctionAt(addr).PlaceBid({ roomId, boxId, playerId, amount }, callOpts(), (err: any, reply: PlaceBidReply) =>
      err ? rej(err) : res(reply),
    );
  });
}

export function getRoomState(addr: string, roomId: string): Promise<RoomState> {
  return new Promise((res, rej) => {
    auctionAt(addr).GetRoomState({ roomId }, callOpts(), (err: any, reply: RoomState) =>
      err ? rej(err) : res(reply),
    );
  });
}

// Zera o jogador para uma nova partida (orçamento inicial, sem itens/coleções).
export function resetPlayer(addr: string, playerId: string): Promise<{ ok: boolean }> {
  return new Promise((res, rej) => {
    walletAt(addr).ResetPlayer({ playerId }, callOpts(), (err: any, reply: { ok: boolean }) =>
      err ? rej(err) : res(reply),
    );
  });
}

// Encerra o intervalo e abre já a próxima rodada (chamado quando todos estão prontos).
export function advanceRound(addr: string, roomId: string): Promise<{ started: boolean }> {
  return new Promise((res, rej) => {
    auctionAt(addr).AdvanceRound({ roomId }, callOpts(), (err: any, reply: { started: boolean }) =>
      err ? rej(err) : res(reply),
    );
  });
}

// ---- Cartas de habilidade ----
export interface BuyCardReply { ok: boolean; reason: string; card: string; price: number; balance: number }
// Compra uma carta aleatória (preço crescente; a Carteira debita e sorteia).
export function buyCard(addr: string, playerId: string): Promise<BuyCardReply> {
  return new Promise((res, rej) => {
    walletAt(addr).BuyCard({ playerId }, callOpts(), (err: any, reply: BuyCardReply) => (err ? rej(err) : res(reply)));
  });
}
// Remove 1 carta da mão (ao jogar). ok=false se o jogador não tinha a carta.
export function consumeCard(addr: string, playerId: string, card: string): Promise<{ ok: boolean }> {
  return new Promise((res, rej) => {
    walletAt(addr).ConsumeCard({ playerId, card }, callOpts(), (err: any, reply: { ok: boolean }) => (err ? rej(err) : res(reply)));
  });
}
// Move dinheiro entre jogadores (Imposto). Retorna quanto efetivamente moveu.
export function transfer(addr: string, fromPlayer: string, toPlayer: string, amount: number): Promise<{ ok: boolean; moved: number }> {
  return new Promise((res, rej) => {
    walletAt(addr).Transfer({ fromPlayer, toPlayer, amount }, callOpts(), (err: any, reply: { ok: boolean; moved: number }) => (err ? rej(err) : res(reply)));
  });
}
// Empurra os efeitos de carta para a PRÓXIMA rodada do Leilão.
export interface RoundEffects {
  doubleLoot?: string[];
  insured?: string[];
  cursed?: string[];
  gavel?: string[];
  insight?: string[];
  discounts?: { player: string; pct: number }[];
  boxTierBoost?: number;
}
export function setRoundEffects(addr: string, roomId: string, eff: RoundEffects): Promise<{ started: boolean }> {
  return new Promise((res, rej) => {
    auctionAt(addr).SetRoundEffects(
      {
        roomId,
        doubleLoot: eff.doubleLoot ?? [],
        insured: eff.insured ?? [],
        cursed: eff.cursed ?? [],
        gavel: eff.gavel ?? [],
        insight: eff.insight ?? [],
        discounts: eff.discounts ?? [],
        boxTierBoost: eff.boxTierBoost ?? 0,
      },
      callOpts(),
      (err: any, reply: { started: boolean }) => (err ? rej(err) : res(reply)),
    );
  });
}

// Carta Visão: item pré-sorteado da caixa da rodada atual.
export function peekDrop(addr: string, roomId: string): Promise<{ item: string; quantity: number }> {
  return new Promise((res, rej) => {
    auctionAt(addr).PeekDrop({ roomId }, callOpts(), (err: any, reply: { item: string; quantity: number }) =>
      err ? rej(err) : res(reply),
    );
  });
}

// Fecha a rodada imediatamente (todos passaram/fold) — o líder vence sem esperar o cronômetro.
export function forceClose(addr: string, roomId: string): Promise<{ started: boolean }> {
  return new Promise((res, rej) => {
    auctionAt(addr).ForceClose({ roomId }, callOpts(), (err: any, reply: { started: boolean }) =>
      err ? rej(err) : res(reply),
    );
  });
}

// Limpa o rastreio de aberturas do Leilão (chamado ao iniciar uma nova partida).
export function resetOpens(addr: string, roomId: string): Promise<{ started: boolean }> {
  return new Promise((res, rej) => {
    auctionAt(addr).ResetOpens({ roomId }, callOpts(), (err: any, reply: { started: boolean }) =>
      err ? rej(err) : res(reply),
    );
  });
}

export interface OpenBoxReply {
  ok: boolean;
  reason: string;
  item: string;
  isMimic: boolean;
  quantity: number;
  cursed: boolean;
}

export interface WalletItem {
  id: string;
  type: string;
  state: string;
}
export interface CollectionInfo {
  kind: string;
  bonus: number;
}
export interface PlayerState {
  playerId: string;
  balance: number;
  reserved: number;
  inventory: WalletItem[];
  collections: CollectionInfo[];
  cards: string[];
  nextCardPrice: number;
}

// Leitura do estado do jogador (saldo, reservas, inventário, coleções) na sua wallet shard.
export function getPlayer(addr: string, playerId: string): Promise<PlayerState> {
  return new Promise((res, rej) => {
    walletAt(addr).GetPlayer({ playerId }, callOpts(), (err: any, reply: PlayerState) =>
      err ? rej(err) : res(reply),
    );
  });
}

export interface SellReply {
  ok: boolean;
  reason: string;
  price: number;
  type: string;
  balance: number;
}
// Vende um item livre pelo preço de mercado (passado pelo gateway, que lê o mercado).
export function sellItem(
  addr: string,
  playerId: string,
  itemId: string,
  prices: Record<string, number>,
): Promise<SellReply> {
  return new Promise((res, rej) => {
    walletAt(addr).SellItem({ playerId, itemId, prices }, callOpts(), (err: any, reply: SellReply) =>
      err ? rej(err) : res(reply),
    );
  });
}

export interface FormReply {
  ok: boolean;
  reason: string;
  bonus: number;
}

// Forma uma coleção: trava os itens exigidos e registra o bônus.
export function formCollection(addr: string, playerId: string, kind: string): Promise<FormReply> {
  return new Promise((res, rej) => {
    walletAt(addr).FormCollection({ playerId, kind }, callOpts(), (err: any, reply: FormReply) =>
      err ? rej(err) : res(reply),
    );
  });
}

// O vencedor abre a caixa arrematada; o servidor sorteia o item (gRPC síncrono).
export function openBox(
  addr: string,
  roomId: string,
  boxId: string,
  playerId: string,
): Promise<OpenBoxReply> {
  return new Promise((res, rej) => {
    auctionAt(addr).OpenBox({ roomId, boxId, playerId }, callOpts(), (err: any, reply: OpenBoxReply) =>
      err ? rej(err) : res(reply),
    );
  });
}
