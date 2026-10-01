# Plano de implementação — análise de resultados

Estado: implementação executada em 1 de outubro de 2026. Contratos, decisões
contabilísticas e evidência de validação estão em `RESULTS_ANALYSIS_IMPLEMENTATION.md`.

## Objetivo e âmbito acordado

Permitir que um utilizador que faz 1 a 5 trades por dia acompanhe os resultados
realizados, consulte as operações que os explicam e compare períodos, a partir
do extrato CSV da Trade Republic.

- O extrato continua a ser a única fonte de novos dados financeiros.
- Não criar diário de trading, análise de padrões ou painel de risco pessoal.
- Não pedir preços, capital inicial, estratégias, stops, objetivos, notas,
  chaves de serviços ou frequência de trading para estas funcionalidades.
- Selecionar um período, pesquisar, navegar e confirmar uma importação são
  interações de consulta; não são introdução de dados financeiros.
- Restaurar um backup repõe dados anteriormente importados; não cria uma nova
  fonte financeira. Preservar dados e configurações legados sem os exigir nos
  novos cálculos ou ecrãs.
- Manter o processamento e o armazenamento locais.

## Limites dos dados

O CSV atual fornece movimentos e informação para cálculo FIFO, mas não um
histórico de avaliações de mercado. Nesta implementação:

- Entregar P&L realizado diário/acumulado em EUR e métricas de operações.
- Apresentar dividendos e juros separadamente, com encargos documentados.
- Apresentar depósitos, levantamentos e consumo como movimentos, não como lucro.
- A queda desde o máximo do P&L realizado pode ser mostrada em EUR e deve ter
  esse nome; não a apresentar como drawdown do valor total da carteira.
- Adiar valor histórico de mercado, P&L não realizado histórico, rendibilidade
  percentual da carteira, TWR e benchmarks. Não reconstruir o passado usando
  preços atuais ou valorizar a carteira ao custo com um rótulo de mercado.
- Distinguir primeira/última data de movimentos de cobertura integral do
  extrato. A ausência de movimentos não prova um período completo.

## Evidência no código atual

- `src/performance.ts`: vencedores e perdedores agregados por ISIN em
  `closed_positions`, em vez de por operação realizada.
- `src/engine.ts`: histórico exposto limitado a 50 operações; existem FIFO,
  resultados diários/mensais e vínculos aos lotes de aquisição.
- `web/dashboard.js`: curva acumulada mensal, navegação semanal/mensal
  independente e toque no calendário limitado a um tooltip.
- `src/api.ts`: importar CSV substitui o ficheiro anterior; a configuração
  exportada não constitui backup da carteira.
- `src/pl_insights.ts`: extrapolação dependente de frequência introduzida
  manualmente; não identifica um intervalo completo de observação.
- `src/report.ts`: PDF captura cartões/gráficos do DOM sem contrato comum de
  período ou revisão dos dados.

## P0 — contrato comum e regras contabilísticas

Responsável: agente coordenador. Deve terminar antes de alterações concorrentes.

1. Definir tipos partilhados em `src/types.ts`: identidade interna do movimento,
   evento de realização, qualidade do custo, período, paginação e resultado da
   análise. A identidade interna não substitui o `transaction_id` original.
2. Usar como unidade analítica uma **operação com resultado realizado**:
   uma venda que consome três lotes conta uma vez; duas vendas parciais contam
   duas vezes. Identificar resgate/extinção e outros eventos separadamente.
   Não inferir uma intenção de trading ou um ciclo discricionário.
3. Guardar receita bruta, custo de aquisição bruto, encargos de aquisição
   atribuídos, encargos de saída, resultado bruto e líquido. Os impostos são
   apenas os movimentos registados e atribuíveis à operação; não estimar
   impostos pessoais futuros.
4. Emitir o resultado líquido diretamente no motor. Não somar ingenuamente
   `LotMatch.pl`: os encargos de venda normais não estão todos nesse campo.
   Preservar sinais de estornos e não descontar encargos duas vezes.
5. Calcular FIFO sobre todo o histórico e só depois filtrar pelas datas de
   realização, com início e fim inclusivos.
6. Usar `Row.date`, a data registada no extrato, para os agrupamentos de
   calendário. Usar `datetime` para ordenação e detalhe, preservando desempates
   determinísticos. Antes de alterar agregados existentes, testar diferenças
   entre estas datas na fixture e documentar qualquer correção necessária.
