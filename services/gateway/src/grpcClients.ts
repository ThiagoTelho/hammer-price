// Carrega os contratos .proto em runtime (sem codegen) e expõe um cliente do
// serviço de Leilão. O gateway traduz ações do cliente WebSocket em chamadas
// gRPC SÍNCRONAS ao Leilão.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = resolve(__dirname, "../../../proto");

const AUCTION_GRPC = process.env.AUCTION_GRPC ?? "localhost:50051";

const packageDef = protoLoader.loadSync(resolve(PROTO_DIR, "auction.proto"), {
  keepCase: false,
  longs: Number,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef) as any;
const AuctionCtor = proto.hammerprice.auction.Auction;

const auction = new AuctionCtor(AUCTION_GRPC, grpc.credentials.createInsecure());

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
  roomId: string,
  boxId: string,
  playerId: string,
  amount: number,
): Promise<PlaceBidReply> {
  return new Promise((res, rej) => {
    auction.PlaceBid({ roomId, boxId, playerId, amount }, (err: any, reply: PlaceBidReply) =>
      err ? rej(err) : res(reply),
    );
  });
}

export function getRoomState(roomId: string): Promise<RoomState> {
  return new Promise((res, rej) => {
    auction.GetRoomState({ roomId }, (err: any, reply: RoomState) =>
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

// O vencedor abre a caixa arrematada; o servidor sorteia o item (gRPC síncrono).
export function openBox(roomId: string, boxId: string, playerId: string): Promise<OpenBoxReply> {
  return new Promise((res, rej) => {
    auction.OpenBox({ roomId, boxId, playerId }, (err: any, reply: OpenBoxReply) =>
      err ? rej(err) : res(reply),
    );
  });
}

export { AUCTION_GRPC };
