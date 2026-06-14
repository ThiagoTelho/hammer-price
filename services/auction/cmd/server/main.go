// Servidor gRPC do Leilão (fatia vertical). Também é CLIENTE gRPC da Carteira.
package main

import (
	"context"
	"log"
	"net"
	"os"
	"time"

	auctionpb "github.com/ThiagoTelho/hammer-price/proto/gen/go/auctionpb"
	walletpb "github.com/ThiagoTelho/hammer-price/proto/gen/go/walletpb"
	"github.com/ThiagoTelho/hammer-price/services/auction/internal/box"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// walletGateway adapta o cliente gRPC da Carteira à interface box.Wallet.
type walletGateway struct {
	client walletpb.WalletClient
}

func (w *walletGateway) Reserve(playerID, boxID string, amount int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	rep, err := w.client.Reserve(ctx, &walletpb.ReserveRequest{
		PlayerId: playerID, BoxId: boxID, Amount: amount,
	})
	if err != nil {
		log.Printf("auction: erro ao reservar saldo: %v", err)
		return false
	}
	return rep.Ok
}

func (w *walletGateway) Release(playerID, boxID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := w.client.Release(ctx, &walletpb.ReleaseRequest{PlayerId: playerID, BoxId: boxID}); err != nil {
		log.Printf("auction: erro ao devolver reserva: %v", err)
	}
}

type server struct {
	auctionpb.UnimplementedAuctionServer
	store *box.Store
}

func (s *server) PlaceBid(_ context.Context, req *auctionpb.PlaceBidRequest) (*auctionpb.PlaceBidReply, error) {
	r := s.store.PlaceBid(req.BoxId, req.PlayerId, req.Amount)
	return &auctionpb.PlaceBidReply{
		Accepted: r.Accepted, Reason: r.Reason,
		CurrentBid: r.CurrentBid, Leader: r.Leader, TimerMs: r.TimerMs,
	}, nil
}

func (s *server) GetVaultState(_ context.Context, _ *auctionpb.VaultQuery) (*auctionpb.VaultState, error) {
	snaps := s.store.Snapshot()
	boxes := make([]*auctionpb.Box, 0, len(snaps))
	for _, b := range snaps {
		boxes = append(boxes, &auctionpb.Box{
			BoxId: b.BoxID, BoxType: b.BoxType, CurrentBid: b.CurrentBid,
			Leader: b.Leader, TimerMs: b.TimerMs,
		})
	}
	return &auctionpb.VaultState{Boxes: boxes}, nil
}

func main() {
	addr := os.Getenv("AUCTION_ADDR")
	if addr == "" {
		addr = ":50051"
	}
	walletAddr := os.Getenv("WALLET_GRPC")
	if walletAddr == "" {
		walletAddr = "localhost:50052"
	}

	conn, err := grpc.NewClient(walletAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("auction: conectar carteira %s: %v", walletAddr, err)
	}
	defer conn.Close()
	gw := &walletGateway{client: walletpb.NewWalletClient(conn)}

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("auction: listen %s: %v", addr, err)
	}
	s := grpc.NewServer()
	auctionpb.RegisterAuctionServer(s, &server{store: box.NewStore(gw)})
	log.Printf("auction: ouvindo em %s (carteira em %s)", addr, walletAddr)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("auction: serve: %v", err)
	}
}