7. Classificar ganhos, perdas e resultados zero após o arredondamento monetário
   de apresentação. Taxa de ganhos = ganhos / operações válidas, incluindo as
   operações de resultado zero. Sem operações válidas: indisponível.
8. Quantidades vendidas sem aquisição conhecida não comprovam uma posição
   curta: podem indicar histórico incompleto ou transferência. Sinalizar custo
   desconhecido, excluir das estatísticas de ganhos/perdas e não publicar um
   resultado completo como definitivo. Mostrar subtotal conhecido e número de
   operações incompletas. Se forem mantidos valores provisórios legados para
   auditoria, identificá-los e não os misturar com os novos resultados válidos.
9. Definir a reconciliação: soma das operações válidas = soma diária válida =
   cartões do período = ponto final da curva = exportação. Em histórico
   completo, reconciliar também com o P&L contabilístico existente. Encargos e
   eventos especiais conservam a data contabilística de reconhecimento; não
   deslocar encargos de posições negativas apenas nas estatísticas.
10. Congelar os contratos antes de distribuir os módulos. Atualizações a tipos
    partilhados ou à API pertencem ao coordenador.

## P1 — motor de resultados e estatísticas

Subagente A: `gpt-6.1-sol`, `reasoning_effort: low`.

Ficheiros: `src/engine.ts`, `src/performance.ts`, novo `src/results_analysis.ts`
e respetivos testes. Não editar `src/api.ts` nem os ficheiros web.

- Emitir eventos de realização com referências aos movimentos e lotes FIFO.
- Construir uma análise única por período: total líquido conhecido, qualidade,
  ganhos/perdas/zeros, taxa de ganhos, médias, resultado médio e profit factor.
- Profit factor indisponível quando não há perdas, sem apresentar infinito.
- Construir série diária contínua; dias sem realização são diferentes de dias
  com realização e resultado zero. A curva do período começa em zero.
- Construir comparação com o período anterior equivalente e explicitar as
  datas. Períodos incompletos devem ser identificados.
- Fornecer histórico completo de movimentos e lista completa de realizações,
  com identificadores estáveis, ordenação, pesquisa e paginação.
- Manter posições, fiscalidade e reconciliação compatíveis; documentar qualquer
  diferença resultante de uma correção contabilística comprovada.

Aceitação mínima:

- Mesmo ISIN com fechos de +100 e -50: duas operações, taxa de ganhos de 50%.
- Venda com três lotes: uma operação, custo FIFO correto.
- Compra anterior ao período e venda parcial dentro dele conservam o custo.
- Compra de 100, comissão de 1; venda de 110, comissão de 1 e imposto de 2:
  resultado bruto 10, líquido 6.
- Estornos, centésimos fracionários, extinções e mesmo instante conservam os
  valores e uma ordem determinística.
- Custo desconhecido e período vazio não produzem métricas de sucesso falsas.
- Mais de 50 movimentos continuam acessíveis sem perder operações.

## P2 — importação incremental e armazenamento consistente

Subagente B: `gpt-6.1-sol`, `reasoning_effort: low`.

Ficheiros: `src/csv.ts`, novos `src/import_ledger.ts` e `src/storage.ts`, testes
de parser/importação/armazenamento. Integração em `src/api.ts` pelo coordenador.

- Acrescentar parser detalhado compatível com `parseCSV`, conservando cabeçalhos,
  células e campos desconhecidos necessários à verificação de conflitos.
- Conservar proveniência e identidade estável por movimento/ocorrência num
  histórico versionado. Não persistir apenas `Row[]` e perder campos do CSV.
- Com ID: repetição equivalente é ignorada; mesmo ID com conteúdo incompatível
  bloqueia o incremento e mantém o estado anterior. A ordem dos cabeçalhos não
  cria um conflito; mudanças de esquema têm política explícita e conservadora.
- Sem ID: conservar ocorrências legítimas iguais dentro do mesmo ficheiro e
  reconhecer reimportação exata. Não prometer deduplicação universal entre CSV
  diferentes quando as operações anónimas são indistinguíveis.
- Bloquear sobreposição anónima ambígua com instrução para reexportar um
  histórico completo. Disponibilizar substituição integral validada por esse
  extrato, com resumo e recuperação da revisão anterior, sem edição manual.
- A ausência de um movimento num extrato parcial nunca elimina dados anteriores.
- Preparar e validar o novo estado antes de publicar uma revisão única. Manter
  a serialização das mutações e recuperação após falhas de escrita/interrupção.
