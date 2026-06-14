// Package wallet mantém o estado de saldo/reservas dos jogadores.
//
// FATIA VERTICAL: estado em memória, protegido por um sync.Mutex. Isso já
// demonstra serialização de acessos concorrentes e garante a invariante
// "saldo gastável nunca negativo". Numa etapa posterior, o lock vira Redlock
// (lock distribuído entre instâncias) e o estado vai para o PostgreSQL com
// ledger append-only.
package wallet

import (
	"sync"
)

// InitialBudget é o orçamento concedido a um jogador na primeira interação.
const InitialBudget int64 = 1000

type player struct {
	balance  int64
	reserved int64
	// reservas ativas por caixa, para permitir Release idempotente.
	byBox map[string]int64
}

// Store é a carteira em memória, segura para acesso concorrente.
type Store struct {
	mu      sync.Mutex
	players map[string]*player
}

func NewStore() *Store {
	return &Store{players: make(map[string]*player)}
}

// getOrCreate deve ser chamado com o lock já adquirido.
func (s *Store) getOrCreate(id string) *player {
	p, ok := s.players[id]
	if !ok {
		p = &player{balance: InitialBudget, byBox: make(map[string]int64)}
		s.players[id] = p
	}
	return p
}

// Reserve tenta reservar `amount` do saldo gastável do jogador para uma caixa.
// Se o jogador já tinha reserva naquela caixa (cobrindo o próprio lance), ela é
// substituída pelo novo valor. Retorna ok=false se o saldo gastável for
// insuficiente. Operação atômica (serializada pelo mutex).
func (s *Store) Reserve(playerID, boxID string, amount int64) (ok bool, balance, reserved int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := s.getOrCreate(playerID)
	prev := p.byBox[boxID] // reserva anterior desta caixa (0 se nenhuma)
	// saldo gastável considerando que a reserva anterior será devolvida
	spendable := p.balance - (p.reserved - prev)
	if amount > spendable {
		return false, p.balance, p.reserved
	}
	p.reserved = p.reserved - prev + amount
	p.byBox[boxID] = amount
	return true, p.balance, p.reserved
}

// Release devolve ao saldo gastável a reserva que o jogador tinha numa caixa
// (ex.: quando é superado). Idempotente.
func (s *Store) Release(playerID, boxID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	p, ok := s.players[playerID]
	if !ok {
		return true
	}
	if amt, has := p.byBox[boxID]; has {
		p.reserved -= amt
		delete(p.byBox, boxID)
	}
	return true
}

// Get retorna o estado atual do jogador (criando-o se necessário).
func (s *Store) Get(playerID string) (balance, reserved int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.getOrCreate(playerID)
	return p.balance, p.reserved
}
