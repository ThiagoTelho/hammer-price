// Servidor gRPC da Carteira (fatia vertical).
package main

import (
	"context"
	"log"
	"net"
	"os"

	pb "github.com/ThiagoTelho/hammer-price/proto/gen/go/walletpb"
	"github.com/ThiagoTelho/hammer-price/services/wallet/internal/wallet"
	"google.golang.org/grpc"
)

type server struct {
	pb.UnimplementedWalletServer
	store *wallet.Store
}

func (s *server) Reserve(_ context.Context, req *pb.ReserveRequest) (*pb.ReserveReply, error) {
	ok, balance, reserved := s.store.Reserve(req.PlayerId, req.BoxId, req.Amount)
	reason := "OK"
	if !ok {
		reason = "INSUFFICIENT_BALANCE"
	}
	return &pb.ReserveReply{Ok: ok, Balance: balance, Reserved: reserved, Reason: reason}, nil
}

func (s *server) Release(_ context.Context, req *pb.ReleaseRequest) (*pb.Ack, error) {
	return &pb.Ack{Ok: s.store.Release(req.PlayerId, req.BoxId)}, nil
}

func (s *server) GetPlayer(_ context.Context, req *pb.PlayerQuery) (*pb.PlayerState, error) {
	balance, reserved := s.store.Get(req.PlayerId)
	return &pb.PlayerState{PlayerId: req.PlayerId, Balance: balance, Reserved: reserved}, nil
}

func main() {
	addr := os.Getenv("WALLET_ADDR")
	if addr == "" {
		addr = ":50052"
	}
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("wallet: listen %s: %v", addr, err)
	}
	s := grpc.NewServer()
	pb.RegisterWalletServer(s, &server{store: wallet.NewStore()})
	log.Printf("wallet: ouvindo em %s", addr)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("wallet: serve: %v", err)
	}
}