- Validar as garantias do adaptador nativo antes de escolher a publicação por
  gerações/manifesto; não presumir que várias escritas de ficheiros são atómicas.
- Migrar o armazenamento legado sem eliminar os originais antes de confirmar
  a persistência e a recuperação do novo formato.

Aceitação mínima:

- Importar A duas vezes não altera contagens nem resultados.
- A e B sobrepostos, com IDs, equivalem ao histórico completo correspondente.
- Conflito, esquema incompatível e sobreposição anónima ambígua não alteram
  disco, memória ou resultados.
- Duas operações anónimas iguais no mesmo CSV permanecem duas.
- Concorrência, quota excedida, falha de escrita e migração interrompida
  conservam uma revisão recuperável e consistente.

## P3 — dashboard, calendário e histórico

Subagente C: `gpt-6.1-sol`, `reasoning_effort: low`.

Ficheiros exclusivos: `web/index.html`, `web/dashboard.js`, `web/style.css` e
testes UI. Pode preparar apresentação com o contrato P0 enquanto A/B trabalham;
a ligação a dados reais depende de P1 e da integração da API.

- Seletor comum: tudo, hoje, semana, mês, ano e intervalo de datas. Identificar
  último movimento importado; datas posteriores não simulam atualização diária.
- Cartões principais: P&L líquido realizado, operações com resultado, taxa de
  ganhos, resultado médio e qualidade/cobertura. Comparação anterior quando válida.
- Curva diária acumulada e barras por dia/semana/mês, com agregação de consulta
  e sem alterar o período global.
- Calendário: resultado e número de realizações por dia; distinguir sem fechos,
  zero e dados incompletos. Toque abre lista; operação abre detalhe FIFO e custos.
- Voltar conserva período, mês, pesquisa, página, posição e foco.
- Histórico de realizações e movimentos do extrato, com pesquisa por produto/ISIN,
  filtros de consulta, contagens e paginação real. Sem corte nas últimas 50 linhas.
- Mostrar dividendos/juros em cartões próprios; não somá-los à taxa de ganhos.
- Fluxo de importação com resumo de novos/duplicados/conflitos e data dos dados.
- Não colocar campos de preços manuais, chave API ou frequência de trading no
  percurso novo. Cálculos novos independentes das configurações manuais legadas.
- Após importação/restauro, invalidar todos os resultados e exportações antigos;
  respostas atrasadas não podem repor dados de outra revisão/período.

Aceitação mínima:

- Um período atualiza todas as superfícies de resultados em conjunto.
- Calendário → lista → detalhe reproduz os totais do dia e do período.
- Pesquisa e paginação não perdem movimentos nem mantêm páginas inválidas.
- Consulta em 360/390 px e paisagem sem valores cortados; detalhe utilizável
  sem deslocação horizontal; calendário mantém sete colunas.
- Toque, teclado, foco e estados vazios funcionam com dados reais.

## P4 — projeção anual automática

Subagente A, depois de P1. Ficheiros: `src/pl_insights.ts` e testes.

- Retirar dos novos cálculos a frequência manual de dias ativos por semana.
- Inferir a cadência de dias com realização e o resultado médio desses dias.
- Mostrar duas extrapolações independentes: histórico disponível do ano e janela
  recente de até 60 dias. Não exigir parâmetros ao utilizador nem inventar
  intervalos de confiança ou cenários otimista/pessimista sem modelo validado.
- Exibir início/fim observado, dias com realização, hipótese de cobertura,
  fórmula e componente observada versus extrapolada.
- Quando não existe fim explícito do extrato, usar o último movimento importado
  como referência identificada; não interpretar os dias até hoje como observados.
- Regra inicial de produto: exigir pelo menos 30 dias de observação e 10 dias
  com realização por cenário; abaixo disso apresentar amostra insuficiente.
  Estes limites são regras da aplicação, não campos para preencher.
- Desativar o cenário se a janela observada ou a componente anual acumulada
  contiver realizações com custo desconhecido. Não excluir essas operações e
  extrapolar o subtotal restante como resultado anual total. Anos encerrados
  mostram apenas o observado, sem futuro.

Aceitação: datas duplicadas agregadas, resultado zero, amostra insuficiente,
início a meio do ano, ano bissexto, extrato antigo, ano encerrado e 31 de dezembro.

## P5 — backup integral e restauro

