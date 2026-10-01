# Correções e validação contabilística

Data: 1 de outubro de 2026. Versão: **1.3.1**. Base da auditoria: `bfea853`.

As observações A01–A17 e M01–M02 da auditoria foram tratadas. O trabalho foi
dividido entre três subagentes GPT-6.1 Sol com esforço Médio, seguido de revisão
cruzada e validação de integração. A referência Python e a fixture original
foram preservadas.

## Resultado da validação

- `npm test`: **207 testes passam**, sem falhas nem testes ignorados.
- `npx tsc --noEmit`: passa.
- `npm run build:web`: passa; bundles locais atualizados.
- `node --check web/dashboard.js`: passa.
- `git diff --check`: passa.
- **25/25 cenários da auditoria original passam**, incluindo importação via API
  e funções da interface com armazenamento/DOM simulados.
- Fixture de **903 operações**: as **201 vendas regulares** conservam quantidade
  e receita bruta do CSV; os resultados diários e mensais reconciliam com o P&L.

| Medida da fixture | Resultado corrigido |
|---|---:|
| P&L realizado | €2 846,84 |
| Rendimento total líquido | €3 450,23 |
| Saldo de caixa | €30 161,89 |
| Diferença de reconciliação | **€0,00** |

O P&L de referência foi corrigido em €0,03 ao usar o montante bruto liquidado
como receita definitiva, preservando o preço unitário nos movimentos apresentados.
Reconciliação zero foi complementada por verificações independentes de quantidades,
montantes e agregados.

## Cobertura das observações

| Observação | Comportamento corrigido | Regressão principal |
|---|---|---|
| A01 | Knock-out consome o remanescente no evento de extinção; preserva vendas anteriores | `engine-accounting.test.ts` |
| A02 | Quantidades reais pequenas mantêm custo, receita e posição corretos | `engine-accounting.test.ts` |
| A03 | Validação estrutural, campos, datas, números finitos e conflitos de ID antes de guardar; falhas preservam a carteira | `parser.test.ts`, `api_accounting.test.ts` |
| A04 | Juros, reembolsos e restantes categorias incluem encargos no caixa e nos valores líquidos | `engine-accounting.test.ts`, `tax_report.test.ts` |
| A05 | Custos da compra imputados proporcionalmente à cobertura de posições negativas | `engine-accounting.test.ts`, `tax_report.test.ts` |
| A06 | XIRR sem duração é indisponível; várias soluções não originam uma taxa arbitrária | `performance.test.ts` |
| A07 | Vendas sem ID ou com IDs semelhantes a chaves internas conservam comissões separadas | `tax_report.test.ts` |
| A08 | FIFO mantém precisão; receita usa a liquidação; relatório agrega por operação e conserva cêntimos da base de custo | `engine-accounting.test.ts`, `tax_report.test.ts`, `parity.test.ts` |
| A09 | Dividendos convertidos identificam a moeda do montante contabilizado | `engine-accounting.test.ts`, `tax_report.test.ts` |
| A10 | Estornos e devoluções de impostos/comissões preservam o sinal | `parser.test.ts`, `engine-accounting.test.ts`, `tax_report.test.ts` |
| A11 | Dias de alienação com P&L zero contam como dias ativos | `pl_insights.test.ts` |
| A12 | Reembolsos de cartão reduzem despesa nos detalhes e nos agregados | `engine-accounting.test.ts`, `parity.test.ts` |
| A13 | Avaliação incompleta apresenta totais indisponíveis, cobertura e subtotal das posições cotadas | `engine-accounting.test.ts`, `dashboard_accounting.test.ts` |
| A14 | API, interface e fornecedores rejeitam preços/câmbios inválidos e resultados não finitos | `api_accounting.test.ts`, `dashboard_accounting.test.ts`, `market_accounting.test.ts` |
| A15 | Mudança dos dados ou do ano invalida o relatório fiscal e bloqueia exportação antiga, incluindo respostas tardias | `dashboard_accounting.test.ts` |
| A16 | Exportação escapa delimitadores, aspas e quebras de linha; inclui encargos e rendimentos líquidos | `dashboard_accounting.test.ts` |
| A17 | Comparador de paridade deteta diferenças monetárias; referência mantida com correções explícitas | `helpers.test.ts`, `parity.test.ts` |
| M01 | XIRR de investimentos inclui consumo e reembolsos de cartão como distribuições assinadas | `performance.test.ts` |
| M02 | XIRR total usa avaliação completa de mercado; XIRR ao custo permanece identificada separadamente | `performance.test.ts`, `api_accounting.test.ts` |

A revisão cruzada acrescentou regressões para estornos de transferências,
quantidades abaixo de seis casas decimais, bases parciais através de exercícios,
reembolso monetário após extinção, três raízes XIRR, overflow, concorrência de
preços, colisões de IDs no knock-out automático e falhas ao guardar flags de
knock-out ou o cache de tickers.

## Contrato de importação e apresentação

O CSV usa vírgula como delimitador, ponto decimal e aspas RFC 4180. Requer os
cabeçalhos `datetime`, `date`, `category`, `type`, `amount` e `currency`, além dos
campos obrigatórios por operação. Erros indicam linha física e campo.

Os montantes da conta são brutos e expressos em EUR. `fee` e `tax` são movimentos
de caixa assinados, separados de `amount`: débitos negativos, devoluções positivas.
BUY tem montante não positivo; SELL tem montante não negativo. Dividendos,
juros e transferências conservam os sinais dos estornos. Os campos de moeda e
montante originais podem conservar informação estrangeira, mas não substituem
os valores da conta. Tipos desconhecidos e moedas de conta diferentes de EUR
produzem um erro explícito de importação.

IDs são normalizados; repetições exatas são removidas e conteúdos incompatíveis
com o mesmo ID são rejeitados. Operações sem ID continuam distintas. MIGRATION
mantém quantidades assinadas para o diagnóstico de pares. WARRANT_EXERCISE
aceita campos monetários vazios como evento de extinção.

Quantidades, custos FIFO e valores de mercado mantêm precisão antes de agregar.
A apresentação monetária arredonda a cêntimos. No relatório fiscal, bases de
lotes ligados pela mesma alienação transportam o resíduo de cêntimos entre
operações, incluindo mudanças de ano; receitas efetivas de vendas independentes
permanecem intactas. Totais fiscais somam as linhas monetárias apresentadas.

A XIRR total é uma estimativa com as cotações guardadas e a data da avaliação.
A interface indica a cobertura e permite consultar a data da cotação. Sem
cobertura completa, duração suficiente ou solução única, apresenta N/A. O solver
tem um limite de trabalho e também devolve indisponível se não concluir dentro
desse limite.

## Reproduzir e limites

Com Node.js que execute TypeScript diretamente (validação realizada com Node 24):

```powershell
npm test
npx tsc --noEmit
npm run build:web
node --check web/dashboard.js
git diff --check
```

Os scripts `validate-accounting.mjs` e `validation-evidence.json`, com os 25
cenários e os valores da fixture, foram guardados junto dos artefactos da
auditoria original, fora do repositório. A evidência histórica foi preservada.

A validação usa código real com dados sintéticos, a fixture e mocks de
armazenamento, fornecedor de preços e DOM. Não foi executado o APK num dispositivo
nem confrontado o saldo com um extrato externo. O relatório fiscal foi verificado
quanto à coerência dos valores e lançamentos; regras fiscais nacionais permanecem
fora do âmbito desta correção.
