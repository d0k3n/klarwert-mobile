# Klarwert 1.3.1

Esta versão corrige falhas contabilísticas na importação, no cálculo FIFO e nos
relatórios da carteira.

- Knock-outs parciais e quantidades pequenas conservam as vendas, o custo e os
  saldos corretos. O montante bruto liquidado define a receita da operação.
- Encargos, estornos, reembolsos e cobertura de posições negativas têm sinais
  e imputação consistentes no caixa, no P&L e no relatório fiscal.
- Importações inválidas são rejeitadas antes de substituir o histórico; falhas
  ao guardar preservam o estado anterior. Identificadores não colidem com as
  chaves internas das operações.
- O relatório fiscal conserva os cêntimos da base de custo, identifica a moeda
  correta e exporta CSV com campos escapados e rendimentos líquidos.
- XIRR usa avaliação completa de mercado, distingue a referência ao custo e
  apresenta indisponível quando não há duração ou solução única.
- Avaliações incompletas mostram cobertura e subtotal cotado; mudanças dos
  dados invalidam relatórios fiscais antigos.

Validação: **207 testes passam**, os **25 cenários da auditoria passam**,
TypeScript e build web passam. As **903 operações** da fixture reconciliam com
diferença de **€0,00**, incluindo a conservação de quantidades e receita bruta
nas 201 vendas regulares. A referência Python original foi preservada.

Detalhes em [ACCOUNTING_VALIDATION.md](ACCOUNTING_VALIDATION.md).