Subagente B, depois de P2. Ficheiros: novo `src/backup.ts` e testes.

- Criar formato próprio versionado com histórico/proveniência, revisão,
  configurações e estado legado necessário à reconstrução, incluindo preços
  com datas e flags existentes, sem os usar como fonte de resultados novos.
- Excluir a chave Finnhub do backup; restauro preserva a chave do dispositivo.
  Não acrescentar um fluxo de password ou configuração de serviços neste plano.
- Validar estrutura, versão, valores, limites e cálculo antes de gravar.
- Publicar o restauro como uma revisão completa, com recuperação da anterior,
  sem misturar configurações/preços de duas carteiras.
- O backup inclui todos os dados, independentemente do período em consulta.

Aceitação: exportar/restaurar reproduz movimentos, identificadores, FIFO, caixa,
resultados e configurações; ficheiro inválido ou falha mantém a carteira anterior.

## P6 — exportações e integração final

Subagente C: `src/report.ts`, testes PDF/CSV e adaptação dos controlos web.
Coordenador: `src/api.ts`, adaptações partilhadas, documentação e validação final.

- PDF resume o período selecionado, com datas, revisão, origem dos dados,
  definição de resultado líquido e pressupostos de qualquer projeção incluída.
- CSV analítico exporta as operações filtradas com os componentes do resultado.
  O CSV fiscal existente mantém o seu contrato e seleção de ano próprios.
- Congelar período/revisão durante a exportação; nunca misturar estados se a
  consulta mudar enquanto o ficheiro está a ser gerado.
- Distinguir claramente relatório PDF, detalhe CSV e backup restaurável.
- API disponibiliza um resultado coerente por período/revisão e paginação;
  preservar rotas legadas durante a migração dos consumidores.
- Documentar o significado de operação realizada, resultado líquido, custo
  incompleto, data de calendário e extrapolação automática.

## Execução com subagentes

Todos os subagentes de implementação e revisão usam **GPT-6.1 Sol / Leve**:
`model: gpt-6.1-sol`, `reasoning_effort: low`. Usar contexto limitado com objetivo,
contratos, ficheiros atribuídos e critérios de aceitação. Máximo: coordenador
mais três subagentes ativos. Sem criar novos chats no produto.

| Onda | Coordenador | Subagente A | Subagente B | Subagente C |
|---|---|---|---|---|
| 0 | P0, contratos e baseline | — | — | — |
| 1 | Rever contratos e integrar interfaces sem conflitos | P1 | P2 | Estrutura de P3 com contrato fixo |
| 2 | API e integração de revisões/períodos | P4 | P5 | P3 com dados reais e P6 |
| 3 | Validação integrada e resolução de diferenças | Revisão de importação/backup | Revisão de métricas/FIFO | Revisão de consistência de exportações e UI |
| 4 | Build e verificação final | Correções atribuídas | Correções atribuídas | Correções atribuídas |

Regras de execução:

- Um responsável por ficheiro; apenas o coordenador altera `src/api.ts` e tipos
  partilhados. Não editar bundles gerados diretamente.
- A revisão entre agentes não inclui alterações concorrentes aos ficheiros do
  autor; comunicar achados e atribuir a correção a um único responsável.
- Resolver regressões contabilísticas antes de continuar a funcionalidades que
  dependam desses valores. Não atualizar snapshots para esconder diferenças.
- Não instalar/indexar CodeGraph: o repositório atual não tem `.codegraph/`.
- Este plano não cria automaticamente uma versão publicada, tag ou deployment.

## Validação e conclusão

No início da execução, registar a baseline real; não presumir a contagem de
testes descrita em versões anteriores. Na integração final executar:

```powershell
npm test
npx tsc --noEmit
npm run build:web
node --check web/dashboard.js
git diff --check
```

Acrescentar testes comportamentais de filtros, identidade, contagens, encargos,
falhas de persistência e exportação; não depender apenas de regex sobre fontes.
Usar a fixture contabilística existente e cenários pequenos com resultados
esperados explícitos. Verificar a interface num browser e, se houver dispositivo
ou emulador disponível, importação/partilha/persistência no Android. Sem teste
Android, reportar essa limitação em vez de afirmar validação nativa.

A entrega está concluída quando o utilizador pode importar um extrato, consultar
um período, explicar cada dia através das operações, recuperar o histórico e
exportar/restaurar os dados, sem introduzir informação financeira manual e com
resultados reconciliados ou indisponibilidade explicitamente justificada.
