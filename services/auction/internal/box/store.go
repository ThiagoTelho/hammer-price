// Package box mantém o estado das caixas em leilão e a lógica do lance atômico.
//
// FATIA VERTICAL: estado em memória, um sync.Mutex POR CAIXA — lances em caixas
// diferentes correm em paralelo; lances na MESMA caixa são serializados. O
// cronômetro é apenas um prazo informativo (sem fechamento automático ainda);
// a goroutine de timer/anti-sniping, o RNG de abertura e o particionamento por
// vault entram em etapas posteriores.
package box

import (
	"sync"
	"time"
)

// timerBase é o tempo do cronômetro reiniciado a cada lance.
const timerBase = 20 * time.Second

// Wallet é a dependência da Carteira que o leilão usa para reservar/devolver
// saldo. Implementada pelo servidor sobre o cliente gRPC.
type Wallet interface {
	Reserve(playerID, boxID string, amount int64) (ok bool)
	Release(playerID, boxID string)
}

type box struct {
	mu       sync.Mutex
	id       string
	boxType  string
	curBid   int64
	leader   string
	deadline time.Time
}

// minIncrement: 5% do lance atual, mínimo absoluto de 5.
func minIncrement(cur int64) int64 {
	inc := cur * 5 / 100
	if inc < 5 {
		inc = 5
	}
	return inc
}

type Store struct {
	wallet Wallet
	boxes  map[string]*box
}

// NewStore cria o estado inicial com um conjunto fixo de caixas (fatia vertical).
func NewStore(w Wallet) *Store {
	s := &Store{wallet: w, boxes: make(map[string]*box)}
	seed := []struct{ id, typ string }{
		{"box-1", "BRONZE"},
		{"box-2", "SILVER"},
		{"box-3", "GOLD"},
		{"box-4", "VAULT"},
	}
	now := time.Now()
	for _, b := range seed {
		s.boxes[b.id] = &box{id: b.id, boxType: b.typ, deadline: now.Add(timerBase)}
	}
	return s
}

// BidResult é o resultado de um lance.
type BidResult struct {
	Accepted   bool
	Reason     string // OK | TOO_LOW | INSUFFICIENT_BALANCE | UNKNOWN_BOX
	CurrentBid int64
	Leader     string
	TimerMs    int64
}

// PlaceBid aplica um lance de forma atômica para a caixa indicada.
func (s *Store) PlaceBid(boxID, playerID string, amount int64) BidResult {
	b, ok := s.boxes[boxID]
	if !ok {
		return BidResult{Reason: "UNKNOWN_BOX"}
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if amount < b.curBid+minIncrement(b.curBid) {
		return BidResult{Reason: "TOO_LOW", CurrentBid: b.curBid, Leader: b.leader, TimerMs: remainingMs(b)}
	}

	// Reserva o saldo do novo lance ANTES de aceitar (chamada síncrona à Carteira).
	if okReserve := s.wallet.Reserve(playerID, boxID, amount); !okReserve {
		return BidResult{Reason: "INSUFFICIENT_BALANCE", CurrentBid: b.curBid, Leader: b.leader, TimerMs: remainingMs(b)}
	}

	// Devolve a reserva do líder anterior (se for outro jogador).
	if b.leader != "" && b.leader != playerID {
		s.wallet.Release(b.leader, boxID)
	}

	b.curBid = amount
	b.leader = playerID
	b.deadline = time.Now().Add(timerBase) // reseta o cronômetro
	return BidResult{Accepted: true, Reason: "OK", CurrentBid: b.curBid, Leader: b.leader, TimerMs: remainingMs(b)}
}

// Snapshot é a visão de uma caixa para o estado do vault.
type Snapshot struct {
	BoxID, BoxType, Leader string
	CurrentBid, TimerMs    int64
}

func (s *Store) Snapshot() []Snapshot {
	out := make([]Snapshot, 0, len(s.boxes))
	// ordem estável das caixas semente
	for _, id := range []string{"box-1", "box-2", "box-3", "box-4"} {
		b, ok := s.boxes[id]
		if !ok {
			continue
		}
		b.mu.Lock()
		out = append(out, Snapshot{
			BoxID: b.id, BoxType: b.boxType, Leader: b.leader,
			CurrentBid: b.curBid, TimerMs: remainingMs(b),
		})
		b.mu.Unlock()
	}
	return out
}

// remainingMs deve ser chamado com o lock da caixa adquirido.
func remainingMs(b *box) int64 {
	ms := time.Until(b.deadline).Milliseconds()
	if ms < 0 {
		return 0
	}
	return ms
}
