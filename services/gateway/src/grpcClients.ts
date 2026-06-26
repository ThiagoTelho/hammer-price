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
    auctionAt(addr).PlaceBid({ roomId, boxId, playerId, amount }, (err: any, reply: PlaceBidReply) =>
      err ? rej(err) : res(reply),
    );
  });
}

export function getRoomState(addr: string, roomId: string): Promise<RoomState> {
  return new Promise((res, rej) => {
    auctionAt(addr).GetRoomState({ roomId }, (err: any, reply: RoomState) =>
      err ? rej(err) : res(reply),
    );
  });
}

export interface OpenBoxReply {
  ok: boolean;
  reason: string;
  item: string;
  isMimic: boolean;
}

export interface WalletItem {
  id: string;
  type: string;
  state: string;
}
export interface PlayerState {
  playerId: string;
  balance: number;
  reserved: number;
  inventory: WalletItem[];
}

// Leitura do estado do jogador (saldo, reservas, inventário) na sua wallet shard.
export function getPlayer(addr: string, playerId: string): Promise<PlayerState> {
  return new Promise((res, rej) => {
    walletAt(addr).GetPlayer({ playerId }, (err: any, reply: PlayerState) =>
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
    auctionAt(addr).OpenBox({ roomId, boxId, playerId }, (err: any, reply: OpenBoxReply) =>
      err ? rej(err) : res(reply),
    );
  });
}
